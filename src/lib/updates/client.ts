export interface ReleaseAsset {
  url: string;
  sha256: string;
  size: number;
}

export interface LatestReleaseManifest {
  version: string;
  channel: string;
  minSupportedVersion?: string;
  publishedAt?: string;
  notes: string;
  mandatory: boolean;
  platform: string;
  arch: string;
  asset: ReleaseAsset;
  updateAvailable: boolean;
  currentVersion: string;
}

export interface UpdateCheckInput {
  platform?: string;
  arch?: string;
  version?: string;
}

export interface VerifiedDownload {
  fileName: string;
  blobUrl: string;
  sha256: string;
  size: number;
}

export const DEFAULT_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

export function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }

  return 0;
}

export function getRuntimePlatform() {
  if (typeof navigator === "undefined") {
    return "win32";
  }

  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) {
    return "darwin";
  }
  if (platform.includes("linux")) {
    return "linux";
  }

  return "win32";
}

export function getRuntimeArch() {
  if (typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("arm64")) {
    return "arm64";
  }

  return "x64";
}

export async function checkLatestUpdate(input: UpdateCheckInput = {}) {
  const query = new URLSearchParams({
    platform: input.platform ?? getRuntimePlatform(),
    arch: input.arch ?? getRuntimeArch(),
    version: input.version ?? DEFAULT_APP_VERSION,
  });

  const response = await fetch(`/api/updates/latest?${query.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const result = (await response.json().catch(() => ({}))) as Partial<LatestReleaseManifest> & { error?: string };

  if (!response.ok) {
    throw new Error(result.error ?? "检查更新失败，请稍后重试。");
  }

  if (!result.version || !result.asset?.url || !result.asset.sha256) {
    throw new Error("更新清单不完整。");
  }

  return result as LatestReleaseManifest;
}

async function calculateSha256(buffer: ArrayBuffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getFileNameFromUrl(url: string) {
  const parsed = new URL(url);
  const fileName = parsed.pathname.split("/").filter(Boolean).pop();
  return fileName ? decodeURIComponent(fileName) : "GEO-Desktop-Update.exe";
}

export async function downloadAndVerifyRelease(manifest: LatestReleaseManifest): Promise<VerifiedDownload> {
  if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    throw new Error("当前环境不支持安全校验，请使用 HTTPS 后再下载更新。");
  }

  const response = await fetch(manifest.asset.url);
  if (!response.ok) {
    throw new Error("下载安装包失败，请稍后重试。");
  }

  const buffer = await response.arrayBuffer();
  const actualSha256 = await calculateSha256(buffer);
  if (actualSha256.toLowerCase() !== manifest.asset.sha256.toLowerCase()) {
    throw new Error("安装包校验失败，已阻止下载。");
  }

  const fileName = getFileNameFromUrl(manifest.asset.url);
  const blobUrl = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  return {
    fileName,
    blobUrl,
    sha256: actualSha256,
    size: buffer.byteLength,
  };
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "未知大小";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
