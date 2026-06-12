import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentPoolRecord, PublishingJobRecord } from "@/lib/types";

let tempDataDir: string | undefined;

async function loadIsolatedServices() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-publish-jobs-test-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  const [dataStore, jobsService] = await Promise.all([
    import("@/lib/storage/data-store"),
    import("@/lib/publish/jobs-service"),
  ]);
  await dataStore.ensureStorageReady();
  return { dataStore, jobsService };
}

afterEach(async () => {
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

function contentPool(patch: Partial<ContentPoolRecord> = {}): ContentPoolRecord {
  return {
    taskId: "task-1",
    sourcePublishPlanUpdatedAt: "2026-06-12T10:00:00.000Z",
    currentTaskId: "task-1",
    items: [
      {
        id: "task-1-0001",
        sequence: 1,
        taskId: "task-1",
        aiPlatform: "tongyi",
        publishPlatform: "weibo",
        accountId: "new-account",
        accountName: "微博账号",
        keywordId: "keyword-1",
        keywordSequence: 1,
        keywordText: "客户问题",
        accountKeywordOffset: 0,
        plannedPublishTime: "2026-06-12T09:00:00.000Z",
        title: "",
        summary: "",
        body: "",
        imagePrompt: "",
        imageList: [],
        riskLevel: "low",
        status: "generating",
        pipeline: {
          negativeCheck: { status: "pending", hits: [] },
          riskReview: { status: "pending", level: "low", message: "等待后台开始处理。" },
          sampleDraft: { status: "pending", passed: false },
          styleAdaptation: { status: "pending", platform: "weibo", notes: [] },
          dispersion: { status: "pending", changedDimensions: [], message: "等待进入差异化处理。" },
          imageGeneration: { status: "pending", prompt: "", images: [] },
        },
        publishable: false,
        displayStatus: "generating",
        internalStage: "draft_generating",
        stageMessage: "正在生成正文。",
        stageLog: [],
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T10:00:00.000Z",
      },
    ],
    retryQueueStatus: "idle",
    generatedAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    totalArticleCount: 1,
    generatedArticleCount: 0,
    generatingArticleCount: 1,
    failedArticleCount: 0,
    pendingPublishArticleCount: 0,
    ...patch,
  };
}

function publishingJob(patch: Partial<PublishingJobRecord> = {}): PublishingJobRecord {
  return {
    id: "job-1",
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
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    ...patch,
  };
}

describe("publishing job content-pool reconciliation", () => {
  it("does not let old publishing jobs mark a new empty generation item as published", async () => {
    const { dataStore, jobsService } = await loadIsolatedServices();
    await dataStore.saveContentPool(contentPool());
    await dataStore.savePublishingJob(publishingJob());

    await jobsService.reconcileContentPoolPublishingStatuses("task-1");

    const record = await dataStore.getContentPool("task-1");
    expect(record?.items[0]?.status).toBe("generating");
    expect(record?.items[0]?.stageMessage).toBe("正在生成正文。");
    expect(record?.generatedArticleCount).toBe(0);
  });
});
