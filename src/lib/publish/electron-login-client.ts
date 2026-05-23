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
  timeoutMs?: number;
  payload: {
    draftTitle: string;
    draftBody: string;
    draftTags: string[];
    draftImages: string[];
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

declare global {
  interface Window {
    geoDesktop?: {
      openPlatformLogin?: (input: ElectronPlatformLoginRequest) => Promise<ElectronPlatformLoginResult>;
      validatePlatformSession?: (input: ElectronPlatformSessionValidationRequest) => Promise<ElectronPlatformSessionValidationResult>;
      runPlatformPublish?: (input: ElectronPlatformPublishRequest) => Promise<ElectronPlatformPublishResult>;
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

  if (input.loginUrl) {
    window.open(input.loginUrl, "_blank", "noopener,noreferrer");
    return { status: "opened" };
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

  return { status: "unsupported", reason: "当前环境缺少 Electron 会话检测桥。" };
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

  if (input.publishUrl) {
    window.open(input.publishUrl, "_blank", "noopener,noreferrer");
  }

  return {
    status: "unsupported",
    errorMessage: "当前环境缺少 Electron 发布桥，无法执行桌面自动发布。",
    failureStage: "missing_electron_bridge",
    executionLog: ["missing_electron_bridge: window.geoDesktop.runPlatformPublish 不存在"],
  };
}
