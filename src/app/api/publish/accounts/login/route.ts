import { NextResponse } from "next/server";
import { createPlatformAccount, getPlatformAccountSessionPartition, markPlatformAccountLoginStarted, updatePlatformAccountRecord } from "@/lib/publish/accounts-service";
import { getSocialPlatformDescriptor } from "@/lib/publish/platforms";
import { getPlatformAccount } from "@/lib/storage/data-store";
import type { SocialPlatform } from "@/lib/types";

function buildDefaultAccountName(platform: SocialPlatform) {
  return `${platform}-account-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
}

export async function POST(request: Request) {
  try {
    const { platform, accountId } = (await request.json()) as { platform: SocialPlatform; accountId?: string };
    const descriptor = getSocialPlatformDescriptor(platform);
    if (!descriptor) {
      return NextResponse.json({ error: "不支持的平台。" }, { status: 400 });
    }
    if (!descriptor.loginSupported || descriptor.automationStatus !== "ready") {
      return NextResponse.json({ error: `${descriptor.label} 当前暂未接入桌面自动登录，可先创建账号记录并按手动发布流程处理。` }, { status: 400 });
    }

    let account = accountId ? await getPlatformAccount(accountId) : null;
    if (!account) {
      account = await createPlatformAccount({
        platform,
        accountName: buildDefaultAccountName(platform),
        displayName: descriptor.label,
        loginUrl: descriptor.publishEntryUrl,
        loginStatus: "pending",
      });
    }

    if (!account.sessionPartition) {
      account = await updatePlatformAccountRecord(account.id, {
        sessionPartition: getPlatformAccountSessionPartition(account),
      });
    }

    const nextAccount = await markPlatformAccountLoginStarted(account.id);
    return NextResponse.json({
      account: nextAccount,
      loginRequest: {
        platform,
        title: `${descriptor.label} 登录`,
        loginUrl: descriptor.publishEntryUrl,
        sessionPartition: nextAccount.sessionPartition,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "发起登录失败。" }, { status: 500 });
  }
}
