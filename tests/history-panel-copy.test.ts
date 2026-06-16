import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("history task panel copy", () => {
  it("presents task records as resumable historical tasks", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "history-tasks-panel.tsx"), "utf8");

    expect(source).toContain("任务记录");
    expect(source).toContain("本次任务问题");
    expect(source).toContain("查看内容池");
    expect(source).toContain("继续发布");
    expect(source).toContain("查看发布结果");
    expect(source).toContain("复用关键词生成");
    expect(source).toContain("/api/tasks/history/reuse");
    expect(source).toContain("hasPendingPublishWork");
    expect(source).toContain("task.links.contentPool");
    expect(source).toContain("task.links.publishExecution");
  });
});
