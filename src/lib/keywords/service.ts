import path from "node:path";
import { randomUUID } from "node:crypto";

import { getAppConfig } from "@/lib/config/service";
import {
  callConfiguredTextModel,
  classifyOpenAICompatibleHttpStatus,
  NewAPIProbeError,
  OpenAICompatibleHttpError,
  type OpenAICompatibleMessage,
  OpenAICompatibleResponseParseError,
  parseJsonFromModelText,
} from "@/lib/integrations/openai-compatible";
import { runStage1Model } from "@/lib/integrations/stage1/client";
import { dataRoot } from "@/lib/paths";
import { ensureDir, readJsonFile, writeJsonFile } from "@/lib/storage/json-store";
import { getTaskBundle, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";
import { saveTheme } from "@/lib/storage/data-store";
import type { QuestionCandidate, SelectedQuestionBundle, ThemeSet } from "@/lib/types";

export type CustomerKeywordHeat = "high" | "medium" | "low";

export interface SavedEnterpriseProfile {
  id?: string;
  companyName: string;
  brandShortName: string;
  productService: string;
  region: string;
  brandStory?: string;
  productFeatures?: string;
  audience?: string;
  trustProof?: string;
  painPoints?: string;
  customerCases?: string;
  lastSavedAt?: string;
  updatedAt?: string;
}

export interface CustomerKeywordCandidate {
  id: string;
  heat: CustomerKeywordHeat;
  question: string;
}

export interface CustomerKeywordSet {
  id: string;
  enterpriseId: string;
  enterpriseName: string;
  brandShortName: string;
  productService: string;
  region: string;
  candidates: Record<CustomerKeywordHeat, CustomerKeywordCandidate[]>;
  selectedQuestions: CustomerKeywordCandidate[];
  generatedAt?: string;
  savedAt?: string;
  updatedAt: string;
}

const CUSTOMER_KEYWORD_DIR = path.join(dataRoot, "customer-keywords");
const CUSTOMER_KEYWORD_PATH = path.join(CUSTOMER_KEYWORD_DIR, "current.json");

const ENTERPRISE_PROFILE_PATHS = [
  path.join(dataRoot, "enterprise", "profile.json"),
  path.join(dataRoot, "enterprise-profile", "current.json"),
  path.join(dataRoot, "enterprise-profiles", "current.json"),
  path.join(dataRoot, "config", "enterprise-profile.json"),
];

const REQUIRED_ENTERPRISE_FIELDS: Array<keyof SavedEnterpriseProfile> = [
  "companyName",
  "brandShortName",
  "productService",
  "region",
];

interface CustomerKeywordModelPayload {
  high?: unknown;
  medium?: unknown;
  low?: unknown;
}

function compactText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEnterpriseProfile(raw: unknown): SavedEnterpriseProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const nested =
    (source.profile && typeof source.profile === "object" ? (source.profile as Record<string, unknown>) : null) ??
    (source.enterprise && typeof source.enterprise === "object" ? (source.enterprise as Record<string, unknown>) : null) ??
    source;

  const profile: SavedEnterpriseProfile = {
    id: compactText(nested.id) || "single-enterprise",
    companyName: compactText(nested.companyName ?? nested.name),
    brandShortName: compactText(nested.brandShortName ?? nested.brandName),
    productService: compactText(nested.productService ?? nested.productName ?? nested.service),
    region: compactText(nested.region ?? nested.city ?? nested.area),
    brandStory: compactText(nested.brandStory),
    productFeatures: compactText(nested.productFeatures ?? nested.sellingPoints),
    audience: compactText(nested.audience ?? nested.targetAudience),
    trustProof: compactText(nested.trustProof),
    painPoints: compactText(nested.painPoints ?? nested.userPainPoints),
    customerCases: compactText(nested.customerCases),
    lastSavedAt: compactText(nested.lastSavedAt ?? nested.savedAt),
    updatedAt: compactText(nested.updatedAt),
  };

  return REQUIRED_ENTERPRISE_FIELDS.every((field) => compactText(profile[field])) ? profile : null;
}

export async function getSavedEnterpriseProfile() {
  for (const filePath of ENTERPRISE_PROFILE_PATHS) {
    const profile = normalizeEnterpriseProfile(await readJsonFile<unknown>(filePath, null));
    if (profile) return profile;
  }
  return null;
}

export async function getCustomerKeywordSet() {
  return readJsonFile<CustomerKeywordSet | null>(CUSTOMER_KEYWORD_PATH, null);
}

function makeQuestion(id: string, heat: CustomerKeywordHeat, question: string): CustomerKeywordCandidate {
  return { id, heat, question };
}

