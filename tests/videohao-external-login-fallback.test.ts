import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const backgroundFiles = [
  "../scripts/browser-extension/platform-login-helper/background.js",
  "../scripts/browser-extension/platform-login-helper-videohao-sync/background.js",
];

describe("videohao external login fallback", () => {
  it("does not ship the deleted videohao external-login helper page", async () => {
    const helperFiles = [
      "../src/app/external-login/videohao/page.tsx",
      "../src/app/external-login/videohao/videohao-guide-client.tsx",
    ];

    for (const filePath of helperFiles) {
      await expect(access(new URL(filePath, import.meta.url), constants.F_OK)).rejects.toThrow();
    }
  });

  it("opens the real videohao login target from Electron without the helper route", async () => {
    const source = await readFile(new URL("../electron/main.js", import.meta.url), "utf-8");

    expect(source).not.toContain("/external-login/videohao");
    expect(source).not.toContain("START_LOGIN");
    expect(source).not.toContain("guideUrl");
    expect(source).toContain("prepareVideohaoBrowserProfilePath()");
    expect(source).toContain("openUrlInPreferredBrowser(loginUrl, { requireBundledVideohaoExtension: true })");
  });

  it("does not let cookie cleanup block opening the videohao login tab", async () => {
    for (const filePath of backgroundFiles) {
      const source = await readFile(new URL(filePath, import.meta.url), "utf-8");

      expect(source).toContain("async function withTimeout(promise, timeoutMs, fallbackValue)");
      expect(source).toContain("4000");
      expect(source).toContain("const tab = await chrome.tabs.create({");
      expect(source).toContain('message: clearResult.message || ""');
    }
  });
});
