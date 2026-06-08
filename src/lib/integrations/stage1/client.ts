import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  callConfiguredTextModel,
  classifyOpenAICompatibleHttpStatus,
  NewAPIProbeError,
  OpenAICompatibleHttpError,
  OpenAICompatibleResponseParseError,
  parseJsonFromModelText,
} from "@/lib/integrations/openai-compatible";
import type {
  AudienceChannel,
  GeoAiScenario,
  GeoCommercialStage,
  GeoQuestionIntent,
  GeoRegionUsage,
  ModelApiConfig,
  ProductProfile,
  QuestionCandidate,
  QuestionCandidateReview,
  QuestionCandidateSet,
  SearchProvider,
  SelectedQuestionBundle,
  ThemeSet,
} from "@/lib/types";

const SCENARIO_BY_PROVIDER: Record<SearchProvider, GeoAiScenario> = {
  doubao: "doubao_plain_answer",
  yuanbao: "yuanbao_qa_chain",
  tongyi: "tongyi_structured_summary",
  deepseek: "deepseek_logic",
};

const INTENT_LABELS: Record<GeoQuestionIntent, string> = {
  selection_criteria: "选择标准",
  pitfall_avoidance: "避坑判断",
  price_logic: "价格逻辑",
  scenario_fit: "场景适配",
  comparison: "对比选择",
  local_service: "本地服务",
  faq_cluster: "常见追问",
  risk_boundary: "风险边界",
  process_solution: "流程方案",
  evidence_check: "证据核验",
};

const FORBIDDEN_ABSOLUTE_WORDS = ["最好", "第一", "唯一", "保证", "根治", "稳赚", "永久有效", "必火", "包过"];
const PLACEHOLDER_PATTERN = /\{[^}]+\}|{{[^}]+}}|<[^>]+>/;

