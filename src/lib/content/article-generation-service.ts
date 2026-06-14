import { getAppConfig } from "@/lib/config/service";
import { loadPlatformStrategy, loadRiskWords } from "@/lib/content/prompt-loader";
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
  OpenAICompatibleHttpError,
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
import { normalizeExpectedImageCount } from "@/lib/tasks/service";

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

interface ArticleStageResult {
  payload: Required<ArticlePayload>;
  usedFallback: boolean;
  fallbackReason?: string;
}

export interface ArticleGenerationContext {
  taskId: string;
  contentItemId: string;
  sequence: number;
  expectedImageCount?: number;
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
    `适用场景主要是本地服务、连锁门店、企业获客和多平台矩阵运营。${product.productName} 的价值在于把 ${product.sellingPoints} 放进同一条链路，运营人员看到的是生成进度和最终结果，而不是手动处理每个工序。`,
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

const riskWordReplacementMap: Record<string, string> = {
  绝对: "更",
  保证: "尽量",
  包治: "缓解",
  稳赚: "更稳妥",
  必赚: "更有机会",
  唯一: "更合适的",
  "100%": "较高比例",
  永久: "长期",
  无风险: "需评估风险",
  零风险: "风险较低",
  万能: "更通用",
  官方推荐: "常见选择",
  国家认证: "资质信息需核验",
  权威认证: "资质信息需核验",
  最好: "更值得单独判断",
  第一: "前列",
  领先: "相对靠前",
  顶级: "成熟",
  极致: "更细致",
  完美: "更完整",
  立竿见影: "较快看到变化",
  一劳永逸: "可长期复用",
  专家推荐: "业内常见建议",
  立刻见效: "较快起效",
};

function replaceRiskWords(text: string, words: string[]) {
  let nextText = text;
  for (const word of words) {
    if (!word?.trim()) {
      continue;
    }
    const replacement = riskWordReplacementMap[word] ?? "";
    nextText = nextText.split(word).join(replacement);
  }
  return nextText.replace(/\n{3,}/g, "\n\n").trim();
}

function buildMustHaveSnippet(required: string, context: ArticleGenerationContext) {
  const region = [context.product.province, context.product.city, context.product.district].filter(Boolean).join("");
  const scenario = context.product.scenarios || region || "当前业务场景";
  const productName = context.product.productName || "当前服务";
  switch (required) {
    case "判断标准":
    case "标准":
      return `判断标准：优先看需求匹配度、可执行流程和风险边界，再决定是否推进 ${productName}。`;
    case "适用场景":
    case "场景":
      return `适用场景：${scenario}，以及需要持续做内容获客、账号协同发布的业务。`;
    case "风险":
    case "边界":
      return "风险边界：不同预算、团队协同和内容审核要求不同，结论不能直接套用到所有企业。";
    case "结论":
      return `结论：${productName} 是否适合，需要结合你的目标客户、内容节奏和审核要求综合判断。`;
    case "建议":
      return "建议：先用少量选题做测试，再根据数据反馈决定是否扩大执行范围。";
    case "步骤":
      return "步骤：先确认目标问题，再看账号节奏、内容结构和风险校验结果。";
    case "验证":
      return "验证方式：重点看线索质量、内容通过率和后续复用效率是否同步改善。";
    case "观点":
      return `核心观点：是否值得继续投入，不在于说法多强，而在于是否真的适合你的业务场景。`;
    case "钩子":
      return "先说结论：如果连适用场景和判断标准都说不清，再快生成也很难真正转化。";
    case "口语化":
      return "换成口语说，就是先别急着堆平台，先把适合不适合讲明白。";
    default:
      return `${required}：需要结合当前业务信息进一步判断。`;
  }
}

async function finalizeArticlePayload(
  context: ArticleGenerationContext,
  payload: Required<ArticlePayload>,
): Promise<Required<ArticlePayload>> {
  const strategy = await loadPlatformStrategy(context.platform);
  const riskConfig = await loadRiskWords();
  const strategyRiskWords = strategy?.review.riskWords ?? [];
  const blockingRiskWords = riskConfig?.blockingWords ?? [];
  const warningRiskWords = riskConfig?.warningWords ?? [];
  const titleMaxLength = strategy?.title.maxLength ?? payload.title.length;
  const combinedRiskWords = Array.from(new Set([...strategyRiskWords, ...blockingRiskWords, ...warningRiskWords]));

  let title = replaceRiskWords(payload.title, combinedRiskWords);
  if (title.length > titleMaxLength) {
    title = title.slice(0, titleMaxLength).trim();
  }

  let summary = replaceRiskWords(payload.summary, combinedRiskWords);
  let body = replaceRiskWords(payload.body, combinedRiskWords);
  const combinedText = `${title}\n${summary}\n${body}`;
  for (const required of strategy?.review.mustHave ?? []) {
    if (combinedText.includes(required)) {
      continue;
    }
    body = `${body}\n\n${buildMustHaveSnippet(required, context)}`.trim();
  }

  return {
    ...payload,
    title: title || payload.title,
    summary: summary || payload.summary,
    body: body || payload.body,
  };
}

async function callArticleStage(input: {
  config: ModelApiConfig;
  context: ArticlePromptContext;
  stage: ArticleInternalStage;
  prompt: string;
  forceFallback?: boolean;
}): Promise<ArticleStageResult> {
  const fallback = buildDevArticle(input.context, input.stage);
  if (input.forceFallback || !hasConfiguredModel(input.config)) {
    return {
      payload: fallback,
      usedFallback: Boolean(input.forceFallback),
      fallbackReason: input.forceFallback ? "MODEL_FALLBACK_ACTIVE" : undefined,
    };
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
      return {
        payload: sanitizePayload(payload, fallback, input.context.keyword),
        usedFallback: false,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
        return {
          payload: {
            ...fallback,
            notes: [...fallback.notes, "模型请求超时，已使用本地兜底草稿。"],
          },
          usedFallback: true,
          fallbackReason: "REQUEST_TIMEOUT",
        };
      }
      if (error instanceof OpenAICompatibleHttpError) {
        break;
      }
    }
  }

