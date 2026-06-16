import { assessSimilarity, type SimilarityComparable } from "@/lib/content/dispersion-service";
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
      message: `内容策略资源校验失败：${error.issues.join("；")}`,
      evidence: error.assetPath,
    };
  }
  return {
    code,
    message: error instanceof Error ? error.message : "内容策略资源校验失败。",
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
  similarityHistory?: SimilarityComparable[],
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
          message: `发现阻断风险词：${word}`,
          evidence: word,
        });
      }
    }

    for (const word of riskConfig.warningWords) {
      if (fullText.includes(word)) {
        warnings.push({
          code: "RISK_WORD_WARNING",
          message: `发现需注意的风险词：${word}`,
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
        message: `标题超过 ${strategy.title.maxLength} 个字符，当前为 ${draft.title.length} 个字符。`,
      });
      platformFit -= 30;
    }

    for (const word of strategy.review.riskWords) {
      if (fullText.includes(word)) {
        blockingIssues.push({
          code: "PLATFORM_RISK_WORD",
          message: `平台策略发现风险词：${word}`,
          evidence: word,
        });
      }
    }

    for (const required of strategy.review.mustHave) {
      if (!fullText.includes(required)) {
        warnings.push({
          code: "PLATFORM_MUST_HAVE_MISSING",
          message: `平台策略建议补充内容信号：${required}`,
          evidence: required,
        });
        platformFit -= 10;
      }
    }

    for (const forbidden of strategy.review.mustNotHave) {
      if (fullText.includes(forbidden)) {
        blockingIssues.push({
          code: "PLATFORM_MUST_NOT_HAVE",
          message: `平台策略禁止包含该内容信号：${forbidden}`,
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
        message: `所选问题覆盖率为 ${questionCoverage}%（${covered.length}/${selectedQuestions.length}），低于要求。`,
      });
    } else if (questionCoverage < 80) {
      warnings.push({
        code: "QUESTION_COVERAGE_WARNING",
        message: `所选问题覆盖率为 ${questionCoverage}%（${covered.length}/${selectedQuestions.length}），建议补充覆盖。`,
      });
    }
  }

  const leakPatterns = ["sha256:", "PGP SIGNATURE", "<?php", "GEO_CONTENT_ID:", "GEO_PROMPT_VERSION:"];
  for (const pattern of leakPatterns) {
    if (fullText.includes(pattern)) {
      blockingIssues.push({
        code: "INTERNAL_MARKER_LEAK",
        message: `草稿包含不可发布的内部标记：${pattern}`,
      });
    }
  }

  const fullHashMatch = fullText.match(/[a-fA-F0-9]{64}/);
  if (fullHashMatch) {
    blockingIssues.push({
      code: "INTERNAL_FULL_HASH_LEAK",
      message: "草稿包含完整哈希值，请移除后再发布。",
      evidence: fullHashMatch[0],
    });
  }

  if (similarityHistory && similarityHistory.length > 0) {
    const similarity = await assessSimilarity(draft, similarityHistory);
    if (similarity.level === "high") {
      for (const issue of similarity.blockingIssues) {
        blockingIssues.push({
          code: "SIMILARITY_BLOCKING",
          message: issue,
          evidence: String(similarity.maxScore),
        });
      }
    } else if (similarity.level === "medium") {
      for (const warning of similarity.warnings) {
        warnings.push({
          code: "SIMILARITY_WARNING",
          message: warning,
          evidence: String(similarity.maxScore),
        });
      }
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
