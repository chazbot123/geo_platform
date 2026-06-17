import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Videohao external-browser session partition quarantine", () => {
  it("does not keep Electron session partitions for Videohao extension cookie accounts", async () => {
    const syncRoute = await readFile(
      new URL("../src/app/api/publishing/platform-accounts/extension-login/sync/route.ts", import.meta.url),
      "utf-8",
    );
    const loginRoute = await readFile(new URL("../src/app/api/publish/accounts/login/route.ts", import.meta.url), "utf-8");
    const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf-8");

    expect(syncRoute).toContain('platform === "videohao" ? undefined : existing?.sessionPartition');
    expect(loginRoute).toContain('platform !== "videohao" && !account.sessionPartition');
    expect(loginRoute).toContain('sessionPartition: platform === "videohao" ? undefined : nextAccount.sessionPartition');
    expect(packageJson).toContain('"dist": "npm run dist:app"');
    expect(packageJson).not.toContain('"dist": "npm run build:web && npm run dist:app"');
  });

  it("keeps stale Videohao extension cookie partitions out of every Electron audit path", async () => {
    const electronMain = await readFile(new URL("../electron/main.js", import.meta.url), "utf-8");
    const accountsService = await readFile(new URL("../src/lib/publish/accounts-service.ts", import.meta.url), "utf-8");

    expect(electronMain).toContain("isVideohaoExtensionCookieAccount");
    expect(electronMain).toContain("!isVideohaoExtensionCookieAccount(account)");
    expect(accountsService).toContain("getAccountSessionPartitionForPatch");
    expect(accountsService).toContain('account.platform === "videohao"');
    expect(accountsService).toContain('account.authType === "cookie"');
    expect(accountsService).toContain('account.source === "browser_extension"');
    expect(accountsService).toContain("sessionPartition: getAccountSessionPartitionForPatch(current)");
  });

  it("quarantines stale Videohao Electron partitions before Chromium opens session data", async () => {
    const electronMain = await readFile(new URL("../electron/main.js", import.meta.url), "utf-8");

    const quarantineIndex = electronMain.indexOf("quarantineStaleVideohaoSessionPartitions");
    const setSessionDataIndex = electronMain.indexOf('app.setPath("sessionData", sessionDataPath)');

    expect(quarantineIndex).toBeGreaterThanOrEqual(0);
    expect(setSessionDataIndex).toBeGreaterThan(quarantineIndex);
    expect(electronMain).toContain("videohao-session-quarantine");
    expect(electronMain).toContain("geo-platform-");
  });

  it("launches the external Videohao browser without waiting for the browser process to exit", async () => {
    const electronMain = await readFile(new URL("../electron/main.js", import.meta.url), "utf-8");

    expect(electronMain).toContain("spawn(browserExecutable");
    expect(electronMain).toContain("detached: true");
    expect(electronMain).toContain("child.unref()");
    expect(electronMain).not.toContain("execFile(browserExecutable, browserArgs");
  });
});
