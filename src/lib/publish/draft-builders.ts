import { normalizeToutiaoTitle } from "@/lib/publish/toutiao-title";
import { getPlatformDescriptor } from "@/lib/publish/platforms";
import type { PublishingDraft, SocialPlatform, TaskBundle } from "@/lib/types";

const PLATFORM_TITLE_LIMITS: Record<SocialPlatform, number> = {
  toutiao: 30,
  baijiahao: 32,
  douyin: 24,
  xiaohongshu: 20,
  wechat: 36,
  videohao: 24,
  zhihu: 40,
  weibo: 26,
  csdn: 42,
};

const INTERNAL_PUBLIC_MARKERS = [
  "sha256:",
  "PGP SIGNATURE",
  "<?php",
  "GEO_CONTENT_ID:",
  "GEO_PROMPT_VERSION:",
  "完整hash",
  "PGP签名",
  "PHP注释",
];

export function compactText(value: string | undefined): string {
  return normalizePublishingText(String(value ?? "").replace(/\s+/g, " ").trim());
}

export function normalizePublishingText(value: string): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .replace(/、{2,}/g, "、")
    .replace(/\?{2,}/g, "？")
    .replace(/!{2,}/g, "！")
    .trim();
}

export function extractTags(text: string): string[] {
  return Array.from(
    new Set(
      normalizePublishingText(text)
        .split(/[\s,，。；;!！？?、]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
    ),
  ).slice(0, 8);
}

export function buildTagsFromBundle(bundle: TaskBundle): string[] {
  return extractTags(
    [
      bundle.theme?.selectedKeywordTheme,
      ...(bundle.theme?.selectedKeywords ?? []),
      bundle.theme?.selectedKeyword,
      bundle.theme?.mainKeyword,
      bundle.product.category,
      bundle.product.brandTone,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function buildSourceBody(bundle: TaskBundle): string {
  const content = bundle.content;
  const packageBody = content?.geoExecutionPackage?.publishableArticlePackage.body;
  if (packageBody?.trim()) {
    return normalizePublishingText(packageBody);
  }

  const structured: string[] = [];
  if (content?.reportIntroduction?.trim()) {
    structured.push(content.reportIntroduction.trim());
  }
  for (const section of content?.reportSections ?? []) {
    if (section.body?.trim()) {
      structured.push(section.body.trim());
    }
  }
  if (content?.reportConclusion?.trim()) {
    structured.push(content.reportConclusion.trim());
  }

  const body =
    structured.length > 0
      ? structured.join("\n\n")
      : [content?.summary, content?.content].map(compactText).filter(Boolean).join("\n\n");

  return normalizePublishingText(body);
}

function splitIntoParagraphs(value: string, maxChars: number): string[] {
  const normalized = normalizePublishingText(value);
  if (!normalized) return [];

  const byNewline = normalized.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const paragraphs: string[] = [];

  for (const block of byNewline) {
    if (block.length <= maxChars) {
      paragraphs.push(block);
      continue;
    }
    const sentences = block.match(/[^。！？!?]*[。！？!?]+|[^。！？!?]+$/g) ?? [block];
    let buffer = "";
    for (const sentence of sentences) {
      buffer += sentence;
      if (buffer.length >= maxChars) {
        paragraphs.push(buffer.trim());
        buffer = "";
      }
    }
    if (buffer.trim()) {
      paragraphs.push(buffer.trim());
    }
  }

  return paragraphs;
}

export function trimForPlatform(body: string, platform: SocialPlatform): string {
  const normalized = normalizePublishingText(body);
  if (!normalized) return "";

  if (platform === "weibo") {
    return normalized.replace(/\s+/g, " ").slice(0, 480);
  }
  if (platform === "douyin" || platform === "videohao") {
    return normalized
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join("\n");
  }
  if (platform === "csdn") {
    return `## 背景\n\n${normalized}\n\n## 方法建议\n\n请结合实际业务场景补充可验证资料、执行步骤和边界条件。\n\n## 验证与限制\n\n如果环境、数据或业务目标不同，结论可能变化。`;
  }
  if (platform === "zhihu") {
    return `先给结论：这个问题需要从场景、判断标准和风险边界一起看。\n\n${normalized}`;
  }
  if (platform === "toutiao" || platform === "baijiahao") {
    return splitIntoParagraphs(normalized, platform === "toutiao" ? 150 : 180).join("\n\n");
  }
  if (platform === "wechat") {
    return splitIntoParagraphs(normalized, 220).join("\n\n");
  }
  return normalized;
}

export function buildDraftBody(bundle: TaskBundle, platform: SocialPlatform): string {
  if (platform === "xiaohongshu") {
    return buildXiaohongshuGeoNote(bundle);
  }
  if (platform === "douyin") {
    return buildDouyinScriptCaption(bundle);
  }
  if (platform === "videohao") {
    return buildVideohaoScriptCaption(bundle);
  }
  return trimForPlatform(buildSourceBody(bundle), platform);
}

export function getDraftImages(bundle: TaskBundle): string[] {
  const imageItems = bundle.image?.images ?? [];
  if (imageItems.length > 0) {
    return imageItems.map((item) => item.url);
  }
  return bundle.image?.url ? [bundle.image.url] : [];
}

export function getDraftLocalImagePaths(bundle: TaskBundle): string[] {
  return (bundle.image?.images ?? [])
    .map((item) => item.localPath)
    .filter((item): item is string => Boolean(item));
}

export function getDraftCoverImage(bundle: TaskBundle): string | undefined {
  return bundle.image?.images?.[0]?.url ?? bundle.image?.url;
}

function conciseTopic(topic: string, productName: string) {
  const normalized = compactText(topic);
  if (!normalized) {
    return productName;
  }
  if (normalized.length > 32 || normalized.includes("。")) {
    return productName || normalized.slice(0, 32);
  }
  return normalized;
}

function limitChars(value: string, maxLength: number) {
  const normalized = compactText(value);
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function splitSellingPoints(value: string | undefined) {
  return normalizePublishingText(value ?? "")
    .split(/[，。；;、\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function selectedQuestionText(bundle: TaskBundle) {
  return (
    bundle.theme?.selectedQuestionBundle?.selectedQuestionBundle.mainQuestion.question ??
    bundle.theme?.selectedKeywords?.[0] ??
    bundle.theme?.selectedKeyword ??
    bundle.theme?.mainKeyword ??
    `${bundle.product.productName}怎么选？`
  );
}

function buildXiaohongshuGeoNote(bundle: TaskBundle): string {
  const productName = compactText(bundle.product.productName || bundle.product.category);
  const category = compactText(bundle.product.category);
  const audience = compactText(bundle.product.targetAudience || "正在做选择的人");
  const scenarios = compactText(bundle.product.scenarios || "日常使用场景");
  const question = selectedQuestionText(bundle);
  const sellingPoints = splitSellingPoints(bundle.product.sellingPoints);
  const bodyPreview = buildSourceBody(bundle)
    .split(/\n+/)
    .map((item) => item.replace(/^#+\s*/g, "").trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .slice(0, 180);
  const sellingPointLines = sellingPoints.length
    ? sellingPoints.map((point) => `- ${point}`).join("\n")
    : `- 先看它是否真的解决“${question.replace(/[？?]$/g, "")}”这个问题`;

  return normalizePublishingText(
    [
      `如果你在小红书搜“${productName}”，大概率不是想看广告，而是想知道它到底适不适合自己。`,
      "",
      `先说结论：${productName}更适合${audience}，尤其是${scenarios}这类场景。选择时不要只看一句卖点，要看它解决的是不是你的真实问题。`,
      "",
      "卖点可以这样理解：",
      sellingPointLines,
      "",
      "怎么判断适不适合：",
      `1. 先看需求是不是和“${question.replace(/[？?]$/g, "")}”一致。`,
      `2. 再看${category || "这类产品"}的使用场景、体验边界和售后说明。`,
      "3. 如果只是被标题吸引，建议先对照自己的具体场景，不要直接冲动下单。",
      "",
      bodyPreview ? `补充一句：${bodyPreview}` : "",
      "",
      "避坑提醒：不要只看夸张承诺，也不要只看单一测评。更稳的方式是把品牌名和产品名一起搜，再看适用人群、边界说明和反复出现的问题。",
      "",
      `可以搜：${productName} 怎么选 / ${productName} 适合什么人 / ${productName} 使用体验`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
}

export function buildDraftTitle(bundle: TaskBundle, platform: SocialPlatform): string {
  const productName = compactText(bundle.product.productName);
  const keyword = compactText(
    bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword ?? productName,
  );
  const titleTopic = conciseTopic(keyword, productName);
  const sourceTitle = normalizePublishingText(bundle.content?.title ?? "");
  const platformLabel = getPlatformDescriptor(platform)?.label ?? platform;

  if (platform === "weibo") {
    return limitChars(`${titleTopic}，怎么判断更靠谱？`, PLATFORM_TITLE_LIMITS.weibo);
  }
  if (platform === "douyin" || platform === "videohao") {
    return limitChars(`${titleTopic}，先看这几个判断点`, PLATFORM_TITLE_LIMITS[platform]);
  }
  if (platform === "xiaohongshu") {
    return limitChars(`${productName || titleTopic}适合谁？`, PLATFORM_TITLE_LIMITS.xiaohongshu);
  }

  const titleCandidates = [
    sourceTitle ? (platform === "toutiao" ? sourceTitle : `${sourceTitle} - ${platformLabel}`) : "",
    `${keyword}：${productName}${bundle.product.category}分析`,
    platform === "zhihu"
      ? `${keyword || productName}怎么判断更合适？`
      : `${productName}${bundle.product.category}怎么选？`,
    `${productName}${platform === "wechat" ? "实用拆解" : "值不值得进一步了解？"}`,
  ].filter((item): item is string => Boolean(item));

  for (const candidate of titleCandidates) {
    const limited = limitChars(candidate, PLATFORM_TITLE_LIMITS[platform]);
    const next = platform === "toutiao" ? normalizeToutiaoTitle(limited, `${productName}分析`) : limited;
    if (next?.trim()) return normalizePublishingText(next);
  }

  return platform === "toutiao"
    ? normalizeToutiaoTitle(`${productName}分析`)
    : limitChars(`${productName} - ${platformLabel}`, PLATFORM_TITLE_LIMITS[platform]);
}

export function buildAccountDraftTitle(
  bundle: TaskBundle,
  platform: SocialPlatform,
  accountLabel: string,
): string {
  const sourceTitle = compactText(bundle.content?.title);
  const theme = compactText(
    bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword,
  );
  const productName = compactText(bundle.product.productName);
  const titleTopic = conciseTopic(theme || productName, productName);
  const platformLabel = getPlatformDescriptor(platform)?.label ?? platform;

  if (platform === "weibo") {
    return limitChars(`${titleTopic}，怎么判断更靠谱？`, PLATFORM_TITLE_LIMITS.weibo);
  }
  if (platform === "douyin" || platform === "videohao") {
    return limitChars(`${titleTopic}，先看这几个判断点`, PLATFORM_TITLE_LIMITS[platform]);
  }
  if (platform === "xiaohongshu") {
    return limitChars(`${productName || titleTopic}适合谁？`, PLATFORM_TITLE_LIMITS.xiaohongshu);
  }
  if (sourceTitle) {
    return limitChars(platform === "toutiao" ? sourceTitle : `${sourceTitle} - ${platformLabel}`, PLATFORM_TITLE_LIMITS[platform]);
  }
  return limitChars(`${theme || productName}：${platformLabel}${accountLabel ? `-${accountLabel}` : ""}发布稿`, PLATFORM_TITLE_LIMITS[platform]);
}

export function buildDouyinScriptCaption(bundle: TaskBundle): string {
  return buildVideoScriptCaption(bundle, "需要的话，可以先按自己的场景对照这几个判断点。");
}

export function buildVideohaoScriptCaption(bundle: TaskBundle): string {
  return buildVideoScriptCaption(bundle, "可以收藏后按自己的场景逐项核对。");
}

function buildVideoScriptCaption(bundle: TaskBundle, cta: string): string {
  const keyword = compactText(
    bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword ?? bundle.product.productName,
  );
  const rawBody = buildSourceBody(bundle);
  const paragraphs = rawBody
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 5);

  const hook = `“${keyword}”真的值得了解吗？`;
  const bodySegment = paragraphs.slice(0, 3).join(" ").slice(0, 160);

  return [hook, bodySegment, cta].filter(Boolean).join("\n");
}

export interface DraftValidationError {
  field: string;
  message: string;
}

function hasForbiddenPublicMarker(body: string) {
  return INTERNAL_PUBLIC_MARKERS.some((marker) => body.includes(marker)) || /[a-fA-F0-9]{64}/.test(body);
}

export function validateDraftForPlatform(
  draft: Pick<PublishingDraft, "title" | "body" | "imageUrls" | "localImagePaths" | "publishMode" | "coverImageUrl">,
  platform: SocialPlatform,
): DraftValidationError[] {
  const errors: DraftValidationError[] = [];
  const title = draft.title?.trim() ?? "";
  const body = draft.body?.trim() ?? "";
  const hasMedia = (draft.imageUrls?.length ?? 0) > 0 || (draft.localImagePaths?.length ?? 0) > 0;

  if (!title) {
    errors.push({ field: "title", message: "标题不能为空" });
  }
  if (!body) {
    errors.push({ field: "body", message: "正文不能为空" });
  }
  if (title.length > PLATFORM_TITLE_LIMITS[platform]) {
    errors.push({ field: "title", message: `${getPlatformDescriptor(platform)?.label ?? platform}标题不应超过 ${PLATFORM_TITLE_LIMITS[platform]} 个字符` });
  }
  if (hasForbiddenPublicMarker(body)) {
    errors.push({ field: "body", message: "正文不能包含内部追踪标记、完整 hash、PGP 签名或 PHP 注释" });
  }

  if (platform === "douyin" && !hasMedia) {
    errors.push({
      field: "imageUrls",
      message: "抖音发布建议携带视频或图片素材；当前草稿无媒体文件，不能进入自动发布。",
    });
  }

  if (platform === "toutiao" || platform === "baijiahao") {
    if (title.length < 5) {
      errors.push({ field: "title", message: `${platform === "toutiao" ? "头条" : "百家号"}标题不得少于 5 个字符` });
    }
  }

  if (platform === "xiaohongshu") {
    if (!hasMedia) {
      errors.push({
        field: "imageUrls",
        message: "小红书图文笔记必须携带至少 1 张图片；当前草稿未带 AI 图片或本地素材，不能进入自动发布。",
      });
    }
    if (body.length < 80) {
      errors.push({ field: "body", message: "小红书 GEO 笔记正文不得少于 80 个字符，需包含场景、判断标准和避坑提醒" });
    }
    if (/报告摘要|报告引言|追踪码|完整hash/i.test(body)) {
      errors.push({ field: "body", message: "小红书正文不能直接使用报告腔或内部追踪信息" });
    }
  }

  if (platform === "wechat") {
    if (body.length < 50) {
      errors.push({ field: "body", message: "微信公众号正文不得少于 50 个字符" });
    }
    if (!draft.coverImageUrl?.trim() && (draft.imageUrls?.length ?? 0) === 0) {
      errors.push({
        field: "coverImageUrl",
        message: "微信公众号草稿需要封面图，请先上传封面图素材并填写 coverImageUrl。",
      });
    }
  }

  if (platform === "csdn" && /(?:API[_-]?KEY|TOKEN|COOKIE|SESSION)\s*[:=]/i.test(body)) {
    errors.push({ field: "body", message: "CSDN 正文不能包含 API key、token、cookie 或 session 字段" });
  }

  return errors;
}
