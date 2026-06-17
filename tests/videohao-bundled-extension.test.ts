import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("videohao bundled browser extension", () => {
  it("packages the videohao sync extension as an Electron extra resource", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8")) as {
      build?: { extraResources?: Array<{ from?: string; to?: string }> };
    };

    expect(packageJson.build?.extraResources).toContainEqual({
      from: "scripts/browser-extension/platform-login-helper-videohao-sync",
      to: "browser-extension/platform-login-helper-videohao-sync",
    });
  });

  it("launches the external browser with the bundled extension and a backend-prepared isolated profile", async () => {
    const source = await readFile(new URL("../electron/main.js", import.meta.url), "utf-8");

    expect(source).toContain("function getBundledVideohaoExtensionPath()");
    expect(source).toContain("function prepareVideohaoBrowserProfilePath()");
    expect(source).toContain("process.resourcesPath");
    expect(source).toContain("browser-extension");
    expect(source).toContain("--load-extension");
    expect(source).toContain("--disable-extensions-except");
    expect(source).toContain("--user-data-dir");
    expect(source).toContain("videohao-browser-profile");
    expect(source).toContain("openUrlInPreferredBrowser(loginUrl, { requireBundledVideohaoExtension: true })");
    expect(source).not.toContain("const guideUrl = loginUrl");
  });

  it("reuses videohao account profile selectors in the bundled extension sync payload", async () => {
    const contentSource = await readFile(
      new URL("../scripts/browser-extension/platform-login-helper-videohao-sync/content.js", import.meta.url),
      "utf-8",
    );
    const backgroundSource = await readFile(
      new URL("../scripts/browser-extension/platform-login-helper-videohao-sync/background.js", import.meta.url),
      "utf-8",
    );

    expect(contentSource).toContain(".finder-nickname");
    expect(contentSource).toContain("img.avatar[alt*='视频号头像']");
    expect(contentSource).toContain("a[href*='channels.weixin.qq.com']");
    expect(contentSource).toContain("platformAccountId");
    expect(backgroundSource).toContain("const platformAccountId = String(context?.platformAccountId || \"\").trim();");
    expect(backgroundSource).toContain("platformAccountId,");
  });

  it("does not bundle local debug collectors with the videohao browser extension", async () => {
    const contentSource = await readFile(
      new URL("../scripts/browser-extension/platform-login-helper-videohao-sync/content.js", import.meta.url),
      "utf-8",
    );
    const backgroundSource = await readFile(
      new URL("../scripts/browser-extension/platform-login-helper-videohao-sync/background.js", import.meta.url),
      "utf-8",
    );

    for (const source of [contentSource, backgroundSource]) {
      expect(source).not.toContain("debug-point");
      expect(source).not.toContain("127.0.0.1:7777");
      expect(source).not.toContain("[DEBUG]");
    }
  });
});
