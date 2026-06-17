import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("history task panel dialogs", () => {
  it("uses an in-page error dialog instead of native alert", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "history-tasks-panel.tsx"), "utf8");

    expect(source).toContain("historyErrorMessage");
    expect(source).toContain("历史任务操作失败");
    expect(source).toContain("知道了");
    expect(source).not.toContain("window.alert");
  });
});
