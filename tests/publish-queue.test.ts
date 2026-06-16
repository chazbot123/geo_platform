import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccountRecord, PublishingJobRecord } from "@/lib/types";

let tempDataDir: string | undefined;

async function loadIsolatedQueue() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-publish-queue-test-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  const [dataStore, queueService] = await Promise.all([
    import("@/lib/storage/data-store"),
    import("@/lib/publish/publish-queue-service"),
  ]);
  await dataStore.ensureStorageReady();
  return { dataStore, queueService };
}

afterEach(async () => {
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

function account(patch: Partial<PlatformAccountRecord> = {}): PlatformAccountRecord {
  return {
    id: "account-1",
    platform: "toutiao",
    provider: "electron",
    authType: "session",
    accountName: "Queue Account",
    status: "active",
    riskState: "active",
    loginStatus: "authenticated",
    sessionPartition: "persist:test",
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...patch,
  };
}

function job(patch: Partial<PublishingJobRecord> = {}): PublishingJobRecord {
  return {
    id: "job-1",
    taskId: "task-1",
    platform: "toutiao",
    accountId: "account-1",
    accountName: "Queue Account",
    executionMode: "electron_automation",
    status: "queued",
    draftTitle: "Title",
    draftBody: "Body",
    draftTags: [],
    draftImages: [],
    draftImagePaths: [],
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...patch,
  };
}

describe("publish queue policy", () => {
  it("blocks queued jobs when the account daily cap is reached", async () => {
    const { dataStore, queueService } = await loadIsolatedQueue();
    await dataStore.savePlatformAccount(account({ dailyPublishCap: 1 }));
    await dataStore.savePublishingJob(
      job({
        id: "published-today",
        status: "published",
        publishedAt: "2026-06-09T01:00:00.000Z",
      }),
    );

    const result = await queueService.evaluatePublishingJobReadiness(
      job({ id: "queued-now" }),
      new Date("2026-06-09T02:00:00.000Z"),
    );

    expect(result.runnable).toBe(false);
    expect(result.reason).toBe("account_daily_cap_reached");
  });

  it("blocks jobs during per-platform account cooldown", async () => {
    const { dataStore, queueService } = await loadIsolatedQueue();
    await dataStore.savePlatformAccount(account());
    await dataStore.savePublishingJob(
      job({
        id: "submitted-recently",
        status: "submitted",
        submittedAt: "2026-06-09T01:00:00.000Z",
      }),
    );

    const result = await queueService.evaluatePublishingJobReadiness(
      job({ id: "queued-now" }),
      new Date("2026-06-09T01:30:00.000Z"),
    );

    expect(result.runnable).toBe(false);
    expect(result.reason).toBe("platform_cooldown_active");
  });

  it("waits until the planned publish time before running queued jobs", async () => {
    const { dataStore, queueService } = await loadIsolatedQueue();
    await dataStore.savePlatformAccount(account());

    const result = await queueService.evaluatePublishingJobReadiness(
      job({
        id: "scheduled-job",
        plannedPublishTime: "2026-06-09T10:00:00.000Z",
      }),
      new Date("2026-06-09T09:59:00.000Z"),
    );

    expect(result.runnable).toBe(false);
    expect(result.reason).toBe("job_scheduled_for_later");
    expect(result.nextRunAt).toBe("2026-06-09T10:00:00.000Z");
  });

  it("allows queued jobs at or after the planned publish time", async () => {
    const { dataStore, queueService } = await loadIsolatedQueue();
    await dataStore.savePlatformAccount(account());

    const result = await queueService.evaluatePublishingJobReadiness(
      job({
        id: "due-job",
        plannedPublishTime: "2026-06-09T10:00:00.000Z",
      }),
      new Date("2026-06-09T10:00:00.000Z"),
    );

    expect(result.runnable).toBe(true);
  });

  it("ignores stale scheduled nextRunAt after a planned time manual override is due", async () => {
    const { dataStore, queueService } = await loadIsolatedQueue();
    await dataStore.savePlatformAccount(account());

    const result = await queueService.evaluatePublishingJobReadiness(
      job({
        id: "manual-override-due-job",
        plannedPublishTime: "2026-06-09T10:00:00.000Z",
        plannedPublishTimeManualOverrideAt: "2026-06-09T09:50:00.000Z",
        queueBlockedReason: "job_scheduled_for_later",
        nextRunAt: "2026-06-10T10:00:00.000Z",
      }),
      new Date("2026-06-09T10:05:00.000Z"),
    );

    expect(result.runnable).toBe(true);
  });

  it("manual resume returns a paused account to active state", async () => {
    const { dataStore, queueService } = await loadIsolatedQueue();
    await dataStore.savePlatformAccount(
      account({
        status: "verification_blocked",
        riskState: "verification_blocked",
        riskReason: "captcha",
        cooldownUntil: "2026-06-09T12:00:00.000Z",
      }),
    );

    const resumed = await queueService.resumePlatformAccount("account-1");

    expect(resumed.status).toBe("active");
    expect(resumed.riskState).toBe("active");
    expect(resumed.cooldownUntil).toBeUndefined();
  });

  it("does not pause accounts for missing image material failures", async () => {
    const { queueService } = await loadIsolatedQueue();
    const missingImageJob = job({
      id: "missing-image-job",
      status: "failed",
      failureStage: "prepare_images",
      errorMessage: "小红书图文发布至少需要 1 张图片；当前 payload 未提供可上传图片",
      executionLog: ["validate_session: authenticated", "prepare_images: validate xiaohongshu image materials"],
    });

    expect(queueService.materialReasonFromJob(missingImageJob)).toBe("prepare_images");
    expect(queueService.riskReasonFromJob(missingImageJob)).toBeNull();
  });

  it("scans only queued jobs whose planned time is due", async () => {
    const { dataStore, queueService } = await loadIsolatedQueue();
    await dataStore.savePlatformAccount(account());
    await dataStore.savePublishingJob(
      job({
        id: "future-job",
        executionMode: "manual_delivery",
        plannedPublishTime: "2026-06-09T11:00:00.000Z",
      }),
    );
    await dataStore.savePublishingJob(
      job({
        id: "due-job",
        executionMode: "manual_delivery",
        plannedPublishTime: "2026-06-09T10:00:00.000Z",
      }),
    );

    const result = await queueService.runDuePublishingJobs(new Date("2026-06-09T10:05:00.000Z"));

    expect(result.checked).toBe(2);
    expect(result.runnable).toBe(1);
    expect(result.executed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results.map((item) => item.jobId)).toEqual(["due-job"]);
  });

  it("writes back a block reason when a due job is skipped by daily cap", async () => {
    const { dataStore, queueService } = await loadIsolatedQueue();
    await dataStore.savePlatformAccount(account({ dailyPublishCap: 1 }));
    await dataStore.savePublishingJob(
      job({
        id: "submitted-today",
        status: "submitted",
        submittedAt: "2026-06-09T01:00:00.000Z",
        updatedAt: "2026-06-09T01:00:00.000Z",
      }),
    );
    await dataStore.savePublishingJob(
      job({
        id: "due-capped-job",
        plannedPublishTime: "2026-06-09T10:00:00.000Z",
        updatedAt: "2026-06-09T09:50:00.000Z",
      }),
    );

    const result = await queueService.runDuePublishingJobs(new Date("2026-06-09T10:05:00.000Z"));
    const blockedJob = await dataStore.getPublishingJob("due-capped-job");

    expect(result.checked).toBe(1);
    expect(result.runnable).toBe(0);
    expect(result.executed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.blocked).toEqual([
      {
        jobId: "due-capped-job",
        reason: "account_daily_cap_reached",
        nextRunAt: "2026-06-09T16:00:00.000Z",
      },
    ]);
    expect(blockedJob?.queueBlockedReason).toBe("account_daily_cap_reached");
    expect(blockedJob?.nextRunAt).toBe("2026-06-09T16:00:00.000Z");
    expect(blockedJob?.executionStage).toBe("account_daily_cap_reached");
  });
});
