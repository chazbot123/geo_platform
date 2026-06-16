import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccountRecord, PublishingJobRecord } from "@/lib/types";

let savedJob: PublishingJobRecord;

vi.mock("@/lib/storage/data-store", () => ({
  getAccountPublishingDraft: vi.fn(async () => null),
  getPlatformAccount: vi.fn(async (): Promise<PlatformAccountRecord> => ({
    id: "account-1",
    platform: "xiaohongshu",
    provider: "electron",
    authType: "session",
    accountName: "XHS Account",
    status: "active",
    loginStatus: "authenticated",
    sessionPartition: "persist:xhs",
    createdAt: "2026-06-16T08:00:00.000Z",
    updatedAt: "2026-06-16T08:00:00.000Z",
  })),
  getPublishingJob: vi.fn(async () => savedJob),
}));

vi.mock("@/lib/publish/jobs-service", () => ({
  recordPublishingJobResult: vi.fn(async (input: Partial<PublishingJobRecord> & { jobId: string }) => {
    savedJob = {
      ...savedJob,
      ...input,
      id: input.jobId,
      updatedAt: "2026-06-16T08:01:00.000Z",
    };
    return savedJob;
  }),
}));

vi.mock("@/lib/publish/publish-image-resolver", () => ({
  resolvePublishImagePaths: vi.fn(async () => ["C:\\images\\xhs.png"]),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function queuedJob(patch: Partial<PublishingJobRecord> = {}): PublishingJobRecord {
  return {
    id: "job-1",
    taskId: "task-1",
    platform: "xiaohongshu",
    accountId: "account-1",
    executionMode: "electron_automation",
    status: "queued",
    draftTitle: "小红书发布测试",
    draftBody: "publish preflight over-limit body segment. ".repeat(40),
    draftTags: ["智能网关"],
    draftImages: ["https://example.test/image.png"],
    draftImagePaths: [],
    publishMode: "with_images",
    publishEntryUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
    createdAt: "2026-06-16T08:00:00.000Z",
    updatedAt: "2026-06-16T08:00:00.000Z",
    ...patch,
  };
}

describe("server publish runner preflight", () => {
  it("blocks over-limit xiaohongshu drafts before calling the desktop publish bridge", async () => {
    savedJob = queuedJob();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return Response.json({ status: "ok", ready: true });
      }
      return Response.json({ status: "published" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { runQueuedPublishingJob } = await import("@/lib/publish/server-publish-runner");

    const result = await runQueuedPublishingJob("job-1");

    expect(result.status).toBe("failed");
    expect(result.failureStage).toBe("preflight");
    expect(result.errorMessage).toBe("正文超过小红书发布限制，请重新生成或压缩后再发布");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/platform/publish"), expect.anything());
  });
});
