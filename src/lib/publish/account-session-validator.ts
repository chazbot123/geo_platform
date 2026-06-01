import { validatePlatformSessionWindow, type ElectronPlatformSessionValidationResult } from "@/lib/publish/electron-login-client";
import type { PlatformAccountRecord, PlatformAccountLoginStatus, PlatformAccountStatus } from "@/lib/types";

export interface AccountSessionAuditResult {
  canAutoValidate: boolean;
  nextLoginStatus?: PlatformAccountLoginStatus;
  nextStatus?: PlatformAccountStatus;
  lastError?: string;
  summary: string;
  validationStatus?: ElectronPlatformSessionValidationResult["status"];
}

export function buildDesktopSessionFailureReason(status: string, reason?: string) {
  if (reason?.trim()) {
    return reason.trim();
  }

  switch (status) {
    case "expired":
      return "检测到今日头条登录会话已失效，请重新登录。";
    case "missing_session":
      return "未检测到有效的今日头条登录会话，请重新登录。";
    case "unknown":
      return "暂时无法确认当前今日头条登录状态，请重新登录后再发布。";
    default:
      return "桌面登录未完成。";
  }
}

export async function auditPlatformAccountSession(account: PlatformAccountRecord): Promise<AccountSessionAuditResult> {
  const result = await validatePlatformSessionWindow({
    platform: account.platform,
    publishUrl: account.loginUrl,
    sessionPartition: account.sessionPartition,
  });

  if (result.status === "unsupported") {
    return {
      canAutoValidate: false,
      summary: result.reason?.trim() || "当前未连接桌面桥，暂时无法复核账号真实登录态。",
      validationStatus: result.status,
    };
  }

  if (result.status === "authenticated") {
    return {
      canAutoValidate: true,
      nextLoginStatus: "authenticated",
      nextStatus: "valid",
      lastError: undefined,
      summary: "真实平台会话可用，可继续用于自动发布。",
      validationStatus: result.status,
    };
  }

  const lastError = buildDesktopSessionFailureReason(result.status, result.reason);
  return {
    canAutoValidate: true,
    nextLoginStatus: "failed",
    nextStatus: "invalid",
    lastError,
    summary: lastError,
    validationStatus: result.status,
  };
}

export function describeAccountPublishability(account: PlatformAccountRecord, bridgeReady: boolean) {
  if (!bridgeReady && account.loginStatus === "authenticated") {
    return "当前未连接桌面桥，暂时无法复核真实会话。";
  }
  if (account.loginStatus === "authenticated" && account.status === "valid") {
    return "真实平台会话可用，可用于自动发布。";
  }
  if (account.loginStatus === "failed" || account.status === "invalid") {
    return account.lastError?.trim() || "真实平台会话已失效，请重新登录。";
  }
  return "当前不可用于自动发布。";
}
