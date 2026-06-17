import { afterEach, describe, expect, it, vi } from "vitest";
import { runImageModel, setGenericImageRequestExecutorForTest } from "@/lib/integrations/images/client";
import type { ContentDraft, ModelApiConfig, ProductProfile, ThemeSet } from "@/lib/types";

const product: ProductProfile = {
  id: "product-1",
  taskId: "task-1",
  productName: "测试产品",
  category: "测试品类",
  sellingPoints: "测试卖点",
  targetAudience: "测试人群",
  scenarios: "测试场景",
  brandTone: "专业克制",
};

const theme: ThemeSet = {
  taskId: "task-1",
  searchProvider: "doubao",
  audienceChannels: ["social"],
  mainKeyword: "测试关键词",
  backupKeywords: [],
  relatedKeywords: [],
  trendKeywords: [],
  candidateKeywords: ["测试关键词"],
  scoreSummary: "",
  rankingSummary: "",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

const content: ContentDraft = {
  taskId: "task-1",
  title: "测试标题",
  summary: "测试摘要",
  content: "第一段。\n\n第二段。\n\n第三段。",
  faq: [],
  cta: "测试 CTA",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

const genericConfig: ModelApiConfig = {
  provider: "generic-compatible",
  baseUrl: "https://fake-image-api.test/generate",
  apiKey: "sk-test",
  modelName: "image-model",
  timeout: 10000,
};

function buildImageAssetResponse(taskId: string) {
  return {
    taskId,
    assetType: "cover",
    url: "https://example.test/image.png",
    reviewStatus: "pending",
    prompt: "test prompt",
    provider: "generic",
    generationMode: "prompt",
    images: [],
    updatedAt: "2026-06-14T00:00:00.000Z",
  };
}

describe("image client 429 rate-limit retry via withImageRetry", () => {
  afterEach(() => {
    setGenericImageRequestExecutorForTest(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Patch setTimeout so withImageRetry sleeps resolve immediately
  function patchSleepImmediate() {
    vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => {
      Promise.resolve().then(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
  }

  it("retries generic image request after 429 and succeeds on second attempt", async () => {
    patchSleepImmediate();

    let callCount = 0;
    setGenericImageRequestExecutorForTest(async (_url, _init) => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(buildImageAssetResponse("task-1")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const resultPromise = runImageModel(product, theme, content, genericConfig, 1);

    const asset = await resultPromise;
    expect(asset).toBeDefined();
    expect(callCount).toBe(2);
  });

  it("retries generic image request after 524 gateway timeout and succeeds on second attempt", async () => {
    patchSleepImmediate();

    let callCount = 0;
    setGenericImageRequestExecutorForTest(async (_url, _init) => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "openai_error" }), {
          status: 524,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(buildImageAssetResponse("task-1")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const asset = await runImageModel(product, theme, content, genericConfig, 1);

    expect(asset).toBeDefined();
    expect(callCount).toBe(2);
  });

  it("propagates RATE_LIMIT error message when all retries exhausted", async () => {
    patchSleepImmediate();

    setGenericImageRequestExecutorForTest(async () => {
      return new Response(JSON.stringify({ error: "quota exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    });

    const resultPromise = runImageModel(product, theme, content, genericConfig, 1);

    // runGenericImageModel catches errors per-image and uses fallback items, not throwing
    const asset = await resultPromise;
    // All images should be failed fallback items with RATE_LIMIT error message
    const failedImages = asset.images?.filter((img) => img.reviewStatus === "failed") ?? [];
    expect(failedImages.length).toBeGreaterThan(0);
    const errorMsg = failedImages[0]?.errorMessage ?? "";
    expect(errorMsg).toMatch(/IMAGE_RATE_LIMIT_429/);
  });
});
