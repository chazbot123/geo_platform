import {
  getAccountPublishingDraft,
  getPlatformAccount,
  getPublishingJob,
} from "@/lib/storage/data-store";
import { recordPublishingJobResult } from "@/lib/publish/jobs-service";
import { LOCAL_BRIDGE_BASE_URL } from "@/lib/publish/local-bridge-client";
import { resolvePublishImagePaths } from "@/lib/publish/publish-image-resolver";
import type {
  AccountPublishingDraft,
  PublishingDraft,
  PublishingJobRecord,
  PublishingJobStatus,
} from "@/lib/types";

function accountDraftToPublishingDraft(draft: AccountPublishingDraft): PublishingDraft {
  return {
    id: draft.id,
    taskId: draft.taskId,
    platform: draft.platform,
    title: draft.title,
    body: draft.body,
    tags: draft.tags,
    coverImageUrl: draft.coverImageUrl,
    imageUrls: draft.imageUrls,
    localImagePaths: draft.localImagePaths,
    publishMode: draft.publishMode,
    publishEntryUrl: draft.publishEntryUrl,
    accountId: draft.accountId,
    updatedAt: draft.updatedAt,
  };
}

async function requestLocalBridge<T>(pathname: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string; reason?: string };
    if (!response.ok) {
      throw new Error(payload.error || payload.reason || "local bridge request failed");
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function checkLocalBridgeReady() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as { status?: string; ready?: boolean; port?: number };
    return response.ok && payload.status === "ok" && payload.ready === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveJobDraft(job: PublishingJobRecord): Promise<PublishingDraft> {
  if (job.accountPublishingDraftId) {
    const accountDraft = await getAccountPublishingDraft(job.accountPublishingDraftId);
    if (accountDraft) return accountDraftToPublishingDraft(accountDraft);
  }

  return {
    id: `${job.taskId}-${job.platform}-${job.id}`,
    taskId: job.taskId,
    platform: job.platform,
    title: job.draftTitle,
    body: job.draftBody,
    tags: job.draftTags,
    coverImageUrl: job.draftImages[0],
    imageUrls: job.draftImages,
    localImagePaths: job.draftImagePaths,
    publishMode: job.publishMode ?? "text_only",
    publishEntryUrl: job.publishEntryUrl,
    accountId: job.accountId,
    updatedAt: new Date().toISOString(),
  };
}

export async function runQueuedPublishingJob(jobId: string) {
  const job = await getPublishingJob(jobId);
  if (!job) {
    throw new Error("publishing job not found");
  }
  if (job.status !== "queued") {
    return job;
  }
  if (job.executionMode !== "electron_automation") {
    return job;
  }
  if (!job.accountId) {
    return recordPublishingJobResult({
      jobId: job.id,
      status: "failed",
      failureStage: "account_binding",
      errorMessage: "自动发布需要绑定已登录平台账号。",
    });
  }

  const account = await getPlatformAccount(job.accountId);
  if (!account || account.loginStatus !== "authenticated" || !account.sessionPartition) {
    return recordPublishingJobResult({
      jobId: job.id,
      status: "failed",
      failureStage: "account_binding",
      errorMessage: "平台账号未登录、登录失效或缺少 session partition。",
    });
  }

  const draft = await resolveJobDraft(job);
  const resolvedImagePaths = await resolvePublishImagePaths({
    taskId: job.taskId,
    imageUrls: draft.imageUrls,
    localImagePaths: job.draftImagePaths?.length ? job.draftImagePaths : draft.localImagePaths,
  });
  const bridgeReady = await checkLocalBridgeReady();
  if (!bridgeReady) {
    return recordPublishingJobResult({
      jobId: job.id,
      status: "failed",
      failureStage: "electron_bridge",
      errorMessage: `本地发布代理不可用：请先启动 GEO Desktop / Electron bridge，并确认 ${LOCAL_BRIDGE_BASE_URL}/health 返回 ready。`,
    });
  }

  await recordPublishingJobResult({
    jobId: job.id,
    status: "running",
    notes: `Electron 自动发布已启动，正在执行 ${job.platform} 脚本。`,
    executionLog: [`启动 Electron ${job.platform} 发布会话`],
  });

  const sessionToken = job.sessionToken || `${job.id}-${Date.now()}`;
  try {
    const result = await requestLocalBridge<{
      status: "published" | "submitted" | "verifying" | "pending_review" | "verification_failed" | "failed" | "unsupported";
      draftUrl?: string;
      publishUrl?: string;
      verificationUrl?: string;
      externalStatus?: string;
      executionLog?: string[];
      verificationEvidence?: string;
      verificationAttempts?: number;
      platformItemId?: string;
      failureStage?: string;
      errorMessage?: string;
    }>(
      "/platform/publish",
      {
        platform: draft.platform,
        title: `${draft.platform}发布`,
        publishUrl: draft.publishEntryUrl,
        sessionPartition: account.sessionPartition,
        authPayload: account.authPayload,
        sessionToken,
        timeoutMs: 180000,
        payload: {
          draftTitle: job.draftTitle,
          draftBody: job.draftBody,
          draftTags: job.draftTags,
          draftImages: job.draftImages,
          draftImagePaths: resolvedImagePaths,
          publishMode: resolvedImagePaths.length ? "with_images" : (job.publishMode ?? "text_only"),
        },
      },
      185000,
    );

    const status: PublishingJobStatus = result.status === "unsupported" ? "failed" : result.status;
    return recordPublishingJobResult({
      jobId: job.id,
      status,
      publishUrl: result.publishUrl,
      draftUrl: result.draftUrl,
      verificationUrl: result.verificationUrl,
      externalStatus: result.externalStatus,
      executionLog: result.executionLog,
      verificationEvidence: result.verificationEvidence,
      verificationAttempts: result.verificationAttempts,
      platformItemId: result.platformItemId,
      failureStage: result.failureStage,
      errorMessage: result.errorMessage,
      notes: status === "published" ? `平台自动发布成功，并已完成 ${job.platform} 发布回写。` : undefined,
    });
  } catch (error) {
    return recordPublishingJobResult({
      jobId: job.id,
      status: "failed",
      failureStage: "electron_bridge",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
