import { describe, expect, it } from "vitest";
import {
  getDefaultBaseUrlForProvider,
  getDefaultModelNameForProvider,
  getModelOptionsForProvider,
  hydrateModelConfigWithProviderDefaults,
  modelProviderOptions,
  resolveModelConfigForProviderChange,
} from "@/lib/config/model-providers";

describe("model provider options", () => {
  it("keeps provider options visible and exposes provider presets", () => {
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
    expect(getDefaultModelNameForProvider("text", "deepseek")).toBe("deepseek-chat");
    expect(getDefaultModelNameForProvider("image", "deepseek")).toBe("deepseek-chat");
    expect(getDefaultModelNameForProvider("text", "volcengine-ark")).toBe("doubao-seed-1-6-250615");
    expect(getDefaultBaseUrlForProvider("deepseek")).toBe("https://api.deepseek.com/v1");
    expect(getDefaultBaseUrlForProvider("vidu")).toBe("https://api.vidu.cn");
    expect(getModelOptionsForProvider("text", "dashscope-qwen").map((item) => item.value)).toEqual([
      "qwen-max",
      "qwen-plus",
      "qwen-turbo",
    ]);
    expect(getModelOptionsForProvider("image", "volcengine-ark").map((item) => item.value)).toEqual([
      "doubao-seed-1-6-250615",
      "doubao-1-5-pro-32k-250115",
    ]);
  });

  it("resolves provider defaults for provider switching", () => {
    expect(resolveModelConfigForProviderChange("text", "openai")).toEqual({
      baseUrl: "",
      modelName: "gpt-5.5",
    });
    expect(resolveModelConfigForProviderChange("text", "deepseek")).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat",
    });
  });

  it("hydrates blank provider fields without overwriting existing custom values", () => {
    expect(
      hydrateModelConfigWithProviderDefaults("text", {
        provider: "dashscope-qwen",
        baseUrl: "",
        apiKey: "",
        modelName: "",
        timeout: 20000,
      }),
    ).toMatchObject({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelName: "qwen-max",
    });

    expect(
      hydrateModelConfigWithProviderDefaults("text", {
        provider: "deepseek",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "",
        modelName: "team-custom-model",
        timeout: 20000,
      }),
    ).toMatchObject({
      baseUrl: "https://gateway.example.com/v1",
      modelName: "team-custom-model",
    });
  });
});
