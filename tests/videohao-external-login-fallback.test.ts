import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const backgroundFiles = [
  "../scripts/browser-extension/platform-login-helper/background.js",
  "../scripts/browser-extension/platform-login-helper-videohao-sync/background.js",
];

describe("videohao external login fallback", () => {
  it("opens the real login page if the extension does not respond to the guide page", async () => {
    const source = await readFile(
      new URL("../src/app/external-login/videohao/videohao-guide-client.tsx", import.meta.url),
      "utf-8",
    );

    expect(source).toContain("function openLoginPage(reason: string)");
    expect(source).toContain('window.open(manualLoginUrl, "_blank", "noopener,noreferrer")');
    expect(source).toContain("未收到扩展响应，已直接打开视频号登录页。请完成扫码登录后返回 GEO。");
  });

  it("does not let cookie cleanup block opening the videohao login tab", async () => {
    for (const filePath of backgroundFiles) {
      const source = await readFile(new URL(filePath, import.meta.url), "utf-8");

      expect(source).toContain("async function withTimeout(promise, timeoutMs, fallbackValue)");
      expect(source).toContain("4000");
      expect(source).toContain("清理旧登录态超时，已继续打开视频号登录页。");
      expect(source).toContain("清理旧登录态失败，已继续打开视频号登录页。");
      expect(source).toContain("const tab = await chrome.tabs.create({");
      expect(source).toContain("message: clearResult.message || \"\"");
    }
  });
});
