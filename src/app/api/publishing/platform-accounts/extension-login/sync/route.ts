import { NextResponse } from "next/server";
import { syncExtensionLoginSession } from "@/lib/publish/extension-session-service";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      sessionToken: string;
      authType?: "cookie" | "session" | "manual";
      authPayload?: string;
      accountName?: string;
      displayName?: string;
      sourceUrl?: string;
      avatarUrl?: string;
      followerCount?: number;
    };

    if (!payload.sessionToken?.trim()) {
      return NextResponse.json({ message: "缺少登录会话令牌。" }, { status: 400 });
    }

    const result = await syncExtensionLoginSession(payload);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "同步扩展登录状态失败。" }, { status: 500 });
  }
}
