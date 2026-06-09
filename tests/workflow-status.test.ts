import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentPoolRecord, PublishingJobRecord, TaskRecord } from "@/lib/types";

let tempDataDir: string | undefined;

async function resetDataDir() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-workflow-test-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  return tempDataDir;
}

afterEach(async () => {
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

describe("workflow status completion", () => {
  it("derives every step from persisted state", async () => {
    const dataDir = await resetDataDir();
    const [{ saveEnterpriseProfile }, { writeJsonFile }, dataStore, { getWorkflowStatus }] = await Promise.all([
      import("@/lib/enterprise/service"),
      import("@/lib/storage/json-store"),
      import("@/lib/storage/data-store"),
      import("@/lib/workflow/status-service"),
    ]);

    const savedAt = "2026-06-09T01:00:00.000Z";
    await saveEnterpriseProfile({
      companyName: "Geo Company",
      brandShortName: "Geo",
      productService: "Publishing desk",
      region: "Shanghai",
    });
    await writeJsonFile(path.join(dataDir, "customer-keywords", "current.json"), {
      id: "keywords-1",
      enterpriseId: "enterprise-1",
      enterpriseName: "Geo Company",
      brandShortName: "Geo",
      productService: "Publishing desk",
      region: "Shanghai",
      candidates: { high: [], medium: [], low: [] },
      selectedQuestions: [1, 2, 3, 4, 5].map((item) => ({ id: `q${item}`, heat: "high", question: `Question ${item}` })),
      savedAt,
      updatedAt: savedAt,
    });

    await dataStore.ensureStorageReady();
    await dataStore.saveProduct({
      id: "product-1",
      taskId: "task-1",
      productName: "Publishing desk",
      category: "software",
      sellingPoints: "Reliable workflow",
      targetAudience: "operators",
      city: "Shanghai",
      scenarios: "daily publishing",
      brandTone: "practical",
    });
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
          { platform: "toutiao", enabled: true, accountCount: 1, accountIds: ["account-1"], articleCount: 10 },
        ],
        days: 5,
        articlesPerAccountPerDay: 2,
        timeWindow: { start: "09:00", end: "18:00" },
        minSameAccountIntervalHours: 3,
        totalAccountCount: 1,
        totalArticleCount: 10,
        createdAt: savedAt,
        updatedAt: savedAt,
      },
      createdAt: savedAt,
      updatedAt: savedAt,
    } satisfies TaskRecord);
    await dataStore.saveContentPool({
      taskId: "task-1",
      sourcePublishPlanUpdatedAt: savedAt,
      currentTaskId: "task-1",
      items: [{ id: "item-1", status: "sample", updatedAt: savedAt }],
      generatedAt: savedAt,
      updatedAt: savedAt,
    } as ContentPoolRecord);
    await dataStore.savePublishingJob({
      id: "job-1",
      taskId: "task-1",
      platform: "toutiao",
      executionMode: "electron_automation",
      status: "queued",
      draftTitle: "Title",
      draftBody: "Body",
      draftTags: [],
      draftImages: [],
      draftImagePaths: [],
      createdAt: savedAt,
      updatedAt: savedAt,
    } as PublishingJobRecord);

    const status = await getWorkflowStatus();
    expect(status.currentTaskId).toBe("task-1");
    expect(Object.values(status.steps).map((step) => step.completed)).toEqual([true, true, true, true, true]);
  });
});
