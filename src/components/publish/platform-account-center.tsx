"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, LogIn, RefreshCcw, Trash2, XCircle } from "lucide-react";
import { openPlatformLoginWindow, validatePlatformSessionWindow } from "@/lib/publish/electron-login-client";
import {
  listenPlatformExtensionEvents,
  openPlatformAccountHomeInExtension,
  pingPlatformExtension,
  startPlatformExtensionLoginSession,
} from "@/lib/publish/platform-extension-bridge";
import { socialPlatformDescriptors } from "@/lib/publish/platforms";
import type { PlatformAccountRecord } from "@/lib/types";

function platformLabel(platform: string) {
  return socialPlatformDescriptors.find((item) => item.key === platform)?.label ?? platform;
}

function statusText(account: PlatformAccountRecord) {
  if (account.loginStatus === "authenticated") return "已登录";
  if (account.loginStatus === "pending") return "待确认";
  if (account.loginStatus === "failed") return "失败";
  if (account.loginStatus === "cancelled") return "已取消";
  return "未登录";
}

function isDesktopGeoHost() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(window.geoDesktop?.openPlatformLogin || window.geoDesktop?.validatePlatformSession);
}

function buildDesktopFailureReason(status: string, reason?: string) {
  if (reason?.trim()) {
    return reason.trim();
  }

  switch (status) {
    case "expired":
      return "检测到平台会话已失效，请重新登录。";
    case "missing_session":
      return "未检测到有效的平台登录会话。";
    case "unknown":
      return "暂时无法确认当前平台登录状态。";
    default:
      return "桌面登录未完成。";
  }
}

