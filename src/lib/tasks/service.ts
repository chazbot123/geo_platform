import {
  createRecordId,
  ensureStorageReady,
  getContent,
  getImage,
  getProduct,
  getPublishResult,
  getTask,
  getTheme,
  listTasks,
  saveTask,
} from "@/lib/storage/data-store";
import { detectPublishablePlatformAccounts } from "@/lib/publish/accounts-service";
import { getPlatformsBySearchProvider } from "@/lib/publish/provider-platform-matrix";
import type {
  PlatformAccountDetectionItem,
  ProductProfile,
  PublishTaskPlan,
  SearchProvider,
  SocialPlatform,
  TaskBundle,
  TaskCreateInput,
  TaskRecord,
  TaskStatus,
  ThemeSet,
} from "@/lib/types";

export const MIN_PUBLISH_DAYS = 5;
export const ARTICLES_PER_ACCOUNT_PER_DAY = 2 as const;
export const DEFAULT_TIME_WINDOW = { start: "09:00", end: "18:00" } as const;
export const MIN_SAME_ACCOUNT_INTERVAL_HOURS = 3;

function now() {
  return new Date().toISOString();
}

function hasEnterpriseProfile(product: ProductProfile) {
  return Boolean(
    product.productName?.trim() &&
      product.category?.trim() &&
      product.sellingPoints?.trim() &&
      (product.city?.trim() || product.province?.trim() || product.district?.trim() || product.scenarios?.trim()),
  );
}

function getSelectedQuestions(theme?: ThemeSet) {
  return Array.isArray(theme?.selectedKeywords) ? theme.selectedKeywords.map((item) => item.trim()).filter(Boolean) : [];
}

export async function createTask(input: TaskCreateInput) {
  await ensureStorageReady();
  const taskId = createRecordId();
  const productId = createRecordId();
  const { searchProvider, ...productInput } = input;

  const product: ProductProfile = {
    id: productId,
    taskId,
    ...productInput,
  };

  const task: TaskRecord = {
    id: taskId,
    productId,
    status: "created",
    searchProvider: searchProvider || undefined,
    createdAt: now(),
    updatedAt: now(),
  };

  const { saveProduct } = await import("@/lib/storage/data-store");
  await saveProduct(product);
  await saveTask(task);

  return { task, product };
}

export async function getTaskBundle(taskId: string): Promise<TaskBundle | null> {
  await ensureStorageReady();
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  const [product, theme, content, image, publish] = await Promise.all([
    getProduct(task.productId),
    getTheme(taskId),
    getContent(taskId),
    getImage(taskId),
    getPublishResult(taskId),
  ]);

  if (!product) {
    return null;
  }

  return {
    task,
    product,
    theme: theme ?? undefined,
    content: content ?? undefined,
    image: image ?? undefined,
    publish: publish ?? undefined,
  };
}

export async function listTaskBundles() {
  await ensureStorageReady();
  const tasks = await listTasks();
  const bundles = await Promise.all(tasks.map((task) => getTaskBundle(task.id)));
  return bundles
    .filter((bundle): bundle is TaskBundle => Boolean(bundle))
    .sort((left, right) => new Date(right.task.updatedAt).getTime() - new Date(left.task.updatedAt).getTime());
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, patch?: Partial<TaskRecord>) {
  const task = await getTask(taskId);
  if (!task) {
    throw new Error("任务不存在。");
  }

  const nextTask: TaskRecord = {
    ...task,
    ...patch,
    status,
    updatedAt: now(),
  };

  await saveTask(nextTask);
  return nextTask;
}

export async function markTaskFailed(taskId: string, failedStage: string, errorMessage: string, retryable = true) {
  return updateTaskStatus(taskId, "failed", {
    failedStage,
    errorCode: failedStage.toUpperCase(),
    errorMessage,
    retryable,
  });
}

export async function getTaskPlanningPrerequisites() {
  const bundles = await listTaskBundles();
  const enterpriseBundle = bundles.find((bundle) => hasEnterpriseProfile(bundle.product)) ?? null;
  const keywordBundle =
    bundles.find((bundle) => hasEnterpriseProfile(bundle.product) && getSelectedQuestions(bundle.theme).length === 5) ?? null;

  return {
    enterpriseReady: Boolean(enterpriseBundle),
    keywordReady: Boolean(keywordBundle),
    enterpriseTaskId: enterpriseBundle?.task.id,
    keywordTaskId: keywordBundle?.task.id,
    taskId: keywordBundle?.task.id,
    product: keywordBundle?.product ?? enterpriseBundle?.product,
    theme: keywordBundle?.theme,
    selectedQuestions: getSelectedQuestions(keywordBundle?.theme),
    savedPlan: keywordBundle?.task.publishPlan,
  };
}

