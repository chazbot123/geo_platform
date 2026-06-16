import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentPoolRecord, ProductProfile, PublishingJobRecord, TaskRecord, ThemeSet } from "@/lib/types";

let tempDataDir: string | undefined;

async function loadIsolatedServices() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-history-service-test-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  const [dataStore, historyService] = await Promise.all([
    import("@/lib/storage/data-store"),
    import("@/lib/tasks/history-service"),
  ]);
  await dataStore.ensureStorageReady();
  return { dataStore, historyService };
}

afterEach(async () => {
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

function publishPlan(updatedAt = "2026-06-12T10:00:00.000Z"): TaskRecord["publishPlan"] {
  return {
    taskId: "task-1",
    enterpriseTaskId: "task-1",
    keywordTaskId: "task-1",
    searchProvider: "tongyi",
    enabledPlatforms: [
      { platform: "weibo", enabled: true, accountCount: 1, accountIds: ["account-1"], articleCount: 1 },
    ],
    days: 1,
    articlesPerAccountPerDay: 1,
    timeWindow: { start: "09:00", end: "18:00" },
    minSameAccountIntervalHours: 3,
    totalAccountCount: 1,
    totalArticleCount: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

function taskRecord(patch: Partial<TaskRecord> = {}): TaskRecord {
  const updatedAt = patch.updatedAt ?? "2026-06-12T10:00:00.000Z";
  return {
    id: "task-1",
    productId: "product-1",
    status: "generation_completed",
    searchProvider: "tongyi",
    publishPlan: publishPlan(updatedAt),
    createdAt: updatedAt,
    updatedAt,
    ...patch,
  };
}

function contentPoolRecord(patch: Partial<ContentPoolRecord> = {}): ContentPoolRecord {
  const updatedAt = patch.updatedAt ?? "2026-06-12T10:00:00.000Z";
  return {
    taskId: "task-1",
    sourcePublishPlanUpdatedAt: updatedAt,
    currentTaskId: "task-1",
    items: [],
    generatedAt: updatedAt,
    updatedAt,
    totalArticleCount: 1,
    generatedArticleCount: 0,
    generatingArticleCount: 0,
    failedArticleCount: 0,
    pendingPublishArticleCount: 0,
    ...patch,
  };
}

function productRecord(patch: Partial<ProductProfile> = {}): ProductProfile {
  return {
    id: "product-1",
    taskId: "task-1",
    productName: "GEO 平台",
    category: "software",
    sellingPoints: "搜索优化",
    targetAudience: "企业客户",
    scenarios: "内容发布",
    brandTone: "专业",
    ...patch,
  };
}

function themeRecord(patch: Partial<ThemeSet> = {}): ThemeSet {
  return {
    taskId: "task-1",
    searchProvider: "tongyi",
    audienceChannels: ["social"],
    mainKeyword: "GEO 优化",
    backupKeywords: [],
    relatedKeywords: [],
    trendKeywords: [],
    recommendedKeywords: ["GEO 优化怎么做？"],
    candidateKeywords: ["GEO 优化怎么做？", "GEO 内容怎么发布？"],
    scoreSummary: "历史任务关键词",
    rankingSummary: "已选择历史任务关键词",
    selectedKeyword: "GEO 优化怎么做？",
    selectedKeywords: [
      "GEO 优化怎么做？",
      "GEO 内容怎么发布？",
      "企业怎么选择 GEO 服务？",
      "GEO 优化多少钱？",
      "GEO 发布要注意什么？",
    ],
    selectedKeywordTheme: "GEO 优化怎么做？",
    updatedAt: "2026-06-12T10:00:00.000Z",
    ...patch,
  };
}

function publishingJob(patch: Partial<PublishingJobRecord> = {}): PublishingJobRecord {
  return {
    id: "job-1",
    taskId: "task-1",
    platform: "weibo",
    contentPoolItemId: "item-1",
    contentSequence: 1,
    plannedPublishTime: "2026-06-12T10:00:00.000Z",
    accountId: "account-1",
    accountName: "微博账号",
    executionMode: "electron_automation",
    status: "pending_review",
    draftTitle: "标题",
    draftBody: "正文",
    draftTags: [],
    draftImages: [],
    draftImagePaths: [],
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    ...patch,
  };
}

describe("historical task summaries", () => {
  it("treats only real content pool items as generated content", async () => {
    const { dataStore, historyService } = await loadIsolatedServices();
    const savedAt = "2026-06-12T10:00:00.000Z";

    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "GEO 平台",
      category: "software",
      sellingPoints: "搜索优化",
      targetAudience: "企业客户",
      scenarios: "内容发布",
      brandTone: "专业",
    });
    await dataStore.saveTask(taskRecord());
    await dataStore.saveContentPool(contentPoolRecord());

    const summaries = await historyService.listHistoricalTaskSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.hasGeneratedContent).toBe(false);
    expect(summaries[0]?.generatedArticleCount).toBe(0);
  });

  it("marks generated content only when the pool has a ready item", async () => {
    const { dataStore, historyService } = await loadIsolatedServices();
    const savedAt = "2026-06-12T10:00:00.000Z";

    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "GEO 平台",
      category: "software",
      sellingPoints: "搜索优化",
      targetAudience: "企业客户",
      scenarios: "内容发布",
      brandTone: "专业",
    });
    await dataStore.saveTask(taskRecord({ updatedAt: savedAt }));
    await dataStore.saveContentPool(
      contentPoolRecord({
        updatedAt: savedAt,
        generatedArticleCount: 1,
        items: [
          {
            id: "item-1",
            sequence: 1,
            taskId: "task-1",
            aiPlatform: "tongyi",
            publishPlatform: "weibo",
            accountId: "account-1",
            keywordId: "keyword-1",
            keywordSequence: 1,
            keywordText: "GEO 搜索优化怎么做",
            accountKeywordOffset: 0,
            plannedPublishTime: savedAt,
            title: "标题",
            summary: "摘要",
            body: "正文",
            imagePrompt: "",
            imageList: [],
            riskLevel: "low",
            status: "ready",
            pipeline: {
              negativeCheck: { status: "passed", hits: [] },
              riskReview: { status: "passed", level: "low", message: "通过" },
              sampleDraft: { status: "passed", passed: true },
              styleAdaptation: { status: "passed", platform: "weibo", notes: [] },
              dispersion: { status: "passed", changedDimensions: [], message: "通过" },
              imageGeneration: { status: "passed", prompt: "", images: [] },
            },
            publishable: true,
            createdAt: savedAt,
            updatedAt: savedAt,
          },
        ],
      }),
    );

    const summaries = await historyService.listHistoricalTaskSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.hasGeneratedContent).toBe(true);
    expect(summaries[0]?.generatedArticleCount).toBe(1);
    expect(summaries[0]?.publishableArticleCount).toBe(1);
  });

  it("does not count submitted or pending-review jobs as published rounds", async () => {
    const { dataStore, historyService } = await loadIsolatedServices();

    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "GEO 平台",
      category: "software",
      sellingPoints: "搜索优化",
      targetAudience: "企业客户",
      scenarios: "内容发布",
      brandTone: "专业",
    });
    await dataStore.saveTask(taskRecord());
    await dataStore.saveContentPool(
      contentPoolRecord({
        generatedArticleCount: 1,
        items: [
          {
            id: "item-1",
            sequence: 1,
            taskId: "task-1",
            aiPlatform: "tongyi",
            publishPlatform: "weibo",
            accountId: "account-1",
            keywordId: "keyword-1",
            keywordSequence: 1,
            keywordText: "GEO 搜索优化怎么做",
            accountKeywordOffset: 0,
            plannedPublishTime: "2026-06-12T10:00:00.000Z",
            title: "标题",
            summary: "摘要",
            body: "正文",
            imagePrompt: "",
            imageList: [],
            riskLevel: "low",
            status: "ready",
            pipeline: {
              negativeCheck: { status: "passed", hits: [] },
              riskReview: { status: "passed", level: "low", message: "通过" },
              sampleDraft: { status: "passed", passed: true },
              styleAdaptation: { status: "passed", platform: "weibo", notes: [] },
              dispersion: { status: "passed", changedDimensions: [], message: "通过" },
              imageGeneration: { status: "passed", prompt: "", images: [] },
            },
            publishable: true,
            createdAt: "2026-06-12T10:00:00.000Z",
            updatedAt: "2026-06-12T10:00:00.000Z",
          },
        ],
      }),
    );
    await dataStore.savePublishingJob(publishingJob({ status: "pending_review" }));
    await dataStore.savePublishingJob(publishingJob({ id: "job-2", status: "submitted" }));
    await dataStore.savePublishingJob(publishingJob({ id: "job-3", status: "published" }));

    const summaries = await historyService.listHistoricalTaskSummaries();

    expect(summaries[0]?.publishedArticleCount).toBe(1);
    expect(summaries[0]?.manualPendingCount).toBe(0);
  });

  it("counts only publishing jobs that match current content pool items", async () => {
    const { dataStore, historyService } = await loadIsolatedServices();
    const savedAt = "2026-06-12T10:00:00.000Z";

    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "GEO 平台",
      category: "software",
      sellingPoints: "搜索优化",
      targetAudience: "企业客户",
      scenarios: "内容发布",
      brandTone: "专业",
    });
    await dataStore.saveTask(taskRecord());
    await dataStore.saveContentPool(
      contentPoolRecord({
        generatedArticleCount: 1,
        items: [
          {
            id: "item-current",
            sequence: 1,
            taskId: "task-1",
            aiPlatform: "tongyi",
            publishPlatform: "weibo",
            accountId: "account-1",
            keywordId: "keyword-1",
            keywordSequence: 1,
            keywordText: "GEO 搜索优化怎么做",
            accountKeywordOffset: 0,
            plannedPublishTime: savedAt,
            title: "标题",
            summary: "摘要",
            body: "正文",
            imagePrompt: "",
            imageList: [],
            riskLevel: "low",
            status: "published",
            pipeline: {
              negativeCheck: { status: "passed", hits: [] },
              riskReview: { status: "passed", level: "low", message: "通过" },
              sampleDraft: { status: "passed", passed: true },
              styleAdaptation: { status: "passed", platform: "weibo", notes: [] },
              dispersion: { status: "passed", changedDimensions: [], message: "通过" },
              imageGeneration: { status: "passed", prompt: "", images: [] },
            },
            publishable: true,
            createdAt: savedAt,
            updatedAt: savedAt,
          },
        ],
      }),
    );
    await dataStore.savePublishingJob(
      publishingJob({
        id: "current-job",
        status: "published",
        contentPoolItemId: "item-current",
        contentSequence: 1,
        plannedPublishTime: savedAt,
      }),
    );
    await dataStore.savePublishingJob(
      publishingJob({
        id: "old-manual-job",
        status: "manual_pending",
        contentPoolItemId: "old-item",
        contentSequence: 2,
        plannedPublishTime: "2026-06-10T10:00:00.000Z",
      }),
    );

    const summaries = await historyService.listHistoricalTaskSummaries();

    expect(summaries[0]?.publishedArticleCount).toBe(1);
    expect(summaries[0]?.manualPendingCount).toBe(0);
  });
});

