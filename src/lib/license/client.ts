import { DEFAULT_APP_VERSION } from "@/lib/updates/client";

const DEVICE_FINGERPRINT_STORAGE_KEY = "geo-device-fingerprint";
const MACHINE_CODE_STORAGE_KEY = "geo-machine-code";

export type LicenseStatus = "inactive" | "active" | "expired" | "disabled";

export interface LicenseActivationPayload {
  licenseCode: string;
  deviceFingerprint: string;
  machineCode: string;
  deviceLabel: string;
  appVersion: string;
}

export interface LicenseStatusResponse {
  status: LicenseStatus;
  license?: {
    codeHash: string;
    maxDevices: number;
    expiresAt?: string | null;
    issuedTo?: string;
    createdAt?: string;
    activatedAt?: string | null;
  };
  binding?: {
    boundAt?: string;
    lastCheckedAt?: string | null;
    appVersion?: string;
  };
  error?: string;
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStoredId(storageKey: string, prefix: string) {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const created = createId(prefix);
  window.localStorage.setItem(storageKey, created);
  return created;
}

export function getLicenseDeviceFingerprint() {
  return getStoredId(DEVICE_FINGERPRINT_STORAGE_KEY, "geo-device");
}

export function getLicenseMachineCode() {
  return getStoredId(MACHINE_CODE_STORAGE_KEY, "geo-machine");
}

export function getLicenseDeviceLabel() {
  if (typeof navigator === "undefined") {
    return "server";
  }

  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return [navigator.platform || "unknown", userAgentData?.platform].filter(Boolean).join(" / ");
}

export function createLicenseActivationPayload(licenseCode: string): LicenseActivationPayload {
  return {
    licenseCode: licenseCode.trim(),
    deviceFingerprint: getLicenseDeviceFingerprint(),
    machineCode: getLicenseMachineCode(),
    deviceLabel: getLicenseDeviceLabel(),
    appVersion: DEFAULT_APP_VERSION,
  };
}

export async function activateLicense(licenseCode: string) {
  const response = await fetch("/api/license/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createLicenseActivationPayload(licenseCode)),
  });
  const result = (await response.json().catch(() => ({}))) as LicenseStatusResponse;

  if (!response.ok) {
    throw new Error(result.error ?? "授权激活失败，请稍后重试。");
  }

  return result;
}

export async function checkLicenseStatus() {
  const query = new URLSearchParams({
    deviceFingerprint: getLicenseDeviceFingerprint(),
  });
  const response = await fetch(`/api/license/status?${query.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as LicenseStatusResponse;

  if (!response.ok) {
    throw new Error(result.error ?? "授权状态检查失败，请稍后重试。");
  }

  return result;
}
