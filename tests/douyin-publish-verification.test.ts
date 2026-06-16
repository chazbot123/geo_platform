import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const douyinAutomationScript = path.join(
  process.cwd(),
  "electron/publish-automation/douyin.js",
);

describe("douyin publish verification", () => {
  it("verifies the submitted work in Douyin creator management before reporting the final status", async () => {
    const source = await readFile(douyinAutomationScript, "utf8");

    expect(source).toContain("async function openManagePage");
    expect(source).toContain("async function verifyPublishedItem");
    expect(source).toContain("const submitResult = await submit()");
    expect(source).toContain("const manageUrl = await openManagePage()");
    expect(source).toContain("const verificationResult = await verifyPublishedItem(manageUrl, submitResult)");
    expect(source).toContain("douyin_list_title_match");
    expect(source).toContain("submitted_no_match");
  });
});
