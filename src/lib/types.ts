export type TaskStatus =
  | "created"
  | "keyword_generated"
  | "keyword_selected"
  | "task_planned"
  | "content_generated"
  | "image_generated"
  | "publishing"
  | "published"
  | "failed";

export type SearchProvider = "doubao" | "yuanbao" | "tongyi" | "deepseek";
export type AudienceChannel = "social" | "streaming";

export type GeoAiScenario =
  | "doubao_plain_answer"
  | "yuanbao_qa_chain"
  | "deepseek_logic"
  | "tongyi_structured_summary";

export type GeoQuestionIntent =
  | "selection_criteria"
  | "pitfall_avoidance"
  | "price_logic"
  | "scenario_fit"
  | "comparison"
  | "local_service"
  | "faq_cluster"
  | "risk_boundary"
  | "process_solution"
  | "evidence_check";

export type GeoRegionUsage = "explicit" | "implicit" | "none";
export type GeoCommercialStage = "awareness" | "comparison" | "decision" | "retention";

export interface QuestionCandidateScore {
  userRealness: number;
  commercialValue: number;
  aiAnswerability: number;
  platformExtensibility: number;
  novelty: number;
  riskControl: number;
  total: number;
}

export interface QuestionCandidate {
  id: string;
  question: string;
  intent: GeoQuestionIntent;
  targetAiScenarios: GeoAiScenario[];
  contentAngle: string;
  userRole: string;
  regionUsage: GeoRegionUsage;
  commercialStage: GeoCommercialStage;
  mustAnswer: string[];
  evidenceNeeded: string[];
  riskNotes: string[];
  generationRationale: string;
  scores: QuestionCandidateScore;
}

export interface QuestionCandidateSet {
  module: "generate_question_candidates";
  passed: boolean;
  mainQuestion: string;
  questionCandidates: QuestionCandidate[];
  coverage: {
    coveredIntents: GeoQuestionIntent[];
    coveredAiScenarios: GeoAiScenario[];
    coveredReaderRoles: string[];
    missingImportantAngles: string[];
  };
  blockingIssues: string[];
  warnings: string[];
}

export interface QuestionCandidateReview {
  module: "review_question_candidates";
  passed: boolean;
  validQuestionIds: string[];
  invalidQuestionIds: string[];
  blockingIssues: Array<{
    code: string;
    questionId?: string;
    message: string;
    fix: string;
  }>;
  warnings: string[];
  coverageReview: {
    hasEnoughQuestions: boolean;
    intentCount: number;
    aiScenarioCount: number;
    hasMainDecisionQuestion: boolean;
    hasRiskOrPitfallQuestion: boolean;
    hasProcessOrScenarioQuestion: boolean;
  };
}

export interface SelectedQuestionBundle {
  module: "select_question_bundle";
  passed: boolean;
  selectedQuestionBundle: {
    bundleId: string;
    mainQuestion: {
      id: string;
      question: string;
      intent: GeoQuestionIntent;
      contentAngle: string;
    };
    supportingQuestions: Array<{
      id: string;
      question: string;
      intent: GeoQuestionIntent;
      sectionRole: "criteria" | "risk" | "process" | "comparison" | "scenario" | "evidence";
    }>;
    followUpQuestions: Array<{
      id: string;
      question: string;
      faqRole: "clarification" | "objection" | "next_step" | "boundary";
    }>;
    primaryAiScenario: GeoAiScenario;
    secondaryAiScenarios: GeoAiScenario[];
    primaryAngle: string;
    readerRole: string;
    selectionReason: string;
    riskNotes: string[];
  };
  rejectedQuestionIds: string[];
  blockingIssues: string[];
  warnings: string[];
}

export interface TaskRecord {
  id: string;
  productId: string;
  status: TaskStatus;
  searchProvider?: SearchProvider;
  publishPlan?: PublishTaskPlan;
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
  province?: string;
  city?: string;
  district?: string;
  scenarios: string;
  brandTone: string;
  complianceNotes?: string;
  productImagePath?: string;
  brandImagePath?: string;
  documentPath?: string;
}

