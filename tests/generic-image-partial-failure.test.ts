import { afterEach, describe, expect, it } from "vitest";
import { runImageModel, setGenericImageRequestExecutorForTest, type GenericImageRequestExecutor } from "@/lib/integrations/images/client";
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

const config: ModelApiConfig = {
  provider: "generic-compatible",
  baseUrl: "https://example.test/generic-image",
  apiKey: "sk-test",
  modelName: "generic-image",
  timeout: 150000,
};

function createJsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("generic image partial failure", () => {
  afterEach(() => {
    setGenericImageRequestExecutorForTest(null);
  });

  it("supports generic provider success path", async () => {
    const executor: GenericImageRequestExecutor = async () => createJsonResponse({ url: "https://example.test/success.png" }, 200);
    setGenericImageRequestExecutorForTest(executor);

    const asset = await runImageModel(product, theme, content, config, 2);

    expect(asset.provider).toBe("generic");
    expect(asset.images).toHaveLength(2);
    expect(asset.images?.every((image) => image.reviewStatus !== "failed")).toBe(true);
  });

  it("keeps successful images and marks failed images instead of whole-batch fallback", async () => {
    let callIndex = 0;
    const executor: GenericImageRequestExecutor = async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return createJsonResponse({ url: "https://example.test/1.png" }, 200);
      }
      return createJsonResponse({ error: "temporary_error" }, 500);
    };
    setGenericImageRequestExecutorForTest(executor);

    const asset = await runImageModel(product, theme, content, config, 2);

    expect(asset.images).toHaveLength(2);
    expect(asset.provider).toBe("generic");
    expect(asset.images?.some((image) => image.reviewStatus === "failed")).toBe(true);
    expect(asset.images?.some((image) => image.reviewStatus !== "failed")).toBe(true);
    const failedImage = asset.images?.find((image) => image.reviewStatus === "failed");
    expect(failedImage?.errorMessage).toContain("IMAGE_API_500");
    expect(failedImage?.provider).toBe("generic");
  });
});
