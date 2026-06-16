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

  it("launches the external browser with the bundled extension and an isolated profile", async () => {
    const source = await readFile(new URL("../electron/main.js", import.meta.url), "utf-8");

    expect(source).toContain("function getBundledVideohaoExtensionPath()");
    expect(source).toContain("process.resourcesPath");
    expect(source).toContain("browser-extension");
    expect(source).toContain("--load-extension");
    expect(source).toContain("--disable-extensions-except");
    expect(source).toContain("--user-data-dir");
    expect(source).toContain("videohao-browser-profile");
    expect(source).toContain("openUrlInPreferredBrowser(guideUrl, { requireBundledVideohaoExtension: true })");
  });
});
