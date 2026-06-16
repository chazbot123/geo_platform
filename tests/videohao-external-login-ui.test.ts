import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("videohao external login task UI", () => {
  it("shows the pending external-browser login account before extension sync completes", async () => {
    const source = await readFile(new URL("../src/components/tasks/task-planning-workbench.tsx", import.meta.url), "utf-8");

    expect(source).toContain('function isPendingExternalLoginAccount(account: PlatformAccountRecord)');
    expect(source).toContain('account.platform === "videohao" && account.loginStatus === "pending" && Boolean(account.loginSessionToken)');
    expect(source).toContain('await loadAccounts();');
    expect(source).toContain('setSelectedPlatform(platform);');
    expect(source).toContain("已打开外部浏览器，扫码登录后会自动回写到这里。");
  });

  it("does not auto-audit extension cookie accounts through the Electron session checker", async () => {
    const source = await readFile(new URL("../src/components/tasks/task-planning-workbench.tsx", import.meta.url), "utf-8");

    expect(source).toContain('account.authType !== "cookie"');
    expect(source).toContain("!account.authPayload");
    expect(source).toContain('requestIdleCallback(run, { timeout: 3000 })');
  });
});
