import { loadAngleLibrary, loadSimilarityDispersionConfig } from "@/lib/content/prompt-loader";
import type { ContentDraft } from "@/lib/types";

export interface DispersionPlan {
  newAngle: { angleId: string; label: string; description: string };
  avoidPatterns: { titles: string[]; intros: string[] };
  usedAngles: string[];
}

export interface SimilarityComparable {
  title?: string;
  summary?: string;
  content?: string;
  reportIntroduction?: string;
  reportConclusion?: string;
  reportSections?: Array<{ question?: string; heading?: string; summary?: string; body?: string }>;
  faq?: string[];
  cta?: string;
}

export interface SimilarityScores {
  title: number;
  opening: number;
  bodyShingle: number;
  faq: number;
  cta: number;
  overall: number;
}

export interface SimilarityMatch {
  index: number;
  scores: SimilarityScores;
  title?: string;
}

export interface SimilarityAssessment {
  level: "low" | "medium" | "high";
  maxScore: number;
  matches: SimilarityMatch[];
  blockingIssues: string[];
  warnings: string[];
}

function normalizeText(value: string | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function firstSentence(value: string | undefined) {
  return String(value ?? "")
    .split(/[。！？!?\n]/u)
    .map((item) => item.trim())
    .find(Boolean) ?? "";
}

function openingText(draft: SimilarityComparable) {
  return draft.reportIntroduction || draft.summary || firstSentence(draft.content);
}

function bodyText(draft: SimilarityComparable) {
  const sections = (draft.reportSections ?? [])
    .flatMap((section) => [section.heading, section.summary, section.body])
    .filter(Boolean)
    .join(" ");
  return [draft.content, sections, draft.reportConclusion].filter(Boolean).join(" ");
}

function shingles(value: string, size: number) {
  const normalized = normalizeText(value);
  if (!normalized) return new Set<string>();
  if (normalized.length <= size) return new Set([normalized]);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function textSimilarity(left: string | undefined, right: string | undefined, shingleSize = 3) {
  return jaccard(shingles(left ?? "", shingleSize), shingles(right ?? "", shingleSize));
}

export function scoreDraftSimilarity(
  candidate: SimilarityComparable,
  history: SimilarityComparable,
  weights: SimilarityScores = { title: 0.22, opening: 0.22, bodyShingle: 0.28, faq: 0.14, cta: 0.14, overall: 0 },
): SimilarityScores {
  const scores = {
    title: textSimilarity(candidate.title, history.title, 2),
    opening: textSimilarity(openingText(candidate), openingText(history), 3),
    bodyShingle: textSimilarity(bodyText(candidate), bodyText(history), 4),
    faq: textSimilarity((candidate.faq ?? []).join(" "), (history.faq ?? []).join(" "), 3),
    cta: textSimilarity(candidate.cta, history.cta, 3),
    overall: 0,
  };
  scores.overall =
    scores.title * weights.title +
    scores.opening * weights.opening +
    scores.bodyShingle * weights.bodyShingle +
    scores.faq * weights.faq +
    scores.cta * weights.cta;
  return {
    title: roundScore(scores.title),
    opening: roundScore(scores.opening),
    bodyShingle: roundScore(scores.bodyShingle),
    faq: roundScore(scores.faq),
    cta: roundScore(scores.cta),
    overall: roundScore(scores.overall),
  };
}

function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}

export async function assessSimilarity(
  candidate: SimilarityComparable,
  historyDrafts: SimilarityComparable[],
): Promise<SimilarityAssessment> {
  const config = await loadSimilarityDispersionConfig();
  const matches = historyDrafts
    .map((history, index) => ({
      index,
      title: history.title,
      scores: scoreDraftSimilarity(candidate, history, { ...config.weights, overall: 0 }),
    }))
    .filter((match) => match.scores.overall >= config.thresholds.warn)
    .sort((left, right) => right.scores.overall - left.scores.overall);

  const maxScore = matches[0]?.scores.overall ?? 0;
  if (maxScore >= config.thresholds.block) {
    return {
      level: "high",
      maxScore,
      matches,
      blockingIssues: [`同批内容相似度 ${Math.round(maxScore * 100)}%，超过阻断阈值 ${Math.round(config.thresholds.block * 100)}%。`],
      warnings: [],
    };
  }
  if (maxScore >= config.thresholds.warn) {
    return {
      level: "medium",
      maxScore,
      matches,
      blockingIssues: [],
      warnings: [`同批内容相似度 ${Math.round(maxScore * 100)}%，需要确认或结构化改写。`],
    };
  }
  return {
    level: "low",
    maxScore,
    matches: [],
    blockingIssues: [],
    warnings: [],
  };
}

export async function planDispersion(
  platform: string,
  historyDrafts: ContentDraft[],
): Promise<DispersionPlan> {
  const library = await loadAngleLibrary();
  const usedAngles = historyDrafts
    .map((draft) => draft.contentAngle)
    .filter((angle): angle is string => Boolean(angle));

  const platformAngles = library.angles.filter(
    (angle) => angle.applicablePlatforms.includes(platform) || angle.applicablePlatforms.length === 0,
  );

  const available = platformAngles.filter((angle) => !usedAngles.includes(angle.angleId));
  const chosen = available[0] ?? platformAngles[0] ?? library.angles[0];

  const avoidTitles = historyDrafts
    .map((draft) => draft.title?.slice(0, 12))
    .filter((title): title is string => Boolean(title));

  const avoidIntros = historyDrafts
    .map((draft) => (draft.reportIntroduction ?? draft.summary ?? "").slice(0, 30))
    .filter(Boolean);

  return {
    newAngle: chosen
      ? { angleId: chosen.angleId, label: chosen.label, description: chosen.description }
      : { angleId: "selection_criteria", label: "选择标准", description: "围绕如何判断、如何选择展开" },
    avoidPatterns: { titles: avoidTitles, intros: avoidIntros },
    usedAngles,
  };
}
