import { NextResponse } from "next/server";
import { detectPublishablePlatformAccounts } from "@/lib/publish/accounts-service";
import { getPlatformsBySearchProvider } from "@/lib/publish/provider-platform-matrix";
import type { SearchProvider, SocialPlatform } from "@/lib/types";

function normalizePlatforms(input: unknown, searchProvider: SearchProvider | undefined) {
  if (Array.isArray(input)) {
    return input.filter((item): item is SocialPlatform => typeof item === "string");
  }
  return getPlatformsBySearchProvider(searchProvider);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      searchProvider?: SearchProvider;
      platforms?: SocialPlatform[];
      forceRefresh?: boolean;
    };
    const platforms = normalizePlatforms(body.platforms, body.searchProvider);
    const result = await detectPublishablePlatformAccounts(platforms, { forceRefresh: body.forceRefresh });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "账号检测失败。" }, { status: 500 });
  }
}
