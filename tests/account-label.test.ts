import { describe, expect, it } from "vitest";
import { formatAccountDisplayLabel, resolveAccountIdentifier } from "@/lib/publish/account-label";

describe("account label helpers", () => {
  it("formats nickname with account identifier when both are meaningful", () => {
    expect(
      formatAccountDisplayLabel({
        platform: "xiaohongshu",
        displayName: "小红薯品牌号",
        accountName: "小红薯3C3C3592",
        platformAccountId: "小红薯3C3C3592",
      }),
    ).toBe("小红薯品牌号（小红薯3C3C3592）");
  });

  it("ignores generic platform labels and falls back to the real identifier", () => {
    expect(
      formatAccountDisplayLabel({
        platform: "toutiao",
        displayName: "今日头条",
        accountName: "6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f",
        platformAccountId: "6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f",
      }),
    ).toBe("6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f");
  });

  it("rejects suspicious display text like 发文规范 for account labels", () => {
    expect(
      resolveAccountIdentifier({
        platform: "toutiao",
        displayName: "头条号发文规范",
        accountName: "6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f",
        platformAccountId: "6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f",
      }),
    ).toBe("6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f");
  });
});
