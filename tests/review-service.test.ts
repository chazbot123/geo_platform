import { describe, expect, it } from "vitest";
import { reviewDraft } from "@/lib/review/service";
import type { ContentDraft, ImageAsset } from "@/lib/types";

function createDraft(): ContentDraft {
  return {
    taskId: "task-1",
    title: "测试报告标题",
    summary: "测试报告摘要",
    content: "第一段\n\n第二段",
    selectedKeywords: ["测试问题"],
    reportSections: [
      {
        question: "测试问题",
        heading: "判断标准",
        summary: "摘要",
        body: "这里覆盖测试问题",
      },
    ],
    faq: [],
    cta: "行动建议",
    updatedAt: "2026-06-14T00:00:00.000Z",
  };
}

function createImageAsset(count: number): ImageAsset {
  return {
    taskId: "task-1",
    assetType: "cover",
    url: "https://example.test/cover.png",
    reviewStatus: "pending",
    prompt: "测试 prompt",
    updatedAt: "2026-06-14T00:00:00.000Z",
    images: Array.from({ length: count }, (_, index) => ({
      id: `img-${index + 1}`,
      url: `https://example.test/${index + 1}.png`,
      prompt: `prompt-${index + 1}`,
      alt: `alt-${index + 1}`,
      reviewStatus: "pending",
      placement: {
        paragraphIndex: index,
      },
    })),
  };
}

describe("reviewDraft expectedImageCount", () => {
  it("passes when image count matches the explicit expected count", () => {
    const result = reviewDraft(createDraft(), createImageAsset(3), 3);

    expect(result.imageWarnings).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("warns when image count is lower than the explicit expected count", () => {
    const result = reviewDraft(createDraft(), createImageAsset(2), 4);

    expect(result.imageWarnings.some((item) => item.includes("目标为 4 张"))).toBe(true);
    expect(result.passed).toBe(false);
  });
});
