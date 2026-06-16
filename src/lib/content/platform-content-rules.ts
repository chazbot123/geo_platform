export type SupportedPlatformContentRule = "xiaohongshu" | "douyin" | "videohao" | "wechat" | "default";

export interface PlatformContentRule {
  platform: SupportedPlatformContentRule;
  label: string;
  title: {
    maxLength: number;
  };
  body: {
    recommendedMinLength: number;
    recommendedMaxLength: number;
    hardMaxLength: number;
  };
  topicTags: {
    maxCount: number;
    maxLength: number;
    cleanPatternDescription: string;
  };
  stylePrompt: string;
  compliancePrompt: string;
  publishRiskTips: string[];
}

const PLATFORM_CONTENT_RULES: Record<SupportedPlatformContentRule, PlatformContentRule> = {
  xiaohongshu: {
    platform: "xiaohongshu",
    label: "小红书",
    title: { maxLength: 20 },
    body: {
      recommendedMinLength: 120,
      recommendedMaxLength: 800,
      hardMaxLength: 1000,
    },
    topicTags: {
      maxCount: 8,
      maxLength: 20,
      cleanPatternDescription: "移除 #、@、链接、空白和中英文标点，保留可搜索的短词组。",
    },
    stylePrompt: "用真实体验、场景判断、避坑提醒和口语化表达组织内容，避免报告腔。",
    compliancePrompt: "不要承诺确定性排名、收录或转化结果，不要使用绝对化疗效式表达。",
    publishRiskTips: ["避免极限承诺和夸大收益", "避免把内部追踪编号、报告口吻直接放入正文", "图文笔记需保留可读分段和话题边界"],
  },
  douyin: {
    platform: "douyin",
    label: "抖音",
    title: { maxLength: 24 },
    body: {
      recommendedMinLength: 80,
      recommendedMaxLength: 300,
      hardMaxLength: 500,
    },
    topicTags: {
      maxCount: 5,
      maxLength: 12,
      cleanPatternDescription: "移除链接、账号符号和标点，将长问题拆为短搜索词。",
    },
    stylePrompt: "优先使用前三秒钩子、短句口播、问题反转和明确行动提示。",
    compliancePrompt: "不要承诺流量、排名或成交，不要暗示平台官方背书。",
    publishRiskTips: ["短视频文案需避免堆砌关键词", "避免诱导互动和绝对化效果承诺", "话题应短而可搜索"],
  },
  videohao: {
    platform: "videohao",
    label: "视频号",
    title: { maxLength: 24 },
    body: {
      recommendedMinLength: 100,
      recommendedMaxLength: 500,
      hardMaxLength: 800,
    },
    topicTags: {
      maxCount: 5,
      maxLength: 12,
      cleanPatternDescription: "清理标点和链接，保留适合视频号搜索分发的短标签。",
    },
    stylePrompt: "使用克制可信的口播结构，先给判断，再给依据和下一步建议。",
    compliancePrompt: "不要承诺确定性排名、流量增长或平台推荐，不要制造焦虑。",
    publishRiskTips: ["避免标题党和过度营销", "避免无依据的数据承诺", "视频号话题不要使用长句问题"],
  },
  wechat: {
    platform: "wechat",
    label: "微信公众号",
    title: { maxLength: 64 },
    body: {
      recommendedMinLength: 800,
      recommendedMaxLength: 2500,
      hardMaxLength: 20000,
    },
    topicTags: {
      maxCount: 6,
      maxLength: 20,
      cleanPatternDescription: "清理链接和无效符号，保留栏目化、专题化短标签。",
    },
    stylePrompt: "使用完整逻辑、分层小标题、案例边界和结论摘要，适合深度阅读。",
    compliancePrompt: "不要承诺确定性排名、收录或成交结果，涉及效果时必须说明适用条件。",
    publishRiskTips: ["避免未经证实的行业数据", "避免把客户原始问题直接作为话题", "长文需保留风险边界和适用场景"],
  },
  default: {
    platform: "default",
    label: "公众号/默认",
    title: { maxLength: 64 },
    body: {
      recommendedMinLength: 600,
      recommendedMaxLength: 2200,
      hardMaxLength: 12000,
    },
    topicTags: {
      maxCount: 6,
      maxLength: 20,
      cleanPatternDescription: "移除话题符号、链接和标点，保留短词组。",
    },
    stylePrompt: "使用清晰结构、谨慎判断和可复用段落，兼容图文长内容。",
    compliancePrompt: "不要承诺确定性排名、收录、流量或成交结果。",
    publishRiskTips: ["避免绝对化表达", "避免长问题直接变成 tag", "发布前检查标题、正文和话题长度"],
  },
};

