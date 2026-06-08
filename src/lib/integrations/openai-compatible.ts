import { buildAuthHeaderCandidates, buildJsonAuthHeaders, type AuthHeaderCandidate } from "@/lib/integrations/auth";
import type { ModelApiConfig } from "@/lib/types";

export interface OpenAICompatibleMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAICompatibleResponseShape {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export interface OpenAICompatibleTextResult {
  endpoint: string;
  status: number;
  rawText: string;
}

export type OpenAICompatibleProviderProfileId =
  | "newapi-auto"
  | "volcengine-ark"
  | "dashscope-qwen"
  | "tencent-hunyuan"
  | "deepseek"
  | "openai"
  | "generic-compatible";

export interface OpenAICompatibleProviderProfile {
  id: OpenAICompatibleProviderProfileId;
  provider: string;
  endpointMode: "newapi-probe" | "ark-chat" | "dashscope-qwen" | "hunyuan-chat" | "openai-v1" | "generic-chat";
}

export class OpenAICompatibleHttpError extends Error {
  status: number;
  endpoint: string;

  constructor(status: number, endpoint: string) {
    super(`HTTP_${status}@${endpoint}`);
    this.name = "OpenAICompatibleHttpError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export function classifyOpenAICompatibleHttpStatus(status: number) {
  if (status === 401 || status === 403) {
    return "AUTH";
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  if (status === 405) {
    return "METHOD_NOT_ALLOWED";
  }
  if (status === 408 || status === 504) {
    return "TIMEOUT";
  }
  if (status === 429) {
    return "RATE_LIMIT";
  }
  if (status >= 500) {
    return "SERVER";
  }
  return `HTTP_${status}`;
}

export class OpenAICompatibleResponseParseError extends Error {
  endpoint: string;

  constructor(endpoint: string) {
    super(`BAD_JSON@${endpoint}`);
    this.name = "OpenAICompatibleResponseParseError";
    this.endpoint = endpoint;
  }
}

export interface NewAPIProbeAttempt {
  endpoint: string;
  authMode: string;
  status?: number;
  error: string;
}

export class NewAPIProbeError extends Error {
  attempts: NewAPIProbeAttempt[];

  constructor(attempts: NewAPIProbeAttempt[]) {
    super("NEWAPI_PROBE_FAILED");
    this.name = "NewAPIProbeError";
    this.attempts = attempts;
  }
}

interface ProbeCacheEntry {
  endpoint: string;
  authCandidate: AuthHeaderCandidate;
}

const probeCache = new Map<string, ProbeCacheEntry>();

export function normalizeOpenAICompatibleProviderName(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "sky") {
    return "newapi-auto";
  }
  if (["volcengine", "volcengine-ark", "ark", "doubao", "doubao-ark"].includes(normalized)) {
    return "volcengine-ark";
  }
  if (["tongyi", "qwen", "dashscope", "dashscope-qwen", "aliyun-qwen"].includes(normalized)) {
    return "dashscope-qwen";
  }
  // yuanbao is the consumer app; API-backed generation uses Tencent Hunyuan
  if (["hunyuan", "tencent-hunyuan", "tencent_hunyuan", "yuanbao"].includes(normalized)) {
    return "tencent-hunyuan";
  }
  return provider.trim();
}

export function getOpenAICompatibleProviderProfile(provider: string): OpenAICompatibleProviderProfile {
  const normalized = normalizeOpenAICompatibleProviderName(provider).toLowerCase();

  if (normalized === "newapi-auto") {
    return {
      id: "newapi-auto",
      provider: "newapi-auto",
      endpointMode: "newapi-probe",
    };
  }

  if (normalized === "volcengine-ark") {
    return {
      id: "volcengine-ark",
      provider: "volcengine-ark",
      endpointMode: "ark-chat",
    };
  }

  if (normalized === "dashscope-qwen") {
    return {
      id: "dashscope-qwen",
      provider: "dashscope-qwen",
      endpointMode: "dashscope-qwen",
    };
  }

  if (normalized === "tencent-hunyuan") {
    return {
      id: "tencent-hunyuan",
      provider: "tencent-hunyuan",
      endpointMode: "hunyuan-chat",
    };
  }

  if (normalized === "deepseek") {
    return {
      id: "deepseek",
      provider: "deepseek",
      endpointMode: "openai-v1",
    };
  }

  if (normalized === "open ai" || normalized === "openai" || normalized.includes("open") || normalized.includes("gpt")) {
    return {
      id: "openai",
      provider: normalized === "open ai" ? "openai" : normalizeOpenAICompatibleProviderName(provider),
      endpointMode: "openai-v1",
    };
  }

  return {
    id: "generic-compatible",
    provider: normalizeOpenAICompatibleProviderName(provider),
    endpointMode: "generic-chat",
  };
}

function isAbortLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    error.message === "This operation was aborted" ||
    error.message.toLowerCase().includes("operation was aborted")
  );
}

