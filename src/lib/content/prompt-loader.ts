import { promises as fs } from "node:fs";
import path from "node:path";

export interface PlatformStrategy {
  platform: string;
  platformLabel: string;
  title: {
    maxLength: number;
    patterns: string[];
    bannedPatterns: string[];
    instructions: string;
  };
  body: {
    preferredStructure: string;
    paragraphLength: string;
    maxParagraphChars: number;
    headingStyle: string;
    sectionCount: { min: number; max: number };
    ctaStyle: string;
    instructions: string;
  };
  metadata: {
    allowPublicTraceId: boolean;
    allowTimestamp: boolean;
    allowMarkdownTable: boolean;
    allowFaq: boolean;
    faqCount: { min: number; max: number };
  };
  review: {
    riskWords: string[];
    mustHave: string[];
    mustNotHave: string[];
  };
}

export interface PlatformStrategyCollection {
  version: string;
  strategies: PlatformStrategy[];
}

export interface AngleDefinition {
  angleId: string;
  label: string;
  description: string;
  applicablePlatforms: string[];
  titleDirection: string;
}

export interface AngleLibrary {
  angles: AngleDefinition[];
}

export interface RiskWordsConfig {
  version: string;
  description: string;
  blockingWords: string[];
  warningWords: string[];
  contextualRules: Array<{ pattern: string; risk: "warning" | "blocking"; reason: string }>;
  preferredPhrases?: string[];
}

export interface SimilarityDispersionConfig {
  version: string;
  dimensions: Array<"title" | "opening" | "bodyShingle" | "faq" | "cta">;
  weights: {
    title: number;
    opening: number;
    bodyShingle: number;
    faq: number;
    cta: number;
  };
  thresholds: {
    block: number;
    warn: number;
  };
  requiredDifferences: string[];
  historyScopes: string[];
}

export class StrategyAssetValidationError extends Error {
  constructor(
    public readonly assetPath: string,
    public readonly issues: string[],
  ) {
    super(`Invalid content strategy asset ${assetPath}: ${issues.join("; ")}`);
    this.name = "StrategyAssetValidationError";
  }
}

const SUPPORTED_PLATFORMS = [
  "toutiao",
  "baijiahao",
  "douyin",
  "xiaohongshu",
  "wechat",
  "videohao",
  "zhihu",
  "weibo",
  "csdn",
  "blog",
] as const;

const SUPPORTED_AI_SCENARIOS = [
  "doubao_plain_answer",
  "deepseek_logic",
  "tongyi_structured_summary",
  "yuanbao_qa_chain",
  "generic_ai_retrieval",
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];
export type SupportedAiScenario = (typeof SUPPORTED_AI_SCENARIOS)[number];

function getSkillsDir() {
  if (process.env.GEO_SKILLS_DIR) {
    return process.env.GEO_SKILLS_DIR;
  }
  return path.join(process.cwd(), "skills");
}

function isSupportedPlatform(value: string | undefined): value is SupportedPlatform {
  return typeof value === "string" && (SUPPORTED_PLATFORMS as readonly string[]).includes(value);
}

function isSupportedAiScenario(value: string | undefined): value is SupportedAiScenario {
  return typeof value === "string" && (SUPPORTED_AI_SCENARIOS as readonly string[]).includes(value);
}

export function normalizePlatform(value: string | undefined): SupportedPlatform {
  return isSupportedPlatform(value) ? value : "toutiao";
}

export function normalizeAiScenario(value: string | undefined): SupportedAiScenario {
  return isSupportedAiScenario(value) ? value : "doubao_plain_answer";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNumberBetweenZeroAndOne(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function requireRecord(value: unknown, pathLabel: string, issues: string[]): Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(`${pathLabel} must be an object`);
    return {};
  }
  return value;
}

