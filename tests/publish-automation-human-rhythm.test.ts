import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const primaryScript = path.join(
  process.cwd(),
  "scripts/browser-extension/platform-login-helper/publish-automation.js",
);

const videohaoSyncScript = path.join(
  process.cwd(),
  "scripts/browser-extension/platform-login-helper-videohao-sync/publish-automation.js",
);

describe("publish automation human rhythm helpers", () => {
  it("keeps the primary and videohao-sync publish automation scripts in sync", async () => {
    const [primary, synced] = await Promise.all([
      readFile(primaryScript, "utf8"),
      readFile(videohaoSyncScript, "utf8"),
    ]);

    expect(synced).toBe(primary);
  });

  it("routes publish automation through shared mouse, scroll, and typing rhythm helpers", async () => {
    const source = await readFile(primaryScript, "utf8");

    expect(source).toContain("async function humanScrollElementIntoView");
    expect(source).toContain("async function moveMouseAlongPath");
    expect(source).toContain("function resolveTypingDelay");
    expect(source).toContain("await humanScrollElementIntoView(node, options)");
    expect(source).toContain("await moveMouseAlongPath(node, clientX, clientY, options)");
    expect(source).toContain("await sleep(resolveTypingDelay(char, index, normalized, minDelay, maxDelay))");
  });

  it("sanitizes xiaohongshu topic tags before typing them into the editor", async () => {
    const source = await readFile(primaryScript, "utf8");

    expect(source).toContain("function sanitizeTopicTag");
    expect(source).toContain("sanitizeTopicTag(tag)");
    expect(source).toContain("replace(/[^\\p{Script=Han}\\p{Letter}\\p{Number}]+/gu, \"\")");
  });
});