function unique(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function formatRegion(product: ProductProfile) {
  return [product.province, product.city, product.district].filter(Boolean).join("");
}

function isFullQuestion(question: string) {
  return /[？?]$/.test(question.trim()) && question.trim().length >= 8;
}

function normalizeQuestion(question: string) {
  const trimmed = question.trim().replace(/[。.!！]+$/g, "");
  return /[？?]$/.test(trimmed) ? trimmed : `${trimmed}？`;
}

function inferIntent(question: string, product: ProductProfile): GeoQuestionIntent {
  if (/(避坑|踩坑|误区|注意什么|风险)/.test(question)) return "pitfall_avoidance";
  if (/(多少钱|价格|报价|费用|收费)/.test(question)) return "price_logic";
  if (/(适合|场景|用在|能解决)/.test(question)) return "scenario_fit";
  if (/(相比|对比|区别|怎么选)/.test(question)) return "comparison";
  if (formatRegion(product) && /(哪家|本地|附近|当地)/.test(question)) return "local_service";
  if (/(常见问题|问清楚|怎么问|有哪些问题)/.test(question)) return "faq_cluster";
  if (/(边界|风险|不适合|不能)/.test(question)) return "risk_boundary";
  if (/(流程|步骤|交付|从.*到)/.test(question)) return "process_solution";
  if (/(验证|判断|是否靠谱|依据|资质|案例)/.test(question)) return "evidence_check";
  return "selection_criteria";
}

function inferCommercialStage(intent: GeoQuestionIntent): GeoCommercialStage {
  if (intent === "selection_criteria" || intent === "comparison" || intent === "local_service") return "decision";
  if (intent === "price_logic" || intent === "evidence_check") return "comparison";
  if (intent === "faq_cluster" || intent === "process_solution") return "retention";
  return "awareness";
}

function inferRegionUsage(question: string, product: ProductProfile): GeoRegionUsage {
  const regionParts = [product.province, product.city, product.district].filter((region): region is string => Boolean(region));
  if (!regionParts.length) return "none";
  return regionParts.some((region) => question.includes(region)) ? "explicit" : "implicit";
}

function inferMustAnswer(intent: GeoQuestionIntent, product: ProductProfile) {
  const base = ["直接回答问题", "给出判断标准", "说明证据边界"];
  if (intent === "price_logic") return [...base, "说明影响价格的因素"];
  if (intent === "pitfall_avoidance" || intent === "risk_boundary") return [...base, "列出风险提示"];
  if (intent === "process_solution") return [...base, "说明服务或使用流程"];
  if (intent === "scenario_fit") return [...base, `结合${product.scenarios || "典型场景"}说明适用边界`];
  return base;
}

function scoreQuestion(question: string, intent: GeoQuestionIntent, product: ProductProfile, existing: string[]) {
  const hasRegion = inferRegionUsage(question, product) === "explicit";
  const hasCommercialIntent = /(怎么选|哪家|报价|多少钱|靠谱吗|比较|适合|避坑|流程|判断)/.test(question);
  const hasRiskyWord = FORBIDDEN_ABSOLUTE_WORDS.some((word) => question.includes(word));
  const duplicate = existing.some((item) => item !== question && (item.includes(question) || question.includes(item)));
  const userRealness = isFullQuestion(question) && !PLACEHOLDER_PATTERN.test(question) ? 5 : 2;
  const commercialValue = hasCommercialIntent ? 5 : 3;
  const aiAnswerability = question.length > 60 ? 4 : 5;
  const platformExtensibility = ["selection_criteria", "comparison", "pitfall_avoidance", "process_solution"].includes(intent) ? 5 : 4;
  const novelty = duplicate ? 2 : 5;
  const riskControl = hasRiskyWord ? 1 : hasRegion ? 5 : 4;
  const total =
    userRealness * 1.2 +
    commercialValue * 1.0 +
    aiAnswerability * 1.2 +
    platformExtensibility * 0.8 +
    novelty * 1.0 +
    riskControl * 1.3;

  return { userRealness, commercialValue, aiAnswerability, platformExtensibility, novelty, riskControl, total };
}

function mapIntentToSectionRole(intent: GeoQuestionIntent) {
  if (intent === "pitfall_avoidance" || intent === "risk_boundary") return "risk" as const;
  if (intent === "process_solution") return "process" as const;
  if (intent === "comparison" || intent === "price_logic") return "comparison" as const;
  if (intent === "scenario_fit" || intent === "local_service") return "scenario" as const;
  if (intent === "evidence_check") return "evidence" as const;
  return "criteria" as const;
}

function buildQuestionCandidateSet(
  product: ProductProfile,
  searchProvider: SearchProvider,
  recommendedQuestions: string[],
): QuestionCandidateSet {
  const targetScenario = SCENARIO_BY_PROVIDER[searchProvider];
  const normalizedQuestions = unique(recommendedQuestions.map(normalizeQuestion)).slice(0, 10);
  const questionCandidates: QuestionCandidate[] = normalizedQuestions.map((question, index) => {
    const intent = inferIntent(question, product);
    const scores = scoreQuestion(question, intent, product, normalizedQuestions);
    return {
      id: `q${index + 1}`,
      question,
      intent,
      targetAiScenarios: [targetScenario],
      contentAngle: INTENT_LABELS[intent],
      userRole: product.targetAudience || "潜在用户",
      regionUsage: inferRegionUsage(question, product),
      commercialStage: inferCommercialStage(intent),
      mustAnswer: inferMustAnswer(intent, product),
      evidenceNeeded: ["用户输入资料", "可公开核验信息", "服务边界说明"],
      riskNotes: FORBIDDEN_ABSOLUTE_WORDS.some((word) => question.includes(word)) ? ["问题包含绝对化表达，需要改写"] : [],
      generationRationale: "基于产品品类、地区、人群和真实 AI 问答场景生成完整提问句。",
      scores,
    };
  });
  const coveredIntents = Array.from(new Set(questionCandidates.map((item) => item.intent)));
  const coveredReaderRoles = Array.from(new Set(questionCandidates.map((item) => item.userRole).filter(Boolean)));
  const missingImportantAngles = [
    !coveredIntents.includes("selection_criteria") ? "缺少选择标准问题" : "",
    !coveredIntents.some((intent) => intent === "pitfall_avoidance" || intent === "risk_boundary") ? "缺少避坑或风险问题" : "",
    !coveredIntents.some((intent) => intent === "process_solution" || intent === "scenario_fit") ? "缺少流程或场景问题" : "",
  ].filter(Boolean);

  return {
    module: "generate_question_candidates",
    passed: questionCandidates.length >= 8 && missingImportantAngles.length === 0,
    mainQuestion: questionCandidates[0]?.question ?? "",
    questionCandidates,
    coverage: {
      coveredIntents,
      coveredAiScenarios: [targetScenario],
      coveredReaderRoles,
      missingImportantAngles,
    },
    blockingIssues: questionCandidates.length < 8 ? ["VALID_QUESTION_COUNT_LT_8"] : [],
    warnings: missingImportantAngles,
  };
}

function reviewQuestionCandidateSet(candidateSet: QuestionCandidateSet): QuestionCandidateReview {
  const seen = new Set<string>();
  const blockingIssues: QuestionCandidateReview["blockingIssues"] = [];
  const validQuestionIds: string[] = [];
  const invalidQuestionIds: string[] = [];

  for (const candidate of candidateSet.questionCandidates) {
    const issues: string[] = [];
    if (!isFullQuestion(candidate.question)) issues.push("NOT_A_FULL_QUESTION");
    if (seen.has(candidate.question)) issues.push("DUPLICATE_QUESTION");
    if (PLACEHOLDER_PATTERN.test(candidate.question)) issues.push("UNANSWERABLE_QUESTION");
    if (FORBIDDEN_ABSOLUTE_WORDS.some((word) => candidate.question.includes(word))) issues.push("UNVERIFIABLE_SUPERLATIVE");
    if (!candidate.intent) issues.push("MISSING_INTENT");
    if (!candidate.targetAiScenarios.length) issues.push("MISSING_AI_SCENARIO");

    seen.add(candidate.question);
    if (issues.length) {
      invalidQuestionIds.push(candidate.id);
      issues.forEach((code) =>
        blockingIssues.push({
          code,
          questionId: candidate.id,
          message: `提问句「${candidate.question}」未通过 ${code} 检查。`,
          fix: "改写为真实用户会直接输入、可回答、无占位符和无绝对化承诺的完整问题。",
        }),
      );
    } else {
      validQuestionIds.push(candidate.id);
    }
  }

  const intentCount = new Set(
    candidateSet.questionCandidates.filter((item) => validQuestionIds.includes(item.id)).map((item) => item.intent),
  ).size;
  const aiScenarioCount = new Set(
    candidateSet.questionCandidates
      .filter((item) => validQuestionIds.includes(item.id))
      .flatMap((item) => item.targetAiScenarios),
  ).size;
  const hasMainDecisionQuestion = candidateSet.questionCandidates.some((item) =>
    ["selection_criteria", "comparison", "local_service"].includes(item.intent),
  );
  const hasRiskOrPitfallQuestion = candidateSet.questionCandidates.some((item) =>
    ["pitfall_avoidance", "risk_boundary"].includes(item.intent),
  );
  const hasProcessOrScenarioQuestion = candidateSet.questionCandidates.some((item) =>
    ["process_solution", "scenario_fit"].includes(item.intent),
  );
  const hasEnoughQuestions = validQuestionIds.length >= 8;

  if (!hasEnoughQuestions) {
    blockingIssues.push({
      code: "VALID_QUESTION_COUNT_LT_8",
      message: `有效提问句不足 8 条，当前为 ${validQuestionIds.length} 条。`,
      fix: "重新生成或补足覆盖不同 intent 的完整提问句。",
    });
  }
  if (intentCount < 4) {
    blockingIssues.push({
      code: "INTENT_COVERAGE_LT_4",
      message: `提问句 intent 覆盖不足 4 类，当前为 ${intentCount} 类。`,
      fix: "补充选择、避坑、价格、场景、对比、流程等不同意图问题。",
    });
  }

  return {
    module: "review_question_candidates",
    passed: blockingIssues.length === 0,
    validQuestionIds,
    invalidQuestionIds,
    blockingIssues,
    warnings: candidateSet.warnings,
    coverageReview: {
      hasEnoughQuestions,
      intentCount,
      aiScenarioCount,
      hasMainDecisionQuestion,
      hasRiskOrPitfallQuestion,
      hasProcessOrScenarioQuestion,
    },
  };
}

function selectQuestionBundle(candidateSet: QuestionCandidateSet, review: QuestionCandidateReview): SelectedQuestionBundle {
  const validCandidates = candidateSet.questionCandidates
    .filter((item) => review.validQuestionIds.includes(item.id))
    .sort((a, b) => b.scores.total - a.scores.total);
  const mainQuestion =
    validCandidates.find((item) => ["selection_criteria", "comparison", "local_service"].includes(item.intent)) ??
    validCandidates[0];

  if (!mainQuestion) {
    return {
      module: "select_question_bundle",
      passed: false,
      selectedQuestionBundle: {
        bundleId: "",
        mainQuestion: { id: "", question: "", intent: "selection_criteria", contentAngle: "" },
        supportingQuestions: [],
        followUpQuestions: [],
        primaryAiScenario: "deepseek_logic",
        secondaryAiScenarios: [],
        primaryAngle: "",
        readerRole: "",
        selectionReason: "",
        riskNotes: [],
      },
      rejectedQuestionIds: candidateSet.questionCandidates.map((item) => item.id),
      blockingIssues: ["NO_VALID_MAIN_QUESTION"],
      warnings: [],
    };
  }

  const supportingQuestions = validCandidates
    .filter((item) => item.id !== mainQuestion.id)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.intent === item.intent) === index)
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      question: item.question,
      intent: item.intent,
      sectionRole: mapIntentToSectionRole(item.intent),
    }));
  const followUpQuestions = validCandidates
    .filter((item) => item.id !== mainQuestion.id && !supportingQuestions.some((question) => question.id === item.id))
    .slice(0, 3)
    .map((item, index) => ({
      id: item.id,
      question: item.question,
      faqRole: (["clarification", "objection", "next_step"] as const)[index] ?? "boundary",
    }));
  const primaryAiScenario = mainQuestion.targetAiScenarios[0] ?? "deepseek_logic";
  const secondaryAiScenarios = Array.from(
    new Set(validCandidates.flatMap((item) => item.targetAiScenarios).filter((scenario) => scenario !== primaryAiScenario)),
  );

  return {
    module: "select_question_bundle",
    passed: supportingQuestions.length >= 2,
    selectedQuestionBundle: {
      bundleId: `qb-${candidateSet.mainQuestion ? String(candidateSet.mainQuestion.length) : Date.now()}`,
      mainQuestion: {
        id: mainQuestion.id,
        question: mainQuestion.question,
        intent: mainQuestion.intent,
        contentAngle: mainQuestion.contentAngle,
      },
      supportingQuestions,
      followUpQuestions,
      primaryAiScenario,
      secondaryAiScenarios,
      primaryAngle: mainQuestion.contentAngle,
      readerRole: mainQuestion.userRole,
      selectionReason: "优先选择分数较高、适合展开成文章标题基础且能带动多角度回答的提问句。",
      riskNotes: validCandidates.flatMap((item) => item.riskNotes),
    },
    rejectedQuestionIds: candidateSet.questionCandidates
      .filter((item) => ![mainQuestion.id, ...supportingQuestions.map((q) => q.id), ...followUpQuestions.map((q) => q.id)].includes(item.id))
      .map((item) => item.id),
    blockingIssues: supportingQuestions.length >= 2 ? [] : ["SUPPORTING_QUESTION_COUNT_LT_2"],
    warnings: review.warnings,
  };
}

