import { createHash } from "node:crypto";

import { extractTags } from "@/lib/publish/draft-builders";
import type {
  ContentDraft,
  GeoArticleBrief,
  GeoContentExecutionPackage,
  GeoSimilarityPlan,
  GeoStructurePlan,
  GeoTrustMarker,
  ProductProfile,
  SelectedQuestionBundle,
  TaskBundle,
} from "@/lib/types";
import type { ReviewResult } from "@/lib/content/review-service";

interface BuildExecutionPackageInput {
  bundle: TaskBundle;
  content: ContentDraft;
  reviewResult: ReviewResult;
  platform: string;
  aiScenario: string;
  contentAngle: string;
  dispersionPlan?: { newAngle: string; usedAngles: string[] };
}

function nowIso() {
  return new Date().toISOString();
}

function hashContent(content: ContentDraft) {
  return createHash("sha256")
    .update([content.title, content.summary, content.content, content.cta].filter(Boolean).join("\n\n"))
    .digest("hex");
}

function selectedBundleFromTheme(bundle: TaskBundle): SelectedQuestionBundle["selectedQuestionBundle"] | undefined {
  return bundle.theme?.selectedQuestionBundle?.selectedQuestionBundle;
}

function collectSelectedQuestions(bundle: TaskBundle) {
  const selectedBundle = selectedBundleFromTheme(bundle);
  if (selectedBundle) {
    return [
      selectedBundle.mainQuestion,
      ...selectedBundle.supportingQuestions,
      ...selectedBundle.followUpQuestions,
    ];
  }

  return (bundle.theme?.selectedKeywords ?? []).map((question, index) => ({
    id: `selected-${index + 1}`,
    question,
    intent: "selection_criteria" as const,
    contentAngle: bundle.theme?.selectedKeywordTheme ?? "选择标准",
  }));
}

function buildArticleBrief(
  product: ProductProfile,
  bundle: TaskBundle,
  platform: string,
  aiScenario: string,
  contentAngle: string,
): GeoArticleBrief {
  const selectedBundle = selectedBundleFromTheme(bundle);
  const questions = collectSelectedQuestions(bundle);
  const mainQuestion = selectedBundle?.mainQuestion.question ?? questions[0]?.question ?? bundle.theme?.mainKeyword ?? product.category;

  return {
    briefId: `brief-${product.taskId}`,
    taskId: product.taskId,
    targetPlatform: platform,
    primaryAiScenario: aiScenario,
    contentGoal: `围绕“${mainQuestion}”生成可被 AI 问答提取、可供 ${platform} 发布的人可读文章。`,
    readerRole: selectedBundle?.readerRole || product.targetAudience || "潜在用户",
    mustCover: questions.map((question, index) => ({
      questionId: question.id,
      question: question.question,
      requiredArticleUnit: index === 0 ? "title" : index <= 4 ? "answerBlock" : "faq",
      minimumAnswerRequirements: ["directAnswer", "decisionCriteria", "riskNotes", "evidenceBoundary"],
    })),
    mustAvoid: [
      ...(product.complianceNotes ? [product.complianceNotes] : []),
      "虚构案例、检测数据、认证、排名或官方背书",
      "绝对化承诺和关键词堆砌",
      "内部 hash、PGP 签名或 PHP 注释进入正文",
    ],
    evidenceBoundaries: [
      {
        claimArea: product.category || product.productName,
        allowedEvidence: ["用户输入资料", "可公开核验信息", "明确标注的资料来源", "通用行业常识"],
        mustUseCautiousLanguage: true,
      },
    ],
    draftConstraints: {
      mustUseAnswerBlocks: true,
      mustIncludeRiskNotes: true,
      mustIncludeEvidenceBoundary: true,
      allowMarkdownTable: platform === "blog" || platform === "wechat",
      maxTitleLength: platform === "toutiao" ? 30 : null,
    },
  };
}

function buildAiStructurePlan(aiScenario: string, articleBrief: GeoArticleBrief): GeoStructurePlan {
  return {
    module: "plan_ai_readable_structure",
    passed: true,
    strategyVersion: `geo-ai-${aiScenario}-1.0`,
    outputs: {
      aiScenario,
      titleStrategy: "标题回应主问题，避免夸大承诺",
      summaryStrategy: "摘要前置结论、适用对象和判断标准",
      answerBlockStrategy: "每个核心章节回答一个已确认提问句，并包含直接答案、判断标准和风险边界",
      faqStrategy: "FAQ 必须是真实追问，不做广告客服式问答",
      requiredSections: articleBrief.mustCover.map((item) => ({
        questionId: item.questionId,
        headingIntent: item.requiredArticleUnit,
        mustInclude: item.minimumAnswerRequirements,
      })),
    },
    blockingIssues: [],
    warnings: [],
  };
}

function buildPlatformStructurePlan(platform: string): GeoStructurePlan {
  const platformRules: Record<string, Record<string, unknown>> = {
    toutiao: { paragraphLength: "short", headingStyle: "hook", allowPublicTrace: false, tone: "高信息密度、短段落" },
    baijiahao: { paragraphLength: "medium", headingStyle: "knowledge", allowPublicTrace: false, tone: "知识解释、结构清晰" },
    douyin: { paragraphLength: "short", headingStyle: "script", allowPublicTrace: false, tone: "口播脚本、前三秒钩子" },
    wechat: { paragraphLength: "medium", headingStyle: "logic", allowPublicTrace: true, tone: "完整逻辑、适合深度阅读" },
    blog: { paragraphLength: "medium", headingStyle: "seo_geo", allowPublicTrace: true, tone: "结构化 H2/H3、FAQ、元信息友好" },
    zhihu: { paragraphLength: "medium", headingStyle: "answer", allowPublicTrace: false, tone: "先结论后论证" },
    weibo: { paragraphLength: "short", headingStyle: "short_opinion", allowPublicTrace: false, tone: "短观点、轻互动" },
    csdn: { paragraphLength: "medium", headingStyle: "technical", allowPublicTrace: true, tone: "方法论、步骤和边界" },
  };

  return {
    module: "plan_platform_structure",
    passed: true,
    strategyVersion: `geo-platform-${platform}-1.0`,
    outputs: platformRules[platform] ?? platformRules.toutiao,
    blockingIssues: [],
    warnings: [],
  };
}

