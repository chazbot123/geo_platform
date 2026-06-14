import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryContentPoolItemImage } from "@/lib/content/service";

const record = {
  taskId: "task-1",
  sourcePublishPlanUpdatedAt: "2026-06-14T00:00:00.000Z",
  currentTaskId: "task-1",
  items: [
    {
      id: "item-1",
      sequence: 1,
      taskId: "task-1",
      aiPlatform: "doubao",
      publishPlatform: "toutiao",
      accountId: "account-1",
      keywordId: "keyword-1",
      keywordSequence: 1,
      keywordText: "测试关键词",
      accountKeywordOffset: 0,
      plannedPublishTime: "2026-06-14T10:00:00.000Z",
      title: "测试标题",
      summary: "测试摘要",
      body: "测试正文",
      imagePrompt: "测试图片提示",
      expectedImageCount: 2,
      imageList: [
        {
          id: "img-1",
          prompt: "图 1 prompt",
          url: "https://example.test/1.png",
          status: "generated",
        },
        {
          id: "img-2",
          prompt: "图 2 prompt",
          errorMessage: "IMAGE_API_500",
          status: "failed",
        },
      ],
      riskLevel: "low",
      status: "pending_publish",
      publishable: true,
      pipeline: {
        negativeCheck: { status: "passed", hits: [] },
        riskReview: { status: "passed", level: "low", message: "ok" },
        sampleDraft: { status: "passed", passed: true },
        styleAdaptation: { status: "passed", platform: "toutiao", notes: [] },
        dispersion: { status: "passed", changedDimensions: ["title"], message: "ok" },
        imageGeneration: {
          status: "needs_action",
          prompt: "测试图片提示",
          images: [
            { id: "img-1", prompt: "图 1 prompt", url: "https://example.test/1.png", status: "generated" },
            { id: "img-2", prompt: "图 2 prompt", errorMessage: "IMAGE_API_500", status: "failed" },
          ],
        },
      },
      stageLog: [],
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    },
  ],
  generatedAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

vi.mock("@/lib/storage/data-store", () => ({
  getContentPool: vi.fn(async () => structuredClone(record)),
  saveContentPool: vi.fn(async (next) => next),
}));

vi.mock("@/lib/tasks/service", () => ({
  getTaskBundle: vi.fn(async () => ({
    task: { id: "task-1", expectedImageCount: 2 },
    product: { id: "product-1", taskId: "task-1", productName: "测试产品", category: "测试品类", sellingPoints: "卖点", targetAudience: "人群", scenarios: "场景", brandTone: "专业" },
    theme: { taskId: "task-1", searchProvider: "doubao", audienceChannels: ["social"], mainKeyword: "测试关键词", backupKeywords: [], relatedKeywords: [], trendKeywords: [], candidateKeywords: ["测试关键词"], scoreSummary: "", rankingSummary: "", updatedAt: "2026-06-14T00:00:00.000Z" },
  })),
  DEFAULT_EXPECTED_IMAGE_COUNT: 5,
  normalizeExpectedImageCount: (value?: number) => Math.min(10, Math.max(1, Math.floor(Number(value) || 5))),
}));

vi.mock("@/lib/config/service", () => ({
  getAppConfig: vi.fn(async () => ({
    imageModelApiConfig: {
      provider: "generic-compatible",
      baseUrl: "https://example.test/generic-image",
      apiKey: "sk-test",
      modelName: "generic-image",
      timeout: 150000,
    },
  })),
}));

vi.mock("@/lib/integrations/images/client", () => ({
  runSingleImageModel: vi.fn(async () => ({
    id: "img-2-retried",
    url: "https://example.test/retried.png",
    prompt: "图 2 prompt",
    alt: "文章配图 2",
    reviewStatus: "pending",
    provider: "generic",
    generationMode: "prompt",
    placement: {
      paragraphIndex: 1,
      caption: "配图 2",
    },
  })),
}));

vi.mock("@/lib/images/local-image-store", () => ({
  materializeScopedArticleImageItem: vi.fn(async (_scopeId: string, image: unknown) => ({
    ...(image as object),
    publicUrl: "/generated-images/item-1/image-2.png",
    localPath: "generated-images/item-1/image-2.png",
  })),
}));

describe("retryContentPoolItemImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries a failed image and updates the content pool item in place", async () => {
    const next = await retryContentPoolItemImage("task-1", "item-1", "img-2");
    const item = next.items[0];
    const retriedImage = item.imageList[1];

    expect(retriedImage.status).toBe("generated");
    expect(retriedImage.url).toBe("/generated-images/item-1/image-2.png");
    expect(retriedImage.errorMessage).toBeUndefined();
    expect(item.pipeline.imageGeneration.status).toBe("passed");
  });
});
