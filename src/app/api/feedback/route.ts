import { NextResponse } from "next/server";
import type { FeedbackPayload } from "@/lib/feedback/client";
import { FEEDBACK_ISSUE_TYPES } from "@/lib/feedback/client";

export const runtime = "nodejs";

const DEFAULT_FEEDBACK_ENDPOINT = "http://8.134.115.153/api/feedback";

function isFeedbackPayload(payload: Partial<FeedbackPayload>): payload is FeedbackPayload {
  return (
    typeof payload.id === "string" &&
    FEEDBACK_ISSUE_TYPES.includes(payload.type as FeedbackPayload["type"]) &&
    typeof payload.message === "string" &&
    payload.message.trim().length > 0 &&
    typeof payload.contact === "string" &&
    typeof payload.appVersion === "string" &&
    typeof payload.deviceFingerprint === "string" &&
    typeof payload.platform === "string" &&
    typeof payload.clientTime === "string" &&
    typeof payload.createdAt === "string"
  );
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<FeedbackPayload>;

    if (!isFeedbackPayload(payload)) {
      return NextResponse.json({ error: "反馈内容不完整" }, { status: 400 });
    }

    const endpoint = process.env.GEO_FEEDBACK_ENDPOINT ?? DEFAULT_FEEDBACK_ENDPOINT;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { error: typeof result.error === "string" ? result.error : "服务器暂时不可用，请稍后重试" },
        { status: response.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "反馈提交失败，请稍后重试" },
      { status: 502 },
    );
  }
}