function buildMockKeywords(
  product: ProductProfile,
  searchProvider: SearchProvider,
  audienceChannels: AudienceChannel[],
) {
  const region = formatRegion(product);
  const regionPrefix = region || "当前地区";
  const productName = product.productName || product.category;
  const sellingPoint = product.sellingPoints.split(/[，。；;、]/).find(Boolean)?.trim() || product.sellingPoints.trim();
  const scenario = product.scenarios.split(/[，。；;、]/).find(Boolean)?.trim() || product.scenarios.trim();
  const audience = product.targetAudience.split(/[，。；;、]/).find(Boolean)?.trim() || product.targetAudience.trim();
  const recommendedKeywords = unique([
    `${region ? `${region}的` : ""}${audience}在 AI 平台会怎么问${productName}到底值不值得选？`,
    `${productName}适不适合${audience}，在 AI 平台应该怎么提问才能拿到靠谱建议？`,
    `${scenario}场景下，用户会怎样向 AI 询问${productName}的具体用法？`,
    `${productName}和同类${product.category}相比，用户通常会怎么向 AI 问差异？`,
    `${productName}的核心卖点是不是${sellingPoint || "真正有价值"}，该怎么问 AI 验证？`,
    `${regionPrefix}${product.category}用户在购买前最常向 AI 问哪些问题？`,
    `${productName}有哪些容易踩坑的点，用户会怎么先问 AI？`,
    `${audience}如果第一次接触${productName}，通常会怎么向 AI 开口？`,
    `${productName}在${scenario}里能解决什么问题，用户会怎么向 AI 提问？`,
    `${regionPrefix}${audience}想了解${productName}时，最像真人会输入的 AI 问题有哪些？`,
  ]).slice(0, 10);
  const mainKeyword = recommendedKeywords[0] || `${productName}适合什么人问 AI？`;
  const backupKeywords = recommendedKeywords.slice(1, 4);
  const relatedKeywords = recommendedKeywords.slice(4, 9);
  const trendKeywords = recommendedKeywords.slice(2, 10);
  const candidateKeywords = recommendedKeywords;
  const generatedKeywords = recommendedKeywords;
  const scoreSummary = `围绕 ${region || "目标地区"} 的 ${product.category}、${productName}、${product.targetAudience} 与 ${product.scenarios}，直接整理 10 条适合 ${audienceChannels.join(" / ")} 内容场景的 AI 提问句。`;
  const rankingSummary = `当前使用 ${searchProvider} 检索逻辑，直接基于用户上传的产品、卖点、人群、场景和地区信息输出 10 条可供挑选的 AI 提问句。`;
  return {
    mainKeyword,
    backupKeywords,
    relatedKeywords,
    trendKeywords,
    generatedKeywords,
    recommendedKeywords,
    candidateKeywords,
    scoreSummary,
    rankingSummary,
  };
}

