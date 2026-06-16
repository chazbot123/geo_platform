import { NextResponse } from "next/server";
import {
  createPlatformAccount,
  getAllPlatformAccounts,
  updatePlatformAccountRecord,
} from "@/lib/publish/accounts-service";
import { getSocialPlatformDescriptor } from "@/lib/publish/platforms";
import type { SocialPlatform } from "@/lib/types";

function normalizeExtensionPlatform(platform: string): SocialPlatform {
  if (platform === "wechat_mp") return "videohao";
  return platform as SocialPlatform;
}

function buildAccountName(platform: SocialPlatform, accountName?: string, displayName?: string, platformAccountId?: string) {
  const candidate = String(accountName || displayName || platformAccountId || "").trim();
  return candidate || `${platform}-extension-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
}

function pickPlatformAccountId(payload: {
  platformAccountId?: unknown;
  accountId?: unknown;
  userId?: unknown;
  uid?: unknown;
  profileId?: unknown;
}) {
  return String(payload.platformAccountId || payload.accountId || payload.userId || payload.uid || payload.profileId || "").trim();
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      platform?: string;
      sessionToken?: string;
      authType?: "cookie" | "session";
      authPayload?: string;
      accountName?: string;
      displayName?: string;
      platformAccountId?: string;
      accountId?: string;
      userId?: string;
      uid?: string;
      profileId?: string;
      sourceUrl?: string;
      avatarUrl?: string;
      followerCount?: number | null;
      payloadFormat?: string;
    };

    const platform = normalizeExtensionPlatform(String(payload.platform || ""));
    const descriptor = getSocialPlatformDescriptor(platform);
    const authPayload = String(payload.authPayload || "").trim();
    if (!descriptor) {
      return NextResponse.json({ message: "暂不支持该平台账号同步。" }, { status: 400 });
    }
    if (!authPayload || authPayload.length < 20) {
      return NextResponse.json({ message: "缺少浏览器扩展同步的登录凭证，请重新同步。" }, { status: 400 });
    }

    const platformAccountId = pickPlatformAccountId(payload);
    const accountName = buildAccountName(platform, payload.accountName, payload.displayName, platformAccountId);
    const displayName = String(payload.displayName || payload.accountName || platformAccountId || accountName).trim();
    const accounts = await getAllPlatformAccounts();
    const existing = accounts.find(
      (account) =>
        account.platform === platform &&
        (account.loginSessionToken === payload.sessionToken ||
          (platformAccountId && account.platformAccountId === platformAccountId) ||
          account.accountName === accountName ||
          account.displayName === payload.displayName),
    );

    const payloadFormat = String(payload.payloadFormat || "").trim();
    const payloadShape = authPayload.startsWith("{") ? "json-object" : authPayload.startsWith("[") ? "json-array" : "cookie-header";
    const remarkParts = ["extension sync"];
    if (payload.sourceUrl) remarkParts.push(String(payload.sourceUrl));
    if (platformAccountId) remarkParts.push(`platform_id:${platformAccountId}`);
    if (payloadFormat) remarkParts.push(`format:${payloadFormat}`);
    remarkParts.push(`shape:${payloadShape}`);

    const basePatch = {
      provider: "electron" as const,
      authType: "cookie" as const,
      source: "browser_extension",
      accountName,
      displayName,
      platformAccountId: platformAccountId || undefined,
      avatarUrl: String(payload.avatarUrl || "").trim() || undefined,
      loginStatus: "authenticated" as const,
      status: "valid" as const,
      loginUrl: descriptor.publishEntryUrl,
      authPayload,
      authPayloadUpdatedAt: new Date().toISOString(),
      loginSessionToken: String(payload.sessionToken || "").trim() || undefined,
      lastLoginCompletedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      lastError: undefined,
      remark: remarkParts.join(" | "),
    };

    const account = existing
      ? await updatePlatformAccountRecord(existing.id, basePatch)
      : await updatePlatformAccountRecord(
          (
            await createPlatformAccount({
              platform,
              accountName,
              displayName,
              loginUrl: descriptor.publishEntryUrl,
              loginStatus: "authenticated",
              status: "valid",
            })
          ).id,
          basePatch,
        );

    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "浏览器扩展登录同步失败，请稍后重试。" },
      { status: 500 },
    );
  }
}
