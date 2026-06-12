import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleGenerationContext } from "@/lib/content/article-generation-service";
import { generateArticleForContentPool } from "@/lib/content/article-generation-service";
import type { ReviewResult } from "@/lib/content/review-service";

const appConfig = {
  contentModelApiConfig: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-test",
    modelName: "deepseek-chat",
    timeout: 60000,
  },
  imageModelApiConfig: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-image",
    modelName: "gpt-image-2",
    timeout: 60000,
  },
} as const;

let payloadQueue: Array<Record<string, unknown>> = [];
let reviewResult: ReviewResult = {
  passed: true,
  blockingIssues: [],
  warnings: [],
  scores: {
    platformFit: 100,
    complianceFit: 100,
    questionCoverage: 100,
  },
};

vi.mock("@/lib/config/service", () => ({
  getAppConfig: vi.fn(async () => appConfig),
}));

vi.mock("@/lib/content/review-service", () => ({
  reviewContent: vi.fn(async () => reviewResult),
}));

vi.mock("@/lib/content/prompt-loader", () => ({
  loadPlatformStrategy: vi.fn(async () => ({
    platform: "toutiao",
    platformLabel: "今日头条",
    title: {
      maxLength: 12,
      patterns: [],
      bannedPatterns: [],
      instructions: "",
    },
    body: {
      preferredStructure: "",
      paragraphLength: "",
      maxParagraphChars: 150,
      headingStyle: "",
      sectionCount: { min: 3, max: 5 },
      ctaStyle: "",
      instructions: "",
    },
    metadata: {
      allowPublicTraceId: false,
      allowTimestamp: false,
      allowMarkdownTable: false,
      allowFaq: true,
      faqCount: { min: 0, max: 3 },
    },
    review: {
      riskWords: ["保证"],
      mustHave: ["判断标准", "适用场景"],
      mustNotHave: [],
    },
  })),
  loadRiskWords: vi.fn(async () => ({
    version: "test",
    description: "test",
    blockingWords: ["保证"],
    warningWords: ["最好"],
    contextualRules: [],
    preferredPhrases: [],
  })),
}));

vi.mock("@/lib/integrations/openai-compatible", () => ({
  OpenAICompatibleHttpError: class OpenAICompatibleHttpError extends Error {},
  callConfiguredTextModel: vi.fn(async () => ({ rawText: "{\"ok\":true}" })),
  parseJsonFromModelText: vi.fn(() => payloadQueue.shift() ?? payloadQueue.at(-1)),
}));

vi.mock("@/lib/integrations/images/client", () => ({
  runImageModel: vi.fn(async () => ({
    images: [
      {
        id: "img-1",
        prompt: "配图",
        publicUrl: "https://example.com/image.png",
        url: "https://example.com/image.png",
        localPath: "images/image.png",
      },
    ],
  })),
}));

vi.mock("@/lib/images/local-image-store", () => ({
  materializeScopedImageAssetToLocal: vi.fn(async (_contentItemId: string, imageAsset: { images: unknown[] }) => imageAsset),
}));

function createContext(): ArticleGenerationContext {
  return {
    taskId: "task-1",
    contentItemId: "item-1",
    sequence: 1,
    product: {
      id: "product-1",
      productName: "极之道",
      category: "GEO服务",
      sellingPoints: "流程清晰、可落地",
      targetAudience: "中小企业",
      province: "广东省",
      city: "广州市",
      district: "天河区",
      scenarios: "本地获客",
      brandTone: "专业克制",
      complianceNotes: "",
    } as ArticleGenerationContext["product"],
    theme: {
      id: "theme-1",
      taskId: "task-1",
      title: "主题",
      searchProvider: "doubao",
      sourceQuestionIds: [],
      keywords: [],
      outline: [],
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
    } as ArticleGenerationContext["theme"],
    searchProvider: "doubao",
    platform: "toutiao",
    accountId: "account-1",
    accountName: "测试账号",
    keywordId: "keyword-1",
    keywordSequence: 1,
    keywordText: "极之道的GEO优化适合获客吗？",
    accountKeywordOffset: 0,
    plannedPublishTime: "2026-06-12T09:00:00.000Z",
    previousComparableArticles: [],
  };
}

describe("generateArticleForContentPool", () => {
  beforeEach(() => {
    payloadQueue = [];
    reviewResult = {
      passed: true,
      blockingIssues: [],
      warnings: [],
      scores: {
        platformFit: 100,
        complianceFit: 100,
        questionCoverage: 100,
      },
    };
  });

  it("keeps article publishable when only model self-reports high risk", async () => {
    payloadQueue = Array.from({ length: 5 }, () => ({
      title: "这个标题非常长需要被裁剪",
      summary: "这是一段最好单独判断的摘要",
      body: "正文里不要保证结果，但要保留判断标准。",
      imagePrompt: "配图提示",
      riskLevel: "high",
      tags: ["标签"],
      notes: [],
    }));

    const result = await generateArticleForContentPool(createContext());

    expect(result.item.publishable).toBe(true);
    expect(result.item.status).toBe("pending_publish");
    expect(result.item.body).toContain("判断标准");
    expect(result.item.body).toContain("适用场景");
    expect(result.item.title.length).toBeLessThanOrEqual(12);
    expect(result.item.riskLevel).toBe("medium");
    expect(result.item.riskCodes).toContain("MODEL_SELF_REPORTED_RISK");
  });

  it("keeps article body for failed items so detail page is still visible", async () => {
    payloadQueue = Array.from({ length: 5 }, () => ({
      title: "正常标题",
      summary: "正常摘要",
      body: "这是一段会失败但应该保留显示的正文。",
      imagePrompt: "配图提示",
      riskLevel: "low",
      tags: ["标签"],
      notes: [],
    }));
    reviewResult = {
      passed: false,
      blockingIssues: [{ code: "TITLE_TOO_LONG", message: "标题超长" }],
      warnings: [],
      scores: {
        platformFit: 70,
        complianceFit: 75,
        questionCoverage: 100,
      },
    };

    const result = await generateArticleForContentPool(createContext());

    expect(result.item.publishable).toBe(false);
    expect(result.item.status).toBe("failed");
    expect(result.item.body).toContain("保留显示的正文");
    expect(result.item.failedReason).toBe("复检发现 1 个阻断问题。");
  });
});
