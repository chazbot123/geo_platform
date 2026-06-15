import path from "node:path";
import { dataRoot } from "@/lib/paths";
import { ensureDir, readJsonFile, writeJsonFile } from "@/lib/storage/json-store";

export type EnterpriseKeywordCoreField = "companyName" | "brandShortName" | "productService" | "region";

export interface KeywordEnterpriseProfile {
  companyName?: string;
  brandShortName?: string;
  productService?: string;
  region?: string;
}

export interface KeywordSetEnterpriseSnapshot {
  enterpriseName: string;
  brandShortName: string;
  productService: string;
  region: string;
  staleAt?: string;
  staleReason?: string;
  staleFields?: EnterpriseKeywordCoreField[];
  updatedAt: string;
}

const CUSTOMER_KEYWORD_DIR = path.join(dataRoot, "customer-keywords");
const CUSTOMER_KEYWORD_PATH = path.join(CUSTOMER_KEYWORD_DIR, "current.json");

export const ENTERPRISE_KEYWORD_CORE_FIELDS: EnterpriseKeywordCoreField[] = [
  "companyName",
  "brandShortName",
  "productService",
  "region",
];

function compactText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeComparableText(value: unknown) {
  return compactText(value).replace(/\s+/g, " ");
}

export function getEnterpriseKeywordChangedFields(
  previous: KeywordEnterpriseProfile | null | undefined,
  next: KeywordEnterpriseProfile | null | undefined,
) {
  if (!previous || !next) return [];
  return ENTERPRISE_KEYWORD_CORE_FIELDS.filter(
    (field) => normalizeComparableText(previous[field]) !== normalizeComparableText(next[field]),
  );
}

export function getKeywordEnterpriseChangedFields<T extends KeywordSetEnterpriseSnapshot>(
  keywordSet: T | null | undefined,
  enterprise: KeywordEnterpriseProfile | null | undefined,
) {
  if (!keywordSet || !enterprise) return [];
  return getEnterpriseKeywordChangedFields(
    {
      companyName: keywordSet.enterpriseName,
      brandShortName: keywordSet.brandShortName,
      productService: keywordSet.productService,
      region: keywordSet.region,
    },
    enterprise,
  );
}

export function withKeywordStaleState<T extends KeywordSetEnterpriseSnapshot>(
  keywordSet: T,
  staleFields: EnterpriseKeywordCoreField[],
  timestamp?: string,
) {
  if (!staleFields.length) return keywordSet;
  const staleAt = keywordSet.staleAt || timestamp || new Date().toISOString();
  return {
    ...keywordSet,
    staleAt,
    staleReason: keywordSet.staleReason || "ENTERPRISE_PROFILE_CHANGED",
    staleFields: keywordSet.staleFields?.length ? keywordSet.staleFields : staleFields,
    updatedAt: keywordSet.updatedAt || staleAt,
  };
}

export function isCustomerKeywordSetStale<T extends KeywordSetEnterpriseSnapshot>(
  keywordSet: T | null | undefined,
  enterprise?: KeywordEnterpriseProfile | null,
) {
  if (!keywordSet) return false;
  if (keywordSet.staleAt) return true;
  return getKeywordEnterpriseChangedFields(keywordSet, enterprise).length > 0;
}

export async function markCustomerKeywordsStaleForEnterpriseChange(
  previous: KeywordEnterpriseProfile | null | undefined,
  next: KeywordEnterpriseProfile | null | undefined,
) {
  const staleFields = getEnterpriseKeywordChangedFields(previous, next);
  if (!staleFields.length) return null;

  const keywordSet = await readJsonFile<KeywordSetEnterpriseSnapshot | null>(CUSTOMER_KEYWORD_PATH, null);
  if (!keywordSet) return null;
  if (keywordSet.staleAt) return keywordSet;

  const timestamp = new Date().toISOString();
  const nextKeywordSet = withKeywordStaleState(keywordSet, staleFields, timestamp);
  await ensureDir(CUSTOMER_KEYWORD_DIR);
  await writeJsonFile(CUSTOMER_KEYWORD_PATH, nextKeywordSet);
  return nextKeywordSet;
}