  if (lastError instanceof Error && lastError.message === "ARTICLE_STAGE_EMPTY_BODY") {
    return {
      payload: {
        ...fallback,
        notes: [...fallback.notes, "模型返回内容为空，已使用本地兜底草稿。"],
      },
      usedFallback: true,
      fallbackReason: "ARTICLE_STAGE_EMPTY_BODY",
    };
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
  if (reviewResult.blockingIssues.length) {
    return {
      level: "high" as const,
      message: `复检发现 ${reviewResult.blockingIssues.length} 个阻断问题。`,
      riskCodes,
    };
  }
  if (reviewResult.warnings.length || modelRisk === "medium" || modelRisk === "high") {
    return {
      level: "medium" as const,
      message: reviewResult.warnings.length ? `复检发现 ${reviewResult.warnings.length} 个提醒项。` : "模型复检提示需要关注风险边界。",
      riskCodes: modelRisk === "high" || modelRisk === "medium" ? [...riskCodes, "MODEL_SELF_REPORTED_RISK"] : riskCodes,
    };
  }
  return { level: "low" as const, message: "内容审查通过，可进入发布准备。", riskCodes };
}

function buildPipeline(input: {
  platform: SocialPlatform;
  publishable: boolean;
  riskLevel: ContentPoolRiskLevel;
  riskMessage: string;
  imagePrompt: string;
  images: ContentPoolImageItem[];
  imageGenerationMessage?: string;
  timestamp: string;
}): ContentPoolPipelineState {
  const generatedCount = input.images.filter((image) => image.status === "generated").length;
  const failedCount = input.images.filter((image) => image.status === "failed").length;
  return {
    negativeCheck: {
      status: input.publishable ? "passed" : "blocked",
      hits: [],
      checkedAt: input.timestamp,
    },
    riskReview: {
      status: input.publishable ? (input.riskLevel === "low" ? "passed" : "needs_action") : "blocked",
      level: input.riskLevel,
      message: input.riskMessage,
      reviewedAt: input.timestamp,
    },
    sampleDraft: {
      status: input.publishable ? "passed" : "blocked",
      passed: input.publishable,
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
      status: failedCount > 0 ? "needs_action" : generatedCount > 0 ? "passed" : input.imageGenerationMessage ? "needs_action" : "pending",
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
    errorMessage: image.errorMessage,
    status: image.reviewStatus === "failed" ? "failed" : "generated",
  }));
}

