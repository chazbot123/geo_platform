import { NextResponse } from "next/server";
import { getAllPlatformAccounts } from "@/lib/publish/accounts-service";
import type { SocialPlatform } from "@/lib/types";

const LOGIN_SESSION_TTL_MS = 30 * 60 * 1000;

function normalizeExtensionPlatform(platform: string): SocialPlatform {
  if (platform === "wechat_mp") return "videohao";
  return platform as SocialPlatform;
}

function getLoginStartedAt(value?: string) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as { platform?: string };
    const platform = normalizeExtensionPlatform(String(payload.platform || "").trim());
    if (!platform) {
      return NextResponse.json({ message: "Missing platform." }, { status: 400 });
    }

    const nowMs = Date.now();
    const candidate = (await getAllPlatformAccounts())
      .filter(
        (account) =>
          account.platform === platform &&
          account.loginStatus === "pending" &&
          Boolean(String(account.loginSessionToken || "").trim()) &&
          nowMs - getLoginStartedAt(account.lastLoginStartedAt) <= LOGIN_SESSION_TTL_MS,
      )
      .sort((left, right) => getLoginStartedAt(right.lastLoginStartedAt) - getLoginStartedAt(left.lastLoginStartedAt))[0];

    if (!candidate) {
      return NextResponse.json({ sessionToken: "" });
    }

    return NextResponse.json({
      accountId: candidate.id,
      platform: candidate.platform,
      sessionToken: candidate.loginSessionToken,
      loginUrl: candidate.loginUrl || "",
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Resolve extension login session failed." },
      { status: 500 },
    );
  }
}
