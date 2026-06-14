import { describe, expect, it } from "vitest";

describe("image status copy", () => {
  it("keeps report workbench and preview copy for partial image failures", async () => {
    const { readFile } = await import("node:fs/promises");
    const reportWorkbench = await readFile(new URL("../src/components/content/report-workbench.tsx", import.meta.url), "utf-8");
    const previewPanel = await readFile(new URL("../src/components/preview/preview-panel.tsx", import.meta.url), "utf-8");

    expect(reportWorkbench).toContain("本次图片数量");
    expect(reportWorkbench).toContain("当前成功生成 {generatedImageCount} 张文章配图");
    expect(reportWorkbench).toContain("失败待处理");

    expect(previewPanel).toContain("图片数量");
    expect(previewPanel).toContain("当前成功生成 {generatedImageCount} 张文章配图");
    expect(previewPanel).toContain("单独补生成");
  });
});
