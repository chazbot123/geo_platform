import { defaultAppConfig } from "@/lib/config/defaults";
import { normalizeApiKey } from "@/lib/integrations/auth";
import {
  isNewApiAutoProvider,
  normalizeOpenAICompatibleProviderName,
  resolveConfiguredOpenAICompatibleEndpoint,
} from "@/lib/integrations/openai-compatible";
import { ensureStorageReady, getConfig, saveConfig } from "@/lib/storage/data-store";
import type { AppConfig } from "@/lib/types";

function normalizeProviderName(provider: string) {
  return normalizeOpenAICompatibleProviderName(provider);
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

function normalizeConfig(config: AppConfig): AppConfig {
  const mergedPublishConfig = {
    ...defaultAppConfig.publishApiConfig,
    ...config.publishApiConfig,
  };
  const normalizedPublishProvider =
    mergedPublishConfig.provider === "local-file" ? defaultAppConfig.publishApiConfig.provider : mergedPublishConfig.provider;

  return {
    ...config,
    stage1ModelApiConfig: {
      ...config.stage1ModelApiConfig,
      provider: normalizeProviderName(config.stage1ModelApiConfig.provider),
      baseUrl: normalizeBaseUrl(config.stage1ModelApiConfig.provider, config.stage1ModelApiConfig.baseUrl),
      apiKey: normalizeApiKey(config.stage1ModelApiConfig.apiKey),
    },
    contentModelApiConfig: {
      ...config.contentModelApiConfig,
      provider: normalizeProviderName(config.contentModelApiConfig.provider),
      baseUrl: normalizeBaseUrl(config.contentModelApiConfig.provider, config.contentModelApiConfig.baseUrl),
      apiKey: normalizeApiKey(config.contentModelApiConfig.apiKey),
    },
    imageModelApiConfig: {
      ...config.imageModelApiConfig,
      provider: normalizeProviderName(config.imageModelApiConfig.provider),
      baseUrl: normalizeBaseUrl(config.imageModelApiConfig.provider, config.imageModelApiConfig.baseUrl),
      apiKey: normalizeApiKey(config.imageModelApiConfig.apiKey),
    },
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
