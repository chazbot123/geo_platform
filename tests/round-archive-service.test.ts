import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentPoolItem, ContentPoolRecord, PublishingJobRecord, TaskRecord } from "@/lib/types";

let tempDataDir: string | undefined;

async function loadIsolatedServices() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-round-archive-test-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  const [dataStore, archiveService] = await Promise.all([
    import("@/lib/storage/data-store"),
    import("@/lib/tasks/round-archive-service"),
  ]);
  await dataStore.ensureStorageReady();
  return { dataStore, archiveService };
}

afterEach(async () => {
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

const savedAt = "2026-06-15T02:00:00.000Z";
const workbenchTaskId = "customer-workbench-task";

function publishPlan(): TaskRecord["publishPlan"] {
  return {
    taskId: workbenchTaskId,
    enterpriseTaskId: workbenchTaskId,
    keywordTaskId: workbenchTaskId,
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
    createdAt: savedAt,
    updatedAt: savedAt,
  };
}

function contentItem(): ContentPoolItem {
  return {
    id: `${workbenchTaskId}-0001`,
    sequence: 1,
    taskId: workbenchTaskId,
    aiPlatform: "tongyi",
    publishPlatform: "weibo",
    accountId: "account-1",
    keywordId: "keyword-1",
    keywordSequence: 1,
    keywordText: "旧一轮 GEO 关键词怎么继续发布？",
    accountKeywordOffset: 0,
    plannedPublishTime: savedAt,
    title: "旧一轮标题",
    summary: "旧一轮摘要",
    body: "旧一轮正文",
    imagePrompt: "",
    imageList: [],
    riskLevel: "low",
    status: "pending_publish",
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
  };
}

describe("GEO round archive service", () => {
  it("copies the current workbench round into an independent resumable task", async () => {
    const { dataStore, archiveService } = await loadIsolatedServices();

    await dataStore.saveProduct({
      id: "customer-workbench-product",
      taskId: workbenchTaskId,
      productName: "极之道 GEO",
      category: "GEO 优化",
      sellingPoints: "搜索优化",
      targetAudience: "本地企业",
      scenarios: "继续发布",
      brandTone: "专业",
    });
    await dataStore.saveTheme({
      taskId: workbenchTaskId,
      searchProvider: "tongyi",
      audienceChannels: ["social"],
      mainKeyword: "GEO 搜索优化",
      backupKeywords: [],
      relatedKeywords: [],
      trendKeywords: [],
      candidateKeywords: [],
      scoreSummary: "旧一轮",
      rankingSummary: "已保存 5 个核心问题",
      selectedKeywords: [
        "旧一轮问题 1",
        "旧一轮问题 2",
        "旧一轮问题 3",
        "旧一轮问题 4",
        "旧一轮问题 5",
      ],
      selectedKeywordTheme: "旧一轮问题 1、旧一轮问题 2、旧一轮问题 3、旧一轮问题 4、旧一轮问题 5",
      updatedAt: savedAt,
    });
    await dataStore.saveTask({
      id: workbenchTaskId,
      productId: "customer-workbench-product",
      status: "generation_completed",
      searchProvider: "tongyi",
      publishPlan: publishPlan(),
      selectedKeyword: "旧一轮问题 1、旧一轮问题 2、旧一轮问题 3、旧一轮问题 4、旧一轮问题 5",
      createdAt: savedAt,
      updatedAt: savedAt,
    });
    await dataStore.saveContent({
      taskId: workbenchTaskId,
      title: "旧一轮报告",
      summary: "旧一轮摘要",
      content: "旧一轮内容",
      selectedKeywords: ["旧一轮问题 1", "旧一轮问题 2"],
      faq: [],
      cta: "",
      updatedAt: savedAt,
    });
    await dataStore.saveContentPool({
      taskId: workbenchTaskId,
      sourcePublishPlanUpdatedAt: savedAt,
      currentTaskId: workbenchTaskId,
      items: [contentItem()],
      totalArticleCount: 1,
      generatedArticleCount: 1,
      pendingPublishArticleCount: 1,
      generatedAt: savedAt,
      updatedAt: savedAt,
    } satisfies ContentPoolRecord);
    await dataStore.savePublishingJob({
      id: "job-1",
      taskId: workbenchTaskId,
      platform: "weibo",
      contentPoolItemId: `${workbenchTaskId}-0001`,
      contentSequence: 1,
      keywordText: "旧一轮 GEO 关键词怎么继续发布？",
      accountId: "account-1",
      executionMode: "electron_automation",
      status: "manual_pending",
      draftTitle: "旧一轮标题",
      draftBody: "旧一轮正文",
      draftTags: [],
      draftImages: [],
      draftImagePaths: [],
      createdAt: savedAt,
      updatedAt: savedAt,
    } satisfies PublishingJobRecord);

    const result = await archiveService.archiveCurrentWorkbenchRound({ reason: "before_keyword_regeneration" });

    expect(result?.archivedTaskId).toMatch(/^geo-round-/);
    expect(result?.archivedTaskId).not.toBe(workbenchTaskId);
    const archivedTaskId = result!.archivedTaskId;
    const archivedTask = await dataStore.getTask(archivedTaskId);
    const archivedTheme = await dataStore.getTheme(archivedTaskId);
    const archivedContent = await dataStore.getContent(archivedTaskId);
    const archivedPool = await dataStore.getContentPool(archivedTaskId);
    const archivedJobs = await dataStore.getPublishingJobsByTask(archivedTaskId);

    expect(archivedTask?.id).toBe(archivedTaskId);
    expect(archivedTask?.publishPlan?.taskId).toBe(archivedTaskId);
    expect(archivedTheme?.selectedKeywords).toEqual(["旧一轮问题 1", "旧一轮问题 2", "旧一轮问题 3", "旧一轮问题 4", "旧一轮问题 5"]);
    expect(archivedContent?.taskId).toBe(archivedTaskId);
    expect(archivedPool?.items[0]?.taskId).toBe(archivedTaskId);
    expect(archivedPool?.items[0]?.id).toBe(`${archivedTaskId}-0001`);
    expect(archivedJobs).toHaveLength(1);
    expect(archivedJobs[0]?.taskId).toBe(archivedTaskId);
    expect(archivedJobs[0]?.contentPoolItemId).toBe(`${archivedTaskId}-0001`);

    const workbenchTask = await dataStore.getTask(workbenchTaskId);
    expect(workbenchTask?.id).toBe(workbenchTaskId);
  });
});
