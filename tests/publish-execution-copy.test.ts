import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("publish execution copy", () => {
  it("shows queue blocking reasons after manual run attempts", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );

    expect(source).toContain("findBlockingReason");
    expect(source).toContain("本次未执行：");
    expect(source).toContain("publishQueueReasonLabel(value)");
  });

  it("keeps long queue reasons out of the compact status column", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );

    expect(source).toContain("function queueStageLabel");
    expect(source).toContain("下次执行：");
    expect(source).not.toContain("return queueLabel(article.job.queueBlockedReason);");
  });

  it("shows account avatars before account names in publish results", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );

    expect(source).toContain("AccountIdentity");
    expect(source).toContain("account.avatarUrl");
    expect(source).toContain("<AccountIdentity");
  });

  it("keeps publish result row content vertically centered with the header", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );

    expect(source).toContain("lg:items-center ${executionTableGridClass}");
    expect(source).not.toContain("lg:items-start ${executionTableGridClass}");
  });

  it("keeps the publish result desktop table aligned when the viewport narrows", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );

    expect(source).toContain("executionTableMinWidthClass");
    expect(source).toContain("overflow-x-auto");
  });

  it("lets operators requeue articles that were manually checked as not published", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );
    const routeSource = await readFile(path.join(process.cwd(), "src", "app", "api", "publish", "execution", "route.ts"), "utf8");

    expect(source).toContain("确认未发布，重新发布");
    expect(source).toContain("markManualNotPublished");
    expect(source).toContain('action: "mark_manual_not_published"');
    expect(routeSource).toContain("mark_manual_not_published");
  });

  it("uses an in-page confirmation dialog before requeueing an article as not published", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );

    expect(source).toContain("pendingNotPublishedJobId");
    expect(source).toContain("确认未发布并重新发布");
    expect(source).toContain("确认重新发布");
    expect(source).not.toContain("window.confirm(\"确认该平台账号后台没有发布这篇文章？确认后系统会把它重新放回发布队列。\")");
  });

  it("adds a search box to filter publish results", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );

    expect(source).toContain("resultSearchQuery");
    expect(source).toContain("matchesPublishResultSearch");
    expect(source).toContain('placeholder="搜索标题、正文、平台、账号、状态"');
    expect(source).toContain('aria-label="清空发布结果搜索"');
    expect(source).toContain("filteredArticles");
    expect(source).toContain("没有匹配的发布结果，请调整搜索关键词。");
  });

  it("keeps the publish result page focused on publish results without embedded task records", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"),
      "utf8",
    );

    expect(source).not.toContain("HistoryTasksPanel");
    expect(source).not.toContain("historyTasks");
    expect(source).not.toContain("loadHistoryTasks");
    expect(source).not.toContain("/api/tasks/history");
  });
});
