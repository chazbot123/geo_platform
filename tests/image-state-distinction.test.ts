import { describe, expect, it } from "vitest";

describe("image state distinction copy", () => {
  it("keeps content item detail copy for failed and generated images", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/components/content/content-item-detail.tsx", import.meta.url), "utf-8");

    expect(source).toContain("生成失败");
    expect(source).toContain("状态：失败");
    expect(source).toContain("状态：已生成");
    expect(source).toContain("目标图片数量：");
  });

  it("shows generated image thumbnails without cropping the clicked source", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/components/content/content-item-detail.tsx", import.meta.url), "utf-8");

    expect(source).toContain("aspect-square w-full object-contain");
    expect(source).not.toContain("h-24 w-full object-cover");
  });

  it("keeps preview and workbench copy for success, failed and no-image states", async () => {
    const { readFile } = await import("node:fs/promises");
    const preview = await readFile(new URL("../src/components/preview/preview-panel.tsx", import.meta.url), "utf-8");
    const workbench = await readFile(new URL("../src/components/content/report-workbench.tsx", import.meta.url), "utf-8");

    expect(preview).toContain("当前成功生成");
    expect(preview).toContain("失败待处理");
    expect(preview).toContain("暂无视觉素材");

    expect(workbench).toContain("当前成功生成");
    expect(workbench).toContain("失败待处理");
    expect(workbench).toContain("已确认纯文本模式");
  });
});
