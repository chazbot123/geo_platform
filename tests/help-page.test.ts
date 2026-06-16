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

  it("keeps compliance and platform update guidance visible", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "app", "help", "page.tsx"), "utf8");

    expect(source).toContain("内容合规与禁止事项");
    expect(source).toContain("禁止 AI 投毒");
    expect(source).toContain("禁止虚假宣传");
    expect(source).toContain("黑五类");
    expect(source).toContain("宗教");
    expect(source).toContain("平台规则与产品持续更新");
    expect(source).toContain("持续迭代");
    expect(source).toContain("动态更新程序");
  });
});