function appendChatCompletionsPath(baseUrl: string, defaultRootPath: "/chat/completions" | "/v1/chat/completions") {
  const normalized = sanitizeBaseUrl(baseUrl).replace(/\/+$/g, "");
  if (!normalized) {
    return normalized;
  }

  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }

  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/chat/completions`;
  }

  const parsed = new URL(normalized);
  const path = parsed.pathname.replace(/\/+$/g, "");

  if (!path || path === "/") {
    parsed.pathname = defaultRootPath;
    return parsed.toString();
  }

  parsed.pathname = `${path}/chat/completions`;
  return parsed.toString();
}

export function resolveOpenAICompatibleEndpoint(baseUrl: string) {
  return appendChatCompletionsPath(baseUrl, "/chat/completions");
}

export function resolveSkyEndpoint(baseUrl: string) {
  return appendChatCompletionsPath(baseUrl, "/v1/chat/completions");
}

export function resolveDashscopeQwenEndpoint(baseUrl: string) {
  const normalized = sanitizeBaseUrl(baseUrl).replace(/\/+$/g, "");
  if (!normalized) {
    return normalized;
  }

  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }

  if (/\/v1$/i.test(normalized) || /\/compatible-mode\/v1$/i.test(normalized)) {
    return `${normalized}/chat/completions`;
  }

  const parsed = new URL(normalized);
  const urlPath = parsed.pathname.replace(/\/+$/g, "");

  if (!urlPath || urlPath === "/") {
    parsed.pathname = "/compatible-mode/v1/chat/completions";
    return parsed.toString();
  }

  parsed.pathname = `${urlPath}/chat/completions`;
  return parsed.toString();
}

export function resolveArkEndpoint(baseUrl: string) {
  const normalized = sanitizeBaseUrl(baseUrl).replace(/\/+$/g, "");
  if (!normalized) {
    return normalized;
  }

  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }

  if (/\/api\/v3$/i.test(normalized) || /\/v1$/i.test(normalized)) {
    return `${normalized}/chat/completions`;
  }

  const parsed = new URL(normalized);
  const path = parsed.pathname.replace(/\/+$/g, "");

  if (!path || path === "/") {
    parsed.pathname = "/api/v3/chat/completions";
    return parsed.toString();
  }

  parsed.pathname = `${path}/chat/completions`;
  return parsed.toString();
}

export function isNewApiAutoProvider(provider: string) {
  return getOpenAICompatibleProviderProfile(provider).id === "newapi-auto";
}

export function isVolcengineArkProvider(provider: string) {
  return getOpenAICompatibleProviderProfile(provider).id === "volcengine-ark";
}

export function isDashscopeQwenProvider(provider: string) {
  return getOpenAICompatibleProviderProfile(provider).id === "dashscope-qwen";
}

export function isTencentHunyuanProvider(provider: string) {
  return getOpenAICompatibleProviderProfile(provider).id === "tencent-hunyuan";
}

/**
 * Normalizes a caller-supplied base URL to the Tencent Hunyuan chat completions endpoint.
 * Accepts the root domain, /v1, or the full /v1/chat/completions path.
 * Falls back to https://api.hunyuan.cloud.tencent.com/v1/chat/completions when given only the host.
 */
export function resolveHunyuanEndpoint(baseUrl: string) {
  const normalized = sanitizeBaseUrl(baseUrl).replace(/\/+$/g, "");
  if (!normalized) {
    return normalized;
  }

  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }

  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/chat/completions`;
  }

  const parsed = new URL(normalized);
  const urlPath = parsed.pathname.replace(/\/+$/g, "");

  if (!urlPath || urlPath === "/") {
    parsed.pathname = "/v1/chat/completions";
    return parsed.toString();
  }

  parsed.pathname = `${urlPath}/chat/completions`;
  return parsed.toString();
}

