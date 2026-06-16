import {
  createRecordId,
  ensureStorageReady,
  getAccountPublishingDraftsByTask,
  getContentPool,
  getPublishingDraftsByTask,
  getPublishingJobsByTask,
  saveProduct,
  saveTask,
  saveTheme,
} from "@/lib/storage/data-store";
import { normalizeSearchProviders } from "@/lib/publish/provider-platform-matrix";
import { contentPoolReadyStatuses } from "@/lib/tasks/constants";
import { getTaskBundle, listTaskBundles, normalizePublishTaskPlan } from "@/lib/tasks/service";
import type { ContentPoolItem, ProductProfile, PublishTaskPlan, PublishingJobRecord, TaskBundle, TaskRecord, ThemeSet } from "@/lib/types";

export interface HistoricalTaskSummary {
  taskId: string;
  archived: boolean;
  title: string;
  enterpriseName: string;
  productName: string;
  searchProvider?: string;
  searchProviders?: string[];
  status: TaskBundle["task"]["status"];
  updatedAt: string;
  createdAt: string;
  selectedQuestionCount: number;
  selectedQuestions: string[];
  enabledPlatformCount: number;
  enabledPlatforms: string[];
  plannedArticleCount: number;
  generatedArticleCount: number;
  publishableArticleCount: number;
  publishedArticleCount: number;
  manualPendingCount: number;
  draftCount: number;
  accountDraftCount: number;
  hasEnterpriseInfo: boolean;
  hasKeywords: boolean;
  hasPublishPlan: boolean;
  hasGeneratedContent: boolean;
  hasPublishExecution: boolean;
  links: {
    enterprise: string;
    keywords: string;
    taskPlan: string;
    contentPool: string;
    report: string;
    publishExecution: string;
  };
}

function selectedQuestions(bundle: TaskBundle) {
  return (bundle.theme?.selectedKeywords ?? []).map((item) => item.trim()).filter(Boolean);
}

function enabledPlatforms(bundle: TaskBundle) {
  return (bundle.task.publishPlan?.enabledPlatforms ?? [])
    .filter((item) => item.enabled)
    .map((item) => item.platform);
}

function hasEnterpriseInfo(bundle: TaskBundle) {
  return Boolean(
    bundle.product.productName?.trim() ||
      bundle.product.category?.trim() ||
      bundle.product.sellingPoints?.trim() ||
      bundle.product.targetAudience?.trim(),
  );
}

function countPublishedJobs(jobs: PublishingJobRecord[]) {
  return jobs.filter((job) => job.status === "published").length;
}

function selectedSearchProviders(bundle: TaskBundle) {
  const publishPlan = bundle.task.publishPlan;
  const platformProviders =
    publishPlan?.enabledPlatforms
      .filter((item) => item.enabled)
      .map((item) => item.searchProvider)
      .filter(Boolean) ?? [];
  return normalizeSearchProviders(
    publishPlan?.searchProviders?.length
      ? publishPlan.searchProviders
      : platformProviders.length
        ? platformProviders
        : bundle.task.searchProvider ?? bundle.theme?.searchProvider,
  );
}

function countManualPendingJobs(jobs: PublishingJobRecord[]) {
  return jobs.filter((job) => job.status === "manual_pending" || job.status === "verification_failed").length;
}

function isJobForContentItem(job: PublishingJobRecord, item: ContentPoolItem) {
  if (job.contentPoolItemId !== item.id) return false;
  if (job.platform !== item.publishPlatform) return false;
  if (job.accountId && job.accountId !== item.accountId) return false;
  if (typeof job.contentSequence === "number" && job.contentSequence !== item.sequence) return false;
  if (job.plannedPublishTime && item.plannedPublishTime && job.plannedPublishTime !== item.plannedPublishTime) return false;
  return true;
}

function jobsForContentItems(jobs: PublishingJobRecord[], items: ContentPoolItem[]) {
  if (!items.length) return [];
  return jobs.filter((job) => items.some((item) => isJobForContentItem(job, item)));
}

function countPublishableItems(items: ContentPoolItem[]) {
  return items.filter((item) => item.publishable).length;
}

function hasGeneratedContentItems(items: ContentPoolItem[]) {
  return items.some((item) => contentPoolReadyStatuses.has(item.status));
}

function buildTitle(bundle: TaskBundle) {
  return bundle.product.productName || bundle.theme?.mainKeyword || bundle.task.selectedKeyword || bundle.task.id.slice(0, 8);
}

function now() {
  return new Date().toISOString();
}

function copyProductForTask(product: ProductProfile, productId: string, taskId: string): ProductProfile {
  return {
    ...product,
    id: productId,
    taskId,
  };
}

function copyThemeForTask(theme: ThemeSet, taskId: string, timestamp: string): ThemeSet {
  return {
    ...theme,
    taskId,
    updatedAt: timestamp,
  };
}

