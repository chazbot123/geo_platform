import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentPoolItem, ContentPoolRecord, PlatformAccountRecord, PublishingJobRecord } from "@/lib/types";

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

function platformAccount(patch: Partial<PlatformAccountRecord> = {}): PlatformAccountRecord {
  return {
    id: "new-account",
    platform: "xiaohongshu",
    provider: "electron",
    authType: "session",
    accountName: "XHS Account",
    status: "active",
    loginStatus: "authenticated",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    ...patch,
  };
}

function readyContentPoolItem(patch: Partial<ContentPoolItem> = {}): ContentPoolItem {
  const base = contentPool().items[0];
  return {
    ...base,
    publishPlatform: "xiaohongshu",
    accountName: "XHS Account",
    keywordText: "智能网关",
    title: "小红书发布测试标题",
    body: "小红书正文".repeat(160),
    imageList: [
      {
        id: "image-1",
        prompt: "产品图",
        url: "https://example.com/image.jpg",
        localPath: "local-image.jpg",
        status: "generated",
      },
    ],
    publishable: true,
    status: "pending_publish",
    displayStatus: "pending_publish",
    pipeline: {
      negativeCheck: { status: "passed", hits: [] },
      riskReview: { status: "passed", level: "low", message: "passed" },
      sampleDraft: { status: "passed", passed: true },
      styleAdaptation: { status: "passed", platform: "xiaohongshu", notes: [] },
      dispersion: { status: "passed", changedDimensions: [], message: "passed" },
      imageGeneration: {
        status: "passed",
        prompt: "产品图",
        images: [
          {
            id: "image-1",
            prompt: "产品图",
            url: "https://example.com/image.jpg",
            localPath: "local-image.jpg",
            status: "generated",
          },
        ],
      },
    },
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

  it("keeps pending-review publishing jobs out of the published content state", async () => {
    const { dataStore, jobsService } = await loadIsolatedServices();
    const basePool = contentPool();
    await dataStore.saveContentPool(
      contentPool({
        items: basePool.items.map((item) => ({
          ...item,
          title: "可发布标题",
          body: "可发布正文",
          publishPlatform: "weibo",
          accountId: "new-account",
          plannedPublishTime: "2026-06-12T09:00:00.000Z",
          publishable: true,
          pipeline: {
            ...item.pipeline,
            negativeCheck: { status: "passed", hits: [] },
            riskReview: { status: "passed", level: "low", message: "通过" },
            sampleDraft: { status: "passed", passed: true },
            styleAdaptation: { status: "passed", platform: "weibo", notes: [] },
            dispersion: { status: "passed", changedDimensions: [], message: "通过" },
          },
          status: "pending_publish",
          displayStatus: "pending_publish",
        })),
        generatedArticleCount: 1,
        generatingArticleCount: 0,
        pendingPublishArticleCount: 1,
      }),
    );
    await dataStore.savePublishingJob(
      publishingJob({
        status: "pending_review",
        platform: "weibo",
        contentPoolItemId: "task-1-0001",
        contentSequence: 1,
        accountId: "new-account",
        plannedPublishTime: "2026-06-12T09:00:00.000Z",
      }),
    );

    await jobsService.reconcileContentPoolPublishingStatuses("task-1");

    const pool = await dataStore.getContentPool("task-1");
    expect(pool?.items[0]?.status).toBe("pending_review");
    expect(pool?.items[0]?.displayStatus).toBe("pending_review");
  });

  it("syncs submitted and pending-review publishing jobs without showing them as pending publish", async () => {
    const { dataStore, jobsService } = await loadIsolatedServices();
    const item = readyContentPoolItem({
      publishPlatform: "xiaohongshu",
      status: "pending_publish",
      displayStatus: "pending_publish",
      plannedPublishTime: "2026-06-12T09:00:00.000Z",
    });
    await dataStore.saveContentPool(
      contentPool({
        items: [item],
        generatedArticleCount: 1,
        generatingArticleCount: 0,
        pendingPublishArticleCount: 1,
      }),
    );

    await dataStore.savePublishingJob(
      publishingJob({
        id: "submitted-job",
        status: "submitted",
        platform: "xiaohongshu",
        contentPoolItemId: item.id,
        contentSequence: item.sequence,
        accountId: item.accountId,
        plannedPublishTime: item.plannedPublishTime,
        updatedAt: "2026-06-12T10:10:00.000Z",
      }),
    );

    await jobsService.reconcileContentPoolPublishingStatuses("task-1");

    const submittedPool = await dataStore.getContentPool("task-1");
    expect(submittedPool?.items[0]?.status).toBe("submitted");
    expect(submittedPool?.items[0]?.displayStatus).toBe("submitted");
    expect(submittedPool?.items[0]?.stageMessage).toBe("已提交，等待平台确认。");
    expect(submittedPool?.pendingPublishArticleCount).toBe(0);

    await dataStore.savePublishingJob(
      publishingJob({
        id: "pending-review-job",
        status: "pending_review",
        platform: "xiaohongshu",
        contentPoolItemId: item.id,
        contentSequence: item.sequence,
        accountId: item.accountId,
        plannedPublishTime: item.plannedPublishTime,
        updatedAt: "2026-06-12T10:20:00.000Z",
      }),
    );

    await jobsService.reconcileContentPoolPublishingStatuses("task-1");

    const reviewPool = await dataStore.getContentPool("task-1");
    expect(reviewPool?.items[0]?.status).toBe("pending_review");
    expect(reviewPool?.items[0]?.displayStatus).toBe("pending_review");
    expect(reviewPool?.items[0]?.stageMessage).toBe("平台审核中，等待结果确认。");
    expect(reviewPool?.pendingPublishArticleCount).toBe(0);
  });
});

