import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("content pool page copy", () => {
  it("uses the concise generation result name consistently", async () => {
    const pageSource = await readFile(path.join(process.cwd(), "src", "app", "content-pool", "page.tsx"), "utf8");
    const workbenchSource = await readFile(path.join(process.cwd(), "src", "components", "content", "content-pool.tsx"), "utf8");

    expect(pageSource).toContain('title="生成结果"');
    expect(pageSource).not.toContain("生成结果中心");
    expect(workbenchSource).toContain("生成结果");
    expect(workbenchSource).not.toContain("生成结果中心");
  });

  it("shows submitted and pending-review articles as separate non-pending-publish states", async () => {
    const workbenchSource = await readFile(path.join(process.cwd(), "src", "components", "content", "content-pool.tsx"), "utf8");
    const progressSource = workbenchSource.match(/function progressPercent[\s\S]*?\r?\n}\r?\n/)?.[0] ?? "";

    expect(workbenchSource).toContain('submitted: "已提交待确认"');
    expect(workbenchSource).toContain('pending_review: "平台审核中"');
    expect(workbenchSource).toContain('"submitted", "pending_review"');
    expect(progressSource).toContain('item.status === "submitted"');
    expect(progressSource).toContain('item.status === "pending_review"');
  });

  it("shows account avatars before account names in generation results", async () => {
    const workbenchSource = await readFile(path.join(process.cwd(), "src", "components", "content", "content-pool.tsx"), "utf8");

    expect(workbenchSource).toContain("AccountIdentity");
    expect(workbenchSource).toContain('fetch("/api/publish/accounts"');
    expect(workbenchSource).toContain("accountsById");
  });

  it("keeps the generation result desktop table aligned when the viewport narrows", async () => {
    const workbenchSource = await readFile(path.join(process.cwd(), "src", "components", "content", "content-pool.tsx"), "utf8");

    expect(workbenchSource).toContain("articleTableMinWidthClass");
    expect(workbenchSource).toContain("overflow-x-auto");
  });

  it("adds a search box to filter generation results", async () => {
    const workbenchSource = await readFile(path.join(process.cwd(), "src", "components", "content", "content-pool.tsx"), "utf8");

    expect(workbenchSource).toContain("resultSearchQuery");
    expect(workbenchSource).toContain("matchesGenerationResultSearch");
    expect(workbenchSource).toContain('placeholder="搜索标题、摘要、关键词、平台、账号"');
    expect(workbenchSource).toContain('aria-label="清空生成结果搜索"');
    expect(workbenchSource).toContain("searchFilteredItems");
    expect(workbenchSource).toContain("没有匹配的生成结果，请调整搜索关键词或筛选条件。");
  });
});
