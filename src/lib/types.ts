export type TaskStatus =
  | "created"
  | "keyword_generated"
  | "content_generated"
  | "image_generated"
  | "publishing"
  | "published"
  | "failed";

export interface TaskRecord {
  id: string;
  productId: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  selectedKeyword?: string;
  failedStage?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export interface ProductProfile {
  id: string;
  taskId: string;
  productName: string;
  category: string;
  sellingPoints: string;
  targetAudience: string;
  priceRange?: string;
  scenarios: string;
  brandTone: string;
  competitorName?: string;
  competitorKeywords?: string;
  competitorLink?: string;
  restrictedWords?: string;
  complianceNotes?: string;
  productImagePath?: string;
  brandImagePath?: string;
  documentPath?: string;
  scheduledAt?: string;
}

export interface ThemeSet {
  taskId: string;
  mainKeyword: string;
  backupKeywords: string[];
  relatedKeywords: string[];
  scoreSummary: string;
  selectedKeyword?: string;
  updatedAt: string;
}

export interface ContentDraft {
  taskId: string;
  title: string;
  summary: string;
  content: string;
  faq: string[];
  cta: string;
  updatedAt: string;
}

export interface ImageAsset {
  taskId: string;
  assetType: "cover";
  url: string;
  reviewStatus: "pending" | "passed" | "fallback";
  prompt: string;
  provider?: string;
  providerTaskId?: string;
  generationMode?: "prompt" | "reference";
  updatedAt: string;
}

export interface PublishResult {
  taskId: string;
  publishStatus: "published" | "failed" | "publishing";
  publishUrl?: string;
  publishedAt?: string;
  notes?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type SocialPlatform =
  | "xiaohongshu"
  | "douyin"
  | "wechat_mp"
  | "kuaishou"
  | "bilibili"
  | "wechat_official";

export type PublishPlatform = SocialPlatform;
export type LegacyPublishPlatform = PublishPlatform | "blog";

export type PlatformAccountProvider = "extension" | "electron" | "manual";
export type PlatformAccountAuthType = "session" | "cookie" | "manual";
export type PlatformAccountStatus = "saved" | "valid" | "invalid" | "disabled";
export type PlatformAccountLoginStatus = "idle" | "pending" | "authenticated" | "failed" | "cancelled";
export type PublishingJobStatus =
  | "drafted"
  | "queued"
  | "running"
  | "submitted"
  | "verifying"
  | "pending_review"
  | "verification_failed"
  | "manual_pending"
  | "published"
  | "failed";
export type PublishingExecutionMode = "manual_delivery" | "electron_automation" | "extension_automation";
export type LegacyPublishingExecutionMode = PublishingExecutionMode | "blog";

export interface PlatformAccountRecord {
  id: string;
  platform: SocialPlatform;
  provider: PlatformAccountProvider;
  authType: PlatformAccountAuthType;
  source?: string;
  accountName: string;
  displayName?: string;
  avatarUrl?: string;
  status: PlatformAccountStatus;
  loginStatus: PlatformAccountLoginStatus;
  loginUrl?: string;
  sessionPartition?: string;
  authPayload?: string;
  lastLoginStartedAt?: string;
  lastLoginCompletedAt?: string;
  lastValidatedAt?: string;
  authPayloadUpdatedAt?: string;
  loginSessionToken?: string;
  publishSessionToken?: string;
  browserProfileDir?: string;
  lastError?: string;
  lastPublishCompletedAt?: string;
  lastPublishError?: string;
  authPayloadPreview?: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishingDraft {
  id: string;
  taskId: string;
  platform: LegacyPublishPlatform;
  title: string;
  body: string;
  tags: string[];
  coverImageUrl?: string;
  imageUrls: string[];
  publishEntryUrl?: string;
  accountId?: string;
  updatedAt: string;
}

export interface PublishingJobRecord {
  id: string;
  taskId: string;
  platform: LegacyPublishPlatform;
  accountId?: string;
  accountName?: string;
  executionMode: LegacyPublishingExecutionMode;
  status: PublishingJobStatus;
  draftTitle: string;
  draftBody: string;
  draftTags: string[];
  draftImages: string[];
  publishEntryUrl?: string;
  publishUrl?: string;
  draftUrl?: string;
  verificationUrl?: string;
  notes?: string;
  externalStatus?: string;
  executionLog?: string[];
  verificationEvidence?: string;
  verificationAttempts?: number;
  platformItemId?: string;
  sessionToken?: string;
  failureStage?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  submittedAt?: string;
  verifiedAt?: string;
  finishedAt?: string;
  publishedAt?: string;
}

export interface PlatformExtensionLoginSession {
  sessionId: string;
  sessionToken: string;
  platform: SocialPlatform;
  accountId: string | null;
  expiresAt: string;
  loginUrl: string;
}

export interface PlatformExtensionPublishJobPayload {
  id: string;
  platform: LegacyPublishPlatform;
  publishEntryUrl?: string;
  draftTitle: string;
  draftBody: string;
  draftTags: string[];
  draftImages: string[];
  draftVideoUrl?: string;
}

export interface PlatformExtensionPublishSession {
  sessionToken: string;
  expiresAt: string;
  job: PlatformExtensionPublishJobPayload;
  accountAuthPayload: string;
  platformAccountId: string;
  platformAccountName: string;
  platformAccountDisplayName?: string;
}

export interface StoredPlatformExtensionLoginSession extends PlatformExtensionLoginSession {
  accountId: string;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "completed" | "expired" | "failed";
}

export interface StoredPlatformExtensionPublishSession extends PlatformExtensionPublishSession {
  platform: SocialPlatform;
  jobId: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "running" | "success" | "failed" | "expired";
}

export interface ModelApiConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeout: number;
}

export interface PublishApiConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  enableElectronLogin: boolean;
  manualDeliveryBasePath: string;
  preferOfficialApi: boolean;
  electronAutomationEnabled: boolean;
  publishTimeoutMs: number;
  douyinClientId: string;
  douyinClientSecret: string;
}

export interface AppConfig {
  stage1ModelApiConfig: ModelApiConfig;
  contentModelApiConfig: ModelApiConfig;
  imageModelApiConfig: ModelApiConfig;
  publishApiConfig: PublishApiConfig;
}

export interface ReviewResult {
  contentWarnings: string[];
  imageWarnings: string[];
  passed: boolean;
}

export type FolderImportFieldKey =
  | "productName"
  | "category"
  | "sellingPoints"
  | "targetAudience"
  | "scenarios"
  | "brandTone";

export interface FolderImportFile {
  relativePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: "text" | "image" | "unsupported";
}

export interface FolderImportSuggestion {
  field: FolderImportFieldKey;
  label: string;
  value: string;
  confidence: number;
  sourceFiles: string[];
  reason: string;
}

export interface FolderImportPreview {
  files: FolderImportFile[];
  suggestions: FolderImportSuggestion[];
  unmappedFiles: string[];
  warnings: string[];
  rawSummary: string;
  suggestedAssets?: Partial<Pick<TaskCreateInput, "productImagePath" | "brandImagePath" | "documentPath">>;
}

export interface TaskBundle {
  task: TaskRecord;
  product: ProductProfile;
  theme?: ThemeSet;
  content?: ContentDraft;
  image?: ImageAsset;
  publish?: PublishResult;
  review?: ReviewResult;
}

export interface PublishWorkbenchData {
  taskId: string;
  task: TaskRecord;
  product: ProductProfile;
  content?: ContentDraft;
  image?: ImageAsset;
  publish?: PublishResult;
  drafts: PublishingDraft[];
  accounts: PlatformAccountRecord[];
  jobs: PublishingJobRecord[];
}

export type TaskCreateInput = Omit<ProductProfile, "id" | "taskId">;
