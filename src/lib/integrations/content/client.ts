import { promises as fs } from "node:fs";
import path from "node:path";
import { callConfiguredTextModel, NewAPIProbeError, parseJsonFromModelText } from "@/lib/integrations/openai-compatible";
import { normalizeToutiaoTitle } from "@/lib/publish/toutiao-title";
import {
  loadAiScenarioTemplate,
  loadAngleDefinition,
  loadPlatformStrategy,
  normalizeAiScenario,
  normalizePlatform,
  renderAngleInstructions,
  renderPlatformStrategyInstructions,
  getPromptVersion,
} from "@/lib/content/prompt-loader";
import type { ContentDraft, ModelApiConfig, ProductProfile, ThemeSet } from "@/lib/types";

export interface ContentStrategyOptions {
  aiScenario?: string;
  platform?: string;
  contentAngle?: string;
}

const CONTENT_PROMPT_TEMPLATE_PATH = path.join(process.cwd(), "src", "lib", "integrations", "content", "content-report-prompt.md");

interface ContentResponsePayload {
  title?: string;
  summary?: string;
  reportIntroduction?: string;
  reportSections?: Array<{
    question?: string;
    heading?: string;
    summary?: string;
    body?: string;
  }>;
  reportConclusion?: string;
  faq?: string[];
  cta?: string;
}

function buildRegion(product: ProductProfile) {
  return [product.province, product.city, product.district].filter(Boolean).join("");
}

