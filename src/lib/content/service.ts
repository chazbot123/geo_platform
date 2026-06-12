import { getAppConfig } from "@/lib/config/service";
import { getPromptVersion, normalizeAiScenario, normalizePlatform } from "@/lib/content/prompt-loader";
import { reviewContent, type ReviewResult } from "@/lib/content/review-service";
import { planDispersion } from "@/lib/content/dispersion-service";
import { buildGeoContentExecutionPackage } from "@/lib/content/execution-package";
import { generateArticleForContentPool } from "@/lib/content/article-generation-service";
import { runContentModel } from "@/lib/integrations/content/client";
import {
  getContentPool,
  getPlatformAccount,
  listAllContentDrafts,
  listContentPools,
  saveContent,
  saveContentPool,
} from "@/lib/storage/data-store";
import { getTaskBundle, listTaskBundles, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";
import type {
  ContentDraft,
  ContentPoolItem,
  ContentPoolItemStatus,
  ContentPoolPipelineState,
  ContentPoolRecord,
  ContentPoolRiskLevel,
  PublishTaskPlan,
  SearchProvider,
  SocialPlatform,
  TaskBundle,
  TaskRecord,
} from "@/lib/types";

const activeGenerationTasks = new Set<string>();
const activeRetryTasks = new Set<string>();
const generationResumeStatuses = new Set(["generation_queued", "generation_running"]);

function splitParagraphs(content: string) {
  return content
    .split(/\r?\n\s*\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractSectionBody(block: string) {
  const lines = block.split(/\r?\n\r?\n/).map((item) => item.trim()).filter(Boolean);
  return lines
    .filter((line) => !line.startsWith("对应提问：") && !line.startsWith("章节摘要："))
    .join("\n\n");
}

function syncStructuredFieldsFromContent(draft: ContentDraft, content: string): ContentDraft {
  const paragraphs = splitParagraphs(content);
  const reportIntroduction = paragraphs.find((item) => item.startsWith("## 报告引言"))?.replace(/^##\s*报告引言\s*/u, "").trim();
  const reportConclusion = paragraphs.find((item) => item.startsWith("## 报告结论"))?.replace(/^##\s*报告结论\s*/u, "").trim();
  const nextSections = (draft.reportSections ?? []).map((section) => {
    const block = paragraphs.find((item) => item.startsWith(`## ${section.heading}`));
    if (!block) {
      return section;
    }

    const summaryMatch = block.match(/章节摘要：([\s\S]*?)(?:\n\n|$)/);
    return {
      ...section,
      summary: summaryMatch?.[1]?.trim() || section.summary,
      body: extractSectionBody(block) || section.body,
    };
  });

  return {
    ...draft,
    content,
    reportIntroduction: reportIntroduction || draft.reportIntroduction,
    reportSections: nextSections,
    reportConclusion: reportConclusion || draft.reportConclusion,
  };
}

export interface ContentGenerationOptions {
  aiScenario?: string;
  platform?: string;
  contentAngle?: string;
}

export interface ContentGenerationResult {
  content: ContentDraft;
  reviewResult: ReviewResult;
  dispersionPlan?: { newAngle: string; usedAngles: string[] };
}

function getSelectedQuestionsForReview(bundle: TaskBundle) {
  const selectedKeywords = Array.isArray(bundle.theme?.selectedKeywords) ? bundle.theme.selectedKeywords : [];
  const selectedBundle = bundle.theme?.selectedQuestionBundle?.selectedQuestionBundle;
  const selectedBundleQuestions = selectedBundle
    ? [
        selectedBundle.mainQuestion.question,
        ...selectedBundle.supportingQuestions.map((question) => question.question),
      ]
    : [];

  return [...selectedBundleQuestions, ...selectedKeywords].map((question) => question.trim()).filter(Boolean);
}

function normalizeGeneratedDraft(
  draft: ContentDraft,
  options: { platform: string; aiScenario: string; contentAngle: string },
): ContentDraft {
  const platform = normalizePlatform(options.platform);
  const aiScenario = normalizeAiScenario(options.aiScenario);
  return {
    ...draft,
    platform,
    aiScenario,
    contentAngle: options.contentAngle,
    promptVersion: draft.promptVersion ?? getPromptVersion(platform, aiScenario),
  };
}

function buildReviewFailure(error: unknown): ReviewResult {
  return {
    passed: false,
    blockingIssues: [
      {
        code: "CONTENT_REVIEW_FAILED",
        message: error instanceof Error ? error.message : "Content review failed",
      },
    ],
    warnings: [],
    scores: {
      platformFit: 0,
      complianceFit: 0,
      questionCoverage: 0,
    },
  };
}

export async function generateContentForTask(taskId: string, options?: ContentGenerationOptions): Promise<ContentGenerationResult> {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("Question theme is not ready");
  }

  try {
    const config = await getAppConfig();
    const platform = options?.platform ?? "toutiao";
    const aiScenario = options?.aiScenario ?? "doubao_plain_answer";
    let contentAngle = options?.contentAngle ?? "selection_criteria";
    let dispersionPlan: ContentGenerationResult["dispersionPlan"];

    if (!options?.contentAngle) {
      try {
        const historyDrafts = await listAllContentDrafts();
        const samePlatformDrafts = historyDrafts.filter((draft) => draft.platform === platform);
        if (samePlatformDrafts.length > 0) {
          const plan = await planDispersion(platform, samePlatformDrafts);
          contentAngle = plan.newAngle.angleId;
          dispersionPlan = { newAngle: plan.newAngle.angleId, usedAngles: plan.usedAngles };
        }
      } catch {
        // Dispersion planning should not block local draft generation.
      }
    }

    const generatedContent = normalizeGeneratedDraft(
      await runContentModel(bundle.product, bundle.theme, config.contentModelApiConfig, {
        aiScenario,
        platform,
        contentAngle,
      }),
      { aiScenario, platform, contentAngle },
    );

    let reviewResult: ReviewResult;
    try {
      const historyDrafts = await listAllContentDrafts();
      const samePlatformDrafts = historyDrafts.filter((draft) => draft.platform === platform);
      reviewResult = await reviewContent(generatedContent, platform, getSelectedQuestionsForReview(bundle), samePlatformDrafts);
    } catch (error) {
      reviewResult = buildReviewFailure(error);
    }

    const content: ContentDraft = {
      ...generatedContent,
      geoExecutionPackage: buildGeoContentExecutionPackage({
        bundle,
        content: generatedContent,
        reviewResult,
        platform,
        aiScenario,
        contentAngle,
        dispersionPlan,
      }),
    };

    await saveContent(content);
    await updateTaskStatus(taskId, "content_generated");
    return { content, reviewResult, dispersionPlan };
  } catch (error) {
    await markTaskFailed(taskId, "content", error instanceof Error ? error.message : "Content generation failed");
    throw error;
  }
}

export async function updateContentDraft(taskId: string, patch: Pick<ContentDraft, "title" | "summary" | "cta" | "content">) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.content) {
    throw new Error("Content draft does not exist");
  }

  const patchedDraft: ContentDraft = {
    ...bundle.content,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const syncedDraft = syncStructuredFieldsFromContent(patchedDraft, patch.content);
  const platform = normalizePlatform(syncedDraft.platform);
  const aiScenario = normalizeAiScenario(syncedDraft.aiScenario);
  const contentAngle = syncedDraft.contentAngle ?? "selection_criteria";
  let reviewResult: ReviewResult;
  try {
    const historyDrafts = (await listAllContentDrafts()).filter((draft) => draft.taskId !== syncedDraft.taskId && draft.platform === platform);
    reviewResult = await reviewContent(syncedDraft, platform, getSelectedQuestionsForReview(bundle), historyDrafts);
  } catch (error) {
    reviewResult = buildReviewFailure(error);
  }
  const nextDraft: ContentDraft = {
    ...syncedDraft,
    geoExecutionPackage: buildGeoContentExecutionPackage({
      bundle: { ...bundle, content: syncedDraft },
      content: syncedDraft,
      reviewResult,
      platform,
      aiScenario,
      contentAngle,
    }),
  };

  await saveContent(nextDraft);
  return nextDraft;
}

const platformLabelMap: Record<SocialPlatform, string> = {
  toutiao: "今日头条",
  baijiahao: "百家号",
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信公众号",
  videohao: "视频号",
  zhihu: "知乎",
  weibo: "微博",
  csdn: "CSDN",
};

const providerLabelMap: Record<SearchProvider, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "元宝",
  tongyi: "通义",
};

const dispersionDimensions: ContentPoolPipelineState["dispersion"]["changedDimensions"] = [
  "title",
  "opening",
  "section_order",
  "judgment",
  "cta",
  "image_prompt",
];

function getSelectedQuestions(bundle: TaskBundle) {
  return (bundle.theme?.selectedKeywords ?? []).map((item, index) => ({
    id: `keyword-${index + 1}`,
    text: item.trim(),
    sequence: index + 1,
  })).filter((item) => item.text);
}

function isContentPoolReady(item: Pick<ContentPoolItem, "riskLevel" | "pipeline">) {
  return item.riskLevel === "low" && item.pipeline.negativeCheck.hits.length === 0;
}

function parseTimeValue(value: string) {
  const [hours, minutes] = value.split(":").map((item) => Number.parseInt(item, 10));
  return hours * 60 + minutes;
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function buildDailyPublishTimes(plan: PublishTaskPlan, dayIndex: number, accountSeed: number) {
  const slotCount = Math.max(1, plan.articlesPerAccountPerDay);
  const startMinutes = parseTimeValue(plan.timeWindow.start);
  const endMinutes = parseTimeValue(plan.timeWindow.end);
  const minIntervalMinutes = plan.minSameAccountIntervalHours * 60;
  const totalWindowMinutes = Math.max(endMinutes - startMinutes, 0);
  const requiredIntervalMinutes = Math.max(0, (slotCount - 1) * minIntervalMinutes);
  const dayBase = new Date(plan.createdAt);
  dayBase.setDate(dayBase.getDate() + dayIndex);

  if (slotCount === 1) {
    const offset = totalWindowMinutes > 0 ? Math.floor(seededUnit(accountSeed * 101 + dayIndex * 17) * (totalWindowMinutes + 1)) : 0;
    const planned = new Date(dayBase);
    planned.setHours(Math.floor((startMinutes + offset) / 60), (startMinutes + offset) % 60, 0, 0);
    return [planned.toISOString()];
  }

  if (totalWindowMinutes <= requiredIntervalMinutes) {
    return Array.from({ length: slotCount }, (_, slotIndex) => {
      const minutes = Math.min(startMinutes + slotIndex * minIntervalMinutes, endMinutes);
      const planned = new Date(dayBase);
      planned.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      return planned.toISOString();
    });
  }

  const times: string[] = [];
  let currentMinutes = startMinutes;
  let remainingSlack = totalWindowMinutes - requiredIntervalMinutes;

  for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    const remainingSlots = slotCount - slotIndex;
    const maxSlackBeforeCurrent = remainingSlots === 1 ? remainingSlack : Math.floor(remainingSlack / remainingSlots);
    const slackBeforeCurrent =
      remainingSlots === 1 ? remainingSlack : Math.floor(seededUnit(accountSeed * 101 + dayIndex * 17 + slotIndex * 23) * (maxSlackBeforeCurrent + 1));

    currentMinutes += slackBeforeCurrent;
    remainingSlack -= slackBeforeCurrent;

    const planned = new Date(dayBase);
    planned.setHours(Math.floor(currentMinutes / 60), currentMinutes % 60, 0, 0);
    times.push(planned.toISOString());
    currentMinutes += minIntervalMinutes;
  }

  return times;
}

function plannedTimeFor(plan: PublishTaskPlan, dayIndex: number, slotIndex: number, accountSeed: number) {
  const dailyTimes = buildDailyPublishTimes(plan, dayIndex, accountSeed);
  return dailyTimes[slotIndex] ?? dailyTimes.at(-1) ?? new Date(plan.createdAt).toISOString();
}

function buildPendingPipeline(platform: SocialPlatform, imagePrompt: string): ContentPoolPipelineState {
  return {
    negativeCheck: {
      status: "pending",
      hits: [],
    },
    riskReview: {
      status: "pending",
      level: "low",
      message: "等待后台开始处理。",
    },
    sampleDraft: {
      status: "pending",
      passed: false,
    },
    styleAdaptation: {
      status: "pending",
      platform,
      notes: [],
    },
    dispersion: {
      status: "pending",
      changedDimensions: [],
      message: "等待进入差异化处理。",
    },
    imageGeneration: {
      status: "pending",
      prompt: imagePrompt,
      images: [],
    },
  };
}

function buildPendingContentPoolItem(input: {
  plan: PublishTaskPlan;
  sequence: number;
  platform: SocialPlatform;
  accountId: string;
  accountName?: string;
  keyword: ReturnType<typeof getSelectedQuestions>[number];
  accountKeywordOffset: number;
  plannedPublishTime: string;
  timestamp: string;
}): ContentPoolItem {
  const imagePrompt = `${platformLabelMap[input.platform]}配图：${input.keyword.text}，真实产品服务场景，清晰、克制、适合图文发布`;
  return {
    id: `${input.plan.taskId}-${String(input.sequence).padStart(4, "0")}`,
    sequence: input.sequence,
    taskId: input.plan.taskId,
    aiPlatform: input.plan.searchProvider,
    publishPlatform: input.platform,
    accountId: input.accountId,
    accountName: input.accountName,
    keywordId: input.keyword.id,
    keywordSequence: input.keyword.sequence,
    keywordText: input.keyword.text,
    accountKeywordOffset: input.accountKeywordOffset,
    plannedPublishTime: input.plannedPublishTime,
    title: "",
    summary: "",
    body: "",
    imagePrompt,
    imageList: [],
    riskLevel: "low",
    status: "pending_generation",
    pipeline: buildPendingPipeline(input.platform, imagePrompt),
    publishable: false,
    displayStatus: "pending",
    internalStage: "brief_ready",
    stageMessage: "等待开始生成。",
    stageLog: [{ stage: "brief_ready", message: "已进入生成队列。", at: input.timestamp }],
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

function countFinishedGenerationItems(record: ContentPoolRecord) {
  return record.items.filter((item) =>
    item.status === "pending_publish" ||
    item.status === "ready" ||
    item.status === "sample" ||
    item.status === "published" ||
    item.status === "failed",
  ).length;
}

function hasPendingGenerationItems(record: ContentPoolRecord) {
  return record.items.some((item) => item.status === "pending_generation" || item.status === "generating");
}

function hasRetryQueueItems(record: ContentPoolRecord) {
  return record.items.some((item) => item.status === "generating" || item.status === "failed" || item.riskLevel === "high");
}

function reconcileInterruptedGenerationRecord(record: ContentPoolRecord, task: TaskRecord) {
  const timestamp = new Date().toISOString();
  const baseReason = String(task.errorMessage || "").trim() || "本轮内容生成已中断，请重新生成。";

  return summarizeContentPool({
    ...record,
    items: record.items.map((item) => {
      if (item.status !== "pending_generation" && item.status !== "generating") {
        return item;
      }

      const reason =
        item.status === "generating"
          ? baseReason
          : `本条内容尚未开始生成，任务已中断。${baseReason}`;

      return {
        ...item,
        riskLevel: "high",
        status: "failed",
        publishable: false,
        displayStatus: "failed",
        internalStage: "failed",
        stageMessage: reason,
        failedReason: reason,
        pipeline: {
          negativeCheck: { status: "blocked", hits: [reason], checkedAt: timestamp },
          riskReview: { status: "blocked", level: "high", message: reason, reviewedAt: timestamp },
          sampleDraft: { status: "blocked", passed: false, checkedAt: timestamp },
          styleAdaptation: { status: "blocked", platform: item.publishPlatform, notes: [] },
          dispersion: { status: "blocked", changedDimensions: [], message: "生成已中断，未产出降重结果。" },
          imageGeneration: { status: "blocked", prompt: item.imagePrompt, images: item.imageList ?? [] },
        },
        stageLog: [...(item.stageLog ?? []), { stage: "failed", message: reason, at: timestamp }],
        updatedAt: timestamp,
      };
    }),
    updatedAt: timestamp,
  });
}

function calculateGenerationProgress(record: ContentPoolRecord) {
  if (!record.items.length) {
    return 0;
  }
  return Math.round((countFinishedGenerationItems(record) / record.items.length) * 100);
}

function markRetryQueueState(record: ContentPoolRecord, status: "idle" | "queued" | "running", timestamp: string) {
  return summarizeContentPool({
    ...record,
    retryQueueStatus: status,
    retryRequestedAt: status === "queued" ? timestamp : (record.retryRequestedAt ?? timestamp),
    retryFinishedAt: status === "idle" ? timestamp : undefined,
    updatedAt: timestamp,
  });
}

async function syncTaskGenerationProgress(taskId: string, status: "generation_queued" | "generation_running" | "generation_completed", record: ContentPoolRecord, startedAt: string, finishedAt?: string) {
  await updateTaskStatus(taskId, status, {
    generationStartedAt: startedAt,
    generationFinishedAt: finishedAt,
    generationProgress: status === "generation_completed" ? 100 : calculateGenerationProgress(record),
    generatedArticleCount: record.generatedArticleCount ?? 0,
    failedArticleCount: record.failedArticleCount ?? 0,
  });
}

function replaceContentPoolItem(record: ContentPoolRecord, itemId: string, nextItem: ContentPoolItem) {
  return summarizeContentPool({
    ...record,
    items: record.items.map((item) => (item.id === itemId ? nextItem : item)),
    updatedAt: new Date().toISOString(),
  });
}

function markContentPoolItemGenerating(record: ContentPoolRecord, itemId: string) {
  const timestamp = new Date().toISOString();
  return summarizeContentPool({
    ...record,
    items: record.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }
      return {
        ...item,
        status: "generating",
        displayStatus: "generating",
        internalStage: "draft_generating",
        stageMessage: "正在生成正文。",
        stageLog: [...(item.stageLog ?? []), { stage: "draft_generating", message: "正在生成正文。", at: timestamp }],
        updatedAt: timestamp,
      };
    }),
    updatedAt: timestamp,
  });
}

async function saveAndSyncGenerationRecord(taskId: string, status: "generation_queued" | "generation_running" | "generation_completed", record: ContentPoolRecord, startedAt: string, finishedAt?: string) {
  const summarized = summarizeContentPool(record);
  await saveContentPool(summarized);
  await syncTaskGenerationProgress(taskId, status, summarized, startedAt, finishedAt);
  return summarized;
}

async function saveRetryQueueRecord(record: ContentPoolRecord) {
  const summarized = summarizeContentPool(record);
  await saveContentPool(summarized);
  return summarized;
}

async function buildPendingContentPoolRecord(bundle: TaskBundle, plan: PublishTaskPlan): Promise<ContentPoolRecord> {
  const planned = new Date(plan.createdAt);
  planned.setSeconds(0, 0);
  const questions = getSelectedQuestions(bundle);
  if (questions.length !== 5) {
    throw new Error("请先保存 5 个客户问题。");
  }

  const timestamp = planned.toISOString();
  const accountIds = plan.enabledPlatforms.flatMap((platform) =>
    platform.enabled ? platform.accountIds.map((accountId) => ({ accountId, platform: platform.platform })) : [],
  );
  const accountNameMap = new Map<string, string>();
  await Promise.all(
    accountIds.map(async ({ accountId }) => {
      const account = await getPlatformAccount(accountId);
      accountNameMap.set(accountId, account?.displayName || account?.accountName || accountId);
    }),
  );

  let sequence = 0;
  const items: ContentPoolItem[] = [];

  for (const platformPlan of plan.enabledPlatforms.filter((item) => item.enabled)) {
    for (let accountIndex = 0; accountIndex < platformPlan.accountIds.length; accountIndex += 1) {
      const accountId = platformPlan.accountIds[accountIndex];
      const globalAccountIndex = accountIds.findIndex((item) => item.accountId === accountId);
      const accountKeywordOffset = Math.max(globalAccountIndex, 0) % questions.length;
      let accountArticleIndex = 0;

      for (let dayIndex = 0; dayIndex < plan.days; dayIndex += 1) {
        for (let slotIndex = 0; slotIndex < plan.articlesPerAccountPerDay; slotIndex += 1) {
          sequence += 1;
          const keywordIndex = (accountArticleIndex + accountKeywordOffset) % questions.length;
          const keyword = questions[keywordIndex];
          const plannedPublishTime = plannedTimeFor(plan, dayIndex, slotIndex, globalAccountIndex + 1);
          items.push(
            buildPendingContentPoolItem({
              plan,
              sequence,
              platform: platformPlan.platform,
              accountId,
              accountName: accountNameMap.get(accountId),
              keyword,
              accountKeywordOffset,
              plannedPublishTime,
              timestamp,
            }),
          );
          accountArticleIndex += 1;
        }
      }
    }
  }

  return summarizeContentPool({
    taskId: plan.taskId,
    sourcePublishPlanUpdatedAt: plan.updatedAt,
    currentTaskId: plan.taskId,
    items,
    retryQueueStatus: "idle",
    generatedAt: timestamp,
    updatedAt: timestamp,
  });
}

function buildFailedContentPoolItem(input: {
  plan: PublishTaskPlan;
  sequence: number;
  platform: SocialPlatform;
  accountId: string;
  accountName?: string;
  keyword: ReturnType<typeof getSelectedQuestions>[number];
  accountKeywordOffset: number;
  plannedPublishTime: string;
  error: unknown;
  timestamp: string;
}): ContentPoolItem {
  const failedReason = input.error instanceof Error ? input.error.message : "文章生成失败。";
  const imagePrompt = `${platformLabelMap[input.platform]}配图：${input.keyword.text}，真实产品服务场景，清晰、克制、适合图文发布`;
  return {
    id: `${input.plan.taskId}-${String(input.sequence).padStart(4, "0")}`,
    sequence: input.sequence,
    taskId: input.plan.taskId,
    aiPlatform: input.plan.searchProvider,
    publishPlatform: input.platform,
    accountId: input.accountId,
    accountName: input.accountName,
    keywordId: input.keyword.id,
    keywordSequence: input.keyword.sequence,
    keywordText: input.keyword.text,
    accountKeywordOffset: input.accountKeywordOffset,
    plannedPublishTime: input.plannedPublishTime,
    title: "",
    summary: "",
    body: "",
    imagePrompt,
    imageList: [],
    riskLevel: "high",
    status: "failed",
    pipeline: {
      negativeCheck: { status: "blocked", hits: [failedReason], checkedAt: input.timestamp },
      riskReview: { status: "blocked", level: "high", message: failedReason, reviewedAt: input.timestamp },
      sampleDraft: { status: "blocked", passed: false, checkedAt: input.timestamp },
      styleAdaptation: { status: "blocked", platform: input.platform, notes: [] },
      dispersion: { status: "blocked", changedDimensions: [], message: "生成失败，未进入降重结果。" },
      imageGeneration: { status: "blocked", prompt: imagePrompt, images: [] },
    },
    publishable: false,
    displayStatus: "failed",
    internalStage: "failed",
    stageMessage: failedReason,
    stageLog: [{ stage: "failed", message: failedReason, at: input.timestamp }],
    failedReason,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

function summarizeContentPool(record: ContentPoolRecord): ContentPoolRecord {
  const generatedArticleCount = record.items.filter((item) => item.status === "pending_publish" || item.status === "ready").length;
  const generatingArticleCount = record.items.filter((item) => item.status === "generating").length;
  const failedArticleCount = record.items.filter((item) => item.status === "failed").length;
  const pendingPublishArticleCount = record.items.filter((item) => item.status === "pending_publish").length;
  return {
    ...record,
    totalArticleCount: record.items.length,
    generatedArticleCount,
    generatingArticleCount,
    failedArticleCount,
    pendingPublishArticleCount,
  };
}

function buildRiskFromReview(reviewResult: ReviewResult): { level: ContentPoolRiskLevel; hits: string[]; message: string } {
  if (reviewResult.blockingIssues.length > 0) {
    return {
      level: "high",
      hits: reviewResult.blockingIssues.map((issue) => issue.evidence || issue.message),
      message: `内容审查发现 ${reviewResult.blockingIssues.length} 个阻断问题，需改写后复检。`,
    };
  }
  if (reviewResult.warnings.length > 0) {
    return {
      level: "medium",
      hits: [],
      message: `内容审查发现 ${reviewResult.warnings.length} 个提醒项，需要人工确认或结构化改写。`,
    };
  }
  return {
    level: "low",
    hits: [],
    message: "内容审查通过，可进入发布准备。",
  };
}

function buildPipeline(input: {
  platform: SocialPlatform;
  risk: { level: ContentPoolRiskLevel; hits: string[]; message: string };
  imagePrompt: string;
  isSample: boolean;
  timestamp: string;
}): ContentPoolPipelineState {
  const canPublish = input.risk.level === "low" && input.risk.hits.length === 0;
  return {
    negativeCheck: {
      status: input.risk.hits.length ? "blocked" : "passed",
      hits: input.risk.hits,
      checkedAt: input.timestamp,
    },
    riskReview: {
      status: canPublish ? "passed" : input.risk.level === "medium" ? "needs_action" : "blocked",
      level: input.risk.level,
      message: input.risk.message,
      reviewedAt: input.timestamp,
    },
    sampleDraft: {
      status: input.isSample ? (canPublish ? "passed" : "needs_action") : "passed",
      passed: canPublish || !input.isSample,
      checkedAt: input.timestamp,
    },
    styleAdaptation: {
      status: "passed",
      platform: input.platform,
      notes: [`已按${platformLabelMap[input.platform]}的阅读节奏整理标题、开头和行动建议。`],
    },
    dispersion: {
      status: "passed",
      changedDimensions: dispersionDimensions.slice(0, input.isSample ? 3 : 4),
      message: input.isSample ? "样文已完成基础差异处理。" : "已调整标题、开头、段落顺序和图片提示，降低重复。",
    },
    imageGeneration: {
      status: "pending",
      prompt: input.imagePrompt,
      images: [],
    },
  };
}

async function runContentGenerationBatch(bundle: TaskBundle, initialRecord: ContentPoolRecord, startedAt: string) {
  let record = await saveAndSyncGenerationRecord(bundle.task.id, "generation_running", initialRecord, startedAt);

  const pendingItems = record.items
    .filter((item) => item.status === "pending_generation" || item.status === "generating")
    .sort((left, right) => left.sequence - right.sequence);

  for (const pendingItem of pendingItems) {
    record = markContentPoolItemGenerating(record, pendingItem.id);
    record = await saveAndSyncGenerationRecord(bundle.task.id, "generation_running", record, startedAt);

    try {
      const result = await generateArticleForContentPool({
        taskId: pendingItem.taskId,
        contentItemId: pendingItem.id,
        sequence: pendingItem.sequence,
        product: bundle.product,
        theme: bundle.theme!,
        searchProvider: pendingItem.aiPlatform,
        platform: pendingItem.publishPlatform,
        accountId: pendingItem.accountId,
        accountName: pendingItem.accountName,
        keywordId: pendingItem.keywordId,
        keywordSequence: pendingItem.keywordSequence,
        keywordText: pendingItem.keywordText,
        accountKeywordOffset: pendingItem.accountKeywordOffset,
        plannedPublishTime: pendingItem.plannedPublishTime,
        previousComparableArticles: record.items
          .filter((item) => item.id !== pendingItem.id && item.body && (item.publishPlatform === pendingItem.publishPlatform || item.accountId === pendingItem.accountId))
          .map((item) => ({
            title: item.title,
            summary: item.summary,
            body: item.body,
          })),
      });
      record = replaceContentPoolItem(record, pendingItem.id, result.item);
    } catch (error) {
      record = replaceContentPoolItem(
        record,
        pendingItem.id,
        buildFailedContentPoolItem({
          plan: bundle.task.publishPlan!,
          sequence: pendingItem.sequence,
          platform: pendingItem.publishPlatform,
          accountId: pendingItem.accountId,
          accountName: pendingItem.accountName,
          keyword: {
            id: pendingItem.keywordId,
            text: pendingItem.keywordText,
            sequence: pendingItem.keywordSequence,
          },
          accountKeywordOffset: pendingItem.accountKeywordOffset,
          plannedPublishTime: pendingItem.plannedPublishTime,
          error,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    record = await saveAndSyncGenerationRecord(bundle.task.id, "generation_running", record, startedAt);
  }

  const finishedAt = new Date().toISOString();
  record = {
    ...record,
    updatedAt: finishedAt,
  };
  return saveAndSyncGenerationRecord(bundle.task.id, "generation_completed", record, startedAt, finishedAt);
}

function launchContentGenerationBatch(bundle: TaskBundle, record: ContentPoolRecord, startedAt: string) {
  activeGenerationTasks.add(bundle.task.id);
  void runContentGenerationBatch(bundle, record, startedAt)
    .catch(async (error) => {
      await markTaskFailed(bundle.task.id, "content_generation", error instanceof Error ? error.message : "内容生成失败。");
    })
    .finally(() => {
      activeGenerationTasks.delete(bundle.task.id);
    });
}

export async function getCurrentContentPool() {
  const bundles = await listTaskBundles();
  const currentBundle = bundles.find((bundle) => Boolean(bundle.task.publishPlan)) ?? null;
  if (!currentBundle?.task.publishPlan) {
    return { current: null, history: await listContentPools() };
  }

  const existing = await getContentPool(currentBundle.task.id);
  if (existing) {
    await resumeContentPoolQueuesIfNeeded(currentBundle.task.id, currentBundle, existing);
  }
  const latestExisting = await getContentPool(currentBundle.task.id);
  const current =
    latestExisting && latestExisting.sourcePublishPlanUpdatedAt === currentBundle.task.publishPlan.updatedAt
      ? summarizeContentPool(latestExisting)
      : null;
  const history = (await listContentPools())
    .filter((record) => record.taskId !== current?.taskId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return { current, history };
}

export async function startContentGenerationBatch(taskId: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.task.publishPlan) {
    throw new Error("请先保存发布计划。");
  }

  if (activeGenerationTasks.has(taskId)) {
    const existing = await getContentPool(taskId);
    if (existing) {
      return summarizeContentPool(existing);
    }
    throw new Error("当前任务正在生成，请稍后刷新。");
  }

  const startedAt = new Date().toISOString();
  const initialRecord = await saveContentPool(await buildPendingContentPoolRecord(bundle, bundle.task.publishPlan));
  await updateTaskStatus(taskId, "generation_queued", {
    generationStartedAt: startedAt,
    generationFinishedAt: undefined,
    generationProgress: 0,
    generatedArticleCount: 0,
    failedArticleCount: 0,
  });
  activeGenerationTasks.add(taskId);
  try {
    return await runContentGenerationBatch(bundle, initialRecord, startedAt);
  } finally {
    activeGenerationTasks.delete(taskId);
  }
}

export async function enqueueContentGenerationBatch(taskId: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.task.publishPlan) {
    throw new Error("请先保存发布计划。");
  }

  if (activeGenerationTasks.has(taskId)) {
    const existing = await getContentPool(taskId);
    return { current: existing ? summarizeContentPool(existing) : null, alreadyRunning: true };
  }

  const startedAt = new Date().toISOString();
  const initialRecord = await saveContentPool(await buildPendingContentPoolRecord(bundle, bundle.task.publishPlan));
  await updateTaskStatus(taskId, "generation_queued", {
    generationStartedAt: startedAt,
    generationFinishedAt: undefined,
    generationProgress: 0,
    generatedArticleCount: 0,
    failedArticleCount: 0,
  });

  launchContentGenerationBatch(bundle, initialRecord, startedAt);

  return { current: summarizeContentPool(initialRecord), alreadyRunning: false };
}

async function enqueueResumedContentGenerationBatch(taskId: string, bundle?: TaskBundle | null, record?: ContentPoolRecord | null) {
  const resolvedBundle = bundle ?? (await getTaskBundle(taskId));
  const resolvedRecord = record ?? (await getContentPool(taskId));
  if (!resolvedBundle?.task.publishPlan || !resolvedBundle.theme || !resolvedRecord) {
    return { current: resolvedRecord ? summarizeContentPool(resolvedRecord) : null, alreadyRunning: false };
  }
  if (activeGenerationTasks.has(taskId)) {
    return { current: summarizeContentPool(resolvedRecord), alreadyRunning: true };
  }
  const startedAt = resolvedBundle.task.generationStartedAt || resolvedRecord.generatedAt || new Date().toISOString();
  launchContentGenerationBatch(resolvedBundle, resolvedRecord, startedAt);
  return { current: summarizeContentPool(resolvedRecord), alreadyRunning: false };
}

export async function regenerateCurrentContentPool() {
  const bundles = await listTaskBundles();
  const currentBundle = bundles.find((bundle) => Boolean(bundle.task.publishPlan));
  if (!currentBundle?.task.publishPlan) {
    throw new Error("请先保存发布任务。");
  }
  return enqueueContentGenerationBatch(currentBundle.task.id);
}

export async function getContentGenerationStatus(taskId?: string) {
  if (taskId) {
    const [record, bundle] = await Promise.all([getContentPool(taskId), getTaskBundle(taskId)]);
    await resumeContentPoolQueuesIfNeeded(taskId, bundle, record);
    const latestRecord = await getContentPool(taskId);
    const latestBundle = await getTaskBundle(taskId);
    return {
      current: latestRecord ? summarizeContentPool(latestRecord) : null,
      task: latestBundle?.task ?? null,
      history: [],
    };
  }
  const data = await getCurrentContentPool();
  return { ...data, task: data.current ? (await getTaskBundle(data.current.taskId))?.task ?? null : null };
}

function mapItems(record: ContentPoolRecord, mapper: (item: ContentPoolItem) => ContentPoolItem) {
  return {
    ...record,
    items: record.items.map(mapper),
    updatedAt: new Date().toISOString(),
  };
}

export async function rewriteContentPoolItem(taskId: string, itemId: string) {
  const record = await getContentPool(taskId);
  if (!record) throw new Error("内容池不存在。");
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.task.publishPlan || !bundle.theme) {
    throw new Error("任务主题或发布计划不存在。");
  }
  const currentItem = record.items.find((item) => item.id === itemId);
  if (!currentItem) {
    throw new Error("内容项不存在。");
  }
  const comparableItems = record.items
    .filter((item) => item.id !== itemId && item.body && (item.publishPlatform === currentItem.publishPlatform || item.accountId === currentItem.accountId))
    .map((item) => ({
      title: item.title,
      summary: item.summary,
      body: item.body,
    }));
  if (currentItem.body) {
    comparableItems.push({
      title: currentItem.title,
      summary: currentItem.summary,
      body: currentItem.body,
    });
  }

  const generatingRecord = markContentPoolItemGenerating(record, itemId);
  await saveContentPool(generatingRecord);
  const result = await generateArticleForContentPool({
    taskId,
    contentItemId: currentItem.id,
    sequence: currentItem.sequence,
    product: bundle.product,
    theme: bundle.theme,
    searchProvider: currentItem.aiPlatform,
    platform: currentItem.publishPlatform,
    accountId: currentItem.accountId,
    accountName: currentItem.accountName,
    keywordId: currentItem.keywordId,
    keywordSequence: currentItem.keywordSequence,
    keywordText: currentItem.keywordText,
    accountKeywordOffset: currentItem.accountKeywordOffset,
    plannedPublishTime: currentItem.plannedPublishTime,
    previousComparableArticles: comparableItems,
  });
  const nextItem: ContentPoolItem = {
    ...result.item,
    generationAttemptCount: (currentItem.generationAttemptCount ?? 1) + 1,
    rewriteAttemptCount: (currentItem.rewriteAttemptCount ?? 0) + 1,
    dedupeAttemptCount: Math.max(result.item.dedupeAttemptCount ?? 1, currentItem.dedupeAttemptCount ?? 0),
    reviewAttemptCount: (currentItem.reviewAttemptCount ?? 0) + 1,
    stageLog: [
      ...(currentItem.stageLog ?? []),
      { stage: "draft_generating", message: "已重新进入文章黑盒处理链路。", at: new Date().toISOString() },
      ...(result.item.stageLog ?? []),
    ],
  };
  return saveContentPool(replaceContentPoolItem(generatingRecord, itemId, nextItem));
}

export async function confirmMediumRiskContentPoolItem(taskId: string, itemId: string) {
  const record = await getContentPool(taskId);
  if (!record) throw new Error("内容池不存在。");
  const currentItem = record.items.find((item) => item.id === itemId);
  if (!currentItem) {
    throw new Error("内容项不存在。");
  }
  if (currentItem.pipeline.negativeCheck.hits.length > 0 || currentItem.riskLevel === "high") {
    return rewriteContentPoolItem(taskId, itemId);
  }

  const timestamp = new Date().toISOString();
  const next = mapItems(record, (item) => {
    if (item.id !== itemId) return item;
    return {
      ...item,
      pipeline: {
        ...item.pipeline,
        riskReview: { status: "passed", level: "low", message: "系统已完成风险边界确认，可进入发布准备。", reviewedAt: timestamp },
      },
      riskLevel: "low",
      status: "pending_publish",
      publishable: true,
      reviewAttemptCount: (item.reviewAttemptCount ?? 0) + 1,
      stageLog: [...(item.stageLog ?? []), { stage: "quality_passed", message: "系统已完成风险边界确认。", at: timestamp }],
      updatedAt: timestamp,
    };
  });
  return saveContentPool(next);
}

export async function disperseContentPoolItem(taskId: string, itemId: string) {
  const record = await getContentPool(taskId);
  if (!record) throw new Error("内容池不存在。");
  return rewriteContentPoolItem(taskId, itemId);
}

async function runRetryFailedContentPoolItems(taskId: string) {
  const record = await getContentPool(taskId);
  if (!record) {
    throw new Error("内容池不存在。");
  }

  let currentRecord = await saveRetryQueueRecord(markRetryQueueState(record, "running", new Date().toISOString()));

  const retryTargets = currentRecord.items
    .filter((item) => item.status === "generating" || item.status === "failed" || item.riskLevel === "high")
    .sort((left, right) => left.sequence - right.sequence);

  for (const item of retryTargets) {
    await rewriteContentPoolItem(taskId, item.id);
    currentRecord = (await getContentPool(taskId)) ?? currentRecord;
  }

  const finishedRecord = (await getContentPool(taskId)) ?? currentRecord;
  return saveRetryQueueRecord(markRetryQueueState(finishedRecord, "idle", new Date().toISOString()));
}

export async function enqueueRetryFailedContentPoolItems(taskId: string) {
  const record = await getContentPool(taskId);
  if (!record) {
    throw new Error("内容池不存在。");
  }

  if (activeRetryTasks.has(taskId)) {
    return { current: summarizeContentPool(record), alreadyRunning: true };
  }

  const queuedRecord = await saveRetryQueueRecord(markRetryQueueState(record, "queued", new Date().toISOString()));
  activeRetryTasks.add(taskId);
  void runRetryFailedContentPoolItems(taskId).finally(() => {
    activeRetryTasks.delete(taskId);
  });

  return { current: summarizeContentPool(queuedRecord), alreadyRunning: false };
}

async function resumeContentPoolQueuesIfNeeded(taskId: string, bundle?: TaskBundle | null, record?: ContentPoolRecord | null) {
  const resolvedBundle = bundle ?? (await getTaskBundle(taskId));
  const resolvedRecord = record ?? (await getContentPool(taskId));
  if (!resolvedBundle?.task.publishPlan || !resolvedRecord) {
    return;
  }

  if (resolvedBundle.task.status === "failed" && hasPendingGenerationItems(resolvedRecord)) {
    await saveContentPool(reconcileInterruptedGenerationRecord(resolvedRecord, resolvedBundle.task));
    return;
  }

  const needsGenerationResume =
    generationResumeStatuses.has(resolvedBundle.task.status) &&
    hasPendingGenerationItems(resolvedRecord);

  if (needsGenerationResume) {
    await enqueueResumedContentGenerationBatch(taskId, resolvedBundle, resolvedRecord);
    return;
  }

  if (generationResumeStatuses.has(resolvedBundle.task.status) && !hasPendingGenerationItems(resolvedRecord)) {
    await saveAndSyncGenerationRecord(
      taskId,
      "generation_completed",
      {
        ...resolvedRecord,
        updatedAt: new Date().toISOString(),
      },
      resolvedBundle.task.generationStartedAt || resolvedRecord.generatedAt,
      resolvedBundle.task.generationFinishedAt || new Date().toISOString(),
    );
    return;
  }

  const retryQueueRunning = resolvedRecord.retryQueueStatus === "queued" || resolvedRecord.retryQueueStatus === "running";
  if (retryQueueRunning && hasRetryQueueItems(resolvedRecord)) {
    await enqueueRetryFailedContentPoolItems(taskId);
    return;
  }

  if (retryQueueRunning && !hasRetryQueueItems(resolvedRecord)) {
    await saveRetryQueueRecord(markRetryQueueState(resolvedRecord, "idle", new Date().toISOString()));
  }
}