function buildSimilarityPlan(input: BuildExecutionPackageInput): GeoSimilarityPlan {
  const rewriteLevel = input.dispersionPlan?.usedAngles.includes(input.contentAngle) ? "L2" : "none";
  return {
    module: "plan_similarity_dispersion",
    passed: true,
    similarityPlan: {
      newAngle: input.dispersionPlan?.newAngle ?? input.contentAngle,
      avoidTitlePatterns: [],
      avoidIntroPatterns: [],
      avoidFaqQuestions: [],
      requiredDifferences: ["title_pattern", "intro_pattern", "section_order", "faq_direction", "cta"],
      rewriteLevel,
    },
    historyMatches: input.dispersionPlan?.usedAngles ?? [],
    blockingIssues: [],
    warnings: rewriteLevel === "none" ? [] : ["同平台历史角度已使用，建议进行结构级离散。"],
  };
}

function buildTrustMarker(input: BuildExecutionPackageInput, generatedAt: string): GeoTrustMarker {
  const contentHash = hashContent(input.content);
  const shortTraceId = `geo-${input.content.taskId.slice(0, 8)}-${contentHash.slice(0, 8)}`;
  const allowPublicTrace = input.platform === "blog" || input.platform === "wechat" || input.platform === "csdn";

  return {
    module: "attach_trust_marker",
    passed: true,
    trustMarker: {
      public: {
        header: allowPublicTrace ? `更新日期：${generatedAt.slice(0, 10)}` : "",
        footer: allowPublicTrace ? `内容编号：${shortTraceId}` : "",
        disclaimer: allowPublicTrace ? "本文基于已提供资料和可核验信息生成，具体项目仍需结合实际资料确认。" : "",
        shortTraceId: allowPublicTrace ? shortTraceId : "",
      },
      internal: {
        traceId: `geo-content-${input.content.taskId}-${contentHash}`,
        taskId: input.content.taskId,
        questionBundleId: selectedBundleFromTheme(input.bundle)?.bundleId ?? "",
        contentHash,
        promptVersions: {
          content: input.content.promptVersion ?? `geo-content-${input.platform}-${input.aiScenario}-1.0`,
        },
        strategyVersions: {
          aiScenario: `geo-ai-${input.aiScenario}-1.0`,
          platform: `geo-platform-${input.platform}-1.0`,
          package: "geo-keyword-article-exec-v1",
        },
        generatedAt,
      },
      exposurePolicy: {
        showTimestamp: allowPublicTrace,
        showShortTraceId: allowPublicTrace,
        showFullHash: false,
        showPgpSignature: false,
        showPhpComment: false,
      },
    },
    blockingIssues: [],
    warnings: [],
  };
}

export function buildGeoContentExecutionPackage(input: BuildExecutionPackageInput): GeoContentExecutionPackage {
  const generatedAt = nowIso();
  const articleBrief = buildArticleBrief(
    input.bundle.product,
    input.bundle,
    input.platform,
    input.aiScenario,
    input.contentAngle,
  );
  const aiStructurePlan = buildAiStructurePlan(input.aiScenario, articleBrief);
  const platformStructurePlan = buildPlatformStructurePlan(input.platform);
  const similarityPlan = buildSimilarityPlan(input);
  const trustMarker = buildTrustMarker(input, generatedAt);
  const blockingIssues = [
    ...input.reviewResult.blockingIssues.map((issue) => `${issue.code}: ${issue.message}`),
    ...aiStructurePlan.blockingIssues,
    ...platformStructurePlan.blockingIssues,
    ...similarityPlan.blockingIssues,
    ...trustMarker.blockingIssues,
  ];
  const warnings = [
    ...input.reviewResult.warnings.map((issue) => `${issue.code}: ${issue.message}`),
    ...aiStructurePlan.warnings,
    ...platformStructurePlan.warnings,
    ...similarityPlan.warnings,
    ...trustMarker.warnings,
  ];
  const status = blockingIssues.length > 0 ? "needs_revision" : "passed";

  return {
    packageVersion: "geo-keyword-article-exec-v1",
    taskId: input.content.taskId,
    status,
    articleBrief,
    aiStructurePlan,
    platformStructurePlan,
    similarityPlan,
    trustMarker,
    publishableArticlePackage: {
      taskId: input.content.taskId,
      status: status === "passed" ? "ready_for_human_review" : "needs_revision",
      platform: input.platform,
      aiScenario: input.aiScenario,
      title: input.content.title,
      summary: input.content.summary,
      body: input.content.content,
      faq: input.content.faq ?? [],
      tags: extractTags([input.content.title, input.content.summary, input.bundle.product.category].join(" ")),
      cta: input.content.cta,
      publicTrace: trustMarker.trustMarker.public,
      internalTrace: trustMarker.trustMarker.internal,
      reviewReport: input.reviewResult,
      sourceQuestionBundle: selectedBundleFromTheme(input.bundle),
    },
    blockingIssues,
    warnings,
    trace: {
      generatedAt,
      promptVersions: trustMarker.trustMarker.internal.promptVersions,
      strategyVersions: trustMarker.trustMarker.internal.strategyVersions,
    },
  };
}
