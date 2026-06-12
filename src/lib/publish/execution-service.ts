import { getCurrentContentPool } from "@/lib/content/service";
import {
  getContentPool,
  getPublishingJobsByTask,
  saveContentPool,
} from "@/lib/storage/data-store";
import { createContentPoolPublishingJob, recordPublishingJobResult } from "@/lib/publish/jobs-service";
import { getPlatformDescriptor, publishPlatformDescriptors } from "@/lib/publish/platforms";
import { runDuePublishingJob } from "@/lib/publish/publish-queue-service";
import type {
  ContentPoolItem,
  ContentPoolItemStatus,
  ContentPoolRecord,
  PublishingJobRecord,
} from "@/lib/types";

const activeStatuses = new Set<PublishingJobRecord["status"]>([
  "queued",
  "running",
  "verifying",
]);

function now() {
  return new Date().toISOString();
}

function isJobForArticle(job: PublishingJobRecord, item: ContentPoolItem) {
  if (job.contentPoolItemId !== item.id) return false;
  if (job.platform !== item.publishPlatform) return false;
  if (job.accountId && job.accountId !== item.accountId) return false;
  if (typeof job.contentSequence === "number" && job.contentSequence !== item.sequence) return false;
  if (job.plannedPublishTime && item.plannedPublishTime && job.plannedPublishTime !== item.plannedPublishTime) return false;
  return true;
}