export interface ThemeSet {
  taskId: string;
  searchProvider: SearchProvider;
  audienceChannels: AudienceChannel[];
  mainKeyword: string;
  backupKeywords: string[];
  relatedKeywords: string[];
  trendKeywords: string[];
  generatedKeywords?: string[];
  highHeatKeywords?: string[];
  mediumHeatKeywords?: string[];
  lowHeatKeywords?: string[];
  recommendedKeywords?: string[];
  candidateKeywords: string[];
  scoreSummary: string;
  rankingSummary: string;
  selectedKeyword?: string;
  selectedKeywords?: string[];
  selectedKeywordTheme?: string;
  questionCandidateSet?: QuestionCandidateSet;
  questionReview?: QuestionCandidateReview;
  selectedQuestionBundle?: SelectedQuestionBundle;
  updatedAt: string;
}

export interface ContentDraft {
  taskId: string;
  title: string;
  summary: string;
  content: string;
  selectedKeywords?: string[];
  selectedKeywordTheme?: string;
  reportIntroduction?: string;
  reportConclusion?: string;
  reportSections?: Array<{
    question: string;
    heading: string;
    summary: string;
    body: string;
  }>;
  faq: string[];
  cta: string;
  aiScenario?: string;
  platform?: string;
  contentAngle?: string;
  promptVersion?: string;
  geoExecutionPackage?: GeoContentExecutionPackage;
  updatedAt: string;
}

export type GeoPipelineStatus = "passed" | "needs_revision" | "blocked";
export type GeoRewriteLevel = "none" | "L1" | "L2" | "L3";

export interface GeoArticleBrief {
  briefId: string;
  taskId: string;
  targetPlatform: string;
  primaryAiScenario: string;
  contentGoal: string;
  readerRole: string;
  mustCover: Array<{
    questionId: string;
    question: string;
    requiredArticleUnit: "title" | "summary" | "answerBlock" | "faq";
    minimumAnswerRequirements: string[];
  }>;
  mustAvoid: string[];
  evidenceBoundaries: Array<{
    claimArea: string;
    allowedEvidence: string[];
    mustUseCautiousLanguage: boolean;
  }>;
  draftConstraints: {
    mustUseAnswerBlocks: boolean;
    mustIncludeRiskNotes: boolean;
    mustIncludeEvidenceBoundary: boolean;
    allowMarkdownTable: boolean;
    maxTitleLength: number | null;
  };
}

export interface GeoStructurePlan {
  module: "plan_ai_readable_structure" | "plan_platform_structure";
  passed: boolean;
  strategyVersion: string;
  outputs: Record<string, unknown>;
  blockingIssues: string[];
  warnings: string[];
}

export interface GeoSimilarityPlan {
  module: "plan_similarity_dispersion";
  passed: boolean;
  similarityPlan: {
    newAngle: string;
    avoidTitlePatterns: string[];
    avoidIntroPatterns: string[];
    avoidFaqQuestions: string[];
    requiredDifferences: string[];
    rewriteLevel: GeoRewriteLevel;
  };
  historyMatches: string[];
  blockingIssues: string[];
  warnings: string[];
}

export interface GeoTrustMarker {
  module: "attach_trust_marker";
  passed: boolean;
  trustMarker: {
    public: {
      header: string;
      footer: string;
      disclaimer: string;
      shortTraceId: string;
    };
    internal: {
      traceId: string;
      taskId: string;
      questionBundleId: string;
      contentHash: string;
      promptVersions: Record<string, string>;
      strategyVersions: Record<string, string>;
      generatedAt: string;
    };
    exposurePolicy: {
      showTimestamp: boolean;
      showShortTraceId: boolean;
      showFullHash: boolean;
      showPgpSignature: boolean;
      showPhpComment: boolean;
    };
  };
  blockingIssues: string[];
  warnings: string[];
}

