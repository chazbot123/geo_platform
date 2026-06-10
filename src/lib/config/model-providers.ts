export type ModelSection = "text" | "image";

export interface ModelProviderOption {
  value: string;
  label: string;
}

export const modelProviderOptions: ModelProviderOption[] = [
  { value: "openai", label: "GPT" },
  { value: "volcengine-ark", label: "火山方舟 / 豆包" },
  { value: "dashscope-qwen", label: "通义千问" },
  { value: "deepseek", label: "DeepSeek" },
];

export function getDefaultModelNameForProvider(section: ModelSection, provider: string) {
  if (provider !== "openai") {
    return "";
  }

  return section === "image" ? "gpt-image-2" : "gpt-5.5";
}

export function resolveModelNameForProviderChange(
  section: ModelSection,
  provider: string,
  currentModelName: string,
  currentBaseUrl: string,
) {
  if (currentBaseUrl.trim()) {
    return currentModelName;
  }

  return getDefaultModelNameForProvider(section, provider);
}

export function isVisibleModelProvider(provider: string) {
  return modelProviderOptions.some((option) => option.value === provider);
}
