import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

describe("Electron auto publish scheduler", () => {
  it("posts run_due on startup and interval without overlapping scans", async () => {
    vi.useFakeTimers();
    try {
      const { createAutoPublishScheduler } = require("../electron/auto-publish-scheduler.js");
      let resolveFetch: ((value: unknown) => void) | undefined;
      const fetchImpl = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const notifyFrontend = vi.fn();

      const scheduler = createAutoPublishScheduler({
        getBaseUrl: () => "http://127.0.0.1:3000/",
        fetchImpl,
        intervalMs: 1000,
        startupDelayMs: 10,
        notifyFrontend,
      });

      scheduler.start();

      await vi.advanceTimersByTimeAsync(10);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenLastCalledWith(
        "http://127.0.0.1:3000/api/publish/execution",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "run_due" }),
        }),
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      resolveFetch?.({
        ok: true,
        json: async () => ({ executed: 1 }),
      });
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
      expect(notifyFrontend).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      scheduler.stop();
      resolveFetch?.({
        ok: true,
        json: async () => ({ executed: 0 }),
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
