import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("history task panel copy", () => {
  it("does not show the top-level create-or-continue planning action on history tasks", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "task-center.tsx"), "utf8");

    expect(source).not.toContain("新建或继续规划");
    expect(source).not.toContain('href="/tasks/create"');
  });

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

  it("shows task questions compactly by default and can expand the full list", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "history-tasks-panel.tsx"), "utf8");

    expect(source).not.toContain('join(" / ")');
    expect(source).toContain("expandedQuestionTaskId");
    expect(source).toContain("visibleQuestions.map");
    expect(source).toContain('aria-label="展开查看全部关键词"');
    expect(source).toContain('title="展开查看全部关键词"');
    expect(source).not.toContain('{expanded ? "收起" : `展开全部');
    expect(source).toContain("收起");
  });

  it("uses readable equal-width question grid items instead of tiny chips", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "history-tasks-panel.tsx"), "utf8");
    const questionBlock = source.match(/<div className="mt-3 text-sm leading-6 text-ink"[\s\S]*?<p className="mt-1 text-muted">/)?.[0] ?? "";

    expect(questionBlock).toContain("text-sm");
    expect(questionBlock).toContain("leading-6");
    expect(questionBlock).toContain("grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3");
    expect(questionBlock).not.toContain("grid gap-1.5");
    expect(questionBlock).not.toContain("flex-1");
    expect(questionBlock).not.toContain("max-w-[520px]");
    expect(questionBlock).not.toContain("text-[11px]");
    expect(questionBlock).not.toContain("rounded-full bg-surface px-2.5 py-1 text-[11px]");
  });

  it("places collapse in the question header and lightweight expand in the grid", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "history-tasks-panel.tsx"), "utf8");
    const questionHeader = source.match(/<div className="mt-3 text-sm leading-6 text-ink"[\s\S]*?<\/div>/)?.[0] ?? "";
    const questionList = source.match(/<div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"[\s\S]*?<\/div>\s*\)\s*:\s*\(/)?.[0] ?? "";

    expect(questionHeader).toContain("items-center gap-2");
    expect(questionHeader).not.toContain("justify-between");
    expect(questionHeader).toContain("收起");
    expect(questionList).toContain("...");
    expect(questionList).toContain('aria-label="展开查看全部关键词"');
    expect(questionList).not.toContain('{expanded ? "收起" : `展开全部');
    expect(questionList).not.toContain("收起");
  });

  it("places a lightweight ellipsis button after hidden compact questions", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "history-tasks-panel.tsx"), "utf8");
    const questionBlock = source.match(/<div className="mt-3 text-sm leading-6 text-ink"[\s\S]*?<p className="mt-1 text-muted">/)?.[0] ?? "";

    expect(questionBlock).toContain('aria-label="展开查看全部关键词"');
    expect(questionBlock).toContain('title="展开查看全部关键词"');
    expect(questionBlock).toContain("...");
    expect(questionBlock).not.toContain('{expanded ? "收起" : `展开全部');
  });

  it("adds search, filters, pagination and reset controls for large history lists", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "history-tasks-panel.tsx"), "utf8");

    expect(source).toContain("const historyPageSize = 10");
    expect(source).toContain("searchQuery");
    expect(source).toContain("statusFilter");
    expect(source).toContain('placeholder="搜索任务名称、企业、产品、关键词"');
    expect(source).toContain("全部");
    expect(source).toContain("当前任务");
    expect(source).toContain("历史任务");
    expect(source).toContain("有待发布");
    expect(source).toContain("有人工处理");
    expect(source).toContain("已发布");
    expect(source).toContain("清空筛选");
    expect(source).toContain("filteredTasks.length");
    expect(source).toContain("pagedTasks");
    expect(source).toContain("上一页");
    expect(source).toContain("下一页");
  });
});
