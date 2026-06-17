import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStatus } from "@/lib/workflow/status-service";

function workflowStatus(updatedAt: string): WorkflowStatus {
  return {
    updatedAt,
    steps: {
      enterprise: { key: "enterprise", completed: true, reason: "ok" },
      customerKeywords: { key: "customerKeywords", completed: true, reason: "ok" },
      taskCreate: { key: "taskCreate", completed: true, reason: "ok" },
      contentPool: { key: "contentPool", completed: false, reason: "pending" },
      publishExecution: { key: "publishExecution", completed: false, reason: "pending" },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("workflow status client cache", () => {
  it("caches workflow status until forced or invalidated", async () => {
    const responses = [workflowStatus("2026-06-17T01:00:00.000Z"), workflowStatus("2026-06-17T02:00:00.000Z"), workflowStatus("2026-06-17T03:00:00.000Z")];
    const fetchMock = vi.fn(async () => {
      const body = responses.shift();
      return {
        ok: true,
        json: async () => body,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { invalidateWorkflowStatusCache, loadWorkflowStatus } = await import("@/lib/workflow/status-client-cache");

    await expect(loadWorkflowStatus()).resolves.toMatchObject({ updatedAt: "2026-06-17T01:00:00.000Z" });
    await expect(loadWorkflowStatus()).resolves.toMatchObject({ updatedAt: "2026-06-17T01:00:00.000Z" });
    await expect(loadWorkflowStatus({ force: true })).resolves.toMatchObject({ updatedAt: "2026-06-17T02:00:00.000Z" });
    invalidateWorkflowStatusCache();
    await expect(loadWorkflowStatus()).resolves.toMatchObject({ updatedAt: "2026-06-17T03:00:00.000Z" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith("/api/workflow/status", expect.objectContaining({ cache: "no-store" }));
  });
});
