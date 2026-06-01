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
  }>;
}

export interface OpenAICompatibleTextResult {
  endpoint: string;
  status: number;
  rawText: string;
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

export function resolveOpenAICompatibleEndpoint(baseUrl: string) {
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
    parsed.pathname = "/chat/completions";
    return parsed.toString();
  }

  parsed.pathname = `${path}/chat/completions`;
  return parsed.toString();
}

export function resolveSkyEndpoint(baseUrl: string) {
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
    parsed.pathname = "/v1/chat/completions";
    return parsed.toString();
  }

  parsed.pathname = `${path}/v1/chat/completions`;
  return parsed.toString();
}

export function isNewApiAutoProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  return normalized === "sky" || normalized === "newapi-auto";
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

    const payload = (await response.json()) as OpenAICompatibleResponseShape;
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
  return callOpenAICompatibleTextModel(config, messages);
}
