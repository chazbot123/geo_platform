import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccountRecord, ProductProfile, PublishTaskPlan, TaskRecord, ThemeSet } from "@/lib/types";

let tempDataDir: string | undefined;

async function resetDataDir() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-content-generation-test-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
}

afterEach(async () => {
  vi.useRealTimers();
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

function buildPublishPlan(updatedAt: string, patch: Partial<PublishTaskPlan> = {}): PublishTaskPlan {
  return {
    taskId: "task-1",
    enterpriseTaskId: "task-1",
    keywordTaskId: "task-1",
    searchProvider: "doubao",
    enabledPlatforms: [
      {
        platform: "toutiao",
        enabled: true,
        accountCount: 1,
        accountIds: ["account-1"],
        articleCount: 1,
      },
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

async function seedPlannedTask(options: { timestamp?: string; publishPlan?: Partial<PublishTaskPlan>; accountPlatform?: PlatformAccountRecord["platform"] } = {}) {
  await resetDataDir();
  const dataStore = await import("@/lib/storage/data-store");
  await dataStore.ensureStorageReady();

  const timestamp = options.timestamp ?? "2026-06-10T08:00:00.000Z";
  const product: ProductProfile = {
    id: "product-1",
    taskId: "task-1",
    productName: "GEO 发布助手",
    category: "企业内容运营工具",
    sellingPoints: "账号矩阵发布、风险检查、内容差异化",
    targetAudience: "本地服务企业运营负责人",
    city: "上海",
    scenarios: "多平台内容发布",
    brandTone: "专业、克制、可信",
  };
  const theme: ThemeSet = {
    taskId: "task-1",
    searchProvider: "doubao",
    audienceChannels: ["social"],
    mainKeyword: "企业内容发布怎么提高效率？",
    backupKeywords: [],
    relatedKeywords: [],
    trendKeywords: [],
    recommendedKeywords: [],
    candidateKeywords: [],
    scoreSummary: "已确认 5 个客户问题。",
    rankingSummary: "已确认 5 个客户问题。",
    selectedKeyword: "企业内容发布怎么提高效率？",
    selectedKeywordTheme: "企业内容发布怎么提高效率？、多账号发布如何控风险？、内容重复率高怎么办？、发布节奏怎么安排？、怎样判断内容能不能发布？",
    selectedKeywords: [
      "企业内容发布怎么提高效率？",
      "多账号发布如何控风险？",
      "内容重复率高怎么办？",
      "发布节奏怎么安排？",
      "怎样判断内容能不能发布？",
    ],
    updatedAt: timestamp,
  };
  const task: TaskRecord = {
    id: "task-1",
    productId: product.id,
    status: "task_planned",
    searchProvider: "doubao",
    publishPlan: buildPublishPlan(timestamp, options.publishPlan),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const account: PlatformAccountRecord = {
    id: "account-1",
    platform: options.accountPlatform ?? "toutiao",
    provider: "electron",
    authType: "session",
    accountName: "geo-operator",
    displayName: "GEO 运营号",
    status: "valid",
    loginStatus: "authenticated",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await dataStore.saveProduct(product);
  await dataStore.saveTheme(theme);
  await dataStore.saveTask(task);
  await dataStore.savePlatformAccount(account);
  return dataStore;
}

describe("content pool blackbox generation", () => {
  it("does not create content pool records while reading the current pool", async () => {
    const dataStore = await seedPlannedTask();
    const { getCurrentContentPool } = await import("@/lib/content/service");

    const result = await getCurrentContentPool();

    expect(result.current).toBeNull();
    expect(await dataStore.getContentPool("task-1")).toBeNull();
  });

  it("creates final article records only when generation is explicitly started", async () => {
    const dataStore = await seedPlannedTask();
    const contentService = (await import("@/lib/content/service")) as typeof import("@/lib/content/service") & {
      startContentGenerationBatch?: (taskId: string) => Promise<unknown>;
    };

    expect(typeof contentService.startContentGenerationBatch).toBe("function");
    await contentService.startContentGenerationBatch!("task-1");

    const record = await dataStore.getContentPool("task-1");
    const task = await dataStore.getTask("task-1");
    expect(task?.status).toBe("generation_completed");
    expect(record?.items).toHaveLength(1);
    expect(record?.items[0]?.status).toBe("pending_publish");
    expect(record?.items[0]?.body.trim().length).toBeGreaterThan(200);
    expect(record?.items[0]?.body).not.toContain("建议从需求背景、选择标准、风险提醒和行动建议四段组织");
  });

  it("creates queued publishing jobs after final articles are generated", async () => {
    const dataStore = await seedPlannedTask();
    const { startContentGenerationBatch } = await import("@/lib/content/service");

    await startContentGenerationBatch("task-1");

    const jobs = await dataStore.getPublishingJobsByTask("task-1");
    const record = await dataStore.getContentPool("task-1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("queued");
    expect(jobs[0]?.contentPoolItemId).toBe("task-1-0001");
    expect(jobs[0]?.plannedPublishTime).toBe(record?.items[0]?.plannedPublishTime);
  });

  it("generates the same number of articles as the task-scoped publish plan total", async () => {
    const dataStore = await seedPlannedTask({
      publishPlan: {
        enabledPlatforms: [
          {
            platform: "douyin",
            enabled: true,
            accountCount: 1,
            accountIds: ["account-1"],
            articleCount: 1,
          },
          {
            platform: "baijiahao",
            enabled: true,
            accountCount: 2,
            accountIds: ["account-2", "account-3"],
            articleCount: 2,
          },
          {
            platform: "toutiao",
            enabled: true,
            accountCount: 1,
            accountIds: ["account-4"],
            articleCount: 1,
          },
        ],
        totalAccountCount: 4,
        totalArticleCount: 4,
      },
    });
    const { startContentGenerationBatch } = await import("@/lib/content/service");

    await startContentGenerationBatch("task-1");

    const task = await dataStore.getTask("task-1");
    const record = await dataStore.getContentPool("task-1");
    expect(task?.publishPlan?.totalAccountCount).toBe(4);
    expect(task?.publishPlan?.totalArticleCount).toBe(4);
    expect(record?.items).toHaveLength(4);
    expect(record?.totalArticleCount).toBe(4);
  }, 15_000);

  it("uses each platform plan provider when generating a multi-provider content pool", async () => {
    const dataStore = await seedPlannedTask({
      publishPlan: {
        searchProvider: "doubao",
        searchProviders: ["doubao", "deepseek"],
        enabledPlatforms: [
          {
            platform: "douyin",
            searchProvider: "doubao",
            enabled: true,
            accountCount: 1,
            accountIds: ["douyin-account"],
            articleCount: 1,
          },
          {
            platform: "csdn",
            searchProvider: "deepseek",
            enabled: true,
            accountCount: 1,
            accountIds: ["csdn-account"],
            articleCount: 1,
          },
        ],
        totalAccountCount: 2,
        totalArticleCount: 2,
      },
    });
    const { startContentGenerationBatch } = await import("@/lib/content/service");

    await startContentGenerationBatch("task-1");

    const record = await dataStore.getContentPool("task-1");
    expect(record?.items).toHaveLength(2);
    expect(record?.items.map((item) => [item.publishPlatform, item.aiPlatform])).toEqual([
      ["douyin", "doubao"],
      ["csdn", "deepseek"],
    ]);
    expect(record?.items.map((item) => item.generationInputSnapshot?.searchProvider)).toEqual(["doubao", "deepseek"]);
  }, 15_000);

  it("keeps the generated batch completed when one auto publishing job is blocked by platform preflight", async () => {
    const dataStore = await seedPlannedTask({
      accountPlatform: "douyin",
      publishPlan: {
        enabledPlatforms: [
          {
            platform: "douyin",
            enabled: true,
            accountCount: 1,
            accountIds: ["account-1"],
            articleCount: 1,
          },
        ],
      },
    });
    const { startContentGenerationBatch } = await import("@/lib/content/service");

    await startContentGenerationBatch("task-1");

    const task = await dataStore.getTask("task-1");
    const record = await dataStore.getContentPool("task-1");
    const jobs = await dataStore.getPublishingJobsByTask("task-1");
    expect(task?.status).toBe("generation_completed");
    expect(jobs).toHaveLength(0);
    expect(record?.items[0]?.status).toBe("manual_pending");
    expect(record?.items[0]?.failedReason).toContain("抖音发布建议携带视频或图片素材");
    expect(record?.items[0]?.stageLog?.some((entry) => entry.stage === "publish_queue_failed")).toBe(true);
  });

  it("stores generation input snapshots and separates customer questions from platform topic tags", async () => {
    const dataStore = await seedPlannedTask({
      timestamp: "2026-06-15T01:20:00.000Z",
    });
    const { startContentGenerationBatch } = await import("@/lib/content/service");

    await startContentGenerationBatch("task-1");

    const record = await dataStore.getContentPool("task-1");
    const item = record?.items[0];
    expect(record?.items).toHaveLength(1);
    expect(record?.generationInputSnapshot).toMatchObject({
      taskId: "task-1",
      publishPlanUpdatedAt: "2026-06-15T01:20:00.000Z",
      product: {
        productName: "GEO 发布助手",
        category: "企业内容运营工具",
        region: "上海",
      },
      keywordSet: {
        selectedQuestions: expect.arrayContaining(["企业内容发布怎么提高效率？"]),
      },
    });
    expect(item?.generationInputSnapshot).toMatchObject({
      productName: "GEO 发布助手",
      keywordText: "企业内容发布怎么提高效率？",
      publishPlatform: "toutiao",
      plannedPublishTime: item?.plannedPublishTime,
    });
    expect(item?.generationInputSnapshot?.productUpdatedAt).toBeUndefined();
    expect(item?.keywordText).toBe("企业内容发布怎么提高效率？");
    expect(item?.topicTags?.length).toBeGreaterThan(0);
    expect(item?.topicTags).not.toContain(item?.keywordText);
  });

  it("does not schedule pending publish articles before generation time", async () => {
    vi.useFakeTimers({ now: new Date("2026-06-15T06:28:00.000Z"), toFake: ["Date"] });
    const dataStore = await seedPlannedTask({
      timestamp: "2026-06-15T01:20:00.000Z",
      publishPlan: {
        timeWindow: { start: "09:00", end: "18:00" },
        articlesPerAccountPerDay: 1,
      },
    });
    const { startContentGenerationBatch } = await import("@/lib/content/service");

    await startContentGenerationBatch("task-1");

    const record = await dataStore.getContentPool("task-1");
    const item = record?.items[0];
    expect(item?.status).toBe("pending_publish");
    expect(new Date(item?.plannedPublishTime ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(item?.updatedAt ?? 0).getTime(),
    );
  });

  it("keeps one planned publish slot per day when a multi-day plan starts after today's slot", async () => {
    vi.useFakeTimers({ now: new Date("2026-06-15T07:35:00.000Z"), toFake: ["Date"] });
    const dataStore = await seedPlannedTask({
      timestamp: "2026-06-15T07:35:03.636Z",
      publishPlan: {
        days: 3,
        articlesPerAccountPerDay: 1,
        totalArticleCount: 3,
      },
    });
    const { startContentGenerationBatch } = await import("@/lib/content/service");

    await startContentGenerationBatch("task-1");

    const record = await dataStore.getContentPool("task-1");
    const plannedDays = (record?.items ?? []).map((item) => item.plannedPublishTime.slice(0, 10));
    expect(plannedDays).toEqual(["2026-06-16", "2026-06-17", "2026-06-18"]);
  });
});
