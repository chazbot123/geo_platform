import { createRecordId, getPlatformAccount, getPublishingDraft, getPublishingJob, getPublishingJobsByTask, savePublishingJob } from "@/lib/storage/data-store";
import { buildManualDeliveryNotes } from "@/lib/publish/manual-delivery-service";
import type { LegacyPublishPlatform, PublishingDraft, PublishingExecutionMode, PublishingJobRecord, PublishingJobStatus } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function resolveExecutionMode(platform: LegacyPublishPlatform): PublishingExecutionMode {
  return platform === "xiaohongshu" || platform === "douyin" ? "extension_automation" : "manual_delivery";
}

function resolveInitialStatus(platform: LegacyPublishPlatform): PublishingJobStatus {
  void platform;
  return "queued";
}

export async function createPublishingJob(input: {
  taskId: string;
  draftId: string;
  accountId?: string;
}) {
  const draft = await getPublishingDraft(input.draftId);
  if (!draft) {
    throw new Error("草稿不存在");
  }

  const account = input.accountId ? await getPlatformAccount(input.accountId) : null;
  const job: PublishingJobRecord = {
    id: createRecordId(),
    taskId: input.taskId,
    platform: draft.platform,
    accountId: account?.id,
    accountName: account?.displayName ?? account?.accountName,
    executionMode: resolveExecutionMode(draft.platform),
    status: resolveInitialStatus(draft.platform),
    draftTitle: draft.title,
    draftBody: draft.body,
    draftTags: draft.tags,
    draftImages: draft.imageUrls,
    publishEntryUrl: draft.publishEntryUrl,
    notes: buildManualDeliveryNotes({
      id: "",
      taskId: input.taskId,
      platform: draft.platform,
      executionMode: resolveExecutionMode(draft.platform),
      status: "queued",
      draftTitle: draft.title,
      draftBody: draft.body,
      draftTags: draft.tags,
      draftImages: draft.imageUrls,
      publishEntryUrl: draft.publishEntryUrl,
      createdAt: now(),
      updatedAt: now(),
    }),
    createdAt: now(),
    updatedAt: now(),
  };
  return savePublishingJob(job);
}

export async function updatePublishingJobRecord(jobId: string, patch: Partial<PublishingJobRecord>) {
  const current = await getPublishingJob(jobId);
  if (!current) {
    throw new Error("发布任务不存在");
  }
  const next: PublishingJobRecord = {
    ...current,
    ...patch,
    updatedAt: now(),
  };
  return savePublishingJob(next);
}

export async function recordPublishingJobResult(input: {
  jobId: string;
  publishUrl?: string;
  draftUrl?: string;
  verificationUrl?: string;
  notes?: string;
  status: Extract<PublishingJobStatus, "published" | "failed" | "manual_pending" | "running" | "queued" | "submitted" | "verifying" | "pending_review" | "verification_failed">;
  externalStatus?: string;
  executionLog?: string[];
  verificationEvidence?: string;
  verificationAttempts?: number;
  platformItemId?: string;
  failureStage?: string;
  errorMessage?: string;
}) {
  return updatePublishingJobRecord(input.jobId, {
    publishUrl: input.publishUrl,
    draftUrl: input.draftUrl,
    verificationUrl: input.verificationUrl,
    notes: input.notes,
    status: input.status,
    externalStatus: input.externalStatus,
    executionLog: input.executionLog,
    verificationEvidence: input.verificationEvidence,
    verificationAttempts: input.verificationAttempts,
    platformItemId: input.platformItemId,
    failureStage: input.failureStage,
    errorMessage: input.errorMessage,
    startedAt: input.status === "running" ? now() : undefined,
    submittedAt: input.status === "submitted" ? now() : undefined,
    verifiedAt: input.status === "published" ? now() : undefined,
    finishedAt: input.status === "published" || input.status === "failed" ? now() : undefined,
    publishedAt: input.status === "published" ? now() : undefined,
  });
}

export async function listTaskPublishingJobs(taskId: string) {
  const jobs = await getPublishingJobsByTask(taskId);
  return jobs.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export async function getDraftForJob(job: PublishingJobRecord): Promise<PublishingDraft | null> {
  const drafts = await getPublishingJobsByTask(job.taskId);
  void drafts;
  return null;
}
