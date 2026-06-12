import { defaultAppConfig } from "@/lib/config/defaults";
import { getDefaultModelNameForProvider, isVisibleModelProvider, type ModelSection } from "@/lib/config/model-providers";
import { normalizeApiKey } from "@/lib/integrations/auth";
import {
  isNewApiAutoProvider,
  normalizeOpenAICompatibleProviderName,
  resolveConfiguredOpenAICompatibleEndpoint,
} from "@/lib/integrations/openai-compatible";
import { ensureStorageReady, getConfig, saveConfig } from "@/lib/storage/data-store";
import type { AppConfig } from "@/lib/types";

function normalizeProviderName(provider: string) {
  const normalized = normalizeOpenAICompatibleProviderName(provider);
  return isVisibleModelProvider(normalized) ? normalized : "openai";
}

function sanitizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/^[`'"]+|[`'"]+$/g, "").replace(/\/+$/g, "");
}

function normalizeBaseUrl(provider: string, baseUrl: string) {
  const trimmed = sanitizeBaseUrl(baseUrl);
  if (!trimmed) {
    return "";
  }

  const normalizedProvider = normalizeProviderName(provider).toLowerCase();

  if (isNewApiAutoProvider(normalizedProvider)) {
    return trimmed;
  }

  if (normalizedProvider === "vidu") {
    try {
      const parsed = new URL(trimmed);
      return parsed.origin;
    } catch {
      return trimmed.replace(/\/+$/g, "");
    }
  }

  return resolveConfiguredOpenAICompatibleEndpoint(normalizedProvider, trimmed);
}

function normalizeModelName(section: ModelSection, provider: string, baseUrl: string, modelName: string) {
  const normalizedModelName = String(modelName || "").trim();
  const sanitizedBaseUrl = sanitizeBaseUrl(baseUrl);
  const normalizedProvider = normalizeProviderName(provider);
  const legacyLocalModelNames = new Set(["geo-content-local", "geo-image-local"]);

  if (normalizedProvider !== "openai") {
    return normalizedModelName;
  }

  if (section === "text" && normalizedModelName === "gpt5.5") {
    return "gpt-5.5";
  }

  if (!normalizedModelName || (!sanitizedBaseUrl && legacyLocalModelNames.has(normalizedModelName))) {
    return getDefaultModelNameForProvider(section, normalizedProvider);
  }

  return normalizedModelName;
}

function normalizeModelConfig(section: ModelSection, config: AppConfig["contentModelApiConfig"]) {
  const provider = normalizeProviderName(config.provider);

  return {
    ...config,
    provider,
    baseUrl: normalizeBaseUrl(provider, config.baseUrl),
    apiKey: normalizeApiKey(config.apiKey),
    modelName: normalizeModelName(section, provider, config.baseUrl, config.modelName),
  };
}

export function normalizeAppConfig(config: AppConfig): AppConfig {
  const mergedPublishConfig = {
    ...defaultAppConfig.publishApiConfig,
    ...config.publishApiConfig,
  };
  const normalizedPublishProvider =
    mergedPublishConfig.provider === "local-file" ? defaultAppConfig.publishApiConfig.provider : mergedPublishConfig.provider;

  return {
    ...config,
    stage1ModelApiConfig: normalizeModelConfig("text", config.stage1ModelApiConfig),
    contentModelApiConfig: normalizeModelConfig("text", config.contentModelApiConfig),
    imageModelApiConfig: normalizeModelConfig("image", config.imageModelApiConfig),
    publishApiConfig: {
      provider: normalizedPublishProvider,
      baseUrl: mergedPublishConfig.baseUrl,
      apiKey: normalizeApiKey(mergedPublishConfig.apiKey),
      enableElectronLogin: mergedPublishConfig.enableElectronLogin,
      manualDeliveryBasePath: mergedPublishConfig.manualDeliveryBasePath,
      preferOfficialApi: mergedPublishConfig.preferOfficialApi,
      electronAutomationEnabled: mergedPublishConfig.electronAutomationEnabled,
      publishTimeoutMs: mergedPublishConfig.publishTimeoutMs,
      douyinClientId: mergedPublishConfig.douyinClientId,
      douyinClientSecret: mergedPublishConfig.douyinClientSecret,
    },
  };
}

export async function getAppConfig() {
  await ensureStorageReady();
  const config = await getConfig();
  if (config) {
    return normalizeAppConfig(config);
  }
  await saveConfig(defaultAppConfig);
  return defaultAppConfig;
}

export async function updateAppConfig(nextConfig: AppConfig) {
  await ensureStorageReady();
  const normalizedConfig = normalizeAppConfig(nextConfig);
  await saveConfig(normalizedConfig);
  return normalizedConfig;
}
