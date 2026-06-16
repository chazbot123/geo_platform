import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("CSDN login state detection", () => {
  it("treats CSDN as logged in only after the editor page is reachable", async () => {
    const source = await readFile(new URL("../electron/main.js", import.meta.url), "utf-8");
    const csdnCase = source.match(/case "csdn":[\s\S]*?default:/)?.[0] ?? "";

    expect(csdnCase).toContain("requiresAuthenticatedMarker: true");
    expect(csdnCase).toContain('authenticatedPageUrlHints: ["editor.csdn.net"]');
    expect(csdnCase).toContain("#txtTitle");
    expect(csdnCase).toContain("textarea.editor");
    expect(csdnCase).toContain(".CodeMirror");
    expect(csdnCase).not.toContain('authenticatedPageSelectors: ["input"');
    expect(csdnCase).not.toContain(".toolbar-avatar");
    expect(csdnCase).not.toContain(".toolbar-btn-name");
    expect(csdnCase).not.toContain("authenticatedSelectors");
    expect(source).toContain("hasAuthenticatedPage");
    expect(source).toContain("spec.requiresAuthenticatedMarker");
    expect(source).toContain("inspection?.hasAuthenticatedMarker && !inspection?.matchedUrlHint && !inspection?.matchedTextHint");
  });
});
