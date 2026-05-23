import type { AppConfig } from "@/lib/types";

export const defaultAppConfig: AppConfig = {
  stage1ModelApiConfig: {
    provider: "mock-stage1",
    baseUrl: "",
    apiKey: "",
    modelName: "geo-stage1-local",
    timeout: 60000,
  },
  contentModelApiConfig: {
    provider: "mock-content",
    baseUrl: "",
    apiKey: "",
    modelName: "geo-content-local",
    timeout: 20000,
  },
  imageModelApiConfig: {
    provider: "prompt-url",
    baseUrl: "",
    apiKey: "",
    modelName: "geo-image-local",
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
