import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleGenerationContext } from "@/lib/content/article-generation-service";
import { generateArticleForContentPool } from "@/lib/content/article-generation-service";
import { loadAiScenarioTemplate, loadPlatformStrategy, loadRiskWords } from "@/lib/content/prompt-loader";
import type { PlatformStrategy, RiskWordsConfig } from "@/lib/content/prompt-loader";
import { runImageModel } from "@/lib/integrations/images/client";
import type { ReviewResult } from "@/lib/content/review-service";
import { callConfiguredTextModel } from "@/lib/integrations/openai-compatible";

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

const defaultPlatformStrategy: PlatformStrategy = {
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
};

const defaultRiskWords: RiskWordsConfig = {
  version: "test",
  description: "test",
  blockingWords: ["保证"],
  warningWords: ["最好"],
  contextualRules: [],
  preferredPhrases: [],
};

vi.mock("@/lib/config/service", () => ({
  getAppConfig: vi.fn(async () => appConfig),
}));

vi.mock("@/lib/content/review-service", () => ({
  reviewContent: vi.fn(async () => reviewResult),
}));

vi.mock("@/lib/content/prompt-loader", () => ({
  loadAiScenarioTemplate: vi.fn(async () => "AI 场景模板：先给结论，再给依据。"),
  loadPlatformStrategy: vi.fn(async () => defaultPlatformStrategy),
  loadRiskWords: vi.fn(async () => defaultRiskWords),
  renderPlatformStrategyInstructions: vi.fn(() => "平台策略资产：标题短、正文清晰、必须有判断标准。"),
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
      audienceChannels: ["social"],
      mainKeyword: "GEO优化",
      backupKeywords: [],
      relatedKeywords: [],
      trendKeywords: [],
      candidateKeywords: [],
      scoreSummary: "test",
      rankingSummary: "test",
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
    vi.mocked(loadPlatformStrategy).mockImplementation(async () => defaultPlatformStrategy);
    vi.mocked(loadRiskWords).mockImplementation(async () => defaultRiskWords);
    vi.mocked(loadAiScenarioTemplate).mockImplementation(async () => "AI 场景模板：先给结论，再给依据。");
    vi.mocked(callConfiguredTextModel).mockClear();
  });

  it("injects platform limits, article template and short topic tags into generation prompts", async () => {
    payloadQueue = Array.from({ length: 5 }, () => ({
      title: "正常标题",
      summary: "正常摘要",
      body: "正文包含判断标准和适用场景。",
      imagePrompt: "配图提示",
      riskLevel: "low",
      tags: ["#GEO优化/服务商", "客户问：北京企业做GEO优化怎么判断服务商是否靠谱？需要看哪些案例和风险？"],
      notes: [],
    }));

    const result = await generateArticleForContentPool({
      ...createContext(),
      platform: "xiaohongshu",
      keywordText: "客户问：北京企业做GEO优化怎么判断服务商是否靠谱？需要看哪些案例和风险？",
    });

    const prompts = vi.mocked(callConfiguredTextModel).mock.calls
      .map((call) => call[1]?.map((message) => message.content).join("\n"))
      .join("\n\n---\n\n");
    expect(prompts).toContain("正文硬限制：1000 字");
    expect(prompts).toContain("文章模板：问题解答类");
    expect(prompts).toContain("客户问题只用于正文回答，不要直接把完整客户问题当作平台话题标签");
    expect(prompts).toContain("服务商靠谱");
    expect(result.item.topicTags).toEqual(expect.arrayContaining(["北京企业", "GEO优化", "服务商靠谱"]));
    expect(result.item.topicTags).not.toContain("客户问：北京企业做GEO优化怎么判断服务商是否靠谱？需要看哪些案例和风险？");
  });

  it("uses one quality-review revision when the final model review requires it", async () => {
    payloadQueue = [
      {
        title: "首稿标题",
        summary: "首稿摘要",
        body: "首稿正文包含判断标准和适用场景。",
        imagePrompt: "配图提示",
        riskLevel: "low",
        tags: ["标签"],
        notes: [],
      },
      {
        title: "风格稿标题",
        summary: "风格稿摘要",
        body: "风格稿正文包含判断标准和适用场景。",
        imagePrompt: "配图提示",
        riskLevel: "low",
        tags: ["标签"],
        notes: [],
      },
      {
        title: "降重稿标题",
        summary: "降重稿摘要",
        body: "降重稿正文包含判断标准和适用场景。",
        imagePrompt: "配图提示",
        riskLevel: "low",
        tags: ["标签"],
        notes: [],
      },
      {
        title: "风险稿标题",
        summary: "风险稿摘要",
        body: "风险稿正文仍然像平台规则说明，不像真实文章。",
        imagePrompt: "配图提示",
        riskLevel: "low",
        tags: ["标签"],
        notes: [],
      },
      {
        passed: false,
        rewriteRequired: true,
        issues: ["不符合小红书口语表达"],
        revisionInstruction: "改成真实问题解答类笔记，压缩到平台限制内。",
      },
      {
        title: "修订稿标题",
        summary: "修订稿摘要",
        body: "这是最终修订稿正文，先回答问题，再说明判断依据、风险边界和下一步。",
        imagePrompt: "修订稿配图",
        riskLevel: "low",
        tags: ["修订标签"],
        notes: [],
      },
    ];

    const result = await generateArticleForContentPool({ ...createContext(), platform: "xiaohongshu" });

    expect(result.item.title).toBe("修订稿标题");
    expect(result.item.body).toContain("最终修订稿正文");
    expect(result.item.rewriteAttemptCount).toBe(2);
    expect(result.item.reviewAttemptCount).toBe(2);
    expect(result.item.stageLog?.some((entry) => entry.message.includes("最终复检要求二次修订"))).toBe(true);
    expect(vi.mocked(callConfiguredTextModel)).toHaveBeenCalledTimes(6);
  });

  it("treats a failed final model review as revision-required even when rewriteRequired is false", async () => {
    payloadQueue = [
      {
        title: "首稿标题",
        summary: "首稿摘要",
        body: "首稿正文包含判断标准和适用场景。",
        imagePrompt: "配图提示",
        riskLevel: "low",
        tags: ["标签"],
        notes: [],
      },
      {
        title: "风格稿标题",
        summary: "风格稿摘要",
        body: "风格稿正文包含判断标准和适用场景。",
        imagePrompt: "配图提示",
        riskLevel: "low",
        tags: ["标签"],
        notes: [],
      },
      {
        title: "降重稿标题",
        summary: "降重稿摘要",
        body: "降重稿正文包含判断标准和适用场景。",
        imagePrompt: "配图提示",
        riskLevel: "low",
        tags: ["标签"],
        notes: [],
      },
      {
        title: "风险稿标题",
        summary: "风险稿摘要",
        body: "风险稿正文仍然超过平台限制或不符合风格。",
        imagePrompt: "配图提示",
        riskLevel: "low",
        tags: ["标签"],
        notes: [],
      },
      {
        passed: false,
        rewriteRequired: false,
        issues: ["正文仍然超过平台限制"],
        revisionInstruction: "",
      },
      {
        title: "修订稿标题",
        summary: "修订稿摘要",
        body: "这是被强制修订后的正文，包含判断标准和适用场景。",
        imagePrompt: "修订稿配图",
        riskLevel: "low",
        tags: ["修订标签"],
        notes: [],
      },
    ];

    const result = await generateArticleForContentPool({ ...createContext(), platform: "xiaohongshu" });

    expect(result.item.title).toBe("修订稿标题");
    expect(result.item.body).toContain("强制修订后的正文");
    expect(result.item.rewriteAttemptCount).toBe(2);
    expect(result.item.stageLog?.some((entry) => entry.message.includes("最终复检要求二次修订"))).toBe(true);
    expect(vi.mocked(callConfiguredTextModel)).toHaveBeenCalledTimes(6);
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

  it("runs per-article finalize steps sequentially", async () => {
    payloadQueue = Array.from({ length: 5 }, () => ({
      title: "正常标题",
      summary: "正常摘要",
      body: "正文包含判断标准。",
      imagePrompt: "配图提示",
      riskLevel: "low",
      tags: ["标签"],
      notes: [],
    }));

    const callOrder: string[] = [];
    let releaseStrategy!: () => void;

    vi.mocked(loadPlatformStrategy).mockImplementation(
      () =>
        new Promise((resolve) => {
          callOrder.push("strategy:start");
          releaseStrategy = () => {
            callOrder.push("strategy:end");
            resolve(defaultPlatformStrategy);
          };
        }),
    );
    vi.mocked(loadRiskWords).mockImplementation(async () => {
      callOrder.push("risk:start");
      return defaultRiskWords;
    });

    const generationPromise = generateArticleForContentPool(createContext());
    for (let attempt = 0; attempt < 20 && !callOrder.includes("strategy:start"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(callOrder).toEqual(["strategy:start"]);

    releaseStrategy();
    await generationPromise;

    expect(callOrder).toEqual(["strategy:start", "strategy:end", "risk:start"]);
  });

  it("keeps articles publishable and localizes aborted image generation errors", async () => {
    payloadQueue = Array.from({ length: 5 }, () => ({
      title: "正常标题",
      summary: "正常摘要",
      body: "正文包含判断标准和适用场景。",
      imagePrompt: "配图提示",
      riskLevel: "low",
      tags: ["标签"],
      notes: [],
    }));
    vi.mocked(runImageModel).mockRejectedValueOnce(new Error("This operation was aborted"));

    const result = await generateArticleForContentPool(createContext());

    expect(result.item.status).toBe("pending_publish");
    expect(result.item.publishable).toBe(true);
    expect(result.item.imageList).toHaveLength(5);
    expect(result.item.imageList[0]).toMatchObject({
      id: "item-1-image-1",
      status: "failed",
      prompt: result.item.imagePrompt,
    });
    expect(result.item.imageList[0].errorMessage).toContain("图片模型请求超时或被中断");
    expect(result.item.pipeline.imageGeneration.status).toBe("needs_action");
    expect(result.item.stageLog?.some((entry) => entry.message.includes("图片模型请求超时或被中断"))).toBe(true);
    expect(result.item.stageLog?.some((entry) => entry.message.includes("This operation was aborted"))).toBe(false);
  });

  it("localizes invalid image api token errors", async () => {
    payloadQueue = Array.from({ length: 5 }, () => ({
      title: "正常标题",
      summary: "正常摘要",
      body: "正文包含判断标准和适用场景。",
      imagePrompt: "配图提示",
      riskLevel: "low",
      tags: ["标签"],
      notes: [],
    }));
    vi.mocked(runImageModel).mockRejectedValueOnce(new Error("IMAGE_API_401: Invalid token"));

    const result = await generateArticleForContentPool(createContext());

    expect(result.item.status).toBe("pending_publish");
    expect(result.item.pipeline.imageGeneration.status).toBe("needs_action");
    expect(result.item.stageLog?.some((entry) => entry.message.includes("图片模型认证失败"))).toBe(true);
    expect(result.item.stageLog?.some((entry) => entry.message.includes("IMAGE_API_401"))).toBe(false);
  });

  it("localizes image api 524 gateway timeout errors", async () => {
    payloadQueue = Array.from({ length: 5 }, () => ({
      title: "正常标题",
      summary: "正常摘要",
      body: "正文包含判断标准和适用场景。",
      imagePrompt: "配图提示",
      riskLevel: "low",
      tags: ["标签"],
      notes: [],
    }));
    vi.mocked(runImageModel).mockRejectedValueOnce(new Error("IMAGE_API_524: openai_error"));

    const result = await generateArticleForContentPool(createContext());

    expect(result.item.status).toBe("pending_publish");
    expect(result.item.pipeline.imageGeneration.status).toBe("needs_action");
    expect(result.item.imageList[0]?.errorMessage).toContain("图片服务网关超时");
    expect(result.item.stageLog?.some((entry) => entry.message.includes("图片服务网关超时"))).toBe(true);
    expect(result.item.stageLog?.some((entry) => entry.message.includes("IMAGE_API_524"))).toBe(false);
  });
});
