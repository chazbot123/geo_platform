import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeScopedArticleImageItem } from "@/lib/images/local-image-store";
import type { ArticleImageItem } from "@/lib/types";

describe("local image store failed image", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips local materialization for failed images", async () => {
    const item: ArticleImageItem = {
      id: "img-1",
      url: "",
      prompt: "测试 prompt",
      alt: "测试配图",
      reviewStatus: "failed",
      provider: "generic",
      generationMode: "prompt",
      placement: {
        paragraphIndex: 0,
      },
      errorMessage: "IMAGE_API_500",
    };

    const result = await materializeScopedArticleImageItem("task-1", item, 0);

    expect(result.localPath).toBeUndefined();
    expect(result.publicUrl).toBeUndefined();
    expect(result.reviewStatus).toBe("failed");
  });
});
