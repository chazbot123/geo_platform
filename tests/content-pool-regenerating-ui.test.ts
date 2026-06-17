import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const poolSource = new URL("../src/components/content/content-pool.tsx", import.meta.url);
const detailSource = new URL("../src/components/content/content-item-detail.tsx", import.meta.url);

describe("content pool regenerating image ui", () => {
  it("keeps retry-all failed image progress visible after navigation", async () => {
    const source = await readFile(poolSource, "utf-8");

    expect(source).toContain("regeneratingImageTotal");
    expect(source).toContain("retry_all_failed_images_async");
    expect(source).toContain("正在重生失败图片");
    expect(source).toContain("item.imageList.some((image) => image.status === \"regenerating\")");
  });

  it("shows regenerating image cards in article detail and auto-refreshes them", async () => {
    const source = await readFile(detailSource, "utf-8");

    expect(source).toContain("regeneratingImages");
    expect(source).toContain("image.status === \"regenerating\"");
    expect(source).toContain("正在重新生成");
    expect(source).toContain("hasRegeneratingImages");
  });
});