export function resolveConfiguredOpenAICompatibleEndpoint(provider: string, baseUrl: string) {
  const profile = getOpenAICompatibleProviderProfile(provider);

  switch (profile.endpointMode) {
    case "ark-chat":
      return resolveArkEndpoint(baseUrl);
    case "dashscope-qwen":
      return resolveDashscopeQwenEndpoint(baseUrl);
    case "hunyuan-chat":
      return resolveHunyuanEndpoint(baseUrl);
    case "openai-v1":
      return resolveSkyEndpoint(baseUrl);
    case "newapi-probe":
      return sanitizeBaseUrl(baseUrl).replace(/\/+$/g, "");
    case "generic-chat":
    default:
      return resolveOpenAICompatibleEndpoint(baseUrl);
  }
}

function sanitizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/^[`'"]+|[`'"]+$/g, "");
}

function hashString(input: string) {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function buildProbeCacheKey(config: ModelApiConfig) {
  return [
    config.provider.trim().toLowerCase(),
    sanitizeBaseUrl(config.baseUrl).toLowerCase(),
    hashString(config.apiKey),
    config.modelName.trim().toLowerCase(),
  ].join("|");
}

function buildNewApiEndpointCandidates(baseUrl: string) {
  const sanitized = sanitizeBaseUrl(baseUrl).replace(/\/+$/g, "");
  if (!sanitized) {
    return [];
  }

  const candidates: string[] = [];
  const addCandidate = (value: string) => {
    const normalized = value.trim().replace(/\/+$/g, "");
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  addCandidate(sanitized);

  try {
    const parsed = new URL(sanitized);
    const path = parsed.pathname.replace(/\/+$/g, "");

    const withPath = (pathname: string) => {
      const next = new URL(parsed.toString());
      next.pathname = pathname;
      next.search = "";
      addCandidate(next.toString());
    };

    if (!path || path === "/") {
      withPath("/v1/chat/completions");
      withPath("/chat/completions");
      return candidates;
    }

    if (/\/v1\/chat\/completions$/i.test(path)) {
      const rootPath = path.replace(/\/v1\/chat\/completions$/i, "") || "/";
      withPath(`${rootPath === "/" ? "" : rootPath}/chat/completions`);
      return candidates;
    }

    if (/\/chat\/completions$/i.test(path)) {
      const rootPath = path.replace(/\/chat\/completions$/i, "") || "/";
      withPath(`${rootPath === "/" ? "" : rootPath}/v1/chat/completions`);
      return candidates;
    }

    if (/\/v1$/i.test(path)) {
      withPath(`${path}/chat/completions`);
      return candidates;
    }

    withPath(`${path}/v1/chat/completions`);
    withPath(`${path}/chat/completions`);
  } catch {
    addCandidate(resolveSkyEndpoint(sanitized));
    addCandidate(resolveOpenAICompatibleEndpoint(sanitized));
  }

  return candidates;
}

function extractMessageContent(content?: string | Array<{ type?: string; text?: string }>) {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

function parseOpenAICompatiblePayload(rawBody: string): OpenAICompatibleResponseShape {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return {};
  }

  if (!trimmed.startsWith("data:")) {
    return JSON.parse(trimmed) as OpenAICompatibleResponseShape;
  }

  const contentChunks: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const eventPayload = line.trim().replace(/^data:\s*/i, "");
    if (!eventPayload || eventPayload === "[DONE]") {
      continue;
    }

    const event = JSON.parse(eventPayload) as OpenAICompatibleResponseShape;
    const choice = event.choices?.[0];
    const content = extractMessageContent(choice?.delta?.content ?? choice?.message?.content);
    if (content) {
      contentChunks.push(content);
    }
  }

  return {
    choices: [
      {
        message: {
          content: contentChunks.join(""),
        },
      },
    ],
  };
}

function parseResponsePayload(endpoint: string, rawBody: string) {
  try {
    return parseOpenAICompatiblePayload(rawBody);
  } catch {
    throw new OpenAICompatibleResponseParseError(endpoint);
  }
}

export function extractJsonString(rawText: string) {
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = rawText.indexOf("{");
  const objectEnd = rawText.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return rawText.slice(objectStart, objectEnd + 1).trim();
  }

  const arrayStart = rawText.indexOf("[");
  const arrayEnd = rawText.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return rawText.slice(arrayStart, arrayEnd + 1).trim();
  }

  return rawText.trim();
}

export function parseJsonFromModelText<T>(rawText: string): T | null {
  const jsonString = extractJsonString(rawText);
  if (!jsonString) {
    return null;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return null;
  }
}