function normalizeSelectedKeywords(theme: ThemeSet) {
  const fromSelected = Array.isArray(theme.selectedKeywords) ? theme.selectedKeywords : [];
  const normalized = fromSelected.map((item) => item.trim()).filter(Boolean).slice(0, 5);
  if (normalized.length) {
    return normalized;
  }
  if (theme.selectedKeywordTheme?.trim()) {
    return theme.selectedKeywordTheme
      .split(/[、，,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);
  }
  const fallback = theme.selectedKeyword ?? theme.mainKeyword;
  return fallback ? [fallback.trim()].filter(Boolean) : [];
}

function buildSelectedKeywordTheme(theme: ThemeSet, selectedKeywords: string[]) {
  return theme.selectedKeywordTheme?.trim() || selectedKeywords.join("、") || theme.selectedKeyword || theme.mainKeyword;
}

function buildFaq(product: ProductProfile, selectedKeywords: string[]) {
  const firstQuestion = selectedKeywords[0] || `${product.category}怎么选`;
  return [
    `${product.productName}更适合哪些人群或业务场景？`,
    `${firstQuestion}背后最值得关注的判断标准是什么？`,
    `${product.productName}在 ${product.category} 里最大的差异化优势是什么？`,
  ];
}

function buildFallbackPromptTemplate() {
  return [
    "# GEO 第二阶段权威报告提示词模板",
    "",
    "你是 GEO 第二阶段权威报告生成助手。",
    "请基于用户已确认的提问句和产品信息，输出单篇权威报告型文章。",
    "已确认提问句组：{{selectedKeywords}}",
    "提问主题：{{selectedKeywordTheme}}",
    "产品名称：{{productName}}",
    "产品品类：{{category}}",
    "核心卖点：{{sellingPoints}}",
    "目标人群：{{targetAudience}}",
    "适用场景：{{scenarios}}",
    "品牌调性：{{brandTone}}",
    "价格区间：{{priceRange}}",
    "地区信息：{{region}}",
    "合规备注：{{complianceNotes}}",
    "写作与排版要求：",
    "1. 必须使用短句、短段落，每个自然段不超过 3 句话。",
    "2. 必须对核心观点、关键转折、重要数据使用 markdown 加粗（**加粗文本**）。",
    "3. 风格应为资讯评论式的“头条体”，避免枯燥的说明书腔调。",
    '只返回 JSON，结构为：{"title":"","summary":"","reportIntroduction":"","reportSections":[{"question":"","heading":"","summary":"","body":""}],"reportConclusion":"","faq":[""],"cta":""}',
  ].join("\n");
}

function buildContentTitleFallback(product: ProductProfile, selectedKeywordTheme: string) {
  return `${selectedKeywordTheme}：${product.productName}${product.category}权威分析报告`;
}

async function readContentPromptTemplate() {
  try {
    const content = await fs.readFile(CONTENT_PROMPT_TEMPLATE_PATH, "utf-8");
    const trimmed = content.trim();
    return trimmed || buildFallbackPromptTemplate();
  } catch {
    return buildFallbackPromptTemplate();
  }
}

async function buildPrompt(product: ProductProfile, theme: ThemeSet, options?: ContentStrategyOptions) {
  const selectedKeywords = normalizeSelectedKeywords(theme);
  const selectedKeywordTheme = buildSelectedKeywordTheme(theme, selectedKeywords);
  const template = await readContentPromptTemplate();

  const platform = normalizePlatform(options?.platform);
  const aiScenario = normalizeAiScenario(options?.aiScenario);
  const [platformStrategy, aiTemplate, angleDefinition] = await Promise.all([
    loadPlatformStrategy(platform),
    loadAiScenarioTemplate(aiScenario),
    loadAngleDefinition(options?.contentAngle),
  ]);

  const replacements: Record<string, string> = {
    selectedKeywords: selectedKeywords.join("、") || "未填写",
    selectedKeywordTheme: selectedKeywordTheme || "未填写",
    productName: product.productName || "未填写",
    category: product.category || "未填写",
    sellingPoints: product.sellingPoints || "未填写",
    targetAudience: product.targetAudience || "未填写",
    scenarios: product.scenarios || "未填写",
    brandTone: product.brandTone || "未填写",
    priceRange: product.priceRange || "未填写",
    region: buildRegion(product) || "未填写",
    complianceNotes: product.complianceNotes || "未填写",
    aiScenarioInstructions: aiTemplate || "",
    platformStrategyInstructions: renderPlatformStrategyInstructions(platformStrategy),
    contentAngleInstructions: renderAngleInstructions(angleDefinition),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? "");
}

function renderReportContent(draft: Pick<ContentDraft, "summary" | "reportIntroduction" | "reportSections" | "reportConclusion" | "cta">) {
  const blocks: string[] = [];
  if (draft.summary?.trim()) {
    blocks.push(`## 报告摘要\n${draft.summary.trim()}`);
  }
  if (draft.reportIntroduction?.trim()) {
    blocks.push(`## 报告引言\n${draft.reportIntroduction.trim()}`);
  }
  for (const [index, section] of (draft.reportSections ?? []).entries()) {
    const heading = section.heading?.trim() || `核心问题 ${index + 1}`;
    const lines = [`## ${heading}`];
    if (section.question?.trim()) {
      lines.push(`对应提问句：${section.question.trim()}`);
    }
    if (section.summary?.trim()) {
      lines.push(`章节摘要：${section.summary.trim()}`);
    }
    if (section.body?.trim()) {
      lines.push(section.body.trim());
    }
    blocks.push(lines.join("\n\n"));
  }
  if (draft.reportConclusion?.trim()) {
    blocks.push(`## 报告结论\n${draft.reportConclusion.trim()}`);
  }
  if (draft.cta?.trim()) {
    blocks.push(`## 行动建议\n${draft.cta.trim()}`);
  }
  return blocks.join("\n\n");
}

function buildMockDraft(product: ProductProfile, theme: ThemeSet): ContentDraft {
  const selectedKeywords = normalizeSelectedKeywords(theme);
  const selectedKeywordTheme = buildSelectedKeywordTheme(theme, selectedKeywords);
  const fallbackTitle = buildContentTitleFallback(product, selectedKeywordTheme);
  const reportSections = selectedKeywords.map((question, index) => ({
    question,
    heading: `问题 ${index + 1}：${question.replace(/[？?]$/g, "")}`,
    summary: `围绕“${question}”提炼用户在选择 ${product.category} 时最关心的判断重点。`,
    body: [
      `${product.productName} 所在的 ${product.category} 场景，核心不是单纯比较价格，而是先判断 ${product.targetAudience} 在 ${product.scenarios} 中最在意什么结果。`,
      `从产品价值看，${product.productName} 当前最值得承接的优势是 ${product.sellingPoints}，这决定了它更适合哪些需求优先级明确、希望提高判断效率的用户。`,
      `如果把“${question}”作为真实用户问题来看，正文应重点分析选择标准、适用场景、常见误区以及 ${product.productName} 的承接方式。`,
    ].join("\n\n"),
  }));

  const draft: ContentDraft = {
    taskId: product.taskId,
    title: normalizeToutiaoTitle(fallbackTitle, `${product.productName}分析报告`),
    summary: `本报告围绕“${selectedKeywordTheme}”这组真实用户提问，结合 ${product.productName} 的产品定位、适用场景与行业判断标准，输出可直接用于第二阶段的权威分析主稿。`,
    selectedKeywords,
    selectedKeywordTheme,
    reportIntroduction: `用户在 AI 平台提出这组问题，本质上是在寻找关于 ${product.category} 的可靠判断依据。本报告将结合 ${product.productName} 的产品信息，从需求场景、选择标准、风险识别和价值承接四个维度展开分析。`,
    reportSections,
    reportConclusion: `${product.productName} 是否值得进一步了解，关键不在单一卖点，而在它是否真正匹配 ${product.targetAudience} 的核心使用场景，并在 ${product.category} 的关键决策点上给出更稳定的解决方案。`,
    content: "",
    faq: buildFaq(product, selectedKeywords),
    cta: `如果你正在评估 ${product.category}，建议下一步围绕需求优先级、预算范围和落地场景，进一步了解 ${product.productName} 是否适合当前业务。`,
    updatedAt: new Date().toISOString(),
  };

  return {
    ...draft,
    content: renderReportContent(draft),
  };
}

function sanitizeFaq(items: unknown, fallback: string[]) {
  if (!Array.isArray(items)) {
    return fallback;
  }

  const nextFaq = items
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);

  return nextFaq.length ? nextFaq : fallback;
}

