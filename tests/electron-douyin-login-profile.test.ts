import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const electronMain = path.join(process.cwd(), "electron", "main.js");

describe("Electron Douyin login and profile extraction", () => {
  it("treats Douyin creator pages as authenticated markers so login windows can finish promptly", async () => {
    const source = await readFile(electronMain, "utf8");
    const sessionSpec = source.slice(source.indexOf('case "douyin":'), source.indexOf('case "xiaohongshu":'));

    expect(sessionSpec).toContain('authenticatedPageUrlHints: ["creator.douyin.com/creator-micro"]');
    expect(sessionSpec).toContain("\"[class*='semi-navigation']\"");
    expect(sessionSpec).toContain("\"[class*='semi-avatar']\"");
  });

  it("forces Douyin profile probing and requires a display name before accepting the probe", async () => {
    const source = await readFile(electronMain, "utf8");

    expect(source).toContain('const forceProbeProfile = ["weibo", "csdn", "zhihu", "baijiahao", "douyin"].includes(platform);');
    expect(source).toContain('const initialProfileTimeoutMs = platform === "douyin" ? 5000 : 12000;');
    expect(source).toContain('const probeLoadTimeoutMs = platform === "douyin" ? 8000 : 20000;');
    expect(source).toContain('const probeExtractTimeoutMs = platform === "douyin" ? 3500 : 5000;');
    expect(source).toContain('const isDouyinProfileProbe = platform === "douyin";');
    expect(source).toContain("isDouyinProfileProbe");
    expect(source).toContain('"https://creator.douyin.com/"');
  });

  it("does not accept generic Douyin account placeholders as meaningful profile text", async () => {
    const source = await readFile(electronMain, "utf8");

    expect(source).toContain('"抖音账号"');
    expect(source).toContain("douyin[-_]?account");
    expect(source).toContain('["高清发布", "立即发布", "定时发布", "发布设置", "活动管理", "抖音账号"]');
  });
});
