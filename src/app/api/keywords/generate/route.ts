import { NextResponse } from "next/server";
import { generateCustomerKeywords, generateKeywordsForTask, getCustomerKeywordWorkbenchData } from "@/lib/keywords/service";

function formatProbeDetails(prefix: string, message: string) {
  const raw = message.replace(prefix, "");
  try {
    const attempts = JSON.parse(raw) as Array<{ endpoint?: string; authMode?: string; error?: string }>;
    if (!Array.isArray(attempts) || !attempts.length) {
      return "未返回可用的探测轨迹。";
    }
    return attempts
      .map((attempt) => `${attempt.authMode ?? "unknown"} -> ${attempt.endpoint ?? "unknown"} (${attempt.error ?? "UNKNOWN_ERROR"})`)
      .join("；");
  } catch {
    return raw;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { taskId?: string; mode?: "customer" };
    if (!body.taskId || body.mode === "customer") {
      const keywordSet = await generateCustomerKeywords();
      const workbenchData = await getCustomerKeywordWorkbenchData();
      return NextResponse.json({ ...workbenchData, keywordSet });
    }

    const theme = await generateKeywordsForTask(body.taskId);
    return NextResponse.json({ theme });
  } catch (error) {
    if (error instanceof Error && error.message === "STAGE1_API_TIMEOUT") {
      return NextResponse.json(
        { error: "AI 提问句生成超时，请稍后重试，或在设置页提高模型超时时间。" },
        { status: 500 },
      );
    }
    if (error instanceof Error && error.message.startsWith("STAGE1_API_405@")) {
      const endpoint = error.message.replace("STAGE1_API_405@", "");
      return NextResponse.json(
        {
          error: `第一阶段模型接口返回 405，请检查接口地址是否应填写为 /v1 或完整 /chat/completions 地址。当前请求地址：${endpoint}`,
        },
        { status: 500 },
      );
    }
    if (error instanceof Error && error.message.startsWith("STAGE1_API_PROBE_FAILED@")) {
      return NextResponse.json(
        {
          error: `第一阶段模型自动探测失败。已尝试：${formatProbeDetails("STAGE1_API_PROBE_FAILED@", error.message)}`,
        },
        { status: 500 },
      );
    }
    if (error instanceof Error && error.message.startsWith("STAGE1_OUTPUT_PARSE_FAILED@")) {
      return NextResponse.json(
        { error: "文字模型已返回结果，但结果格式不符合要求，请重试，或更换更稳定的文字模型。" },
        { status: 500 },
      );
    }
    if (error instanceof Error && error.message.startsWith("STAGE1_API_BAD_JSON@")) {
      return NextResponse.json(
        { error: "文字模型返回了不可解析的响应，请检查模型接口兼容性后重试。" },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成提问句失败。" }, { status: 500 });
  }
}
