import { NextResponse } from "next/server";
import { deduplicateHistoricalPlatformAccounts } from "@/lib/publish/accounts-service";
import type { SocialPlatform } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const { platform } = (await request.json().catch(() => ({}))) as { platform?: SocialPlatform };
    const result = await deduplicateHistoricalPlatformAccounts(platform);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "清理重复账号失败。" },
      { status: 500 },
    );
  }
}