describe("historical task keyword reuse", () => {
  it("creates a new planning task from historical keywords without copying old content or publish jobs", async () => {
    const { dataStore, historyService } = await loadIsolatedServices();

    await dataStore.saveProduct(productRecord());
    await dataStore.saveTheme(themeRecord());
    await dataStore.saveTask(taskRecord({ expectedImageCount: 2 }));
    await dataStore.saveContentPool(
      contentPoolRecord({
        items: [
          {
            id: "item-1",
            sequence: 1,
            taskId: "task-1",
            aiPlatform: "tongyi",
            publishPlatform: "weibo",
            accountId: "account-1",
            keywordId: "keyword-1",
            keywordSequence: 1,
            keywordText: "GEO 优化怎么做？",
            accountKeywordOffset: 0,
            plannedPublishTime: "2026-06-12T10:00:00.000Z",
            title: "历史文章",
            summary: "摘要",
            body: "正文",
            imagePrompt: "",
            imageList: [],
            riskLevel: "low",
            status: "ready",
            pipeline: {
              negativeCheck: { status: "passed", hits: [] },
              riskReview: { status: "passed", level: "low", message: "通过" },
              sampleDraft: { status: "passed", passed: true },
              styleAdaptation: { status: "passed", platform: "weibo", notes: [] },
              dispersion: { status: "passed", changedDimensions: [], message: "通过" },
              imageGeneration: { status: "passed", prompt: "", images: [] },
            },
            publishable: true,
            createdAt: "2026-06-12T10:00:00.000Z",
            updatedAt: "2026-06-12T10:00:00.000Z",
          },
        ],
      }),
    );
    await dataStore.savePublishingJob(publishingJob({ status: "pending_review" }));

    const result = await historyService.createTaskFromHistoricalKeywords("task-1");

    expect(result.task.id).not.toBe("task-1");
    expect(result.product.id).not.toBe("product-1");
    expect(result.product.taskId).toBe(result.task.id);
    expect(result.theme.taskId).toBe(result.task.id);
    expect(result.theme.selectedKeywords).toEqual(themeRecord().selectedKeywords);
    expect(result.task.selectedKeyword).toBe(themeRecord().selectedKeywords?.join("、"));
    expect(result.task.expectedImageCount).toBe(2);
    expect(result.task.publishPlan).toMatchObject({
      taskId: result.task.id,
      enterpriseTaskId: result.task.id,
      keywordTaskId: result.task.id,
      searchProvider: "tongyi",
      days: 1,
      articlesPerAccountPerDay: 1,
      totalArticleCount: 1,
    });
    expect(result.task.publishPlan?.createdAt).not.toBe("2026-06-12T10:00:00.000Z");
    expect(await dataStore.getContentPool(result.task.id)).toBeNull();
    expect(await dataStore.getPublishingJobsByTask(result.task.id)).toEqual([]);
    expect(await dataStore.getContentPool("task-1")).not.toBeNull();
    expect(await dataStore.getPublishingJobsByTask("task-1")).toHaveLength(1);
    expect(result.links.taskPlan).toBe(`/tasks/create?taskId=${encodeURIComponent(result.task.id)}`);
  });

  it("rejects historical task reuse when no selected keywords exist", async () => {
    const { dataStore, historyService } = await loadIsolatedServices();

    await dataStore.saveProduct(productRecord());
    await dataStore.saveTheme(themeRecord({ selectedKeywords: [] }));
    await dataStore.saveTask(taskRecord());

    await expect(historyService.createTaskFromHistoricalKeywords("task-1")).rejects.toThrow("历史任务没有可复用的客户问题");
  });
});
