import { promises as fs } from "node:fs";
import path from "node:path";
import { buildJsonAuthHeaders, normalizeApiKey } from "@/lib/integrations/auth";
import type { ImageAsset, ModelApiConfig, ProductProfile, ThemeSet } from "@/lib/types";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const MAX_REFERENCE_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 14 * 1024 * 1024;

function buildPrompt(product: ProductProfile, theme: ThemeSet) {
  const keyword = theme.selectedKeyword ?? theme.mainKeyword;
  return `${product.productName} 社媒封面图，主题为 ${keyword}，品牌调性 ${product.brandTone}，现代科技质感，真实光影，画面简洁，产品主体突出，适合内容发布工作台预览`;
}

function buildPromptUrl(prompt: string) {
  return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=landscape_16_9`;
}

function createFallbackAsset(taskId: string, prompt: string, overrides?: Partial<ImageAsset>): ImageAsset {
  return {
    taskId,
    assetType: "cover",
    url: buildPromptUrl(prompt),
    reviewStatus: "fallback",
    prompt,
    provider: "prompt-url",
    generationMode: "prompt",
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

async function runViduImageModel(product: ProductProfile, prompt: string, config: ModelApiConfig): Promise<ImageAsset> {
  const referenceImages = await resolveReferenceImages(product);
  const createdTask = await createViduTask(product, prompt, config, referenceImages);
  const imageUrl = await pollViduImageUrl(createdTask.taskId, config);

  return {
    taskId: product.taskId,
    assetType: "cover",
    url: imageUrl,
    reviewStatus: "pending",
    prompt,
    provider: "vidu",
    providerTaskId: createdTask.taskId,
    generationMode: createdTask.generationMode,
    updatedAt: new Date().toISOString(),
  };
}

async function runGenericImageModel(product: ProductProfile, prompt: string, config: ModelApiConfig, fallbackAsset: ImageAsset) {
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: buildJsonAuthHeaders(config.apiKey),
    body: JSON.stringify({ product, modelName: config.modelName, prompt }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return fallbackAsset;
    }
    throw new Error(`IMAGE_API_${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    await response.text().catch(() => "");
    return fallbackAsset;
  }

  let payload: Partial<ImageAsset> = {};
  try {
    payload = (await response.json()) as Partial<ImageAsset>;
  } catch {
    return fallbackAsset;
  }

  return {
    taskId: product.taskId,
    assetType: "cover",
    url: payload.url ?? fallbackAsset.url,
    reviewStatus: payload.reviewStatus ?? "pending",
    prompt,
    provider: payload.provider ?? "generic",
    generationMode: payload.generationMode ?? "prompt",
    updatedAt: new Date().toISOString(),
  } satisfies ImageAsset;
}

export async function runImageModel(product: ProductProfile, theme: ThemeSet, config: ModelApiConfig): Promise<ImageAsset> {
  const prompt = buildPrompt(product, theme);
  const fallbackAsset = createFallbackAsset(product.taskId, prompt);
  const provider = normalizeProvider(config.provider);

  if (!config.baseUrl || provider === "prompt-url" || provider.startsWith("mock")) {
    return {
      ...fallbackAsset,
      reviewStatus: "pending",
    };
  }

  if (provider === "vidu") {
    return runViduImageModel(product, prompt, config);
  }

  return runGenericImageModel(product, prompt, config, fallbackAsset);
}
