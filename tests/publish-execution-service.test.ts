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

function publishPlan(
  updatedAt = "2026-06-12T10:00:00.000Z",
  patch: Partial<NonNullable<TaskRecord["publishPlan"]>> = {},
): TaskRecord["publishPlan"] {
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
    ...patch,
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
    accountName: "Account",
    keywordId: "keyword-1",
    keywordSequence: 1,
    keywordText: "GEO search optimization",
    accountKeywordOffset: 0,
    plannedPublishTime: "2026-06-12T09:00:00.000Z",
    title: "Title",
    summary: "Summary",
    body: "Body",
    imagePrompt: "",
    imageList: [],
    riskLevel: "low",
    status: "pending_publish",
    pipeline: {
      negativeCheck: { status: "passed", hits: [] },
      riskReview: { status: "passed", level: "low", message: "ok" },
      sampleDraft: { status: "passed", passed: true },
      styleAdaptation: { status: "passed", platform: "xiaohongshu", notes: [] },
      dispersion: { status: "passed", changedDimensions: [], message: "ok" },
      imageGeneration: { status: "passed", prompt: "", images: [] },
    },
    publishable: true,
    displayStatus: "pending_publish",
    internalStage: "ready",
    stageMessage: "Ready",
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

function publishingJob(patch: Partial<PublishingJobRecord> = {}): PublishingJobRecord {
  return {
    id: "old-job",
    taskId: "task-1",
    platform: "douyin",
    contentPoolItemId: "task-1-0001",
    contentSequence: 1,
    plannedPublishTime: "2026-06-10T09:00:00.000Z",
    accountId: "old-account",
    accountName: "Old Account",
    executionMode: "electron_automation",
    status: "published",
    draftTitle: "Old title",
    draftBody: "Old body",
    draftTags: [],
    draftImages: [],
    draftImagePaths: [],
    publishedAt: "2026-06-10T10:00:00.000Z",
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    ...patch,
  };
}

async function saveManualPendingFixture(dataStore: Awaited<ReturnType<typeof loadIsolatedServices>>["dataStore"]) {
  await dataStore.savePlatformAccount({
    id: "new-account",
    platform: "xiaohongshu",
    provider: "electron",
    authType: "session",
    accountName: "Account",
    status: "active",
    riskState: "active",
    loginStatus: "authenticated",
    sessionPartition: "persist:test",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
  });
  await dataStore.saveContentPool(contentPool());
  await dataStore.savePublishingJob(
    publishingJob({
      id: "manual-job",
      platform: "xiaohongshu",
      accountId: "new-account",
      plannedPublishTime: "2026-06-12T09:00:00.000Z",
      status: "manual_pending",
      publishedAt: undefined,
    }),
  );
}

describe("publish execution state", () => {
  it("ignores old publishing jobs with reused content item ids", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    const savedAt = "2026-06-12T10:00:00.000Z";

    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "GEO Platform",
      category: "software",
      sellingPoints: "search optimization",
      targetAudience: "enterprise customers",
      scenarios: "content publishing",
      brandTone: "professional",
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
    await dataStore.savePublishingJob(publishingJob());

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

  it("does not count submitted or pending-review jobs as published", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    const savedAt = "2026-06-12T10:00:00.000Z";

    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "GEO Platform",
      category: "software",
      sellingPoints: "search optimization",
      targetAudience: "enterprise customers",
      scenarios: "content publishing",
      brandTone: "professional",
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
    await dataStore.savePublishingJob(
      publishingJob({
        id: "submitted-job",
        platform: "xiaohongshu",
        accountId: "new-account",
        plannedPublishTime: "2026-06-12T09:00:00.000Z",
        status: "pending_review",
        submittedAt: "2026-06-12T10:05:00.000Z",
        publishedAt: undefined,
        updatedAt: "2026-06-12T10:05:00.000Z",
      }),
    );

    const state = await executionService.getPublishExecutionState();

    expect(state.stats).toMatchObject({
      total: 1,
      published: 0,
      remaining: 1,
      manualPending: 0,
      publishable: 1,
    });
    expect(state.articles[0]?.published).toBe(false);
    expect(state.articles[0]?.stage).toBe("pending_review");
  });

  it("allows manual confirmation without a publish URL and records operator evidence", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    await saveManualPendingFixture(dataStore);

    const state = await executionService.markArticleManualPublished("manual-job");
    const jobs = await dataStore.getPublishingJobsByTask("task-1");
    const job = jobs.find((item) => item.id === "manual-job");

    expect(job?.status).toBe("published");
    expect(job?.publishUrl).toBeUndefined();
    expect(job?.verificationEvidence).toBe("manual_operator_confirmation");
    expect(job?.notes).toContain("人工确认");
    expect(state.stats.published).toBe(1);
    expect(state.articles[0]?.item.status).toBe("published");
  });

  it("keeps publish URL evidence when manual confirmation includes a URL", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    await saveManualPendingFixture(dataStore);

    await executionService.markArticleManualPublished("manual-job", "https://example.test/published/1");
    const jobs = await dataStore.getPublishingJobsByTask("task-1");
    const job = jobs.find((item) => item.id === "manual-job");

    expect(job?.status).toBe("published");
    expect(job?.publishUrl).toBe("https://example.test/published/1");
    expect(job?.verificationEvidence).toBe("manual_publish_url");
  });

  it("requeues a manually checked article when the operator confirms it was not published", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    await saveManualPendingFixture(dataStore);
    await dataStore.savePublishingJob(
      publishingJob({
        id: "manual-job",
        platform: "xiaohongshu",
        accountId: "new-account",
        plannedPublishTime: "2026-06-12T09:00:00.000Z",
        status: "verification_failed",
        publishUrl: "https://example.test/stale",
        publishedAt: "2026-06-12T10:05:00.000Z",
        verifiedAt: "2026-06-12T10:05:00.000Z",
        finishedAt: "2026-06-12T10:05:00.000Z",
        queueBlockedReason: "account_daily_cap_reached",
        nextRunAt: "2026-06-13T09:00:00.000Z",
        verificationEvidence: "success_then_blocking",
      }),
    );

    const state = await executionService.markArticleManualNotPublished("manual-job");
    const job = (await dataStore.getPublishingJobsByTask("task-1")).find((item) => item.id === "manual-job");
    const pool = await dataStore.getContentPool("task-1");

    expect(job?.status).toBe("queued");
    expect(job?.publishUrl).toBeUndefined();
    expect(job?.publishedAt).toBeUndefined();
    expect(job?.verifiedAt).toBeUndefined();
    expect(job?.finishedAt).toBeUndefined();
    expect(job?.queueBlockedReason).toBeUndefined();
    expect(job?.nextRunAt).toBeUndefined();
    expect(job?.verificationEvidence).toBe("manual_not_published");
    expect(job?.notes).toContain("人工核查确认平台未发布");
    expect(pool?.items[0]?.status).toBe("pending_publish");
    expect(state.currentArticle?.job?.status).toBe("queued");
    expect(state.stats.published).toBe(0);
  });

  it("allows manual publish confirmation for queued scheduled jobs", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    await saveManualPendingFixture(dataStore);
    await dataStore.savePublishingJob(
      publishingJob({
        id: "queued-job",
        platform: "xiaohongshu",
        accountId: "new-account",
        plannedPublishTime: "2026-06-12T09:00:00.000Z",
        status: "queued",
        publishedAt: undefined,
      }),
    );

    const state = await executionService.markArticleManualPublished("queued-job");
    const job = (await dataStore.getPublishingJobsByTask("task-1")).find((item) => item.id === "queued-job");

    expect(job?.status).toBe("published");
    expect(job?.verificationEvidence).toBe("manual_operator_confirmation");
    expect(state.stats.published).toBe(1);
    expect(state.articles[0]?.item.status).toBe("published");
  });

  it("clears stale scheduled queue blocking when the planned time is already due", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    await saveManualPendingFixture(dataStore);
    await dataStore.savePublishingJob(
      publishingJob({
        id: "stale-scheduled-job",
        platform: "xiaohongshu",
        accountId: "new-account",
        plannedPublishTime: "2026-06-12T09:00:00.000Z",
        plannedPublishTimeManualOverrideAt: "2026-06-12T08:50:00.000Z",
        status: "queued",
        queueBlockedReason: "job_scheduled_for_later",
        nextRunAt: "2026-06-13T09:00:00.000Z",
        publishedAt: undefined,
        updatedAt: "2026-06-12T08:55:00.000Z",
      }),
    );

    const state = await executionService.getPublishExecutionState("task-1", new Date("2026-06-12T09:05:00.000Z"));
    const job = state.articles[0]?.job;

    expect(job?.queueBlockedReason).toBeUndefined();
    expect(job?.nextRunAt).toBeUndefined();
    expect(state.currentArticle?.job?.id).toBe("stale-scheduled-job");
    expect(state.currentArticle?.canRun).toBe(true);
  });

  it("repairs duplicate planned days for unstarted queued jobs in a per-account daily plan", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    const savedAt = "2026-06-15T07:35:03.636Z";
    const duplicateSchedule = ["2026-06-16T08:23:00.000Z", "2026-06-16T08:23:00.000Z", "2026-06-17T01:06:00.000Z"];

    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "GEO Platform",
      category: "software",
      sellingPoints: "search optimization",
      targetAudience: "enterprise customers",
      scenarios: "content publishing",
      brandTone: "professional",
    });
    await dataStore.saveTask({
      id: "task-1",
      productId: "product-1",
      status: "generation_completed",
      publishPlan: publishPlan(savedAt, {
        days: 3,
        articlesPerAccountPerDay: 1,
        totalArticleCount: 3,
        enabledPlatforms: [
          { platform: "xiaohongshu", enabled: true, accountCount: 1, accountIds: ["new-account"], articleCount: 3 },
        ],
      }),
      createdAt: savedAt,
      updatedAt: savedAt,
    });
    await dataStore.saveContentPool(
      contentPool({
        items: duplicateSchedule.map((plannedPublishTime, index) =>
          contentItem({
            id: `task-1-000${index + 1}`,
            sequence: index + 1,
            plannedPublishTime,
          }),
        ),
        sourcePublishPlanUpdatedAt: savedAt,
        generatedAt: savedAt,
        updatedAt: savedAt,
      }),
    );
    await Promise.all(
      duplicateSchedule.map((plannedPublishTime, index) =>
        dataStore.savePublishingJob(
          publishingJob({
            id: `queued-job-${index + 1}`,
            platform: "xiaohongshu",
            contentPoolItemId: `task-1-000${index + 1}`,
            contentSequence: index + 1,
            accountId: "new-account",
            plannedPublishTime,
            status: "queued",
            publishedAt: undefined,
          }),
        ),
      ),
    );

    await executionService.getPublishExecutionState("task-1");

    const record = await dataStore.getContentPool("task-1");
    const jobs = await dataStore.getPublishingJobsByTask("task-1");
    expect((record?.items ?? []).map((item) => item.plannedPublishTime.slice(0, 10))).toEqual([
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
    ]);
    expect(
      jobs
        .sort((left, right) => (left.contentSequence ?? 0) - (right.contentSequence ?? 0))
        .map((job) => job.plannedPublishTime?.slice(0, 10)),
    ).toEqual(["2026-06-16", "2026-06-17", "2026-06-18"]);
  });

  it("keeps manually overridden planned time when schedule repair runs", async () => {
    const { dataStore, executionService } = await loadIsolatedServices();
    const savedAt = "2026-06-15T07:35:03.636Z";
    const manualOverrideTime = "2026-06-15T08:14:00.000Z";

    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "GEO Platform",
      category: "software",
      sellingPoints: "search optimization",
      targetAudience: "enterprise customers",
      scenarios: "content publishing",
      brandTone: "professional",
    });
    await dataStore.saveTask({
      id: "task-1",
      productId: "product-1",
      status: "generation_completed",
      publishPlan: publishPlan(savedAt, {
        days: 2,
        articlesPerAccountPerDay: 1,
        totalArticleCount: 2,
        enabledPlatforms: [
          { platform: "xiaohongshu", enabled: true, accountCount: 1, accountIds: ["new-account"], articleCount: 2 },
        ],
      }),
      createdAt: savedAt,
      updatedAt: savedAt,
    });
    await dataStore.saveContentPool(
      contentPool({
        items: [
          contentItem({ id: "task-1-0001", sequence: 1, plannedPublishTime: "2026-06-15T01:20:00.000Z" }),
          contentItem({
            id: "task-1-0002",
            sequence: 2,
            plannedPublishTime: manualOverrideTime,
            plannedPublishTimeManualOverrideAt: "2026-06-15T08:13:00.000Z",
          }),
        ],
        sourcePublishPlanUpdatedAt: savedAt,
      }),
    );
    await dataStore.savePublishingJob(
      publishingJob({
        id: "manual-override-job",
        platform: "xiaohongshu",
        contentPoolItemId: "task-1-0002",
        contentSequence: 2,
        accountId: "new-account",
        plannedPublishTime: manualOverrideTime,
        plannedPublishTimeManualOverrideAt: "2026-06-15T08:13:00.000Z",
        status: "queued",
        publishedAt: undefined,
      }),
    );

    await executionService.getPublishExecutionState("task-1");

    const record = await dataStore.getContentPool("task-1");
    const jobs = await dataStore.getPublishingJobsByTask("task-1");
    expect(record?.items.find((item) => item.id === "task-1-0002")?.plannedPublishTime).toBe(manualOverrideTime);
    expect(jobs.find((job) => job.id === "manual-override-job")?.plannedPublishTime).toBe(manualOverrideTime);
  });
});
