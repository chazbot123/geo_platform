import { describe, expect, it } from "vitest";
import { FEEDBACK_ISSUE_TYPES } from "@/lib/feedback/client";
import { isFeedbackPayload } from "@/lib/feedback/validation";

const validPayload = {
  id: "feedback-1",
  type: FEEDBACK_ISSUE_TYPES[0],
  message: "Cannot publish draft",
  contact: "",
  appVersion: "0.1.0",
  deviceFingerprint: "device-1",
  platform: "Win32",
  clientTime: "2026-06-09T00:00:00.000Z",
  createdAt: "2026-06-09T00:00:00.000Z",
};

describe("feedback payload validation", () => {
  it("uses clean Chinese issue type labels", () => {
    expect(FEEDBACK_ISSUE_TYPES).toContain("模型连接问题");
    expect(FEEDBACK_ISSUE_TYPES).toContain("内容生成问题");
    expect(FEEDBACK_ISSUE_TYPES).toContain("账号登录问题");
    expect(FEEDBACK_ISSUE_TYPES).toContain("发布失败问题");
    expect(FEEDBACK_ISSUE_TYPES).toContain("界面体验问题");
    expect(FEEDBACK_ISSUE_TYPES).toContain("其他问题");
  });

  it("accepts complete payloads using approved issue types", () => {
    expect(isFeedbackPayload(validPayload)).toBe(true);
  });

  it("rejects unknown types, blank messages, and missing required strings", () => {
    expect(isFeedbackPayload({ ...validPayload, type: "other" as never })).toBe(false);
    expect(isFeedbackPayload({ ...validPayload, message: "   " })).toBe(false);
    expect(isFeedbackPayload({ ...validPayload, deviceFingerprint: undefined })).toBe(false);
  });
});
