import { getContentGenerationStatus, getCurrentContentPool } from "@/lib/content/service";
import {
  getPlatformAccount,
  getContentPool,
  getPublishingJob,
  getPublishingJobsByTask,
  saveContentPool,
} from "@/lib/storage/data-store";
import { createContentPoolPublishingJob, recordPublishingJobResult, updatePublishingJobRecord } from "@/lib/publish/jobs-service";
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
  return job?.status === "published";
}

async function normalizeStaleScheduledJobs(jobs: PublishingJobRecord[], at: Date) {
  const normalizedJobs = await Promise.all(
    jobs.map(async (job) => {
      if (
        job.status !== "queued" ||
        job.queueBlockedReason !== "job_scheduled_for_later" ||
        !job.plannedPublishTime ||
        new Date(job.plannedPublishTime).getTime() > at.getTime()
      ) {
        return job;
      }
      return updatePublishingJobRecord(job.id, {
        queueBlockedReason: undefined,
        nextRunAt: undefined,
        executionStage: "queued",
      });
    }),
  );
  return normalizedJobs;
}

function isManualPending(item: ContentPoolItem, job?: PublishingJobRecord) {
  return job?.status === "manual_pending" || job?.status === "verification_failed";
}

function isMaterialIssue(job?: PublishingJobRecord) {
  const failureStage = String(job?.failureStage || "").toLowerCase();
  const executionStage = String(job?.executionStage || "").toLowerCase();
  const errorText = [job?.errorMessage, job?.verificationEvidence].filter(Boolean).join(" ").toLowerCase();
  const logText = (job?.executionLog ?? []).join(" ").toLowerCase();
  const stageIndicatesMissingImages =
    failureStage === "prepare_images" || failureStage === "upload_images" || failureStage === "missing_images";
  const textIndicatesMissingImages =
    /(缂哄皯鍙笂浼犲浘鐗噟缂哄皯鍥剧墖|鍥剧墖绱犳潗缂哄け|鏈彁渚涘浘鐗噟missing images?|missing image|without images?|without image|no images?|no image)/i.test(
      errorText,
    );
  const logIndicatesMissingImages =
    /(prepare_images:.*(failed|missing|without images|without image|no images|no image|鏈彁渚泑缂哄皯)|upload_images:.*(failed|missing|without images|without image|no images|no image|鏈彁渚泑缂哄皯)|missing_images)/i.test(
      logText,
    );
  return stageIndicatesMissingImages || executionStage === "missing_images" || textIndicatesMissingImages || logIndicatesMissingImages;
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

async function markContentStatus(job: PublishingJobRecord, status: ContentPoolItemStatus) {
  if (!job.contentPoolItemId) return null;
  const record = await getContentPool(job.taskId);
  const item = record?.items.find((current) => current.id === job.contentPoolItemId);
  if (!item || !isJobForArticle(job, item)) return null;
  return updateContentPoolItem(job.taskId, job.contentPoolItemId, { status });
}

function buildManualNotes(job: PublishingJobRecord) {
  const descriptor = getPlatformDescriptor(job.platform);
  const needsManualConfirmation =
    job.status === "verification_failed" ||
    job.failureStage === "submit" ||
    /验证|审核|风控|captcha|verification|blocking|pending_review|submitted|success_then_blocking/i.test(
      [job.errorMessage, job.verificationEvidence].filter(Boolean).join(" "),
    );
  if (needsManualConfirmation) {
    return [
      `${platformLabel(job.platform)} 提交后出现验证、审核或风控提示，当前文章已转为待人工确认。`,
      job.accountName ? `账号：${job.accountName}` : "",
      descriptor?.publishEntryUrl ? `创作入口：${descriptor.publishEntryUrl}` : "",
      "平台侧可能已经接收本次提交，但系统未能自动完成核验；请人工检查是否已发布，确认后回填发布结果。",
    ]
      .filter(Boolean)
      .join("\n");
  }
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

export async function getPublishExecutionState(taskId?: string, at = new Date()) {
  const requestedTaskId = String(taskId || "").trim();
  const { current } = requestedTaskId ? await getContentGenerationStatus(requestedTaskId) : await getCurrentContentPool();
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
  const jobs = await normalizeStaleScheduledJobs(await getPublishingJobsByTask(current.taskId), at);
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

export async function runNextPublishArticle(taskId?: string) {
  const state = await getPublishExecutionState(taskId);
  if (!state.current || !state.currentArticle) {
    return state;
  }

  const item = state.currentArticle.item;
  let job = state.currentArticle.job ?? (await createContentPoolPublishingJob({ item }));

  if (job.status === "manual_pending" && !isMaterialIssue(job)) {
    await markContentStatus(job, "manual_pending");
    return getPublishExecutionState(taskId);
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
    return getPublishExecutionState(taskId);
  }

  if (job.status === "published") {
    await markContentStatus(job, "published");
    return getPublishExecutionState(taskId);
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
    return getPublishExecutionState(taskId);
  }

  if (job.status === "manual_pending") {
    await markContentStatus(job, "manual_pending");
  }

  return getPublishExecutionState(taskId);
}

export async function markArticleManualPublished(jobId: string, publishUrl?: string) {
  const normalizedPublishUrl = String(publishUrl || "").trim();
  const job = await recordPublishingJobResult({
    jobId,
    status: "published",
    publishUrl: normalizedPublishUrl || undefined,
    notes: normalizedPublishUrl
      ? "人工确认已发布，已回填平台发布链接。"
      : "人工确认账号后台已有已发布内容，未回填发布链接。",
    verificationEvidence: normalizedPublishUrl ? "manual_publish_url" : "manual_operator_confirmation",
  });
  await markContentStatus(job, "published");
  return getPublishExecutionState(job.taskId);
}

export async function markArticleManualNotPublished(jobId: string) {
  const job = await updatePublishingJobRecord(jobId, {
    status: "queued",
    publishUrl: undefined,
    publishedAt: undefined,
    verifiedAt: undefined,
    finishedAt: undefined,
    queueBlockedReason: undefined,
    nextRunAt: undefined,
    backoffUntil: undefined,
    retryCount: 0,
    externalStatus: undefined,
    platformItemId: undefined,
    failureStage: undefined,
    errorMessage: undefined,
    executionStage: "queued",
    verificationEvidence: "manual_not_published",
    notes: "人工核查确认平台未发布，已重新进入发布队列。",
  });
  await markContentStatus(job, "pending_publish");
  return getPublishExecutionState(job.taskId);
}

export async function repairPublishingJobAccountBinding(jobId: string, accountId: string) {
  const [job, account] = await Promise.all([getPublishingJob(jobId), getPlatformAccount(accountId)]);
  if (!job) {
    throw new Error("发布任务不存在。");
  }
  if (!account) {
    throw new Error("选择的发布账号不存在，请重新选择。");
  }
  if (account.platform !== job.platform) {
    throw new Error("只能绑定同平台账号。");
  }

  const accountName = account.displayName ?? account.accountName;
  const timestamp = now();
  const record = job.contentPoolItemId ? await getContentPool(job.taskId) : null;
  if (record) {
    const nextRecord = summarizeContentPool({
      ...record,
      items: record.items.map((item) =>
        item.id === job.contentPoolItemId
          ? {
              ...item,
              accountId: account.id,
              accountName,
              status: item.status === "publishing" ? "pending_publish" : item.status,
              updatedAt: timestamp,
            }
          : item,
      ),
      updatedAt: timestamp,
    });
    await saveContentPool(nextRecord);
  }

  await updatePublishingJobRecord(job.id, {
    accountId: account.id,
    accountName,
    status: "queued",
    queueBlockedReason: undefined,
    nextRunAt: undefined,
    accountRiskState: account.riskState,
    failureStage: undefined,
    errorMessage: undefined,
    executionStage: "queued",
    notes: "已重新绑定当前平台账号，任务已回到发布队列。",
  });

  return getPublishExecutionState(job.taskId);
}

