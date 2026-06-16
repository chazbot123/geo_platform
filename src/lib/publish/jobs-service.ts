import {
  createRecordId,
  getAccountPublishingDraft,
  getContent,
  getContentPool,
  getPlatformAccount,
  getPublishingDraft,
  getPublishingJob,
  getPublishingJobsByTask,
  getTask,
  saveContentPool,
  savePublishingJob,
} from "@/lib/storage/data-store";
import { updatePlatformAccountRecord } from "@/lib/publish/accounts-service";
import { buildManualDeliveryNotes } from "@/lib/publish/manual-delivery-service";
import { getPlatformDescriptor } from "@/lib/publish/platforms";
import { normalizeDouyinTags, normalizeXiaohongshuTags, validateDraftForPlatform } from "@/lib/publish/draft-builders";
import { normalizePlatformTopicTags } from "@/lib/content/platform-content-rules";
import { resolvePublishImagePaths } from "@/lib/publish/publish-image-resolver";
import type { ContentPoolItemStatus, ContentPoolRecord, PublishPlatform, PublishingDraft, PublishingExecutionMode, PublishingJobRecord, PublishingJobStatus } from "@/lib/types";
import type { ContentPoolItem } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function parseTimeValue(value: string) {
  const [hours, minutes] = value.split(":").map((item) => Number.parseInt(item, 10));
  return hours * 60 + minutes;
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function buildDailyRepairTime(createdAt: string, timeWindow: { start: string; end: string }, dayIndex: number, accountSeed: number) {
  const startMinutes = parseTimeValue(timeWindow.start);
  const endMinutes = parseTimeValue(timeWindow.end);
  const totalWindowMinutes = Math.max(endMinutes - startMinutes, 0);
  const offset = totalWindowMinutes > 0 ? Math.floor(seededUnit(accountSeed * 101 + dayIndex * 17) * (totalWindowMinutes + 1)) : 0;
  const planned = new Date(createdAt);
  planned.setDate(planned.getDate() + dayIndex);
  planned.setHours(Math.floor((startMinutes + offset) / 60), (startMinutes + offset) % 60, 0, 0);
  return planned.toISOString();
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

function summarizeContentPool(record: ContentPoolRecord): ContentPoolRecord {
  const generatedStatuses = new Set<ContentPoolItemStatus>([
    "ready",
    "sample",
    "pending_publish",
    "publishing",
    "submitted",
    "pending_review",
    "manual_pending",
    "published",
  ]);
  return {
    ...record,
    totalArticleCount: record.items.length,
    generatedArticleCount: record.items.filter((item) => generatedStatuses.has(item.status)).length,
    generatingArticleCount: record.items.filter((item) => item.status === "generating").length,
    failedArticleCount: record.items.filter((item) => item.status === "failed").length,
    pendingPublishArticleCount: record.items.filter((item) => item.status === "pending_publish").length,
  };
}

function statusFromPublishingJob(job: PublishingJobRecord): ContentPoolItemStatus | null {
  if (job.status === "published") {
    return "published";
  }
  if (job.status === "submitted" || job.status === "pending_review") {
    return job.status;
  }
  if (job.status === "running" || job.status === "verifying") {
    return "publishing";
  }
  if (job.status === "manual_pending" || job.status === "verification_failed") {
    return "manual_pending";
  }
  if (job.status === "failed") {
    return "manual_pending";
  }
  if (job.status === "queued") {
    return "pending_publish";
  }
  return null;
}

function displayStatusFromContentStatus(status: ContentPoolItemStatus): ContentPoolItem["displayStatus"] | undefined {
  if (status === "manual_pending") return "pending_publish";
  if (status === "sample") return "ready";
  if (status === "pending_generation") return "pending";
  return status;
}

function getPublishingJobStatusLabel(status: PublishingJobStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "submitted":
      return "已提交";
    case "verifying":
      return "核验中";
    case "pending_review":
      return "平台审核中";
    case "verification_failed":
      return "待人工确认";
    case "manual_pending":
      return "待人工处理";
    case "published":
      return "已发布";
    case "failed":
      return "发布失败";
    default:
      return status;
  }
}

function getPublishStageMessage(status: ContentPoolItemStatus, fallback?: string): string | undefined {
  if (status === "published") return "发布已完成。";
  if (status === "publishing") return "正在发布中。";
  if (status === "submitted") return "已提交，等待平台确认。";
  if (status === "pending_review") return "平台审核中，等待结果确认。";
  if (status === "manual_pending") return "需要人工处理。";
  return fallback;
}

function buildPublishingJobStageLog(jobId: string, status: PublishingJobStatus): string {
  return `发布任务 ${jobId} 状态已更新为${getPublishingJobStatusLabel(status)}。`;
}

function buildPublishingJobReconcileLog(jobId: string, status: PublishingJobStatus): string {
  return `已根据发布任务 ${jobId} 的最新状态同步为${getPublishingJobStatusLabel(status)}。`;
}

function hasGeneratedContent(item: ContentPoolItem) {
  return Boolean(item.title?.trim() && item.body?.trim());
}

function isPublishingJobForContentItem(job: PublishingJobRecord, item: ContentPoolItem) {
  if (job.contentPoolItemId !== item.id) return false;
  if (job.platform !== item.publishPlatform) return false;
  if (job.accountId && job.accountId !== item.accountId) return false;
  if (typeof job.contentSequence === "number" && job.contentSequence !== item.sequence) return false;
  if (job.plannedPublishTime && item.plannedPublishTime && job.plannedPublishTime !== item.plannedPublishTime) return false;
  return true;
}

function canSyncPublishingJobToContentItem(job: PublishingJobRecord, item: ContentPoolItem) {
  if (!isPublishingJobForContentItem(job, item)) return false;
  if (!hasGeneratedContent(item)) return false;
  return true;
}

function buildContentPoolDraftTags(item: ContentPoolItem) {
  const sourceTags = item.topicTags?.length
    ? item.topicTags
    : normalizePlatformTopicTags([item.keywordText], item.publishPlatform);
  if (item.publishPlatform === "xiaohongshu") {
    return normalizeXiaohongshuTags(sourceTags);
  }
  if (item.publishPlatform === "douyin") {
    return normalizeDouyinTags(sourceTags);
  }
  return sourceTags.filter(Boolean);
}

async function syncContentPoolPublishSnapshot(job: PublishingJobRecord) {
  if (!job.contentPoolItemId) {
    return null;
  }

  const status = statusFromPublishingJob(job);
  if (!status) {
    return null;
  }

  const record = await getContentPool(job.taskId);
  if (!record) {
    return null;
  }

  const item = record.items.find((current) => current.id === job.contentPoolItemId);
  if (!item) {
    return null;
  }
  if (!canSyncPublishingJobToContentItem(job, item)) {
    const summarizedCurrent = summarizeContentPool(record);
    const summaryChanged =
      summarizedCurrent.totalArticleCount !== record.totalArticleCount ||
      summarizedCurrent.generatedArticleCount !== record.generatedArticleCount ||
      summarizedCurrent.generatingArticleCount !== record.generatingArticleCount ||
      summarizedCurrent.failedArticleCount !== record.failedArticleCount ||
      summarizedCurrent.pendingPublishArticleCount !== record.pendingPublishArticleCount;
    return summaryChanged ? saveContentPool(summarizedCurrent) : summarizedCurrent;
  }

  const summarizedCurrent = summarizeContentPool(record);
  const summaryChanged =
    summarizedCurrent.totalArticleCount !== record.totalArticleCount ||
    summarizedCurrent.generatedArticleCount !== record.generatedArticleCount ||
    summarizedCurrent.generatingArticleCount !== record.generatingArticleCount ||
    summarizedCurrent.failedArticleCount !== record.failedArticleCount ||
    summarizedCurrent.pendingPublishArticleCount !== record.pendingPublishArticleCount;

  if (item.status === status) {
    return summaryChanged ? saveContentPool(summarizedCurrent) : summarizedCurrent;
  }

  const timestamp = now();
  const nextRecord = summarizeContentPool({
    ...record,
    items: record.items.map((current) =>
      current.id === job.contentPoolItemId
        ? {
            ...current,
            status,
            displayStatus: displayStatusFromContentStatus(status),
            stageMessage: getPublishStageMessage(status, current.stageMessage),
            stageLog: [
              ...(current.stageLog ?? []),
              {
                stage: `publish_${job.status}`,
                message: buildPublishingJobStageLog(job.id, job.status),
                at: timestamp,
              },
            ],
            updatedAt: timestamp,
          }
        : current,
    ),
    updatedAt: timestamp,
  });
  return saveContentPool(nextRecord);
}

export async function reconcileContentPoolPublishingStatuses(taskId: string) {
  const [record, jobs] = await Promise.all([getContentPool(taskId), getPublishingJobsByTask(taskId)]);
  if (!record) {
    return null;
  }

  const latestJobsByItem = new Map<string, PublishingJobRecord>();
  for (const job of jobs) {
    if (!job.contentPoolItemId) continue;
    const current = latestJobsByItem.get(job.contentPoolItemId);
    if (!current || new Date(job.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
      latestJobsByItem.set(job.contentPoolItemId, job);
    }
  }

  let changed = false;
  const timestamp = now();
  const nextItems = record.items.map((item) => {
    const job = latestJobsByItem.get(item.id);
    if (!job) return item;
    const status = statusFromPublishingJob(job);
    if (!canSyncPublishingJobToContentItem(job, item)) return item;
    if (!status || item.status === status) return item;
    changed = true;
    return {
      ...item,
      status,
      displayStatus: displayStatusFromContentStatus(status),
      stageMessage: getPublishStageMessage(status, item.stageMessage),
      stageLog: [
        ...(item.stageLog ?? []),
        {
          stage: `publish_${job.status}`,
          message: buildPublishingJobReconcileLog(job.id, job.status),
          at: timestamp,
        },
      ],
      updatedAt: timestamp,
    };
  });

  const summarized = summarizeContentPool({
    ...record,
    items: nextItems,
    updatedAt: changed ? timestamp : record.updatedAt,
  });

  const summaryChanged =
    summarized.totalArticleCount !== record.totalArticleCount ||
    summarized.generatedArticleCount !== record.generatedArticleCount ||
    summarized.generatingArticleCount !== record.generatingArticleCount ||
    summarized.failedArticleCount !== record.failedArticleCount ||
    summarized.pendingPublishArticleCount !== record.pendingPublishArticleCount;

  return changed || summaryChanged ? saveContentPool(summarized) : summarized;
}

function canRepairPlannedPublishTime(job?: PublishingJobRecord) {
  if (!job) return false;
  if (job.plannedPublishTimeManualOverrideAt) return false;
  if (job.status !== "queued" && job.status !== "manual_pending" && job.status !== "drafted") return false;
  return !job.startedAt && !job.submittedAt && !job.finishedAt && !job.publishedAt;
}

function latestJobForItem(item: ContentPoolItem, jobs: PublishingJobRecord[]) {
  return jobs
    .filter((job) => job.contentPoolItemId === item.id)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
}

export async function reconcilePerAccountDailyPublishSchedule(taskId: string) {
  const [record, jobs, task] = await Promise.all([getContentPool(taskId), getPublishingJobsByTask(taskId), getTask(taskId)]);
  if (!record || record.items.length === 0) return record;
  const plan = task?.publishPlan;
  if (!plan || plan.articlesPerAccountPerDay !== 1) return record;

  const enabledItems = record.items
    .filter((item) => item.publishable && item.plannedPublishTime)
    .sort((left, right) => left.sequence - right.sequence);
  const duplicatePerAccountDay = enabledItems.some((item, index) =>
    enabledItems.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.accountId === item.accountId &&
        other.publishPlatform === item.publishPlatform &&
        other.plannedPublishTime.slice(0, 10) === item.plannedPublishTime.slice(0, 10),
    ),
  );
  if (!duplicatePerAccountDay) return record;

  const timestamp = now();
  let changed = false;
  const dayIndexByKey = new Map<string, number>();
  const baseTimeByKey = new Map<string, string>();
  const repairedTimesByItemId = new Map<string, string>();

  const nextItems = record.items.map((item) => {
    if (!item.publishable || !item.plannedPublishTime) return item;
    const job = latestJobForItem(item, jobs);
    const accountKey = `${item.publishPlatform}:${item.accountId}`;
    if (!baseTimeByKey.has(accountKey)) baseTimeByKey.set(accountKey, item.plannedPublishTime);
    const dayIndex = dayIndexByKey.get(accountKey) ?? 0;
    dayIndexByKey.set(accountKey, dayIndex + 1);
    if (item.plannedPublishTimeManualOverrideAt || job?.plannedPublishTimeManualOverrideAt) return item;
    const baseTime = baseTimeByKey.get(accountKey)!;
    const nextPlannedPublishTime = buildDailyRepairTime(baseTime, plan.timeWindow, dayIndex, item.accountKeywordOffset + 1);
    if (job && !canRepairPlannedPublishTime(job)) return item;

    if (nextPlannedPublishTime === item.plannedPublishTime) return item;
    changed = true;
    repairedTimesByItemId.set(item.id, nextPlannedPublishTime);
    return {
      ...item,
      plannedPublishTime: nextPlannedPublishTime,
      updatedAt: timestamp,
    };
  });

  if (!changed) return record;

  await Promise.all(
    jobs
      .filter((job) => job.contentPoolItemId && repairedTimesByItemId.has(job.contentPoolItemId) && canRepairPlannedPublishTime(job))
      .map((job) =>
        savePublishingJob({
          ...job,
          plannedPublishTime: repairedTimesByItemId.get(job.contentPoolItemId!)!,
          updatedAt: timestamp,
        }),
      ),
  );

  const nextRecord = summarizeContentPool({
    ...record,
    items: nextItems,
    updatedAt: timestamp,
  });
  return saveContentPool(nextRecord);
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
    .filter((job) => isPublishingJobForContentItem(job, input.item))
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
  const draftTags = buildContentPoolDraftTags(input.item);
  const draftBody = input.item.body;
  const validationErrors = validateDraftForPlatform(
    {
      title: input.item.title,
      body: draftBody,
      tags: draftTags,
      imageUrls,
      localImagePaths: resolvedImagePaths,
      publishMode: resolvedImagePaths.length ? "with_images" : "text_only",
      coverImageUrl: imageUrls[0],
    },
    input.item.publishPlatform,
  );
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.map((error) => error.message).join("；"));
  }
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
    draftBody,
    draftTags,
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
      draftBody,
      draftTags,
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
  const saved = await savePublishingJob(next);
  await syncContentPoolPublishSnapshot(saved);
  return saved;
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