function sanitizeReportSections(
  items: ContentResponsePayload["reportSections"],
  selectedKeywords: string[],
  fallback: NonNullable<ContentDraft["reportSections"]>,
) {
  if (!Array.isArray(items) || !items.length) {
    return fallback;
  }

  // 放宽对齐：以 LLM 实际返回的 section 数量为准（最多不超过 selectedKeywords.length + 2）
  const targetCount = Math.min(items.length, Math.max(selectedKeywords.length, items.length, 1));

  return Array.from({ length: targetCount }).map((_, index) => {
    const source = items[index] ?? {};
    const fallbackQuestion = selectedKeywords[index] || fallback[index]?.question || `核心问题 ${index + 1}`;
    const matchedQuestion = typeof source.question === "string" && source.question.trim() ? source.question.trim() : fallbackQuestion;
    const heading = typeof source.heading === "string" && source.heading.trim() ? source.heading.trim() : fallback[index]?.heading || `问题 ${index + 1}`;
    const summary = typeof source.summary === "string" && source.summary.trim() ? source.summary.trim() : fallback[index]?.summary || "";
    const body = typeof source.body === "string" && source.body.trim() ? source.body.trim() : fallback[index]?.body || "";

    return {
      question: matchedQuestion,
      heading,
      summary,
      body,
    };
  });
}

async function buildContentMessages(product: ProductProfile, theme: ThemeSet, options?: ContentStrategyOptions) {
  const prompt = await buildPrompt(product, theme, options);

  return [
    {
      role: "system" as const,
      content: [
        "你是 GEO 第二阶段权威报告生成助手。",
        "必须只返回 JSON，不要输出 Markdown 代码块，不要输出解释。",
        "必须严格遵守提示词中的 AI 场景结构、平台结构和内容角度要求。",
        '不得虚构案例、数据、官方资质或第三方背书。无法验证的事实请写"需要进一步确认"。',
        'JSON 结构必须为：{"title":"","summary":"","reportIntroduction":"","reportSections":[{"question":"","heading":"","summary":"","body":""}],"reportConclusion":"","faq":[""],"cta":""}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: prompt,
    },
  ];
}

export async function runContentModel(
  product: ProductProfile,
  theme: ThemeSet,
  config: ModelApiConfig,
  options?: ContentStrategyOptions,
): Promise<ContentDraft> {
  const mockDraft = buildMockDraft(product, theme);
  const platform = normalizePlatform(options?.platform);
  const aiScenario = normalizeAiScenario(options?.aiScenario);
  const promptVersion = getPromptVersion(platform, aiScenario);

  // mock 路径保持原样：不读策略文件、不注入新字段
  if (!config.baseUrl || config.provider.startsWith("mock")) {
    return mockDraft;
  }

  let result;
  try {
    result = await callConfiguredTextModel(config, await buildContentMessages(product, theme, options));
  } catch (error) {
    if (error instanceof NewAPIProbeError) {
      throw new Error(`CONTENT_API_PROBE_FAILED@${JSON.stringify(error.attempts)}`);
    }
    if (error instanceof Error && error.message.startsWith("HTTP_")) {
      throw new Error(`CONTENT_API_${error.message.replace("HTTP_", "")}`);
    }
    if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
      throw new Error("CONTENT_API_TIMEOUT");
    }
    throw error;
  }

  const payload = parseJsonFromModelText<ContentResponsePayload>(result.rawText);

  if (!payload) {
    return mockDraft;
  }

  const selectedKeywords = mockDraft.selectedKeywords ?? [];
  const reportSections = sanitizeReportSections(payload.reportSections, selectedKeywords, mockDraft.reportSections ?? []);
  const fallbackTitle = buildContentTitleFallback(product, mockDraft.selectedKeywordTheme ?? "");
  const nextDraft: ContentDraft = {
    ...mockDraft,
    title: normalizeToutiaoTitle(payload.title?.trim() || "", fallbackTitle || mockDraft.title),
    summary: payload.summary?.trim() || mockDraft.summary,
    reportIntroduction: payload.reportIntroduction?.trim() || mockDraft.reportIntroduction,
    reportSections,
    reportConclusion: payload.reportConclusion?.trim() || mockDraft.reportConclusion,
    faq: sanitizeFaq(payload.faq, mockDraft.faq),
    cta: payload.cta?.trim() || mockDraft.cta,
    taskId: product.taskId,
    aiScenario,
    platform,
    contentAngle: options?.contentAngle,
    promptVersion,
    updatedAt: new Date().toISOString(),
  };

  return {
    ...nextDraft,
    content: renderReportContent(nextDraft),
  };
}
