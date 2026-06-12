import path from "node:path";
import { getEnterpriseProfile } from "@/lib/enterprise/service";
import { dataRoot } from "@/lib/paths";
import { detectPublishablePlatformAccounts } from "@/lib/publish/accounts-service";
import { getAllPublishPlatforms, getPlatformsBySearchProvider } from "@/lib/publish/provider-platform-matrix";
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
  saveProduct,
  saveTask,
  saveTheme,
} from "@/lib/storage/data-store";
import { readJsonFile } from "@/lib/storage/json-store";
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
import type { EnterpriseProfile } from "@/lib/enterprise/types";

export const MIN_PUBLISH_DAYS = 1;
export const DEFAULT_ARTICLES_PER_ACCOUNT_PER_DAY = 2;
export const ARTICLES_PER_ACCOUNT_PER_DAY = DEFAULT_ARTICLES_PER_ACCOUNT_PER_DAY;
export const DEFAULT_TIME_WINDOW = { start: "09:00", end: "18:00" } as const;
export const MIN_SAME_ACCOUNT_INTERVAL_HOURS = 3;

function now() {
  return new Date().toISOString();
}

interface WorkbenchKeywordQuestion {
  id: string;
  question: string;
}

interface WorkbenchKeywordSet {
  id: string;
  enterpriseId: string;
  enterpriseName: string;
  brandShortName: string;
  productService: string;
  region: string;
  candidates?: Record<string, WorkbenchKeywordQuestion[]>;
  selectedQuestions?: WorkbenchKeywordQuestion[];
  generatedAt?: string;
  savedAt?: string;
  updatedAt?: string;
}

const WORKBENCH_TASK_ID = "customer-workbench-task";
const WORKBENCH_PRODUCT_ID = "customer-workbench-product";
const WORKBENCH_KEYWORD_PATH = path.join(dataRoot, "customer-keywords", "current.json");

async function getWorkbenchKeywordSet() {
  return readJsonFile<WorkbenchKeywordSet | null>(WORKBENCH_KEYWORD_PATH, null);
}

function uniqueText(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((item) => item?.trim()).filter(Boolean) as string[]));
}

function getWorkbenchCandidateQuestions(keywordSet: WorkbenchKeywordSet | null) {
  if (!keywordSet?.candidates || typeof keywordSet.candidates !== "object") {
    return [];
  }
  return uniqueText(Object.values(keywordSet.candidates).flat().map((item) => item?.question));
}

function getWorkbenchSelectedQuestions(keywordSet: WorkbenchKeywordSet | null) {
  return uniqueText(keywordSet?.selectedQuestions?.map((item) => item.question) ?? []);
}

function buildWorkbenchProduct(productId: string, taskId: string, enterpriseProfile: EnterpriseProfile): ProductProfile {
  return {
    id: productId,
    taskId,
    productName: enterpriseProfile.productService || enterpriseProfile.brandShortName || enterpriseProfile.companyName,
    category: enterpriseProfile.brandShortName || enterpriseProfile.productService || enterpriseProfile.companyName,
    sellingPoints:
      enterpriseProfile.productFeatures ||
      enterpriseProfile.trustProof ||
      enterpriseProfile.painPoints ||
      enterpriseProfile.productService ||
      enterpriseProfile.brandShortName,
    targetAudience: enterpriseProfile.audience || enterpriseProfile.companyName,
    scenarios: enterpriseProfile.region || enterpriseProfile.painPoints || enterpriseProfile.customerCases || enterpriseProfile.productService,
    brandTone: enterpriseProfile.brandStory || enterpriseProfile.brandShortName || enterpriseProfile.companyName,
    complianceNotes: enterpriseProfile.trustProof || undefined,
  };
}

function buildWorkbenchTheme(
  taskId: string,
  enterpriseProfile: EnterpriseProfile,
  keywordSet: WorkbenchKeywordSet | null,
  searchProvider: SearchProvider,
): ThemeSet {
  const selectedQuestions = getWorkbenchSelectedQuestions(keywordSet);
  const candidateQuestions = getWorkbenchCandidateQuestions(keywordSet);
  const fallbackQuestions = selectedQuestions.length ? selectedQuestions : candidateQuestions;
  const selectedKeywordTheme = selectedQuestions.length ? selectedQuestions.join("、") : undefined;

  return {
    taskId,
    searchProvider,
    audienceChannels: ["social", "streaming"],
    mainKeyword: enterpriseProfile.productService || enterpriseProfile.brandShortName || enterpriseProfile.companyName,
    backupKeywords: [],
    relatedKeywords: [],
    trendKeywords: [],
    recommendedKeywords: fallbackQuestions.slice(0, 10),
    candidateKeywords: fallbackQuestions.slice(0, 10),
    scoreSummary: `${enterpriseProfile.brandShortName || enterpriseProfile.companyName}任务规划兼容主题。`,
    rankingSummary:
      selectedQuestions.length === 5
        ? "当前任务规划已从客户关键词工作台同步 5 个核心问题。"
        : "当前任务规划等待客户关键词工作台保存 5 个核心问题。",
    selectedKeyword: selectedKeywordTheme,
    selectedKeywords: selectedQuestions,
    selectedKeywordTheme,
    updatedAt: keywordSet?.updatedAt || enterpriseProfile.lastSavedAt || now(),
  };
}