const PLATFORM_ALIASES: Record<string, SupportedPlatformContentRule> = {
  xhs: "xiaohongshu",
  rednote: "xiaohongshu",
  "小红书": "xiaohongshu",
  douyin: "douyin",
  "抖音": "douyin",
  videohao: "videohao",
  channels: "videohao",
  "视频号": "videohao",
  wechat: "wechat",
  wechat_mp: "wechat",
  "公众号": "wechat",
  "微信公众号": "wechat",
};

export function getPlatformContentRule(platform?: string | null): PlatformContentRule {
  const key = platform?.trim().toLowerCase();
  const resolved = key ? PLATFORM_ALIASES[key] ?? (key as SupportedPlatformContentRule) : "default";

  if (resolved in PLATFORM_CONTENT_RULES) {
    return PLATFORM_CONTENT_RULES[resolved];
  }

  return PLATFORM_CONTENT_RULES.default;
}

export function normalizePlatformTopicTags(input: string | string[] | null | undefined, platform?: string | null): string[] {
  const rule = getPlatformContentRule(platform);
  const rawItems = Array.isArray(input) ? input : input ? [input] : [];
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    const candidates = shouldSplitAsQuestion(rawItem, rule)
      ? splitQuestionIntoTopicCandidates(rawItem)
      : [rawItem];

    for (const candidate of candidates) {
      const cleaned = cleanTopicTag(candidate, rule.topicTags.maxLength);
      if (!cleaned) continue;

      const dedupeKey = cleaned.toLowerCase();
      if (seen.has(dedupeKey)) continue;

      seen.add(dedupeKey);
      normalized.push(cleaned);

      if (normalized.length >= rule.topicTags.maxCount) {
        return normalized;
      }
    }
  }

  return normalized;
}

function shouldSplitAsQuestion(value: string, rule: PlatformContentRule): boolean {
  const withoutUrl = stripUrls(value).trim();
  return /[?？]/u.test(withoutUrl) && withoutUrl.length > rule.topicTags.maxLength + 8;
}

function splitQuestionIntoTopicCandidates(question: string): string[] {
  const text = stripUrls(question)
    .replace(/^(客户问|用户问|问题|提问)\s*[：:]/u, "")
    .replace(/[?？!！。；;，,、]/gu, " ");
  const candidates: string[] = [];

  const audienceMatch = text.match(/([\u4e00-\u9fa5]{2,6}(?:企业|公司|商家|门店))/u);
  if (audienceMatch) candidates.push(audienceMatch[1]);
  if (/GEO\s*优化/i.test(text)) candidates.push("GEO优化");
  if (/服务商/u.test(text) && /(靠谱|判断|选择|筛选)/u.test(text)) candidates.push("服务商靠谱");
  if (/案例/u.test(text) && /风险/u.test(text)) candidates.push("案例风险");

  for (const chunk of text.split(/\s+/u)) {
    const compact = chunk.replace(/(怎么|如何|是否|需要|哪些|判断|客户|用户|可以|应该|做)/gu, "");
    if (compact.length >= 2 && compact.length <= 8) {
      candidates.push(compact);
    }
  }

  return candidates;
}

function cleanTopicTag(value: string, maxLength: number): string {
  const withoutUrl = stripUrls(value);
  if (!withoutUrl.trim()) return "";
  if (withoutUrl.trim().startsWith("@")) return "";

  return withoutUrl
    .replace(/^#+/u, "")
    .replace(/[@#/\s\\|?？!！,，.。:：;；"'“”‘’、()[\]{}【】<>《》]+/gu, "")
    .slice(0, maxLength)
    .trim();
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/giu, "").replace(/www\.\S+/giu, "");
}