function requireString(value: unknown, pathLabel: string, issues: string[]) {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${pathLabel} must be a non-empty string`);
  }
}

function requireStringArray(value: unknown, pathLabel: string, issues: string[]) {
  if (!isStringArray(value)) {
    issues.push(`${pathLabel} must be an array of strings`);
  }
}

function requireBoolean(value: unknown, pathLabel: string, issues: string[]) {
  if (typeof value !== "boolean") {
    issues.push(`${pathLabel} must be a boolean`);
  }
}

function requirePositiveInteger(value: unknown, pathLabel: string, issues: string[]) {
  if (!isPositiveInteger(value)) {
    issues.push(`${pathLabel} must be a positive integer`);
  }
}

function requireNonNegativeInteger(value: unknown, pathLabel: string, issues: string[]) {
  if (!isNonNegativeInteger(value)) {
    issues.push(`${pathLabel} must be a non-negative integer`);
  }
}

function requireScore(value: unknown, pathLabel: string, issues: string[]) {
  if (!isNumberBetweenZeroAndOne(value)) {
    issues.push(`${pathLabel} must be a number between 0 and 1`);
  }
}

function requireRange(value: unknown, pathLabel: string, issues: string[]) {
  const range = requireRecord(value, pathLabel, issues);
  requirePositiveInteger(range.min, `${pathLabel}.min`, issues);
  requirePositiveInteger(range.max, `${pathLabel}.max`, issues);
  if (isPositiveInteger(range.min) && isPositiveInteger(range.max) && range.min > range.max) {
    issues.push(`${pathLabel}.min must be less than or equal to ${pathLabel}.max`);
  }
}

function requireNonNegativeRange(value: unknown, pathLabel: string, issues: string[]) {
  const range = requireRecord(value, pathLabel, issues);
  requireNonNegativeInteger(range.min, `${pathLabel}.min`, issues);
  requireNonNegativeInteger(range.max, `${pathLabel}.max`, issues);
  if (isNonNegativeInteger(range.min) && isNonNegativeInteger(range.max) && range.min > range.max) {
    issues.push(`${pathLabel}.min must be less than or equal to ${pathLabel}.max`);
  }
}

function validatePlatformStrategy(value: unknown, pathLabel: string, issues: string[]): asserts value is PlatformStrategy {
  const root = requireRecord(value, pathLabel, issues);
  requireString(root.platform, `${pathLabel}.platform`, issues);
  if (typeof root.platform === "string" && !isSupportedPlatform(root.platform)) {
    issues.push(`${pathLabel}.platform must be one of ${SUPPORTED_PLATFORMS.join(", ")}`);
  }
  requireString(root.platformLabel, `${pathLabel}.platformLabel`, issues);

  const title = requireRecord(root.title, `${pathLabel}.title`, issues);
  requirePositiveInteger(title.maxLength, `${pathLabel}.title.maxLength`, issues);
  requireStringArray(title.patterns, `${pathLabel}.title.patterns`, issues);
  requireStringArray(title.bannedPatterns, `${pathLabel}.title.bannedPatterns`, issues);
  requireString(title.instructions, `${pathLabel}.title.instructions`, issues);

  const body = requireRecord(root.body, `${pathLabel}.body`, issues);
  requireString(body.preferredStructure, `${pathLabel}.body.preferredStructure`, issues);
  requireString(body.paragraphLength, `${pathLabel}.body.paragraphLength`, issues);
  requirePositiveInteger(body.maxParagraphChars, `${pathLabel}.body.maxParagraphChars`, issues);
  requireString(body.headingStyle, `${pathLabel}.body.headingStyle`, issues);
  requireRange(body.sectionCount, `${pathLabel}.body.sectionCount`, issues);
  requireString(body.ctaStyle, `${pathLabel}.body.ctaStyle`, issues);
  requireString(body.instructions, `${pathLabel}.body.instructions`, issues);

  const metadata = requireRecord(root.metadata, `${pathLabel}.metadata`, issues);
  requireBoolean(metadata.allowPublicTraceId, `${pathLabel}.metadata.allowPublicTraceId`, issues);
  requireBoolean(metadata.allowTimestamp, `${pathLabel}.metadata.allowTimestamp`, issues);
  requireBoolean(metadata.allowMarkdownTable, `${pathLabel}.metadata.allowMarkdownTable`, issues);
  requireBoolean(metadata.allowFaq, `${pathLabel}.metadata.allowFaq`, issues);
  requireNonNegativeRange(metadata.faqCount, `${pathLabel}.metadata.faqCount`, issues);

  const review = requireRecord(root.review, `${pathLabel}.review`, issues);
  requireStringArray(review.riskWords, `${pathLabel}.review.riskWords`, issues);
  requireStringArray(review.mustHave, `${pathLabel}.review.mustHave`, issues);
  requireStringArray(review.mustNotHave, `${pathLabel}.review.mustNotHave`, issues);
}

function assertValidPlatformStrategy(value: unknown, filePath: string): PlatformStrategy {
  const issues: string[] = [];
  validatePlatformStrategy(value, "platform strategy", issues);
  if (issues.length) {
    throw new StrategyAssetValidationError(filePath, issues);
  }
  return value as PlatformStrategy;
}

function assertValidPlatformStrategyCollection(value: unknown, filePath: string): PlatformStrategyCollection {
  const issues: string[] = [];
  const root = requireRecord(value, "platform strategy collection", issues);
  requireString(root.version, "version", issues);
  if (!Array.isArray(root.strategies)) {
    issues.push("strategies must be an array");
  } else {
    const seen = new Set<string>();
    root.strategies.forEach((strategy, index) => {
      validatePlatformStrategy(strategy, `strategies[${index}]`, issues);
      const platform = isRecord(strategy) && typeof strategy.platform === "string" ? strategy.platform : "";
      if (platform) {
        if (seen.has(platform)) {
          issues.push(`strategies contains duplicate platform ${platform}`);
        }
        seen.add(platform);
      }
    });
  }
  if (issues.length) {
    throw new StrategyAssetValidationError(filePath, issues);
  }
  return value as PlatformStrategyCollection;
}

function assertValidAngleLibrary(value: unknown, filePath: string): AngleLibrary {
  const issues: string[] = [];
  const root = requireRecord(value, "angle library", issues);
  if (!Array.isArray(root.angles)) {
    issues.push("angles must be an array");
  } else {
    root.angles.forEach((angle, index) => {
      const item = requireRecord(angle, `angles[${index}]`, issues);
      requireString(item.angleId, `angles[${index}].angleId`, issues);
      requireString(item.label, `angles[${index}].label`, issues);
      requireString(item.description, `angles[${index}].description`, issues);
      requireStringArray(item.applicablePlatforms, `angles[${index}].applicablePlatforms`, issues);
      requireString(item.titleDirection, `angles[${index}].titleDirection`, issues);
    });
  }
  if (issues.length) {
    throw new StrategyAssetValidationError(filePath, issues);
  }
  return value as AngleLibrary;
}

function assertValidRiskWords(value: unknown, filePath: string): RiskWordsConfig {
  const issues: string[] = [];
  const root = requireRecord(value, "risk words config", issues);
  requireString(root.version, "version", issues);
  requireString(root.description, "description", issues);
  requireStringArray(root.blockingWords, "blockingWords", issues);
  requireStringArray(root.warningWords, "warningWords", issues);
  if (typeof root.preferredPhrases !== "undefined") {
    requireStringArray(root.preferredPhrases, "preferredPhrases", issues);
  }
  if (!Array.isArray(root.contextualRules)) {
    issues.push("contextualRules must be an array");
  } else {
    root.contextualRules.forEach((rule, index) => {
      const item = requireRecord(rule, `contextualRules[${index}]`, issues);
      requireString(item.pattern, `contextualRules[${index}].pattern`, issues);
      if (typeof item.pattern === "string") {
        try {
          new RegExp(item.pattern);
        } catch {
          issues.push(`contextualRules[${index}].pattern must be a valid regular expression`);
        }
      }
      if (item.risk !== "warning" && item.risk !== "blocking") {
        issues.push(`contextualRules[${index}].risk must be warning or blocking`);
      }
      requireString(item.reason, `contextualRules[${index}].reason`, issues);
    });
  }
  if (issues.length) {
    throw new StrategyAssetValidationError(filePath, issues);
  }
  return value as RiskWordsConfig;
}

function assertValidSimilarityConfig(value: unknown, filePath: string): SimilarityDispersionConfig {
  const issues: string[] = [];
  const root = requireRecord(value, "similarity dispersion config", issues);
  requireString(root.version, "version", issues);
  requireStringArray(root.dimensions, "dimensions", issues);
  const weights = requireRecord(root.weights, "weights", issues);
  for (const key of ["title", "opening", "bodyShingle", "faq", "cta"]) {
    requireScore(weights[key], `weights.${key}`, issues);
  }
  const thresholds = requireRecord(root.thresholds, "thresholds", issues);
  requireScore(thresholds.block, "thresholds.block", issues);
  requireScore(thresholds.warn, "thresholds.warn", issues);
  if (
    isNumberBetweenZeroAndOne(thresholds.block) &&
    isNumberBetweenZeroAndOne(thresholds.warn) &&
    thresholds.warn > thresholds.block
  ) {
    issues.push("thresholds.warn must be less than or equal to thresholds.block");
  }
  requireStringArray(root.requiredDifferences, "requiredDifferences", issues);
  requireStringArray(root.historyScopes, "historyScopes", issues);
  if (issues.length) {
    throw new StrategyAssetValidationError(filePath, issues);
  }
  return value as SimilarityDispersionConfig;
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new StrategyAssetValidationError(filePath, [
        `JSON parse failed: ${error instanceof Error ? error.message : "unknown parse error"}`,
      ]);
    }
  } catch (error) {
    if (error instanceof StrategyAssetValidationError) {
      throw error;
    }
    return null;
  }
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return (await fs.readFile(filePath, "utf-8")).trim();
  } catch {
    return null;
  }
}

export async function loadPlatformStrategyCollection(): Promise<PlatformStrategyCollection> {
  const file = path.join(getSkillsDir(), "geo-platform-writing", "platform-strategies.json");
  const data = await readJsonFile(file);
  if (!data) {
    return { version: "missing", strategies: [] };
  }
  return assertValidPlatformStrategyCollection(data, file);
}

export async function loadPlatformStrategy(platform: string | undefined): Promise<PlatformStrategy | null> {
  const normalized = normalizePlatform(platform);
  const collection = await loadPlatformStrategyCollection();
  const auditedStrategy = collection.strategies.find((item) => item.platform === normalized);
  if (auditedStrategy) {
    return auditedStrategy;
  }

  const legacyFile = path.join(getSkillsDir(), "platform-article-structure", "platform-strategies", `${normalized}.json`);
  const legacyData = await readJsonFile(legacyFile);
  return legacyData ? assertValidPlatformStrategy(legacyData, legacyFile) : null;
}

export async function loadAiScenarioTemplate(scenario: string | undefined): Promise<string | null> {
  const normalized = normalizeAiScenario(scenario);
  const file = path.join(getSkillsDir(), "ai-answer-structure", "templates", `${normalized}.md`);
  const template = await readTextFile(file);
  if (template !== null && !template.trim()) {
    throw new StrategyAssetValidationError(file, ["AI scenario template must not be empty"]);
  }
  return template;
}

export async function loadAngleLibrary(): Promise<AngleLibrary> {
  const file = path.join(getSkillsDir(), "similarity-dispersion", "angle-library.json");
  const data = await readJsonFile(file);
  return data ? assertValidAngleLibrary(data, file) : { angles: [] };
}

export async function loadAngleDefinition(angleId: string | undefined): Promise<AngleDefinition | null> {
  if (!angleId) return null;
  const library = await loadAngleLibrary();
  return library.angles.find((item) => item.angleId === angleId) ?? null;
}

export async function loadRiskWords(): Promise<RiskWordsConfig | null> {
  const auditedFile = path.join(getSkillsDir(), "geo-platform-writing", "risk-language.json");
  const auditedData = await readJsonFile(auditedFile);
  if (auditedData) {
    return assertValidRiskWords(auditedData, auditedFile);
  }

  const legacyFile = path.join(getSkillsDir(), "geo-content-review", "risk-words.json");
  const legacyData = await readJsonFile(legacyFile);
  return legacyData ? assertValidRiskWords(legacyData, legacyFile) : null;
}

export async function loadSimilarityDispersionConfig(): Promise<SimilarityDispersionConfig> {
  const file = path.join(getSkillsDir(), "geo-platform-writing", "similarity-dispersion.json");
  const data = await readJsonFile(file);
  if (!data) {
    return {
      version: "default",
      dimensions: ["title", "opening", "bodyShingle", "faq", "cta"],
      weights: { title: 0.22, opening: 0.22, bodyShingle: 0.28, faq: 0.14, cta: 0.14 },
      thresholds: { block: 0.82, warn: 0.62 },
      requiredDifferences: ["title pattern", "first sentence", "section order", "examples", "CTA wording"],
      historyScopes: ["same task batch", "same publish platform", "same account"],
    };
  }
  return assertValidSimilarityConfig(data, file);
}

export function renderPlatformStrategyInstructions(strategy: PlatformStrategy | null): string {
  if (!strategy) {
    return "";
  }
  return [
    `目标发布平台：${strategy.platformLabel}（${strategy.platform}）`,
    "",
    "## 平台标题要求",
    `- 最大长度：${strategy.title.maxLength} 字`,
    `- 标题方向：${strategy.title.patterns.join("、")}`,
    `- 不允许：${strategy.title.bannedPatterns.join("、")}`,
    `- 指引：${strategy.title.instructions}`,
    "",
    "## 平台正文要求",
    `- 推荐结构：${strategy.body.preferredStructure}`,
    `- 段落长度：${strategy.body.paragraphLength}（每段不超过 ${strategy.body.maxParagraphChars} 字）`,
    `- 标题风格：${strategy.body.headingStyle}`,
    `- 章节数：${strategy.body.sectionCount.min}-${strategy.body.sectionCount.max} 个`,
    `- CTA 风格：${strategy.body.ctaStyle}`,
    `- 指引：${strategy.body.instructions}`,
    "",
    "## 平台元信息策略",
    `- 是否展示公开追踪码：${strategy.metadata.allowPublicTraceId ? "是" : "否"}`,
    `- 是否展示更新时间：${strategy.metadata.allowTimestamp ? "是" : "否"}`,
    `- 是否允许 Markdown 表格：${strategy.metadata.allowMarkdownTable ? "是" : "否"}`,
    `- 是否允许 FAQ：${strategy.metadata.allowFaq ? `是（${strategy.metadata.faqCount.min}-${strategy.metadata.faqCount.max} 条）` : "否"}`,
    "",
    "## 平台合规要求",
    `- 高风险词（禁用）：${strategy.review.riskWords.join("、")}`,
    `- 必须包含：${strategy.review.mustHave.join("、")}`,
    `- 必须不包含：${strategy.review.mustNotHave.join("、")}`,
  ].join("\n");
}

export function renderAngleInstructions(angle: AngleDefinition | null): string {
  if (!angle) {
    return "";
  }
  return [
    `本次内容角度：${angle.label}（${angle.angleId}）`,
    `角度描述：${angle.description}`,
    `参考标题方向：${angle.titleDirection}`,
    "请围绕这个角度组织全文，章节标题、正文论证、FAQ、CTA 都应体现这个角度。",
    "不要写成通用泛泛而谈，必须聚焦本角度。",
  ].join("\n");
}

export function getPromptVersion(platform: SupportedPlatform, aiScenario: SupportedAiScenario): string {
  return `geo-content-${platform}-${aiScenario}-1.0`;
}
