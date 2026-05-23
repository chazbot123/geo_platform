import type { ContentDraft, ImageAsset, ReviewResult } from "@/lib/types";

const riskyWords = ["最强", "绝对", "根治", "保赚"];

export function reviewDraft(content?: ContentDraft, image?: ImageAsset): ReviewResult {
  const contentWarnings = riskyWords.filter((word) => content?.content.includes(word) || content?.title.includes(word)).map((word) => `检测到高风险词：${word}`);
  const imageWarnings = image?.url ? [] : ["缺少图片资源"];

  return {
    contentWarnings,
    imageWarnings,
    passed: contentWarnings.length === 0 && imageWarnings.length === 0,
  };
}
