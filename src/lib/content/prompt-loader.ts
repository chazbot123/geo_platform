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
}

const SUPPORTED_PLATFORMS = ["toutiao", "wechat", "blog", "xiaohongshu", "douyin"] as const;
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
  // 开发模式：项目根目录的 skills/
  // 打包后：Electron 的 extraResources 把 skills/ 放在 process.resourcesPath
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

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text) as T;
  } catch {
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

export async function loadPlatformStrategy(platform: string | undefined): Promise<PlatformStrategy | null> {
  const normalized = normalizePlatform(platform);
  const file = path.join(getSkillsDir(), "platform-article-structure", "platform-strategies", `${normalized}.json`);
  return readJsonFile<PlatformStrategy>(file);
}

export async function loadAiScenarioTemplate(scenario: string | undefined): Promise<string | null> {
  const normalized = normalizeAiScenario(scenario);
  const file = path.join(getSkillsDir(), "ai-answer-structure", "templates", `${normalized}.md`);
  return readTextFile(file);
}

export async function loadAngleLibrary(): Promise<AngleLibrary> {
  const file = path.join(getSkillsDir(), "similarity-dispersion", "angle-library.json");
  const data = await readJsonFile<AngleLibrary>(file);
  return data ?? { angles: [] };
}

export async function loadAngleDefinition(angleId: string | undefined): Promise<AngleDefinition | null> {
  if (!angleId) return null;
  const library = await loadAngleLibrary();
  return library.angles.find((item) => item.angleId === angleId) ?? null;
}

export async function loadRiskWords(): Promise<RiskWordsConfig | null> {
  const file = path.join(getSkillsDir(), "geo-content-review", "risk-words.json");
  return readJsonFile<RiskWordsConfig>(file);
}

export function renderPlatformStrategyInstructions(strategy: PlatformStrategy | null): string {
  if (!strategy) {
    return "";
  }
  const sectionLines = [
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
  ];
  return sectionLines.join("\n");
}

export function renderAngleInstructions(angle: AngleDefinition | null): string {
  if (!angle) {
    return "";
  }
  return [
    `本次内容角度：${angle.label}（${angle.angleId}）`,
    `角度描述：${angle.description}`,
    `参考标题方向：${angle.titleDirection}`,
    "请围绕这个角度组织全文，章节标题、正文论证、FAQ、CTA 都应该体现这个角度。",
    "不要写成通用泛泛而谈，必须聚焦本角度。",
  ].join("\n");
}

export function getPromptVersion(platform: SupportedPlatform, aiScenario: SupportedAiScenario): string {
  return `geo-content-${platform}-${aiScenario}-1.0`;
}
