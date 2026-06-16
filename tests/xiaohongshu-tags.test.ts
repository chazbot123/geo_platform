import { describe, expect, it } from "vitest";
import { buildXiaohongshuNoteBody, normalizeDouyinTags, normalizeXiaohongshuTags } from "@/lib/publish/draft-builders";

describe("xiaohongshu tag normalization", () => {
  it("removes platform-blocked punctuation from topic tags", () => {
    expect(
      normalizeXiaohongshuTags([
        "AI试衣问试出来的效果准不准，先看你想判断什么",
        "#服装/穿搭",
        "  AI试衣问试出来的效果准不准?先看你想判断什么  ",
      ]),
    ).toEqual(["服装穿搭"]);
  });

  it("sanitizes existing topic markers in the xiaohongshu note body", () => {
    const body = buildXiaohongshuNoteBody("正文内容\n\n#AI试衣? #服装/穿搭", ["AI试衣?"]);

    expect(body).not.toContain("#AI试衣?");
    expect(body).not.toContain("#服装/穿搭");
    expect(body).toContain("#AI试衣");
    expect(body).toContain("#服装穿搭");
  });

  it("does not turn long search questions into xiaohongshu tags", () => {
    expect(
      normalizeXiaohongshuTags([
        "AI试衣问了三次结果都不一样到底准不准应该怎么判断是不是商家在营销",
        "#穿搭 / 试衣",
        "  智能衣柜  ",
      ]),
    ).toEqual(["穿搭试衣", "智能衣柜"]);
  });
});

describe("douyin tag normalization", () => {
  it("keeps only short cleaned topic words for douyin tags", () => {
    expect(
      normalizeDouyinTags([
        "智能网关怎么选才不会踩坑需要看哪些指标",
        "#网关 / 避坑",
        "  家庭网络  ",
      ]),
    ).toEqual(["网关避坑", "家庭网络"]);
  });
});