async function syncWorkbenchPlanningTask() {
  const [enterpriseProfile, keywordSet, existingTask, existingTheme] = await Promise.all([
    getEnterpriseProfile(),
    getWorkbenchKeywordSet(),
    getTask(WORKBENCH_TASK_ID),
    getTheme(WORKBENCH_TASK_ID),
  ]);

  if (!enterpriseProfile) {
    return null;
  }

  const timestamp = now();
  const productId = existingTask?.productId || WORKBENCH_PRODUCT_ID;
  const existingPublishPlan = existingTask?.publishPlan ? normalizePublishTaskPlan(existingTask.publishPlan) : undefined;
  const searchProvider =
    existingPublishPlan?.searchProvider || existingTask?.searchProvider || existingTheme?.searchProvider || "doubao";
  const product = buildWorkbenchProduct(productId, WORKBENCH_TASK_ID, enterpriseProfile);
  const theme = buildWorkbenchTheme(WORKBENCH_TASK_ID, enterpriseProfile, keywordSet, searchProvider);
  const selectedQuestions = getSelectedQuestions(theme);

  const task: TaskRecord = {
    id: WORKBENCH_TASK_ID,
    productId,
    status:
      existingPublishPlan
        ? existingTask.status
        : selectedQuestions.length === 5
          ? existingTask?.status && existingTask.status !== "created"
            ? existingTask.status
            : "keyword_selected"
          : "created",
    searchProvider,
    publishPlan: existingPublishPlan,
    createdAt: existingTask?.createdAt || keywordSet?.generatedAt || enterpriseProfile.lastSavedAt || timestamp,
    updatedAt: timestamp,
    selectedKeyword: selectedQuestions.length ? selectedQuestions.join("、") : undefined,
  };

  await saveProduct(product);
  await saveTheme(theme);
  await saveTask(task);
  return { task, product, theme };
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

  const normalizedTask: TaskRecord = task.publishPlan
    ? {
        ...task,
        searchProvider: task.publishPlan.searchProvider,
        publishPlan: normalizePublishTaskPlan(task.publishPlan),
      }
    : task;

  return {
    task: normalizedTask,
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
  await ensureStorageReady();
  await syncWorkbenchPlanningTask();
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

function normalizeArticlesPerAccountPerDay(value: number) {
  return Math.max(1, Math.floor(Number.isFinite(value) ? value : DEFAULT_ARTICLES_PER_ACCOUNT_PER_DAY));
}

function isValidTimeValue(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function normalizeTimeWindow(input?: { start?: string; end?: string }) {
  const start = input?.start?.trim();
  const end = input?.end?.trim();
  if (!start || !end) {
    return DEFAULT_TIME_WINDOW;
  }
  if (!isValidTimeValue(start) || !isValidTimeValue(end)) {
    throw new Error("发布时间格式不正确，请使用 HH:mm。");
  }
  if (start >= end) {
    throw new Error("发布时间结束时间必须晚于开始时间。");
  }
  return { start, end };
}

function normalizePersistedTimeWindow(input?: { start?: string; end?: string }) {
  const start = input?.start?.trim();
  const end = input?.end?.trim();
  if (!start || !end) {
    return DEFAULT_TIME_WINDOW;
  }
  if (!isValidTimeValue(start) || !isValidTimeValue(end) || start >= end) {
    return DEFAULT_TIME_WINDOW;
  }
  return { start, end };
}

function buildPlatformPlan(input: {
  platform: SocialPlatform;
  enabled: boolean;
  detection?: PlatformAccountDetectionItem;
  days: number;
  articlesPerAccountPerDay: number;
}) {
  const accountCount = input.detection?.accountCount ?? 0;
  const accountIds = input.detection?.accounts.map((account) => account.id) ?? [];
  const enabled = input.enabled && accountCount > 0;
  return {
    platform: input.platform,
    enabled,
    accountCount: enabled ? accountCount : 0,
    accountIds: enabled ? accountIds : [],
    articleCount: enabled ? accountCount * input.days * input.articlesPerAccountPerDay : 0,
    detectionAt: input.detection?.detectedAt,
  };
}

function summarizePublishPlanPlatforms(enabledPlatforms: PublishTaskPlan["enabledPlatforms"]) {
  return {
    totalAccountCount: enabledPlatforms.reduce((total, platform) => total + (platform.enabled ? platform.accountCount : 0), 0),
    totalArticleCount: enabledPlatforms.reduce((total, platform) => total + platform.articleCount, 0),
  };
}

function constrainPlatformsToSearchProvider(searchProvider: SearchProvider, enabledPlatforms: SocialPlatform[]) {
  const allowedPlatforms = new Set(getPlatformsBySearchProvider(searchProvider));
  return Array.from(new Set(enabledPlatforms.filter((platform) => allowedPlatforms.has(platform))));
}

export function normalizePublishTaskPlan(plan: PublishTaskPlan): PublishTaskPlan {
  const days = normalizeDays(plan.days);
  const articlesPerAccountPerDay = normalizeArticlesPerAccountPerDay(plan.articlesPerAccountPerDay);
  const allowedPlatforms = new Set(getPlatformsBySearchProvider(plan.searchProvider));
  const existingPlans = new Map(plan.enabledPlatforms.map((item) => [item.platform, item]));
  const enabledPlatforms = getAllPublishPlatforms().map((platform) => {
    const existingPlan = existingPlans.get(platform);
    if (!existingPlan) {
      return buildPlatformPlan({
        platform,
        enabled: false,
        days,
        articlesPerAccountPerDay,
      });
    }

    const accountIds = Array.from(
      new Set(existingPlan.accountIds.map((accountId) => accountId?.trim()).filter(Boolean) as string[]),
    );
    const enabled = allowedPlatforms.has(platform) && existingPlan.enabled && accountIds.length > 0;
    const accountCount = enabled ? accountIds.length : 0;
    return {
      ...existingPlan,
      platform,
      enabled,
      accountIds: enabled ? accountIds : [],
      accountCount,
      articleCount: enabled ? accountCount * days * articlesPerAccountPerDay : 0,
    };
  });
  const { totalAccountCount, totalArticleCount } = summarizePublishPlanPlatforms(enabledPlatforms);

  return {
    ...plan,
    enabledPlatforms,
    days,
    articlesPerAccountPerDay,
    timeWindow: normalizePersistedTimeWindow(plan.timeWindow),
    totalAccountCount,
    totalArticleCount,
  };
}

export function calculatePublishTaskTotal(
  platformPlans: Array<Pick<PublishTaskPlan["enabledPlatforms"][number], "enabled" | "accountCount">>,
  days: number,
  articlesPerAccountPerDay = DEFAULT_ARTICLES_PER_ACCOUNT_PER_DAY,
) {
  const normalizedDays = normalizeDays(days);
  const normalizedArticlesPerAccountPerDay = normalizeArticlesPerAccountPerDay(articlesPerAccountPerDay);
  return platformPlans.reduce(
    (total, platform) =>
      total + (platform.enabled ? platform.accountCount * normalizedDays * normalizedArticlesPerAccountPerDay : 0),
    0,
  );
}

export async function savePublishTaskPlan(input: {
  taskId: string;
  searchProvider: SearchProvider;
  enabledPlatforms: SocialPlatform[];
  days: number;
  articlesPerAccountPerDay: number;
  timeWindow?: {
    start: string;
    end: string;
  };
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

  const allPlatforms = getAllPublishPlatforms();
  const enabledPlatformSet = new Set(
    constrainPlatformsToSearchProvider(
      input.searchProvider,
      input.enabledPlatforms.filter((platform) => allPlatforms.includes(platform)),
    ),
  );
  const mappedPlatformSet = new Set(getPlatformsBySearchProvider(input.searchProvider));
  const days = normalizeDays(input.days);
  const articlesPerAccountPerDay = normalizeArticlesPerAccountPerDay(input.articlesPerAccountPerDay);
  const timeWindow = normalizeTimeWindow(input.timeWindow);
  const detection = await detectPublishablePlatformAccounts(allPlatforms, { forceRefresh: input.forceRefreshAccounts });
  const detectionByPlatform = new Map(detection.items.map((item) => [item.platform, item]));
  const enabledPlatforms = allPlatforms.map((platform) =>
    buildPlatformPlan({
      platform,
      enabled: mappedPlatformSet.has(platform) && enabledPlatformSet.has(platform),
      detection: detectionByPlatform.get(platform),
      days,
      articlesPerAccountPerDay,
    }),
  );
  const { totalAccountCount, totalArticleCount } = summarizePublishPlanPlatforms(enabledPlatforms);
  const timestamp = now();
  const existingCreatedAt = task.publishPlan?.createdAt ?? timestamp;
  const publishPlan: PublishTaskPlan = {
    taskId: input.taskId,
    enterpriseTaskId: prerequisite.enterpriseTaskId ?? input.taskId,
    keywordTaskId: prerequisite.keywordTaskId ?? input.taskId,
    searchProvider: input.searchProvider,
    enabledPlatforms,
    days,
    articlesPerAccountPerDay,
    timeWindow,
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