interface Stage1ResponsePayload {
  mainKeyword?: string;
  backupKeywords?: string[];
  relatedKeywords?: string[];
  trendKeywords?: string[];
  generatedKeywords?: string[];
  recommendedKeywords?: string[];
  candidateKeywords?: string[];
  scoreSummary?: string;
  rankingSummary?: string;
  selectedKeyword?: string;
  selectedKeywords?: string[];
  selectedKeywordTheme?: string;
}

function sanitizeKeywordList(items: unknown, fallback: string[] = [], limit = 10) {
  const primary = Array.isArray(items)
    ? items
        .map((item) => (typeof item === "string" ? item : ""))
        .filter(Boolean)
    : [];

  return unique([...primary, ...fallback]).slice(0, limit);
}

function buildSearchProviderInstruction(searchProvider: SearchProvider) {
  switch (searchProvider) {
    case "doubao":
      return "偏向生成用户在 AI 平台会怎样提问行业和产品，强调问题表达自然、清晰、利于商业决策。";
    case "yuanbao":
      return "偏问答需求、用户顾虑和消费疑问，强调提问句的真实感和用户顾虑。";
    case "tongyi":
      return "偏类目、人群、购买场景和意图拆解，强调问题结构化与可执行性。";
    case "deepseek":
    default:
      return "偏逻辑推演、组合扩展和提问排序，强调问题的完整性与层次感。";
  }
}