function latestJobByArticle(items: ContentPoolItem[], jobs: PublishingJobRecord[]) {
  const map = new Map<string, PublishingJobRecord>();
  for (const item of items) {
    const matchedJobs = jobs.filter((job) => isJobForArticle(job, item));
    for (const job of matchedJobs) {
      const current = map.get(item.id);
      if (!current || new Date(job.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
        map.set(item.id, job);
      }
    }
  }
  return map;
}

function platformLabel(platform: string) {
  return publishPlatformDescriptors.find((item) => item.key === platform)?.label ?? platform;
}

function stageFromJob(job?: PublishingJobRecord) {
  if (!job) return "pending";
  if (isMaterialIssue(job)) return "missing_images";
  return job.executionStage ?? job.failureStage ?? job.status;
}

function isPublished(item: ContentPoolItem, job?: PublishingJobRecord) {
  return job?.status === "published" || job?.status === "submitted" || job?.status === "pending_review";
}

function isManualPending(item: ContentPoolItem, job?: PublishingJobRecord) {
  return job?.status === "manual_pending" || job?.status === "verification_failed";
}

function isMaterialIssue(job?: PublishingJobRecord) {
  const text = [
    job?.failureStage,
    job?.errorMessage,
    job?.verificationEvidence,
    ...(job?.executionLog ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(prepare_images|upload_images|图片|image|素材|未提供|missing_images|without images)/i.test(text);
}

function canAutoRun(item: ContentPoolItem, job?: PublishingJobRecord) {
  if (!item.publishable) return false;
  if (job?.status === "manual_pending" && isMaterialIssue(job)) return true;
  if (isPublished(item, job) || isManualPending(item, job)) return false;
  if (!job) return true;
  return job.status === "queued" || job.status === "failed";
}

async function updateContentPoolItem(taskId: string, itemId: string, patch: Partial<ContentPoolItem>) {
  const record = await getContentPool(taskId);
  if (!record) return null;
  const timestamp = now();
  const next: ContentPoolRecord = {
    ...record,
    items: record.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...patch,
            updatedAt: timestamp,
          }
        : item,
    ),
    updatedAt: timestamp,
  };
  return saveContentPool(summarizeContentPool(next));
}

function summarizeContentPool(record: ContentPoolRecord): ContentPoolRecord {
  const generatedStatuses = new Set<ContentPoolItemStatus>([
    "ready",
    "sample",
    "pending_publish",
    "publishing",
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

async function markContentStatus(job: PublishingJobRecord, status: ContentPoolItemStatus) {
  if (!job.contentPoolItemId) return null;
  const record = await getContentPool(job.taskId);
  const item = record?.items.find((current) => current.id === job.contentPoolItemId);
  if (!item || !isJobForArticle(job, item)) return null;
  return updateContentPoolItem(job.taskId, job.contentPoolItemId, { status });
}

function buildManualNotes(job: PublishingJobRecord) {
  const descriptor = getPlatformDescriptor(job.platform);
  return [
    `${platformLabel(job.platform)} 自动发布未完成，当前文章已转为手动待处理。`,
    job.accountName ? `账号：${job.accountName}` : "",
    descriptor?.publishEntryUrl ? `创作入口：${descriptor.publishEntryUrl}` : "",
    "系统保留标题、正文、标签和图片；进入创作页后请检查内容，最后发布按钮由人工点击。",
  ]
    .filter(Boolean)
    .join("\n");
}

function chooseCurrentArticle(items: ContentPoolItem[], jobsByItem: Map<string, PublishingJobRecord>) {
  const active = items.find((item) => {
    const job = jobsByItem.get(item.id);
    return job ? activeStatuses.has(job.status) : false;
  });
  if (active) return active;
  return items.find((item) => canAutoRun(item, jobsByItem.get(item.id))) ?? null;
}

export async function getPublishExecutionState() {
  const { current } = await getCurrentContentPool();
  if (!current) {
    return {
      current: null,
      articles: [],
      stats: { total: 0, published: 0, remaining: 0, manualPending: 0, publishable: 0 },
      currentArticle: null,
      latestExecutionTime: null,
    };
  }

  const items = current.items.sort((left, right) => left.sequence - right.sequence);
  const jobs = await getPublishingJobsByTask(current.taskId);
  const jobsByItem = latestJobByArticle(items, jobs);
  const articles = items.map((item) => {
    const job = jobsByItem.get(item.id);
    return {
      item,
      job,
      stage: stageFromJob(job),
      published: isPublished(item, job),
      manualPending: isManualPending(item, job),
      canRun: canAutoRun(item, job),
    };
  });
  const latestJob = jobs
    .filter((job) => items.some((item) => isJobForArticle(job, item)))
    .sort((left, right) => new Date(right.lastExecutionAt ?? right.updatedAt).getTime() - new Date(left.lastExecutionAt ?? left.updatedAt).getTime())[0];
  const currentItem = chooseCurrentArticle(items, jobsByItem);
  const currentArticle = currentItem
    ? articles.find((article) => article.item.id === currentItem.id) ?? null
    : null;

  return {
    current,
    articles,
    stats: {
      total: items.length,
      published: articles.filter((article) => article.published).length,
      remaining: articles.filter((article) => !article.published).length,
      manualPending: articles.filter((article) => article.manualPending).length,
      publishable: articles.filter((article) => article.item.publishable).length,
    },
    currentArticle,
    latestExecutionTime: latestJob?.lastExecutionAt ?? latestJob?.updatedAt ?? null,
  };
}

export async function runNextPublishArticle() {
  const state = await getPublishExecutionState();
  if (!state.current || !state.currentArticle) {
    return state;
  }

  const item = state.currentArticle.item;
  let job = state.currentArticle.job ?? (await createContentPoolPublishingJob({ item }));

  if (job.status === "manual_pending" && !isMaterialIssue(job)) {
    await markContentStatus(job, "manual_pending");
    return getPublishExecutionState();
  }

  if (job.status === "manual_pending" && isMaterialIssue(job)) {
    job = await recordPublishingJobResult({
      jobId: job.id,
      status: "queued",
      notes: "素材问题已允许重新执行，系统将重新解析本地生成图片后继续发布。",
      executionLog: job.executionLog,
    });
  }

  await markContentStatus(job, "publishing");

  if (job.status === "queued" && job.executionMode === "electron_automation" && job.accountId) {
    job = await runDuePublishingJob(job.id);
  }

  if (job.status === "queued" && job.queueBlockedReason) {
    await markContentStatus(job, "pending_publish");
    return getPublishExecutionState();
  }

  if (job.status === "published") {
    await markContentStatus(job, "published");
    return getPublishExecutionState();
  }

  if (job.status === "submitted" || job.status === "pending_review") {
    await markContentStatus(job, "published");
    return getPublishExecutionState();
  }

  if (job.status === "failed" || job.status === "verification_failed") {
    const manualJob = await recordPublishingJobResult({
      jobId: job.id,
      status: "manual_pending",
      failureStage: job.failureStage ?? "automation_failed",
      errorMessage: job.errorMessage,
      executionLog: job.executionLog,
      notes: buildManualNotes(job),
      externalStatus: job.externalStatus,
      verificationEvidence: job.verificationEvidence,
      verificationAttempts: job.verificationAttempts,
      platformItemId: job.platformItemId,
    });
    await markContentStatus(manualJob, "manual_pending");
    return getPublishExecutionState();
  }

  if (job.status === "manual_pending") {
    await markContentStatus(job, "manual_pending");
  }

  return getPublishExecutionState();
}

export async function markArticleManualPublished(jobId: string, publishUrl?: string) {
  const job = await recordPublishingJobResult({
    jobId,
    status: "published",
    publishUrl,
    notes: "人工处理完成，已回填发布结果。",
    verificationEvidence: publishUrl ? "manual_publish_url" : "manual_confirmed",
  });
  await markContentStatus(job, "published");
  return getPublishExecutionState();
}
