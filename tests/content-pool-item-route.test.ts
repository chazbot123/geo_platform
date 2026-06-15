import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/content/service", () => ({
  confirmMediumRiskContentPoolItem: vi.fn(async () => ({ ok: true })),
  disperseContentPoolItem: vi.fn(async () => ({ ok: true })),
  rewriteContentPoolItem: vi.fn(async () => ({ ok: true })),
  retryContentPoolItemImage: vi.fn(async () => ({ ok: true })),
  retryAllFailedContentPoolImages: vi.fn(async () => ({ current: { ok: true }, totalFailedImages: 1, retriedImages: 1, remainingFailedImages: 0 })),
  updateContentPoolItemImageCount: vi.fn(async () => ({ ok: true })),
}));

describe("content pool item route", () => {
  it("routes retry_image action to retryContentPoolItemImage", async () => {
    const { POST } = await import("@/app/api/content/pool/item/route");
    const service = await import("@/lib/content/service");

    const request = new Request("http://localhost/api/content/pool/item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "task-1",
        itemId: "item-1",
        imageId: "img-2",
        action: "retry_image",
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.current).toEqual({ ok: true });
    expect(vi.mocked(service.retryContentPoolItemImage)).toHaveBeenCalledWith("task-1", "item-1", "img-2");
  });

  it("routes retry_all_failed_images action to retryAllFailedContentPoolImages", async () => {
    const { POST } = await import("@/app/api/content/pool/item/route");
    const service = await import("@/lib/content/service");

    const request = new Request("http://localhost/api/content/pool/item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "task-1",
        itemId: "task-1",
        action: "retry_all_failed_images",
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.totalFailedImages).toBe(1);
    expect(payload.retriedImages).toBe(1);
    expect(vi.mocked(service.retryAllFailedContentPoolImages)).toHaveBeenCalledWith("task-1");
  });
});