const STAGE1_PROMPT_TEMPLATE_PATH = path.join(process.cwd(), "src", "lib", "integrations", "stage1", "keyword-retrieval-prompt.md");

function buildFallbackPromptTemplate() {
  return [
    "# GEO AI 提问句检索提示词模板",
    "",
    "你是 GEO 第一阶段 AI 提问句分析助手。",
    "你的任务是基于产品资料直接整理 10 条用户在 AI 平台会怎么提问该产品或品牌的完整问句。",
    "",
    "## 总体规则",
    "1. 提问句必须是完整中文问题，像真实用户在 AI 平台直接输入的问题。",
    "2. 结果必须覆盖认知、对比、顾虑、决策、场景、避坑等角度。",
    "3. 直接输出 10 条推荐提问句，不要生成额外的中间结果。",
    "",
    "## 输出要求",
    "1. 必须只返回 JSON，不要输出 Markdown，不要输出额外解释。",
    '2. JSON 结构必须兼容 {"mainKeyword":"", "recommendedKeywords":[""], "candidateKeywords":[""], "scoreSummary":"", "rankingSummary":""}。',
  ].join("\n");
}

async function readKeywordRetrievalPromptTemplate() {
  try {
    const content = await readFile(STAGE1_PROMPT_TEMPLATE_PATH, "utf-8");
    const trimmed = content.trim();
    return trimmed || buildFallbackPromptTemplate();
  } catch {
    return buildFallbackPromptTemplate();
  }
}

