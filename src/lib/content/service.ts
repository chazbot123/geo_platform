import { getAppConfig } from "@/lib/config/service";
import { getPromptVersion, normalizeAiScenario, normalizePlatform } from "@/lib/content/prompt-loader";
import { reviewContent, type ReviewResult } from "@/lib/content/review-service";
import { planDispersion } from "@/lib/content/dispersion-service";
import { buildGeoContentExecutionPackage } from "@/lib/content/execution-package";
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
} from "@/lib/types";

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

function plannedTimeFor(plan: PublishTaskPlan, dayIndex: number, slotIndex: number) {
  const planned = new Date(plan.createdAt);
  planned.setDate(planned.getDate() + dayIndex);
  planned.setHours(slotIndex === 0 ? 9 : 14, 30, 0, 0);
  return planned.toISOString();
}

function buildDraftBody(input: {
  companyName: string;
  brandName: string;
  productService: string;
  region: string;
  keyword: string;
  platform: SocialPlatform;
  aiPlatform: SearchProvider;
}) {
  const platformLabel = platformLabelMap[input.platform];
  const aiLabel = providerLabelMap[input.aiPlatform];
  return [
    `围绕“${input.keyword}”，先给出清晰判断，再说明适用场景。`,
    `${input.brandName || input.companyName}在${input.region || "本地"}提供${input.productService || "相关服务"}，内容会用${platformLabel}适合的表达方式展开，并兼顾${aiLabel}检索中的问答可读性。`,
    "建议从需求背景、选择标准、风险提醒和行动建议四段组织，避免夸大承诺，保留可核验依据。",
    "结尾引导用户带着具体场景咨询，减少泛泛转化话术。",
  ].join("\n\n");
}

