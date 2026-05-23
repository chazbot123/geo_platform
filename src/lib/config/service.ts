import { defaultAppConfig } from "@/lib/config/defaults";
import { normalizeApiKey } from "@/lib/integrations/auth";
import { resolveOpenAICompatibleEndpoint } from "@/lib/integrations/openai-compatible";
import { ensureStorageReady, getConfig, saveConfig } from "@/lib/storage/data-store";
import type { AppConfig } from "@/lib/types";

function normalizeBaseUrl(provider: string, baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "";
  }

  const normalizedProvider = provider.trim().toLowerCase();

  if (normalizedProvider === "deepseek") {
    return resolveOpenAICompatibleEndpoint(trimmed);
  }

  if (normalizedProvider === "vidu") {
    try {
      const parsed = new URL(trimmed);
      return parsed.origin;
    } catch {
      return trimmed.replace(/\/+$/g, "");
    }
  }

  return trimmed;
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
      baseUrl: normalizeBaseUrl(config.stage1ModelApiConfig.provider, config.stage1ModelApiConfig.baseUrl),
      apiKey: normalizeApiKey(config.stage1ModelApiConfig.apiKey),
    },
    contentModelApiConfig: {
      ...config.contentModelApiConfig,
      baseUrl: normalizeBaseUrl(config.contentModelApiConfig.provider, config.contentModelApiConfig.baseUrl),
      apiKey: normalizeApiKey(config.contentModelApiConfig.apiKey),
    },
    imageModelApiConfig: {
      ...config.imageModelApiConfig,
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
