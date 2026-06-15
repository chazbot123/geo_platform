import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeEnterpriseProfile } from "@/lib/enterprise/service";
import type { EnterpriseAsset } from "@/lib/enterprise/types";

let tempDataDir: string | undefined;

async function resetDataDir() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "geo-enterprise-profile-test-"));
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

function asset(overrides: Partial<EnterpriseAsset>): EnterpriseAsset {
  return {
    id: "asset-id",
    name: "asset.pdf",
    size: 1024,
    type: "application/pdf",
    kind: "material",
    uploadedAt: "2026-06-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("enterprise profile service", () => {
  it("deduplicates uploaded assets by kind, name, and size", () => {
    const profile = normalizeEnterpriseProfile({
      companyName: "Company",
      brandShortName: "Brand",
      productService: "Service",
      region: "Region",
      materialFiles: [
        asset({ id: "local", uploadedAt: "2026-06-14T00:00:00.000Z" }),
        asset({ id: "server", uploadedAt: "2026-06-14T00:00:01.000Z" }),
      ],
      imageFiles: [
        asset({ id: "image-local", kind: "image", name: "reference.png", size: 2048, type: "image/png" }),
        asset({ id: "image-server", kind: "image", name: "reference.png", size: 2048, type: "image/png" }),
      ],
    });

    expect(profile.materialFiles).toHaveLength(1);
    expect(profile.imageFiles).toHaveLength(1);
  });

  it("marks saved customer keywords stale when productService changes", async () => {
    const dataDir = await resetDataDir();
    const [{ saveEnterpriseProfile }, { writeJsonFile, readJsonFile }, { getCustomerKeywordWorkbenchData }] = await Promise.all([
      import("@/lib/enterprise/service"),
      import("@/lib/storage/json-store"),
      import("@/lib/keywords/service"),
    ]);

    await saveEnterpriseProfile({
      companyName: "Geo Company",
      brandShortName: "Geo",
      productService: "Old Service",
      region: "Shanghai",
    });
    await writeJsonFile(path.join(dataDir, "customer-keywords", "current.json"), {
      id: "keywords-1",
      enterpriseId: "single-enterprise-profile",
      enterpriseName: "Geo Company",
      brandShortName: "Geo",
      productService: "Old Service",
      region: "Shanghai",
      candidates: { high: [], medium: [], low: [] },
      selectedQuestions: [1, 2, 3, 4, 5].map((item) => ({ id: `q${item}`, heat: "high", question: `Question ${item}` })),
      savedAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    });

    await saveEnterpriseProfile({
      companyName: "Geo Company",
      brandShortName: "Geo",
      productService: "New Service",
      region: "Shanghai",
    });

    const keywordSet = await readJsonFile<Record<string, unknown> | null>(path.join(dataDir, "customer-keywords", "current.json"), null);
    const workbenchData = await getCustomerKeywordWorkbenchData();
    expect(keywordSet?.staleAt).toEqual(expect.any(String));
    expect(keywordSet?.staleFields).toEqual(["productService"]);
    expect(workbenchData.keywordSet?.staleFields).toEqual(["productService"]);
    expect(workbenchData.canCreateTask).toBe(false);
  });

  it("keeps saved customer keywords active when only non-core enterprise fields change", async () => {
    const dataDir = await resetDataDir();
    const [{ saveEnterpriseProfile }, { writeJsonFile, readJsonFile }, { getCustomerKeywordWorkbenchData }] = await Promise.all([
      import("@/lib/enterprise/service"),
      import("@/lib/storage/json-store"),
      import("@/lib/keywords/service"),
    ]);

    await saveEnterpriseProfile({
      companyName: "Geo Company",
      brandShortName: "Geo",
      productService: "Service",
      region: "Shanghai",
      brandStory: "Old story",
    });
    await writeJsonFile(path.join(dataDir, "customer-keywords", "current.json"), {
      id: "keywords-1",
      enterpriseId: "single-enterprise-profile",
      enterpriseName: "Geo Company",
      brandShortName: "Geo",
      productService: "Service",
      region: "Shanghai",
      candidates: { high: [], medium: [], low: [] },
      selectedQuestions: [1, 2, 3, 4, 5].map((item) => ({ id: `q${item}`, heat: "high", question: `Question ${item}` })),
      savedAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    });

    await saveEnterpriseProfile({
      companyName: "Geo Company",
      brandShortName: "Geo",
      productService: "Service",
      region: "Shanghai",
      brandStory: "New story",
    });

    const keywordSet = await readJsonFile<Record<string, unknown> | null>(path.join(dataDir, "customer-keywords", "current.json"), null);
    const workbenchData = await getCustomerKeywordWorkbenchData();
    expect(keywordSet?.staleAt).toBeUndefined();
    expect(workbenchData.keywordSet?.staleAt).toBeUndefined();
    expect(workbenchData.canCreateTask).toBe(true);
  });

  it("rejects saving stale customer keyword selections", async () => {
    const dataDir = await resetDataDir();
    const [{ saveEnterpriseProfile }, { writeJsonFile }, { saveCustomerKeywordSelection }] = await Promise.all([
      import("@/lib/enterprise/service"),
      import("@/lib/storage/json-store"),
      import("@/lib/keywords/service"),
    ]);

    await saveEnterpriseProfile({
      companyName: "Geo Company",
      brandShortName: "Geo",
      productService: "New Service",
      region: "Shanghai",
    });
    await writeJsonFile(path.join(dataDir, "customer-keywords", "current.json"), {
      id: "keywords-1",
      enterpriseId: "single-enterprise-profile",
      enterpriseName: "Geo Company",
      brandShortName: "Geo",
      productService: "Old Service",
      region: "Shanghai",
      candidates: {
        high: [1, 2, 3, 4, 5].map((item) => ({ id: `q${item}`, heat: "high", question: `Question ${item}` })),
        medium: [],
        low: [],
      },
      selectedQuestions: [],
      generatedAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    });

    await expect(saveCustomerKeywordSelection(["q1", "q2", "q3", "q4", "q5"])).rejects.toThrow("企业信息已变更");
  });
});