function uniqueQuestions(items: CustomerKeywordCandidate[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.question.replace(/\s+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCustomerQuestion(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .replace(/^[\d\-*.、()\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[。.!！]+$/g, "");
  if (!normalized) return "";
  return /[？?]$/.test(normalized) ? normalized : `${normalized}？`;
}

function buildCustomerKeywordMessages(profile: SavedEnterpriseProfile): OpenAICompatibleMessage[] {
  const contextLines = [
    `产品/服务：${profile.productService}`,
    `地区：${profile.region}`,
  ];

  return [
    {
      role: "system",
      content: [
        "你是客户提问句生成助手。",
        "你要为企业生成真实客户会直接向 AI 提问的问题。",
        "生成时只参考两个输入：产品/服务、地区。",
        "其中产品/服务是绝对主轴，所有问题都必须围绕产品/服务展开。",
        "地区是次要参考，但权重稍高于普通弱提示，可以适度影响部分问题的表达方向。",
        "不能每条都强行带地区，但可以比之前稍多一些自然地带入本地、当地、区域差异、区域服务这类表达。",
        "地区权重仍然低于产品/服务，不能喧宾夺主，更不能把问题生成成纯地域词。",
        "high、medium、low 只按用户提问频次高低区分，不按决策阶段、购买意图、问题复杂度区分。",
        "high 表示用户问得最多、出现频次最高的问题。",
        "medium 表示用户问得适中、出现频次中等的问题。",
        "low 表示用户问得最少、出现频次最低的问题。",
        "不要把 high、medium、low 理解成强决策、流程方案、边界问题等分类。",
        "所有内容都必须是中文、完整问题句、自然口语化、适合用户直接复制给 AI。",
        "禁止输出模板味、营销话术、品牌自夸、标题、短语、陈述句、占位符。",
        "high、medium、low 每组输出 6 到 8 条，组内和组间都不能重复。",
        '只返回 JSON，不要输出解释。格式：{"high":["问题1"],"medium":["问题2"],"low":["问题3"]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: ["请基于以下企业资料生成客户关键词候选：", ...contextLines].join("\n"),
    },
  ];
}

function mapCustomerKeywordGroup(
  heat: CustomerKeywordHeat,
  rawItems: unknown,
  seenQuestions: Set<string>,
) {
  if (!Array.isArray(rawItems)) {
    throw new Error(`CUSTOMER_KEYWORD_INVALID_GROUP@${heat}`);
  }
  const normalizedItems = rawItems
    .map((item) => normalizeCustomerQuestion(item))
    .filter(Boolean)
    .filter((question) => {
      const key = question.replace(/\s+/g, "");
      if (seenQuestions.has(key)) return false;
      seenQuestions.add(key);
      return true;
    });

  if (normalizedItems.length < 6 || normalizedItems.length > 8) {
    throw new Error(`CUSTOMER_KEYWORD_INVALID_COUNT@${heat}`);
  }

  return uniqueQuestions(normalizedItems.map((question, index) => makeQuestion(`${heat}-${index + 1}`, heat, question)));
}

function mapCustomerKeywordPayload(payload: CustomerKeywordModelPayload): CustomerKeywordSet["candidates"] {
  const seenQuestions = new Set<string>();
  return {
    high: mapCustomerKeywordGroup("high", payload.high, seenQuestions),
    medium: mapCustomerKeywordGroup("medium", payload.medium, seenQuestions),
    low: mapCustomerKeywordGroup("low", payload.low, seenQuestions),
  };
}

function mapCustomerKeywordModelError(error: unknown): Error {
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
  return error instanceof Error ? error : new Error("CUSTOMER_KEYWORD_AI_UNKNOWN");
}

async function generateCustomerKeywordCandidates(profile: SavedEnterpriseProfile) {
  const config = (await getAppConfig()).stage1ModelApiConfig;
  if (!config.baseUrl || config.provider.startsWith("mock")) {
    throw new Error("请先在设置页配置可用的文字模型，再生成客户关键词。");
  }

  try {
    const result = await callConfiguredTextModel(config, buildCustomerKeywordMessages(profile));
    const payload = parseJsonFromModelText<CustomerKeywordModelPayload>(result.rawText);
    if (!payload) {
      throw new Error(`STAGE1_OUTPUT_PARSE_FAILED@${result.endpoint}`);
    }
    return mapCustomerKeywordPayload(payload);
  } catch (error) {
    throw mapCustomerKeywordModelError(error);
  }
}

export async function generateCustomerKeywords() {
  const enterprise = await getSavedEnterpriseProfile();
  if (!enterprise) {
    throw new Error("请先保存完整的企业信息，再生成客户关键词。");
  }

  const now = new Date().toISOString();
  const previous = await getCustomerKeywordSet();
  const keywordSet: CustomerKeywordSet = {
    id: previous?.id ?? randomUUID(),
    enterpriseId: enterprise.id ?? "single-enterprise",
    enterpriseName: enterprise.companyName,
    brandShortName: enterprise.brandShortName,
    productService: enterprise.productService,
    region: enterprise.region,
    candidates: await generateCustomerKeywordCandidates(enterprise),
    selectedQuestions: [],
    generatedAt: now,
    savedAt: undefined,
    updatedAt: now,
  };

  await ensureDir(CUSTOMER_KEYWORD_DIR);
  await writeJsonFile(CUSTOMER_KEYWORD_PATH, keywordSet);
  return keywordSet;
}

function flattenCandidates(keywordSet: CustomerKeywordSet) {
  return Object.values(keywordSet.candidates).flat();
}

export async function saveCustomerKeywordSelection(selectedIds: string[]) {
  const keywordSet = await getCustomerKeywordSet();
  if (!keywordSet) {
    throw new Error("请先生成客户关键词候选。");
  }

  const ids = Array.from(new Set(selectedIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length !== 5) {
    throw new Error("必须选择并保存 5 个核心问题。");
  }

  const candidates = flattenCandidates(keywordSet);
  const selectedQuestions = ids.map((id) => {
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) throw new Error("所选问题不在当前候选列表中。");
    return candidate;
  });
  const now = new Date().toISOString();
  const nextSet: CustomerKeywordSet = {
    ...keywordSet,
    selectedQuestions,
    savedAt: now,
    updatedAt: now,
  };

  await ensureDir(CUSTOMER_KEYWORD_DIR);
  await writeJsonFile(CUSTOMER_KEYWORD_PATH, nextSet);
  return nextSet;
}

export async function getCustomerKeywordWorkbenchData() {
  const [enterprise, keywordSet] = await Promise.all([getSavedEnterpriseProfile(), getCustomerKeywordSet()]);
  return {
    enterprise,
    keywordSet,
    canGenerate: Boolean(enterprise),
    canCreateTask: (keywordSet?.selectedQuestions.length ?? 0) === 5 && Boolean(keywordSet?.savedAt),
  };
}

export async function generateKeywordsForTask(taskId: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle) {
    throw new Error("任务不存在。");
  }

  if (!bundle.task.searchProvider) {
    throw new Error("任务缺少检索平台信息。");
  }

  try {
    const config = await getAppConfig();
    const theme = await runStage1Model(bundle.product, config.stage1ModelApiConfig, bundle.task.searchProvider, ["social", "streaming"]);
    await saveTheme(theme);
    await updateTaskStatus(taskId, "keyword_generated");
    return theme;
  } catch (error) {
    await markTaskFailed(taskId, "keywords", error instanceof Error ? error.message : "生成关键词失败");
    throw error;
  }
}

function getRecommendedKeywords(theme: ThemeSet) {
  if (theme.recommendedKeywords?.length) return theme.recommendedKeywords;
  if (theme.candidateKeywords?.length) return theme.candidateKeywords;
  return [...theme.backupKeywords, ...theme.relatedKeywords, theme.mainKeyword].filter(Boolean).slice(0, 10);
}

function getValidQuestionCandidates(theme: ThemeSet) {
  const validIds = new Set(theme.questionReview?.validQuestionIds ?? []);
  const candidates = theme.questionCandidateSet?.questionCandidates ?? [];
  return validIds.size ? candidates.filter((candidate) => validIds.has(candidate.id)) : candidates;
}

function normalizeQuestionKey(value: string) {
  return value.trim().replace(/[?？!！。\s]+$/g, "").replace(/\s+/g, " ").toLowerCase();
}

function normalizeSelectedQuestions(theme: ThemeSet, selectedKeywords: string[]) {
  const fallbackQuestions = getRecommendedKeywords(theme);
  const validCandidates = getValidQuestionCandidates(theme);
  const candidateById = new Map(validCandidates.map((candidate) => [candidate.id, candidate]));
  const candidateByQuestion = new Map(validCandidates.map((candidate) => [candidate.question, candidate]));
  const candidateByQuestionKey = new Map(validCandidates.map((candidate) => [normalizeQuestionKey(candidate.question), candidate]));
  const fallbackQuestionKeys = new Set(fallbackQuestions.map(normalizeQuestionKey));
  const selections = selectedKeywords.map((keyword) => keyword.trim()).filter(Boolean);
  const deduped = Array.from(new Set(selections));

  return deduped.map((keyword) => {
    const questionKey = normalizeQuestionKey(keyword);
    const candidate = candidateById.get(keyword) ?? candidateByQuestion.get(keyword) ?? candidateByQuestionKey.get(questionKey);
    const question = candidate?.question ?? keyword;
    if (!candidate && !fallbackQuestions.includes(question) && !fallbackQuestionKeys.has(questionKey)) {
      throw new Error("所选提问句不在当前推荐列表中。");
    }
    return { question, candidate };
  });
}

function sectionRoleForIntent(intent: QuestionCandidate["intent"]) {
  if (intent === "pitfall_avoidance" || intent === "risk_boundary") return "risk" as const;
  if (intent === "process_solution") return "process" as const;
  if (intent === "comparison" || intent === "price_logic") return "comparison" as const;
  if (intent === "scenario_fit" || intent === "local_service") return "scenario" as const;
  if (intent === "evidence_check") return "evidence" as const;
  return "criteria" as const;
}

function buildSelectedQuestionBundle(theme: ThemeSet, selectedCandidates: QuestionCandidate[]): SelectedQuestionBundle | undefined {
  if (!selectedCandidates.length) return theme.selectedQuestionBundle;

  const mainQuestion =
    selectedCandidates.find((candidate) => ["selection_criteria", "comparison", "local_service"].includes(candidate.intent)) ??
    selectedCandidates[0];
  const rest = selectedCandidates.filter((candidate) => candidate.id !== mainQuestion.id);
  const supportingQuestions = rest.slice(0, 4).map((candidate) => ({
    id: candidate.id,
    question: candidate.question,
    intent: candidate.intent,
    sectionRole: sectionRoleForIntent(candidate.intent),
  }));
  const followUpQuestions = rest.slice(4, 7).map((candidate, index) => ({
    id: candidate.id,
    question: candidate.question,
    faqRole: (["clarification", "objection", "next_step"] as const)[index] ?? "boundary",
  }));
  const primaryAiScenario =
    mainQuestion.targetAiScenarios[0] ?? theme.selectedQuestionBundle?.selectedQuestionBundle.primaryAiScenario ?? "deepseek_logic";
  const secondaryAiScenarios = Array.from(
    new Set(selectedCandidates.flatMap((candidate) => candidate.targetAiScenarios).filter((scenario) => scenario !== primaryAiScenario)),
  );

  return {
    module: "select_question_bundle",
    passed: supportingQuestions.length >= 1,
    selectedQuestionBundle: {
      bundleId: `qb-${theme.taskId}`,
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
      selectionReason: "由用户确认的提问句生成问题包，后续文章章节应围绕这些问题展开。",
      riskNotes: selectedCandidates.flatMap((candidate) => candidate.riskNotes),
    },
    rejectedQuestionIds:
      theme.questionCandidateSet?.questionCandidates
        .filter((candidate) => !selectedCandidates.some((selected) => selected.id === candidate.id))
        .map((candidate) => candidate.id) ?? [],
    blockingIssues: supportingQuestions.length >= 1 ? [] : ["SUPPORTING_QUESTION_COUNT_LT_1"],
    warnings: theme.questionReview?.warnings ?? [],
  };
}

export async function confirmKeywords(taskId: string, selectedKeywords: string[]) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("提问主题不存在。");
  }

  const normalizedSelections = normalizeSelectedQuestions(bundle.theme, selectedKeywords);
  const normalizedKeywords = normalizedSelections.map((selection) => selection.question);

  if (!normalizedKeywords.length) {
    throw new Error("请至少选择 1 个推荐提问句。");
  }

  if (normalizedKeywords.length > 5) {
    throw new Error("最多只能选择 5 个推荐提问句。");
  }

  const selectedKeywordTheme = normalizedKeywords.join("、");
  const selectedCandidates = normalizedSelections
    .map((selection) => selection.candidate)
    .filter((candidate): candidate is QuestionCandidate => Boolean(candidate));
  const nextTheme = {
    ...bundle.theme,
    selectedKeyword: selectedKeywordTheme,
    selectedKeywords: normalizedKeywords,
    selectedKeywordTheme,
    selectedQuestionBundle: buildSelectedQuestionBundle(bundle.theme, selectedCandidates),
    updatedAt: new Date().toISOString(),
  };

  await saveTheme(nextTheme);
  await updateTaskStatus(taskId, "keyword_selected", { selectedKeyword: selectedKeywordTheme });
  return nextTheme;
}