async function performTextRequest(
  endpoint: string,
  headers: Record<string, string>,
  config: ModelApiConfig,
  messages: OpenAICompatibleMessage[],
) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(config.timeout) || 15000);
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.modelName,
          messages,
          temperature: 0.3,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw new Error("REQUEST_TIMEOUT");
      }
      throw error;
    }

    if (!response.ok) {
      throw new OpenAICompatibleHttpError(response.status, endpoint);
    }

    const rawBody = await response.text();
    const payload = parseResponsePayload(endpoint, rawBody);
    const rawText = extractMessageContent(payload.choices?.[0]?.message?.content);
    return {
      endpoint,
      status: response.status,
      rawText,
    } satisfies OpenAICompatibleTextResult;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function callOpenAICompatibleTextModel(
  config: ModelApiConfig,
  messages: OpenAICompatibleMessage[],
) {
  const endpoint = resolveOpenAICompatibleEndpoint(config.baseUrl);
  return performTextRequest(endpoint, buildJsonAuthHeaders(config.apiKey), config, messages);
}

export async function callArkTextModel(
  config: ModelApiConfig,
  messages: OpenAICompatibleMessage[],
) {
  const endpoint = resolveArkEndpoint(config.baseUrl);
  return performTextRequest(endpoint, buildJsonAuthHeaders(config.apiKey), config, messages);
}

export async function callDashscopeQwenTextModel(
  config: ModelApiConfig,
  messages: OpenAICompatibleMessage[],
) {
  const endpoint = resolveDashscopeQwenEndpoint(config.baseUrl);
  return performTextRequest(endpoint, buildJsonAuthHeaders(config.apiKey), config, messages);
}

export async function callHunyuanTextModel(
  config: ModelApiConfig,
  messages: OpenAICompatibleMessage[],
) {
  const endpoint = resolveHunyuanEndpoint(config.baseUrl);
  return performTextRequest(endpoint, buildJsonAuthHeaders(config.apiKey), config, messages);
}

export async function callNewApiAutoDetectTextModel(
  config: ModelApiConfig,
  messages: OpenAICompatibleMessage[],
) {
  const attempts: NewAPIProbeAttempt[] = [];
  const cacheKey = buildProbeCacheKey(config);
  const cached = probeCache.get(cacheKey);

  if (cached) {
    try {
      return await performTextRequest(cached.endpoint, cached.authCandidate.headers, config, messages);
    } catch (error) {
      if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
        throw error;
      }
      attempts.push({
        endpoint: cached.endpoint,
        authMode: cached.authCandidate.label,
        status: error instanceof OpenAICompatibleHttpError ? error.status : undefined,
        error: error instanceof OpenAICompatibleHttpError ? `HTTP_${error.status}` : error instanceof Error ? error.message : "UNKNOWN_ERROR",
      });
      probeCache.delete(cacheKey);
    }
  }

  const endpoints = buildNewApiEndpointCandidates(config.baseUrl);
  const authCandidates = buildAuthHeaderCandidates(config.apiKey);

  for (const endpoint of endpoints) {
    for (const authCandidate of authCandidates) {
      if (cached && cached.endpoint === endpoint && cached.authCandidate.label === authCandidate.label) {
        continue;
      }

      try {
        const result = await performTextRequest(endpoint, authCandidate.headers, config, messages);
        probeCache.set(cacheKey, { endpoint, authCandidate });
        return result;
      } catch (error) {
        if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
          throw error;
        }

        attempts.push({
          endpoint,
          authMode: authCandidate.label,
          status: error instanceof OpenAICompatibleHttpError ? error.status : undefined,
          error: error instanceof OpenAICompatibleHttpError ? `HTTP_${error.status}` : error instanceof Error ? error.message : "UNKNOWN_ERROR",
        });
      }
    }
  }

  throw new NewAPIProbeError(attempts);
}

export async function callConfiguredTextModel(
  config: ModelApiConfig,
  messages: OpenAICompatibleMessage[],
) {
  if (isNewApiAutoProvider(config.provider)) {
    return callNewApiAutoDetectTextModel(config, messages);
  }
  if (isVolcengineArkProvider(config.provider)) {
    return callArkTextModel(config, messages);
  }
  if (isDashscopeQwenProvider(config.provider)) {
    return callDashscopeQwenTextModel(config, messages);
  }
  if (isTencentHunyuanProvider(config.provider)) {
    return callHunyuanTextModel(config, messages);
  }
  const endpoint = resolveConfiguredOpenAICompatibleEndpoint(config.provider, config.baseUrl);
  return performTextRequest(endpoint, buildJsonAuthHeaders(config.apiKey), config, messages);
}
