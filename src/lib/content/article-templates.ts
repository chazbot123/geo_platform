import { getPlatformContentRule } from "./platform-content-rules";

export const ARTICLE_TEMPLATE_TYPES = [
  "exclusive_news",
  "ranking_review_test",
  "howto_guide",
  "question_answer",
  "deep_dive",
] as const;

export type ArticleTemplateType = (typeof ARTICLE_TEMPLATE_TYPES)[number];

export interface ArticleTemplateSection {
  heading: string;
  instruction: string;
}

export interface ArticleTemplate {
  type: ArticleTemplateType;
  label: string;
  applicableScenarios: string[];
  sections: ArticleTemplateSection[];
  promptInstruction: string;
}

export interface ArticleTemplateSelectionInput {
  templateType?: ArticleTemplateType;
  contentIntent?: string;
  title?: string;
  question?: string;
  keywords?: string[];
  sequence?: number;
}

export interface RenderArticleTemplateInstructionsInput {
  template: ArticleTemplateType | ArticleTemplate;
  platform?: string | null;
  complianceNotes?: string[];
}

const ARTICLE_TEMPLATES: Record<ArticleTemplateType, ArticleTemplate> = {
  exclusive_news: {
    type: "exclusive_news",
    label: "新闻体独家报道类",
    applicableScenarios: ["新趋势", "平台规则变化", "行业观察", "独家线索解读"],
    sections: [
      { heading: "行业痛点", instruction: "先写清楚当前行业或客户场景中真实存在的卡点，不要用空泛焦虑开场。" },
      { heading: "破局之道", instruction: "说明解决路径、关键机制和为什么这个路径能缓解痛点，避免承诺确定结果。" },
      { heading: "案例解析", instruction: "用可验证或条件化案例拆解过程；没有真实案例时写成场景化示例，并明确边界。" },
      { heading: "行业启示", instruction: "提炼对同类企业、同类账号或同类内容生产流程的启发。" },
      { heading: "得出结论", instruction: "用谨慎结论收束，说明适用条件、下一步检查动作和不能直接套用的情况。" },
    ],
    promptInstruction: "按新闻体独家报道类写作，先事实后判断；不要编造时间、数据、官方口径或独家来源。",
  },
  ranking_review_test: {
    type: "ranking_review_test",
    label: "榜单/评测/实测类",
    applicableScenarios: ["工具对比", "服务商评测", "方案榜单", "实测复盘"],
    sections: [
      { heading: "评测场景", instruction: "先定义谁在什么场景下需要比较，评测不覆盖哪些情况也要说清楚。" },
      { heading: "评测维度", instruction: "列出可验证维度，例如成本、效率、稳定性、内容合规、发布成功率和复用难度。" },
      { heading: "结果对比", instruction: "按维度给出对比观察，不要编造排名、样本量、客户案例或精确数据。" },
      { heading: "结论与建议", instruction: "按预算、阶段、风险承受能力给出选择建议，并保留人工确认边界。" },
    ],
    promptInstruction: "按榜单/评测/实测类写作，必须声明评测口径；不要编造排名、样本量或客户案例。",
  },
  howto_guide: {
    type: "howto_guide",
    label: "攻略指南类",
    applicableScenarios: ["操作步骤", "流程拆解", "落地方法", "避坑指南"],
    sections: [
      { heading: "目标+场景", instruction: "先说明这篇攻略要解决的目标、适用场景和不适用边界。" },
      { heading: "步骤1...N", instruction: "按顺序写可执行步骤，每一步都要包含动作、目的、产出和检查点。" },
      { heading: "实际结果", instruction: "说明完成后应该看到什么变化、如何验收，以及哪些结果不能被保证。" },
    ],
    promptInstruction: "按攻略指南类写作，突出步骤、检查项和边界；不要编造效果承诺、平台结果或固定收益。",
  },
  question_answer: {
    type: "question_answer",
    label: "问题解答类",
    applicableScenarios: ["搜索问答", "客户疑问", "异议处理", "FAQ扩展"],
    sections: [
      { heading: "提问", instruction: "保留客户问题的核心意思，但不要把完整长问题当成平台标签。" },
      { heading: "回答", instruction: "先给条件化直接回答，说明可以做、暂不建议做或需要补充判断的条件。" },
      { heading: "事实+数据", instruction: "只使用可验证事实、已有资料或条件化判断；没有数据时明确写成观察口径，不要编造。" },
      { heading: "行动方案", instruction: "给出下一步检查、咨询、复盘或重新生成的动作，形成闭环。" },
    ],
    promptInstruction: "按问题解答类写作，先回答再展开；不要编造确定性结果或替读者下绝对结论。",
  },
  deep_dive: {
    type: "deep_dive",
    label: "深度专题类",
    applicableScenarios: ["行业专题", "商业闭环分析", "方法论拆解", "长期策略"],
    sections: [
      { heading: "问题背景", instruction: "说明专题要解决的核心矛盾和读者所处阶段。" },
      { heading: "原因", instruction: "拆解问题出现的原因，从平台规则、内容质量、账号节奏、合规边界等维度分析。" },
      { heading: "方法框架", instruction: "给出可复用的分析框架、判断标准和执行顺序，不要编造行业共识。" },
      { heading: "执行清单", instruction: "把分析收束为可检查的任务清单、责任边界和复盘指标。" },
    ],
    promptInstruction: "按深度专题类写作，保留逻辑链和证据边界；不要编造权威结论或不可验证案例。",
  },
};

