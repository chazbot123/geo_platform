import { describe, expect, it } from "vitest";

describe("content item detail retry ui", () => {
  it("shows failed image reason and retries only that image", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/components/content/content-item-detail.tsx", import.meta.url), "utf-8");

    expect(source).toContain('onClick={() => void handleAction("retry_image", image.id)}');
    expect(source).toContain("错误原因");
    expect(source).toContain("重新生成这张图");
    expect(source).toContain("状态：失败");
  });
});