export interface GeoContentExecutionPackage {
  packageVersion: "geo-keyword-article-exec-v1";
  taskId: string;
  status: GeoPipelineStatus;
  articleBrief: GeoArticleBrief;
  aiStructurePlan: GeoStructurePlan;
  platformStructurePlan: GeoStructurePlan;
  similarityPlan: GeoSimilarityPlan;
  trustMarker: GeoTrustMarker;
  publishableArticlePackage: {
    taskId: string;
    status: "ready_for_human_review" | "needs_revision" | "blocked";
    platform: string;
    aiScenario: string;
    title: string;
    summary: string;
    body: string;
    faq: string[];
    tags: string[];
    cta: string;
    publicTrace: GeoTrustMarker["trustMarker"]["public"];
    internalTrace: GeoTrustMarker["trustMarker"]["internal"];
    reviewReport: unknown;
    sourceQuestionBundle?: SelectedQuestionBundle["selectedQuestionBundle"];
  };
  blockingIssues: string[];
  warnings: string[];
  trace: {
    generatedAt: string;
    promptVersions: Record<string, string>;
    strategyVersions: Record<string, string>;
  };
}

export interface ArticleImagePlacement {
  paragraphIndex: number;
  caption?: string;
}

export interface ArticleImageItem {
  id: string;
  url: string;
  localPath?: string;
  publicUrl?: string;
  prompt: string;
  alt: string;
  question?: string;
  sectionHeading?: string;
  referenceMode?: "article_only" | "reference_enhanced";
  reviewStatus: "pending" | "passed" | "fallback";
  provider?: string;
  providerTaskId?: string;
  generationMode?: "prompt" | "reference";
  placement: ArticleImagePlacement;
}

export interface ImageAsset {
  taskId: string;
  assetType: "cover";
  url: string;
  localCoverPath?: string;
  localImageDir?: string;
  reviewStatus: "pending" | "passed" | "fallback";
  prompt: string;
  provider?: string;
  providerTaskId?: string;
  generationMode?: "prompt" | "reference";
  images?: ArticleImageItem[];
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
  | "toutiao"
  | "baijiahao"
  | "douyin"
  | "xiaohongshu"
  | "wechat"
  | "videohao"
  | "zhihu"
  | "weibo"
  | "csdn";

export type PublishPlatform = SocialPlatform;
export type LegacyPublishPlatform = PublishPlatform;

export type PlatformAccountProvider = "electron" | "manual";
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
export type PublishingExecutionMode = "manual_delivery" | "electron_automation";
export type LegacyPublishingExecutionMode = PublishingExecutionMode;

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
  localImagePaths: string[];
  publishMode?: "text_only" | "with_images";
  publishEntryUrl?: string;
  accountId?: string;
  accountIds?: string[];
  updatedAt: string;
}

export interface AccountPublishingDraft {
  id: string;
  taskId: string;
  platform: SocialPlatform;
  accountId: string;
  accountName?: string;
  searchProvider: SearchProvider;
  sourceContentTaskId?: string;
  sourceTheme?: string;
  title: string;
  body: string;
  tags: string[];
  coverImageUrl?: string;
  imageUrls: string[];
  localImagePaths: string[];
  publishMode?: "text_only" | "with_images";
  publishEntryUrl?: string;
  styleProfile?: string;
  contentLengthProfile?: string;
  updatedAt: string;
}