describe("content-pool publishing job draft limits", () => {
  it("blocks content-pool publishing jobs when xiaohongshu body exceeds the hard limit", async () => {
    const { dataStore, jobsService } = await loadIsolatedServices();
    await dataStore.savePlatformAccount(platformAccount());
    const item = readyContentPoolItem({
      body: "这是一段用于发布前硬限制校验的正文，必须在创建任务前给出中文阻断原因。".repeat(80),
      keywordText: "智能网关怎么选才不会踩坑",
    });

    await expect(jobsService.createContentPoolPublishingJob({ item })).rejects.toThrow(
      "正文超过小红书发布限制，请重新生成或压缩后再发布",
    );
  });

  it("creates a xiaohongshu job when the body and short tag pass preflight", async () => {
    const { dataStore, jobsService } = await loadIsolatedServices();
    await dataStore.savePlatformAccount(platformAccount());
    const item = readyContentPoolItem({
      body: "这是一段用于小红书发布的正文，包含场景、判断标准和避坑提醒。".repeat(8),
      keywordText: "智能网关避坑",
    });

    const job = await jobsService.createContentPoolPublishingJob({ item });

    const noteBody = [job.draftBody, ...job.draftTags.map((tag) => `#${tag.replace(/^#/, "")}`)]
      .filter(Boolean)
      .join("\n\n");
    expect(noteBody.length).toBeLessThanOrEqual(1000);
    expect(noteBody.endsWith("#智能网关避坑")).toBe(true);
    expect(job.status).toBe("queued");
  });

  it("uses generated topic tags before falling back to the full customer question", async () => {
    const { dataStore, jobsService } = await loadIsolatedServices();
    await dataStore.savePlatformAccount(platformAccount());
    const item = readyContentPoolItem({
      body: "这是一段用于小红书发布的正文，包含场景、判断标准和避坑提醒。".repeat(8),
      keywordText: "客户问：北京企业做GEO优化怎么判断服务商是否靠谱？需要看哪些案例和风险？",
      topicTags: ["北京企业", "GEO优化", "服务商靠谱"],
    });

    const job = await jobsService.createContentPoolPublishingJob({ item });

    expect(job.draftTags).toEqual(["北京企业", "GEO优化", "服务商靠谱"]);
    expect(job.draftTags).not.toContain(item.keywordText);
  });
});
