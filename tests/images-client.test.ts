import { afterEach, describe, expect, it, vi } from "vitest";
import { runImageModel } from "@/lib/integrations/images/client";
import type { ContentDraft, ModelApiConfig, ProductProfile, ThemeSet } from "@/lib/types";

const product: ProductProfile = {
  id: "product-1",
  taskId: "task-1",
  productName: "Geo Service",
  category: "Marketing",
  sellingPoints: "Search visibility",
  targetAudience: "Local businesses",
  scenarios: "Lead generation",
  brandTone: "Professional",
};

const theme: ThemeSet = {
  taskId: "task-1",
  searchProvider: "doubao",
  audienceChannels: ["social"],
  mainKeyword: "GEO search optimization",
  backupKeywords: [],
  relatedKeywords: [],
  trendKeywords: [],
  candidateKeywords: [],
  scoreSummary: "",
  rankingSummary: "",
  updatedAt: "2026-06-13T00:00:00.000Z",
};

const content: ContentDraft = {
  taskId: "task-1",
  title: "GEO search optimization",
  summary: "How GEO helps local businesses get discovered.",
  content: [
    "GEO search optimization helps companies become easier to discover in AI answer and search scenarios.",
    "It is useful when customers compare services before contacting a vendor.",
    "Good content should explain service scope, process, pricing boundaries, and proof.",
    "Local brands need clear location signals and practical answers to buyer questions.",
    "The goal is visibility and trust, not a guaranteed conversion promise.",
  ].join("\n\n"),
  faq: [],
  cta: "",
  updatedAt: "2026-06-13T00:00:00.000Z",
};

const config: ModelApiConfig = {
  provider: "openai",
  baseUrl: "https://api.example.com/v1/chat/completions",
  apiKey: "sk-test",
  modelName: "gpt-image-2",
  timeout: 60000,
};

describe("runImageModel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts image_url fields from OpenAI-compatible image generation gateways", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/images/generations")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                image_url: "https://cdn.example.com/generated.png",
                revised_prompt: "revised image prompt",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await runImageModel(product, theme, content, config);

    expect(result.images).toHaveLength(2);
    expect(result.provider).toBe("openai-compatible-image");
    expect(result.images?.every((item) => item.url === "https://cdn.example.com/generated.png")).toBe(true);
    expect(result.images?.every((item) => item.prompt === "revised image prompt")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to Responses image tool when an OpenAI-compatible gateway reports missing image_generation tool", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/images/generations")) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Tool choice 'image_generation' not found in 'tools' parameter.",
            },
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.endsWith("/v1/responses")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          tools?: Array<{ type?: string }>;
          tool_choice?: { type?: string };
          model?: string;
        };
        expect(body.tools).toEqual([{ type: "image_generation" }]);
        expect(body.tool_choice).toEqual({ type: "image_generation" });
        expect(body.model).toBe("gpt-5.5");

        return new Response(
          JSON.stringify({
            output: [
              {
                id: "img-call-1",
                type: "image_generation_call",
                result: "iVBORw0KGgo=",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await runImageModel(product, theme, content, config);

    expect(result.images).toHaveLength(2);
    expect(result.provider).toBe("openai-responses-image");
    expect(result.images?.every((item) => item.provider === "openai-responses-image")).toBe(true);
    expect(result.images?.every((item) => item.url.startsWith("data:image/png;base64,"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