export function getArticleTemplate(type: ArticleTemplateType): ArticleTemplate {
  return ARTICLE_TEMPLATES[type];
}

export function selectArticleTemplate(input: ArticleTemplateSelectionInput = {}): ArticleTemplate {
  if (input.templateType) {
    return getArticleTemplate(input.templateType);
  }

  const haystack = [input.contentIntent, input.title, input.question, ...(input.keywords ?? [])].filter(Boolean).join(" ");

  if (/(news|新闻|独家|报道|最新|规则变化)/iu.test(haystack)) return getArticleTemplate("exclusive_news");
  if (/(review|ranking|评测|实测|榜单|对比|排行)/iu.test(haystack)) return getArticleTemplate("ranking_review_test");
  if (/(guide|howto|攻略|指南|步骤|流程|怎么做|落地)/iu.test(haystack)) return getArticleTemplate("howto_guide");
  if (/[?？]/u.test(input.question ?? "") || /(问答|问题|适合吗|靠谱吗|是什么|为什么)/u.test(haystack)) {
    if (input.sequence && input.sequence > 1) {
      const rotatedQuestionTemplates: ArticleTemplateType[] = ["question_answer", "deep_dive", "howto_guide"];
      return getArticleTemplate(rotatedQuestionTemplates[(input.sequence - 1) % rotatedQuestionTemplates.length]);
    }
    return getArticleTemplate("question_answer");
  }

  return getArticleTemplate("deep_dive");
}

export function renderArticleTemplateInstructions(input: RenderArticleTemplateInstructionsInput): string {
  const template = typeof input.template === "string" ? getArticleTemplate(input.template) : input.template;
  const platformRule = getPlatformContentRule(input.platform);
  const complianceNotes = input.complianceNotes?.length ? input.complianceNotes.join("；") : "遵守平台合规要求和效果表达边界。";

  return [
    `文章模板：${template.label}`,
    `目标平台：${platformRule.label}`,
    `适用场景：${template.applicableScenarios.join("、")}`,
    "结构段落：",
    ...template.sections.map((section, index) => `${index + 1}. ${section.heading}：${section.instruction}`),
    `Prompt指令：${template.promptInstruction}`,
    `平台风格：${platformRule.stylePrompt}`,
    `合规要求：${complianceNotes}`,
  ].join("\n");
}
