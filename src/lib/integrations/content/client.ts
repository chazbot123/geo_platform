import { callOpenAICompatibleTextModel, parseJsonFromModelText } from "@/lib/integrations/openai-compatible";
import type { ContentDraft, ModelApiConfig, ProductProfile, ThemeSet } from "@/lib/types";

function buildFaq(product: ProductProfile) {
  return [
    `${product.productName}适合谁？`,
    `${product.productName}解决什么问题？`,
    `${product.productName}和竞品相比有什么亮点？`,
  ];
}

function buildMockDraft(product: ProductProfile, theme: ThemeSet): ContentDraft {
  const keyword = theme.selectedKeyword ?? theme.mainKeyword;
  return {
    taskId: product.taskId,
    title: `${keyword} | ${product.productName}内容主稿`,
    summary: `${product.productName}围绕 ${keyword} 的桌面测试版内容摘要，突出卖点、场景和转化路径。`,
    content: [
      `## 为什么从 ${keyword} 切入`,
      `${product.productName} 的核心卖点是 ${product.sellingPoints}。`,
      `它面向 ${product.targetAudience}，适用场景包括 ${product.scenarios}。`,
      `品牌调性为 ${product.brandTone}，因此正文保持可信、结构化、可检索。`,
      `## 建议内容结构`,
      `1. 场景痛点`,
      `2. 产品解决方案`,
      `3. 购买前关注点`,
      `4. 常见问题与行动引导`,
    ].join("\n\n"),
    faq: buildFaq(product),
    cta: `如果你正在评估 ${product.category}，建议先从 ${product.productName} 的试用或咨询入口开始。`,
    updatedAt: new Date().toISOString(),
  };
}

interface ContentResponsePayload {
  title?: string;
  summary?: string;
  content?: string;
  faq?: string[];
  cta?: string;
}

function buildContentMessages(product: ProductProfile, theme: ThemeSet) {
  const keyword = theme.selectedKeyword ?? theme.mainKeyword;

  return [
    {
      role: "system" as const,
      content: [
        "你是 GEO 内容生成助手。",
        "请基于产品信息和主题词输出适合社媒分发与发布草稿改写的中文内容。",
        "必须只返回 JSON，不要输出 Markdown 代码块，不要输出解释。",
        'JSON 结构必须为：{"title":"", "summary":"", "content":"", "faq":[""], "cta":""}',
        "其中 faq 返回 3 个字符串数组项。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `主关键词：${keyword}`,
        `产品名称：${product.productName}`,
        `产品品类：${product.category}`,
        `核心卖点：${product.sellingPoints}`,
        `目标人群：${product.targetAudience}`,
        `适用场景：${product.scenarios}`,
        `品牌调性：${product.brandTone}`,
        "请输出一篇适合社媒发布工作台改写的中文主稿，要求结构清晰、信息完整、便于提炼卖点与话题标签。",
      ].join("\n"),
    },
  ];
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

export async function runContentModel(product: ProductProfile, theme: ThemeSet, config: ModelApiConfig): Promise<ContentDraft> {
  const mockDraft = buildMockDraft(product, theme);

  if (!config.baseUrl || config.provider.startsWith("mock")) {
    return mockDraft;
  }

  let result;
  try {
    result = await callOpenAICompatibleTextModel(config, buildContentMessages(product, theme));
  } catch (error) {
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

  return {
    ...mockDraft,
    title: payload.title?.trim() || mockDraft.title,
    summary: payload.summary?.trim() || mockDraft.summary,
    content: payload.content?.trim() || mockDraft.content,
    faq: sanitizeFaq(payload.faq, mockDraft.faq),
    cta: payload.cta?.trim() || mockDraft.cta,
    taskId: product.taskId,
    updatedAt: new Date().toISOString(),
  };
}