export interface PublishingJobRecord {
  id: string;
  taskId: string;
  platform: LegacyPublishPlatform;
  contentPoolItemId?: string;
  contentSequence?: number;
  plannedPublishTime?: string;
  keywordText?: string;
  accountPublishingDraftId?: string;
  sourceSearchProvider?: SearchProvider;
  automationStatus?: "ready" | "manual_only" | "planned";
  accountId?: string;
  accountName?: string;
  executionMode: LegacyPublishingExecutionMode;
  status: PublishingJobStatus;
  draftTitle: string;
  draftBody: string;
  draftTags: string[];
  draftImages: string[];
  draftImagePaths: string[];
  publishMode?: "text_only" | "with_images";
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
  executionStage?: string;
  resumeKey?: string;
  lastExecutionAt?: string;
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

export interface PublishStageTimelineEntry {
  stage: string;
  label: string;
  message: string;
  at: string;
}

export interface PublishProgressSnapshot {
  sessionToken: string;
  platform: string;
  status: string;
  currentStage: string;
  currentStageLabel: string;
  startedAt: string;
  lastUpdatedAt: string;
  failureStage?: string;
  errorMessage?: string;
  liveExecutionLog: string[];
  stageTimeline: PublishStageTimelineEntry[];
  imageUploadProgress?: {
    total: number;
    completed: number;
    currentStrategy?: "file_input" | "drop" | "paste";
  };
}

export interface AccountPublishedJobsGroup {
  accountId: string;
  jobs: PublishingJobRecord[];
}

export interface PublishableAccountSummary {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  displayName?: string;
  avatarUrl?: string;
  lastValidatedAt?: string;
}

export interface PlatformAccountDetectionItem {
  platform: SocialPlatform;
  accountCount: number;
  accounts: PublishableAccountSummary[];
  ignoredCount: number;
  manualOnlyCount: number;
  unavailableCount: number;
  detectedAt: string;
  cacheExpiresAt: string;
  fromCache: boolean;
}

export interface PlatformAccountDetectionResult {
  items: PlatformAccountDetectionItem[];
  cacheTtlMinutes: number;
}

export interface PublishTaskPlatformPlan {
  platform: SocialPlatform;
  enabled: boolean;
  accountCount: number;
  accountIds: string[];
  articleCount: number;
  detectionAt?: string;
}

export interface PublishTaskPlan {
  taskId: string;
  enterpriseTaskId: string;
  keywordTaskId: string;
  searchProvider: SearchProvider;
  enabledPlatforms: PublishTaskPlatformPlan[];
  days: number;
  articlesPerAccountPerDay: 2;
  timeWindow: {
    start: "09:00";
    end: "18:00";
  };
  minSameAccountIntervalHours: 3;
  totalAccountCount: number;
  totalArticleCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ContentPoolRiskLevel = "low" | "medium" | "high";
export type ContentPoolItemStatus =
  | "pending_generation"
  | "sample"
  | "pending_publish"
  | "publishing"
  | "published"
  | "failed"
  | "manual_pending";
export type ContentPoolPipelineStatus = "pending" | "processing" | "passed" | "needs_action" | "blocked";

export interface ContentPoolImageItem {
  id: string;
  prompt: string;
  url?: string;
  localPath?: string;
  status: "pending" | "generated" | "failed";
}

export interface ContentPoolPipelineState {
  negativeCheck: {
    status: ContentPoolPipelineStatus;
    hits: string[];
    checkedAt?: string;
  };
  riskReview: {
    status: ContentPoolPipelineStatus;
    level: ContentPoolRiskLevel;
    message: string;
    reviewedAt?: string;
  };
  sampleDraft: {
    status: ContentPoolPipelineStatus;
    passed: boolean;
    checkedAt?: string;
  };
  styleAdaptation: {
    status: ContentPoolPipelineStatus;
    platform: SocialPlatform;
    notes: string[];
  };
  dispersion: {
    status: ContentPoolPipelineStatus;
    changedDimensions: Array<"title" | "opening" | "section_order" | "judgment" | "cta" | "image_prompt">;
    message: string;
  };
  imageGeneration: {
    status: ContentPoolPipelineStatus;
    prompt: string;
    images: ContentPoolImageItem[];
  };
}

export interface ContentPoolItem {
  id: string;
  sequence: number;
  taskId: string;
  aiPlatform: SearchProvider;
  publishPlatform: SocialPlatform;
  accountId: string;
  accountName?: string;
  keywordId: string;
  keywordSequence: number;
  keywordText: string;
  accountKeywordOffset: number;
  plannedPublishTime: string;
  title: string;
  summary: string;
  body: string;
  imagePrompt: string;
  imageList: ContentPoolImageItem[];
  riskLevel: ContentPoolRiskLevel;
  status: ContentPoolItemStatus;
  pipeline: ContentPoolPipelineState;
  publishable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPoolRecord {
  taskId: string;
  sourcePublishPlanUpdatedAt: string;
  currentTaskId: string;
  items: ContentPoolItem[];
  generatedAt: string;
  updatedAt: string;
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
  accountDrafts?: AccountPublishingDraft[];
  accounts: PlatformAccountRecord[];
  jobs: PublishingJobRecord[];
}

export interface TaskCreateInput extends Omit<ProductProfile, "id" | "taskId"> {
  searchProvider: SearchProvider | "";
}
