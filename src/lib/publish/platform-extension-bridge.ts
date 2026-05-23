"use client";

import type {
  PlatformExtensionLoginSession,
  PlatformExtensionPublishSession,
  PlatformAccountRecord,
  PublishingJobRecord,
  SocialPlatform,
} from "@/lib/types";

const PAGE_SOURCE = "ai-superweb-page";
const EXTENSION_SOURCE = "ai-superweb-extension";
const REQUEST_TIMEOUT_MS = 4000;

type ExtensionRequestPayload =
  | { action: "PING" }
  | {
      action: "START_LOGIN";
      session: PlatformExtensionLoginSession;
      apiBaseUrl: string;
      platform: SocialPlatform;
      forceFreshLogin?: boolean;
    }
  | {
      action: "START_PUBLISH";
      session: PlatformExtensionPublishSession;
      apiBaseUrl: string;
      platform: SocialPlatform;
    }
  | {
      action: "OPEN_ACCOUNT_HOME";
      platform: SocialPlatform;
      loginUrl: string;
      authPayload: string;
    };

type ExtensionResponseMessage = {
  source: typeof EXTENSION_SOURCE;
  type: "AI_SUPERWEB_EXTENSION_RESPONSE";
  requestId: string;
  payload?: {
    ok: boolean;
    message?: string;
    version?: string;
  };
};

type ExtensionStatusMessage = {
  source: typeof EXTENSION_SOURCE;
  type:
    | "AI_SUPERWEB_EXTENSION_LOGIN_SYNCED"
    | "AI_SUPERWEB_EXTENSION_LOGIN_ERROR"
    | "AI_SUPERWEB_EXTENSION_PUBLISH_SYNCED"
    | "AI_SUPERWEB_EXTENSION_PUBLISH_ERROR";
  payload?: {
    sessionId: string;
    platform: SocialPlatform;
    account?: PlatformAccountRecord;
    job?: PublishingJobRecord;
    message?: string;
  };
};

export type PlatformExtensionEvent =
  | { kind: "synced"; sessionId: string; platform: SocialPlatform; account: PlatformAccountRecord }
  | { kind: "error"; sessionId: string; platform: SocialPlatform; message: string }
  | { kind: "publish-synced"; sessionId: string; platform: SocialPlatform; job: PublishingJobRecord }
  | { kind: "publish-error"; sessionId: string; platform: SocialPlatform; message: string };

function createRequestId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureWindowAvailable() {
  if (typeof window === "undefined") {
    throw new Error("当前环境不支持浏览器扩展桥。");
  }
}

function postExtensionRequest(payload: ExtensionRequestPayload) {
  ensureWindowAvailable();
  return new Promise<{ ok: boolean; message?: string; version?: string }>((resolve, reject) => {
    const requestId = createRequestId();
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("未检测到平台登录扩展，请确认已安装并启用扩展。"));
    }, REQUEST_TIMEOUT_MS);

    function handleMessage(event: MessageEvent) {
      const data = event.data as ExtensionResponseMessage | undefined;
      if (event.source !== window || !data || data.source !== EXTENSION_SOURCE) return;
      if (data.type !== "AI_SUPERWEB_EXTENSION_RESPONSE" || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", handleMessage);
      resolve(data.payload ?? { ok: false, message: "扩展没有返回结果" });
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: "AI_SUPERWEB_EXTENSION_REQUEST",
        requestId,
        payload,
      },
      window.location.origin,
    );
  });
}

export async function pingPlatformExtension() {
  const response = await postExtensionRequest({ action: "PING" });
  return Boolean(response.ok);
}

export async function startPlatformExtensionLoginSession(input: {
  session: PlatformExtensionLoginSession;
  platform: SocialPlatform;
  apiBaseUrl: string;
  forceFreshLogin?: boolean;
}) {
  const response = await postExtensionRequest({
    action: "START_LOGIN",
    session: input.session,
    platform: input.platform,
    apiBaseUrl: input.apiBaseUrl,
    forceFreshLogin: input.forceFreshLogin,
  });
  if (!response.ok) {
    throw new Error(response.message || "平台登录扩展启动失败");
  }
}

export async function startPlatformExtensionPublishSession(input: {
  session: PlatformExtensionPublishSession;
  platform: SocialPlatform;
  apiBaseUrl: string;
}) {
  const response = await postExtensionRequest({
    action: "START_PUBLISH",
    session: input.session,
    platform: input.platform,
    apiBaseUrl: input.apiBaseUrl,
  });
  if (!response.ok) {
    throw new Error(response.message || "本地发布扩展启动失败");
  }
}

export async function openPlatformAccountHomeInExtension(input: {
  platform: SocialPlatform;
  loginUrl: string;
  authPayload: string;
}) {
  const response = await postExtensionRequest({
    action: "OPEN_ACCOUNT_HOME",
    platform: input.platform,
    loginUrl: input.loginUrl,
    authPayload: input.authPayload,
  });
  if (!response.ok) {
    throw new Error(response.message || "扩展打开账号页面失败");
  }
}

export function listenPlatformExtensionEvents(onEvent: (event: PlatformExtensionEvent) => void) {
  ensureWindowAvailable();
  function handleMessage(event: MessageEvent) {
    const data = event.data as ExtensionStatusMessage | undefined;
    if (event.source !== window || !data || data.source !== EXTENSION_SOURCE) return;

    if (data.type === "AI_SUPERWEB_EXTENSION_LOGIN_SYNCED" && data.payload?.account) {
      onEvent({
        kind: "synced",
        sessionId: data.payload.sessionId,
        platform: data.payload.platform,
        account: data.payload.account,
      });
      return;
    }

    if (data.type === "AI_SUPERWEB_EXTENSION_LOGIN_ERROR" && data.payload) {
      onEvent({
        kind: "error",
        sessionId: data.payload.sessionId,
        platform: data.payload.platform,
        message: data.payload.message || "扩展自动保存登录信息失败",
      });
      return;
    }

    if (data.type === "AI_SUPERWEB_EXTENSION_PUBLISH_SYNCED" && data.payload?.job) {
      onEvent({
        kind: "publish-synced",
        sessionId: data.payload.sessionId,
        platform: data.payload.platform,
        job: data.payload.job,
      });
      return;
    }

    if (data.type === "AI_SUPERWEB_EXTENSION_PUBLISH_ERROR" && data.payload) {
      onEvent({
        kind: "publish-error",
        sessionId: data.payload.sessionId,
        platform: data.payload.platform,
        message: data.payload.message || "扩展本地发布失败",
      });
    }
  }

  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}
