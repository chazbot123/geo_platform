import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentDraft, PlatformAccountRecord, ProductProfile, TaskRecord } from "@/lib/types";

let tempDataDir: string | undefined;

async function loadIsolatedServices() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-publish-workbench-provider-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  const [dataStore, publishOrchestrator, tasksService] = await Promise.all([
    import("@/lib/storage/data-store"),
    import("@/lib/publish/publish-orchestrator"),
    import("@/lib/tasks/service"),
  ]);
  await dataStore.ensureStorageReady();
  return { dataStore, publishOrchestrator, tasksService };
}

afterEach(async () => {
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

function productRecord(): ProductProfile {
  return {
    id: "product-1",
    taskId: "task-1",
    productName: "GEO 发布助手",
    category: "企业内容运营工具",
    sellingPoints: "提升内容发布效率",
    targetAudience: "企业运营团队",
    scenarios: "多平台发布",
    brandTone: "专业",
  };
}

function contentDraft(): ContentDraft {
  return {
    taskId: "task-1",
    title: "GEO 发布助手",
    summary: "多平台发布摘要",
    content: "多平台发布正文",
    faq: [],
    cta: "",
    updatedAt: "2026-06-12T10:00:00.000Z",
  };
}

function platformAccount(id: string, platform: PlatformAccountRecord["platform"]): PlatformAccountRecord {
  return {
    id,
    platform,
    provider: "electron",
    authType: "session",
    accountName: `${platform}-account`,
    status: "valid",
    loginStatus: "authenticated",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
  };
}

function taskRecord(): TaskRecord {
  return {
    id: "task-1",
    productId: "product-1",
    status: "generation_completed",
    searchProvider: "doubao",
    publishPlan: {
      taskId: "task-1",
      enterpriseTaskId: "task-1",
      keywordTaskId: "task-1",
      searchProvider: "doubao",
      searchProviders: ["doubao", "deepseek"],
      enabledPlatforms: [
        { platform: "douyin", searchProvider: "doubao", enabled: true, accountCount: 1, accountIds: ["douyin-account"], articleCount: 1 },
        { platform: "csdn", searchProvider: "deepseek", enabled: true, accountCount: 1, accountIds: ["csdn-account"], articleCount: 1 },
      ],
      days: 1,
      articlesPerAccountPerDay: 1,
      timeWindow: { start: "09:00", end: "18:00" },
      minSameAccountIntervalHours: 3,
      totalAccountCount: 2,
      totalArticleCount: 2,
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T10:00:00.000Z",
    },
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
  };
}

describe("publish workbench multi-provider plans", () => {
  it("creates account publishing drafts with each platform plan provider", async () => {
    const { dataStore, publishOrchestrator, tasksService } = await loadIsolatedServices();
    await dataStore.saveProduct(productRecord());
    await dataStore.saveContent(contentDraft());
    await dataStore.saveTask(taskRecord());
    await dataStore.savePlatformAccount(platformAccount("douyin-account", "douyin"));
    await dataStore.savePlatformAccount(platformAccount("csdn-account", "csdn"));

    const bundle = await tasksService.getTaskBundle("task-1");
    expect(bundle).toBeTruthy();
    const drafts = await publishOrchestrator.ensureAccountPublishingDrafts(bundle!);

    expect(drafts.map((draft) => [draft.platform, draft.searchProvider])).toEqual([
      ["csdn", "deepseek"],
      ["douyin", "doubao"],
    ]);
  });
});
