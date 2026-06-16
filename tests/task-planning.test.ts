import { describe, expect, it } from "vitest";
import {
  calculatePublishTaskTotal,
  ARTICLES_PER_ACCOUNT_PER_DAY,
  MIN_PUBLISH_DAYS,
  normalizePublishTaskPlan,
} from "@/lib/tasks/service";
import { getPlatformsBySearchProvider, providerPublishMatrix } from "@/lib/publish/provider-platform-matrix";

describe("publish task planning", () => {
  it("uses account count x normalized days x two articles per day", () => {
    expect(
      calculatePublishTaskTotal(
        [
          { enabled: true, accountCount: 2 },
          { enabled: false, accountCount: 99 },
          { enabled: true, accountCount: 1 },
        ],
        3,
      ),
    ).toBe((2 + 1) * 3 * ARTICLES_PER_ACCOUNT_PER_DAY);

    expect(calculatePublishTaskTotal([{ enabled: true, accountCount: 2 }], 0)).toBe(
      2 * MIN_PUBLISH_DAYS * ARTICLES_PER_ACCOUNT_PER_DAY,
    );

    expect(calculatePublishTaskTotal([{ enabled: true, accountCount: 2 }], 7)).toBe(2 * 7 * 2);
  });

  it("keeps the default provider to publish platform matrix constrained", () => {
    expect(providerPublishMatrix.doubao.platforms).toEqual(["douyin", "baijiahao", "toutiao"]);
    expect(providerPublishMatrix.deepseek.platforms).toEqual(["csdn", "zhihu"]);
    expect(providerPublishMatrix.yuanbao.platforms).toEqual(["wechat", "videohao"]);
    expect(providerPublishMatrix.tongyi.platforms).toEqual(["weibo", "xiaohongshu"]);
    expect(getPlatformsBySearchProvider("doubao")).not.toContain("xiaohongshu");
  });

  it("sanitizes legacy publish plans to the selected provider mapping", () => {
    const normalized = normalizePublishTaskPlan({
      taskId: "task-1",
      enterpriseTaskId: "enterprise-1",
      keywordTaskId: "keyword-1",
      searchProvider: "doubao",
      enabledPlatforms: [
        {
          platform: "toutiao",
          enabled: true,
          accountCount: 99,
          accountIds: ["acc-1", "acc-2"],
          articleCount: 999,
          detectionAt: "2026-06-12T00:00:00.000Z",
        },
        {
          platform: "xiaohongshu",
          enabled: true,
          accountCount: 1,
          accountIds: ["xhs-1"],
          articleCount: 6,
          detectionAt: "2026-06-12T00:00:00.000Z",
        },
      ],
      days: 2,
      articlesPerAccountPerDay: 2,
      timeWindow: { start: "09:00", end: "18:00" },
      minSameAccountIntervalHours: 3,
      totalAccountCount: 100,
      totalArticleCount: 1000,
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
    });

    const toutiaoPlan = normalized.enabledPlatforms.find((item) => item.platform === "toutiao");
    const xiaohongshuPlan = normalized.enabledPlatforms.find((item) => item.platform === "xiaohongshu");

    expect(toutiaoPlan).toMatchObject({
      enabled: true,
      accountCount: 2,
      accountIds: ["acc-1", "acc-2"],
      articleCount: 8,
    });
    expect(xiaohongshuPlan).toMatchObject({
      enabled: false,
      accountCount: 0,
      accountIds: [],
      articleCount: 0,
    });
    expect(normalized.totalAccountCount).toBe(2);
    expect(normalized.totalArticleCount).toBe(8);
    expect(normalized.enabledPlatforms).toHaveLength(9);
  });

  it("normalizes multi-provider publish plans without dropping selected provider platforms", () => {
    const normalized = normalizePublishTaskPlan({
      taskId: "task-multi",
      enterpriseTaskId: "enterprise-multi",
      keywordTaskId: "keyword-multi",
      searchProvider: "doubao",
      searchProviders: ["doubao", "deepseek"],
      enabledPlatforms: [
        {
          platform: "douyin",
          searchProvider: "doubao",
          enabled: true,
          accountCount: 1,
          accountIds: ["douyin-1"],
          articleCount: 1,
        },
        {
          platform: "csdn",
          searchProvider: "deepseek",
          enabled: true,
          accountCount: 2,
          accountIds: ["csdn-1", "csdn-2"],
          articleCount: 2,
        },
        {
          platform: "xiaohongshu",
          enabled: true,
          accountCount: 1,
          accountIds: ["xhs-1"],
          articleCount: 1,
        },
      ],
      days: 1,
      articlesPerAccountPerDay: 1,
      timeWindow: { start: "09:00", end: "18:00" },
      minSameAccountIntervalHours: 3,
      totalAccountCount: 99,
      totalArticleCount: 99,
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
    });

    const douyinPlan = normalized.enabledPlatforms.find((item) => item.platform === "douyin");
    const csdnPlan = normalized.enabledPlatforms.find((item) => item.platform === "csdn");
    const xhsPlan = normalized.enabledPlatforms.find((item) => item.platform === "xiaohongshu");

    expect(normalized.searchProviders).toEqual(["doubao", "deepseek"]);
    expect(douyinPlan).toMatchObject({ enabled: true, searchProvider: "doubao", accountCount: 1, articleCount: 1 });
    expect(csdnPlan).toMatchObject({ enabled: true, searchProvider: "deepseek", accountCount: 2, articleCount: 2 });
    expect(xhsPlan).toMatchObject({ enabled: false, accountCount: 0, accountIds: [], articleCount: 0 });
    expect(normalized.totalAccountCount).toBe(3);
    expect(normalized.totalArticleCount).toBe(3);
  });

  it("uses task-scoped account totals when normalizing saved plans", () => {
    const normalized = normalizePublishTaskPlan({
      taskId: "task-2",
      enterpriseTaskId: "enterprise-2",
      keywordTaskId: "keyword-2",
      searchProvider: "doubao",
      enabledPlatforms: [
        {
          platform: "toutiao",
          enabled: true,
          accountCount: 2,
          accountIds: ["acc-1", "acc-2"],
          articleCount: 2,
          detectionAt: "2026-06-12T00:00:00.000Z",
        },
      ],
      days: 3,
      articlesPerAccountPerDay: 1,
      timeWindow: { start: "09:00", end: "18:00" },
      minSameAccountIntervalHours: 3,
      totalAccountCount: 4,
      totalArticleCount: 12,
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
    });

    expect(normalized.totalAccountCount).toBe(2);
    expect(normalized.totalArticleCount).toBe(6);
  });
});
