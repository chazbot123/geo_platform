import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runImageModel } from "@/lib/integrations/images/client";
import type { ContentDraft, ModelApiConfig, ProductProfile, ThemeSet } from "@/lib/types";

const baseProduct: ProductProfile = {
  id: "product-1",
  taskId: "task-1",
  productName: "测试产品",
  category: "测试品类",
  sellingPoints: "卖点",
  targetAudience: "人群",
  scenarios: "场景",
  brandTone: "专业",
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
  updatedAt: "2026-06-13T00:00:00.000Z",
};

const content: ContentDraft = {
  taskId: "task-1",
  title: "测试标题",
  summary: "测试摘要",
  content: "第一段。\n\n第二段。\n\n第三段。\n\n第四段。\n\n第五段。",
  faq: [],
  cta: "测试 CTA",
  updatedAt: "2026-06-13T00:00:00.000Z",
};

const config: ModelApiConfig = {
  provider: "openai",
  baseUrl: "https://example.test/v1",
  apiKey: "sk-test",
  modelName: "gpt-image-2",
  timeout: 60000,
};

let tempDir: string | undefined;

function createImageResponse() {
  return new Response(
    JSON.stringify({
      data: [{ url: "https://example.test/generated.png", revised_prompt: "修订后的提示词" }],
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

describe("openai-compatible image routes", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("uses /images/generations for prompt-only generation", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(createImageResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runImageModel(baseProduct, theme, content, config);

    expect(result.images).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalled();
    const firstUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(firstUrl).toBe("https://example.test/v1/images/generations");
  });

  it("uses /images/edits when reference images are available", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => {
      return Promise.resolve(createImageResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    tempDir = await mkdtemp(path.join(os.tmpdir(), "geo-openai-image-test-"));
    const referenceImagePath = path.join(tempDir, "reference.png");
    await writeFile(referenceImagePath, Buffer.from("fake-image"));

    const result = await runImageModel(
      {
        ...baseProduct,
        productImagePath: referenceImagePath,
      },
      theme,
      content,
      config,
    );

    expect(result.images).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalled();
    const firstUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(firstUrl).toBe("https://example.test/v1/images/edits");
  });
});
