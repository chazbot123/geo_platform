import { loadPlatformStrategy, loadRiskWords } from "@/lib/content/prompt-loader";
import type { ContentDraft } from "@/lib/types";

export interface ReviewIssue {
  code: string;
  message: string;
  evidence?: string;
}

export interface ReviewResult {
  passed: boolean;
  blockingIssues: ReviewIssue[];
  warnings: ReviewIssue[];
  scores: {
    platformFit: number;
    complianceFit: number;
    questionCoverage: number;
  };
}

export async function reviewContent(
  draft: ContentDraft,
  platform: string,
  selectedQuestions?: string[],
): Promise<ReviewResult> {
  const blockingIssues: ReviewIssue[] = [];
  const warnings: ReviewIssue[] = [];
  const fullText = [draft.title, draft.summary, draft.content, draft.cta].filter(Boolean).join(" ");

  // 1. 风险词扫描
  const riskConfig = await loadRiskWords();
  if (riskConfig) {
    for (const word of riskConfig.blockingWords) {
      if (fullText.includes(word)) {
        blockingIssues.push({
          code: "RISK_WORD_BLOCKING",
          message: `包含高风险词：${word}`,
          evidence: word,
        });
      }
    }
    for (const word of riskConfig.warningWords) {
      if (fullText.includes(word)) {
        warnings.push({
          code: "RISK_WORD_WARNING",
          message: `包含警告词：${word}`,
          evidence: word,
        });
      }
    }
  }

  // 2. 标题长度检查
  const strategy = await loadPlatformStrategy(platform);
  let platformFit = 100;
  if (strategy && draft.title) {
    if (draft.title.length > strategy.title.maxLength) {
      blockingIssues.push({
        code: "TITLE_TOO_LONG",
        message: `标题超过${strategy.title.maxLength}字（当前${draft.title.length}字）`,
      });
      platformFit -= 30;
    }
  }

  // 3. 必答问题覆盖率
  let questionCoverage = 100;
  if (selectedQuestions && selectedQuestions.length > 0) {
    const sections = draft.reportSections ?? [];
    const sectionQuestions = sections.map((s) => s.question).filter(Boolean);
    const covered = selectedQuestions.filter((q) =>
      sectionQuestions.some((sq) => sq.includes(q) || q.includes(sq)) ||
      fullText.includes(q),
    );
    questionCoverage = Math.round((covered.length / selectedQuestions.length) * 100);
    if (questionCoverage < 60) {
      warnings.push({
        code: "LOW_QUESTION_COVERAGE",
        message: `必答问题覆盖率仅 ${questionCoverage}%（${covered.length}/${selectedQuestions.length}）`,
      });
    }
  }

  // 4. 公开标记泄露检查
  const leakPatterns = ["sha256:", "PGP SIGNATURE", "<?php", "GEO_CONTENT_ID:", "GEO_PROMPT_VERSION:"];
  for (const pattern of leakPatterns) {
    if (fullText.includes(pattern)) {
      blockingIssues.push({
        code: "INTERNAL_MARKER_LEAK",
        message: `正文中包含不应公开的内部标记：${pattern}`,
      });
    }
  }

  const complianceFit = blockingIssues.length === 0 ? 100 : Math.max(0, 100 - blockingIssues.length * 25);

  return {
    passed: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    scores: {
      platformFit,
      complianceFit,
      questionCoverage,
    },
  };
}
