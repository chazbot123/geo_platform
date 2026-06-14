import { describe, expect, it } from "vitest";

describe("content item detail retry ui", () => {
  it("keeps retry_image action and failed image status semantics in source", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/components/content/content-item-detail.tsx", import.meta.url), "utf-8");

    expect(source).toContain('type ItemAction = "rewrite" | "confirm_medium" | "disperse" | "update_image_count" | "retry_image";');
    expect(source).toContain('onClick={() => void handleAction("retry_image", image.id)}');
    expect(source).toContain('重试这张');
    expect(source).toContain('状态：失败');
  });
});
