import { describe, expect, it } from "vitest";

describe("publish workbench status copy", () => {
  it("keeps publish workbench image and status copy clear", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/components/publish/publish-workbench.tsx", import.meta.url), "utf-8");

    expect(source).toContain("图文直粘模式");
    expect(source).toContain("图文混排发布");
    expect(source).toContain("本次发布内容");
    expect(source).toContain("图片预览");
  });
});
