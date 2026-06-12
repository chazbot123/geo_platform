import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountPublishingDraft, PlatformAccountRecord, PublishingDraft, PublishingJobRecord, TaskRecord } from "@/lib/types";

let tempDataDir: string | undefined;

async function loadIsolatedStore() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-account-dedup-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  const [dataStore, accountsService] = await Promise.all([
    import("@/lib/storage/data-store"),
    import("@/lib/publish/accounts-service"),
  ]);
  await dataStore.ensureStorageReady();
  return { dataStore, accountsService };
}

afterEach(async () => {
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

describe("account login deduplication", () => {
  it("keeps one record when the same platform account logs in again", async () => {
    const { dataStore, accountsService } = await loadIsolatedStore();
    const timestamp = "2026-06-11T09:00:00.000Z";

    await dataStore.savePlatformAccount({
      id: "weibo-original",
      platform: "weibo",
      provider: "electron",
      authType: "session",
      accountName: "weibo-account-090100",
      displayName: "旧微博账号",
      platformAccountId: "wb-user-1",
      sessionPartition: "persist:geo-platform-weibo-original",
      status: "valid",
      loginStatus: "authenticated",
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies PlatformAccountRecord);

    await dataStore.savePlatformAccount({
      id: "weibo-duplicate",
      platform: "weibo",
      provider: "electron",
      authType: "session",
      accountName: "weibo-account-090200",
      displayName: "微博",
      sessionPartition: "persist:geo-platform-weibo-duplicate",
      status: "saved",
      loginStatus: "pending",
      createdAt: "2026-06-11T09:05:00.000Z",
      updatedAt: "2026-06-11T09:05:00.000Z",
    } satisfies PlatformAccountRecord);

    await dataStore.saveTask({
      id: "task-1",
      productId: "product-1",
      status: "task_planned",
      publishPlan: {
        taskId: "task-1",
        enterpriseTaskId: "task-1",
        keywordTaskId: "task-1",
        searchProvider: "doubao",
        enabledPlatforms: [
          {
            platform: "weibo",
            enabled: true,
            accountCount: 2,
            accountIds: ["weibo-original", "weibo-duplicate"],
            articleCount: 12,
          },
        ],
        days: 3,
        articlesPerAccountPerDay: 2,
        timeWindow: { start: "09:00", end: "18:00" },
        minSameAccountIntervalHours: 3,
        totalAccountCount: 2,
        totalArticleCount: 12,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies TaskRecord);

    await dataStore.savePublishingDraft({
      id: "draft-1",
      taskId: "task-1",
      platform: "weibo",
      title: "Draft",
      body: "Body",
      tags: [],
      imageUrls: [],
      localImagePaths: [],
      accountId: "weibo-duplicate",
      accountIds: ["weibo-original", "weibo-duplicate"],
      updatedAt: timestamp,
    } satisfies PublishingDraft);

    await dataStore.saveAccountPublishingDraft({
      id: "account-draft-1",
      taskId: "task-1",
      platform: "weibo",
      accountId: "weibo-duplicate",
      accountName: "待登录微博账号",
      searchProvider: "doubao",
      title: "Account draft",
      body: "Body",
      tags: [],
      imageUrls: [],
      localImagePaths: [],
      updatedAt: timestamp,
    } satisfies AccountPublishingDraft);

    await dataStore.savePublishingJob({
      id: "job-1",
      taskId: "task-1",
      platform: "weibo",
      accountId: "weibo-duplicate",
      accountName: "待登录微博账号",
      executionMode: "electron_automation",
      status: "queued",
      draftTitle: "Draft",
      draftBody: "Body",
      draftTags: [],
      draftImages: [],
      draftImagePaths: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies PublishingJobRecord);

    const merged = await accountsService.markPlatformAccountLoginResult("weibo-duplicate", {
      loginStatus: "authenticated",
      status: "valid",
      accountName: "weibo_account_main",
      displayName: "微博主账号",
      platformAccountId: "wb-user-1",
      avatarUrl: "https://example.com/avatar.png",
    });

    expect(merged.id).toBe("weibo-original");
    expect(merged.accountName).toBe("weibo_account_main");
    expect(merged.displayName).toBe("微博主账号");
    expect(merged.platformAccountId).toBe("wb-user-1");
    expect(merged.sessionPartition).toBe("persist:geo-platform-weibo-duplicate");

    const accounts = await dataStore.listPlatformAccounts();
    expect(accounts.map((item) => item.id)).toEqual(["weibo-original"]);

    const task = await dataStore.getTask("task-1");
    expect(task?.publishPlan?.enabledPlatforms[0]).toMatchObject({
      accountCount: 1,
      accountIds: ["weibo-original"],
      articleCount: 6,
    });
    expect(task?.publishPlan?.totalAccountCount).toBe(1);
    expect(task?.publishPlan?.totalArticleCount).toBe(6);

    const draft = await dataStore.getPublishingDraft("draft-1");
    expect(draft?.accountId).toBe("weibo-original");
    expect(draft?.accountIds).toEqual(["weibo-original"]);

    const accountDrafts = await dataStore.listAccountPublishingDrafts();
    expect(accountDrafts[0]).toMatchObject({
      accountId: "weibo-original",
      accountName: "微博主账号",
    });

    const jobs = await dataStore.listPublishingJobs();
    expect(jobs[0]).toMatchObject({
      accountId: "weibo-original",
      accountName: "微博主账号",
    });
    expect(await dataStore.getPlatformAccount("weibo-duplicate")).toBeNull();
  });

  it("cleans historical duplicate accounts in batch", async () => {
    const { dataStore, accountsService } = await loadIsolatedStore();
    const timestamp = "2026-06-11T10:00:00.000Z";

    await dataStore.savePlatformAccount({
      id: "dup-1",
      platform: "weibo",
      provider: "electron",
      authType: "session",
      accountName: "same_weibo_account",
      displayName: "微博账号 A",
      platformAccountId: "wb-dup-1",
      sessionPartition: "persist:geo-platform-dup-1",
      status: "valid",
      loginStatus: "authenticated",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLoginCompletedAt: timestamp,
    } satisfies PlatformAccountRecord);

    await dataStore.savePlatformAccount({
      id: "dup-2",
      platform: "weibo",
      provider: "electron",
      authType: "session",
      accountName: "same_weibo_account",
      displayName: "微博账号 B",
      sessionPartition: "persist:geo-platform-dup-2",
      status: "saved",
      loginStatus: "pending",
      createdAt: "2026-06-11T10:05:00.000Z",
      updatedAt: "2026-06-11T10:05:00.000Z",
    } satisfies PlatformAccountRecord);

    await dataStore.savePublishingDraft({
      id: "draft-batch",
      taskId: "task-batch",
      platform: "weibo",
      title: "Draft",
      body: "Body",
      tags: [],
      imageUrls: [],
      localImagePaths: [],
      accountId: "dup-2",
      accountIds: ["dup-1", "dup-2"],
      updatedAt: timestamp,
    } satisfies PublishingDraft);

    const result = await accountsService.deduplicateHistoricalPlatformAccounts("weibo");

    expect(result).toMatchObject({
      mergedGroups: 1,
      removedAccounts: 1,
      remainingAccounts: 1,
    });

    const accounts = await dataStore.listPlatformAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      id: "dup-1",
      accountName: "same_weibo_account",
      platformAccountId: "wb-dup-1",
    });

    const draft = await dataStore.getPublishingDraft("draft-batch");
    expect(draft?.accountId).toBe("dup-1");
    expect(draft?.accountIds).toEqual(["dup-1"]);
  });
});
