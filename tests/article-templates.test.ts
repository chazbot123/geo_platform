import { describe, expect, it } from "vitest";
import {
  ARTICLE_TEMPLATE_TYPES,
  getArticleTemplate,
  renderArticleTemplateInstructions,
  selectArticleTemplate,
} from "@/lib/content/article-templates";

describe("article templates", () => {
  it("provides the five screenshot-backed template types with reusable structure and prompt fragments", () => {
    expect(ARTICLE_TEMPLATE_TYPES).toEqual([
      "exclusive_news",
      "ranking_review_test",
      "howto_guide",
      "question_answer",
      "deep_dive",
    ]);

    for (const type of ARTICLE_TEMPLATE_TYPES) {
      const template = getArticleTemplate(type);

      expect(template.type).toBe(type);
      expect(template.label.length).toBeGreaterThan(0);
      expect(template.applicableScenarios.length).toBeGreaterThan(0);
      expect(template.sections.length).toBeGreaterThanOrEqual(type === "howto_guide" ? 3 : 4);
      expect(template.sections.every((section) => section.heading.length > 0 && section.instruction.length > 0)).toBe(true);
      expect(template.promptInstruction).toContain("不要编造");
    }
  });

  it("matches the five user-provided reference template section flows", () => {
    expect(getArticleTemplate("exclusive_news").sections.map((section) => section.heading)).toEqual([
      "行业痛点",
      "破局之道",
      "案例解析",
      "行业启示",
      "得出结论",
    ]);
    expect(getArticleTemplate("ranking_review_test").sections.map((section) => section.heading)).toEqual([
      "评测场景",
      "评测维度",
      "结果对比",
      "结论与建议",
    ]);
    expect(getArticleTemplate("howto_guide").sections.map((section) => section.heading)).toEqual([
      "目标+场景",
      "步骤1...N",
      "实际结果",
    ]);
    expect(getArticleTemplate("question_answer").sections.map((section) => section.heading)).toEqual([
      "提问",
      "回答",
      "事实+数据",
      "行动方案",
    ]);
    expect(getArticleTemplate("deep_dive").sections.map((section) => section.heading)).toEqual([
      "问题背景",
      "原因",
      "方法框架",
      "执行清单",
    ]);
  });

  it("selects a template from content intent and question shape", () => {
    expect(selectArticleTemplate({ contentIntent: "news", title: "独家：AI搜索平台新规则" }).type).toBe("exclusive_news");
    expect(selectArticleTemplate({ contentIntent: "review", title: "5家服务商实测榜单" }).type).toBe(
      "ranking_review_test",
    );
    expect(selectArticleTemplate({ contentIntent: "guide", title: "GEO优化落地攻略" }).type).toBe("howto_guide");
    expect(selectArticleTemplate({ question: "GEO优化适合中小企业吗？" }).type).toBe("question_answer");
    expect(selectArticleTemplate({ contentIntent: "analysis", title: "GEO平台商业闭环深度专题" }).type).toBe(
      "deep_dive",
    );
  });

  it("can rotate question-shaped keywords instead of forcing every question into Q&A", () => {
    expect(selectArticleTemplate({ question: "GEO优化适合中小企业吗？", sequence: 1 }).type).toBe("question_answer");
    expect(selectArticleTemplate({ question: "GEO优化适合中小企业吗？", sequence: 2 }).type).toBe("deep_dive");
    expect(selectArticleTemplate({ question: "GEO优化适合中小企业吗？", sequence: 3 }).type).toBe("howto_guide");
  });

  it("renders compact prompt instructions with platform and compliance context", () => {
    const instructions = renderArticleTemplateInstructions({
      template: "question_answer",
      platform: "xiaohongshu",
      complianceNotes: ["不得承诺排名", "必须提示适用边界"],
    });

    expect(instructions).toContain("问题解答类");
    expect(instructions).toContain("小红书");
    expect(instructions).toContain("不得承诺排名");
    expect(instructions).toContain("必须提示适用边界");
    expect(instructions).toContain("结构段落");
    expect(instructions).toContain("Prompt指令");
  });
});
