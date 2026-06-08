import path from "node:path";
import { dataRoot } from "@/lib/paths";
import { readJsonFile, writeJsonFile } from "@/lib/storage/json-store";
import type { EnterpriseAsset, EnterpriseProfile, EnterpriseProfileFields } from "@/lib/enterprise/types";

const profilePath = path.join(dataRoot, "enterprise", "profile.json");
const enterpriseProfileId = "single-enterprise-profile" as const;

export const requiredEnterpriseFields: Array<keyof EnterpriseProfileFields> = [
  "companyName",
  "brandShortName",
  "productService",
  "region",
];

export async function getEnterpriseProfile() {
  return readJsonFile<EnterpriseProfile | null>(profilePath, null);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAsset(asset: EnterpriseAsset): EnterpriseAsset {
  return {
    id: normalizeText(asset.id) || `${asset.kind}-${asset.name}-${asset.size}`,
    name: normalizeText(asset.name),
    size: Number.isFinite(asset.size) ? asset.size : 0,
    type: normalizeText(asset.type),
    kind: asset.kind === "image" ? "image" : "material",
    uploadedAt: normalizeText(asset.uploadedAt) || new Date().toISOString(),
  };
}

export function normalizeEnterpriseProfile(input: Partial<EnterpriseProfile>): EnterpriseProfile {
  return {
    id: enterpriseProfileId,
    companyName: normalizeText(input.companyName),
    brandShortName: normalizeText(input.brandShortName),
    productService: normalizeText(input.productService),
    region: normalizeText(input.region),
    brandStory: normalizeText(input.brandStory),
    productFeatures: normalizeText(input.productFeatures),
    audience: normalizeText(input.audience),
    trustProof: normalizeText(input.trustProof),
    painPoints: normalizeText(input.painPoints),
    customerCases: normalizeText(input.customerCases),
    materialFiles: Array.isArray(input.materialFiles) ? input.materialFiles.map(normalizeAsset).filter((item) => item.name) : [],
    imageFiles: Array.isArray(input.imageFiles) ? input.imageFiles.map(normalizeAsset).filter((item) => item.name) : [],
    parseStatus: input.parseStatus === "failed" || input.parseStatus === "parsed" ? input.parseStatus : "idle",
    parseMessage: normalizeText(input.parseMessage),
    lastSavedAt: new Date().toISOString(),
  };
}

export function validateEnterpriseProfile(profile: EnterpriseProfile) {
  return requiredEnterpriseFields.filter((field) => !profile[field]);
}

export async function saveEnterpriseProfile(input: Partial<EnterpriseProfile>) {
  const profile = normalizeEnterpriseProfile(input);
  const missingFields = validateEnterpriseProfile(profile);

  if (missingFields.length) {
    const error = new Error(`ENTERPRISE_REQUIRED_FIELDS:${missingFields.join(",")}`);
    error.name = "EnterpriseValidationError";
    throw error;
  }

  await writeJsonFile(profilePath, profile);
  return profile;
}
