import {
  createRecordId,
  getAccountPublishingDraft,
  getContent,
  getPlatformAccount,
  getPublishingDraft,
  getPublishingJob,
  getPublishingJobsByTask,
  savePublishingJob,
} from "@/lib/storage/data-store";
import { updatePlatformAccountRecord } from "@/lib/publish/accounts-service";
import { buildManualDeliveryNotes } from "@/lib/publish/manual-delivery-service";
import { getPlatformDescriptor } from "@/lib/publish/platforms";
import { validateDraftForPlatform } from "@/lib/publish/draft-builders";
import { resolvePublishImagePaths } from "@/lib/publish/publish-image-resolver";
import type { PublishPlatform, PublishingDraft, PublishingExecutionMode, PublishingJobRecord, PublishingJobStatus } from "@/lib/types";
import type { ContentPoolItem } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function resolveExecutionMode(platform: PublishPlatform): PublishingExecutionMode {
  const descriptor = getPlatformDescriptor(platform);
  return descriptor?.executionMode ?? "manual_delivery";
}

function resolveInitialStatus(platform: PublishPlatform): PublishingJobStatus {
  const descriptor = getPlatformDescriptor(platform);
  if (!descriptor) return "manual_pending";
  return descriptor.automationStatus === "ready" ? "queued" : "manual_pending";
}

async function assertContentPackageReady(taskId: string) {
  const content = await getContent(taskId);
  const executionPackage = content?.geoExecutionPackage;
  if (!executionPackage || executionPackage.status === "passed") {
    return;
  }

  const firstIssue = executionPackage.blockingIssues[0] ?? "内容质检未通过";
  throw new Error(`内容执行包未通过生产发布门禁：${firstIssue}`);
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
  const validationErrors = validateDraftForPlatform(draft, draft.platform);
  if (validationErrors.length > 0) {
    throw new Error(`草稿不符合 ${draft.platform} 发布要求：${validationErrors.map((e) => e.message).join("；")}`);
  }
  await assertContentPackageReady(input.taskId);

  const account = input.accountId ? await getPlatformAccount(input.accountId) : null;
  const descriptor = getPlatformDescriptor(draft.platform);
  const resolvedImagePaths = await resolvePublishImagePaths({
    taskId: input.taskId,
    imageUrls: draft.imageUrls,
    localImagePaths: draft.localImagePaths,
  });
  const status = resolveInitialStatus(draft.platform);
  const job: PublishingJobRecord = {
    id: createRecordId(),
    taskId: input.taskId,
    platform: draft.platform,
    automationStatus: descriptor?.automationStatus ?? "planned",
    accountId: account?.id,
    accountName: account?.displayName ?? account?.accountName,
    executionMode: resolveExecutionMode(draft.platform),
    status,
    draftTitle: draft.title,
    draftBody: draft.body,
    draftTags: draft.tags,
    draftImages: draft.imageUrls,
    draftImagePaths: resolvedImagePaths,
    publishMode: resolvedImagePaths.length ? "with_images" : (draft.publishMode ?? "text_only"),
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
    queuedAt: status === "queued" ? now() : undefined,
    retryCount: 0,
    maxRetries: 3,
    createdAt: now(),
    updatedAt: now(),
  };
  return savePublishingJob(job);
}

