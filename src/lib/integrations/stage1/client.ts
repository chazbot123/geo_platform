import { callOpenAICompatibleTextModel, parseJsonFromModelText } from "@/lib/integrations/openai-compatible";
import type { ModelApiConfig, ProductProfile, ThemeSet } from "@/lib/types";

function unique(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function buildMockKeywords(product: ProductProfile) {
  const seeds = unique([
    product.productName,
    product.category,
    product.targetAudience,
    product.scenarios,
    product.competitorKeywords ?? "",
  ].join(" ").split(/[,，\s]+/));

  const core = seeds.slice(0, 4);
  const mainKeyword = `${product.category}${product.targetAudience}低竞争方案`;
  const backupKeywords = unique([
    `${product.productName}内容布局`,
    `${product.scenarios}搜索优化`,
    `${product.category}长尾选题`,
  ]).slice(0, 3);

  const relatedKeywords = unique([
    `${product.productName}怎么选`,
    `${product.targetAudience}使用指南`,
    `${product.scenarios}解决方案`,
    `${product.category}内容策略`,
    `${core.join(" ")} 选题`,
  ]).slice(0, 5);

  const scoreSummary = `围绕 ${product.category} 的低竞争场景词进行推荐，兼顾购买意图与可检索性。`;
  return { mainKeyword, backupKeywords, relatedKeywords, scoreSummary };
}

interface Stage1ResponsePayload {
  mainKeyword?: string;
  backupKeywords?: string[];
  relatedKeywords?: string[];
  scoreSummary?: string;
  selectedKeyword?: string;
}

function sanitizeKeywordList(items: unknown, fallback: string[] = [], limit = 5) {
  if (!Array.isArray(items)) {
    return fallback.slice(0, limit);
  }

  return unique(
    items
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean),
  ).slice(0, limit);
}

function buildStage1Messages(product: ProductProfile) {
  return [
    {
      role: "system" as const,
      content: [
        "你是 GEO 第一阶段关键词分析助手。",
        "你的任务是基于产品信息，输出低竞争但值得做的关键词建议。",
        "必须只返回 JSON，不要输出 Markdown，不要输出额外解释。",
        'JSON 结构必须为：{"mainKeyword":"", "backupKeywords":[""], "relatedKeywords":[""], "scoreSummary":""}',
        "其中 backupKeywords 返回 2 到 5 个，relatedKeywords 返回 5 个。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `产品名称：${product.productName}`,
        `产品品类：${product.category}`,
        `核心卖点：${product.sellingPoints}`,
        `目标人群：${product.targetAudience}`,
        `适用场景：${product.scenarios}`,
        `品牌调性：${product.brandTone}`,
        `竞品名称：${product.competitorName ?? "无"}`,
        `竞品关键词：${product.competitorKeywords ?? "无"}`,
        `禁用词：${product.restrictedWords ?? "无"}`,
        "请输出适合 GEO/SEO 场景的低竞争关键词结果，强调购买意图、可检索性、内容可扩展性。",
      ].join("\n"),
    },
  ];
}

function mapStage1Payload(product: ProductProfile, payload: Stage1ResponsePayload | null, now: string): ThemeSet {
  const mock = buildMockKeywords(product);

  return {
    taskId: product.taskId,
    mainKeyword: payload?.mainKeyword?.trim() || mock.mainKeyword,
    backupKeywords: sanitizeKeywordList(payload?.backupKeywords, mock.backupKeywords, 5),
    relatedKeywords: sanitizeKeywordList(payload?.relatedKeywords, mock.relatedKeywords, 5),
    scoreSummary: payload?.scoreSummary?.trim() || mock.scoreSummary,
    selectedKeyword: payload?.selectedKeyword?.trim() || undefined,
    updatedAt: now,
  };
}

export async function runStage1Model(product: ProductProfile, config: ModelApiConfig): Promise<ThemeSet> {
  const now = new Date().toISOString();

  if (!config.baseUrl || config.provider.startsWith("mock")) {
    const result = buildMockKeywords(product);
    return {
      taskId: product.taskId,
      ...result,
      updatedAt: now,
    };
  }

  try {
    const result = await callOpenAICompatibleTextModel(config, buildStage1Messages(product));
    const payload = parseJsonFromModelText<Stage1ResponsePayload>(result.rawText);
    return mapStage1Payload(product, payload, now);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("HTTP_")) {
      throw new Error(`STAGE1_API_${error.message.replace("HTTP_", "")}`);
    }
    if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
      throw new Error("STAGE1_API_TIMEOUT");
    }
    throw error;
  }
}
