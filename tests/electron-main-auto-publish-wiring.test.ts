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
});
