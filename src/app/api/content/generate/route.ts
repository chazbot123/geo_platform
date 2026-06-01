import { NextResponse } from "next/server";
import { generateContentForTask } from "@/lib/content/service";

function formatProbeDetails(message: string) {
  const raw = message.replace("CONTENT_API_PROBE_FAILED@", "");
  try {
    const attempts = JSON.parse(raw) as Array<{ endpoint?: string; authMode?: string; error?: string }>;
    return attempts
      .map((attempt) => `${attempt.authMode ?? "unknown"} -> ${attempt.endpoint ?? "unknown"} (${attempt.error ?? "UNKNOWN_ERROR"})`)
      .join("；");
  } catch {
    return raw;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      taskId: string;
      aiScenario?: string;
      platform?: string;
      contentAngle?: string;
    };
    const content = await generateContentForTask(body.taskId, {
      aiScenario: body.aiScenario,
      platform: body.platform,
      contentAngle: body.contentAngle,
    });
    return NextResponse.json({ content });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CONTENT_API_PROBE_FAILED@")) {
      return NextResponse.json({ error: `内容模型自动探测失败。已尝试：${formatProbeDetails(error.message)}` }, { status: 500 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "内容生成失败" }, { status: 500 });
  }
}
