import type {
  ElectronPlatformLoginRequest,
  ElectronPlatformLoginResult,
  ElectronPlatformPublishProgressRequest,
  ElectronPlatformPublishRequest,
  ElectronPlatformPublishResult,
  ElectronPlatformSessionValidationRequest,
  ElectronPlatformSessionValidationResult,
} from "./electron-login-client";
import type { PublishProgressSnapshot } from "@/lib/types";

export const LOCAL_BRIDGE_BASE_URL = "http://127.0.0.1:3217";

export type DesktopBridgeMode = "electron_bridge" | "local_bridge" | "bridge_unreachable";

export interface DesktopBridgeAvailability {
  mode: DesktopBridgeMode;
  label: string;
  reason?: string;
}

export interface LocalBridgeHealthPayload {
  status: string;
  bridge: string;
  host: string;
  port: number;
  version: string;
  ready: boolean;
}

function hasWindow() {
  return typeof window !== "undefined";
}

export function hasElectronDesktopBridge() {
  if (!hasWindow()) {
    return false;
  }

  return Boolean(
    window.geoDesktop?.openPlatformLogin ||
      window.geoDesktop?.validatePlatformSession ||
      window.geoDesktop?.runPlatformPublish,
  );
}

async function requestLocalBridge<T>(pathname: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}${pathname}`, {
      ...init,
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as T & { error?: string; reason?: string };
    if (!response.ok) {
      throw new Error(payload.error || payload.reason || "GEO 本地桌面桥请求失败。");
    }
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function checkLocalBridgeHealth(): Promise<LocalBridgeHealthPayload | null> {
  if (!hasWindow()) {
    return null;
  }

  try {
    return await requestLocalBridge<LocalBridgeHealthPayload>("/health", { method: "GET" }, 1500);
  } catch {
    return null;
  }
}

export async function detectDesktopBridge(): Promise<DesktopBridgeAvailability> {
  if (hasElectronDesktopBridge()) {
    return {
      mode: "electron_bridge",
      label: "已连接 Electron 注入桥",
    };
  }

  const health = await checkLocalBridgeHealth();
  if (health?.status === "ok" && health.ready) {
    return {
      mode: "local_bridge",
      label: "已连接本机桌面桥",
    };
  }

  return {
    mode: "bridge_unreachable",
    label: "未检测到可用桌面桥",
    reason: "当前浏览器没有连接到 GEO 桌面版。请先启动桌面程序，再回到页面刷新。",
  };
}

export async function openPlatformLoginViaLocalBridge(
  input: ElectronPlatformLoginRequest,
): Promise<ElectronPlatformLoginResult> {
  return requestLocalBridge<ElectronPlatformLoginResult>(
    "/platform/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    15000,
  );
}

export async function validatePlatformSessionViaLocalBridge(
  input: ElectronPlatformSessionValidationRequest,
): Promise<ElectronPlatformSessionValidationResult> {
  return requestLocalBridge<ElectronPlatformSessionValidationResult>(
    "/platform/session/validate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    20000,
  );
}

export async function runPlatformPublishViaLocalBridge(
  input: ElectronPlatformPublishRequest,
): Promise<ElectronPlatformPublishResult> {
  return requestLocalBridge<ElectronPlatformPublishResult>(
    "/platform/publish",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    Math.max(30000, (input.timeoutMs ?? 0) + 5000),
  );
}

export async function getPlatformPublishProgressViaLocalBridge(
  input: ElectronPlatformPublishProgressRequest,
): Promise<PublishProgressSnapshot | null> {
  return requestLocalBridge<PublishProgressSnapshot | null>(
    "/platform/publish/progress",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    5000,
  );
}
