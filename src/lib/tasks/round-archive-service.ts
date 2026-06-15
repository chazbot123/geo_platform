import {
  createRecordId,
  getAccountPublishingDraftsByTask,
  getContent,
  getContentPool,
  getProduct,
  getPublishingDraftsByTask,
  getPublishingJobsByTask,
  getTask,
  getTheme,
  saveAccountPublishingDraft,
  saveContent,
  saveContentPool,
  saveProduct,
  savePublishingDraft,
  savePublishingJob,
  saveTask,
  saveTheme,
} from "@/lib/storage/data-store";
import type {
  AccountPublishingDraft,
  ContentDraft,
  ContentPoolItem,
  ContentPoolRecord,
  ProductProfile,
  PublishingDraft,
  PublishingJobRecord,
  TaskRecord,
  ThemeSet,
} from "@/lib/types";

export const WORKBENCH_TASK_ID = "customer-workbench-task";

export interface ArchiveWorkbenchRoundOptions {
  reason: "before_keyword_regeneration" | "manual_archive";
}

export interface ArchiveWorkbenchRoundResult {
  archivedTaskId: string;
  sourceTaskId: string;
  reason: ArchiveWorkbenchRoundOptions["reason"];
}

function hasRoundValue(theme: ThemeSet | null, contentPool: ContentPoolRecord | null, jobs: PublishingJobRecord[]) {
  return Boolean(
    (theme?.selectedKeywords?.length ?? 0) > 0 ||
      (contentPool?.items.length ?? 0) > 0 ||
      jobs.length > 0,
  );
}

function buildArchiveTaskId() {
  const compactTime = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `geo-round-${compactTime}-${createRecordId().slice(0, 8)}`;
}

function archiveProduct(product: ProductProfile, archivedTaskId: string, timestamp: string): ProductProfile {
  return {
    ...product,
    id: `${archivedTaskId}-product`,
    taskId: archivedTaskId,
  };
}

function archivePublishPlan(plan: NonNullable<TaskRecord["publishPlan"]>, archivedTaskId: string, timestamp: string) {
  return {
    ...plan,
    taskId: archivedTaskId,
    enterpriseTaskId: archivedTaskId,
    keywordTaskId: archivedTaskId,
    createdAt: plan.createdAt,
    updatedAt: timestamp,
  };
}

function archiveTask(task: TaskRecord, archivedTaskId: string, archivedProductId: string, timestamp: string): TaskRecord {
  return {
    ...task,
    id: archivedTaskId,
    productId: archivedProductId,
    publishPlan: task.publishPlan ? archivePublishPlan(task.publishPlan, archivedTaskId, timestamp) : undefined,
    createdAt: task.createdAt,
    updatedAt: timestamp,
  };
}

function archiveTheme(theme: ThemeSet, archivedTaskId: string, timestamp: string): ThemeSet {
  return {
    ...theme,
    taskId: archivedTaskId,
    updatedAt: timestamp,
  };
}

function archiveContent(content: ContentDraft, archivedTaskId: string, timestamp: string): ContentDraft {
  return {
    ...content,
    taskId: archivedTaskId,
    updatedAt: timestamp,
  };
}

function archiveContentItem(item: ContentPoolItem, archivedTaskId: string): ContentPoolItem {
  const nextId = `${archivedTaskId}-${String(item.sequence).padStart(4, "0")}`;
  return {
    ...item,
    id: nextId,
    taskId: archivedTaskId,
  };
}

function archiveContentPool(record: ContentPoolRecord, archivedTaskId: string, timestamp: string): ContentPoolRecord {
  return {
    ...record,
    taskId: archivedTaskId,
    currentTaskId: archivedTaskId,
    items: record.items.map((item) => archiveContentItem(item, archivedTaskId)),
    updatedAt: timestamp,
  };
}

function archivePublishingDraft(draft: PublishingDraft, archivedTaskId: string, timestamp: string): PublishingDraft {
  return {
    ...draft,
    id: `${archivedTaskId}-draft-${createRecordId().slice(0, 8)}`,
    taskId: archivedTaskId,
    updatedAt: timestamp,
  };
}

function archiveAccountPublishingDraft(draft: AccountPublishingDraft, archivedTaskId: string, timestamp: string): AccountPublishingDraft {
  return {
    ...draft,
    id: `${archivedTaskId}-account-draft-${createRecordId().slice(0, 8)}`,
    taskId: archivedTaskId,
    sourceContentTaskId: draft.sourceContentTaskId === WORKBENCH_TASK_ID ? archivedTaskId : draft.sourceContentTaskId,
    updatedAt: timestamp,
  };
}

function archivePublishingJob(job: PublishingJobRecord, archivedTaskId: string, timestamp: string): PublishingJobRecord {
  const contentPoolItemId = job.contentSequence
    ? `${archivedTaskId}-${String(job.contentSequence).padStart(4, "0")}`
    : job.contentPoolItemId?.replace(WORKBENCH_TASK_ID, archivedTaskId);
  return {
    ...job,
    id: `${archivedTaskId}-job-${createRecordId().slice(0, 8)}`,
    taskId: archivedTaskId,
    contentPoolItemId,
    resumeKey: job.resumeKey?.split(WORKBENCH_TASK_ID).join(archivedTaskId),
    updatedAt: timestamp,
  };
}

export async function archiveCurrentWorkbenchRound(
  options: ArchiveWorkbenchRoundOptions,
): Promise<ArchiveWorkbenchRoundResult | null> {
  const [task, theme, contentPool, jobs] = await Promise.all([
    getTask(WORKBENCH_TASK_ID),
    getTheme(WORKBENCH_TASK_ID),
    getContentPool(WORKBENCH_TASK_ID),
    getPublishingJobsByTask(WORKBENCH_TASK_ID),
  ]);

  if (!task || !theme || !hasRoundValue(theme, contentPool, jobs)) {
    return null;
  }

  const product = await getProduct(task.productId);
  if (!product) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const archivedTaskId = buildArchiveTaskId();
  const archivedProduct = archiveProduct(product, archivedTaskId, timestamp);
  const [content, publishingDrafts, accountPublishingDrafts] = await Promise.all([
    getContent(WORKBENCH_TASK_ID),
    getPublishingDraftsByTask(WORKBENCH_TASK_ID),
    getAccountPublishingDraftsByTask(WORKBENCH_TASK_ID),
  ]);

  await saveProduct(archivedProduct);
  await saveTask(archiveTask(task, archivedTaskId, archivedProduct.id, timestamp));
  await saveTheme(archiveTheme(theme, archivedTaskId, timestamp));

  if (content) {
    await saveContent(archiveContent(content, archivedTaskId, timestamp));
  }
  if (contentPool) {
    await saveContentPool(archiveContentPool(contentPool, archivedTaskId, timestamp));
  }
  await Promise.all(publishingDrafts.map((draft) => savePublishingDraft(archivePublishingDraft(draft, archivedTaskId, timestamp))));
  await Promise.all(
    accountPublishingDrafts.map((draft) => saveAccountPublishingDraft(archiveAccountPublishingDraft(draft, archivedTaskId, timestamp))),
  );
  await Promise.all(jobs.map((job) => savePublishingJob(archivePublishingJob(job, archivedTaskId, timestamp))));

  return {
    archivedTaskId,
    sourceTaskId: WORKBENCH_TASK_ID,
    reason: options.reason,
  };
}
