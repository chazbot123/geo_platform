import { NextResponse } from "next/server";
import { markPlatformAccountLoginResult, removePlatformAccount, updatePlatformAccountRecord } from "@/lib/publish/accounts-service";
import type { PlatformAccountLoginStatus, PlatformAccountStatus } from "@/lib/types";

export async function PATCH(request: Request, context: { params: { accountId: string } }) {
  try {
    const { remark, displayName, loginStatus, status, lastError } = (await request.json()) as {
      remark?: string;
      displayName?: string;
      loginStatus?: PlatformAccountLoginStatus;
      status?: PlatformAccountStatus;
      lastError?: string;
    };
    const account = loginStatus
      ? await markPlatformAccountLoginResult(context.params.accountId, {
          loginStatus,
          status,
          lastError,
        })
      : await updatePlatformAccountRecord(context.params.accountId, {
          remark,
          displayName,
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
