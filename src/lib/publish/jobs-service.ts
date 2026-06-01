import { createRecordId, getPlatformAccount, getPublishingDraft, getPublishingJob, getPublishingJobsByTask, savePublishingJob } from "@/lib/storage/data-store";
import { updatePlatformAccountRecord } from "@/lib/publish/accounts-service";
import { buildManualDeliveryNotes } from "@/lib/publish/manual-delivery-service";
import type { PublishPlatform, PublishingDraft, PublishingExecutionMode, PublishingJobRecord, PublishingJobStatus } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function resolveExecutionMode(_platform: PublishPlatform): PublishingExecutionMode {
  return "electron_automation";
}

function resolveInitialStatus(_platform: PublishPlatform): PublishingJobStatus {
  return "queued";
}

async function syncAccountPublishSnapshot(job: PublishingJobRecord, status: PublishingJobStatus, errorMessage?: string) {
  if (!job.accountId) {
    return;
  }
  if (status === "published") {
    await updatePlatformAccountRecord(job.accountId, {
      lastPublishCompletedAt: now(),
      lastPublishError: undefined,
    });
    return;
  }
  if (status === "failed") {
    await updatePlatformAccountRecord(job.accountId, {
      lastPublishError: errorMessage ?? "最近一次发布失败",
    });
  }
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
    draftImagePaths: draft.localImagePaths,
    publishMode: draft.publishMode ?? "text_only",
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
      draftImagePaths: draft.localImagePaths,
      publishMode: draft.publishMode ?? "text_only",
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
  const submittedStatuses: PublishingJobStatus[] = ["submitted", "verifying", "pending_review", "verification_failed", "published"];
  const finishedStatuses: PublishingJobStatus[] = ["published", "failed"];
  const patch: Partial<PublishingJobRecord> = {
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
  };

  if (input.status === "running") {
    patch.startedAt = now();
  }

  if (submittedStatuses.includes(input.status)) {
    patch.submittedAt = now();
  }

  if (input.status === "published" || input.status === "verification_failed") {
    patch.verifiedAt = now();
  }

  if (finishedStatuses.includes(input.status)) {
    patch.finishedAt = now();
  }

  if (input.status === "published") {
    patch.publishedAt = now();
  }
  const nextJob = await updatePublishingJobRecord(input.jobId, patch);
  await syncAccountPublishSnapshot(nextJob, input.status, input.errorMessage);
  return nextJob;
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