async function buildQuestionMessages(
  product: ProductProfile,
  searchProvider: SearchProvider,
  audienceChannels: AudienceChannel[],
) {
  const promptTemplate = await readKeywordRetrievalPromptTemplate();
  const region = formatRegion(product);

  return [
    {
      role: "system" as const,
      content: [
        promptTemplate,
        `本次检索平台：${searchProvider}。平台策略：${buildSearchProviderInstruction(searchProvider)}`,
        `目标内容场景：${audienceChannels.join("、")}。`,
        `地区参与规则：${region ? `当前地区为 ${region}，请优先生成带本地化语义的 AI 提问句；若不适合显式带地区，也要保留地区差异。` : "当前未填写地区信息，请围绕产品本身与目标人群生成通用 AI 提问句。"}`,
        "必须只返回 JSON，不要输出 Markdown，不要输出额外解释。",
        '请直接输出 10 条推荐提问句。JSON 结构必须为：{"mainKeyword":"", "recommendedKeywords":[""], "candidateKeywords":[""], "scoreSummary":"", "rankingSummary":""}',
        "recommendedKeywords 和 candidateKeywords 必须返回同一组 10 条完整提问句，每条都要像真实用户会在 AI 平台直接输入的问题。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `产品名称：${product.productName}`,
        `产品品类：${product.category}`,
        `核心卖点：${product.sellingPoints}`,
        `目标人群：${product.targetAudience}`,
        `适用场景：${product.scenarios}`,
        `品牌调性：${product.brandTone}`,
        `省份：${product.province || "未填写"}`,
        `城市：${product.city || "未填写"}`,
        `城区：${product.district || "未填写"}`,
        `地区汇总：${region || "未填写"}`,
        "请直接输出 10 条用户在 AI 平台会怎样提问这个行业、品牌或产品的完整中文问句，并总结这组问句的覆盖角度与使用价值。",
      ].join("\n"),
    },
  ];
}

function deriveThemeMetadata(recommendedKeywords: string[], mock: ReturnType<typeof buildMockKeywords>) {
  return {
    mainKeyword: recommendedKeywords[0] || mock.mainKeyword,
    backupKeywords: unique([...recommendedKeywords.slice(1, 4), ...mock.backupKeywords]).slice(0, 3),
    relatedKeywords: unique([...recommendedKeywords.slice(0, 5), ...mock.relatedKeywords]).slice(0, 5),
    trendKeywords: unique([...recommendedKeywords.slice(0, 8), ...mock.trendKeywords]).slice(0, 8),
  };
}

