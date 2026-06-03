import { normalizeToutiaoTitle } from "@/lib/publish/toutiao-title";
import { getPlatformDescriptor } from "@/lib/publish/platforms";
import type { PublishingDraft, SocialPlatform, TaskBundle } from "@/lib/types";

export function compactText(value: string | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function extractTags(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\s,，。；;!！?？#]+/)
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

  return structured.length > 0
    ? structured.join("\n\n")
    : [content?.summary, content?.content].map(compactText).filter(Boolean).join("\n\n");
}

function splitIntoParagraphs(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const byNewline = normalized.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const paragraphs: string[] = [];

  for (const block of byNewline) {
    if (block.length <= 120) {
      paragraphs.push(block);
      continue;
    }
    const sentences = block.match(/[^。！？!?]*[。！？!?]+|[^。！？!?]+$/g) ?? [block];
    let buffer = "";
    for (const sentence of sentences) {
      buffer += sentence;
      if (buffer.length >= 120) {
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
  const normalized = body.trim();
  if (!normalized) return "";

  if (platform === "weibo") {
    return normalized.replace(/\s+/g, " ").slice(0, 480);
  }
  if (platform === "douyin" || platform === "videohao") {
    return normalized
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join("\n");
  }
  if (platform === "csdn") {
    return `## 背景\n\n${normalized}\n\n## 方法建议\n\n请结合实际业务场景补充可验证资料、执行步骤和边界条件。`;
  }
  if (platform === "zhihu") {
    return `先给结论：这个问题需要从场景、判断标准和风险边界一起看。\n\n${normalized}`;
  }
  if (platform === "toutiao") {
    return splitIntoParagraphs(normalized).join("\n\n");
  }
  return normalized;
}

export function buildDraftBody(bundle: TaskBundle, platform: SocialPlatform): string {
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

export function buildDraftTitle(bundle: TaskBundle, platform: SocialPlatform): string {
  const productName = compactText(bundle.product.productName);
  const keyword = compactText(
    bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword ?? productName,
  );
  const sourceTitle = bundle.content?.title?.trim();
  const platformLabel = getPlatformDescriptor(platform)?.label ?? platform;

  if (platform === "weibo") {
    return `${keyword || productName}，怎么判断更靠谱？`;
  }
  if (platform === "douyin" || platform === "videohao") {
    return `${keyword || productName}，先看这几个判断点`;
  }

  const titleCandidates = [
    sourceTitle ? (platform === "toutiao" ? sourceTitle : `${sourceTitle}｜${platformLabel}`) : "",
    `${keyword}：${productName}${bundle.product.category}分析报告`,
    platform === "zhihu"
      ? `${keyword || productName}怎么判断更合适？`
      : `${productName}${bundle.product.category}怎么选`,
    `${productName}${platform === "wechat" ? "实用拆解" : "值不值得进一步了解"}`,
  ].filter((item): item is string => Boolean(item));

  for (const candidate of titleCandidates) {
    const next = platform === "toutiao" ? normalizeToutiaoTitle(candidate, `${productName}分析报告`) : candidate;
    if (!next?.trim()) continue;
    return next;
  }

  return platform === "toutiao"
    ? normalizeToutiaoTitle(`${productName}分析报告`)
    : `${productName}｜${platformLabel}`;
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
  const platformLabel = getPlatformDescriptor(platform)?.label ?? platform;

  if (platform === "weibo") {
    return `${theme || productName}，怎么判断更靠谱？`;
  }
  if (platform === "douyin" || platform === "videohao") {
    return `${theme || productName}，先看这几个判断点`;
  }
  if (sourceTitle) {
    return platform === "toutiao" ? sourceTitle : `${sourceTitle}｜${platformLabel}`;
  }
  return `${theme || productName}：${platformLabel}${accountLabel ? `-${accountLabel}` : ""}发布稿`;
}

/**
 * Builds the script/caption text for a Douyin draft.
 * Douyin requires a short hook + body format; this converts the full article body
 * into a 3-segment caption suitable for the creator-center text field.
 */
export function buildDouyinScriptCaption(bundle: TaskBundle): string {
  return buildVideoScriptCaption(bundle, "关注我，持续分享实用判断逻辑。");
}

/**
 * Builds the script/caption text for a Videohao draft.
 * Shared transformer with Douyin; uses Video Account Assistant delivery format.
 */
export function buildVideohaoScriptCaption(bundle: TaskBundle): string {
  return buildVideoScriptCaption(bundle, "关注视频号，持续更新实用内容。");
}

function buildVideoScriptCaption(bundle: TaskBundle, cta: string): string {
  const keyword = compactText(
    bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword ?? bundle.product.productName,
  );
  const rawBody = buildSourceBody(bundle);
  const paragraphs = rawBody
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 5);

  const hook = `【${keyword}真的值得了解吗？】`;
  const bodySegment = paragraphs.slice(0, 3).join(" ").slice(0, 160);

  return [hook, bodySegment, cta].filter(Boolean).join("\n");
}

export interface DraftValidationError {
  field: string;
  message: string;
}

/**
 * Validates that a draft contains all required fields for the target platform before a job is created.
 * Returns an empty array if valid, or a list of errors.
 */
export function validateDraftForPlatform(
  draft: Pick<PublishingDraft, "title" | "body" | "imageUrls" | "localImagePaths" | "publishMode" | "coverImageUrl">,
  platform: SocialPlatform,
): DraftValidationError[] {
  const errors: DraftValidationError[] = [];

  if (!draft.title?.trim()) {
    errors.push({ field: "title", message: "标题不能为空" });
  }
  if (!draft.body?.trim()) {
    errors.push({ field: "body", message: "正文不能为空" });
  }

  if (platform === "douyin") {
    // Douyin publishing uses the Electron creator-center script in this product path.
    // Media is recommended for reach, but text-only drafts can still be attempted by script.
    const hasMedia =
      (draft.imageUrls?.length ?? 0) > 0 || (draft.localImagePaths?.length ?? 0) > 0;
    if (!hasMedia && draft.publishMode !== "text_only") {
      errors.push({
        field: "imageUrls",
        message:
          "抖音脚本发布建议携带视频或图片素材；当前草稿无媒体文件，请改为纯文本模式或补充素材。",
      });
    }
  }

  if (platform === "toutiao" || platform === "baijiahao") {
    if ((draft.title?.trim().length ?? 0) < 5) {
      errors.push({ field: "title", message: `${platform === "toutiao" ? "头条" : "百家号"}标题不得少于 5 个字符` });
    }
  }

  if (platform === "wechat") {
    if ((draft.body?.trim().length ?? 0) < 50) {
      errors.push({ field: "body", message: "微信公众号正文不得少于 50 个字符" });
    }
    // WeChat draft API requires a cover image media_id; callers must upload material first.
    // We validate at the draft level that a cover image URL is declared so the caller
    // can then resolve it to a media_id before calling addDraft().
    if (!draft.coverImageUrl?.trim() && (draft.imageUrls?.length ?? 0) === 0) {
      errors.push({
        field: "coverImageUrl",
        message: "微信公众号草稿需要封面图（thumb_media_id）。请先上传封面图素材并填写 coverImageUrl。",
      });
    }
  }

  return errors;
}
