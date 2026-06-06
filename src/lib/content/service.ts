import { getAppConfig } from "@/lib/config/service";
import { getPromptVersion, normalizeAiScenario, normalizePlatform } from "@/lib/content/prompt-loader";
import { reviewContent, type ReviewResult } from "@/lib/content/review-service";
import { planDispersion } from "@/lib/content/dispersion-service";
import { buildGeoContentExecutionPackage } from "@/lib/content/execution-package";
import { runContentModel } from "@/lib/integrations/content/client";
import { listAllContentDrafts, saveContent } from "@/lib/storage/data-store";
import { getTaskBundle, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";
import type { ContentDraft, TaskBundle } from "@/lib/types";

function splitParagraphs(content: string) {
  return content
    .split(/\r?\n\s*\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractSectionBody(block: string) {
  const lines = block.split(/\r?\n\r?\n/).map((item) => item.trim()).filter(Boolean);
  return lines
    .filter((line) => !line.startsWith("对应提问句：") && !line.startsWith("章节摘要："))
    .join("\n\n");
}

function syncStructuredFieldsFromContent(draft: ContentDraft, content: string): ContentDraft {
  const paragraphs = splitParagraphs(content);
  const reportIntroduction = paragraphs.find((item) => item.startsWith("## 报告引言"))?.replace(/^##\s*报告引言\s*/u, "").trim();
  const reportConclusion = paragraphs.find((item) => item.startsWith("## 报告结论"))?.replace(/^##\s*报告结论\s*/u, "").trim();
  const nextSections = (draft.reportSections ?? []).map((section) => {
    const block = paragraphs.find((item) => item.startsWith(`## ${section.heading}`));
    if (!block) {
      return section;
    }

    const summaryMatch = block.match(/章节摘要：([\s\S]*?)(?:\n\n|$)/);
    return {
      ...section,
      summary: summaryMatch?.[1]?.trim() || section.summary,
      body: extractSectionBody(block) || section.body,
    };
  });

  return {
    ...draft,
    content,
    reportIntroduction: reportIntroduction || draft.reportIntroduction,
    reportSections: nextSections,
    reportConclusion: reportConclusion || draft.reportConclusion,
  };
}

export interface ContentGenerationOptions {
  aiScenario?: string;
  platform?: string;
  contentAngle?: string;
}

export interface ContentGenerationResult {
  content: ContentDraft;
  reviewResult: ReviewResult;
  dispersionPlan?: { newAngle: string; usedAngles: string[] };
}

function getSelectedQuestionsForReview(bundle: TaskBundle) {
  const selectedKeywords = Array.isArray(bundle.theme?.selectedKeywords) ? bundle.theme.selectedKeywords : [];
  const selectedBundle = bundle.theme?.selectedQuestionBundle?.selectedQuestionBundle;
  const selectedBundleQuestions = selectedBundle
    ? [
        selectedBundle.mainQuestion.question,
        ...selectedBundle.supportingQuestions.map((question) => question.question),
      ]
    : [];

  return [...selectedBundleQuestions, ...selectedKeywords].map((question) => question.trim()).filter(Boolean);
}

function normalizeGeneratedDraft(
  draft: ContentDraft,
  options: { platform: string; aiScenario: string; contentAngle: string },
): ContentDraft {
  const platform = normalizePlatform(options.platform);
  const aiScenario = normalizeAiScenario(options.aiScenario);
  return {
    ...draft,
    platform,
    aiScenario,
    contentAngle: options.contentAngle,
    promptVersion: draft.promptVersion ?? getPromptVersion(platform, aiScenario),
  };
}

function buildReviewFailure(error: unknown): ReviewResult {
  return {
    passed: false,
    blockingIssues: [
      {
        code: "CONTENT_REVIEW_FAILED",
        message: error instanceof Error ? error.message : "Content review failed",
      },
    ],
    warnings: [],
    scores: {
      platformFit: 0,
      complianceFit: 0,
      questionCoverage: 0,
    },
  };
}

export async function generateContentForTask(taskId: string, options?: ContentGenerationOptions): Promise<ContentGenerationResult> {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("Question theme is not ready");
  }

  try {
    const config = await getAppConfig();
    const platform = options?.platform ?? "toutiao";
    const aiScenario = options?.aiScenario ?? "doubao_plain_answer";
    let contentAngle = options?.contentAngle ?? "selection_criteria";
    let dispersionPlan: ContentGenerationResult["dispersionPlan"];

    if (!options?.contentAngle) {
      try {
        const historyDrafts = await listAllContentDrafts();
        const samePlatformDrafts = historyDrafts.filter((draft) => draft.platform === platform);
        if (samePlatformDrafts.length > 0) {
          const plan = await planDispersion(platform, samePlatformDrafts);
          contentAngle = plan.newAngle.angleId;
          dispersionPlan = { newAngle: plan.newAngle.angleId, usedAngles: plan.usedAngles };
        }
      } catch {
        // Dispersion planning should not block local draft generation.
      }
    }

    const generatedContent = normalizeGeneratedDraft(
      await runContentModel(bundle.product, bundle.theme, config.contentModelApiConfig, {
        aiScenario,
        platform,
        contentAngle,
      }),
      { aiScenario, platform, contentAngle },
    );

    let reviewResult: ReviewResult;
    try {
      reviewResult = await reviewContent(generatedContent, platform, getSelectedQuestionsForReview(bundle));
    } catch (error) {
      reviewResult = buildReviewFailure(error);
    }

    const content: ContentDraft = {
      ...generatedContent,
      geoExecutionPackage: buildGeoContentExecutionPackage({
        bundle,
        content: generatedContent,
        reviewResult,
        platform,
        aiScenario,
        contentAngle,
        dispersionPlan,
      }),
    };

    await saveContent(content);
    await updateTaskStatus(taskId, "content_generated");
    return { content, reviewResult, dispersionPlan };
  } catch (error) {
    await markTaskFailed(taskId, "content", error instanceof Error ? error.message : "Content generation failed");
    throw error;
  }
}

export async function updateContentDraft(taskId: string, patch: Pick<ContentDraft, "title" | "summary" | "cta" | "content">) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.content) {
    throw new Error("Content draft does not exist");
  }

  const patchedDraft: ContentDraft = {
    ...bundle.content,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const syncedDraft = syncStructuredFieldsFromContent(patchedDraft, patch.content);
  const platform = normalizePlatform(syncedDraft.platform);
  const aiScenario = normalizeAiScenario(syncedDraft.aiScenario);
  const contentAngle = syncedDraft.contentAngle ?? "selection_criteria";
  let reviewResult: ReviewResult;
  try {
    reviewResult = await reviewContent(syncedDraft, platform, getSelectedQuestionsForReview(bundle));
  } catch (error) {
    reviewResult = buildReviewFailure(error);
  }
  const nextDraft: ContentDraft = {
    ...syncedDraft,
    geoExecutionPackage: buildGeoContentExecutionPackage({
      bundle: { ...bundle, content: syncedDraft },
      content: syncedDraft,
      reviewResult,
      platform,
      aiScenario,
      contentAngle,
    }),
  };

  await saveContent(nextDraft);
  return nextDraft;
}
