function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function createAutoPublishScheduler(options = {}) {
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 60 * 1000;
  const startupDelayMs = Number.isFinite(options.startupDelayMs) ? options.startupDelayMs : 15 * 1000;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const getBaseUrl = typeof options.getBaseUrl === "function" ? options.getBaseUrl : () => "";
  const notifyFrontend = typeof options.notifyFrontend === "function" ? options.notifyFrontend : undefined;
  const logger = options.logger || console;
  let startupTimer = null;
  let intervalTimer = null;
  let running = false;

  async function tick(trigger = "interval") {
    if (running) {
      return { skipped: true, reason: "auto_publish_scan_running" };
    }
    const baseUrl = normalizeBaseUrl(getBaseUrl());
    if (!baseUrl || typeof fetchImpl !== "function") {
      return { skipped: true, reason: "app_server_unavailable" };
    }

    running = true;
    try {
      const response = await fetchImpl(`${baseUrl}/api/publish/execution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_due" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || `Auto publish scan failed: ${response.status}`);
      }
      if (Number(payload.executed || 0) > 0 && notifyFrontend) {
        await notifyFrontend(payload, trigger);
      }
      return payload;
    } catch (error) {
      if (logger && typeof logger.warn === "function") {
        logger.warn("Auto publish scan failed:", error);
      }
      return { error: error instanceof Error ? error.message : "Auto publish scan failed" };
    } finally {
      running = false;
    }
  }

  function start() {
    stop();
    startupTimer = setTimeout(() => {
      startupTimer = null;
      void tick("startup");
    }, startupDelayMs);
    if (typeof startupTimer.unref === "function") {
      startupTimer.unref();
    }

    intervalTimer = setInterval(() => {
      void tick("interval");
    }, intervalMs);
    if (typeof intervalTimer.unref === "function") {
      intervalTimer.unref();
    }
  }

  function stop() {
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  }

  return {
    start,
    stop,
    tick,
  };
}

module.exports = {
  createAutoPublishScheduler,
};
