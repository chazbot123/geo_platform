import { describe, expect, it } from "vitest";
import {
  formatAccountDisplayLabel,
  resolveAccountIdentifier,
  sanitizeAccountProfileForSave,
} from "@/lib/publish/account-label";

describe("account label helpers", () => {
  it("formats nickname with account identifier when both are meaningful", () => {
    expect(
      formatAccountDisplayLabel({
        platform: "xiaohongshu",
        displayName: "小红书品牌号",
        accountName: "小红薯3C3C3592",
        platformAccountId: "5d137ea00000000010006825",
      }),
    ).toBe("小红书品牌号（小红薯3C3C3592）");
  });

  it("ignores generic platform labels and falls back to the real identifier", () => {
    expect(
      formatAccountDisplayLabel({
        platform: "douyin",
        displayName: "抖音",
        accountName: "3141762204842788",
        platformAccountId: "3141762204842788",
      }),
    ).toBe("3141762204842788");
  });

  it("rejects publishing button text for account labels", () => {
    expect(
      resolveAccountIdentifier({
        platform: "toutiao",
        displayName: "发布文章",
        accountName: "发布文章",
        platformAccountId: "6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f",
      }),
    ).toBe("6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f");
  });

  it("rejects Weibo feed text with relative timestamps", () => {
    expect(
      formatAccountDisplayLabel({
        platform: "weibo",
        displayName: "写一封信7小时前",
        accountName: "写一封信7小时前",
      }),
    ).toBe("微博账号");
  });

  it("does not expose internal UUID fallbacks as account identifiers", () => {
    expect(
      resolveAccountIdentifier(
        {
          platform: "weibo",
          displayName: undefined,
          accountName: "微博账号",
        },
        "af858962-a00d-46ee-afbf-6ab8c5e63c23",
      ),
    ).toBe("微博账号");
  });

  it("sanitizes login profile updates before saving", () => {
    expect(
      sanitizeAccountProfileForSave(
        "toutiao",
        {
          accountName: "发布文章",
          displayName: "创作中心",
          platformAccountId: "6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f",
        },
        {
          platform: "toutiao",
          accountName: "今日头条账号",
          displayName: "今日头条",
        },
      ),
    ).toEqual({
      accountName: "6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f",
      displayName: undefined,
      platformAccountId: "6298e5be-b0f8-8ea3-ee43-f9a46ccf4c0f",
    });
  });
});
