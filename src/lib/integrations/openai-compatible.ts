import { buildJsonAuthHeaders } from "@/lib/integrations/auth";
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

export function resolveOpenAICompatibleEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/g, "");
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

export async function callOpenAICompatibleTextModel(
  config: ModelApiConfig,
  messages: OpenAICompatibleMessage[],
) {
  const endpoint = resolveOpenAICompatibleEndpoint(config.baseUrl);
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(config.timeout) || 15000);
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: buildJsonAuthHeaders(config.apiKey),
        body: JSON.stringify({
          model: config.modelName,
          messages,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("REQUEST_TIMEOUT");
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
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
