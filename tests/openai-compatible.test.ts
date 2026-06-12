import { afterEach, describe, expect, it, vi } from "vitest";
import { callConfiguredTextModel, OpenAICompatibleHttpError } from "@/lib/integrations/openai-compatible";
import type { ModelApiConfig } from "@/lib/types";

const config: ModelApiConfig = {
  provider: "openai",
  baseUrl: "https://example.test/v1/chat/completions",
  apiKey: "sk-test",
  modelName: "gpt-5.5",
  timeout: 60000,
};

const messages = [{ role: "user" as const, content: "hello" }];

function createJsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("openai-compatible transient retry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries 502 responses with backoff before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ error: { message: "openai_error" } }, 502))
      .mockResolvedValueOnce(createJsonResponse({ choices: [{ message: { content: "ok" } }] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const result = await callConfiguredTextModel(config, messages);

    expect(result.rawText).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.mock.calls.map((call) => Number(call[1]))).toContain(500);
  });

  it("retries 503 responses with backoff before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ error: { message: "system cpu overloaded" } }, 503))
      .mockResolvedValueOnce(createJsonResponse({ choices: [{ message: { content: "ok" } }] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const result = await callConfiguredTextModel(config, messages);

    expect(result.rawText).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.mock.calls.map((call) => Number(call[1]))).toContain(500);
  });

  it("retries request timeout errors with backoff before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("REQUEST_TIMEOUT"))
      .mockResolvedValueOnce(createJsonResponse({ choices: [{ message: { content: "ok" } }] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const result = await callConfiguredTextModel(config, messages);

    expect(result.rawText).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.mock.calls.map((call) => Number(call[1]))).toContain(500);
  });

  it("surfaces the last 502 after retry exhaustion", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(createJsonResponse({ error: { message: "openai_error" } }, 502)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    try {
      await callConfiguredTextModel(config, messages);
      throw new Error("EXPECTED_502_RETRY_EXHAUSTION");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAICompatibleHttpError);
      expect(error).toMatchObject({ status: 502 });
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const scheduledDelays = setTimeoutSpy.mock.calls.map((call) => Number(call[1]));
    expect(scheduledDelays).toContain(500);
    expect(scheduledDelays).toContain(1500);
  });
});
