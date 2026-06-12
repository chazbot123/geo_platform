import { NextResponse } from "next/server";
import { getAppConfig, normalizeAppConfig } from "@/lib/config/service";
import { buildJsonAuthHeaders, normalizeApiKey } from "@/lib/integrations/auth";
import {
  extractOpenAICompatibleErrorMessage,
  NewAPIProbeError,
  OpenAICompatibleHttpError,
  callConfiguredTextModel,
  resolveConfiguredOpenAICompatibleEndpoint,
  type NewAPIProbeAttempt,
} from "@/lib/integrations/openai-compatible";
import type { AppConfig, ModelApiConfig } from "@/lib/types";

interface ProbeOutcome {
  ok: boolean;
  endpoint?: string;
  error?: string;
  attempts?: NewAPIProbeAttempt[];
  isMockFallback?: boolean;
  provider?: string;
}

function resolveModelCatalogEndpoint(modelConfig: ModelApiConfig) {
  return resolveConfiguredOpenAICompatibleEndpoint(modelConfig.provider, modelConfig.baseUrl).replace(
    /\/chat\/completions$/i,
    "/models",
  );
}

async function confirmModelCatalogAvailability(modelConfig: ModelApiConfig): Promise<ProbeOutcome | null> {
  const endpoint = resolveModelCatalogEndpoint(modelConfig);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: buildJsonAuthHeaders(modelConfig.apiKey),
    });
    const rawBody = await response.text();

    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        return null;
      }

      const detail = extractOpenAICompatibleErrorMessage(rawBody);
      return {
        ok: false,
        endpoint,
        provider: modelConfig.provider,
        error: detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`,
      };
    }

    try {
      const payload = JSON.parse(rawBody) as { data?: Array<{ id?: string }> };
      const modelName = modelConfig.modelName.trim();
      const modelExists = payload.data?.some((item) => item?.id?.trim() === modelName);
      if (modelName && payload.data?.length && !modelExists) {
        return {
          ok: false,
          endpoint,
          provider: modelConfig.provider,
          error: `模型 ${modelName} 不在当前服务的可用列表中`,
        };
      }
    } catch {
      // Some compatible gateways return non-standard model payloads. A 200 still proves the gateway is reachable.
    }

    return {
      ok: true,
      endpoint,
      provider: modelConfig.provider,
    };
  } catch {
    return null;
  }
}

async function probeTextConfig(modelConfig: ModelApiConfig): Promise<ProbeOutcome> {
  if (!modelConfig.baseUrl?.trim() || !modelConfig.apiKey?.trim()) {
    return { ok: false, provider: modelConfig.provider, error: "未配置 API 地址或 API Key" };
  }

  try {
    const result = await callConfiguredTextModel(modelConfig, [{ role: "user", content: "ping" }]);
    return { ok: true, endpoint: result.endpoint, provider: modelConfig.provider };
  } catch (error) {
    if (error instanceof NewAPIProbeError) {
      return {
        ok: false,
        provider: modelConfig.provider,
        error: `所有端点探测失败（共 ${error.attempts.length} 次）`,
        attempts: error.attempts,
      };
    }
    if (error instanceof OpenAICompatibleHttpError) {
      if (error.status === 503) {
        const fallbackResult = await confirmModelCatalogAvailability(modelConfig);
        if (fallbackResult) {
          return fallbackResult;
        }
      }
      const endpoint = resolveConfiguredOpenAICompatibleEndpoint(modelConfig.provider, modelConfig.baseUrl);
      const detail = extractOpenAICompatibleErrorMessage(error.responseBody);
      return {
        ok: false,
        endpoint,
        provider: modelConfig.provider,
        error: detail ? `HTTP ${error.status}: ${detail}` : `HTTP ${error.status}`,
      };
    }
    if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
      const fallbackResult = await confirmModelCatalogAvailability(modelConfig);
      if (fallbackResult) {
        return fallbackResult;
      }
      const endpoint = resolveConfiguredOpenAICompatibleEndpoint(modelConfig.provider, modelConfig.baseUrl);
      return { ok: false, endpoint, provider: modelConfig.provider, error: "请求超时" };
    }
    return { ok: false, provider: modelConfig.provider, error: error instanceof Error ? error.message : "探测失败" };
  }
}

function resolveViduEndpoint(baseUrl: string, pathname: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const endpoint = new URL(new URL(trimmed).origin);
    endpoint.pathname = pathname;
    endpoint.searchParams.set("show_detail", "false");
    return endpoint.toString();
  } catch {
    return "";
  }
}

async function probeViduConfig(modelConfig: ModelApiConfig): Promise<ProbeOutcome> {
  const endpoint = resolveViduEndpoint(modelConfig.baseUrl, "/ent/v2/credits");
  const apiKey = normalizeApiKey(modelConfig.apiKey);
  if (!endpoint || !apiKey) {
    return { ok: false, provider: modelConfig.provider, error: "未配置 Vidu API 地址或 API Key" };
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${apiKey}`,
      },
    });
    const rawBody = await response.text();
    if (!response.ok) {
      const detail = extractOpenAICompatibleErrorMessage(rawBody) || rawBody.trim().slice(0, 160);
      return {
        ok: false,
        endpoint,
        provider: modelConfig.provider,
        error: detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      endpoint,
      provider: modelConfig.provider,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      provider: modelConfig.provider,
      error: error instanceof Error ? error.message : "Vidu 探测失败",
    };
  }
}

async function probeImageConfig(modelConfig: ModelApiConfig): Promise<ProbeOutcome> {
  const provider = modelConfig.provider.trim();
  const normalizedProvider = provider.toLowerCase();

  if (!provider || normalizedProvider === "prompt-url" || normalizedProvider.startsWith("mock")) {
    return {
      ok: true,
      provider: modelConfig.provider,
      isMockFallback: true,
      error: "图片模型使用本地回退。",
    };
  }

  if (!modelConfig.baseUrl?.trim() || !modelConfig.apiKey?.trim()) {
    return { ok: false, provider: modelConfig.provider, error: "未配置 API 地址或 API Key" };
  }

  if (normalizedProvider === "vidu") {
    return probeViduConfig(modelConfig);
  }

  return {
    ok: true,
    provider: modelConfig.provider,
    endpoint: modelConfig.baseUrl,
  };
}

async function getProbeConfig(request: Request) {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return getAppConfig();
  }

  const payload = JSON.parse(rawBody) as AppConfig | { config?: AppConfig };
  const config = "config" in payload && payload.config ? payload.config : (payload as AppConfig);
  return normalizeAppConfig(config);
}

export async function POST(request: Request) {
  const config = await getProbeConfig(request);
  const [text, image] = await Promise.allSettled([
    probeTextConfig(config.contentModelApiConfig),
    probeImageConfig(config.imageModelApiConfig),
  ]);

  return NextResponse.json({
    text: text.status === "fulfilled" ? text.value : { ok: false, error: String(text.reason) },
    image: image.status === "fulfilled" ? image.value : { ok: false, error: String(image.reason) },
  });
}
