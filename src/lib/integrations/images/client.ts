import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildJsonAuthHeaders, normalizeApiKey } from "@/lib/integrations/auth";
import type { ArticleImageItem, ContentDraft, ImageAsset, ModelApiConfig, ProductProfile, ThemeSet } from "@/lib/types";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const MAX_REFERENCE_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 14 * 1024 * 1024;
const IMAGE_PROMPT_TEMPLATE_PATH = path.join(process.cwd(), "src", "lib", "integrations", "images", "image-generation-prompt.md");
const DEFAULT_IMAGE_TIMEOUT_MS = 150000;

const IMAGE_RETRY_RATE_LIMIT_DELAYS_MS = [1500, 4000, 8000];
const IMAGE_RETRY_TRANSIENT_DELAYS_MS = [500, 1500, 3000];
const IMAGE_RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

function imageRetryJitter(ms: number) {
  return Math.round(ms * (0.85 + Math.random() * 0.3));
}

function isImageRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (error.message === "REQUEST_TIMEOUT") return true;
    // Upstream silent failure: 200 OK but empty url/b64_json. Retry as it's often transient.
    if (/^IMAGE_OUTPUT_EMPTY@/.test(error.message)) return true;
    // IMAGE_API_429 or IMAGE_RATE_LIMIT_429
    const statusMatch = error.message.match(/^IMAGE(?:_API|_RATE_LIMIT)?_(\d{3})/);
    if (statusMatch) {
      return IMAGE_RETRYABLE_HTTP_STATUSES.has(Number(statusMatch[1]));
    }
  }
  return false;
}

function isImageRateLimitError(error: unknown): boolean {
  return error instanceof Error && /^IMAGE_(?:API_429|RATE_LIMIT_429)/.test(error.message);
}

async function withImageRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts?: { maxAttempts?: number },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt >= maxAttempts - 1;
      if (!isImageRetryable(error) || isLast) {
        break;
      }
      const delayTable = isImageRateLimitError(error) ? IMAGE_RETRY_RATE_LIMIT_DELAYS_MS : IMAGE_RETRY_TRANSIENT_DELAYS_MS;
      const baseDelay = delayTable[attempt] ?? delayTable.at(-1) ?? 1500;
      const delay = imageRetryJitter(baseDelay);
      console.warn(`[image-client] ${label} retry after error, delay=${delay}ms, attempt=${attempt + 1}/${maxAttempts - 1}`);
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

export type GenericImageRequestExecutor = (url: string, init: RequestInit) => Promise<Response>;

interface ArticleImagePlanItem {
  imageIndex: number;
  imageCount: number;
  paragraphIndex: number;
  sectionExcerpt: string;
  alt: string;
  question?: string;
  sectionHeading?: string;
}

const DEFAULT_IMAGE_COUNT = 5;

export interface SingleImageRequestInput {
  prompt: string;
  imageIndex?: number;
  imageCount?: number;
  paragraphIndex?: number;
  alt?: string;
  question?: string;
  sectionHeading?: string;
}

function formatRegion(product: ProductProfile) {
  return [product.province, product.city, product.district].filter(Boolean).join("");
}

function buildFallbackPromptTemplate() {
  return [
    "# GEO 图片生成提示词模板",
    "",
    "你是 GEO 文章配图生成助手。",
    "请根据产品信息、提问主题和文章内容生成一段适合文章配图的图片提示词。",
    "文章标题：{{title}}",
    "文章摘要：{{summary}}",
    "当前配图定位：第 {{imageIndex}} 张，共 {{imageCount}} 张",
    "当前关联章节标题：{{sectionHeading}}",
    "当前关联提问句：{{question}}",
    "当前关联章节摘要：{{sectionExcerpt}}",
    "参考图模式：{{referenceModeLabel}}",
    "产品名称：{{productName}}",
    "产品品类：{{category}}",
    "核心卖点：{{sellingPoints}}",
    "目标人群：{{targetAudience}}",
    "适用场景：{{scenarios}}",
    "品牌调性：{{brandTone}}",
    "地区信息：{{region}}",
    "核心主题：{{keyword}}",
    "视觉要求：现代科技质感，真实光影，画面简洁，产品主体突出，适合作为文章内配图与封面图。",
  ].join("\n");
}

async function readImagePromptTemplate() {
  try {
    const content = await fs.readFile(IMAGE_PROMPT_TEMPLATE_PATH, "utf-8");
    const trimmed = content.trim();
    return trimmed || buildFallbackPromptTemplate();
  } catch {
    return buildFallbackPromptTemplate();
  }
}

