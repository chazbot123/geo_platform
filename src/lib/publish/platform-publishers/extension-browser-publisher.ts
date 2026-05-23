"use client";

import { startPlatformExtensionPublishSession } from "@/lib/publish/platform-extension-bridge";
import type { PlatformPublisher } from "@/lib/publish/platform-publishers/base";
import type { PublishingJobRecord } from "@/lib/types";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function getJob(jobId: string) {
  const response = await fetch(`/api/publish/jobs/${jobId}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "读取发布任务状态失败");
  }
  return payload.job as PublishingJobRecord;
}

export const extensionBrowserPublisher: PlatformPublisher = {
  async publish({ account, draft, job, timeoutMs = 180000 }) {
    try {
      const sessionResponse = await fetch("/api/publishing/extension/publish-jobs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const sessionPayload = await sessionResponse.json();
      if (!sessionResponse.ok) {
        return {
          status: "failed",
          failureStage: "extension_publish_session",
          errorMessage: sessionPayload.message ?? "创建扩展发布会话失败",
        };
      }

      await startPlatformExtensionPublishSession({
        session: sessionPayload,
        platform: account.platform,
        apiBaseUrl: window.location.origin,
      });
    } catch (error) {
      return {
        status: "failed",
        failureStage: "missing_extension_bridge",
        errorMessage: error instanceof Error ? error.message : "浏览器扩展不可用，无法启动自动发布",
      };
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(2000);
      const nextJob = await getJob(job.id);
      if (nextJob.status === "running") {
        continue;
      }

      if (nextJob.status === "pending_review" || nextJob.status === "verification_failed" || nextJob.status === "submitted" || nextJob.status === "verifying") {
        return {
          status: nextJob.status,
          publishUrl: nextJob.publishUrl,
          draftUrl: nextJob.draftUrl,
          verificationUrl: nextJob.verificationUrl,
          externalStatus: nextJob.externalStatus,
          executionLog: nextJob.executionLog,
          verificationEvidence: nextJob.verificationEvidence,
          verificationAttempts: nextJob.verificationAttempts,
          platformItemId: nextJob.platformItemId,
          failureStage: nextJob.failureStage,
          errorMessage: nextJob.errorMessage,
        };
      }

      if (nextJob.status === "published") {
        return {
          status: "published",
          publishUrl: nextJob.publishUrl,
          draftUrl: nextJob.draftUrl,
          verificationUrl: nextJob.verificationUrl,
          externalStatus: nextJob.externalStatus,
          executionLog: nextJob.executionLog,
          verificationEvidence: nextJob.verificationEvidence,
          verificationAttempts: nextJob.verificationAttempts,
          platformItemId: nextJob.platformItemId,
        };
      }

      if (nextJob.status === "failed") {
        return {
          status: "failed",
          publishUrl: nextJob.publishUrl,
          draftUrl: nextJob.draftUrl,
          verificationUrl: nextJob.verificationUrl,
          externalStatus: nextJob.externalStatus,
          executionLog: nextJob.executionLog,
          verificationEvidence: nextJob.verificationEvidence,
          verificationAttempts: nextJob.verificationAttempts,
          platformItemId: nextJob.platformItemId,
          failureStage: nextJob.failureStage,
          errorMessage: nextJob.errorMessage,
        };
      }
    }

    return {
      status: "failed",
      failureStage: "extension_publish_timeout",
      errorMessage: `${platformLabel(draft.platform)} 扩展发布在限定时间内未返回结果`,
    };
  },
};

function platformLabel(platform: string) {
  if (platform === "xiaohongshu") return "小红书";
  if (platform === "douyin") return "抖音";
  return platform;
}
