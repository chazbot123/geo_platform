import type { AppConfig } from "@/lib/types";

export const defaultAppConfig: AppConfig = {
  stage1ModelApiConfig: {
    provider: "openai",
    baseUrl: "",
    apiKey: "",
    modelName: "gpt5.5",
    timeout: 120000,
  },
  contentModelApiConfig: {
    provider: "openai",
    baseUrl: "",
    apiKey: "",
    modelName: "gpt5.5",
    timeout: 20000,
  },
  imageModelApiConfig: {
    provider: "openai",
    baseUrl: "",
    apiKey: "",
    modelName: "gpt-image2",
    timeout: 15000,
  },
  publishApiConfig: {
    provider: "social-workbench",
    baseUrl: "",
    apiKey: "",
    enableElectronLogin: true,
    manualDeliveryBasePath: "manual-social-output",
    preferOfficialApi: true,
    electronAutomationEnabled: true,
    publishTimeoutMs: 180000,
    douyinClientId: "",
    douyinClientSecret: "",
  },
};
