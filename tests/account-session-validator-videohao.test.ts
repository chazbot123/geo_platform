import { describe, expect, it, vi } from "vitest";
import type { PlatformAccountRecord } from "@/lib/types";

vi.mock("@/lib/publish/electron-login-client", () => ({
  validatePlatformSessionWindow: vi.fn(async () => {
    throw new Error("hidden Electron validation should not run for Videohao extension cookie accounts");
  }),
}));

const { auditPlatformAccountSession } = await import("@/lib/publish/account-session-validator");
const { validatePlatformSessionWindow } = await import("@/lib/publish/electron-login-client");

function buildAccount(overrides: Partial<PlatformAccountRecord> = {}): PlatformAccountRecord {
  const timestamp = "2026-06-16T10:00:00.000Z";
  return {
    id: "videohao-account",
    platform: "videohao",
    provider: "electron",
    authType: "cookie",
    source: "browser_extension",
    accountName: "视频号测试账号",
    displayName: "视频号测试账号",
    status: "valid",
    loginStatus: "authenticated",
    authPayload: JSON.stringify({
      payloadFormat: "cookie_storage_v2",
      cookies: [{ name: "finder", value: "ok", domain: ".weixin.qq.com", path: "/" }],
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("Videohao account session validation", () => {
  it("validates extension cookie accounts without opening a hidden Electron platform window", async () => {
    const result = await auditPlatformAccountSession(buildAccount());

    expect(validatePlatformSessionWindow).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      canAutoValidate: true,
      validationStatus: "authenticated",
      nextLoginStatus: "authenticated",
      nextStatus: "valid",
    });
    expect(result.patch).toMatchObject({
      loginStatus: "authenticated",
      status: "valid",
      riskState: "active",
    });
  });
});
