"use client";

import { useState } from "react";
import { CheckCircle2, Download, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import {
  checkLatestUpdate,
  downloadAndVerifyRelease,
  formatBytes,
  type LatestReleaseManifest,
} from "@/lib/updates/client";

type Notice = { tone: "success" | "error" | "info"; text: string };

export function UpdateCheckBox({ currentVersion }: { currentVersion: string }) {
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [manifest, setManifest] = useState<LatestReleaseManifest | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleCheck() {
    setChecking(true);
    setNotice(null);

    try {
      const latest = await checkLatestUpdate({ version: currentVersion, platform: "win32", arch: "x64" });
      setManifest(latest);
      setNotice({
        tone: latest.updateAvailable ? "info" : "success",
        text: latest.updateAvailable ? `发现新版本 ${latest.version}` : "已是最新版本。",
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "检查更新失败，请稍后重试。" });
    } finally {
      setChecking(false);
    }
  }

  async function handleDownload() {
    if (!manifest) {
      return;
    }

    setDownloading(true);
    setNotice(null);

    try {
      const result = await downloadAndVerifyRelease(manifest);
      setNotice({ tone: "success", text: `校验通过，已开始下载 ${result.fileName}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "下载更新失败，请稍后重试。" });
    } finally {
      setDownloading(false);
    }
  }

  const noticeClass =
    notice?.tone === "success" ? "text-emerald-400" : notice?.tone === "error" ? "text-danger" : "text-accent";

  return (
    <section className="rounded-lg border border-stroke bg-panel/70 p-5 shadow-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h3 className="font-display text-lg font-bold text-ink">检查更新</h3>
          <p className="text-sm leading-6 text-muted">
            当前版本 {currentVersion}。更新只从服务器 release 清单和安装包下载，不执行远程脚本或源码。
          </p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stroke bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={handleCheck}
          disabled={checking}
        >
          {checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {checking ? "检查中..." : "检查更新"}
        </button>
      </div>

      {notice ? <p className={`mt-4 text-sm ${noticeClass}`}>{notice.text}</p> : null}

      {manifest ? (
        <div className="mt-5 rounded-lg border border-stroke bg-surface/70 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                {manifest.updateAvailable ? <Download className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                <span>{manifest.updateAvailable ? `新版本 ${manifest.version}` : `版本 ${manifest.version}`}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">
                {manifest.notes || "暂无更新说明"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>
                  {manifest.platform}/{manifest.arch}
                </span>
                <span>{formatBytes(manifest.asset.size)}</span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  SHA-256
                </span>
              </div>
            </div>

            {manifest.updateAvailable ? (
              <button
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {downloading ? "校验中..." : "下载更新"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
