import { NextResponse } from "next/server";
import { getExtensionPublishAuth } from "@/lib/publish/extension-session-service";

export async function POST(request: Request) {
  try {
    const { sessionToken } = (await request.json()) as { sessionToken: string };
    if (!sessionToken?.trim()) {
      return NextResponse.json({ message: "缺少发布会话令牌。" }, { status: 400 });
    }
    return NextResponse.json(await getExtensionPublishAuth(sessionToken));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "获取发布账号登录态失败。" }, { status: 500 });
  }
}
