import { NextResponse } from "next/server";
import {
  markPlatformAccountLoginResult,
  markPlatformAccountSessionAuditResult,
  removePlatformAccount,
  updatePlatformAccountRecord,
} from "@/lib/publish/accounts-service";
import { resumePlatformAccount } from "@/lib/publish/publish-queue-service";
import type { PlatformAccountLoginStatus, PlatformAccountStatus } from "@/lib/types";

export async function PATCH(request: Request, context: { params: { accountId: string } }) {
  try {
    const {
      action,
      remark,
      accountName,
      displayName,
      platformAccountId,
      avatarUrl,
      loginStatus,
      status,
      lastError,
      authPayload,
      authPayloadUpdatedAt,
      lastValidatedAt,
    } = (await request.json()) as {
      action?: "manual_resume" | "session_audit";
      remark?: string;
      accountName?: string;
      displayName?: string;
      platformAccountId?: string;
      avatarUrl?: string;
      loginStatus?: PlatformAccountLoginStatus;
      status?: PlatformAccountStatus;
      lastError?: string;
      authPayload?: string;
      authPayloadUpdatedAt?: string;
      lastValidatedAt?: string;
    };
    if (action === "manual_resume") {
      return NextResponse.json({ account: await resumePlatformAccount(context.params.accountId) });
    }
    if (action === "session_audit") {
      return NextResponse.json({
        account: await markPlatformAccountSessionAuditResult(context.params.accountId, {
          loginStatus: loginStatus ?? "failed",
          status,
          lastError,
          authPayload,
          authPayloadUpdatedAt,
          lastValidatedAt,
        }),
      });
    }
    const allowAuthPayloadPatch = request.headers.get("x-geo-internal-session-refresh") === "1";
    const account = loginStatus
      ? await markPlatformAccountLoginResult(context.params.accountId, {
          loginStatus,
          status,
          lastError,
          accountName,
          displayName,
          platformAccountId,
          avatarUrl,
          lastValidatedAt,
          authPayload: allowAuthPayloadPatch ? authPayload : undefined,
          authPayloadUpdatedAt: allowAuthPayloadPatch ? authPayloadUpdatedAt : undefined,
        })
      : await updatePlatformAccountRecord(context.params.accountId, {
          remark,
          accountName,
          displayName,
          platformAccountId,
          avatarUrl,
          status,
          lastError,
          authPayload: allowAuthPayloadPatch ? authPayload : undefined,
          authPayloadUpdatedAt: allowAuthPayloadPatch ? authPayloadUpdatedAt : undefined,
          lastValidatedAt,
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