function formatImageGenerationError(error: unknown) {
  if (!(error instanceof Error)) return "图片生成失败。";
  const message = error.message.trim();
  const normalized = message.toLowerCase();
  if (normalized.startsWith("image_api_401") || normalized.includes("invalid token")) {
    return "图片模型认证失败：当前图片模型 API Key 无效、已过期，或该 Key 没有图片生成权限。请在模型设置中重新填写图片模型的 API Key 后再生成图片。";
  }
  if (normalized.startsWith("image_api_403")) {
    return "图片模型无权限访问：当前 API Key 没有调用图片生成接口的权限，请检查图片模型账号权限或更换可用 Key。";
  }
  if (normalized.startsWith("image_api_429") || normalized.startsWith("image_rate_limit_429")) {
    return "图片模型接口限流（HTTP 429），系统已自动重试但仍未成功，请稍后再试或更换模型供应商。";
  }
  if (/^image_output_empty@/.test(normalized)) {
    return "图片模型返回空内容（响应正常但未生成图片），可能是 API Key 没有图片配额、模型名不正确，或上游中转网关静默失败。请在模型设置中确认图片模型名（建议尝试 dall-e-3 或 gpt-image-1）和 API Key 配额。";
  }
  if (
    message === "REQUEST_TIMEOUT" ||
    error.name === "AbortError" ||
    normalized.includes("operation was aborted") ||
    normalized.includes("aborted")
  ) {
    return "图片模型请求超时或被中断，请检查图片模型接口是否可用，或在模型设置中适当调高图片生成超时时间。";
  }
  return message || "图片生成失败。";
}