export async function createAccountPublishingJob(input: {
  taskId: string;
  accountPublishingDraftId: string;
}) {
  const draft = await getAccountPublishingDraft(input.accountPublishingDraftId);
  if (!draft) {
    throw new Error("账号发布稿不存在");
  }
  const validationErrors = validateDraftForPlatform(draft, draft.platform);
  if (validationErrors.length > 0) {
    throw new Error(`账号发布稿不符合 ${draft.platform} 发布要求：${validationErrors.map((e) => e.message).join("；")}`);
  }
  await assertContentPackageReady(input.taskId);

  const account = await getPlatformAccount(draft.accountId);
  const descriptor = getPlatformDescriptor(draft.platform);
  const resolvedImagePaths = await resolvePublishImagePaths({
    taskId: input.taskId,
    imageUrls: draft.imageUrls,
    localImagePaths: draft.localImagePaths,
  });

  if (descriptor?.automationStatus === "ready" && !account) {
    throw new Error("自动化发布需要关联账号，但未找到有效账号");
  }
  const job: PublishingJobRecord = {
    id: createRecordId(),
    taskId: input.taskId,
    platform: draft.platform,
    accountPublishingDraftId: draft.id,
    sourceSearchProvider: draft.searchProvider,
    automationStatus: descriptor?.automationStatus ?? "planned",
    accountId: account?.id ?? draft.accountId,
    accountName: account?.displayName ?? account?.accountName ?? draft.accountName,
    executionMode: descriptor?.executionMode ?? resolveExecutionMode(draft.platform),
    status: descriptor?.automationStatus === "ready" ? "queued" : "manual_pending",
    draftTitle: draft.title,
    draftBody: draft.body,
    draftTags: draft.tags,
    draftImages: draft.imageUrls,
    draftImagePaths: resolvedImagePaths,
    publishMode: resolvedImagePaths.length ? "with_images" : (draft.publishMode ?? "text_only"),
    publishEntryUrl: draft.publishEntryUrl ?? descriptor?.publishEntryUrl,
    notes: buildManualDeliveryNotes({
      id: "",
      taskId: input.taskId,
      platform: draft.platform,
      executionMode: descriptor?.executionMode ?? resolveExecutionMode(draft.platform),
      status: descriptor?.automationStatus === "ready" ? "queued" : "manual_pending",
      draftTitle: draft.title,
      draftBody: draft.body,
      draftTags: draft.tags,
      draftImages: draft.imageUrls,
      draftImagePaths: draft.localImagePaths,
      publishMode: draft.publishMode ?? "text_only",
      publishEntryUrl: draft.publishEntryUrl ?? descriptor?.publishEntryUrl,
      createdAt: now(),
      updatedAt: now(),
    }),
    queuedAt: descriptor?.automationStatus === "ready" ? now() : undefined,
    retryCount: 0,
    maxRetries: 3,
    createdAt: now(),
    updatedAt: now(),
  };
  return savePublishingJob(job);
}