export function PlatformAccountCenter({ initialAccounts }: { initialAccounts: PlatformAccountRecord[] }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [loadingKey, setLoadingKey] = useState("");
  const [message, setMessage] = useState("");
  const [extensionReady, setExtensionReady] = useState(false);
  const [hostMode, setHostMode] = useState<"desktop" | "browser">(() => (isDesktopGeoHost() ? "desktop" : "browser"));
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialAccounts.map((item) => [item.id, item.remark ?? ""])),
  );
  const isDesktopHost = hostMode === "desktop";

  const groupedAccounts = useMemo(
    () =>
      socialPlatformDescriptors.map((descriptor) => ({
        descriptor,
        items: accounts.filter((item) => item.platform === descriptor.key),
      })),
    [accounts],
  );

  async function refreshAccounts() {
    const response = await fetch("/api/publish/accounts");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "加载账号失败");
    }
    setAccounts(payload.items);
    setRemarkDrafts(Object.fromEntries(payload.items.map((item: PlatformAccountRecord) => [item.id, item.remark ?? ""])));
  }

  async function sendAccountPatch(accountId: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/publish/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "更新账号失败");
    }
    return payload.account as PlatformAccountRecord;
  }

  async function applyDesktopLoginValidation(
    accountId: string,
    platform: string,
    result: Awaited<ReturnType<typeof validatePlatformSessionWindow>>,
  ) {
    if (result.status === "unsupported") {
      throw new Error(result.reason ?? "当前桌面壳未暴露会话检测桥，无法确认登录结果。");
    }

    if (result.status === "authenticated") {
      await sendAccountPatch(accountId, {
        loginStatus: "authenticated",
        status: "valid",
        lastError: undefined,
      });
      await refreshAccounts();
      setMessage(`${platformLabel(platform)} 登录状态已通过桌面会话校验并保存。`);
      return;
    }

    const lastError = buildDesktopFailureReason(result.status, result.reason);
    await sendAccountPatch(accountId, {
      loginStatus: "failed",
      status: "invalid",
      lastError,
    });
    await refreshAccounts();
    setMessage(`${platformLabel(platform)} 登录未完成：${lastError}`);
  }

  async function startLogin(platform: string, accountId?: string) {
    setLoadingKey(accountId ?? platform);
    setMessage("");
    try {
      if (isDesktopHost) {
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
              platform: string;
              title: string;
              loginUrl?: string;
              sessionPartition?: string;
            }
          | undefined;

        if (!targetAccountId || !loginRequest) {
          throw new Error("桌面登录返回数据不完整，无法继续。");
        }

        const loginResult = await openPlatformLoginWindow(loginRequest);
        if (loginResult.status === "unsupported") {
          throw new Error("当前桌面壳未暴露登录桥，无法打开平台登录窗。");
        }

        const validationResult = await validatePlatformSessionWindow({
          platform,
          publishUrl: loginRequest.loginUrl,
          sessionPartition: loginRequest.sessionPartition,
        });
        await applyDesktopLoginValidation(targetAccountId, platform, validationResult);
        return;
      }

      const ready = await pingPlatformExtension().catch(() => false);
      setExtensionReady(ready);
      if (!ready) {
        throw new Error("未检测到浏览器扩展，请先加载 `scripts/browser-extension/platform-login-helper` 扩展后再登录账号。");
      }

      const response = await fetch("/api/publishing/platform-accounts/extension-login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, accountId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "发起登录失败");

      await startPlatformExtensionLoginSession({
        session: payload,
        platform: platform as PlatformAccountRecord["platform"],
        apiBaseUrl: window.location.origin,
        forceFreshLogin: true,
      });
      await refreshAccounts();
      setMessage("已尝试打开平台登录页，请在新标签页完成登录；登录成功后扩展会自动回传并保存账号状态。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发起登录失败");
    } finally {
      setLoadingKey("");
    }
  }

  async function openAccountHome(accountId: string) {
    setLoadingKey(accountId);
    setMessage("");
    try {
      if (isDesktopHost) {
        setMessage("桌面版当前仅支持登录窗和会话校验；打开指定账号主页请在浏览器扩展模式下使用。");
        return;
      }

      const ready = await pingPlatformExtension().catch(() => false);
      setExtensionReady(ready);
      if (!ready) {
        throw new Error("未检测到浏览器扩展，无法切换到指定账号主页。");
      }
      const response = await fetch("/api/publishing/extension/platform-accounts/open-home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "读取账号主页信息失败");
      await openPlatformAccountHomeInExtension(payload);
      setMessage("扩展已打开指定平台主页，并尝试切换到该账号登录态。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "打开账号主页失败");
    } finally {
      setLoadingKey("");
    }
  }

  useEffect(() => {
    const desktopHost = isDesktopGeoHost();
    setHostMode(desktopHost ? "desktop" : "browser");

    if (desktopHost) {
      setExtensionReady(false);
      return;
    }

    let active = true;
    void pingPlatformExtension()
      .then((ready) => {
        if (active) {
          setExtensionReady(ready);
        }
      })
      .catch(() => {
        if (active) {
          setExtensionReady(false);
        }
      });

    const dispose = listenPlatformExtensionEvents((event) => {
      if (event.kind === "synced") {
        void refreshAccounts();
        setMessage(`${platformLabel(event.platform)} 登录状态已由扩展回传并保存。`);
        return;
      }
      if (event.kind === "error") {
        setMessage(event.message);
      }
    });
    return () => {
      active = false;
      dispose();
    };
  }, []);

  async function patchAccount(accountId: string, patch: Record<string, unknown>, successMessage: string) {
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
    setLoadingKey(accountId);
    setMessage("");
    try {
      const response = await fetch(`/api/publish/accounts/${accountId}`, { method: "DELETE" });
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

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groupedAccounts.map(({ descriptor, items }) => (
          <div key={descriptor.key} className="rounded-[28px] border border-white/10 bg-white/5 p-5">
            <p className="label-base">{descriptor.label}</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {isDesktopHost ? "当前运行在桌面版，将使用内置登录窗保存和校验平台会话。" : descriptor.hint}
            </p>
            <p className="mt-4 text-xs uppercase tracking-[0.24em] text-slate-500">当前账号数 {items.length}</p>
            <button
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-slate-950"
              onClick={() => startLogin(descriptor.key)}
              disabled={loadingKey === descriptor.key}
            >
              {loadingKey === descriptor.key ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {isDesktopHost ? "打开桌面登录窗" : extensionReady ? "连接新频道" : "等待扩展就绪"}
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
        <p className="label-base">已保存账号</p>
        {message ? <p className="mt-3 text-sm text-slate-300">{message}</p> : null}
        <p className="mt-3 text-xs leading-6 text-slate-400">
          {isDesktopHost
            ? "当前运行在桌面版，账号中心会使用内置登录桥打开平台登录窗，并在窗口关闭后校验真实平台会话。"
            : "当前账号中心支持双桥模式：浏览器版使用扩展桥承接真实 Cookie，桌面版使用内置登录桥保存平台会话。多账号场景仍需在发布工作台手动选择。"}
        </p>
        <p className="mt-2 text-xs leading-6 text-slate-500">
          {isDesktopHost
            ? "宿主状态：已连接桌面登录桥"
            : `扩展状态：${extensionReady ? "已连接" : "未检测到，请先在浏览器中加载 `scripts/browser-extension/platform-login-helper`"}`}
        </p>
        <div className="mt-4 grid gap-4">
          {accounts.length ? (
            accounts.map((account) => (
              <div key={account.id} className="rounded-[24px] border border-white/10 bg-slate-950/20 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{account.displayName ?? account.accountName}</p>
                    <p className="mt-1 text-sm text-slate-300">{platformLabel(account.platform)}  {statusText(account)}</p>
                    <p className="mt-1 text-xs text-slate-500">最近更新：{new Date(account.updatedAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-white"
                      onClick={() => startLogin(account.platform, account.id)}
                      disabled={loadingKey === account.id}
                    >
                      <RefreshCcw className="mr-1 inline h-3.5 w-3.5" />
                      重新登录
                    </button>
                    <button
                      className="rounded-2xl border border-sky-400/20 px-3 py-2 text-xs text-sky-200"
                      onClick={() => openAccountHome(account.id)}
                      disabled={loadingKey === account.id}
                    >
                      <ExternalLink className="mr-1 inline h-3.5 w-3.5" />
                      打开主页
                    </button>
                    <button
                      className="rounded-2xl border border-emerald-400/20 px-3 py-2 text-xs text-emerald-200"
                      onClick={() =>
                        patchAccount(
                          account.id,
                          { loginStatus: "authenticated", status: "valid" },
                          "账号已被强制标记为已登录，仅建议用于调试；若真实平台会话无效，发布前仍会提示重新登录。",
                        )
                      }
                      disabled={loadingKey === account.id}
                    >
                      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                      强制标记已登录
                    </button>
                    <button
                      className="rounded-2xl border border-rose-400/20 px-3 py-2 text-xs text-rose-200"
                      onClick={() => patchAccount(account.id, { loginStatus: "failed", status: "invalid", lastError: "用户手动标记为失败" }, "账号已标记为失败。")}
                      disabled={loadingKey === account.id}
                    >
                      <XCircle className="mr-1 inline h-3.5 w-3.5" />
                      标记失败
                    </button>
                    <button
                      className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-white"
                      onClick={() => removeAccount(account.id)}
                      disabled={loadingKey === account.id}
                    >
                      <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
                  <input
                    className="input-base"
                    value={remarkDrafts[account.id] ?? ""}
                    onChange={(event) => setRemarkDrafts((current) => ({ ...current, [account.id]: event.target.value }))}
                    placeholder="补充账号备注、用途或状态说明"
                  />
                  <button
                    className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white"
                    onClick={() => patchAccount(account.id, { remark: remarkDrafts[account.id] ?? "" }, "账号备注已保存。")}
                    disabled={loadingKey === account.id}
                  >
                    保存备注
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-300">
              当前还没有保存的平台账号，请先从上方入口发起登录；浏览器版会打开扩展标签页，桌面版会打开内置登录窗。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
