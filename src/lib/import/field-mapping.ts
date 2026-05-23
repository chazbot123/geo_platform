import type { FolderImportFieldKey } from "@/lib/types";

export const requiredImportFields: FolderImportFieldKey[] = [
  "productName",
  "category",
  "sellingPoints",
  "targetAudience",
  "scenarios",
  "brandTone",
];

export const folderImportFieldLabels: Record<FolderImportFieldKey, string> = {
  productName: "产品名称",
  category: "产品品类",
  sellingPoints: "核心卖点",
  targetAudience: "目标人群",
  scenarios: "适用场景",
  brandTone: "品牌调性",
};

export function getFolderImportFieldLabel(field: FolderImportFieldKey) {
  return folderImportFieldLabels[field];
}
