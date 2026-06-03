import { loadPlatformStrategy, loadRiskWords, StrategyAssetValidationError } from "@/lib/content/prompt-loader";
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

function toAssetIssue(error: unknown, code: string): ReviewIssue {
  if (error instanceof StrategyAssetValidationError) {
    return {
      code,
      message: `Content strategy asset validation failed: ${error.issues.join("; ")}`,
      evidence: error.assetPath,
    };
  }
  return {
    code,
    message: error instanceof Error ? error.message : "Content strategy asset validation failed",
  };
}

function getDraftText(draft: ContentDraft) {
  return [
    draft.title,
    draft.summary,
    draft.content,
    draft.reportIntroduction,
    draft.reportConclusion,
    draft.cta,
    ...(draft.faq ?? []),
    ...(draft.reportSections ?? []).flatMap((section) => [
      section.question,
      section.heading,
      section.summary,
      section.body,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

export async function reviewContent(
  draft: ContentDraft,
  platform: string,
  selectedQuestions?: string[],
): Promise<ReviewResult> {
  const blockingIssues: ReviewIssue[] = [];
  const warnings: ReviewIssue[] = [];
  const fullText = getDraftText(draft);

  let riskConfig = null;
  try {
    riskConfig = await loadRiskWords();
  } catch (error) {
    blockingIssues.push(toAssetIssue(error, "RISK_WORD_ASSET_INVALID"));
  }

  if (riskConfig) {
    for (const word of riskConfig.blockingWords) {
      if (fullText.includes(word)) {
        blockingIssues.push({
          code: "RISK_WORD_BLOCKING",
          message: `Blocking risk word found: ${word}`,
          evidence: word,
        });
      }
    }

    for (const word of riskConfig.warningWords) {
      if (fullText.includes(word)) {
        warnings.push({
          code: "RISK_WORD_WARNING",
          message: `Warning risk word found: ${word}`,
          evidence: word,
        });
      }
    }

    for (const rule of riskConfig.contextualRules) {
      const matched = fullText.match(new RegExp(rule.pattern));
      if (!matched) {
        continue;
      }
      const issue: ReviewIssue = {
        code: rule.risk === "blocking" ? "CONTEXTUAL_RISK_BLOCKING" : "CONTEXTUAL_RISK_WARNING",
        message: rule.reason,
        evidence: matched[0],
      };
      if (rule.risk === "blocking") {
        blockingIssues.push(issue);
      } else {
        warnings.push(issue);
      }
    }
  }

  let platformFit = 100;
  let strategy = null;
  try {
    strategy = await loadPlatformStrategy(platform);
  } catch (error) {
    blockingIssues.push(toAssetIssue(error, "PLATFORM_STRATEGY_ASSET_INVALID"));
  }

  if (strategy && draft.title) {
    if (draft.title.length > strategy.title.maxLength) {
      blockingIssues.push({
        code: "TITLE_TOO_LONG",
        message: `Title exceeds ${strategy.title.maxLength} characters (current ${draft.title.length})`,
      });
      platformFit -= 30;
    }

    for (const word of strategy.review.riskWords) {
      if (fullText.includes(word)) {
        blockingIssues.push({
          code: "PLATFORM_RISK_WORD",
          message: `Platform strategy risk word found: ${word}`,
          evidence: word,
        });
      }
    }

    for (const required of strategy.review.mustHave) {
      if (!fullText.includes(required)) {
        warnings.push({
          code: "PLATFORM_MUST_HAVE_MISSING",
          message: `Platform strategy expects this content signal: ${required}`,
          evidence: required,
        });
        platformFit -= 10;
      }
    }

    for (const forbidden of strategy.review.mustNotHave) {
      if (fullText.includes(forbidden)) {
        blockingIssues.push({
          code: "PLATFORM_MUST_NOT_HAVE",
          message: `Platform strategy forbids this content signal: ${forbidden}`,
          evidence: forbidden,
        });
      }
    }
  }

  let questionCoverage = 100;
  if (selectedQuestions && selectedQuestions.length > 0) {
    const sections = draft.reportSections ?? [];
    const sectionQuestions = sections.map((section) => section.question).filter(Boolean);
    const covered = selectedQuestions.filter((question) =>
      sectionQuestions.some((sectionQuestion) => sectionQuestion.includes(question) || question.includes(sectionQuestion)) ||
      fullText.includes(question),
    );
    questionCoverage = Math.round((covered.length / selectedQuestions.length) * 100);
    if (questionCoverage < 60) {
      blockingIssues.push({
        code: "LOW_QUESTION_COVERAGE",
        message: `Selected question coverage is ${questionCoverage}% (${covered.length}/${selectedQuestions.length})`,
      });
    } else if (questionCoverage < 80) {
      warnings.push({
        code: "QUESTION_COVERAGE_WARNING",
        message: `Selected question coverage is ${questionCoverage}% (${covered.length}/${selectedQuestions.length})`,
      });
    }
  }

  const leakPatterns = ["sha256:", "PGP SIGNATURE", "<?php", "GEO_CONTENT_ID:", "GEO_PROMPT_VERSION:"];
  for (const pattern of leakPatterns) {
    if (fullText.includes(pattern)) {
      blockingIssues.push({
        code: "INTERNAL_MARKER_LEAK",
        message: `Draft contains an internal marker that must not be published: ${pattern}`,
      });
    }
  }

  const complianceFit = blockingIssues.length === 0 ? 100 : Math.max(0, 100 - blockingIssues.length * 25);

  return {
    passed: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    scores: {
      platformFit: Math.max(0, platformFit),
      complianceFit,
      questionCoverage,
    },
  };
}
