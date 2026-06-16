import { describe, expect, it } from "vitest";
import { getPlatformContentRule, normalizePlatformTopicTags } from "@/lib/content/platform-content-rules";

describe("platform content rules", () => {
  it("returns reusable generation and preflight limits for supported platforms", () => {
    const xiaohongshu = getPlatformContentRule("xiaohongshu");
    const douyin = getPlatformContentRule("douyin");
    const videohao = getPlatformContentRule("videohao");
    const wechat = getPlatformContentRule("wechat");
    const fallback = getPlatformContentRule("unknown-platform");

    expect(xiaohongshu).toMatchObject({
      platform: "xiaohongshu",
      label: "小红书",
      title: { maxLength: 20 },
      body: { hardMaxLength: 1000 },
      topicTags: { maxCount: 8, maxLength: 20 },
    });
    expect(douyin).toMatchObject({
      platform: "douyin",
      label: "抖音",
      title: { maxLength: 24 },
      topicTags: { maxCount: 5 },
    });
    expect(videohao).toMatchObject({
      platform: "videohao",
      label: "视频号",
      title: { maxLength: 24 },
      topicTags: { maxCount: 5 },
    });
    expect(wechat).toMatchObject({
      platform: "wechat",
      label: "微信公众号",
      title: { maxLength: 64 },
      topicTags: { maxCount: 6 },
    });
    expect(fallback).toMatchObject({
      platform: "default",
      label: "公众号/默认",
      title: { maxLength: 64 },
    });

    expect(xiaohongshu.stylePrompt).toContain("真实体验");
    expect(xiaohongshu.publishRiskTips).toEqual(expect.arrayContaining([expect.stringContaining("极限承诺")]));
    expect(wechat.compliancePrompt).toContain("不要承诺确定性排名");
  });

  it("cleans punctuation, deduplicates and limits topic tags by platform", () => {
    const tags = normalizePlatformTopicTags(
      ["#GEO优化/服务商", " GEO优化 服务商 ", "小红书?标签!", "@账号", "https://example.com/path"],
      "xiaohongshu",
    );

    expect(tags).toEqual(["GEO优化服务商", "小红书标签"]);
    expect(tags.every((tag) => !/[#/@?!！\s]/u.test(tag))).toBe(true);
    expect(tags.every((tag) => tag.length <= getPlatformContentRule("xiaohongshu").topicTags.maxLength)).toBe(true);
  });

  it("splits a long customer question into short searchable tags instead of using it directly", () => {
    const question = "客户问：北京企业做GEO优化怎么判断服务商是否靠谱？需要看哪些案例和风险？";

    const tags = normalizePlatformTopicTags([question, "GEO优化"], "douyin");

    expect(tags).toContain("北京企业");
    expect(tags).toContain("GEO优化");
    expect(tags).toContain("服务商靠谱");
    expect(tags).toContain("案例风险");
    expect(tags).not.toContain(question);
    expect(tags.length).toBeLessThanOrEqual(getPlatformContentRule("douyin").topicTags.maxCount);
  });
});
