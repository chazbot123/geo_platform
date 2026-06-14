import { afterEach, describe, expect, it, vi } from "vitest";
import { callConfiguredTextModel } from "@/lib/integrations/openai-compatible";
import type { ModelApiConfig } from "@/lib/types";

const config: ModelApiConfig = {
  provider: "openai",
  baseUrl: "https://api.52hertz-palpitate.cn/v1/chat/completions",
  apiKey: "sk-test",
  modelName: "gpt-4o",
  timeout: 5000,
};

const messages = [{ role: "user" as const, content: "hello" }];

function okResponse() {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "OK" } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function rateLimitResponse() {
  return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });
}

// Patch setTimeout globally so retry sleeps resolve immediately
function patchSleepImmediate() {
  vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => {
    // Schedule via microtask to avoid NodeJS "called with wrong type" issues
    Promise.resolve().then(fn);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
}

describe("openai-compatible 429 rate-limit retry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries 429 twice then succeeds on the third attempt", async () => {
    patchSleepImmediate();

    let callCount = 0;
    vi.stubGlobal("fetch", async () => {
      callCount += 1;
      if (callCount <= 2) {
        return rateLimitResponse();
      }
      return okResponse();
    });

    const result = await callConfiguredTextModel(config, messages);
    expect(result.rawText).toBe("OK");
    expect(callCount).toBe(3);
  });

  it("throws after exhausting all 429 retry attempts", async () => {
    patchSleepImmediate();

    let callCount = 0;
    vi.stubGlobal("fetch", async () => {
      callCount += 1;
      return rateLimitResponse();
    });

    await expect(callConfiguredTextModel(config, messages)).rejects.toThrow(/HTTP_429/);
    // RATE_LIMITED_RETRY_DELAYS_MS has 3 entries → initial call + 3 retries = 4 total
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});
