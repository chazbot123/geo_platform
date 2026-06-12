import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentPoolItem, ContentPoolRecord, PublishingJobRecord, TaskRecord } from "@/lib/types";

let tempDataDir: string | undefined;

async function loadIsolatedServices() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-publish-execution-test-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  const [dataStore, executionService] = await Promise.all([
    import("@/lib/storage/data-store"),
    import("@/lib/publish/execution-service"),
  ]);
  await dataStore.ensureStorageReady();
  return { dataStore, executionService };
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
      { platform: "xiaohongshu", enabled: true, accountCount: 1, accountIds: ["new-account"], articleCount: 1 },
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

function contentItem(patch: Partial<ContentPoolItem> = {}): ContentPoolItem {
  return {
    id: "task-1-0001",
    sequence: 1,
    taskId: "task-1",
    aiPlatform: "tongyi",
    publishPlatform: "xiaohongshu",
    accountId: "new-account",
    accountName: "小红书账号",
    keywordId: "keyword-1",
    keywordSequence: 1,
    keywordText: "GEO 搜索优化怎么做",
    accountKeywordOffset: 0,
    plannedPublishTime: "2026-06-12T09:00:00.000Z",
    title: "新内容标题",
    summary: "新内容摘要",
    body: "新内容正文",
    imagePrompt: "",
    imageList: [],
    riskLevel: "low",
    status: "pending_publish",
    pipeline: {
      negativeCheck: { status: "passed", hits: [] },
      riskReview: { status: "passed", level: "low", message: "通过" },
      sampleDraft: { status: "passed", passed: true },
      styleAdaptation: { status: "passed", platform: "xiaohongshu", notes: [] },
      dispersion: { status: "passed", changedDimensions: [], message: "通过" },
      imageGeneration: { status: "passed", prompt: "", images: [] },
    },
    publishable: true,
    displayStatus: "pending_publish",
    internalStage: "ready",
    stageMessage: "等待发布。",
    stageLog: [],
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    ...patch,
  };
}

function contentPool(patch: Partial<ContentPoolRecord> = {}): ContentPoolRecord {
  return {
    taskId: "task-1",
    sourcePublishPlanUpdatedAt: "2026-06-12T10:00:00.000Z",
    currentTaskId: "task-1",
    items: [contentItem()],
    retryQueueStatus: "idle",
    generatedAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    totalArticleCount: 1,
    generatedArticleCount: 1,
    generatingArticleCount: 0,
    failedArticleCount: 0,
    pendingPublishArticleCount: 1,
    ...patch,
  };
}

function oldPublishingJob(patch: Partial<PublishingJobRecord> = {}): PublishingJobRecord {
  return {
    id: "old-job",
    taskId: "task-1",
    platform: "douyin",
    contentPoolItemId: "task-1-0001",
    contentSequence: 1,
    plannedPublishTime: "2026-06-10T09:00:00.000Z",
    accountId: "old-account",
    accountName: "旧账号",
    executionMode: "electron_automation",
    status: "published",
    draftTitle: "旧发布标题",
    draftBody: "旧发布正文",
    draftTags: [],
    draftImages: [],
    draftImagePaths: [],
    publishedAt: "2026-06-10T10:00:00.000Z",
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    ...patch,
  };
}

describe("publish execution state", () => {
  it("ignores old publishing jobs with reused content item ids", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
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
    await dataStore.saveTask({
      id: "task-1",
      productId: "product-1",
      status: "generation_completed",
      publishPlan: publishPlan(savedAt),
      createdAt: savedAt,
      updatedAt: savedAt,
    });
    await dataStore.saveContentPool(contentPool());
    await dataStore.savePublishingJob(oldPublishingJob());

    const state = await executionService.getPublishExecutionState();

    expect(state.stats).toMatchObject({
      total: 1,
      published: 0,
      remaining: 1,
      manualPending: 0,
      publishable: 1,
    });
    expect(state.articles[0]?.job).toBeUndefined();
    expect(state.articles[0]?.stage).toBe("pending");
    expect(state.articles[0]?.published).toBe(false);
    expect(state.articles[0]?.canRun).toBe(true);
    expect(state.currentArticle?.item.id).toBe("task-1-0001");
    expect(state.latestExecutionTime).toBeNull();
  });
});
