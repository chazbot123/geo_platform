import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("help center page", () => {
  it("contains the GEO operation manual sections", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "app", "help", "page.tsx"), "utf8");

    expect(source).toContain("GEO 操作手册");
    expect(source).toContain("首次使用准备");
    expect(source).toContain("图片失败与重新生成");
    expect(source).toContain("发布结果与静默自动发布");
    expect(source).toContain("账号登录失效、风控与人工确认");
  });
});
