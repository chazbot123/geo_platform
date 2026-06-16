import { toUserFacingErrorMessage } from "@/lib/errors/user-facing";

export const FEEDBACK_ISSUE_TYPES = [
  "模型连接问题",
  "内容生成问题",
  "账号登录问题",
  "发布失败问题",
  "界面体验问题",
  "其他问题",
] as const;

export type FeedbackIssueType = (typeof FEEDBACK_ISSUE_TYPES)[number];

export interface FeedbackPayload {
  id: string;
  type: FeedbackIssueType;
  message: string;
  contact: string;
  appVersion: string;
  deviceFingerprint: string;
  platform: string;
  clientTime: string;
  createdAt: string;
}

const FINGERPRINT_STORAGE_KEY = "geo-device-fingerprint";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDeviceFingerprint() {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = window.localStorage.getItem(FINGERPRINT_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const fingerprint = `geo-${createId()}`;
  window.localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
  return fingerprint;
}

export function createFeedbackPayload(input: {
  type: FeedbackIssueType;
  message: string;
  contact?: string;
  appVersion?: string;
}): FeedbackPayload {
  const now = new Date().toISOString();

  return {
    id: createId(),
    type: input.type,
    message: input.message.trim(),
    contact: input.contact?.trim() ?? "",
    appVersion: input.appVersion ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
    deviceFingerprint: getDeviceFingerprint(),
    platform: typeof navigator === "undefined" ? "unknown" : navigator.platform || "unknown",
    clientTime: now,
    createdAt: now,
  };
}

export async function submitFeedback(payload: FeedbackPayload) {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(toUserFacingErrorMessage(result.error, "反馈提交失败，请稍后重试。"));
  }

  return result;
}
