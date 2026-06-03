import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config/service";
import {
  NewAPIProbeError,
  OpenAICompatibleHttpError,
  callConfiguredTextModel,
  resolveConfiguredOpenAICompatibleEndpoint,
  type NewAPIProbeAttempt,
} from "@/lib/integrations/openai-compatible";

interface ProbeOutcome {
  ok: boolean;
  endpoint?: string;
  error?: string;
  attempts?: NewAPIProbeAttempt[];
}

async function probeConfig(configKey: "stage1ModelApiConfig" | "contentModelApiConfig"): Promise<ProbeOutcome> {
  const config = await getAppConfig();
  const modelConfig = config[configKey];

  if (!modelConfig.baseUrl?.trim() || !modelConfig.apiKey?.trim()) {
    return { ok: false, error: "未配置 API 地址或密钥" };
  }

  try {
    const result = await callConfiguredTextModel(modelConfig, [
      { role: "user", content: "ping" },
    ]);
    return { ok: true, endpoint: result.endpoint };
  } catch (error) {
    if (error instanceof NewAPIProbeError) {
      return {
        ok: false,
        error: `所有端点均探测失败（共 ${error.attempts.length} 次）`,
        attempts: error.attempts,
      };
    }
    if (error instanceof OpenAICompatibleHttpError) {
      const endpoint = resolveConfiguredOpenAICompatibleEndpoint(modelConfig.provider, modelConfig.baseUrl);
      return { ok: false, endpoint, error: `HTTP ${error.status}` };
    }
    if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
      const endpoint = resolveConfiguredOpenAICompatibleEndpoint(modelConfig.provider, modelConfig.baseUrl);
      return { ok: false, endpoint, error: "请求超时" };
    }
    return { ok: false, error: error instanceof Error ? error.message : "探测失败" };
  }
}

export async function POST() {
  const [stage1, content] = await Promise.allSettled([
    probeConfig("stage1ModelApiConfig"),
    probeConfig("contentModelApiConfig"),
  ]);

  return NextResponse.json({
    stage1: stage1.status === "fulfilled" ? stage1.value : { ok: false, error: String(stage1.reason) },
    content: content.status === "fulfilled" ? content.value : { ok: false, error: String(content.reason) },
  });
}