function normalizeDays(days: number) {
  return Math.max(MIN_PUBLISH_DAYS, Math.floor(Number.isFinite(days) ? days : MIN_PUBLISH_DAYS));
}

function buildPlatformPlan(input: {
  platform: SocialPlatform;
  enabled: boolean;
  detection?: PlatformAccountDetectionItem;
  days: number;
}) {
  const accountCount = input.detection?.accountCount ?? 0;
  const accountIds = input.detection?.accounts.map((account) => account.id) ?? [];
  const enabled = input.enabled && accountCount > 0;
  return {
    platform: input.platform,
    enabled,
    accountCount: enabled ? accountCount : 0,
    accountIds: enabled ? accountIds : [],
    articleCount: enabled ? accountCount * input.days * ARTICLES_PER_ACCOUNT_PER_DAY : 0,
    detectionAt: input.detection?.detectedAt,
  };
}

export function calculatePublishTaskTotal(
  platformPlans: Array<Pick<PublishTaskPlan["enabledPlatforms"][number], "enabled" | "accountCount">>,
  days: number,
) {
  const normalizedDays = normalizeDays(days);
  return platformPlans.reduce(
    (total, platform) => total + (platform.enabled ? platform.accountCount * normalizedDays * ARTICLES_PER_ACCOUNT_PER_DAY : 0),
    0,
  );
}

export async function savePublishTaskPlan(input: {
  taskId: string;
  searchProvider: SearchProvider;
  enabledPlatforms: SocialPlatform[];
  days: number;
  forceRefreshAccounts?: boolean;
}) {
  await ensureStorageReady();
  const prerequisite = await getTaskPlanningPrerequisites();
  if (!prerequisite.enterpriseReady) {
    throw new Error("请先保存企业信息。");
  }
  if (!prerequisite.keywordReady || prerequisite.taskId !== input.taskId || prerequisite.selectedQuestions.length !== 5) {
    throw new Error("请先保存 5 个客户问题。");
  }

  const task = await getTask(input.taskId);
  if (!task) {
    throw new Error("任务不存在。");
  }

  const mappedPlatforms = getPlatformsBySearchProvider(input.searchProvider);
  const enabledPlatformSet = new Set(input.enabledPlatforms.filter((platform) => mappedPlatforms.includes(platform)));
  const days = normalizeDays(input.days);
  const detection = await detectPublishablePlatformAccounts(mappedPlatforms, { forceRefresh: input.forceRefreshAccounts });
  const detectionByPlatform = new Map(detection.items.map((item) => [item.platform, item]));
  const enabledPlatforms = mappedPlatforms.map((platform) =>
    buildPlatformPlan({
      platform,
      enabled: enabledPlatformSet.has(platform),
      detection: detectionByPlatform.get(platform),
      days,
    }),
  );
  const totalArticleCount = enabledPlatforms.reduce((total, platform) => total + platform.articleCount, 0);
  const totalAccountCount = enabledPlatforms.reduce((total, platform) => total + (platform.enabled ? platform.accountCount : 0), 0);
  const timestamp = now();
  const existingCreatedAt = task.publishPlan?.createdAt ?? timestamp;
  const publishPlan: PublishTaskPlan = {
    taskId: input.taskId,
    enterpriseTaskId: prerequisite.enterpriseTaskId ?? input.taskId,
    keywordTaskId: prerequisite.keywordTaskId ?? input.taskId,
    searchProvider: input.searchProvider,
    enabledPlatforms,
    days,
    articlesPerAccountPerDay: ARTICLES_PER_ACCOUNT_PER_DAY,
    timeWindow: DEFAULT_TIME_WINDOW,
    minSameAccountIntervalHours: MIN_SAME_ACCOUNT_INTERVAL_HOURS,
    totalAccountCount,
    totalArticleCount,
    createdAt: existingCreatedAt,
    updatedAt: timestamp,
  };

  const nextTask: TaskRecord = {
    ...task,
    searchProvider: input.searchProvider,
    publishPlan,
    status: "task_planned",
    updatedAt: timestamp,
  };
  await saveTask(nextTask);
  return publishPlan;
}
