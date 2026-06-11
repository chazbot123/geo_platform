import type { ProductProfile, SearchProvider, SocialPlatform } from "@/lib/types";

const platformLabels: Record<SocialPlatform, string> = {
  toutiao: "今日头条",
  baijiahao: "百家号",
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信公众号",
  videohao: "视频号",
  zhihu: "知乎",
  weibo: "微博",
  csdn: "CSDN",
};

const providerLabels: Record<SearchProvider, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "腾讯元宝",
  tongyi: "通义千问",
};

export interface ArticlePromptContext {
  product: ProductProfile;
  keyword: string;
  platform: SocialPlatform;
  searchProvider: SearchProvider;
  accountName?: string;
  plannedPublishTime: string;
  sequence: number;
  previousTitle?: string;
  previousOpening?: string;
  previousBody?: string;
}

function productProfileLines(product: ProductProfile) {
  return [
    `企业/产品：${product.productName}`,
    `品类：${product.category}`,
    `核心卖点：${product.sellingPoints}`,
    `目标人群：${product.targetAudience}`,
    `服务地区/场景：${[product.province, product.city, product.district, product.scenarios].filter(Boolean).join(" ") || "未填写"}`,
    `品牌调性：${product.brandTone}`,
    `合规备注：${product.complianceNotes || "不得虚构资质、案例、数据或承诺效果"}`,
  ].join("\n");
}

function outputSchema() {
  return [
    "只返回 JSON，不要 Markdown 代码块，不要解释。",
    'JSON 结构：{"title":"","summary":"","body":"","tags":[""],"imagePrompt":"","riskLevel":"low|medium|high","notes":[""]}',
    "body 必须是最终可读正文，不要写提纲、占位符、待补充、模拟生成等字样。",
  ].join("\n");
}

export function buildDraftPrompt(context: ArticlePromptContext) {
  return [
    "你是企业内容黑盒生成链路中的首稿生成器。",
    productProfileLines(context.product),
    `目标问题/关键词：${context.keyword}`,
    `GEO AI 平台：${providerLabels[context.searchProvider]}`,
    `发布平台：${platformLabels[context.platform]}`,
    `账号：${context.accountName || "未命名账号"}`,
    `计划发布时间：${context.plannedPublishTime}`,
    "要求：生成一篇面向真实用户问题的完整文章首稿，包含清晰判断、适用边界、选择标准和行动建议。",
    "禁止：固定模板套壳、泛泛营销话术、夸大承诺、虚构案例和内部工序标记。",
    outputSchema(),
  ].join("\n\n");
}

export function buildStyleRewritePrompt(context: ArticlePromptContext) {
  return [
    "你是企业内容黑盒生成链路中的平台风格改写器。",
    productProfileLines(context.product),
    `目标问题/关键词：${context.keyword}`,
    `发布平台：${platformLabels[context.platform]}`,
    "上一版正文：",
    context.previousBody || "",
    "要求：保留事实边界，把文章改写成目标发布平台更自然的表达。标题、开头、段落节奏和 CTA 都必须重写。",
    outputSchema(),
  ].join("\n\n");
}

export function buildDedupeRewritePrompt(context: ArticlePromptContext) {
  return [
    "你是企业内容黑盒生成链路中的降重与差异化改写器。",
    productProfileLines(context.product),
    `目标问题/关键词：${context.keyword}`,
    `发布平台：${platformLabels[context.platform]}`,
    `需要避开的相邻标题：${context.previousTitle || "无"}`,
    `需要避开的相邻开头：${context.previousOpening || "无"}`,
    "上一版正文：",
    context.previousBody || "",
    "要求：必须调整标题句式、开头角度、段落顺序、CTA 和关键词表达，降低同批次相似度。",
    outputSchema(),
  ].join("\n\n");
}

export function buildRiskRewritePrompt(context: ArticlePromptContext) {
  return [
    "你是企业内容黑盒生成链路中的风险语言修正器。",
    productProfileLines(context.product),
    `目标问题/关键词：${context.keyword}`,
    `发布平台：${platformLabels[context.platform]}`,
    "上一版正文：",
    context.previousBody || "",
    "要求：删除绝对化、保证效果、虚构背书、医疗金融法律式承诺等风险表达，保留可核验边界和谨慎语气。",
    outputSchema(),
  ].join("\n\n");
}

export function buildQualityReviewPrompt(context: ArticlePromptContext) {
  return [
    "你是企业内容黑盒生成链路中的最终模型复检器。",
    `目标问题/关键词：${context.keyword}`,
    `发布平台：${platformLabels[context.platform]}`,
    "待复检正文：",
    context.previousBody || "",
    "请判断文章是否像真实文章、是否回答关键词问题、是否仍然模板化、是否存在重复表达或风险语言。",
    outputSchema(),
  ].join("\n\n");
}
