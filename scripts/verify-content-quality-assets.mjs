import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const skillDir = path.join(root, "skills", "geo-platform-writing");
const expectedPlatforms = ["toutiao", "baijiahao", "douyin", "xiaohongshu", "wechat", "videohao", "zhihu", "weibo", "csdn"];
const expectedReferences = [...expectedPlatforms, "risk-language", "similarity-dispersion"].map((name) => `${name}.md`);

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf-8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStringArray(value, label) {
  assert(Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim()), `${label} must be a non-empty string array`);
}

function validatePlatformStrategies() {
  const asset = readJson("skills/geo-platform-writing/platform-strategies.json");
  assert(typeof asset.version === "string" && asset.version, "platform strategies version is required");
  assert(Array.isArray(asset.strategies), "strategies must be an array");
  const byPlatform = new Map(asset.strategies.map((strategy) => [strategy.platform, strategy]));
  for (const platform of expectedPlatforms) {
    const strategy = byPlatform.get(platform);
    assert(strategy, `missing platform strategy: ${platform}`);
    assert(typeof strategy.platformLabel === "string" && strategy.platformLabel, `${platform}.platformLabel is required`);
    assert(Number.isInteger(strategy.title?.maxLength) && strategy.title.maxLength > 0, `${platform}.title.maxLength is required`);
    assertStringArray(strategy.title.patterns, `${platform}.title.patterns`);
    assertStringArray(strategy.title.bannedPatterns, `${platform}.title.bannedPatterns`);
    assert(typeof strategy.body?.preferredStructure === "string" && strategy.body.preferredStructure, `${platform}.body.preferredStructure is required`);
    assert(Number.isInteger(strategy.body?.sectionCount?.min), `${platform}.body.sectionCount.min is required`);
    assert(Number.isInteger(strategy.body?.sectionCount?.max), `${platform}.body.sectionCount.max is required`);
    assert(strategy.body.sectionCount.min <= strategy.body.sectionCount.max, `${platform}.body.sectionCount range is invalid`);
    assert(typeof strategy.metadata?.allowPublicTraceId === "boolean", `${platform}.metadata.allowPublicTraceId is required`);
    assertStringArray(strategy.review.riskWords, `${platform}.review.riskWords`);
    assertStringArray(strategy.review.mustNotHave, `${platform}.review.mustNotHave`);
  }
}

function validateRiskLanguage() {
  const asset = readJson("skills/geo-platform-writing/risk-language.json");
  assert(typeof asset.version === "string" && asset.version, "risk language version is required");
  assertStringArray(asset.blockingWords, "blockingWords");
  assertStringArray(asset.warningWords, "warningWords");
  assert(Array.isArray(asset.contextualRules), "contextualRules must be an array");
  for (const [index, rule] of asset.contextualRules.entries()) {
    assert(typeof rule.pattern === "string" && rule.pattern, `contextualRules[${index}].pattern is required`);
    new RegExp(rule.pattern);
    assert(rule.risk === "warning" || rule.risk === "blocking", `contextualRules[${index}].risk is invalid`);
    assert(typeof rule.reason === "string" && rule.reason, `contextualRules[${index}].reason is required`);
  }
}

function validateSimilarityConfig() {
  const asset = readJson("skills/geo-platform-writing/similarity-dispersion.json");
  for (const key of ["title", "opening", "bodyShingle", "faq", "cta"]) {
    assert(typeof asset.weights?.[key] === "number" && asset.weights[key] >= 0 && asset.weights[key] <= 1, `weights.${key} is invalid`);
  }
  assert(asset.thresholds.warn <= asset.thresholds.block, "warn threshold must be <= block threshold");
  assertStringArray(asset.requiredDifferences, "requiredDifferences");
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

function shingles(value, size) {
  const normalized = normalizeText(value);
  if (!normalized) return new Set();
  if (normalized.length <= size) return new Set([normalized]);
  const result = new Set();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function similarity(left, right) {
  return jaccard(shingles(left, 4), shingles(right, 4));
}

function validateDeterministicSimilarity() {
  const duplicateScore = similarity("判断标准、适用场景、风险提醒和行动建议", "判断标准、适用场景、风险提醒和行动建议");
  const differentScore = similarity("判断标准、适用场景、风险提醒和行动建议", "技术步骤、参数配置、验证方式和限制条件");
  assert(duplicateScore === 1, "identical content similarity must be 1");
  assert(differentScore < 0.62, "different content similarity should stay below warning threshold");
}

function validateReferenceCoverage() {
  const files = new Set(readdirSync(path.join(skillDir, "references")));
  for (const file of expectedReferences) {
    assert(files.has(file), `missing reference file: ${file}`);
  }
}

validateReferenceCoverage();
validatePlatformStrategies();
validateRiskLanguage();
validateSimilarityConfig();
validateDeterministicSimilarity();

console.log("content quality assets verified");