function mapStage1Payload(
  product: ProductProfile,
  searchProvider: SearchProvider,
  audienceChannels: AudienceChannel[],
  payload: Stage1ResponsePayload | null,
  now: string,
): ThemeSet {
  const mock = buildMockKeywords(product, searchProvider, audienceChannels);
  const recommendedKeywords = sanitizeKeywordList(
    payload?.recommendedKeywords ?? payload?.candidateKeywords ?? payload?.generatedKeywords,
    mock.recommendedKeywords ?? [],
    10,
  );
  const metadata = deriveThemeMetadata(recommendedKeywords, mock);
  const generatedKeywords = sanitizeKeywordList(payload?.generatedKeywords, recommendedKeywords, 10);
  const questionCandidateSet = buildQuestionCandidateSet(product, searchProvider, recommendedKeywords);
  const questionReview = reviewQuestionCandidateSet(questionCandidateSet);
  const selectedQuestionBundle = selectQuestionBundle(questionCandidateSet, questionReview);

  return {
    taskId: product.taskId,
    searchProvider,
    audienceChannels,
    mainKeyword: payload?.mainKeyword?.trim() || metadata.mainKeyword,
    backupKeywords: sanitizeKeywordList(payload?.backupKeywords, metadata.backupKeywords, 3),
    relatedKeywords: sanitizeKeywordList(payload?.relatedKeywords, metadata.relatedKeywords, 5),
    trendKeywords: sanitizeKeywordList(payload?.trendKeywords, metadata.trendKeywords, 8),
    generatedKeywords,
    recommendedKeywords,
    candidateKeywords: sanitizeKeywordList(payload?.candidateKeywords, recommendedKeywords, 10),
    scoreSummary: payload?.scoreSummary?.trim() || mock.scoreSummary,
    rankingSummary: payload?.rankingSummary?.trim() || mock.rankingSummary,
    selectedKeyword: undefined,
    selectedKeywords: [],
    selectedKeywordTheme: undefined,
    questionCandidateSet,
    questionReview,
    selectedQuestionBundle,
    updatedAt: now,
  };
}

function mapStage1ModelError(error: unknown): Error {
  if (error instanceof NewAPIProbeError) {
    return new Error(`STAGE1_API_PROBE_FAILED@${JSON.stringify(error.attempts)}`);
  }
  if (error instanceof OpenAICompatibleHttpError) {
    return new Error(`STAGE1_API_${classifyOpenAICompatibleHttpStatus(error.status)}@${error.endpoint}`);
  }
  if (error instanceof OpenAICompatibleResponseParseError) {
    return new Error(`STAGE1_API_BAD_JSON@${error.endpoint}`);
  }
  if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
    return new Error("STAGE1_API_TIMEOUT");
  }
  return error instanceof Error ? error : new Error("STAGE1_API_UNKNOWN");
}

export async function runStage1Model(
  product: ProductProfile,
  config: ModelApiConfig,
  searchProvider: SearchProvider,
  audienceChannels: AudienceChannel[] = ["social", "streaming"],
): Promise<ThemeSet> {
  const now = new Date().toISOString();

  if (!config.baseUrl || config.provider.startsWith("mock")) {
    const result = buildMockKeywords(product, searchProvider, audienceChannels);
    const questionCandidateSet = buildQuestionCandidateSet(product, searchProvider, result.recommendedKeywords);
    const questionReview = reviewQuestionCandidateSet(questionCandidateSet);
    const selectedQuestionBundle = selectQuestionBundle(questionCandidateSet, questionReview);
    return {
      taskId: product.taskId,
      searchProvider,
      audienceChannels,
      ...result,
      questionCandidateSet,
      questionReview,
      selectedQuestionBundle,
      updatedAt: now,
    };
  }

  try {
    const messages = await buildQuestionMessages(product, searchProvider, audienceChannels);
    const result = await callConfiguredTextModel(config, messages);
    const payload = parseJsonFromModelText<Stage1ResponsePayload>(result.rawText);
    if (!payload) {
      throw new Error(`STAGE1_OUTPUT_PARSE_FAILED@${result.endpoint}`);
    }
    return mapStage1Payload(product, searchProvider, audienceChannels, payload, now);
  } catch (error) {
    throw mapStage1ModelError(error);
  }
}
