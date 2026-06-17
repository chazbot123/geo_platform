import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const detailSource = new URL("../src/components/content/content-item-detail.tsx", import.meta.url);

describe("content item detail image panel", () => {
  it("keeps image prompts collapsed by default and exposes them with a button", async () => {
    const source = await readFile(detailSource, "utf-8");

    expect(source).toContain("const [showImagePrompt, setShowImagePrompt] = useState(false)");
    expect(source).toContain("查看图片生成提示词");
    expect(source).toContain("收起图片生成提示词");
    expect(source).toContain("showImagePrompt ? setShowImagePrompt(false) : setShowImagePrompt(true)");
    expect(source).not.toContain('<p className="mt-3 text-sm leading-6 text-muted">{item.imagePrompt || "暂无图片提示。"}</p>');
  });

  it("defaults to four image cards and lets users expand the remaining images", async () => {
    const source = await readFile(detailSource, "utf-8");

    expect(source).toContain("const IMAGE_PREVIEW_LIMIT = 4");
    expect(source).toContain("const [showAllImages, setShowAllImages] = useState(false)");
    expect(source).toContain("visiblePreviewImageIds");
    expect(source).toContain("showAllImages ? item.imageList : item.imageList.slice(0, IMAGE_PREVIEW_LIMIT)");
    expect(source).toContain("展开全部图片");
    expect(source).toContain("收起图片");
    expect(source).not.toContain("generatedImages.slice(0, 4).map");
    expect(source).not.toContain("failedImages.slice(0, 4).map");
  });
});
