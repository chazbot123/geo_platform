import { getAppConfig } from "@/lib/config/service";
import { runStage1Model } from "@/lib/integrations/stage1/client";
import { getTaskBundle, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";
import { saveTheme } from "@/lib/storage/data-store";
import type { QuestionCandidate, SelectedQuestionBundle, ThemeSet } from "@/lib/types";

export async function generateKeywordsForTask(taskId: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle) {
    throw new Error("任务不存在");
  }

  if (!bundle.task.searchProvider) {
    throw new Error("任务缺少检索平台信息");
  }

  try {
    const config = await getAppConfig();
    const theme = await runStage1Model(
      bundle.product,
      config.stage1ModelApiConfig,
      bundle.task.searchProvider,
      ["social", "streaming"],
    );
    await saveTheme(theme);
    await updateTaskStatus(taskId, "keyword_generated");
    return theme;
  } catch (error) {
    await markTaskFailed(taskId, "keywords", error instanceof Error ? error.message : "生成关键词失败");
    throw error;
  }
}

function getRecommendedKeywords(theme: NonNullable<Exclude<Awaited<ReturnType<typeof getTaskBundle>>, null>["theme"]>) {
  if (theme.recommendedKeywords?.length) {
    return theme.recommendedKeywords;
  }
  if (theme.candidateKeywords?.length) {
    return theme.candidateKeywords;
  }
  return [...theme.backupKeywords, ...theme.relatedKeywords, theme.mainKeyword].filter(Boolean).slice(0, 10);
}

function getValidQuestionCandidates(theme: ThemeSet) {
  const validIds = new Set(theme.questionReview?.validQuestionIds ?? []);
  const candidates = theme.questionCandidateSet?.questionCandidates ?? [];
  return validIds.size ? candidates.filter((candidate) => validIds.has(candidate.id)) : candidates;
}

function normalizeSelectedQuestions(theme: ThemeSet, selectedKeywords: string[]) {
  const fallbackQuestions = getRecommendedKeywords(theme);
  const validCandidates = getValidQuestionCandidates(theme);
  const candidateById = new Map(validCandidates.map((candidate) => [candidate.id, candidate]));
  const candidateByQuestion = new Map(validCandidates.map((candidate) => [candidate.question, candidate]));
  const selections = selectedKeywords.map((keyword) => keyword.trim()).filter(Boolean);
  const deduped = Array.from(new Set(selections));

  return deduped.map((keyword) => {
    const candidate = candidateById.get(keyword) ?? candidateByQuestion.get(keyword);
    const question = candidate?.question ?? keyword;
    if (!candidate && !fallbackQuestions.includes(question)) {
      throw new Error("所选提问句不在当前推荐列表中");
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
  if (!selectedCandidates.length) {
    return theme.selectedQuestionBundle;
  }

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
    throw new Error("提问主题不存在");
  }

  const normalizedSelections = normalizeSelectedQuestions(bundle.theme, selectedKeywords);
  const normalizedKeywords = normalizedSelections.map((selection) => selection.question);

  if (!normalizedKeywords.length) {
    throw new Error("请至少选择 1 个推荐提问句");
  }

  if (normalizedKeywords.length > 5) {
    throw new Error("最多只能选择 5 个推荐提问句");
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
