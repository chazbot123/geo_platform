import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppConfig } from "@/lib/config/defaults";
import type { AppConfig } from "@/lib/types";

let tempDataDir: string | undefined;

async function resetDataDir() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-config-test-"));
  process.env.GEO_DATA_DIR = tempDataDir;
  vi.resetModules();
  return tempDataDir;
}

afterEach(async () => {
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  delete process.env.GEO_DATA_DIR;
  vi.resetModules();
});

describe("config service model defaults", () => {
  it("normalizes legacy local GPT model names on initial load", async () => {
    await resetDataDir();
    const [{ saveConfig }, { getAppConfig }] = await Promise.all([
      import("@/lib/storage/data-store"),
      import("@/lib/config/service"),
    ]);

    const legacyConfig: AppConfig = {
      ...defaultAppConfig,
      stage1ModelApiConfig: {
        ...defaultAppConfig.stage1ModelApiConfig,
        modelName: "geo-content-local",
      },
      contentModelApiConfig: {
        ...defaultAppConfig.contentModelApiConfig,
        modelName: "geo-content-local",
      },
      imageModelApiConfig: {
        ...defaultAppConfig.imageModelApiConfig,
        modelName: "geo-image-local",
      },
    };

    await saveConfig(legacyConfig);

    const config = await getAppConfig();
    expect(config.stage1ModelApiConfig.modelName).toBe("gpt-5.5");
    expect(config.contentModelApiConfig.modelName).toBe("gpt-5.5");
    expect(config.imageModelApiConfig.modelName).toBe("gpt-image-2");
  });

  it("keeps custom GPT model names when a custom endpoint is configured", async () => {
    await resetDataDir();
    const [{ saveConfig }, { getAppConfig }] = await Promise.all([
      import("@/lib/storage/data-store"),
      import("@/lib/config/service"),
    ]);

    const customConfig: AppConfig = {
      ...defaultAppConfig,
      contentModelApiConfig: {
        ...defaultAppConfig.contentModelApiConfig,
        baseUrl: "http://127.0.0.1:1234/v1",
        modelName: "geo-content-local",
      },
      imageModelApiConfig: {
        ...defaultAppConfig.imageModelApiConfig,
        baseUrl: "http://127.0.0.1:1234/v1",
        modelName: "geo-image-local",
      },
    };

    await saveConfig(customConfig);

    const config = await getAppConfig();
    expect(config.contentModelApiConfig.modelName).toBe("geo-content-local");
    expect(config.imageModelApiConfig.modelName).toBe("geo-image-local");
  });

  it("upgrades the legacy GPT default text model name to gpt-5.5", async () => {
    await resetDataDir();
    const [{ saveConfig }, { getAppConfig }] = await Promise.all([
      import("@/lib/storage/data-store"),
      import("@/lib/config/service"),
    ]);

    const legacyDefaultConfig: AppConfig = {
      ...defaultAppConfig,
      stage1ModelApiConfig: {
        ...defaultAppConfig.stage1ModelApiConfig,
        modelName: "gpt5.5",
      },
      contentModelApiConfig: {
        ...defaultAppConfig.contentModelApiConfig,
        modelName: "gpt5.5",
      },
    };

    await saveConfig(legacyDefaultConfig);

    const config = await getAppConfig();
    expect(config.stage1ModelApiConfig.modelName).toBe("gpt-5.5");
    expect(config.contentModelApiConfig.modelName).toBe("gpt-5.5");
  });
});
