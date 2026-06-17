import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("wechat publish token resolution", () => {
  it("keeps WeChat MP token navigation in Electron main instead of navigating inside the injected script", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "publish-automation", "wechat.js"), "utf8");
    const resolveStart = source.indexOf("async function resolveTokenizedEditUrl()");
    const resolveEnd = source.indexOf("async function ensurePublishPage()", resolveStart);
    const resolveBlock = source.slice(resolveStart, resolveEnd);

    expect(resolveStart).toBeGreaterThan(-1);
    expect(resolveBlock).not.toContain("window.location.href = \"https://mp.weixin.qq.com/cgi-bin/home?t=home/index\"");
    expect(resolveBlock).toContain("微信公众号发布入口缺少 token");
    expect(resolveBlock).toContain("请点击“打开创作页”确认公众号后台是否已登录");
  });

  it("lets Electron return script timeout diagnostics before the Next server aborts the local bridge request", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "lib", "publish", "server-publish-runner.ts"), "utf8");

    expect(source).toContain("const LOCAL_BRIDGE_TIMEOUT_BUFFER_MS = 45000");
    expect(source).toContain("script_timeout");
    expect(source).toContain("result.failureStage");
  });
});
