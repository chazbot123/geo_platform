import { NextResponse } from "next/server";
import { openExtensionPlatformAccountHome } from "@/lib/publish/extension-session-service";

export async function POST(request: Request) {
  try {
    const { accountId } = (await request.json()) as { accountId: string };
    if (!accountId?.trim()) {
      return NextResponse.json({ message: "缺少账号 ID。" }, { status: 400 });
    }
    return NextResponse.json(await openExtensionPlatformAccountHome(accountId));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "读取账号主页信息失败。" }, { status: 500 });
  }
}
