import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron Baijiahao account profile extraction", () => {
  it("avoids broad name fallback paths that can capture feed text", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "main.js"), "utf8");
    const baijiahaoProbe = source.slice(source.indexOf('case "baijiahao":'), source.indexOf('case "wechat":'));

    expect(baijiahaoProbe).not.toContain('".name"');
    expect(source).toContain('!["douyin", "weibo", "baijiahao"].includes(platform)');
    expect(source).toContain('const forceProbeProfile = ["weibo", "csdn", "zhihu", "baijiahao", "douyin"].includes(platform);');
    expect(source).toContain('"https://baijiahao.baidu.com/builder/rc/settings/accountSet"');
    expect(source).toContain("\\\\u70ed\\\\u70b9\\\\u699c");
    expect(source).toContain("\\\\u5feb\\\\u6765\\\\u770b\\\\u770b");
  });
});
