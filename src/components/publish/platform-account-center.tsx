"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, FileImage, LoaderCircle, LogIn, RefreshCcw, Trash2, UserCircle2, XCircle } from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { openPlatformLoginWindow, validatePlatformSessionWindow } from "@/lib/publish/electron-login-client";
import { waitForExternalLoginSync } from "@/lib/publish/external-login-sync";
import { toDisplayImageItems } from "@/lib/publish/image-display";
import { detectDesktopBridge, hasElectronDesktopBridge, type DesktopBridgeAvailability } from "@/lib/publish/local-bridge-client";
import { formatAccountDisplayLabel, resolveAccountIdentifier } from "@/lib/publish/account-label";
import {
  auditPlatformAccountSession,
  buildDesktopSessionFailureReason,
  describeAccountPublishability,
  PLATFORM_SESSION_AUDIT_INTERVAL_MS,
} from "@/lib/publish/account-session-validator";
import { requireLicensedAction } from "@/lib/license/guard";
import { publishPlatformDescriptors } from "@/lib/publish/platforms";
import type { AccountPublishedJobsGroup, PlatformAccountRecord, PublishingJobRecord, SocialPlatform } from "@/lib/types";

const TOUTIAO_PLATFORM = "toutiao";
const TOUTIAO_LABEL = "今日头条";
const DEBUG_SERVER_URL = "http://127.0.0.1:7778/event";
const DEBUG_SESSION_ID = "account-info-fetch";
const ACCOUNT_DELETE_TIMEOUT_MS = 15000;

function shouldEmitDebugEvents() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("geo-debug-events") === "1";
  } catch {
    return false;
  }
}

