import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config/service";
import {
  NewAPIProbeError,
  OpenAICompatibleHttpError,
  callConfiguredTextModel,
  resolveConfiguredOpenAICompatibleEndpoint,
  type NewAPIProbeAttempt,
} from "@/lib/integrations/openai-compatible";
import type { ModelApiConfig } from "@/lib/types";

interface ProbeOutcome {
  ok: boolean;
  endpoint?: string;
  error?: string;
  attempts?: NewAPIProbeAttempt[];
  isMockFallback?: boolean;
  provider?: string;
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
      const endpoint = resolveConfiguredOpenAICompatibleEndpoint(modelConfig.provider, modelConfig.baseUrl);
      return { ok: false, endpoint, provider: modelConfig.provider, error: `HTTP ${error.status}` };
    }
    if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
      const endpoint = resolveConfiguredOpenAICompatibleEndpoint(modelConfig.provider, modelConfig.baseUrl);
      return { ok: false, endpoint, provider: modelConfig.provider, error: "请求超时" };
    }
    return { ok: false, provider: modelConfig.provider, error: error instanceof Error ? error.message : "探测失败" };
  }
}

function probeImageConfig(modelConfig: ModelApiConfig): ProbeOutcome {
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

  return {
    ok: true,
    provider: modelConfig.provider,
    endpoint: modelConfig.baseUrl,
  };
}

export async function POST() {
  const config = await getAppConfig();
  const text = await Promise.allSettled([probeTextConfig(config.contentModelApiConfig)]);

  return NextResponse.json({
    text: text[0].status === "fulfilled" ? text[0].value : { ok: false, error: String(text[0].reason) },
    image: probeImageConfig(config.imageModelApiConfig),
  });
}
