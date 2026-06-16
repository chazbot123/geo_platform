import {
  getAccountPublishingDraft,
  getPlatformAccount,
  getPublishingJob,
} from "@/lib/storage/data-store";
import { recordPublishingJobResult } from "@/lib/publish/jobs-service";
import { LOCAL_BRIDGE_BASE_URL } from "@/lib/publish/local-bridge-client";
import { buildXiaohongshuNoteBody, normalizeDouyinTags, normalizeXiaohongshuTags, validateDraftForPlatform } from "@/lib/publish/draft-builders";
import { resolvePublishImagePaths } from "@/lib/publish/publish-image-resolver";
import type {
  AccountPublishingDraft,
  PublishingDraft,
  PublishingJobRecord,
  PublishingJobStatus,
} from "@/lib/types";

const ELECTRON_PUBLISH_TIMEOUT_MS = 180000;
const LOCAL_BRIDGE_TIMEOUT_BUFFER_MS = 15000;

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

function isAbortLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return error.name === "AbortError" || message.includes("operation was aborted");
}

function formatBridgeTimeoutMessage(timeoutMs: number) {
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  return `桌面发布执行超时（>${timeoutSeconds} 秒），请检查 Electron 发布窗口是否卡在登录、风控、图片上传或提交确认步骤。`;
}

function buildAutomationPayload(job: PublishingJobRecord, resolvedImagePaths: string[]) {
  const draftTags =
    job.platform === "xiaohongshu"
      ? normalizeXiaohongshuTags(job.draftTags)
      : job.platform === "douyin"
        ? normalizeDouyinTags(job.draftTags)
        : job.draftTags;
  const draftBody = job.platform === "xiaohongshu" ? buildXiaohongshuNoteBody(job.draftBody ?? "", draftTags) : job.draftBody;

  return {
    draftTitle: job.draftTitle,
    draftBody,
    draftTags,
    draftImages: job.draftImages,
    draftImagePaths: resolvedImagePaths,
    publishMode: resolvedImagePaths.length ? "with_images" : (job.publishMode ?? "text_only"),
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
      throw new Error(payload.error || payload.reason || "本地桌面桥请求失败，请确认 GEO 桌面版正在运行。");
    }
    return payload;
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(formatBridgeTimeoutMessage(timeoutMs));
    }
    throw error;
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
    throw new Error("发布任务不存在。");
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
    taskId: job.contentPoolItemId ?? job.taskId,
    imageUrls: draft.imageUrls,
    localImagePaths: job.draftImagePaths?.length ? job.draftImagePaths : draft.localImagePaths,
  });
  const validationErrors = validateDraftForPlatform(
    {
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      imageUrls: draft.imageUrls,
      localImagePaths: resolvedImagePaths,
      publishMode: resolvedImagePaths.length ? "with_images" : (draft.publishMode ?? "text_only"),
      coverImageUrl: draft.coverImageUrl,
    },
    draft.platform,
  );
  if (validationErrors.length > 0) {
    return recordPublishingJobResult({
      jobId: job.id,
      status: "failed",
      failureStage: "preflight",
      errorMessage: validationErrors.map((error) => error.message).join("；"),
      executionLog: ["发布前校验未通过，已阻断自动化发布。"],
    });
  }
  const bridgeReady = await checkLocalBridgeReady();
  if (!bridgeReady) {
    return recordPublishingJobResult({
      jobId: job.id,
      status: "failed",
      failureStage: "electron_bridge",
      errorMessage: `本地发布代理不可用：请先启动 GEO Desktop / Electron bridge，并确认 ${LOCAL_BRIDGE_BASE_URL}/health 返回 ready。`,
    });
  }

  const sessionToken = job.sessionToken || `${job.id}-${Date.now()}`;
  await recordPublishingJobResult({
    jobId: job.id,
    status: "running",
    sessionToken,
    notes: `Electron 自动发布已启动，正在执行 ${job.platform} 脚本。`,
    executionLog: [`启动 Electron ${job.platform} 发布会话`],
  });

  try {
    const bridgeRequestTimeoutMs = ELECTRON_PUBLISH_TIMEOUT_MS + LOCAL_BRIDGE_TIMEOUT_BUFFER_MS;
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
        timeoutMs: ELECTRON_PUBLISH_TIMEOUT_MS,
        payload: buildAutomationPayload(job, resolvedImagePaths),
      },
      bridgeRequestTimeoutMs,
    );

    const status: PublishingJobStatus = result.status === "unsupported" ? "failed" : result.status;
    return recordPublishingJobResult({
      jobId: job.id,
      status,
      sessionToken,
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
      sessionToken,
      failureStage: isAbortLikeError(error) ? "script_timeout" : "electron_bridge",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
