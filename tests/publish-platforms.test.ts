import { describe, expect, it } from "vitest";
import { getPlatformDescriptor } from "@/lib/publish/platforms";

describe("publish platform descriptors", () => {
  it("keeps Videohao on the external Edge-compatible image post entry", () => {
    expect(getPlatformDescriptor("videohao")?.publishEntryUrl).toBe(
      "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate",
    );
  });
});
