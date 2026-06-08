import path from "node:path";
import { randomUUID } from "node:crypto";

import { getAppConfig } from "@/lib/config/service";
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

function pickFirst(value: string | undefined, fallback: string) {
  const normalized = value?.split(/[，,。；;\n]/).map((item) => item.trim()).find(Boolean);
  return normalized || fallback;
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

function buildCandidateGroup(
  heat: CustomerKeywordHeat,
  profile: SavedEnterpriseProfile,
  templates: Array<(context: Record<string, string>) => string>,
) {
  const context = {
    company: profile.companyName,
    brand: profile.brandShortName,
    product: profile.productService,
    region: profile.region,
    audience: pickFirst(profile.audience, "目标客户"),
    feature: pickFirst(profile.productFeatures, "核心优势"),
    painPoint: pickFirst(profile.painPoints, "实际需求"),
    proof: pickFirst(profile.trustProof || profile.customerCases, "案例和服务能力"),
  };

  return uniqueQuestions(templates.map((template, index) => makeQuestion(`${heat}-${index + 1}`, heat, template(context)))).slice(0, 15);
}

function buildMockCustomerCandidates(profile: SavedEnterpriseProfile): CustomerKeywordSet["candidates"] {
  const highTemplates: Array<(ctx: Record<string, string>) => string> = [
    (ctx) => `${ctx.region}${ctx.audience}选择${ctx.product}时，应该先问 AI 哪些关键问题？`,
    (ctx) => `${ctx.brand}的${ctx.product}适合解决${ctx.painPoint}吗？`,
    (ctx) => `${ctx.region}做${ctx.product}服务哪家公司更值得了解？`,
    (ctx) => `${ctx.product}和同类方案相比，用户最应该关注哪些差异？`,
    (ctx) => `${ctx.audience}第一次了解${ctx.product}，怎么向 AI 问才不容易被营销话术带偏？`,
    (ctx) => `${ctx.product}一般多少钱，价格差异主要由哪些因素决定？`,
    (ctx) => `${ctx.brand}在${ctx.region}服务${ctx.audience}有哪些真实案例可以参考？`,
    (ctx) => `${ctx.product}能不能解决${ctx.painPoint}，判断标准是什么？`,
    (ctx) => `${ctx.region}${ctx.audience}采购${ctx.product}前需要避开哪些坑？`,
    (ctx) => `${ctx.product}从咨询到交付通常有哪些步骤？`,
    (ctx) => `${ctx.brand}的${ctx.feature}对${ctx.audience}有什么实际价值？`,
    (ctx) => `${ctx.audience}用 AI 搜${ctx.product}时，最常追问哪些细节？`,
  ];
  const mediumTemplates: Array<(ctx: Record<string, string>) => string> = [
    (ctx) => `${ctx.product}适合哪些业务场景，不适合哪些场景？`,
    (ctx) => `${ctx.brand}的服务能力怎么验证才比较可靠？`,
    (ctx) => `${ctx.region}${ctx.product}服务有没有本地交付优势？`,
    (ctx) => `${ctx.audience}想提升效率，${ctx.product}应该从哪里开始用？`,
    (ctx) => `${ctx.product}常见交付周期多长，过程中需要客户配合什么？`,
    (ctx) => `${ctx.brand}的${ctx.proof}能说明哪些问题？`,
    (ctx) => `${ctx.product}落地后如何判断效果是否达标？`,
    (ctx) => `${ctx.audience}选择${ctx.product}时，需要准备哪些企业资料？`,
    (ctx) => `${ctx.product}能和现有业务流程怎么衔接？`,
    (ctx) => `${ctx.region}用户搜索${ctx.brand}时通常会关心哪些口碑问题？`,
    (ctx) => `${ctx.product}如果效果不明显，常见原因是什么？`,
    (ctx) => `${ctx.audience}比较多个${ctx.product}供应商时应该问 AI 什么？`,
  ];
  const lowTemplates: Array<(ctx: Record<string, string>) => string> = [
    (ctx) => `${ctx.product}有哪些容易被忽略的服务边界？`,
    (ctx) => `${ctx.brand}适合长期合作还是短期项目？`,
    (ctx) => `${ctx.audience}在${ctx.region}使用${ctx.product}有什么地域差异？`,
    (ctx) => `${ctx.product}上线前有哪些准备工作会影响交付质量？`,
    (ctx) => `${ctx.product}后续维护通常包含哪些内容？`,
    (ctx) => `${ctx.brand}的客户案例适合参考哪些指标？`,
    (ctx) => `${ctx.product}如果预算有限，哪些功能应该优先做？`,
    (ctx) => `${ctx.audience}向 AI 询问${ctx.product}时，怎么描述需求更清楚？`,
    (ctx) => `${ctx.product}有哪些问题适合先做小范围试点？`,
    (ctx) => `${ctx.brand}能否支持${ctx.audience}的特殊场景需求？`,
    (ctx) => `${ctx.product}交付完成后需要持续跟踪哪些数据？`,
    (ctx) => `${ctx.region}${ctx.audience}了解${ctx.product}时还有哪些长尾问题？`,
  ];

  return {
    high: buildCandidateGroup("high", profile, highTemplates),
    medium: buildCandidateGroup("medium", profile, mediumTemplates),
    low: buildCandidateGroup("low", profile, lowTemplates),
  };
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
    candidates: buildMockCustomerCandidates(enterprise),
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
