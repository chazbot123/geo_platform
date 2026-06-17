import { validatePlatformSessionWindow, type ElectronPlatformSessionValidationResult } from "@/lib/publish/electron-login-client";
import type { PlatformAccountRecord, PlatformAccountLoginStatus, PlatformAccountStatus } from "@/lib/types";

export const PLATFORM_SESSION_AUDIT_INTERVAL_MS = 60 * 60 * 1000;

export interface AccountSessionAuditResult {
  canAutoValidate: boolean;
  nextLoginStatus?: PlatformAccountLoginStatus;
  nextStatus?: PlatformAccountStatus;
  lastError?: string;
  summary: string;
  validationStatus?: ElectronPlatformSessionValidationResult["status"];
  patch?: Partial<PlatformAccountRecord>;
}

export function buildDesktopSessionFailureReason(status: string, reason?: string) {
  if (reason?.trim()) {
    return reason.trim();
  }

  switch (status) {
    case "expired":
      return "登录已失效，请重新登录";
    case "missing_session":
      return "未检测到登录信息，请重新登录";
    case "unknown":
      return "暂时无法确认当前平台登录状态，请重新登录后再发布。";
    default:
      return "桌面登录未完成。";
  }
}

function hasVideohaoExtensionLoginEvidence(authPayload: string) {
  try {
    const parsed = JSON.parse(authPayload) as {
      cookies?: Array<{ name?: unknown; value?: unknown }>;
      localStorage?: Record<string, unknown>;
      sessionStorage?: Record<string, unknown>;
    };
    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
    if (cookies.some((cookie) => String(cookie?.name || "").trim() && String(cookie?.value || "").trim())) {
      return true;
    }
    const storage = {
      ...(parsed.localStorage || {}),
      ...(parsed.sessionStorage || {}),
    };
    return ["finder_uin", "finder_username", "finderUserName", "finderUsername"].some((key) =>
      String(storage[key] || "").trim(),
    );
  } catch {
    return false;
  }
}

function validateVideohaoExtensionCookieAccount(account: PlatformAccountRecord): AccountSessionAuditResult | null {
  const source = String(account.source || "").trim();
  if (account.platform === "videohao" && account.authType === "cookie" && source === "browser_extension") {
    const validatedAt = new Date().toISOString();
    if (typeof account.authPayload === "string" && hasVideohaoExtensionLoginEvidence(account.authPayload.trim())) {
      return {
        canAutoValidate: true,
        nextLoginStatus: "authenticated",
        nextStatus: "valid",
        lastError: undefined,
        summary: "视频号外置浏览器登录态可用。",
        validationStatus: "authenticated",
        patch: {
          loginStatus: "authenticated",
          status: "valid",
          riskState: "active",
          riskReason: undefined,
          lastError: undefined,
          lastValidatedAt: validatedAt,
          authPayload: account.authPayload.trim(),
          authPayloadUpdatedAt: account.authPayloadUpdatedAt ?? validatedAt,
        },
      };
    }
    const lastError = "视频号外置浏览器登录态为空，请重新扫码登录。";
    return {
      canAutoValidate: true,
      nextLoginStatus: "failed",
      nextStatus: "invalid",
      lastError,
      summary: lastError,
      validationStatus: "missing_session",
      patch: {
        loginStatus: "failed",
        status: "invalid",
        riskState: "needs_login",
        riskReason: lastError,
        lastError,
        lastValidatedAt: validatedAt,
      },
    };
  }
  return null;
}

export async function auditPlatformAccountSession(account: PlatformAccountRecord): Promise<AccountSessionAuditResult> {
  const videohaoCookieValidation = validateVideohaoExtensionCookieAccount(account);
  if (videohaoCookieValidation) {
    return videohaoCookieValidation;
  }

  const result = await validatePlatformSessionWindow({
    platform: account.platform,
    publishUrl: account.loginUrl,
    sessionPartition: account.sessionPartition,
    authPayload: account.authPayload,
  });

  if (result.status === "unsupported") {
    return {
      canAutoValidate: false,
      summary: result.reason?.trim() || "当前未连接桌面桥，暂时无法复核账号真实登录态。",
      validationStatus: result.status,
    };
  }

  if (result.status === "authenticated") {
    const validatedAt = result.validatedAt ?? new Date().toISOString();
    const patch: Partial<PlatformAccountRecord> = {
      loginStatus: "authenticated",
      status: "valid",
      riskState: "active",
      riskReason: undefined,
      lastError: undefined,
      lastValidatedAt: validatedAt,
    };
    if (typeof result.authPayload === "string" && result.authPayload.trim()) {
      patch.authPayload = result.authPayload.trim();
      patch.authPayloadUpdatedAt = result.authPayloadUpdatedAt ?? validatedAt;
    }
    return {
      canAutoValidate: true,
      nextLoginStatus: "authenticated",
      nextStatus: "valid",
      lastError: undefined,
      summary: "真实平台会话可用。",
      validationStatus: result.status,
      patch,
    };
  }

  const lastError = buildDesktopSessionFailureReason(result.status, result.reason);
  const validatedAt = result.validatedAt ?? new Date().toISOString();
  return {
    canAutoValidate: true,
    nextLoginStatus: "failed",
    nextStatus: "invalid",
    lastError,
    summary: lastError,
    validationStatus: result.status,
    patch: {
      loginStatus: "failed",
      status: "invalid",
      riskState: "needs_login",
      riskReason: lastError,
      lastError,
      lastValidatedAt: validatedAt,
    },
  };
}

export function describeAccountPublishability(account: PlatformAccountRecord, bridgeReady: boolean) {
  if (!bridgeReady && account.loginStatus === "authenticated") {
    return "当前未连接桌面桥，暂时无法复核真实会话。";
  }
  if (account.loginStatus === "authenticated" && account.status === "valid") {
    return "真实平台会话可用。";
  }
  if (account.loginStatus === "failed" || account.status === "invalid") {
    return account.lastError?.trim() || "真实平台会话已失效，请重新登录。";
  }
  return "当前平台会话不可用，请重新登录。";
}
