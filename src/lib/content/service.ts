import { getAppConfig } from "@/lib/config/service";
import { runContentModel } from "@/lib/integrations/content/client";
import { saveContent } from "@/lib/storage/data-store";
import { getTaskBundle, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";
import { reviewContent, type ReviewResult } from "@/lib/content/review-service";
import { planDispersion } from "@/lib/content/dispersion-service";
import { listAllContentDrafts } from "@/lib/storage/data-store";
import type { ContentDraft } from "@/lib/types";

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
  reviewResult?: ReviewResult;
  dispersionPlan?: { newAngle: string; usedAngles: string[] };
}

export async function generateContentForTask(taskId: string, options?: ContentGenerationOptions): Promise<ContentDraft> {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("提问主题尚未准备完成");
  }

  try {
    const config = await getAppConfig();
    const platform = options?.platform ?? "toutiao";
    const aiScenario = options?.aiScenario ?? "doubao_plain_answer";
    let contentAngle = options?.contentAngle ?? "selection_criteria";

    // 离散规划：如果没有指定角度，自动选一个未用过的
    if (!options?.contentAngle) {
      try {
        const historyDrafts = await listAllContentDrafts();
        const samePlatformDrafts = historyDrafts.filter((d) => d.platform === platform);
        if (samePlatformDrafts.length > 0) {
          const plan = await planDispersion(platform, samePlatformDrafts);
          contentAngle = plan.newAngle.angleId;
        }
      } catch {
        // 离散规划失败不阻塞生成
      }
    }

    const draft = await runContentModel(bundle.product, bundle.theme, config.contentModelApiConfig, {
      aiScenario,
      platform,
      contentAngle,
    });

    // 质检
    try {
      const review = await reviewContent(draft, platform, bundle.theme.selectedKeywords);
      if (review.warnings.length > 0 || !review.passed) {
        // 质检结果存入 draft 备查（不阻塞保存）
        (draft as ContentDraft & { _reviewWarnings?: string[] })._reviewWarnings =
          [...review.blockingIssues, ...review.warnings].map((i) => i.message);
      }
    } catch {
      // 质检失败不阻塞生成
    }

    await saveContent(draft);
    await updateTaskStatus(taskId, "content_generated");
    return draft;
  } catch (error) {
    await markTaskFailed(taskId, "content", error instanceof Error ? error.message : "内容生成失败");
    throw error;
  }
}

export async function updateContentDraft(taskId: string, patch: Pick<ContentDraft, "title" | "summary" | "cta" | "content">) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.content) {
    throw new Error("内容草稿不存在");
  }

  const patchedDraft: ContentDraft = {
    ...bundle.content,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const nextDraft = syncStructuredFieldsFromContent(patchedDraft, patch.content);

  await saveContent(nextDraft);
  return nextDraft;
}
