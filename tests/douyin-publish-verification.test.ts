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

  it("does not treat the Douyin image publish editor as a verified published work", async () => {
    const source = await readFile(douyinAutomationScript, "utf8");

    expect(source).toContain("function isPublishEditorPage");
    expect(source).toContain("if (isPublishEditorPage()) return false;");
    expect(source).toContain("if (isPublishEditorPage()) return [];");
    expect(source).not.toContain("draftTitleNeedles.some((item) => item && pg.includes(item)) && bodyNeedles.some((item) => item && pg.includes(item))");
    expect(source).toContain('return ["aweme_id=", "item_id=", "itemId=", "/detail/", "/work/"].some');
  });

  it("does not treat risk wording inside the draft body as a platform blocking alert", async () => {
    const source = await readFile(douyinAutomationScript, "utf8");

    expect(source).toContain("function findPlatformBlockingHint");
    expect(source).not.toContain('const blockingHint = ["验证码", "扫码", "登录", "风险"');
    expect(source).toContain('const blockingHint = findPlatformBlockingHint();');
    expect(source).toContain("platformBlockingSelectors");
    expect(source).toContain("账号风险");
    expect(source).toContain("发布风险");
  });

  it("clicks the final Douyin publish action instead of broad page text matches", async () => {
    const source = await readFile(douyinAutomationScript, "utf8");

    expect(source).toContain("function findDouyinPublishButton");
    expect(source).toContain("function findDouyinConfirmPublishButton");
    expect(source).toContain("async function driveDouyinSubmitFlow");
    expect(source).toContain("高清发布");
    expect(source).toContain("确认发布");
    expect(source).toContain("simulateClick(button)");
    expect(source).not.toContain('findByText(["发布", "立即发布", "提交", "保存并发布"], document, "button,[role=\'button\'],span,div")');
    expect(source).not.toContain("button.click();");
  });

  it("enters the Douyin image publish editor before uploading image posts", async () => {
    const source = await readFile(douyinAutomationScript, "utf8");

    expect(source).toContain("function getDouyinImagePublishUrl");
    expect(source).toContain("function isDouyinImagePublishPage");
    expect(source).toContain("/creator-micro/content/post/image");
    expect(source).toContain("media_type=image");
    expect(source).toContain("load_publish_page_image_fallback");
    expect(source).toContain("if (!isDouyinImagePublishPage())");
    expect(source).not.toContain('publishEntryUrl: "https://creator.douyin.com/creator-micro/content/upload"');
  });
});
