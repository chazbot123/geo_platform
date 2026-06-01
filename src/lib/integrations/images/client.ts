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

interface ArticleImagePlanItem {
  imageIndex: number;
  imageCount: number;
  paragraphIndex: number;
  sectionExcerpt: string;
  alt: string;
  question?: string;
  sectionHeading?: string;
}

const REQUIRED_IMAGE_COUNT = 5;

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

function extractArticleParagraphs(content?: ContentDraft) {
  if (!content?.content?.trim()) {
    return [] as string[];
  }

  return content.content
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => normalizeTextBlock(paragraph))
    .filter((paragraph) => paragraph.length >= 18);
}

function buildArticleImagePlan(content: ContentDraft | undefined, keyword: string): ArticleImagePlanItem[] {
  const reportSections = content?.reportSections?.length ? content.reportSections : [];
  const imageCount = REQUIRED_IMAGE_COUNT;

  if (reportSections.length) {
    const earlySection = reportSections[0];
    const middleSection = reportSections[Math.floor((reportSections.length - 1) / 2)];
    const lateSection = reportSections[Math.max(0, reportSections.length - 1)];
    const candidates = [
      {
        sectionHeading: "报告总述",
        question: content?.selectedKeywordTheme || keyword,
        sectionExcerpt: [content?.summary, content?.reportIntroduction].filter(Boolean).join(" "),
        paragraphIndex: 0,
      },
      {
        sectionHeading: earlySection?.heading || "核心问题一",
        question: earlySection?.question || keyword,
        sectionExcerpt: [earlySection?.summary, earlySection?.body].filter(Boolean).join(" "),
        paragraphIndex: 2,
      },
      {
        sectionHeading: middleSection?.heading || "核心问题分析",
        question: middleSection?.question || keyword,
        sectionExcerpt: [middleSection?.summary, middleSection?.body].filter(Boolean).join(" "),
        paragraphIndex: 2 + Math.floor((reportSections.length - 1) / 2),
      },
      {
        sectionHeading: lateSection?.heading || "核心问题延展",
        question: lateSection?.question || keyword,
        sectionExcerpt: [lateSection?.summary, lateSection?.body].filter(Boolean).join(" "),
        paragraphIndex: 1 + reportSections.length,
      },
      {
        sectionHeading: "报告结论",
        question: "最终判断与行动建议",
        sectionExcerpt: [content?.reportConclusion, content?.cta].filter(Boolean).join(" "),
        paragraphIndex: 2 + reportSections.length,
      },
    ];

    return candidates.map((item, index) => ({
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
  const fallbackParagraphs = [0, 1, 2, 3, 4].map((index) => paragraphs[index] || paragraphs[paragraphs.length - 1] || keyword);
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
  return Math.max(5000, Number(timeout) || 60000);
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
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
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

function ensureFiveImageAsset(taskId: string, asset: ImageAsset) {
  const images = asset.images ?? [];
  if (images.length !== REQUIRED_IMAGE_COUNT) {
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
  const endpoint = buildViduEndpoint(config.baseUrl, "/ent/v2/reference2image");
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
    Math.min(resolveTimeoutMs(config.timeout), 15000),
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
    prompts.map(async (entry) => {
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
      };
    }),
  );

  if (items.length !== REQUIRED_IMAGE_COUNT) {
    throw new Error(`Vidu 图片生成数量不足，当前仅成功返回 ${items.length} 张。`);
  }

  const cover = items[0];
  return ensureFiveImageAsset(product.taskId, {
    taskId: product.taskId,
    assetType: "cover",
    url: cover?.url || buildPromptUrl(prompts[0]?.prompt || product.productName),
    reviewStatus: cover?.reviewStatus ?? "pending",
    prompt: cover?.prompt || prompts[0]?.prompt || product.productName,
    provider: cover?.provider ?? "vidu",
    providerTaskId: cover?.providerTaskId,
    generationMode: cover?.generationMode ?? "prompt",
    images: items,
    updatedAt: new Date().toISOString(),
  });
}

async function runGenericImageModel(
  product: ProductProfile,
  prompts: Array<{ prompt: string; planItem: ArticleImagePlanItem }>,
  config: ModelApiConfig,
  fallbackAsset: ImageAsset,
) {
  const referenceImages = await resolveReferenceImages(product);
  const hasReferenceImages = referenceImages.length > 0;
  const results: Array<{ fallback: true; item?: undefined } | { fallback: false; item: ArticleImageItem }> = await Promise.all(
    prompts.map(async (entry) => {
      const response = await fetch(config.baseUrl, {
        method: "POST",
        headers: buildJsonAuthHeaders(config.apiKey),
        body: JSON.stringify({ product, modelName: config.modelName, prompt: entry.prompt }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { fallback: true as const };
        }
        throw new Error(`IMAGE_API_${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        await response.text().catch(() => "");
        return { fallback: true as const };
      }

      let payload: Partial<ImageAsset> = {};
      try {
        payload = (await response.json()) as Partial<ImageAsset>;
      } catch {
        return { fallback: true as const };
      }

      return {
        fallback: false as const,
        item: {
          id: `${product.taskId}-${randomUUID()}`,
          url: payload.url ?? buildPromptUrl(entry.prompt),
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
        },
      };
    }),
  );

  if (results.some((result) => result.fallback)) {
    return fallbackAsset;
  }

  const items: ArticleImageItem[] = results.flatMap((result) => (result.item ? [result.item] : []));

  if (items.length !== REQUIRED_IMAGE_COUNT) {
    throw new Error(`图片生成数量不足，当前仅成功返回 ${items.length} 张。`);
  }

  const cover = items[0];
  return ensureFiveImageAsset(product.taskId, {
    taskId: product.taskId,
    assetType: "cover",
    url: cover?.url ?? fallbackAsset.url,
    reviewStatus: cover?.reviewStatus ?? "pending",
    prompt: cover?.prompt ?? fallbackAsset.prompt,
    provider: cover?.provider ?? "generic",
    providerTaskId: cover?.providerTaskId,
    generationMode: cover?.generationMode ?? "prompt",
    images: items,
    updatedAt: new Date().toISOString(),
  } satisfies ImageAsset);
}

export async function runImageModel(
  product: ProductProfile,
  theme: ThemeSet,
  content: ContentDraft | undefined,
  config: ModelApiConfig,
): Promise<ImageAsset> {
  const keyword = pickKeyword(theme);
  const plan = buildArticleImagePlan(content, keyword);
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

  return runGenericImageModel(product, prompts, config, fallbackAsset);
}
