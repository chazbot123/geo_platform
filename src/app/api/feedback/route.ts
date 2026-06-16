import { NextResponse } from "next/server";
import { toUserFacingErrorMessage } from "@/lib/errors/user-facing";
import type { FeedbackPayload } from "@/lib/feedback/client";
import { isFeedbackPayload } from "@/lib/feedback/validation";

export const runtime = "nodejs";

function configuredEndpoint() {
  return process.env.GEO_FEEDBACK_ENDPOINT?.trim() || "";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<FeedbackPayload>;

    if (!isFeedbackPayload(payload)) {
      return NextResponse.json({ error: "反馈内容不完整" }, { status: 400 });
    }

    const endpoint = configuredEndpoint();
    if (!endpoint) {
      return NextResponse.json({ error: "反馈服务端点未配置" }, { status: 503 });
    }

    const upstreamUrl = new URL(endpoint);
    if (process.env.NODE_ENV === "production" && upstreamUrl.protocol !== "https:") {
      return NextResponse.json({ error: "生产环境反馈端点必须使用 HTTPS" }, { status: 503 });
    }

    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { error: toUserFacingErrorMessage(result.error, "服务端暂时不可用，请稍后重试。") },
        { status: response.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: toUserFacingErrorMessage(error, "反馈提交失败，请稍后重试。") },
      { status: 502 },
    );
  }
}