export async function createContentPoolPublishingJob(input: {
  item: ContentPoolItem;
}): Promise<PublishingJobRecord> {
  const existingJobs = await getPublishingJobsByTask(input.item.taskId);
  const existing = existingJobs
    .filter((job) => job.contentPoolItemId === input.item.id)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];

  if (existing && existing.status !== "failed") {
    return existing;
  }

  if (!input.item.publishable) {
    throw new Error("当前文章还未通过风险检查，不能进入发布。");
  }

  const descriptor = getPlatformDescriptor(input.item.publishPlatform);
  const account = await getPlatformAccount(input.item.accountId);
  const imageUrls = input.item.imageList.map((image) => image.url).filter((url): url is string => Boolean(url));
  const imagePaths = input.item.imageList.map((image) => image.localPath).filter((localPath): localPath is string => Boolean(localPath));
  const resolvedImagePaths = await resolvePublishImagePaths({
    taskId: input.item.taskId,
    imageUrls,
    localImagePaths: imagePaths,
  });

  const status = descriptor?.automationStatus === "ready" ? "queued" : "manual_pending";
  const job: PublishingJobRecord = {
    id: createRecordId(),
    taskId: input.item.taskId,
    platform: input.item.publishPlatform,
    contentPoolItemId: input.item.id,
    contentSequence: input.item.sequence,
    plannedPublishTime: input.item.plannedPublishTime,
    keywordText: input.item.keywordText,
    sourceSearchProvider: input.item.aiPlatform,
    automationStatus: descriptor?.automationStatus ?? "planned",
    accountId: account?.id ?? input.item.accountId,
    accountName: account?.displayName ?? account?.accountName ?? input.item.accountName,
    executionMode: descriptor?.executionMode ?? resolveExecutionMode(input.item.publishPlatform),
    status,
    draftTitle: input.item.title,
    draftBody: input.item.body,
    draftTags: [input.item.keywordText].filter(Boolean),
    draftImages: imageUrls,
    draftImagePaths: resolvedImagePaths,
    publishMode: resolvedImagePaths.length ? "with_images" : "text_only",
    publishEntryUrl: descriptor?.publishEntryUrl,
    notes: buildManualDeliveryNotes({
      id: "",
      taskId: input.item.taskId,
      platform: input.item.publishPlatform,
      executionMode: descriptor?.executionMode ?? resolveExecutionMode(input.item.publishPlatform),
      status,
      draftTitle: input.item.title,
      draftBody: input.item.body,
      draftTags: [input.item.keywordText].filter(Boolean),
      draftImages: imageUrls,
      draftImagePaths: imagePaths,
      publishMode: resolvedImagePaths.length ? "with_images" : "text_only",
      publishEntryUrl: descriptor?.publishEntryUrl,
      createdAt: now(),
      updatedAt: now(),
    }),
    executionStage: status,
    resumeKey: `${input.item.taskId}:${input.item.publishPlatform}:${input.item.accountId}:${input.item.id}`,
    lastExecutionAt: now(),
    queuedAt: status === "queued" ? now() : undefined,
    retryCount: 0,
    maxRetries: 3,
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

export async function transitionJobToRunning(jobId: string): Promise<PublishingJobRecord> {
  return updatePublishingJobRecord(jobId, { status: "running", startedAt: now() });
}

export async function transitionJobToSubmitted(jobId: string, opts?: { draftUrl?: string; platformItemId?: string }): Promise<PublishingJobRecord> {
  return updatePublishingJobRecord(jobId, {
    status: "submitted",
    submittedAt: now(),
    draftUrl: opts?.draftUrl,
    platformItemId: opts?.platformItemId,
  });
}

export async function transitionJobToPublished(
  jobId: string,
  opts: { publishUrl?: string; verificationEvidence?: string; platformItemId?: string },
): Promise<PublishingJobRecord> {
  const job = await updatePublishingJobRecord(jobId, {
    status: "published",
    publishUrl: opts.publishUrl,
    verificationEvidence: opts.verificationEvidence,
    platformItemId: opts.platformItemId ?? undefined,
    verifiedAt: now(),
    finishedAt: now(),
    publishedAt: now(),
  });
  await syncAccountPublishSnapshot(job, "published");
  return job;
}

export async function transitionJobToFailed(
  jobId: string,
  opts: { failureStage?: string; errorMessage?: string; executionLog?: string[] },
): Promise<PublishingJobRecord> {
  const job = await updatePublishingJobRecord(jobId, {
    status: "failed",
    failureStage: opts.failureStage,
    errorMessage: opts.errorMessage,
    executionLog: opts.executionLog,
    finishedAt: now(),
  });
  await syncAccountPublishSnapshot(job, "failed", opts.errorMessage);
  return job;
}

export async function transitionJobToManualPending(jobId: string, notes?: string): Promise<PublishingJobRecord> {
  return updatePublishingJobRecord(jobId, { status: "manual_pending", notes });
}

export async function recordPublishingJobResult(input: {
  jobId: string;
  publishUrl?: string;
  draftUrl?: string;
  verificationUrl?: string;
  sessionToken?: string;
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
    sessionToken: input.sessionToken,
    notes: input.notes,
    status: input.status,
    externalStatus: input.externalStatus,
    executionLog: input.executionLog,
    verificationEvidence: input.verificationEvidence,
    verificationAttempts: input.verificationAttempts,
    platformItemId: input.platformItemId,
    failureStage: input.failureStage,
    errorMessage: input.errorMessage,
    executionStage: input.failureStage ?? input.status,
    lastExecutionAt: now(),
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
  if (job.accountPublishingDraftId) {
    const accountDraft = await getAccountPublishingDraft(job.accountPublishingDraftId);
    if (accountDraft) {
      return {
        id: accountDraft.id,
        taskId: accountDraft.taskId,
        platform: accountDraft.platform,
        title: accountDraft.title,
        body: accountDraft.body,
        tags: accountDraft.tags,
        coverImageUrl: accountDraft.coverImageUrl,
        imageUrls: accountDraft.imageUrls,
        localImagePaths: accountDraft.localImagePaths,
        publishMode: accountDraft.publishMode,
        publishEntryUrl: accountDraft.publishEntryUrl,
        accountId: accountDraft.accountId,
        updatedAt: accountDraft.updatedAt,
      };
    }
  }

  // Look up by the draft fields snapshotted on the job itself — the job stores title/body/tags
  // at creation time, so fall back to reconstructing a minimal draft shape from the job record.
  const directDraft = await getPublishingDraft(job.id);
  if (directDraft) return directDraft;

  // Reconstruct from the snapshot stored in the job record so callers always get a usable draft.
  if (job.draftTitle || job.draftBody) {
    return {
      id: job.id,
      taskId: job.taskId,
      platform: job.platform,
      title: job.draftTitle ?? "",
      body: job.draftBody ?? "",
      tags: job.draftTags ?? [],
      imageUrls: job.draftImages ?? [],
      localImagePaths: job.draftImagePaths ?? [],
      publishMode: job.publishMode ?? "text_only",
      publishEntryUrl: job.publishEntryUrl,
      accountId: job.accountId,
      updatedAt: job.updatedAt,
    };
  }

  return null;
}
