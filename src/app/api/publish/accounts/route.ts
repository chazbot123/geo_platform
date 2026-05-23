import { NextResponse } from "next/server";
import { createPlatformAccount, getAllPlatformAccounts } from "@/lib/publish/accounts-service";
import type { SocialPlatform } from "@/lib/types";

export async function GET() {
  const items = await getAllPlatformAccounts();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  try {
    const { platform, accountName, displayName, remark, loginUrl } = (await request.json()) as {
      platform: SocialPlatform;
      accountName: string;
      displayName?: string;
      remark?: string;
      loginUrl?: string;
    };

    if (!platform || !accountName?.trim()) {
      return NextResponse.json({ error: "缺少平台或账号名称。" }, { status: 400 });
    }

    const account = await createPlatformAccount({
      platform,
      accountName,
      displayName,
      remark,
      loginUrl,
    });
    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建账号失败。" }, { status: 500 });
  }
}
