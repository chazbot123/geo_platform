import { NextResponse } from "next/server";
import { syncExtensionPublishSession } from "@/lib/publish/extension-session-service";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      sessionToken: string;
      status: "running" | "success" | "failed";
      draftUrl?: string;
      lastError?: string;
      authPayload?: string;
      accountName?: string;
      displayName?: string;
      sourceUrl?: string;
    };
    if (!payload.sessionToken?.trim()) {
      return NextResponse.json({ message: "缺少发布会话令牌。" }, { status: 400 });
    }
    if (!payload.status) {
      return NextResponse.json({ message: "缺少发布状态。" }, { status: 400 });
    }
    return NextResponse.json(await syncExtensionPublishSession(payload));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "同步扩展发布结果失败。" }, { status: 500 });
  }
}
