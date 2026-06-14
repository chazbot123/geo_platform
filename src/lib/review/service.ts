import type { ContentDraft, ImageAsset, ReviewResult } from "@/lib/types";

const riskyWords = ["最强", "绝对", "根治", "保赚"];

function resolveExpectedImageCount(expectedImageCount?: number, image?: ImageAsset) {
  const normalizedExpected = Math.floor(Number(expectedImageCount));
  if (Number.isFinite(normalizedExpected) && normalizedExpected > 0) {
    return normalizedExpected;
  }

  const currentImageCount = image?.images?.length ?? 0;
  if (currentImageCount > 0) {
    return currentImageCount;
  }

  return 1;
}

export function reviewDraft(content?: ContentDraft, image?: ImageAsset, expectedImageCount?: number): ReviewResult {
  const contentWarnings = riskyWords
    .filter((word) => content?.content.includes(word) || content?.title.includes(word))
    .map((word) => `检测到高风险词：${word}`);

  const selectedKeywords = content?.selectedKeywords ?? [];
  const uncoveredQuestions = selectedKeywords.filter(
    (question) => !content?.reportSections?.some((section) => section.question.includes(question) || section.body.includes(question)),
  );

  if (selectedKeywords.length && uncoveredQuestions.length) {
    contentWarnings.push(`仍有提问句未在报告章节中被覆盖：${uncoveredQuestions.join("、")}`);
  }

  if (content?.reportSections?.some((section) => !section.heading.trim() || !section.body.trim())) {
    contentWarnings.push("报告章节存在空标题或空正文，请补充完整。");
  }

  if (content?.title && content?.summary && !content.summary.includes("报告") && content.title.includes("报告")) {
    contentWarnings.push("标题定位为报告，但摘要未明显体现报告性结论。");
  }

  const imageItems = image?.images ?? [];
  const imageCount = imageItems.length;
  const targetImageCount = resolveExpectedImageCount(expectedImageCount, image);
  const imageWarnings =
    imageCount >= targetImageCount
      ? []
      : image?.url
        ? [`当前仅生成 ${imageCount || 1} 张图片，目标为 ${targetImageCount} 张报告配图。`]
        : ["缺少图片资源"];

  if (imageCount > 0 && imageCount < targetImageCount) {
    imageWarnings.push(`当前图片资产不完整，仅有 ${imageCount} 张图，不能视为本次配图已完成。`);
  }

  if (content?.reportSections?.length && imageCount > 0) {
    const placements = new Set(
      imageItems.map((item) => item.placement?.paragraphIndex).filter((value): value is number => typeof value === "number"),
    );
    if (placements.size < Math.min(targetImageCount, imageCount)) {
      imageWarnings.push("图片与报告章节的插入位置不完整，部分章节仍缺少对应配图。");
    }
  }

  return {
    contentWarnings,
    imageWarnings,
    passed: contentWarnings.length === 0 && imageWarnings.length === 0,
  };
}
