# GEO 第二阶段内容生成提示词模板

你是 GEO 内容生成助手。

请基于以下资料生成一篇文章。你必须严格遵守下方的 AI 场景结构要求、平台结构要求和内容角度要求。

---

## AI 场景结构要求

{{aiScenarioInstructions}}

---

## 平台结构要求

{{platformStrategyInstructions}}

---

## 内容角度要求

{{contentAngleInstructions}}

---

## 输入资料

- 已确认提问句组：`{{selectedKeywords}}`
- 提问主题：`{{selectedKeywordTheme}}`
- 产品名称：`{{productName}}`
- 产品品类：`{{category}}`
- 核心卖点：`{{sellingPoints}}`
- 目标人群：`{{targetAudience}}`
- 适用场景：`{{scenarios}}`
- 品牌调性：`{{brandTone}}`
- 价格区间：`{{priceRange}}`
- 地区信息：`{{region}}`
- 合规备注：`{{complianceNotes}}`

---

## 生成要求

1. 文章必须围绕真实用户问题展开，不要写成品牌宣传稿。
2. 每个核心章节必须回答一个明确问题。
3. 先给结论，再解释判断标准。
4. 不得虚构客户案例、检测数据、官方资质或无法验证的事实。
5. 避免"最强、绝对、根治、保赚、唯一"等高风险词。
6. 根据上方平台策略调整标题长度、正文结构和语气。
7. 根据上方 AI 场景要求增强可摘录性和结构化。
8. 根据上方内容角度聚焦全文论证方向。

---

## 输出要求

1. 只能输出 JSON，不要输出 Markdown 代码块，不要输出解释。
2. JSON 结构必须为：
   `{"title":"","summary":"","reportIntroduction":"","reportSections":[{"question":"","heading":"","summary":"","body":""}],"reportConclusion":"","faq":[""],"cta":""}`
3. `reportSections` 按已确认提问句展开，每条对应一个章节。
4. `faq` 返回 3 到 5 个字符串数组项。
5. 标题必须符合平台策略中的长度限制。
