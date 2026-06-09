import { describe, expect, it } from "vitest";
import { calculatePublishTaskTotal, ARTICLES_PER_ACCOUNT_PER_DAY, MIN_PUBLISH_DAYS } from "@/lib/tasks/service";
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
    ).toBe((2 + 1) * MIN_PUBLISH_DAYS * ARTICLES_PER_ACCOUNT_PER_DAY);

    expect(calculatePublishTaskTotal([{ enabled: true, accountCount: 2 }], 7)).toBe(2 * 7 * 2);
  });

  it("keeps the default provider to publish platform matrix constrained", () => {
    expect(providerPublishMatrix.doubao.platforms).toEqual(["toutiao", "baijiahao", "douyin"]);
    expect(providerPublishMatrix.deepseek.platforms).toEqual(["csdn", "zhihu"]);
    expect(providerPublishMatrix.yuanbao.platforms).toEqual(["wechat", "videohao"]);
    expect(providerPublishMatrix.tongyi.platforms).toEqual(["zhihu", "weibo", "xiaohongshu"]);
    expect(getPlatformsBySearchProvider("doubao")).not.toContain("xiaohongshu");
  });
});
