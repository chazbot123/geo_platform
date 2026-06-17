import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron main auto publish wiring", () => {
  it("starts and stops the auto publish scheduler with the desktop app", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "main.js"), "utf8");

    expect(source).toContain('require("./auto-publish-scheduler")');
    expect(source).toContain("createAutoPublishScheduler");
    expect(source).toContain("startAutoPublishScheduler()");
    expect(source).toContain("stopAutoPublishScheduler()");
  });

  it("keeps automatic publish windows hidden while progress is reported by session token", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "main.js"), "utf8");
    const publishWindowStart = source.indexOf("const publishWindow = createScopedWindow({");
    const publishWindowBlock = source.slice(publishWindowStart, source.indexOf("});", publishWindowStart) + 3);

    expect(publishWindowStart).toBeGreaterThan(-1);
    expect(publishWindowBlock).toContain("show: false");
    expect(source).toContain("publishProgressSessions.set(sessionToken, createProgressSnapshot(sessionToken, input.platform))");
    expect(source).toContain("getPlatformPublishProgress(input = {})");
  });

  it("suppresses native page dialogs from automatic publish windows", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "main.js"), "utf8");

    expect(source).toContain("installPageDialogSuppressor");
    expect(source).toContain("page_dialog_suppressed");
    expect(source).toContain("disableDialogs: true");
    expect(source).toContain("setWindowOpenHandler");
    expect(source).toContain("window.alert =");
    expect(source).toContain("window.confirm =");
    expect(source).toContain("window.prompt =");
  });

  it("disables native dialogs for all scoped platform windows", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "main.js"), "utf8");
    const scopedWindowStart = source.indexOf("function createScopedWindow");
    const scopedWindowBlock = source.slice(scopedWindowStart, source.indexOf("function installPageDialogSuppressor", scopedWindowStart));

    expect(scopedWindowStart).toBeGreaterThan(-1);
    expect(scopedWindowBlock).toContain("disableDialogs: true");
  });
});
