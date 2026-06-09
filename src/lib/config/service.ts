import { defaultAppConfig } from "@/lib/config/defaults";
import { isVisibleModelProvider } from "@/lib/config/model-providers";
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

function normalizeModelConfig(config: AppConfig["contentModelApiConfig"]) {
  const provider = normalizeProviderName(config.provider);

  return {
    ...config,
    provider,
    baseUrl: normalizeBaseUrl(provider, config.baseUrl),
    apiKey: normalizeApiKey(config.apiKey),
  };
}

function normalizeConfig(config: AppConfig): AppConfig {
  const mergedPublishConfig = {
    ...defaultAppConfig.publishApiConfig,
    ...config.publishApiConfig,
  };
  const normalizedPublishProvider =
    mergedPublishConfig.provider === "local-file" ? defaultAppConfig.publishApiConfig.provider : mergedPublishConfig.provider;

  return {
    ...config,
    stage1ModelApiConfig: normalizeModelConfig(config.stage1ModelApiConfig),
    contentModelApiConfig: normalizeModelConfig(config.contentModelApiConfig),
    imageModelApiConfig: normalizeModelConfig(config.imageModelApiConfig),
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
    return normalizeConfig(config);
  }
  await saveConfig(defaultAppConfig);
  return defaultAppConfig;
}

export async function updateAppConfig(nextConfig: AppConfig) {
  await ensureStorageReady();
  const normalizedConfig = normalizeConfig(nextConfig);
  await saveConfig(normalizedConfig);
  return normalizedConfig;
}
