import type { ModelApiConfig } from "@/lib/types";

export type ModelSection = "text" | "image";

export interface ProviderModelOption {
  value: string;
  label: string;
}

export interface ModelProviderOption {
  value: string;
  label: string;
}

interface ModelSectionPreset {
  defaultModelName: string;
  modelOptions: ProviderModelOption[];
}

interface ModelProviderPreset extends ModelProviderOption {
  defaultBaseUrl: string;
  sections: Partial<Record<ModelSection, ModelSectionPreset>>;
}

const providerPresets: ModelProviderPreset[] = [
  {
    value: "openai",
    label: "GPT",
    defaultBaseUrl: "",
    sections: {
      text: {
        defaultModelName: "gpt-5.5",
        modelOptions: [{ value: "gpt-5.5", label: "gpt-5.5" }],
      },
      image: {
        defaultModelName: "gpt-image-2",
        modelOptions: [{ value: "gpt-image-2", label: "gpt-image-2" }],
      },
    },
  },
  {
    value: "volcengine-ark",
    label: "火山方舟 / 豆包",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    sections: {
      text: {
        defaultModelName: "doubao-seed-1-6-250615",
        modelOptions: [
          { value: "doubao-seed-1-6-250615", label: "Doubao Seed 1.6" },
          { value: "doubao-1-5-pro-32k-250115", label: "Doubao 1.5 Pro 32K" },
        ],
      },
    },
  },
  {
    value: "dashscope-qwen",
    label: "通义千问",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    sections: {
      text: {
        defaultModelName: "qwen-max",
        modelOptions: [
          { value: "qwen-max", label: "qwen-max" },
          { value: "qwen-plus", label: "qwen-plus" },
          { value: "qwen-turbo", label: "qwen-turbo" },
        ],
      },
      image: {
        defaultModelName: "wanx2.1-t2i-turbo",
        modelOptions: [
          { value: "wanx2.1-t2i-turbo", label: "wanx2.1-t2i-turbo" },
          { value: "wanx2.1-t2i-plus", label: "wanx2.1-t2i-plus" },
        ],
      },
    },
  },
  {
    value: "vidu",
    label: "Vidu",
    defaultBaseUrl: "https://api.vidu.com",
    sections: {
      image: {
        defaultModelName: "viduq2",
        modelOptions: [
          { value: "viduq2", label: "viduq2" },
          { value: "viduq1", label: "viduq1" },
        ],
      },
    },
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    sections: {
      text: {
        defaultModelName: "deepseek-chat",
        modelOptions: [
          { value: "deepseek-chat", label: "deepseek-chat" },
          { value: "deepseek-reasoner", label: "deepseek-reasoner" },
        ],
      },
    },
  },
];

function getProviderPreset(provider: string) {
  return providerPresets.find((option) => option.value === provider);
}

export const modelProviderOptions: ModelProviderOption[] = providerPresets.map(({ value, label }) => ({ value, label }));

export function getDefaultBaseUrlForProvider(provider: string) {
  return getProviderPreset(provider)?.defaultBaseUrl ?? "";
}

export function getModelOptionsForProvider(section: ModelSection, provider: string) {
  const preset = getProviderPreset(provider);
  return preset?.sections[section]?.modelOptions ?? preset?.sections.text?.modelOptions ?? [];
}

export function getDefaultModelNameForProvider(section: ModelSection, provider: string) {
  const preset = getProviderPreset(provider);
  return preset?.sections[section]?.defaultModelName ?? preset?.sections.text?.defaultModelName ?? "";
}

export function resolveModelConfigForProviderChange(section: ModelSection, provider: string) {
  return {
    baseUrl: getDefaultBaseUrlForProvider(provider),
    modelName: getDefaultModelNameForProvider(section, provider),
  };
}

export function hydrateModelConfigWithProviderDefaults(section: ModelSection, config: ModelApiConfig): ModelApiConfig {
  const defaultBaseUrl = getDefaultBaseUrlForProvider(config.provider);
  const defaultModelName = getDefaultModelNameForProvider(section, config.provider);
  return {
    ...config,
    baseUrl: config.baseUrl.trim() || defaultBaseUrl,
    modelName: config.modelName.trim() || defaultModelName,
  };
}

export function isVisibleModelProvider(provider: string) {
  return modelProviderOptions.some((option) => option.value === provider);
}
