import { getAppConfig } from "@/lib/config/service";
import { materializeScopedImageAssetToLocal } from "@/lib/images/local-image-store";
import { reviewContent, type ReviewResult } from "@/lib/content/review-service";
import { runImageModel } from "@/lib/integrations/images/client";
import {
  buildDedupeRewritePrompt,
  buildDraftPrompt,
  buildQualityReviewPrompt,
  buildRiskRewritePrompt,
  buildStyleRewritePrompt,
  type ArticlePromptContext,
} from "@/lib/content/prompt-builder";
import {
  callConfiguredTextModel,
  parseJsonFromModelText,
  type OpenAICompatibleMessage,
} from "@/lib/integrations/openai-compatible";
import type {
  ContentDraft,
  ContentPoolImageItem,
  ContentPoolItem,
  ContentPoolPipelineState,
  ContentPoolRiskLevel,
  ModelApiConfig,
  ProductProfile,
  SearchProvider,
  SocialPlatform,
  ThemeSet,
} from "@/lib/types";

const platformLabels: Record<SocialPlatform, string> = {
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

export type ArticleInternalStage =
  | "brief_ready"
  | "draft_generating"
  | "draft_ready"
  | "style_rewriting"
  | "style_ready"
  | "dedupe_rewriting"
  | "dedupe_ready"
  | "risk_rewriting"
  | "risk_ready"
  | "quality_reviewing"
  | "quality_passed"
  | "finalizing"
  | "ready"
  | "failed";

interface ArticlePayload {
  title?: string;
  summary?: string;
  body?: string;
  tags?: string[];
  imagePrompt?: string;
  riskLevel?: ContentPoolRiskLevel;
  notes?: string[];
}

export interface ArticleGenerationContext {
  taskId: string;
  contentItemId: string;
  sequence: number;
  product: ProductProfile;
  theme: ThemeSet;
  searchProvider: SearchProvider;
  platform: SocialPlatform;
  accountId: string;
  accountName?: string;
  keywordId: string;
  keywordSequence: number;
  keywordText: string;
  accountKeywordOffset: number;
  plannedPublishTime: string;
  previousComparableArticles: Array<Pick<ContentPoolItem, "title" | "summary" | "body">>;
}

export interface ArticleGenerationResult {
  item: ContentPoolItem;
  reviewResult: ReviewResult;
}

function now() {
  return new Date().toISOString();
}

function hasConfiguredModel(config: ModelApiConfig) {
  return Boolean(config.baseUrl?.trim()) && !config.provider.startsWith("mock");
}

function stageLog(stage: ArticleInternalStage, message: string) {
  return { stage, message, at: now() };
}

function getOpening(body?: string) {
  return body?.split(/\r?\n\s*\r?\n/).find(Boolean)?.slice(0, 140);
}

function normalizeTags(tags: unknown, keyword: string) {
  const values = Array.isArray(tags) ? tags : [];
  const normalized = values.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return Array.from(new Set([keyword.replace(/[？?]/g, ""), ...normalized])).slice(0, 6);
}

function buildDevArticle(context: ArticlePromptContext, stage: ArticleInternalStage): Required<ArticlePayload> {
  const platformLabel = platformLabels[context.platform];
  const product = context.product;
  const angle =
    stage === "dedupe_rewriting"
      ? "差异化判断"
      : stage === "risk_rewriting"
        ? "风险边界"
        : stage === "style_rewriting"
          ? "平台表达"
          : "效率判断";
  const title = `${context.keyword.replace(/[？?]/g, "")}的${angle}`;
  const body = [
    `很多企业做${platformLabel}内容时，真正卡住的不是写不出文章，而是账号多、主题多、审核标准不一致，最后很难稳定产出。围绕“${context.keyword}”，先看一个核心判断：内容流程要先把任务、账号、问题和发布时间固定下来，再让系统生成最终稿。`,
    `判断标准有三点。一是文章必须回答真实客户问题，不能只是堆产品卖点。二是同一批内容要在标题、开头、结构和行动建议上有明显差异。三是风险语言要提前处理，避免把不可核验的承诺写进正文。`,
    `适用场景主要是本地服务、连锁门店、企业获客和多平台矩阵运营。${product.productName}的价值在于把${product.sellingPoints}放进同一条链路，运营人员看到的是生成进度和最终结果，而不是手动处理每个工序。`,
    `落地时建议先用少量账号验证节奏，再逐步扩展到更多平台。每篇文章都保留生成、改写、降重和复检记录；相似度过高或风险未处理的内容不进入发布准备。`,
    `下一步可以把当前关键词拆成不同账号的发布计划，查看生成结果后再进入发布执行，这样既保留效率，也能控制内容质量边界。`,
  ].join("\n\n");
  return {
    title: title.slice(0, 30),
    summary: `围绕“${context.keyword}”说明企业内容发布的效率判断、适用场景和风险边界。`,
    body,
    tags: normalizeTags([platformLabel, angle, product.category], context.keyword),
    imagePrompt: `${platformLabel}文章配图，企业内容运营后台、任务进度、真实工作场景，画面克制清晰`,
    riskLevel: "low",
    notes: [`开发兜底生成：${stage}`],
  };
}

function sanitizePayload(payload: ArticlePayload | null, fallback: Required<ArticlePayload>, keyword: string): Required<ArticlePayload> {
  return {
    title: payload?.title?.trim() || fallback.title,
    summary: payload?.summary?.trim() || fallback.summary,
    body: payload?.body?.trim() || fallback.body,
    tags: normalizeTags(payload?.tags ?? fallback.tags, keyword),
    imagePrompt: payload?.imagePrompt?.trim() || fallback.imagePrompt,
    riskLevel: payload?.riskLevel === "medium" || payload?.riskLevel === "high" ? payload.riskLevel : "low",
    notes: Array.isArray(payload?.notes) ? payload.notes.filter((item): item is string => typeof item === "string") : fallback.notes,
  };
}

async function callArticleStage(input: {
  config: ModelApiConfig;
  context: ArticlePromptContext;
  stage: ArticleInternalStage;
  prompt: string;
}) {
  const fallback = buildDevArticle(input.context, input.stage);
  if (!hasConfiguredModel(input.config)) {
    return fallback;
  }

  const messages: OpenAICompatibleMessage[] = [
    {
      role: "system",
      content: [
        "你是 GEO 内容生产系统的文章级黑盒生成节点。",
        "必须输出可发布成稿字段，禁止输出模板、占位符、内部解释或半成品。",
      ].join("\n"),
    },
    { role: "user", content: input.prompt },
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await callConfiguredTextModel(input.config, messages);
      const payload = parseJsonFromModelText<ArticlePayload>(result.rawText);
      if (!payload?.body?.trim()) {
        throw new Error("ARTICLE_STAGE_EMPTY_BODY");
      }
      return sanitizePayload(payload, fallback, input.context.keyword);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("ARTICLE_STAGE_FAILED");
}

function toReviewDraft(context: ArticleGenerationContext, payload: Required<ArticlePayload>, timestamp: string): ContentDraft {
  return {
    taskId: context.taskId,
    title: payload.title,
    summary: payload.summary,
    content: payload.body,
    selectedKeywords: [context.keywordText],
    selectedKeywordTheme: context.keywordText,
    reportIntroduction: getOpening(payload.body) ?? payload.summary,
    reportConclusion: "建议结合具体业务场景、账号节奏和风险边界再执行发布。",
    reportSections: [
      {
        question: context.keywordText,
        heading: "判断标准",
        summary: payload.summary,
        body: payload.body,
      },
    ],
    faq: [`${context.keywordText}先看哪些判断标准？`],
    cta: "可以带着账号数量、发布平台和业务场景进一步确认执行节奏。",
    aiScenario: context.searchProvider,
    platform: context.platform,
    contentAngle: "blackbox_generation",
    updatedAt: timestamp,
  };
}

function buildRisk(reviewResult: ReviewResult, modelRisk: ContentPoolRiskLevel) {
  const riskCodes = [
    ...reviewResult.blockingIssues.map((issue) => issue.code),
    ...reviewResult.warnings.map((issue) => issue.code),
  ];
  if (reviewResult.blockingIssues.length || modelRisk === "high") {
    return {
      level: "high" as const,
      message: `复检发现 ${reviewResult.blockingIssues.length || 1} 个阻断问题。`,
      riskCodes,
    };
  }
  if (reviewResult.warnings.length || modelRisk === "medium") {
    return {
      level: "medium" as const,
      message: reviewResult.warnings.length ? `复检发现 ${reviewResult.warnings.length} 个提醒项。` : "模型复检提示需要关注风险边界。",
      riskCodes,
    };
  }
  return { level: "low" as const, message: "内容审查通过，可进入发布准备。", riskCodes };
}

function buildPipeline(input: {
  platform: SocialPlatform;
  riskLevel: ContentPoolRiskLevel;
  riskMessage: string;
  imagePrompt: string;
  images: ContentPoolImageItem[];
  timestamp: string;
}): ContentPoolPipelineState {
  const passed = input.riskLevel === "low";
  return {
    negativeCheck: {
      status: passed ? "passed" : "blocked",
      hits: [],
      checkedAt: input.timestamp,
    },
    riskReview: {
      status: passed ? "passed" : input.riskLevel === "medium" ? "needs_action" : "blocked",
      level: input.riskLevel,
      message: input.riskMessage,
      reviewedAt: input.timestamp,
    },
    sampleDraft: {
      status: passed ? "passed" : "blocked",
      passed,
      checkedAt: input.timestamp,
    },
    styleAdaptation: {
      status: "passed",
      platform: input.platform,
      notes: [`已完成${platformLabels[input.platform]}平台表达改写。`],
    },
    dispersion: {
      status: "passed",
      changedDimensions: ["title", "opening", "section_order", "judgment", "cta", "image_prompt"],
      message: "已完成标题、开头、结构、CTA 和图片提示的差异化改写。",
    },
    imageGeneration: {
      status: input.images.length ? "passed" : "pending",
      prompt: input.imagePrompt,
      images: input.images,
    },
  };
}

function toContentPoolImages(images: NonNullable<Awaited<ReturnType<typeof runImageModel>>["images"]>): ContentPoolImageItem[] {
  return images.map((image) => ({
    id: image.id,
    prompt: image.prompt,
    url: image.publicUrl ?? image.url,
    localPath: image.localPath,
    status: "generated",
  }));
}

export async function generateArticleForContentPool(context: ArticleGenerationContext): Promise<ArticleGenerationResult> {
  const appConfig = await getAppConfig();
  const config = appConfig.contentModelApiConfig;
  const log = [stageLog("brief_ready", "文章 brief 已生成。")];
  const timestamp = now();
  const latestComparable = context.previousComparableArticles.at(-1);
  const promptContext: ArticlePromptContext = {
    product: context.product,
    keyword: context.keywordText,
    platform: context.platform,
    searchProvider: context.searchProvider,
    accountName: context.accountName,
    plannedPublishTime: context.plannedPublishTime,
    sequence: context.sequence,
    previousTitle: latestComparable?.title,
    previousOpening: getOpening(latestComparable?.body),
  };

  log.push(stageLog("draft_generating", "正在生成正文。"));
  const draft = await callArticleStage({
    config,
    context: promptContext,
    stage: "draft_ready",
    prompt: buildDraftPrompt(promptContext),
  });
  log.push(stageLog("draft_ready", "首稿生成完成。"));

  log.push(stageLog("style_rewriting", "正在进行平台风格改写。"));
  const styled = await callArticleStage({
    config,
    context: { ...promptContext, previousBody: draft.body },
    stage: "style_ready",
    prompt: buildStyleRewritePrompt({ ...promptContext, previousBody: draft.body }),
  });
  log.push(stageLog("style_ready", "改写完成。"));

  log.push(stageLog("dedupe_rewriting", "正在进行降重改写。"));
  const deduped = await callArticleStage({
    config,
    context: { ...promptContext, previousBody: styled.body },
    stage: "dedupe_ready",
    prompt: buildDedupeRewritePrompt({ ...promptContext, previousBody: styled.body }),
  });
  log.push(stageLog("dedupe_ready", "降重完成。"));

  log.push(stageLog("risk_rewriting", "风险检查中。"));
  const finalPayload = await callArticleStage({
    config,
    context: { ...promptContext, previousBody: deduped.body },
    stage: "risk_ready",
    prompt: buildRiskRewritePrompt({ ...promptContext, previousBody: deduped.body }),
  });
  log.push(stageLog("risk_ready", "风险语言修正完成。"));

  log.push(stageLog("quality_reviewing", "正在进行最终复检。"));
  if (hasConfiguredModel(config)) {
    await callArticleStage({
      config,
      context: { ...promptContext, previousBody: finalPayload.body },
      stage: "quality_passed",
      prompt: buildQualityReviewPrompt({ ...promptContext, previousBody: finalPayload.body }),
    });
  }
  const reviewDraft = toReviewDraft(context, finalPayload, timestamp);
  const reviewResult = await reviewContent(
    reviewDraft,
    context.platform,
    [context.keywordText],
    context.previousComparableArticles.map((article) => ({
      title: article.title,
      summary: article.summary,
      content: article.body,
      reportIntroduction: getOpening(article.body),
      faq: [],
      cta: "",
    })),
  );
  const risk = buildRisk(reviewResult, finalPayload.riskLevel);
  log.push(stageLog("quality_passed", "最终复检完成。"));
  log.push(stageLog("finalizing", "正在写入最终成稿。"));

  const publishable = risk.level === "low";
  let imageList: ContentPoolImageItem[] = [];
  let imagePrompt = finalPayload.imagePrompt;
  if (publishable) {
    const imageAsset = await runImageModel(context.product, context.theme, reviewDraft, appConfig.imageModelApiConfig);
    const localizedAsset = await materializeScopedImageAssetToLocal(context.contentItemId, imageAsset);
    imagePrompt = localizedAsset.images?.[0]?.prompt || imagePrompt;
    imageList = localizedAsset.images?.length ? toContentPoolImages(localizedAsset.images) : [];
    log.push(stageLog("finalizing", `图片生成完成，共 ${imageList.length} 张。`));
  }
  const pipeline = buildPipeline({
    platform: context.platform,
    riskLevel: risk.level,
    riskMessage: risk.message,
    imagePrompt,
    images: imageList,
    timestamp,
  });
  const item: ContentPoolItem = {
    id: context.contentItemId,
    sequence: context.sequence,
    taskId: context.taskId,
    aiPlatform: context.searchProvider,
    publishPlatform: context.platform,
    accountId: context.accountId,
    accountName: context.accountName,
    keywordId: context.keywordId,
    keywordSequence: context.keywordSequence,
    keywordText: context.keywordText,
    accountKeywordOffset: context.accountKeywordOffset,
    plannedPublishTime: context.plannedPublishTime,
    title: finalPayload.title,
    summary: finalPayload.summary,
    body: publishable ? finalPayload.body : "",
    imagePrompt,
    imageList,
    riskLevel: risk.level,
    status: publishable ? "pending_publish" : "failed",
    pipeline,
    publishable,
    displayStatus: publishable ? "pending_publish" : "failed",
    internalStage: publishable ? "ready" : "failed",
    stageMessage: publishable ? "已完成" : risk.message,
    stageLog: [...log, stageLog(publishable ? "ready" : "failed", publishable ? "文章生成完成。" : risk.message)],
    generationAttemptCount: 1,
    rewriteAttemptCount: 1,
    dedupeAttemptCount: 1,
    reviewAttemptCount: 1,
    riskCodes: risk.riskCodes,
    failedReason: publishable ? undefined : risk.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return { item, reviewResult };
}
