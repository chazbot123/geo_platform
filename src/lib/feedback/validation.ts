import { FEEDBACK_ISSUE_TYPES, type FeedbackPayload } from "@/lib/feedback/client";

export function isFeedbackPayload(payload: Partial<FeedbackPayload>): payload is FeedbackPayload {
  return (
    typeof payload.id === "string" &&
    FEEDBACK_ISSUE_TYPES.includes(payload.type as FeedbackPayload["type"]) &&
    typeof payload.message === "string" &&
    payload.message.trim().length > 0 &&
    typeof payload.contact === "string" &&
    typeof payload.appVersion === "string" &&
    typeof payload.deviceFingerprint === "string" &&
    typeof payload.platform === "string" &&
    typeof payload.clientTime === "string" &&
    typeof payload.createdAt === "string"
  );
}
