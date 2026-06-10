import { NextResponse } from "next/server";
import { markPlatformAccountLoginResult, removePlatformAccount, updatePlatformAccountRecord } from "@/lib/publish/accounts-service";
import { resumePlatformAccount } from "@/lib/publish/publish-queue-service";
import type { PlatformAccountLoginStatus, PlatformAccountStatus } from "@/lib/types";

export async function PATCH(request: Request, context: { params: { accountId: string } }) {
  try {
    const { action, remark, accountName, displayName, platformAccountId, avatarUrl, loginStatus, status, lastError } = (await request.json()) as {
      action?: "manual_resume";
      remark?: string;
      accountName?: string;
      displayName?: string;
      platformAccountId?: string;
      avatarUrl?: string;
      loginStatus?: PlatformAccountLoginStatus;
      status?: PlatformAccountStatus;
      lastError?: string;
    };
    if (action === "manual_resume") {
      return NextResponse.json({ account: await resumePlatformAccount(context.params.accountId) });
    }
    const account = loginStatus
      ? await markPlatformAccountLoginResult(context.params.accountId, {
          loginStatus,
          status,
          lastError,
          accountName,
          displayName,
          platformAccountId,
          avatarUrl,
        })
      : await updatePlatformAccountRecord(context.params.accountId, {
          remark,
          accountName,
          displayName,
          platformAccountId,
          avatarUrl,
          status,
          lastError,
        });
    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新账号失败。" }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: { params: { accountId: string } }) {
  try {
    await removePlatformAccount(context.params.accountId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除账号失败。" }, { status: 500 });
  }
}