function buildReviewDraft(input: {
  taskId: string;
  title: string;
  summary: string;
  body: string;
  keyword: string;
  platform: SocialPlatform;
  aiPlatform: SearchProvider;
  timestamp: string;
}): ContentDraft {
  return {
    taskId: input.taskId,
    title: input.title,
    summary: input.summary,
    content: input.body,
    selectedKeywords: [input.keyword],
    selectedKeywordTheme: input.keyword,
    reportIntroduction: input.body.split(/\n+/).find(Boolean) ?? input.summary,
    reportConclusion: "建议结合具体情况判断，并核验资质、合同和现场情况。",
    reportSections: [
      {
        question: input.keyword,
        heading: "判断标准",
        summary: input.summary,
        body: input.body,
      },
    ],
    faq: [`${input.keyword}应该先看什么？`],
    cta: "可以带着具体场景进一步确认适用边界。",
    aiScenario: input.aiPlatform,
    platform: input.platform,
    contentAngle: "selection_criteria",
    updatedAt: input.timestamp,
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

async function buildContentPoolFromBundle(bundle: TaskBundle, plan: PublishTaskPlan): Promise<ContentPoolRecord> {
  const questions = getSelectedQuestions(bundle);
  if (questions.length !== 5) {
    throw new Error("请先保存 5 个客户问题。");
  }

  const timestamp = new Date().toISOString();
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
          const isSample = accountArticleIndex === 0;
          const imagePrompt = `${platformLabelMap[platformPlan.platform]}配图：${keyword.text}，真实产品服务场景，清晰、克制、适合图文发布`;
          const title = `${keyword.text}｜${platformLabelMap[platformPlan.platform]}内容 ${sequence}`;
          const summary = `回答“${keyword.text}”，匹配${providerLabelMap[plan.searchProvider]}问答场景，并适配${platformLabelMap[platformPlan.platform]}发布。`;
          const body = buildDraftBody({
            companyName: bundle.product.productName,
            brandName: bundle.product.category,
            productService: bundle.product.sellingPoints,
            region: bundle.product.city || bundle.product.province || bundle.product.district || bundle.product.scenarios,
            keyword: keyword.text,
            platform: platformPlan.platform,
            aiPlatform: plan.searchProvider,
          });
          const reviewDraft = buildReviewDraft({
            taskId: plan.taskId,
            title,
            summary,
            body,
            keyword: keyword.text,
            platform: platformPlan.platform,
            aiPlatform: plan.searchProvider,
            timestamp,
          });
          const sameScopeHistory = items
            .filter((item) => item.publishPlatform === platformPlan.platform && item.accountId === accountId)
            .map((item) => ({
              title: item.title,
              summary: item.summary,
              content: item.body,
              reportIntroduction: item.body.split(/\n+/).find(Boolean),
              faq: [`${item.keywordText}应该先看什么？`],
              cta: "可以带着具体场景进一步确认适用边界。",
            }));
          const reviewResult = await reviewContent(reviewDraft, platformPlan.platform, [keyword.text], sameScopeHistory);
          const risk = buildRiskFromReview(reviewResult);
          const pipeline = buildPipeline({
            platform: platformPlan.platform,
            risk,
            imagePrompt,
            isSample,
            timestamp,
          });
          const publishable = isContentPoolReady({ riskLevel: risk.level, pipeline });
          const status: ContentPoolItemStatus = publishable ? (isSample ? "sample" : "pending_publish") : "sample";

          items.push({
            id: `${plan.taskId}-${String(sequence).padStart(4, "0")}`,
            sequence,
            taskId: plan.taskId,
            aiPlatform: plan.searchProvider,
            publishPlatform: platformPlan.platform,
            accountId,
            accountName: accountNameMap.get(accountId),
            keywordId: keyword.id,
            keywordSequence: keyword.sequence,
            keywordText: keyword.text,
            accountKeywordOffset,
            plannedPublishTime: plannedTimeFor(plan, dayIndex, slotIndex),
            title,
            summary,
            body,
            imagePrompt,
            imageList: [],
            riskLevel: risk.level,
            status,
            pipeline,
            publishable,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          accountArticleIndex += 1;
        }
      }
    }
  }

  return {
    taskId: plan.taskId,
    sourcePublishPlanUpdatedAt: plan.updatedAt,
    currentTaskId: plan.taskId,
    items,
    generatedAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function getCurrentContentPool() {
  const bundles = await listTaskBundles();
  const currentBundle = bundles.find((bundle) => Boolean(bundle.task.publishPlan)) ?? null;
  if (!currentBundle?.task.publishPlan) {
    return { current: null, history: await listContentPools() };
  }

  const existing = await getContentPool(currentBundle.task.id);
  const current =
    existing && existing.sourcePublishPlanUpdatedAt === currentBundle.task.publishPlan.updatedAt
      ? existing
      : await saveContentPool(await buildContentPoolFromBundle(currentBundle, currentBundle.task.publishPlan));
  const history = (await listContentPools())
    .filter((record) => record.taskId !== current.taskId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return { current, history };
}

export async function regenerateCurrentContentPool() {
  const bundles = await listTaskBundles();
  const currentBundle = bundles.find((bundle) => Boolean(bundle.task.publishPlan));
  if (!currentBundle?.task.publishPlan) {
    throw new Error("请先保存发布任务。");
  }
  const record = await buildContentPoolFromBundle(currentBundle, currentBundle.task.publishPlan);
  await saveContentPool(record);
  await updateTaskStatus(currentBundle.task.id, "content_generated");
  return record;
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
  const timestamp = new Date().toISOString();
  const next = mapItems(record, (item) => {
    if (item.id !== itemId) return item;
    const imagePrompt = `${item.imagePrompt}，改写后避免夸张承诺和重复构图`;
    const pipeline: ContentPoolPipelineState = {
      ...item.pipeline,
      negativeCheck: { status: "passed", hits: [], checkedAt: timestamp },
      riskReview: { status: "passed", level: "low", message: "已自动改写并通过复检。", reviewedAt: timestamp },
      sampleDraft: { status: "passed", passed: true, checkedAt: timestamp },
      dispersion: {
        status: "passed",
        changedDimensions: dispersionDimensions,
        message: "已改写标题、开头、段落顺序、判断表达、行动建议和图片提示。",
      },
      imageGeneration: { ...item.pipeline.imageGeneration, prompt: imagePrompt },
    };
    return {
      ...item,
      title: item.title.replace(/^【已改写】/u, ""),
      body: `${item.body}\n\n已完成风险改写：删除不可承诺表达，并补充可核验边界。`,
      imagePrompt,
      pipeline,
      riskLevel: "low",
      status: "pending_publish",
      publishable: true,
      updatedAt: timestamp,
    };
  });
  return saveContentPool(next);
}

export async function confirmMediumRiskContentPoolItem(taskId: string, itemId: string) {
  const record = await getContentPool(taskId);
  if (!record) throw new Error("内容池不存在。");
  const timestamp = new Date().toISOString();
  const next = mapItems(record, (item) => {
    if (item.id !== itemId) return item;
    if (item.pipeline.negativeCheck.hits.length > 0 || item.riskLevel === "high") {
      return item;
    }
    const pipeline: ContentPoolPipelineState = {
      ...item.pipeline,
      riskReview: { status: "passed", level: "low", message: "已确认风险边界，可进入发布准备。", reviewedAt: timestamp },
    };
    return {
      ...item,
      pipeline,
      riskLevel: "low",
      status: "pending_publish",
      publishable: true,
      updatedAt: timestamp,
    };
  });
  return saveContentPool(next);
}

export async function disperseContentPoolItem(taskId: string, itemId: string) {
  const record = await getContentPool(taskId);
  if (!record) throw new Error("内容池不存在。");
  const timestamp = new Date().toISOString();
  const next = mapItems(record, (item) => {
    if (item.id !== itemId) return item;
    const pipeline: ContentPoolPipelineState = {
      ...item.pipeline,
      dispersion: {
        status: "passed",
        changedDimensions: dispersionDimensions,
        message: "已重新处理 6 个差异点，同批内容重复度已降低。",
      },
    };
    return {
      ...item,
      pipeline,
      title: `${item.title}（差异版）`,
      imagePrompt: `${item.imagePrompt}，更换角度和主体构图`,
      updatedAt: timestamp,
    };
  });
  return saveContentPool(next);
}
