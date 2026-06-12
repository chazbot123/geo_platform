"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";
import {
  activateLicense,
  checkLicenseStatus,
  getLicenseDeviceFingerprint,
  type LicenseStatusResponse,
} from "@/lib/license/client";

type Notice = { tone: "success" | "error" | "info"; text: string };

const statusLabel: Record<string, string> = {
  inactive: "未激活",
  active: "已激活",
  expired: "已过期",
  disabled: "已停用",
};

const DEBUG_SERVER_URL = "http://127.0.0.1:7777/event";
const DEBUG_SESSION_ID = "license-activation-failed";

function maskHash(hash?: string) {
  if (!hash) {
    return "-";
  }

  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

function emitDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown>) {
  // #region debug-point shared:emit
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

export function LicenseStatusBox() {
  const [licenseCode, setLicenseCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<LicenseStatusResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deviceFingerprint, setDeviceFingerprint] = useState("");

  async function refreshStatus() {
    setLoading(true);
    setNotice(null);

    try {
      // #region debug-point B:status-request
      emitDebug("B", "license-status-box.tsx:refreshStatus:before", "开始检查授权状态", {
        deviceFingerprint: getLicenseDeviceFingerprint(),
      });
      // #endregion
      const result = await checkLicenseStatus();
      setStatus(result);
      // #region debug-point B:status-response
      emitDebug("B", "license-status-box.tsx:refreshStatus:after", "授权状态接口返回", {
        status: result.status,
        hasLicense: Boolean(result.license),
        hasBinding: Boolean(result.binding),
        lastCheckedAt: result.binding?.lastCheckedAt ?? null,
        error: result.error ?? null,
      });
      // #endregion
      setNotice({ tone: result.status === "active" ? "success" : "info", text: `授权状态：${statusLabel[result.status] ?? result.status}` });
    } catch (error) {
      // #region debug-point B:status-error
      emitDebug("B", "license-status-box.tsx:refreshStatus:error", "授权状态接口报错", {
        error: error instanceof Error ? error.message : String(error),
      });
      // #endregion
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "授权状态检查失败。" });
    } finally {
      setLoading(false);
    }
  }

  async function handleActivate() {
    if (!licenseCode.trim()) {
      setNotice({ tone: "error", text: "请输入授权码。" });
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      // #region debug-point A:activate-request
      emitDebug("A", "license-status-box.tsx:handleActivate:before", "开始提交授权激活", {
        licenseCodeSuffix: licenseCode.trim().slice(-8),
        deviceFingerprint: getLicenseDeviceFingerprint(),
      });
      // #endregion
      const result = await activateLicense(licenseCode);
      setStatus(result);
      setLicenseCode("");
      // #region debug-point A:activate-response
      emitDebug("A", "license-status-box.tsx:handleActivate:after", "授权激活接口返回", {
        status: result.status,
        hasLicense: Boolean(result.license),
        hasBinding: Boolean(result.binding),
        activatedAt: result.license?.activatedAt ?? null,
        error: result.error ?? null,
      });
      // #endregion
      setNotice({ tone: "success", text: "授权已激活并绑定当前设备。" });
    } catch (error) {
      // #region debug-point A:activate-error
      emitDebug("A", "license-status-box.tsx:handleActivate:error", "授权激活接口报错", {
        error: error instanceof Error ? error.message : String(error),
        deviceFingerprint: getLicenseDeviceFingerprint(),
      });
      // #endregion
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "授权激活失败。" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDeviceFingerprint(getLicenseDeviceFingerprint());
    void refreshStatus();
  }, []);

  const noticeClass = notice?.tone === "success" ? "text-emerald-400" : notice?.tone === "error" ? "text-danger" : "text-accent";
  const active = status?.status === "active";

  return (
    <section className="rounded-lg border border-stroke bg-panel/70 p-5 shadow-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h3 className="font-display text-lg font-bold text-ink">授权状态</h3>
          <p className="text-sm leading-6 text-muted">授权码只提交到部署的授权服务；客户端仅保存本机设备指纹和绑定状态。</p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stroke bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={refreshStatus}
          disabled={loading}
        >
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="rounded-lg border border-stroke bg-surface/70 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            {active ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <ShieldAlert className="h-4 w-4 text-accent" />}
            <span>{statusLabel[status?.status ?? "inactive"] ?? status?.status ?? "未激活"}</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
            <span>设备：{deviceFingerprint ? `${deviceFingerprint.slice(0, 18)}...` : "-"}</span>
            <span>授权：{maskHash(status?.license?.codeHash)}</span>
            <span>设备数：{status?.license?.maxDevices ?? "-"}</span>
            <span>到期：{status?.license?.expiresAt ? new Date(status.license.expiresAt).toLocaleDateString("zh-CN") : "长期"}</span>
          </div>
        </div>

        <div className="space-y-3">
          <input
            className="input-base"
            value={licenseCode}
            onChange={(event) => setLicenseCode(event.target.value)}
            placeholder="输入授权码"
            autoComplete="off"
          />
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={handleActivate}
            disabled={loading}
          >
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            激活并绑定
          </button>
        </div>
      </div>

      {notice ? <p className={`mt-4 text-sm ${noticeClass}`}>{notice.text}</p> : null}
    </section>
  );
}