function normalizeTextBlock(value: string) {
  return value
    .replace(/^#+\s*/gm, "")
    .replace(/^\d+\.\s*/gm, "")
    .replace(/^[-*]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickKeyword(theme: ThemeSet) {
  return theme.selectedKeywordTheme ?? theme.selectedKeyword ?? theme.mainKeyword;
}

function normalizeRequestedImageCount(imageCount?: number) {
  const parsed = Math.floor(Number(imageCount));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_IMAGE_COUNT;
  }
  return Math.min(10, parsed);
}

function extractArticleParagraphs(content?: ContentDraft) {
  if (!content?.content?.trim()) {
    return [] as string[];
  }

  return content.content
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => normalizeTextBlock(paragraph))
    .filter((paragraph) => paragraph.length >= 18);
}

function buildArticleImagePlan(content: ContentDraft | undefined, keyword: string, requestedImageCount?: number): ArticleImagePlanItem[] {
  const reportSections = content?.reportSections?.length ? content.reportSections : [];
  const imageCount = normalizeRequestedImageCount(requestedImageCount);

  if (reportSections.length) {
    const candidates = [
      {
        sectionHeading: "报告总述",
        question: content?.selectedKeywordTheme || keyword,
        sectionExcerpt: [content?.summary, content?.reportIntroduction].filter(Boolean).join(" "),
        paragraphIndex: 0,
      },
      ...reportSections.map((section, index) => ({
        sectionHeading: section.heading || `核心问题 ${index + 1}`,
        question: section.question || keyword,
        sectionExcerpt: [section.summary, section.body].filter(Boolean).join(" "),
        paragraphIndex: 2 + index,
      })),
      {
        sectionHeading: "报告结论",
        question: "最终判断与行动建议",
        sectionExcerpt: [content?.reportConclusion, content?.cta].filter(Boolean).join(" "),
        paragraphIndex: 2 + reportSections.length,
      },
    ];

    const scaledCandidates = Array.from({ length: imageCount }, (_, index) => {
      const candidateIndex = Math.min(
        candidates.length - 1,
        Math.floor((index * candidates.length) / imageCount),
      );
      return candidates[candidateIndex] ?? candidates[candidates.length - 1];
    });

    return scaledCandidates.map((item, index) => ({
      imageIndex: index + 1,
      imageCount,
      paragraphIndex: item.paragraphIndex,
      sectionExcerpt: normalizeTextBlock(item.sectionExcerpt || keyword).slice(0, 160) || keyword,
      alt: `${keyword} 报告配图 ${index + 1}`,
      question: item.question,
      sectionHeading: item.sectionHeading,
    }));
  }

  const paragraphs = extractArticleParagraphs(content);
  const fallbackParagraphs = Array.from({ length: imageCount }, (_, index) => {
    const paragraphIndex = paragraphs.length
      ? Math.min(paragraphs.length - 1, Math.floor((index * paragraphs.length) / imageCount))
      : 0;
    return paragraphs[paragraphIndex] || paragraphs[paragraphs.length - 1] || keyword;
  });
  return fallbackParagraphs.map((paragraph, index) => ({
    imageIndex: index + 1,
    imageCount,
    paragraphIndex: index,
    sectionExcerpt: paragraph.slice(0, 160),
    alt: `${keyword} 文章配图 ${index + 1}`,
    question: index === 0 ? keyword : undefined,
    sectionHeading: index === 0 ? "报告总述" : `内容配图 ${index + 1}`,
  }));
}

function renderImagePromptTemplate(
  template: string,
  product: ProductProfile,
  theme: ThemeSet,
  content: ContentDraft | undefined,
  planItem: ArticleImagePlanItem,
  hasReferenceImages: boolean,
) {
  const keyword = theme.selectedKeywordTheme ?? theme.selectedKeyword ?? theme.mainKeyword;
  const region = formatRegion(product) || "未填写";
  const replacements: Record<string, string> = {
    title: content?.title?.trim() || `${keyword} 文章主视觉`,
    summary: content?.summary?.trim() || "未填写",
    imageIndex: String(planItem.imageIndex),
    imageCount: String(planItem.imageCount),
    sectionHeading: planItem.sectionHeading || "未填写",
    question: planItem.question || keyword,
    sectionExcerpt: planItem.sectionExcerpt || keyword,
    productName: product.productName || "未填写",
    category: product.category || "未填写",
    sellingPoints: product.sellingPoints || "未填写",
    targetAudience: product.targetAudience || "未填写",
    scenarios: product.scenarios || "未填写",
    brandTone: product.brandTone || "未填写",
    region,
    keyword,
    referenceModeLabel: hasReferenceImages ? "已检测到参考图，需结合参考图与文章章节语义生成" : "未检测到参考图，仅根据文章章节语义生成",
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? "");
}

async function buildPrompt(
  product: ProductProfile,
  theme: ThemeSet,
  content: ContentDraft | undefined,
  planItem: ArticleImagePlanItem,
  hasReferenceImages: boolean,
) {
  const template = await readImagePromptTemplate();
  return renderImagePromptTemplate(template, product, theme, content, planItem, hasReferenceImages);
}

function buildPromptUrl(prompt: string) {
  return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=landscape_16_9`;
}

function normalizeImageAssetReviewStatus(status?: ArticleImageItem["reviewStatus"]): ImageAsset["reviewStatus"] {
  return status ?? "pending";
}

function bufferToBlobPart(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function createFallbackImageItem(taskId: string, prompt: string, planItem: ArticleImagePlanItem, overrides?: Partial<ArticleImageItem>): ArticleImageItem {
  return {
    id: `${taskId}-${randomUUID()}`,
    url: buildPromptUrl(prompt),
    prompt,
    alt: planItem.alt,
    question: planItem.question,
    sectionHeading: planItem.sectionHeading,
    referenceMode: "article_only",
    reviewStatus: "fallback",
    provider: "prompt-url",
    generationMode: "prompt",
    placement: {
      paragraphIndex: planItem.paragraphIndex,
      caption: `配图 ${planItem.imageIndex}`,
    },
    ...overrides,
  };
}

function createFallbackAsset(taskId: string, prompt: string, planItem: ArticleImagePlanItem, overrides?: Partial<ImageAsset>): ImageAsset {
  const coverItem = createFallbackImageItem(taskId, prompt, planItem);
  return {
    taskId,
    assetType: "cover",
    url: coverItem.url,
    reviewStatus: "fallback",
    prompt,
    provider: "prompt-url",
    generationMode: "prompt",
    images: [coverItem],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function normalizeProvider(provider: string) {
  return provider.trim().toLowerCase();
}

function resolveOpenAIImageEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/g, "").replace(/\/chat\/completions$/i, "");
  if (!trimmed) {
    throw new Error("未配置图片模型 API 地址");
  }
  if (/\/images\/generations$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\/[^/]+$/i.test(trimmed)) {
    return `${trimmed}/v1/images/generations`;
  }
  return `${trimmed}/images/generations`;
}

function resolveOpenAIImageEditEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/g, "").replace(/\/chat\/completions$/i, "");
  if (!trimmed) {
    throw new Error("未配置图片模型 API 地址");
  }
  if (/\/images\/edits$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/images\/generations$/i.test(trimmed)) {
    return trimmed.replace(/\/images\/generations$/i, "/images/edits");
  }
  return `${trimmed}/images/edits`;
}

function resolveOpenAIResponsesEndpoint(baseUrl: string) {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/images\/generations$/i, "")
    .replace(/\/responses$/i, "");

  if (!trimmed) {
    throw new Error("未配置图片模型 API 地址。");
  }
  if (/^https?:\/\/[^/]+$/i.test(trimmed)) {
    return `${trimmed}/v1/responses`;
  }
  return `${trimmed}/responses`;
}

function resolveResponsesImageModel(modelName: string) {
  const normalized = modelName.trim();
  if (/^gpt-image/i.test(normalized)) {
    return "gpt-5.5";
  }
  return normalized || "gpt-5.5";
}

function resolveViduBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error("未配置 Vidu 接口地址");
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    throw new Error("Vidu 接口地址格式不正确");
  }
}

function buildViduEndpoint(baseUrl: string, pathname: string) {
  const endpoint = new URL(resolveViduBaseUrl(baseUrl));
  endpoint.pathname = pathname;
  endpoint.search = "";
  return endpoint.toString();
}

function buildViduHeaders(apiKey: string) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey) {
    throw new Error("未配置 Vidu API Key");
  }

  return {
    Authorization: `Token ${normalizedApiKey}`,
    "Content-Type": "application/json",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTimeoutMs(timeout: number) {
  return Math.max(5000, Number(timeout) || DEFAULT_IMAGE_TIMEOUT_MS);
}

function isAbortLikeError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return error.name === "AbortError" || message.includes("operation was aborted") || message.includes("aborted");
}

async function readJsonResponse(response: Response) {
  const rawText = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      return {
        payload: JSON.parse(rawText) as Record<string, unknown>,
        rawText,
      };
    } catch {
      return {
        payload: null,
        rawText,
      };
    }
  }

  try {
    return {
      payload: JSON.parse(rawText) as Record<string, unknown>,
      rawText,
    };
  } catch {
    return {
      payload: null,
      rawText,
    };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

const defaultGenericImageRequestExecutor: GenericImageRequestExecutor = (url, init) => fetch(url, init);
let genericImageRequestExecutor: GenericImageRequestExecutor = defaultGenericImageRequestExecutor;

export function setGenericImageRequestExecutorForTest(executor?: GenericImageRequestExecutor | null) {
  genericImageRequestExecutor = executor ?? defaultGenericImageRequestExecutor;
}

export async function executeGenericImageRequest(url: string, init: RequestInit) {
  return genericImageRequestExecutor(url, init);
}

function extractRemoteError(payload: Record<string, unknown> | null, rawText: string) {
  const candidates = [
    payload?.message,
    payload?.msg,
    payload?.error,
    payload?.err_msg,
    payload?.err_code,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return rawText.trim().slice(0, 200);
}

function extractOpenAIImageErrorMessage(
  payload: { error?: { message?: string } | string; message?: string } | null,
  rawText: string,
) {
  if (payload?.error && typeof payload.error === "object" && typeof payload.error.message === "string") {
    return payload.error.message.trim();
  }
  if (typeof payload?.error === "string") {
    return payload.error.trim();
  }
  if (typeof payload?.message === "string") {
    return payload.message.trim();
  }
  return rawText.trim().slice(0, 200);
}

function isMissingImageGenerationToolError(message: string) {
  return /tool choice ['"]?image_generation['"]?/i.test(message) && /not found in ['"]?tools['"]?/i.test(message);
}

function toImageUrlFromOpenAIResult(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed}`;
}

function extractResponsesImageResult(payload: {
  output?: Array<{
    id?: string;
    type?: string;
    result?: string;
    image_url?: string;
    content?: Array<{ type?: string; image_url?: string; url?: string; b64_json?: string; result?: string }>;
  }>;
}) {
  for (const output of payload.output ?? []) {
    if (output.type === "image_generation_call" && typeof output.result === "string") {
      return {
        url: toImageUrlFromOpenAIResult(output.result),
        providerTaskId: output.id,
      };
    }
    if (typeof output.image_url === "string") {
      return {
        url: toImageUrlFromOpenAIResult(output.image_url),
        providerTaskId: output.id,
      };
    }

    for (const content of output.content ?? []) {
      const candidate = content.image_url || content.url || content.b64_json || content.result;
      if (typeof candidate === "string" && candidate.trim()) {
        return {
          url: toImageUrlFromOpenAIResult(candidate),
          providerTaskId: output.id,
        };
      }
    }
  }

  return { url: "", providerTaskId: undefined };
}

function extractStringImageCandidate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 80) {
    return `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
  }
  return "";
}

function extractImageCandidateFromUnknown(value: unknown): string {
  const direct = extractStringImageCandidate(value);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractImageCandidateFromUnknown(item);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const imageKeys = ["url", "image_url", "b64_json", "base64", "image", "result"];
  for (const key of imageKeys) {
    const candidate = extractImageCandidateFromUnknown(record[key]);
    if (candidate) {
      return candidate;
    }
  }

  for (const key of ["data", "images", "output", "content"]) {
    const candidate = extractImageCandidateFromUnknown(record[key]);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

function extractOpenAIImageGenerationResult(payload: {
  data?: Array<{
    url?: unknown;
    b64_json?: unknown;
    image_url?: unknown;
    revised_prompt?: string;
    content?: unknown;
  }>;
  images?: unknown;
  output?: unknown;
}) {
  const first = payload.data?.[0];
  return {
    url: extractImageCandidateFromUnknown(first ?? payload),
    prompt: typeof first?.revised_prompt === "string" && first.revised_prompt.trim() ? first.revised_prompt : undefined,
  };
}

function resolveViduModel(modelName: string, hasReferenceImages: boolean) {
  const normalizedModel = modelName.trim().toLowerCase();
  if (!hasReferenceImages) {
    return normalizedModel && normalizedModel !== "viduq1" ? normalizedModel : "viduq2";
  }

  return normalizedModel || "viduq2";
}

function uniqueImagePaths(product: ProductProfile) {
  return Array.from(
    new Set([product.productImagePath?.trim(), product.brandImagePath?.trim()].filter((item): item is string => Boolean(item))),
  );
}

async function encodeLocalImage(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("图片格式不支持");
  }

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("图片路径不是文件");
  }

  if (stat.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("图片体积过大");
  }

  const buffer = await fs.readFile(filePath);
  const mimeType = MIME_TYPES[extension];
  if (!mimeType) {
    throw new Error("图片格式不支持");
  }

  return {
    bytes: buffer.byteLength,
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

async function resolveReferenceImages(product: ProductProfile) {
  const results: string[] = [];
  let totalBytes = 0;

  for (const filePath of uniqueImagePaths(product)) {
    try {
      const encoded = await encodeLocalImage(filePath);
      if (totalBytes + encoded.bytes > MAX_REFERENCE_TOTAL_BYTES) {
        continue;
      }
      results.push(encoded.dataUrl);
      totalBytes += encoded.bytes;
    } catch {
      // Reference images are best-effort only; unreadable local files degrade to prompt-only generation.
    }
  }

  return results;
}

async function resolveReferenceImageFiles(product: ProductProfile) {
  const results: Array<{ bytes: number; fileName: string; mimeType: string; buffer: Buffer }> = [];
  let totalBytes = 0;

  for (const filePath of uniqueImagePaths(product)) {
    try {
      const extension = path.extname(filePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) {
        continue;
      }

      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_REFERENCE_IMAGE_BYTES) {
        continue;
      }

      const mimeType = MIME_TYPES[extension];
      if (!mimeType) {
        continue;
      }

      if (totalBytes + stat.size > MAX_REFERENCE_TOTAL_BYTES) {
        continue;
      }

      const buffer = await fs.readFile(filePath);
      totalBytes += buffer.byteLength;
      results.push({
        bytes: buffer.byteLength,
        fileName: path.basename(filePath),
        mimeType,
        buffer,
      });
    } catch {
      // Reference images are best-effort only; unreadable local files degrade to prompt-only generation.
    }
  }

  return results;
}

function ensureImageAssetCount(taskId: string, asset: ImageAsset, expectedImageCount: number) {
  const images = asset.images ?? [];
  if (images.length !== expectedImageCount) {
    throw new Error(`图片结果数量异常：任务 ${taskId} 仅生成 ${images.length} 张图。`);
  }
  return asset;
}

function extractViduTaskId(payload: Record<string, unknown> | null) {
  if (!payload) {
    return "";
  }

  const taskId = payload.task_id;
  return typeof taskId === "string" ? taskId.trim() : "";
}

function extractViduImageUrl(payload: Record<string, unknown> | null) {
  const creations = payload?.creations;
  if (!Array.isArray(creations) || creations.length === 0) {
    return "";
  }

  const firstCreation = creations[0];
  if (!firstCreation || typeof firstCreation !== "object") {
    return "";
  }

  const url = "url" in firstCreation ? firstCreation.url : "";
  const coverUrl = "cover_url" in firstCreation ? firstCreation.cover_url : "";

  if (typeof url === "string" && url.trim()) {
    return url.trim();
  }
  if (typeof coverUrl === "string" && coverUrl.trim()) {
    return coverUrl.trim();
  }
  return "";
}

async function createViduTask(product: ProductProfile, prompt: string, config: ModelApiConfig, referenceImages: string[]) {
  const hasReferenceImages = referenceImages.length > 0;
  const model = resolveViduModel(config.modelName, hasReferenceImages);
  const pathname = "/ent/v2/reference2image";
  const endpoint = buildViduEndpoint(config.baseUrl, pathname);
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: buildViduHeaders(config.apiKey),
      body: JSON.stringify({
        model,
        prompt,
        images: hasReferenceImages ? referenceImages : undefined,
        aspect_ratio: "16:9",
        resolution: "1080p",
        payload: product.taskId,
      }),
    },
    resolveTimeoutMs(config.timeout),
  );

  const { payload, rawText } = await readJsonResponse(response);
  if (!response.ok) {
    const detail = extractRemoteError(payload, rawText);
    throw new Error(`Vidu 创建任务失败：${detail || `HTTP ${response.status}`}`);
  }

  const taskId = extractViduTaskId(payload);
  if (!taskId) {
    throw new Error("Vidu 未返回有效任务 ID");
  }

  return {
    taskId,
    model,
    generationMode: hasReferenceImages ? ("reference" as const) : ("prompt" as const),
  };
}

async function pollViduImageUrl(taskId: string, config: ModelApiConfig) {
  const timeoutMs = resolveTimeoutMs(config.timeout);
  const deadline = Date.now() + timeoutMs;
  const endpoint = buildViduEndpoint(config.baseUrl, `/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`);
  let lastState = "created";

  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "GET",
        headers: buildViduHeaders(config.apiKey),
      },
      Math.min(10000, Math.max(3000, deadline - Date.now())),
    );

    const { payload, rawText } = await readJsonResponse(response);
    if (!response.ok) {
      const detail = extractRemoteError(payload, rawText);
      throw new Error(`Vidu 查询任务失败：${detail || `HTTP ${response.status}`}`);
    }

    const state = typeof payload?.state === "string" ? payload.state.trim().toLowerCase() : "";
    if (state) {
      lastState = state;
    }

    if (state === "success") {
      const url = extractViduImageUrl(payload);
      if (!url) {
        throw new Error("Vidu 返回成功，但结果中没有可用图片地址");
      }
      return url;
    }

    if (state === "failed") {
      const detail = extractRemoteError(payload, rawText);
      throw new Error(`Vidu 图片生成失败：${detail || "任务失败"}`);
    }

    await sleep(1500);
  }

  throw new Error(`Vidu 图片生成超时：任务状态停留在 ${lastState}`);
}

async function runViduImageModel(
  product: ProductProfile,
  prompts: Array<{ prompt: string; planItem: ArticleImagePlanItem }>,
  config: ModelApiConfig,
): Promise<ImageAsset> {
  const referenceImages = await resolveReferenceImages(product);
  const hasReferenceImages = referenceImages.length > 0;
  const items: ArticleImageItem[] = await Promise.all(
    prompts.map((entry) =>
      withImageRetry(async () => {
        const createdTask = await createViduTask(product, entry.prompt, config, referenceImages);
        const imageUrl = await pollViduImageUrl(createdTask.taskId, config);
        return {
          id: `${product.taskId}-${randomUUID()}`,
          url: imageUrl,
          prompt: entry.prompt,
          alt: entry.planItem.alt,
          question: entry.planItem.question,
          sectionHeading: entry.planItem.sectionHeading,
          referenceMode: hasReferenceImages ? "reference_enhanced" : "article_only",
          reviewStatus: "pending",
          provider: "vidu",
          providerTaskId: createdTask.taskId,
          generationMode: createdTask.generationMode,
          placement: {
            paragraphIndex: entry.planItem.paragraphIndex,
            caption: `配图 ${entry.planItem.imageIndex}`,
          },
        } satisfies ArticleImageItem;
      }, `vidu[${entry.planItem.imageIndex}]`),
    ),
  );

  if (items.length !== prompts.length) {
    throw new Error(`Vidu 图片生成数量不足，当前仅成功返回 ${items.length} 张。`);
  }

  const cover = items[0];
  return ensureImageAssetCount(product.taskId, {
    taskId: product.taskId,
    assetType: "cover",
    url: cover?.url || buildPromptUrl(prompts[0]?.prompt || product.productName),
    reviewStatus: normalizeImageAssetReviewStatus(cover?.reviewStatus),
    prompt: cover?.prompt || prompts[0]?.prompt || product.productName,
    provider: cover?.provider ?? "vidu",
    providerTaskId: cover?.providerTaskId,
    generationMode: cover?.generationMode ?? "prompt",
    images: items,
    updatedAt: new Date().toISOString(),
  }, prompts.length);
}

async function runGenericImageModel(
  product: ProductProfile,
  prompts: Array<{ prompt: string; planItem: ArticleImagePlanItem }>,
  config: ModelApiConfig,
  fallbackAsset: ImageAsset,
) {
  const referenceImages = await resolveReferenceImages(product);
  const hasReferenceImages = referenceImages.length > 0;
  const results: Array<{ item: ArticleImageItem; failed: boolean }> = await Promise.all(
    prompts.map(async (entry) => {
      try {
        const response = await withImageRetry(
          async () => {
            const res = await executeGenericImageRequest(config.baseUrl, {
              method: "POST",
              headers: buildJsonAuthHeaders(config.apiKey),
              body: JSON.stringify({ product, modelName: config.modelName, prompt: entry.prompt }),
            });
            if (!res.ok) {
              const errPrefix = res.status === 429
                ? `IMAGE_RATE_LIMIT_${res.status}@${config.baseUrl}`
                : `IMAGE_API_${res.status}`;
              throw new Error(errPrefix);
            }
            return res;
          },
          `generic[${entry.planItem.imageIndex}]`,
        );

        if (!response.ok) {
          const errPrefix = response.status === 429 ? `IMAGE_RATE_LIMIT_${response.status}@${config.baseUrl}` : `IMAGE_API_${response.status}`;
          throw new Error(errPrefix);
        }

        const contentType = response.headers.get("content-type") ?? "";
        let payload: Partial<ImageAsset> = {};
        let rawTextSnapshot = "";
        try {
          rawTextSnapshot = await response.clone().text();
        } catch {
          rawTextSnapshot = "(clone failed)";
        }
        console.info(
          `[image-debug] provider=generic endpoint=${config.baseUrl} status=${response.status} content-type=${contentType} raw-prefix=${rawTextSnapshot.slice(0, 500)}`,
        );
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error("IMAGE_API_BAD_CONTENT_TYPE");
        }
        try {
          payload = (await response.json()) as Partial<ImageAsset>;
        } catch {
          throw new Error("IMAGE_API_BAD_JSON");
        }

        const resolvedUrl = typeof payload.url === "string" && payload.url.trim() ? payload.url.trim() : buildPromptUrl(entry.prompt);
        return {
          failed: false,
          item: ({
            id: `${product.taskId}-${randomUUID()}`,
            url: resolvedUrl,
            prompt: entry.prompt,
            alt: entry.planItem.alt,
            question: entry.planItem.question,
            sectionHeading: entry.planItem.sectionHeading,
            referenceMode: hasReferenceImages ? "reference_enhanced" : "article_only",
            reviewStatus: payload.reviewStatus ?? "pending",
            provider: payload.provider ?? "generic",
            providerTaskId: payload.providerTaskId,
            generationMode: payload.generationMode ?? "prompt",
            placement: {
              paragraphIndex: entry.planItem.paragraphIndex,
              caption: `配图 ${entry.planItem.imageIndex}`,
            },
          } satisfies ArticleImageItem),
        };
      } catch (error) {
        return {
          failed: true,
          item: createFallbackImageItem(product.taskId, entry.prompt, entry.planItem, {
            url: "",
            reviewStatus: "failed",
            provider: "generic",
            errorMessage: error instanceof Error ? error.message : "图片生成失败",
          }),
        };
      }
    }),
  );
  const items: ArticleImageItem[] = results.map((result) => result.item);

  const cover = items[0];
  return ensureImageAssetCount(product.taskId, {
    taskId: product.taskId,
    assetType: "cover",
    url: cover?.url ?? fallbackAsset.url,
    reviewStatus: normalizeImageAssetReviewStatus(cover?.reviewStatus),
    prompt: cover?.prompt ?? fallbackAsset.prompt,
    provider: cover?.provider ?? "generic",
    providerTaskId: cover?.providerTaskId,
    generationMode: cover?.generationMode ?? "prompt",
    images: items,
    updatedAt: new Date().toISOString(),
  } satisfies ImageAsset, prompts.length);
}

async function fetchOpenAIResponsesImageGeneration(
  endpoint: string,
  prompt: string,
  config: ModelApiConfig,
): Promise<{ url: string; prompt: string; providerTaskId?: string }> {
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: buildJsonAuthHeaders(config.apiKey),
      body: JSON.stringify({
        model: resolveResponsesImageModel(config.modelName),
        input: prompt,
        tools: [{ type: "image_generation" }],
        tool_choice: { type: "image_generation" },
      }),
    },
    config.timeout ?? 300000,
  );

  const rawText = await response.text();
  let payload: {
    output?: Array<{
      id?: string;
      type?: string;
      result?: string;
      image_url?: string;
      content?: Array<{ type?: string; image_url?: string; url?: string; b64_json?: string; result?: string }>;
    }>;
    error?: { message?: string } | string;
    message?: string;
  } | null = null;
  try {
    payload = JSON.parse(rawText) as typeof payload;
  } catch {
    // Keep payload empty and surface the raw body below.
  }

  if (!response.ok) {
    const detail = extractOpenAIImageErrorMessage(payload, rawText);
    throw new Error(`IMAGE_RESPONSES_API_${response.status}: ${detail || `HTTP ${response.status}`}`);
  }

  const result = extractResponsesImageResult(payload ?? {});
  if (!result.url) {
    throw new Error("图片模型未返回可用图片，请稍后重试。");
  }

  return {
    url: result.url,
    prompt,
    providerTaskId: result.providerTaskId,
  };
}

async function runOpenAICompatibleImageModel(
  product: ProductProfile,
  prompts: Array<{ prompt: string; planItem: ArticleImagePlanItem }>,
  config: ModelApiConfig,
): Promise<ImageAsset> {
  const generationEndpoint = resolveOpenAIImageEndpoint(config.baseUrl);
  const editEndpoint = resolveOpenAIImageEditEndpoint(config.baseUrl);
  const responsesEndpoint = resolveOpenAIResponsesEndpoint(config.baseUrl);
  const normalizedApiKey = normalizeApiKey(config.apiKey);
  const referenceImageFiles = await resolveReferenceImageFiles(product);
  const hasReferenceImages = referenceImageFiles.length > 0;
  const items: ArticleImageItem[] = await Promise.all(
    prompts.map((entry) =>
      withImageRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), resolveTimeoutMs(config.timeout));
        let response: Response;
        try {
          if (hasReferenceImages) {
            const form = new FormData();
            form.set("model", config.modelName);
            form.set("prompt", entry.prompt);
            form.set("size", "1024x1024");

            for (const [index, file] of referenceImageFiles.entries()) {
              const blob = new Blob([bufferToBlobPart(file.buffer)], { type: file.mimeType });
              form.append("image", blob, file.fileName || `reference-${index + 1}.png`);
            }

            const headers: Record<string, string> = {};
            if (normalizedApiKey) {
              headers.Authorization = `Bearer ${normalizedApiKey}`;
            }

            response = await fetch(editEndpoint, {
              method: "POST",
              headers,
              body: form,
              signal: controller.signal,
            });
          } else {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
            };
            if (normalizedApiKey) {
              headers.Authorization = `Bearer ${normalizedApiKey}`;
            }

            response = await fetch(generationEndpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: config.modelName,
                prompt: entry.prompt,
                n: 1,
                size: "1024x1024",
                response_format: "b64_json",
              }),
              signal: controller.signal,
            });
          }
        } catch (error) {
          if (isAbortLikeError(error)) {
            throw new Error("REQUEST_TIMEOUT");
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }

      const { payload: parsedPayload, rawText } = await readJsonResponse(response);
      process.stderr.write(
        `[image-debug] provider=openai-compatible endpoint=${hasReferenceImages ? editEndpoint : generationEndpoint} status=${response.status} content-type=${response.headers.get("content-type") ?? ""} payload-keys=${parsedPayload ? Object.keys(parsedPayload).join(",") : "null"} raw-prefix=${rawText.slice(0, 800).replace(/\n/g, "\\n")}\n`,
      );
      const payload = parsedPayload as {
        data?: Array<{ url?: unknown; b64_json?: unknown; image_url?: unknown; revised_prompt?: string; content?: unknown }>;
        images?: unknown;
        output?: unknown;
        error?: { message?: string } | string;
        message?: string;
      } | null;

      if (!response.ok) {
        const detail = extractOpenAIImageErrorMessage(payload, rawText);
        if (!hasReferenceImages && response.status === 400 && isMissingImageGenerationToolError(detail)) {
          const fallback = await fetchOpenAIResponsesImageGeneration(responsesEndpoint, entry.prompt, config);
          return {
            id: `${product.taskId}-${randomUUID()}`,
            url: fallback.url,
            prompt: fallback.prompt,
            alt: entry.planItem.alt,
            question: entry.planItem.question,
            sectionHeading: entry.planItem.sectionHeading,
            referenceMode: "article_only",
            reviewStatus: "pending",
            provider: "openai-responses-image",
            providerTaskId: fallback.providerTaskId,
            generationMode: "prompt",
            placement: {
              paragraphIndex: entry.planItem.paragraphIndex,
              caption: `配图 ${entry.planItem.imageIndex}`,
            },
          } satisfies ArticleImageItem;
        }
        const errPrefix = response.status === 429
          ? `IMAGE_RATE_LIMIT_${response.status}@${hasReferenceImages ? editEndpoint : generationEndpoint}`
          : `IMAGE_API_${response.status}`;
        throw new Error(`${errPrefix}: ${detail}`);
      }

      const imageResult = extractOpenAIImageGenerationResult(payload ?? {});
      const imageUrl = imageResult.url;
      if (!imageUrl) {
        throw new Error(`IMAGE_OUTPUT_EMPTY@${hasReferenceImages ? editEndpoint : generationEndpoint}`);
      }

      return {
        id: `${product.taskId}-${randomUUID()}`,
        url: imageUrl,
        prompt: imageResult.prompt || entry.prompt,
        alt: entry.planItem.alt,
        question: entry.planItem.question,
        sectionHeading: entry.planItem.sectionHeading,
        referenceMode: hasReferenceImages ? "reference_enhanced" : "article_only",
        reviewStatus: "pending",
        provider: "openai-compatible-image",
        generationMode: hasReferenceImages ? "reference" : "prompt",
        placement: {
          paragraphIndex: entry.planItem.paragraphIndex,
          caption: `配图 ${entry.planItem.imageIndex}`,
        },
      } satisfies ArticleImageItem;
      }, `openai-compatible[${entry.planItem.imageIndex}]`),
    ),
  );

  if (items.length !== prompts.length) {
    throw new Error(`图片生成数量不足，当前仅成功返回 ${items.length} 张。`);
  }

  const cover = items[0];
  return ensureImageAssetCount(product.taskId, {
    taskId: product.taskId,
    assetType: "cover",
    url: cover?.url || buildPromptUrl(prompts[0]?.prompt || product.productName),
    reviewStatus: normalizeImageAssetReviewStatus(cover?.reviewStatus),
    prompt: cover?.prompt || prompts[0]?.prompt || product.productName,
    provider: cover?.provider ?? "openai-compatible-image",
    generationMode: cover?.generationMode ?? "prompt",
    images: items,
    updatedAt: new Date().toISOString(),
  }, prompts.length);
}

export async function runImageModel(
  product: ProductProfile,
  theme: ThemeSet,
  content: ContentDraft | undefined,
  config: ModelApiConfig,
  imageCount?: number,
): Promise<ImageAsset> {
  const keyword = pickKeyword(theme);
  const plan = buildArticleImagePlan(content, keyword, imageCount);
  const referenceImages = await resolveReferenceImages(product);
  const hasReferenceImages = referenceImages.length > 0;
  const prompts = await Promise.all(
    plan.map(async (planItem) => ({
      planItem,
      prompt: await buildPrompt(product, theme, content, planItem, hasReferenceImages),
    })),
  );
  const fallbackAsset = createFallbackAsset(product.taskId, prompts[0]?.prompt || keyword, prompts[0]?.planItem ?? plan[0]);
  fallbackAsset.images = prompts.map(({ prompt, planItem }) => createFallbackImageItem(product.taskId, prompt, planItem));
  fallbackAsset.url = fallbackAsset.images[0]?.url ?? fallbackAsset.url;
  fallbackAsset.prompt = fallbackAsset.images[0]?.prompt ?? fallbackAsset.prompt;
  const provider = normalizeProvider(config.provider);

  if (!config.baseUrl || provider === "prompt-url" || provider.startsWith("mock")) {
    return {
      ...fallbackAsset,
      reviewStatus: "pending",
    };
  }

  if (provider === "vidu") {
    return runViduImageModel(product, prompts, config);
  }

  if (provider.includes("openai") || provider.includes("gpt") || provider.includes("newapi")) {
    return runOpenAICompatibleImageModel(product, prompts, config);
  }

  return runGenericImageModel(product, prompts, config, fallbackAsset);
}

export async function runSingleImageModel(
  product: ProductProfile,
  config: ModelApiConfig,
  input: SingleImageRequestInput,
): Promise<ArticleImageItem> {
  const planItem: ArticleImagePlanItem = {
    imageIndex: input.imageIndex ?? 1,
    imageCount: input.imageCount ?? 1,
    paragraphIndex: input.paragraphIndex ?? 0,
    sectionExcerpt: input.prompt,
    alt: input.alt ?? `文章配图 ${input.imageIndex ?? 1}`,
    question: input.question,
    sectionHeading: input.sectionHeading ?? `内容配图 ${input.imageIndex ?? 1}`,
  };
  const promptEntry = [{ prompt: input.prompt, planItem }];
  const fallbackAsset = createFallbackAsset(product.taskId, input.prompt, planItem);
  fallbackAsset.images = [createFallbackImageItem(product.taskId, input.prompt, planItem)];

  const provider = normalizeProvider(config.provider);

  if (!config.baseUrl || provider === "prompt-url" || provider.startsWith("mock")) {
    return fallbackAsset.images[0];
  }

  const asset =
    provider === "vidu"
      ? await runViduImageModel(product, promptEntry, config)
      : provider.includes("openai") || provider.includes("gpt") || provider.includes("newapi")
        ? await runOpenAICompatibleImageModel(product, promptEntry, config)
        : await runGenericImageModel(product, promptEntry, config, fallbackAsset);

  return asset.images?.[0] ?? fallbackAsset.images[0];
}
