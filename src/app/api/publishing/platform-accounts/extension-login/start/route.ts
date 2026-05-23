import { NextResponse } from "next/server";
import { startExtensionLoginSession } from "@/lib/publish/extension-session-service";
import type { SocialPlatform } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const { platform, accountId } = (await request.json()) as {
      platform: SocialPlatform;
      accountId?: string | null;
    };

    if (!platform) {
      return NextResponse.json({ message: "缺少平台参数。" }, { status: 400 });
    }

    const { session, account } = await startExtensionLoginSession({ platform, accountId });
    return NextResponse.json(session ? { ...session, account } : null);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "发起扩展登录失败。" }, { status: 500 });
  }
}
