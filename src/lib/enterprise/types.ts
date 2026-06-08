export type EnterpriseAssetKind = "material" | "image";
export type EnterpriseParseStatus = "idle" | "parsed" | "failed";

export interface EnterpriseAsset {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: EnterpriseAssetKind;
  uploadedAt: string;
}

export interface EnterpriseProfileFields {
  companyName: string;
  brandShortName: string;
  productService: string;
  region: string;
  brandStory: string;
  productFeatures: string;
  audience: string;
  trustProof: string;
  painPoints: string;
  customerCases: string;
}

export interface EnterpriseProfile extends EnterpriseProfileFields {
  id: "single-enterprise-profile";
  materialFiles: EnterpriseAsset[];
  imageFiles: EnterpriseAsset[];
  parseStatus: EnterpriseParseStatus;
  parseMessage: string;
  lastSavedAt: string;
}

export interface EnterpriseParseResult {
  suggestions: Partial<EnterpriseProfileFields>;
  materialFiles: EnterpriseAsset[];
  imageFiles: EnterpriseAsset[];
  parseStatus: EnterpriseParseStatus;
  parseMessage: string;
}
