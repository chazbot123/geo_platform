import {
  checkLocalBridgeHealth,
  getPlatformPublishProgressViaLocalBridge,
  hasElectronDesktopBridge,
  openPlatformLoginViaLocalBridge,
  runPlatformPublishViaLocalBridge,
  validatePlatformSessionViaLocalBridge,
} from "./local-bridge-client";
import type { PublishProgressSnapshot } from "@/lib/types";

export interface ElectronPlatformLoginRequest {
  platform: string;
  title: string;
  loginUrl?: string;
  sessionPartition?: string;
}

export interface ElectronPlatformLoginResult {
  status: "closed" | "opened" | "unsupported";
}

export interface ElectronPlatformSessionValidationRequest {
  platform: string;
  publishUrl?: string;
  sessionPartition?: string;
  authPayload?: string;
}

export interface ElectronPlatformSessionValidationResult {
  status: "authenticated" | "expired" | "missing_session" | "unknown" | "unsupported";
  reason?: string;
  currentUrl?: string;
  cookieCount?: number;
}

export interface ElectronPlatformPublishRequest {
  platform: string;
  title: string;
  publishUrl?: string;
  sessionPartition?: string;
  authPayload?: string;
  sessionToken?: string;
  timeoutMs?: number;
  payload: {
    draftTitle: string;
    draftBody: string;
    draftTags: string[];
    draftImages: string[];
    draftImagePaths?: string[];
    publishMode?: "text_only" | "with_images";
    preparedImages?: Array<{
      name: string;
      mimeType: string;
      dataUrl: string;
    }>;
  };
}

export interface ElectronPlatformPublishResult {
  status: "published" | "submitted" | "verifying" | "pending_review" | "verification_failed" | "failed" | "unsupported";
  draftUrl?: string;
  publishUrl?: string;
  verificationUrl?: string;
  externalStatus?: string;
  executionLog?: string[];
  verificationEvidence?: string;
  verificationAttempts?: number;
  platformItemId?: string;
  failureStage?: string;
  errorMessage?: string;
}

export interface ElectronPlatformPublishProgressRequest {
  sessionToken: string;
}

declare global {
  interface Window {
    geoDesktop?: {
      openPlatformLogin?: (input: ElectronPlatformLoginRequest) => Promise<ElectronPlatformLoginResult>;
      validatePlatformSession?: (input: ElectronPlatformSessionValidationRequest) => Promise<ElectronPlatformSessionValidationResult>;
      runPlatformPublish?: (input: ElectronPlatformPublishRequest) => Promise<ElectronPlatformPublishResult>;
      getPlatformPublishProgress?: (input: ElectronPlatformPublishProgressRequest) => Promise<PublishProgressSnapshot | null>;
    };
  }
}

export async function openPlatformLoginWindow(input: ElectronPlatformLoginRequest): Promise<ElectronPlatformLoginResult> {
  if (typeof window === "undefined") {
    return { status: "unsupported" };
  }

  if (window.geoDesktop?.openPlatformLogin) {
    return window.geoDesktop.openPlatformLogin(input);
  }

  const health = await checkLocalBridgeHealth();
  if (health?.status === "ok" && health.ready) {
    return openPlatformLoginViaLocalBridge(input);
  }

  return { status: "unsupported" };
}

export async function validatePlatformSessionWindow(
  input: ElectronPlatformSessionValidationRequest,
): Promise<ElectronPlatformSessionValidationResult> {
  if (typeof window === "undefined") {
    return { status: "unsupported", reason: "当前环境不支持平台会话检测。" };
  }

  if (window.geoDesktop?.validatePlatformSession) {
    return window.geoDesktop.validatePlatformSession(input);
  }

  const health = await checkLocalBridgeHealth();
  if (health?.status === "ok" && health.ready) {
    return validatePlatformSessionViaLocalBridge(input);
  }

  return { status: "unsupported", reason: "当前环境缺少可用桌面桥，请先启动 GEO 桌面版。" };
}

export async function runPlatformPublishWindow(input: ElectronPlatformPublishRequest): Promise<ElectronPlatformPublishResult> {
  if (typeof window === "undefined") {
    return {
      status: "unsupported",
      errorMessage: "当前环境不支持桌面发布。",
      failureStage: "missing_electron_bridge",
      executionLog: ["missing_electron_bridge: 当前环境不是浏览器可执行的桌面壳"],
    };
  }

  if (window.geoDesktop?.runPlatformPublish) {
    return window.geoDesktop.runPlatformPublish(input);
  }

  const health = await checkLocalBridgeHealth();
  if (health?.status === "ok" && health.ready) {
    return runPlatformPublishViaLocalBridge(input);
  }

  return {
    status: "unsupported",
    errorMessage: "当前环境缺少可用桌面桥，无法执行桌面自动发布。请先启动 GEO 桌面版。",
    failureStage: "missing_electron_bridge",
    executionLog: ["missing_electron_bridge: Electron 注入桥和本机 localhost 桥都不可用"],
  };
}

export async function getPlatformPublishProgressWindow(
  input: ElectronPlatformPublishProgressRequest,
): Promise<PublishProgressSnapshot | null> {
  if (typeof window === "undefined") {
    return null;
  }

  if (window.geoDesktop?.getPlatformPublishProgress) {
    return window.geoDesktop.getPlatformPublishProgress(input);
  }

  const health = await checkLocalBridgeHealth();
  if (health?.status === "ok" && health.ready) {
    return getPlatformPublishProgressViaLocalBridge(input);
  }

  return null;
}

export async function isDesktopBridgeAvailable() {
  if (hasElectronDesktopBridge()) {
    return true;
  }

  const health = await checkLocalBridgeHealth();
  return Boolean(health?.status === "ok" && health.ready);
}
