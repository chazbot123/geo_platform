import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("customer keyword loading interaction lock", () => {
  it("locks candidate selection and saving while generation is running", async () => {
    const source = await readFile(
      new URL("../src/components/keywords/customer-keyword-workbench.tsx", import.meta.url),
      "utf-8",
    );

    expect(source).toContain("const isInteractionLocked = generating || saving;");
    expect(source).toContain("const keywordStale = Boolean(data.keywordSet?.staleAt);");
    expect(source).toContain("if (isInteractionLocked || keywordStale) return;");
    expect(source).toContain("disabled={isInteractionLocked || keywordStale}");
    expect(source).toContain("disabled={!hasExactSelection || saving || generating || keywordStale}");
    expect(source).toContain("企业信息已变更，当前客户关键词已过期。");
    expect(source).toContain("生成期间暂不可选择，完成后会刷新候选列表。");
  });
});