export function formatArticleGenerationError(error: unknown): string {
  if (!(error instanceof Error)) return "文章生成失败。";
  const message = error.message.trim();
  if (message === "CONTENT_API_TIMEOUT" || message === "REQUEST_TIMEOUT" || error.name === "AbortError" || message.toLowerCase().includes("aborted")) {
    return "模型请求超时，请在模型设置中调高超时时间，或稍后再试。";
  }
  if (/^CONTENT_API_RATE_LIMIT@/.test(message) || /^HTTP_429@/.test(message) || message.includes("RATE_LIMIT")) {
    return "上游模型接口当前限流（HTTP 429），系统已自动重试但仍未成功，请稍后再试或更换模型供应商。";
  }
  if (/^CONTENT_API_(UNAUTHORIZED|FORBIDDEN)@/.test(message) || /^HTTP_(401|403)@/.test(message)) {
    return "模型接口认证失败，请在模型设置中重新配置可用的 API Key。";
  }
  if (/^CONTENT_API_(SERVER_ERROR|BAD_GATEWAY|SERVICE_UNAVAILABLE)@/.test(message) || /^HTTP_5\d\d@/.test(message)) {
    return "上游模型服务暂时不可用，请稍后再试。";
  }
  if (/^CONTENT_API_BAD_JSON@/.test(message) || /^CONTENT_OUTPUT_PARSE_FAILED@/.test(message)) {
    return "模型返回内容解析失败，可能是上游服务异常或模型回包格式被截断，请稍后再试或检查模型配置。";
  }
  if (/^IMAGE_OUTPUT_EMPTY@/i.test(message)) {
    return "图片模型返回空内容（响应正常但未生成图片），可能是 API Key 没有图片配额、模型名不正确，或上游中转网关静默失败。请在模型设置中确认图片模型名（建议 dall-e-3 或 gpt-image-1）与 Key 配额。";
  }
  if (/^IMAGE_(API|RATE_LIMIT)_\d{3}/i.test(message)) {
    return "图片模型接口异常，可能是 API Key 无效、限流或上游服务暂时不可用，请稍后再试或更换模型供应商。";
  }
  return message || "文章生成失败。";
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

  let forceFallbackStages = false;
  async function runStage(input: { context: ArticlePromptContext; stage: ArticleInternalStage; prompt: string }) {
    const result = await callArticleStage({
      config,
      context: input.context,
      stage: input.stage,
      prompt: input.prompt,
      forceFallback: forceFallbackStages,
    });
    if (result.usedFallback) {
      forceFallbackStages = true;
      log.push(stageLog(input.stage, `模型未及时返回，已切换本地兜底生成。原因：${result.fallbackReason ?? "MODEL_FALLBACK"}`));
    }
    return result.payload;
  }

  log.push(stageLog("draft_generating", "正在生成正文。"));
  const draft = await runStage({
    context: promptContext,
    stage: "draft_ready",
    prompt: buildDraftPrompt(promptContext),
  });
  log.push(stageLog("draft_ready", "首稿生成完成。"));

  log.push(stageLog("style_rewriting", "正在进行平台风格改写。"));
  const styled = await runStage({
    context: { ...promptContext, previousBody: draft.body },
    stage: "style_ready",
    prompt: buildStyleRewritePrompt({ ...promptContext, previousBody: draft.body }),
  });
  log.push(stageLog("style_ready", "改写完成。"));

  log.push(stageLog("dedupe_rewriting", "正在进行降重改写。"));
  const deduped = await runStage({
    context: { ...promptContext, previousBody: styled.body },
    stage: "dedupe_ready",
    prompt: buildDedupeRewritePrompt({ ...promptContext, previousBody: styled.body }),
  });
  log.push(stageLog("dedupe_ready", "降重完成。"));

  log.push(stageLog("risk_rewriting", "风险检查中。"));
  const finalPayload = await runStage({
    context: { ...promptContext, previousBody: deduped.body },
    stage: "risk_ready",
    prompt: buildRiskRewritePrompt({ ...promptContext, previousBody: deduped.body }),
  });
  log.push(stageLog("risk_ready", "风险语言修正完成。"));
  const finalizedPayload = await finalizeArticlePayload(context, finalPayload);

  log.push(stageLog("quality_reviewing", "正在进行最终复检。"));
  if (hasConfiguredModel(config) && !forceFallbackStages) {
    await runStage({
      context: { ...promptContext, previousBody: finalizedPayload.body },
      stage: "quality_passed",
      prompt: buildQualityReviewPrompt({ ...promptContext, previousBody: finalizedPayload.body }),
    });
  }

  const reviewDraft = toReviewDraft(context, finalizedPayload, timestamp);
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
  const risk = buildRisk(reviewResult, finalizedPayload.riskLevel);
  log.push(stageLog("quality_passed", "最终复检完成。"));
  log.push(stageLog("finalizing", "正在写入最终成稿。"));

  const publishable = reviewResult.blockingIssues.length === 0;
  const expectedImageCount = normalizeExpectedImageCount(context.expectedImageCount);
  let imageList: ContentPoolImageItem[] = [];
  let imagePrompt = finalizedPayload.imagePrompt;
  let imageGenerationMessage: string | undefined;
  if (publishable) {
    try {
      const imageAsset = await runImageModel(
        context.product,
        context.theme,
        reviewDraft,
        appConfig.imageModelApiConfig,
        expectedImageCount,
      );
      const localizedAsset = await materializeScopedImageAssetToLocal(context.contentItemId, imageAsset);
      imagePrompt = localizedAsset.images?.[0]?.prompt || imagePrompt;
      imageList = localizedAsset.images?.length ? toContentPoolImages(localizedAsset.images) : [];
      log.push(stageLog("finalizing", `图片生成完成，共 ${imageList.length} 张。`));
    } catch (error) {
      imageGenerationMessage = formatImageGenerationError(error);
      log.push(stageLog("finalizing", `图片生成已跳过：${imageGenerationMessage}`));
    }
  }

  const pipeline = buildPipeline({
    platform: context.platform,
    publishable,
    riskLevel: risk.level,
    riskMessage: risk.message,
    imagePrompt,
    images: imageList,
    imageGenerationMessage,
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
    title: finalizedPayload.title,
    summary: finalizedPayload.summary,
    body: finalizedPayload.body,
    imagePrompt,
    expectedImageCount,
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
