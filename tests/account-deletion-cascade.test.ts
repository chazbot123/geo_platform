import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountPublishingDraft, PlatformAccountRecord, PublishingDraft, TaskRecord } from "@/lib/types";

let tempDataDir: string | undefined;

async function loadIsolatedStore() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-account-test-"));
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

describe("account deletion cascade", () => {
  it("removes deleted accounts from task plans and drafts", async () => {
    const { dataStore, accountsService } = await loadIsolatedStore();
    const timestamp = "2026-06-09T01:00:00.000Z";

    await dataStore.savePlatformAccount({
      id: "account-delete",
      platform: "toutiao",
      provider: "electron",
      authType: "session",
      accountName: "Delete me",
      status: "valid",
      loginStatus: "authenticated",
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies PlatformAccountRecord);
    await dataStore.savePlatformAccount({
      id: "account-keep",
      platform: "toutiao",
      provider: "electron",
      authType: "session",
      accountName: "Keep me",
      status: "valid",
      loginStatus: "authenticated",
      createdAt: timestamp,
      updatedAt: timestamp,
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
            platform: "toutiao",
            enabled: true,
            accountCount: 2,
            accountIds: ["account-delete", "account-keep"],
            articleCount: 20,
          },
        ],
        days: 5,
        articlesPerAccountPerDay: 2,
        timeWindow: { start: "09:00", end: "18:00" },
        minSameAccountIntervalHours: 3,
        totalAccountCount: 2,
        totalArticleCount: 20,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies TaskRecord);
    await dataStore.saveTask({
      id: "task-keep",
      productId: "product-1",
      status: "task_planned",
      publishPlan: {
        taskId: "task-keep",
        enterpriseTaskId: "task-keep",
        keywordTaskId: "task-keep",
        searchProvider: "doubao",
        enabledPlatforms: [
          {
            platform: "toutiao",
            enabled: true,
            accountCount: 1,
            accountIds: ["account-keep"],
            articleCount: 10,
          },
        ],
        days: 5,
        articlesPerAccountPerDay: 2,
        timeWindow: { start: "09:00", end: "18:00" },
        minSameAccountIntervalHours: 3,
        totalAccountCount: 1,
        totalArticleCount: 10,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies TaskRecord);
    await dataStore.savePublishingDraft({
      id: "draft-1",
      taskId: "task-1",
      platform: "toutiao",
      title: "Draft",
      body: "Body",
      tags: [],
      imageUrls: [],
      localImagePaths: [],
      accountId: "account-delete",
      accountIds: ["account-delete", "account-keep"],
      updatedAt: timestamp,
    } satisfies PublishingDraft);
    await dataStore.savePublishingDraft({
      id: "draft-keep",
      taskId: "task-keep",
      platform: "toutiao",
      title: "Keep Draft",
      body: "Body",
      tags: [],
      imageUrls: [],
      localImagePaths: [],
      accountId: "account-keep",
      accountIds: ["account-keep"],
      updatedAt: timestamp,
    } satisfies PublishingDraft);
    await dataStore.saveAccountPublishingDraft({
      id: "account-draft-1",
      taskId: "task-1",
      platform: "toutiao",
      accountId: "account-delete",
      searchProvider: "doubao",
      title: "Account draft",
      body: "Body",
      tags: [],
      imageUrls: [],
      localImagePaths: [],
      updatedAt: timestamp,
    } satisfies AccountPublishingDraft);
    await dataStore.saveAccountPublishingDraft({
      id: "account-draft-keep",
      taskId: "task-keep",
      platform: "toutiao",
      accountId: "account-keep",
      searchProvider: "doubao",
      title: "Keep Account draft",
      body: "Body",
      tags: [],
      imageUrls: [],
      localImagePaths: [],
      updatedAt: timestamp,
    } satisfies AccountPublishingDraft);

    await accountsService.removePlatformAccount("account-delete");

    const task = await dataStore.getTask("task-1");
    expect(task?.publishPlan?.enabledPlatforms[0]).toMatchObject({
      enabled: true,
      accountCount: 1,
      accountIds: ["account-keep"],
      articleCount: 10,
    });
    expect(task?.publishPlan?.totalAccountCount).toBe(1);
    expect(task?.publishPlan?.totalArticleCount).toBe(10);

    const draft = await dataStore.getPublishingDraft("draft-1");
    expect(draft?.accountId).toBeUndefined();
    expect(draft?.accountIds).toEqual(["account-keep"]);
    expect(await dataStore.getTask("task-keep")).toMatchObject({
      publishPlan: {
        totalAccountCount: 1,
        totalArticleCount: 10,
        enabledPlatforms: [{ accountIds: ["account-keep"] }],
      },
    });
    expect(await dataStore.getPublishingDraft("draft-keep")).toMatchObject({
      accountId: "account-keep",
      accountIds: ["account-keep"],
    });
    expect(await dataStore.listAccountPublishingDrafts()).toMatchObject([
      expect.objectContaining({ id: "account-draft-keep", accountId: "account-keep" }),
    ]);
    expect(await dataStore.getPlatformAccount("account-delete")).toBeNull();
  });
});