function copyPublishPlanForTask(plan: PublishTaskPlan | undefined, taskId: string, timestamp: string) {
  if (!plan) return undefined;
  return normalizePublishTaskPlan({
    ...plan,
    taskId,
    enterpriseTaskId: taskId,
    keywordTaskId: taskId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function createTaskFromHistoricalKeywords(sourceTaskId: string) {
  await ensureStorageReady();
  const normalizedSourceTaskId = sourceTaskId?.trim();
  if (!normalizedSourceTaskId) {
    throw new Error("缺少历史任务 ID。");
  }

  const sourceBundle = await getTaskBundle(normalizedSourceTaskId);
  if (!sourceBundle) {
    throw new Error("历史任务不存在。");
  }
  if (!sourceBundle.theme) {
    throw new Error("历史任务没有可复用的客户问题。");
  }

  const questions = selectedQuestions(sourceBundle);
  if (!questions.length) {
    throw new Error("历史任务没有可复用的客户问题。");
  }

  const timestamp = now();
  const taskId = createRecordId();
  const productId = createRecordId();
  const product = copyProductForTask(sourceBundle.product, productId, taskId);
  const theme = copyThemeForTask(
    {
      ...sourceBundle.theme,
      selectedKeywords: questions,
      selectedKeyword: questions[0],
      selectedKeywordTheme: sourceBundle.theme.selectedKeywordTheme || questions[0],
    },
    taskId,
    timestamp,
  );
  const publishPlan = copyPublishPlanForTask(sourceBundle.task.publishPlan, taskId, timestamp);
  const selectedKeyword = questions.join("、");
  const task: TaskRecord = {
    id: taskId,
    productId,
    status: publishPlan ? "task_planned" : "keyword_selected",
    searchProvider: publishPlan?.searchProvider ?? sourceBundle.task.searchProvider ?? sourceBundle.theme.searchProvider,
    expectedImageCount: sourceBundle.task.expectedImageCount,
    publishPlan,
    selectedKeyword,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await saveProduct(product);
  await saveTheme(theme);
  await saveTask(task);

  return {
    task,
    product,
    theme,
    sourceTaskId: normalizedSourceTaskId,
    links: {
      taskPlan: `/tasks/create?taskId=${encodeURIComponent(taskId)}`,
      contentPool: `/content-pool?taskId=${encodeURIComponent(taskId)}`,
      publishExecution: `/publish-execution?taskId=${encodeURIComponent(taskId)}`,
    },
  };
}

export async function listHistoricalTaskSummaries(): Promise<HistoricalTaskSummary[]> {
  const bundles = await listTaskBundles();
  const summaries = await Promise.all(
    bundles.map(async (bundle) => {
      const [contentPool, jobs, drafts, accountDrafts] = await Promise.all([
        getContentPool(bundle.task.id),
        getPublishingJobsByTask(bundle.task.id),
        getPublishingDraftsByTask(bundle.task.id),
        getAccountPublishingDraftsByTask(bundle.task.id),
      ]);
      const questions = selectedQuestions(bundle);
      const platforms = enabledPlatforms(bundle);
      const searchProviders = selectedSearchProviders(bundle);
      const items = contentPool?.items ?? [];
      const currentJobs = jobsForContentItems(jobs, items);
      const generatedArticleCount =
        contentPool?.generatedArticleCount ??
        items.filter((item) => Boolean(item.title?.trim() && item.body?.trim() && contentPoolReadyStatuses.has(item.status))).length;

      return {
        taskId: bundle.task.id,
        archived: bundle.task.id.startsWith("geo-round-"),
        title: buildTitle(bundle),
        enterpriseName: bundle.product.category || bundle.product.productName || "--",
        productName: bundle.product.productName || "--",
        searchProvider: searchProviders[0] ?? bundle.task.searchProvider ?? bundle.theme?.searchProvider,
        searchProviders,
        status: bundle.task.status,
        updatedAt: contentPool?.updatedAt || bundle.task.updatedAt,
        createdAt: bundle.task.createdAt,
        selectedQuestionCount: questions.length,
        selectedQuestions: questions.slice(0, 5),
        enabledPlatformCount: platforms.length,
        enabledPlatforms: platforms,
        plannedArticleCount: bundle.task.publishPlan?.totalArticleCount ?? contentPool?.totalArticleCount ?? 0,
        generatedArticleCount,
        publishableArticleCount: countPublishableItems(items),
        publishedArticleCount: countPublishedJobs(currentJobs),
        manualPendingCount: countManualPendingJobs(currentJobs),
        draftCount: drafts.length,
        accountDraftCount: accountDrafts.length,
        hasEnterpriseInfo: hasEnterpriseInfo(bundle),
        hasKeywords: questions.length > 0,
        hasPublishPlan: Boolean(bundle.task.publishPlan),
        hasGeneratedContent: hasGeneratedContentItems(items),
        hasPublishExecution: jobs.length > 0,
        links: {
          enterprise: "/enterprise",
          keywords: "/customer-keywords",
          taskPlan: "/tasks/create",
          contentPool: `/content-pool?taskId=${encodeURIComponent(bundle.task.id)}`,
          report: `/reports/${encodeURIComponent(bundle.task.id)}`,
          publishExecution: `/publish-execution?taskId=${encodeURIComponent(bundle.task.id)}`,
        },
      } satisfies HistoricalTaskSummary;
    }),
  );

  return summaries
    .filter((item) => item.hasEnterpriseInfo || item.hasKeywords || item.hasPublishPlan || item.hasGeneratedContent || item.hasPublishExecution)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}
