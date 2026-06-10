import { describe, expect, it } from "vitest";
import { getDefaultModelNameForProvider, modelProviderOptions, resolveModelNameForProviderChange } from "@/lib/config/model-providers";

describe("model provider options", () => {
  it("keeps GPT defaults and removes retired providers from settings", () => {
    const values = modelProviderOptions.map((option) => option.value);

    expect(values).toContain("openai");
    expect(values).toContain("volcengine-ark");
    expect(values).toContain("dashscope-qwen");
    expect(values).toContain("deepseek");
    expect(values).not.toContain("newapi-auto");
    expect(values).not.toContain("tencent-hunyuan");
    expect(values).not.toContain("generic-compatible");
    expect(values).not.toContain("mock-content");

    expect(getDefaultModelNameForProvider("text", "openai")).toBe("gpt-5.5");
    expect(getDefaultModelNameForProvider("image", "openai")).toBe("gpt-image-2");
    expect(getDefaultModelNameForProvider("text", "deepseek")).toBe("");
    expect(getDefaultModelNameForProvider("image", "volcengine-ark")).toBe("");
  });

  it("keeps custom model names when a custom endpoint is configured", () => {
    expect(resolveModelNameForProviderChange("text", "openai", "geo-content-local", "https://example.com/v1/chat/completions")).toBe(
      "geo-content-local",
    );
    expect(resolveModelNameForProviderChange("image", "openai", "geo-image-local", "https://example.com/v1/chat/completions")).toBe(
      "geo-image-local",
    );
    expect(resolveModelNameForProviderChange("text", "openai", "", "")).toBe("gpt-5.5");
    expect(resolveModelNameForProviderChange("image", "deepseek", "custom-image", "")).toBe("");
  });
});