function canRenderInlineAvatar(url?: string) {
  const normalized = String(url || "").trim();
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized, typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1");
    return !/(\.|^)sinaimg\.cn$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function emitDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown>) {
  // #region debug-point shared:emit
  if (!shouldEmitDebugEvents()) return;
  fetch(DEBUG_SERVER_URL, {
    method: "POST",
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function routeAvailabilityBadge(availability: import("@/lib/publish/platforms").PlatformRouteAvailability) {
  const config = {
    official_api_ready: { label: "官方 API 可用", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" },
    official_api_unavailable: { label: "官方 API 不可用", className: "bg-orange-500/15 text-orange-300 border border-orange-500/20" },
    electron_ready: { label: "Electron 自动化", className: "bg-sky-500/15 text-sky-300 border border-sky-500/20" },
    manual_required: { label: "脚本待补齐", className: "bg-slate-500/15 text-slate-300 border border-slate-500/20" },
  };
  const c = config[availability];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.className}`}>{c.label}</span>
  );
}

function platformLabel(platform: string) {
  return publishPlatformDescriptors.find((item) => item.key === platform)?.label ?? platform;
}

function platformDescriptor(platform: string) {
  return publishPlatformDescriptors.find((item) => item.key === platform);
}

function formatAuditTime(value?: string) {
  if (!value) {
    return "--";
  }
  return new Date(value).toLocaleString();
}

function getRecentValidationTime(account: PlatformAccountRecord) {
  return account.lastValidatedAt ?? account.lastLoginCompletedAt;
}

function statusText(account: PlatformAccountRecord) {
  if (account.loginStatus === "authenticated") return "已登录";
  if (account.loginStatus === "pending") return "待确认";
  if (account.loginStatus === "failed") return "失败";
  if (account.loginStatus === "cancelled") return "已取消";
  return "未登录";
}

function accountActionLabel(account: PlatformAccountRecord) {
  if (account.loginStatus === "authenticated" && account.status === "valid") {
    return "校验";
  }
  if (account.loginStatus === "failed" || account.status === "invalid") {
    return "重新登录";
  }
  return "登录";
}

function statusDescription(account: PlatformAccountRecord) {
  if (account.loginStatus === "authenticated") {
    return "已保存并通过桌面会话校验，但发布前仍会再做一次真实平台登录态检查。";
  }

  if (account.loginStatus === "pending") {
    return "账号记录已创建，但桌面登录还没有完成最终校验。";
  }

  if (account.loginStatus === "failed") {
    return account.lastError?.trim() || "最近一次桌面登录或会话校验失败。";
  }

  return "当前账号尚未完成可用于自动发布的桌面登录验证。";
}

function accountPublishabilityText(account: PlatformAccountRecord, isBridgeReady: boolean) {
  const descriptor = platformDescriptor(account.platform);
  if (descriptor?.automationStatus === "ready") {
    return describeAccountPublishability(account, isBridgeReady);
  }
  if (descriptor?.automationStatus === "manual_only") {
    return account.loginStatus === "authenticated"
      ? "账号会话已校验；当前平台登录可用，发布脚本需要补齐后自动执行。"
      : "当前平台支持桌面登录；完成登录后用于后续脚本自动发布。";
  }
  return "当前平台尚未开放账号登录。";
}

function buildLoginSuccessPatch(loginResult: Awaited<ReturnType<typeof openPlatformLoginWindow>>) {
  const patch: Record<string, unknown> = {
    loginStatus: "authenticated" as const,
    status: "valid" as const,
    lastError: undefined,
    accountName: loginResult.profile?.accountName,
    displayName: loginResult.profile?.displayName,
    platformAccountId: loginResult.profile?.platformAccountId,
    avatarUrl: loginResult.profile?.avatarUrl,
  };
  if (typeof loginResult.authPayload === "string" && loginResult.authPayload.trim()) {
    patch.authPayload = loginResult.authPayload.trim();
    patch.authPayloadUpdatedAt = loginResult.authPayloadUpdatedAt ?? loginResult.validatedAt;
  }
  if (loginResult.validatedAt) {
    patch.lastValidatedAt = loginResult.validatedAt;
  }
  return patch;
}

function buildValidatedSessionPatch(result: Awaited<ReturnType<typeof validatePlatformSessionWindow>>) {
  const patch: Record<string, unknown> = {
    loginStatus: "authenticated" as const,
    status: "valid" as const,
    lastError: undefined,
  };
  if (typeof result.authPayload === "string" && result.authPayload.trim()) {
    patch.authPayload = result.authPayload.trim();
    patch.authPayloadUpdatedAt = result.authPayloadUpdatedAt ?? result.validatedAt;
  }
  if (result.validatedAt) {
    patch.lastValidatedAt = result.validatedAt;
  }
  return patch;
}

function buildPublishedJobsMap(groups: AccountPublishedJobsGroup[]) {
  return Object.fromEntries(groups.map((group) => [group.accountId, group.jobs]));
}

function buildJobBodyPreview(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无正文预览";
  }
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

function AccountAvatar({ account }: { account: PlatformAccountRecord }) {
  const label = formatAccountDisplayLabel(account, platformLabel(account.platform));
  if (canRenderInlineAvatar(account.avatarUrl)) {
    return (
      <img
        src={account.avatarUrl}
        alt={`${label} 头像`}
        className="h-10 w-10 shrink-0 rounded-full border border-stroke bg-surface object-cover"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    );
  }

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stroke bg-surface text-muted">
      <UserCircle2 className="h-5 w-5" />
    </span>
  );
}

export function PlatformAccountCenter({
  initialAccounts,
  initialPublishedByAccount,
}: {
  initialAccounts: PlatformAccountRecord[];
  initialPublishedByAccount: AccountPublishedJobsGroup[];
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [loadingKey, setLoadingKey] = useState("");
  const [message, setMessage] = useState("");
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialAccounts.map((item) => [item.id, item.remark ?? ""])),
  );
  const [manualAccountNames, setManualAccountNames] = useState<Record<string, string>>({});
  const [publishedJobsByAccount, setPublishedJobsByAccount] = useState<Record<string, PublishingJobRecord[]>>(
    buildPublishedJobsMap(initialPublishedByAccount),
  );
  const [sessionAuditSummary, setSessionAuditSummary] = useState("");
  const [hasAutoAudited, setHasAutoAudited] = useState(false);
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [bridgeAvailability, setBridgeAvailability] = useState<DesktopBridgeAvailability>(() => ({
    mode: hasElectronDesktopBridge() ? "electron_bridge" : "bridge_unreachable",
    label: hasElectronDesktopBridge() ? "已连接 Electron 注入桥" : "未检测到可用桌面桥",
  }));
  const isBridgeReady = bridgeAvailability.mode === "electron_bridge" || bridgeAvailability.mode === "local_bridge";
  const accountsRef = useRef(initialAccounts);
  const sessionAuditRunningRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void detectDesktopBridge().then((result) => {
      if (alive) {
        setBridgeAvailability(result);
        setBridgeChecked(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  async function refreshAccounts() {
    const response = await fetch("/api/publish/accounts");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "加载账号失败");
    }
    const nextAccounts = payload.items as PlatformAccountRecord[];
    setAccounts(nextAccounts);
    setRemarkDrafts(Object.fromEntries(nextAccounts.map((item) => [item.id, item.remark ?? ""])));
    setPublishedJobsByAccount(buildPublishedJobsMap(payload.publishedByAccount as AccountPublishedJobsGroup[]));
  }

  const authenticatedAccounts = useMemo(
    () =>
      accounts.filter((item) => {
        const descriptor = platformDescriptor(item.platform);
        return descriptor?.loginSupported && item.loginStatus === "authenticated";
      }),
    [accounts],
  );
  const accountsByPlatform = useMemo(
    () =>
      Object.fromEntries(
        publishPlatformDescriptors.map((descriptor) => [
          descriptor.key,
          accounts.filter((account) => account.platform === descriptor.key),
        ]),
      ) as Record<SocialPlatform, PlatformAccountRecord[]>,
    [accounts],
  );

  async function sendAccountPatch(accountId: string, patch: Record<string, unknown>) {
    // #region debug-point B:send-patch
    emitDebug("B", "platform-account-center.tsx:sendAccountPatch:before", "前端发送账号 patch", {
      accountId,
      loginStatus: patch.loginStatus ?? null,
      status: patch.status ?? null,
      accountName: typeof patch.accountName === "string" ? patch.accountName : null,
      displayName: typeof patch.displayName === "string" ? patch.displayName : null,
      platformAccountId: typeof patch.platformAccountId === "string" ? patch.platformAccountId : null,
      avatarUrl: typeof patch.avatarUrl === "string" ? patch.avatarUrl : null,
      lastError: typeof patch.lastError === "string" ? patch.lastError : null,
    });
    // #endregion
    const response = await fetch(`/api/publish/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "更新账号失败");
    }
    // #region debug-point C:patch-response
    emitDebug("C", "platform-account-center.tsx:sendAccountPatch:after", "前端收到账号 patch 返回", {
      accountId: payload.account?.id ?? accountId,
      accountName: payload.account?.accountName ?? null,
      displayName: payload.account?.displayName ?? null,
      platformAccountId: payload.account?.platformAccountId ?? null,
      avatarUrl: payload.account?.avatarUrl ?? null,
      loginStatus: payload.account?.loginStatus ?? null,
      status: payload.account?.status ?? null,
    });
    // #endregion
    return payload.account as PlatformAccountRecord;
  }

  async function applyDesktopLoginValidation(
    accountId: string,
    platform: SocialPlatform,
    result: Awaited<ReturnType<typeof validatePlatformSessionWindow>>,
  ) {
    if (result.status === "unsupported") {
      throw new Error(result.reason ?? "当前桌面壳未暴露会话检测桥，无法确认登录结果。");
    }

    if (result.status === "authenticated") {
      await sendAccountPatch(accountId, buildValidatedSessionPatch(result));
      await refreshAccounts();
      setMessage(`${platformLabel(platform)}登录状态已通过桌面会话校验并保存。`);
      return;
    }

    const lastError = buildDesktopSessionFailureReason(result.status, result.reason);
    await sendAccountPatch(accountId, {
      loginStatus: "failed",
      status: "invalid",
      lastError,
    });
    await refreshAccounts();
    setMessage(`${platformLabel(platform)}登录未完成：${lastError}`);
  }

  async function startLogin(platform: SocialPlatform = TOUTIAO_PLATFORM, accountId?: string) {
    const licenseGuard = await requireLicensedAction("manage_publish_account");
    if (!licenseGuard.allowed) {
      setMessage(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    if (!isBridgeReady) {
      setMessage(bridgeAvailability.reason ?? "未检测到可用桌面桥，请先启动 GEO 桌面版。");
      return;
    }

    setLoadingKey(accountId ?? platform);
    setMessage("");
    try {
      const response = await fetch("/api/publish/accounts/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, accountId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "发起桌面登录失败");
      }

      const targetAccountId = payload.account?.id ?? accountId;
      const loginRequest = payload.loginRequest as
        | {
            accountId?: string;
            platform: string;
            title: string;
            loginUrl?: string;
            sessionPartition?: string;
            loginSessionToken?: string;
          }
        | undefined;

      if (!targetAccountId || !loginRequest) {
        throw new Error("桌面登录返回数据不完整，无法继续。");
      }

      const loginResult = await openPlatformLoginWindow(loginRequest);
      // #region debug-point A:login-result
      emitDebug("A", "platform-account-center.tsx:startLogin:loginResult", "桌面登录返回结果", {
        accountId: targetAccountId,
        platform,
        status: loginResult.status,
        reason: loginResult.reason ?? null,
        accountName: loginResult.profile?.accountName ?? null,
        displayName: loginResult.profile?.displayName ?? null,
        platformAccountId: loginResult.profile?.platformAccountId ?? null,
        avatarUrl: loginResult.profile?.avatarUrl ?? null,
        sourceUrl: loginResult.profile?.sourceUrl ?? null,
      });
      // #endregion
      if (loginResult.status === "unsupported") {
        throw new Error("当前桌面壳未暴露登录桥，无法打开平台登录窗。");
      }
      if (loginResult.status === "opened") {
        setMessage(loginResult.reason ?? `${platformLabel(platform)}已在外部浏览器打开，正在等待自动同步账号信息。`);
        const syncedAccount = await waitForExternalLoginSync({
          accountId: targetAccountId,
          sessionToken: loginRequest.loginSessionToken,
        });
        if (syncedAccount) {
          await refreshAccounts();
          setMessage(`${platformLabel(platform)}登录完成，已自动同步账号信息。`);
          window.dispatchEvent(new Event("geo-workflow-status-refresh"));
          return;
        }
        setMessage(`${platformLabel(platform)}已在外部浏览器完成登录，但暂未同步到系统。请回到当前页面刷新账号状态。`);
        return;
      }

      if (loginResult.status === "authenticated") {
        await sendAccountPatch(targetAccountId, buildLoginSuccessPatch(loginResult));
        await refreshAccounts();
        setMessage(`${platformLabel(platform)}登录完成，已自动同步账号信息。`);
      } else {
        const validationResult = await validatePlatformSessionWindow({
          platform,
          publishUrl: loginRequest.loginUrl,
          sessionPartition: loginRequest.sessionPartition,
        });
        await applyDesktopLoginValidation(targetAccountId, platform, validationResult);
      }
      window.dispatchEvent(new Event("geo-workflow-status-refresh"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发起登录失败");
    } finally {
      setLoadingKey("");
    }
  }

  async function verifyAccountSession(account: PlatformAccountRecord) {
    if (!isBridgeReady) {
      setMessage(bridgeAvailability.reason ?? "未检测到可用桌面桥，请先启动 GEO 桌面版。");
      return;
    }
    setLoadingKey(account.id);
    setMessage("");
    try {
      const audit = await auditPlatformAccountSession(account);
      if (!audit.canAutoValidate || !audit.patch) {
        throw new Error(audit.summary || "当前无法校验账号会话。");
      }
      await sendAccountPatch(account.id, audit.patch);
      await refreshAccounts();
      window.dispatchEvent(new Event("geo-workflow-status-refresh"));
      if (audit.validationStatus === "authenticated") {
        setMessage(`${platformLabel(account.platform)}账号会话校验通过。`);
        return;
      }
      setMessage(`${platformLabel(account.platform)}账号已失效，请重新登录。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账号会话校验失败");
    } finally {
      setLoadingKey("");
    }
  }

  async function createManualAccount(platform: SocialPlatform) {
    const licenseGuard = await requireLicensedAction("manage_publish_account");
    if (!licenseGuard.allowed) {
      setMessage(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    const descriptor = platformDescriptor(platform);
    const accountName = (manualAccountNames[platform] ?? "").trim();
    if (!descriptor) {
      setMessage("不支持的平台。");
      return;
    }
    if (!accountName) {
      setMessage(`请先填写${descriptor.label}账号名称。`);
      return;
    }

    setLoadingKey(`create-${platform}`);
    setMessage("");
    try {
      const response = await fetch("/api/publish/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          accountName,
          displayName: accountName,
          remark: descriptor.automationStatus === "ready" ? "自动发布账号" : "脚本发布账号",
          loginUrl: descriptor.publishEntryUrl,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "创建账号失败");
      }
      setManualAccountNames((current) => ({ ...current, [platform]: "" }));
      await refreshAccounts();
      setMessage(`${descriptor.label}账号已创建。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建账号失败");
    } finally {
      setLoadingKey("");
    }
  }

  async function patchAccount(accountId: string, patch: Record<string, unknown>, successMessage: string) {
    const licenseGuard = await requireLicensedAction("manage_publish_account");
    if (!licenseGuard.allowed) {
      setMessage(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setLoadingKey(accountId);
    setMessage("");
    try {
      await sendAccountPatch(accountId, patch);
      await refreshAccounts();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新账号失败");
    } finally {
      setLoadingKey("");
    }
  }

  async function removeAccount(accountId: string) {
    const licenseGuard = await requireLicensedAction("manage_publish_account");
    if (!licenseGuard.allowed) {
      setMessage(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setLoadingKey(accountId);
    setMessage("");
    try {
      const response = await fetchWithTimeout(
        `/api/publish/accounts/${accountId}`,
        { method: "DELETE" },
        ACCOUNT_DELETE_TIMEOUT_MS,
        "删除账号超时，请稍后重试。若该账号绑定了较多任务或草稿，请刷新后确认是否已删除。",
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "删除账号失败");
      await refreshAccounts();
      setMessage("账号已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除账号失败");
    } finally {
      setLoadingKey("");
    }
  }

  async function cleanHistoricalDuplicates() {
    const licenseGuard = await requireLicensedAction("manage_publish_account");
    if (!licenseGuard.allowed) {
      setMessage(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setLoadingKey("deduplicate-history");
    setMessage("");
    try {
      const response = await fetch("/api/publish/accounts/deduplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "清理重复账号失败");
      }

      await refreshAccounts();
      const mergedGroups = Number(payload.mergedGroups ?? 0);
      const removedAccounts = Number(payload.removedAccounts ?? 0);
      setMessage(
        mergedGroups > 0
          ? `已清理 ${mergedGroups} 组重复账号，移除 ${removedAccounts} 条重复记录。`
          : "未发现需要清理的重复账号。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理重复账号失败");
    } finally {
      setLoadingKey("");
    }
  }

  async function runAutoSessionAudit() {
    if (sessionAuditRunningRef.current) {
      return;
    }
    if (!isBridgeReady) {
      setSessionAuditSummary("当前未连接桌面桥，暂时无法自动复核账号真实登录态。");
      setHasAutoAudited(true);
      return;
    }

    const currentAccounts = accountsRef.current.filter((item) => {
      const descriptor = platformDescriptor(item.platform);
      return descriptor?.loginSupported && item.loginStatus === "authenticated";
    });

    if (currentAccounts.length === 0) {
      setSessionAuditSummary("当前没有需要自动复核的已登录账号。");
      setHasAutoAudited(true);
      return;
    }

    sessionAuditRunningRef.current = true;
    let verifiedCount = 0;
    let downgradedCount = 0;
    let skippedSummary = "";

    try {
      for (const account of currentAccounts) {
        const audit = await auditPlatformAccountSession(account);
        if (!audit.canAutoValidate || !audit.patch) {
          skippedSummary = skippedSummary || audit.summary;
          continue;
        }
        await sendAccountPatch(account.id, {
          action: "session_audit",
          ...audit.patch,
        });
        if (audit.validationStatus === "authenticated") {
          verifiedCount += 1;
        } else {
          downgradedCount += 1;
        }
      }

      if (verifiedCount || downgradedCount) {
        await refreshAccounts();
      }

      if (!verifiedCount && !downgradedCount) {
        setSessionAuditSummary(skippedSummary || "当前账号暂时无法自动复核真实登录态。");
        setHasAutoAudited(true);
        return;
      }

      setSessionAuditSummary(
        downgradedCount > 0
          ? `系统已自动复核桌面登录态：${verifiedCount} 个账号仍可发布，${downgradedCount} 个账号已掉线，请重新登录。`
          : `系统已自动复核桌面登录态：${verifiedCount} 个账号可继续用于发布，会话时间已同步。`,
      );
      setHasAutoAudited(true);
    } finally {
      sessionAuditRunningRef.current = false;
    }
  }

  useEffect(() => {
    if (!bridgeChecked) {
      return;
    }
    if (hasAutoAudited) {
      return;
    }
    void runAutoSessionAudit();
  }, [bridgeChecked, hasAutoAudited, isBridgeReady, authenticatedAccounts]);

  useEffect(() => {
    if (!bridgeChecked) {
      return;
    }
    const timer = window.setInterval(() => {
      void runAutoSessionAudit();
    }, PLATFORM_SESSION_AUDIT_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [bridgeChecked, isBridgeReady]);

  useEffect(() => {
    const refreshAccountCenter = () => {
      void refreshAccounts();
    };
    window.addEventListener("geo-platform-accounts-refresh", refreshAccountCenter);
    return () => {
      window.removeEventListener("geo-platform-accounts-refresh", refreshAccountCenter);
    };
  }, []);

  return (
    <div className="grid gap-6">
      <div className="section-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h3 className="page-section-title">多平台账号入口</h3>
            <p className="page-section-desc">
              {isBridgeReady
                ? "当前页面已连接桌面桥，登录后会同步账号名、头像和平台 ID，并写入账号列表。"
                : "当前页面尚未连接本机桌面桥，请先启动 GEO 桌面版后再登录平台账号。"}
            </p>
            <div className={`mt-4 rounded-lg border p-4 text-xs leading-relaxed ${
              isBridgeReady
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : "border-warning/30 bg-warning/10 text-warning"
            }`}>
              {isBridgeReady
                ? bridgeAvailability.mode === "electron_bridge"
                  ? "当前运行在桌面壳内，操作会直接走 Electron 注入桥。"
                  : "当前运行在浏览器里，但已经连接到本机 localhost 桌面桥；登录和校验会转给后台运行的 GEO 桌面版。"
                : "当前未连接到 GEO 桌面版；浏览器本身不能保存或校验 Electron 分区里的真实登录态。"}
            </div>
            {sessionAuditSummary ? (
              <div className="mt-4 rounded-lg border border-stroke bg-white/5 p-4 text-sm leading-relaxed text-slate-300">
                {sessionAuditSummary}
              </div>
            ) : null}
          </div>

          <div className="w-full lg:w-[280px]">
            <div className="rounded-lg border border-stroke bg-surface/50 p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted">当前账号</span>
              <p className="mt-2 text-2xl font-bold text-ink">{accounts.length}</p>
            </div>
            <button
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent-muted px-4 py-3 text-sm font-bold text-accent transition-colors hover:bg-accent hover:text-surface focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 disabled:hover:bg-accent-muted disabled:hover:text-accent"
              onClick={() => startLogin(TOUTIAO_PLATFORM)}
              disabled={loadingKey === TOUTIAO_PLATFORM || !isBridgeReady}
            >
              {loadingKey === TOUTIAO_PLATFORM ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {isBridgeReady ? "打开今日头条登录窗" : "请先启动桌面版"}
            </button>
            <button
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-stroke bg-white/5 px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
              onClick={cleanHistoricalDuplicates}
              disabled={loadingKey === "deduplicate-history"}
            >
              {loadingKey === "deduplicate-history" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              清理历史重复账号
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="mb-6">
          <h2 className="page-section-title">已保存的平台账号</h2>

          {message && (
            <div className="mt-4 rounded-lg border border-accent/20 bg-accent-muted/30 p-4 text-sm font-medium text-accent-soft">
              {message}
            </div>
          )}
          
          <div className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
            <p>
              {bridgeAvailability.mode === "electron_bridge"
                ? "当前运行在桌面版，账号中心会使用内置登录桥打开已接入平台的登录窗，并在窗口关闭后校验真实平台会话。"
                : isBridgeReady
                  ? "当前运行在浏览器中，但账号中心已经连接到本机 localhost 桌面桥，可以调用桌面版完成登录与校验。"
                  : "当前未检测到本机桌面桥；平台账号登录需要通过 GEO 桌面版完成。"}
            </p>
            <p className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${isBridgeReady ? "bg-emerald-400" : "bg-warning"}`}></span>
                <span className={`relative inline-flex h-2 w-2 rounded-full ${isBridgeReady ? "bg-emerald-500" : "bg-warning"}`}></span>
              </span>
              {bridgeAvailability.mode === "electron_bridge"
                ? "宿主状态：已连接 Electron 注入桥"
                : bridgeAvailability.mode === "local_bridge"
                  ? "宿主状态：已连接本机 localhost 桌面桥"
                  : "宿主状态：未检测到可用桌面桥"}
            </p>
          </div>
        </div>

        <div className="grid gap-6">
          {publishPlatformDescriptors.map((descriptor) => {
            const platformAccounts = accountsByPlatform[descriptor.key] ?? [];
            return (
              <div key={descriptor.key} className="rounded-lg border border-stroke bg-surface/50 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-display text-base font-bold text-ink">{descriptor.label}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        descriptor.automationStatus === "ready"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : descriptor.automationStatus === "manual_only"
                            ? "bg-cyan-500/15 text-cyan-300"
                            : "bg-warning/15 text-warning"
                      }`}>
                        {descriptor.automationStatus === "ready" ? "已自动化" : descriptor.automationStatus === "manual_only" ? "登录可用" : "脚本待补齐"}
                      </span>
                      {routeAvailabilityBadge(descriptor.routeAvailability)}
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{descriptor.hint}</p>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{descriptor.contentProfile}</p>
                  </div>
                  <div className="flex min-w-[260px] flex-col gap-2">
                    {descriptor.loginSupported ? (
                      <button
                        className="flex items-center justify-center gap-2 rounded-lg bg-accent-muted px-4 py-2.5 text-xs font-bold text-accent transition-colors hover:bg-accent hover:text-surface disabled:opacity-50"
                        onClick={() => startLogin(descriptor.key)}
                        disabled={loadingKey === descriptor.key || !isBridgeReady}
                      >
                        {loadingKey === descriptor.key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                        登录{descriptor.label}账号
                      </button>
                    ) : (
                      <div className="grid gap-2">
                        <input
                          className="input-base h-10 text-sm"
                          value={manualAccountNames[descriptor.key] ?? ""}
                          onChange={(event) => setManualAccountNames((current) => ({ ...current, [descriptor.key]: event.target.value }))}
                          placeholder={`${descriptor.label}账号名称`}
                        />
                        <button
                          className="rounded-lg border border-stroke bg-white/5 px-4 py-2.5 text-xs font-bold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
                          onClick={() => createManualAccount(descriptor.key)}
                          disabled={loadingKey === `create-${descriptor.key}`}
                        >
                          {loadingKey === `create-${descriptor.key}` ? "创建中..." : "创建账号记录"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 grid gap-5">
                  {platformAccounts.length ? (
                    platformAccounts.map((account) => (
              <div
                key={account.id}
                className="rounded-lg border border-stroke bg-panel/55 p-3 transition-colors hover:border-stroke-strong"
              >
                {(() => {
                  const publishedJobs = publishedJobsByAccount[account.id] ?? [];
                  const latestPublishedJob = publishedJobs[0];
                  return (
                    <>
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <AccountAvatar account={account} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="max-w-[260px] truncate text-sm font-semibold text-ink">
                          {formatAccountDisplayLabel(account, account.id)}
                        </h4>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          account.loginStatus === "authenticated" ? "bg-emerald-500/15 text-emerald-400" :
                          account.loginStatus === "failed" ? "bg-danger/10 text-danger" :
                          "bg-warning/15 text-warning"
                        }`}>
                          {statusText(account)}
                        </span>
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-muted">
                          {platformLabel(account.platform)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        <span className="break-all font-mono">平台ID：{account.platformAccountId || "--"}</span>
                        <span className="break-all font-mono">账号名：{resolveAccountIdentifier(account, "--")}</span>
                        <span>最近校验时间：{formatAuditTime(getRecentValidationTime(account))}</span>
                        <span>更新：{formatAuditTime(account.updatedAt)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-5 text-muted">
                        {accountPublishabilityText(account, isBridgeReady)}
                      </p>
                      {account.lastError ? (
                        <p className="mt-2 rounded-md border border-warning/20 bg-warning/10 px-2.5 py-1.5 text-xs leading-5 text-warning">
                          最近失败：{account.lastError}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="flex items-center gap-1.5 rounded-md border border-stroke bg-white/5 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-white/10"
                      onClick={() =>
                        account.loginStatus === "authenticated" && account.status === "valid"
                          ? verifyAccountSession(account)
                          : startLogin(account.platform, account.id)
                      }
                      disabled={platformDescriptor(account.platform)?.automationStatus !== "ready" || loadingKey === account.id || !isBridgeReady}
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      {accountActionLabel(account)}
                    </button>
                    <button
                      className="flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
                      onClick={() =>
                        patchAccount(
                          account.id,
                          { loginStatus: "authenticated", status: "valid" },
                          "账号已被强制标记为已登录，仅用于调试；系统后续自动复核若发现真实会话无效，仍会重新降级。",
                        )
                      }
                      disabled={loadingKey === account.id}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      强制标记
                    </button>
                    <button
                      className="flex items-center gap-1.5 rounded-md border border-danger/20 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/20"
                      onClick={() => patchAccount(account.id, { loginStatus: "failed", status: "invalid", lastError: "用户手动标记为失败" }, "账号已标记为失败。")}
                      disabled={loadingKey === account.id}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      标记失败
                    </button>
                    <button
                      className="flex items-center gap-1.5 rounded-md border border-stroke bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger/30 hover:text-danger"
                      onClick={() => removeAccount(account.id)}
                      disabled={loadingKey === account.id}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
                
                <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto]">
                  <input
                    className="input-base h-9 w-full bg-surface/50 text-xs"
                    value={remarkDrafts[account.id] ?? ""}
                    onChange={(event) => setRemarkDrafts((current) => ({ ...current, [account.id]: event.target.value }))}
                    placeholder="补充账号备注、用途或状态说明..."
                  />
                  <button
                    className="rounded-md border border-stroke bg-white/5 px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-white/10"
                    onClick={() => patchAccount(account.id, { remark: remarkDrafts[account.id] ?? "" }, "账号备注已保存。")}
                    disabled={loadingKey === account.id}
                  >
                    保存备注
                  </button>
                </div>
                <div className="mt-3 border-t border-stroke pt-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h5 className="text-sm font-semibold text-ink">本系统已发布内容</h5>
                      <p className="mt-0.5 text-xs text-muted">
                        {latestPublishedJob ? `最近：${latestPublishedJob.draftTitle}` : statusDescription(account)}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-muted">
                      {publishedJobs.length} 条
                    </span>
                  </div>

                  {publishedJobs.length ? (
                    <div className="grid gap-3">
                      {publishedJobs.slice(0, 5).map((job) => (
                        <div key={job.id} className="rounded-lg border border-stroke bg-surface/45 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <h6 className="text-sm font-semibold text-ink">{job.draftTitle}</h6>
                              <p className="text-xs text-muted">
                                发布时间：{new Date(job.publishedAt ?? job.updatedAt).toLocaleString()}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {job.publishUrl ? (
                                <a
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
                                  href={job.publishUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  发布链接
                                </a>
                              ) : null}
                              {job.verificationUrl ? (
                                <a
                                  className="inline-flex items-center gap-1 rounded-lg border border-stroke bg-white/5 px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-white/10"
                                  href={job.verificationUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  核验页
                                </a>
                              ) : null}
                            </div>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-300">{buildJobBodyPreview(job.draftBody)}</p>
                          {job.draftTags.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {job.draftTags.map((tag) => (
                                <span key={`${job.id}-${tag}`} className="rounded-full bg-accent-muted/20 px-2.5 py-1 text-[11px] font-medium text-accent-soft">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {toDisplayImageItems(job.draftImages, job.draftImagePaths).length ? (
                            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                              {toDisplayImageItems(job.draftImages, job.draftImagePaths).slice(0, 3).map((image, index) => (
                                <a
                                  key={`${job.id}-${image.key}`}
                                  href={image.displaySrc}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="group overflow-hidden rounded-lg border border-stroke bg-surface"
                                >
                                  <img src={image.displaySrc} alt={`${job.draftTitle} 配图 ${index + 1}`} className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-stroke px-3 py-3 text-xs text-muted">
                              <FileImage className="h-4 w-4" />
                              该次发布未携带图片
                            </div>
                          )}
                          {job.platformItemId ? (
                            <p className="mt-3 text-xs text-slate-400">
                              <span className="text-muted">平台内容 ID：</span>
                              {job.platformItemId}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-stroke px-4 py-6 text-sm text-muted">
                      当前账号暂时还没有通过 GEO 发布成功的内容。
                    </div>
                  )}
                </div>
                    </>
                  );
                })()}
              </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-stroke px-4 py-6 text-sm text-muted">
                      当前平台暂无账号记录。
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {accounts.length ? null : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stroke py-16 text-center">
              <div className="rounded-full bg-surface p-4 shadow-panel">
                <LogIn className="h-6 w-6 text-muted" />
              </div>
              <p className="mt-4 font-medium text-ink">暂无已保存账号</p>
              <p className="mt-2 max-w-md text-sm text-muted">
                请先启动 GEO 桌面版，然后在对应平台卡片里登录账号。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
