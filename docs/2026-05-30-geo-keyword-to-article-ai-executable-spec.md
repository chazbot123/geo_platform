# GEO 关键词生成与文章生成 AI 可执行技术规格

日期：2026-05-30  
适用对象：AI Agent、提示词编排器、内容生成服务、研发实现者、内容运营  
目标 AI 场景：豆包、元宝、DeepSeek、通义千问  
关联文档：

- `docs/superpowers/specs/2026-05-29-geo-prompt-core-design.md`
- `docs/superpowers/specs/2026-05-30-geo-keyword-to-article-logic-design.md`

## 1. 执行目标

本规格定义一个可由 AI Agent 或工程服务执行的 GEO 内容生成流程。流程从产品资料开始，生成适合中国大陆主流 AI 问答场景的用户提问句，再把已确认提问句转换为可发布文章。

本规格中的“关键词”统一按 `questionCandidate` 处理。任何执行者不得把关键词理解为孤立短词、SEO 词根或堆砌词。

执行终态是生成一个 `publishableArticlePackage`，包含：

- 经过质检的文章草稿。
- 与文章绑定的提问句包。
- AI 场景策略。
- 发布平台策略。
- 可信追踪信息。
- 质检报告。
- 相似性风险报告。

## 2. 执行者规则

### 2.1 必须遵守

执行者必须：

1. 只基于输入资料、可推导常识和明确标注的外部资料生成内容。
2. 对无法确认的事实输出“需要进一步确认”，不得编造。
3. 把第一阶段产物输出为完整问题，不得输出孤立关键词。
4. 让每个文章核心章节回答一个已确认问题。
5. 对每个判断给出依据边界。
6. 对高风险承诺、虚构案例、虚构数据、虚构资质执行阻断。
7. 输出符合 schema 的 JSON，不得在 JSON 外输出解释。
8. 在 `warnings` 中记录可疑但不阻断的问题。
9. 在 `blockingIssues` 中记录必须修复的问题。
10. 在重试时说明重试原因和改动方向。

### 2.2 禁止行为

执行者不得：

- 承诺内容会被豆包、元宝、DeepSeek、通义千问引用。
- 声称掌握上述平台的内部排序、抓取或引用规则。
- 通过同义词替换制造差异。
- 为了关键词密度重复同一词。
- 虚构客户案例、检测数据、排名、认证、官方背书。
- 生成“最好、第一、唯一、保证、根治、稳赚、永久有效”等绝对化承诺。
- 将内部 hash、PGP 签名、PHP 注释写入第三方平台正文。
- 将广告客服式 FAQ 伪装成真实用户追问。

## 3. 全局枚举

### 3.1 AI 场景枚举

```json
[
  "doubao_plain_answer",
  "yuanbao_qa_chain",
  "deepseek_logic",
  "tongyi_structured_summary"
]
```

含义：

| 值 | 平台 | 主要生成目标 |
| --- | --- | --- |
| `doubao_plain_answer` | 豆包 | 普通用户能直接理解的答疑内容 |
| `yuanbao_qa_chain` | 元宝 | 高频问答、连续追问、避坑链路 |
| `deepseek_logic` | DeepSeek | 逻辑判断、维度分析、边界推理 |
| `tongyi_structured_summary` | 通义千问 | 结构化总结、流程方案、对比建议 |

### 3.2 发布平台枚举

```json
[
  "blog",
  "wechat",
  "toutiao",
  "xiaohongshu",
  "douyin"
]
```

### 3.3 问题意图枚举

```json
[
  "selection_criteria",
  "pitfall_avoidance",
  "price_logic",
  "scenario_fit",
  "comparison",
  "local_service",
  "faq_cluster",
  "risk_boundary",
  "process_solution",
  "evidence_check"
]
```

### 3.4 风险等级枚举

```json
["low", "medium", "high"]
```

### 3.5 改写等级枚举

```json
["none", "L1", "L2", "L3"]
```

定义：

| 等级 | 含义 | 允许动作 |
| --- | --- | --- |
| `none` | 无需改写 | 进入下一阶段 |
| `L1` | 轻微修正 | 调整措辞、补字段、补风险提示 |
| `L2` | 结构改写 | 改标题结构、章节顺序、FAQ、CTA |
| `L3` | 重新生成 | 重新选择 intent、contentAngle 或问题组合 |

## 4. 总体状态机

### 4.1 状态定义

```text
S0_INPUT_RECEIVED
S1_PROFILE_NORMALIZED
S2_QUESTION_CANDIDATES_GENERATED
S3_QUESTION_CANDIDATES_REVIEWED
S4_QUESTION_BUNDLE_SELECTED
S5_ARTICLE_BRIEF_CREATED
S6_AI_STRUCTURE_PLANNED
S7_PLATFORM_STRUCTURE_PLANNED
S8_SIMILARITY_DISPERSION_PLANNED
S9_ARTICLE_DRAFTED
S10_TRUST_MARKER_ATTACHED
S11_ARTICLE_REVIEWED
S12_PUBLISHABLE_PACKAGE_CREATED
S_BLOCKED
```

### 4.2 状态转移

```text
S0 -> S1: normalizeProductProfile()
S1 -> S2: generateQuestionCandidates()
S2 -> S3: reviewQuestionCandidates()
S3 -> S4: selectQuestionBundle()
S4 -> S5: createArticleBrief()
S5 -> S6: planAiReadableStructure()
S6 -> S7: planPlatformStructure()
S7 -> S8: planSimilarityDispersion()
S8 -> S9: draftArticle()
S9 -> S10: attachTrustMarker()
S10 -> S11: reviewArticle()
S11 -> S12: createPublishablePackage()
```

失败转移：

```text
S2 -> S1: generated questions are invalid
S3 -> S2: question coverage or quality failed
S4 -> S2: selected bundle cannot form an article
S9 -> S8: similarity risk medium or high
S11 -> S9: article has fixable issues
S11 -> S8: article similarity high
ANY -> S_BLOCKED: missing required input or unsafe request
```

## 5. 顶层输入 schema

```json
{
  "task": {
    "taskId": "string",
    "createdAt": "ISO-8601 string",
    "operator": "string",
    "targetAiScenarios": [
      "doubao_plain_answer"
    ],
    "targetPlatform": "blog",
    "outputLanguage": "zh-CN"
  },
  "rawProductInput": {
    "productName": "string",
    "category": "string",
    "region": "string",
    "targetAudience": "string",
    "sellingPoints": ["string"],
    "usageScenarios": ["string"],
    "serviceProcess": ["string"],
    "pricingFactors": ["string"],
    "deliveryCapabilities": ["string"],
    "materials": ["string"],
    "complianceNotes": ["string"],
    "forbiddenClaims": ["string"]
  },
  "history": {
    "questions": [],
    "articles": [],
    "titles": [],
    "faqQuestions": [],
    "angles": []
  },
  "operatorPreferences": {
    "questionCount": 10,
    "selectedQuestionCount": 5,
    "preferredIntents": [],
    "blockedIntents": [],
    "preferredTone": "",
    "manualMustCover": [],
    "manualMustAvoid": []
  }
}
```

## 6. 顶层输出 schema

```json
{
  "packageVersion": "geo-keyword-article-exec-v1",
  "taskId": "",
  "status": "passed | needs_revision | blocked",
  "productProfile": {},
  "questionCandidateSet": {},
  "selectedQuestionBundle": {},
  "articleBrief": {},
  "aiStructurePlan": {},
  "platformStructurePlan": {},
  "similarityPlan": {},
  "articleDraft": {},
  "trustMarker": {},
  "reviews": {
    "questionReview": {},
    "articleReview": {},
    "similarityReview": {}
  },
  "publishableArticlePackage": {},
  "blockingIssues": [],
  "warnings": [],
  "trace": {
    "generatedAt": "",
    "promptVersions": {},
    "strategyVersions": {}
  }
}
```

## 7. 模块 1：产品资料归一化

### 7.1 模块名

`normalize_product_profile`

### 7.2 输入

`rawProductInput`

### 7.3 输出 schema

```json
{
  "module": "normalize_product_profile",
  "passed": true,
  "productProfile": {
    "taskId": "",
    "productName": "",
    "category": "",
    "region": "",
    "targetAudience": "",
    "readerRoles": [],
    "sellingPoints": [],
    "usageScenarios": [],
    "serviceProcess": [],
    "pricingFactors": [],
    "deliveryCapabilities": [],
    "evidenceMaterials": [
      {
        "id": "",
        "type": "user_input | document | public_source | internal_note",
        "content": "",
        "canBePubliclyClaimed": false,
        "riskNote": ""
      }
    ],
    "complianceNotes": [],
    "forbiddenClaims": [],
    "unknowns": []
  },
  "blockingIssues": [],
  "warnings": []
}
```

### 7.4 归一化规则

执行者必须：

1. 将空字符串、重复项、无意义口号从数组字段中删除。
2. 将“卖点”拆成可验证卖点和不可验证承诺。
3. 将不确定信息写入 `unknowns`。
4. 如果 `category` 为空，阻断。
5. 如果 `targetAudience` 为空，使用“潜在用户”作为默认值，并写入 warning。
6. 如果 `region` 为空，不得强行编造地区。

### 7.5 阻断条件

```json
[
  "MISSING_CATEGORY",
  "UNSAFE_PRODUCT_REQUEST",
  "INSUFFICIENT_PRODUCT_CONTEXT"
]
```

## 8. 模块 2：提问句候选生成

### 8.1 模块名

`generate_question_candidates`

### 8.2 输入

```json
{
  "productProfile": {},
  "targetAiScenarios": [],
  "targetPlatform": "",
  "history": {},
  "operatorPreferences": {}
}
```

### 8.3 输出 schema

```json
{
  "module": "generate_question_candidates",
  "passed": true,
  "mainQuestion": "",
  "questionCandidates": [
    {
      "id": "q1",
      "question": "",
      "intent": "selection_criteria",
      "targetAiScenarios": [],
      "contentAngle": "",
      "userRole": "",
      "regionUsage": "explicit | implicit | none",
      "commercialStage": "awareness | comparison | decision | retention",
      "mustAnswer": [],
      "evidenceNeeded": [],
      "riskNotes": [],
      "generationRationale": "",
      "scores": {
        "userRealness": 0,
        "commercialValue": 0,
        "aiAnswerability": 0,
        "platformExtensibility": 0,
        "novelty": 0,
        "riskControl": 0,
        "total": 0
      }
    }
  ],
  "coverage": {
    "coveredIntents": [],
    "coveredAiScenarios": [],
    "coveredReaderRoles": [],
    "missingImportantAngles": []
  },
  "blockingIssues": [],
  "warnings": []
}
```

### 8.4 生成算法

执行者按顺序执行：

1. 从 `productProfile` 提取 `categoryTerm`、`regionTerm`、`audienceTerm`、`scenarioTerms`、`riskTerms`、`priceTerms`、`processTerms`。
2. 根据 `targetAiScenarios` 选择问题模板。
3. 每个目标 AI 场景至少生成 2 条问题，除非目标场景只有 1 个。
4. 从 intent 库中选择至少 4 种 intent。
5. 生成不少于 `operatorPreferences.questionCount` 的候选草案。
6. 删除孤立词、广告标题、不可回答问题和重复问题。
7. 对剩余问题评分。
8. 取总分最高且 intent 分布合理的候选。

### 8.5 AI 场景问题模板

```json
{
  "doubao_plain_answer": [
    "{category}怎么选比较靠谱？",
    "{targetAudience}第一次了解{category}要注意什么？",
    "{category}适合哪些场景，不适合哪些情况？"
  ],
  "yuanbao_qa_chain": [
    "找{category}时最容易踩哪些坑？",
    "了解{category}前应该先问清楚哪些问题？",
    "{category}有哪些常见误区？"
  ],
  "deepseek_logic": [
    "判断{category}是否靠谱应该看哪些维度？",
    "{category}和其他常见方案相比应该怎么选？",
    "{category}的风险边界是什么？"
  ],
  "tongyi_structured_summary": [
    "{category}从咨询到交付的流程是什么？",
    "{category}的方案应该包含哪些步骤？",
    "如何系统比较不同{category}方案？"
  ]
}
```

如果模板变量缺失，执行者必须改写问题，不得输出未替换的占位符。

### 8.6 评分规则

每项 0 到 5 分。

| 字段 | 5 分标准 | 0 分标准 |
| --- | --- | --- |
| `userRealness` | 像真实用户会直接输入 AI 的问题 | 像广告标题或内部术语 |
| `commercialValue` | 能推动选择、比较、咨询或购买决策 | 只是泛泛科普 |
| `aiAnswerability` | 可以被结构化回答 | 太窄、太虚或不可回答 |
| `platformExtensibility` | 能扩展到文章、FAQ、平台改写 | 只能写一句话 |
| `novelty` | 与历史问题角度明显不同 | 只是替换词 |
| `riskControl` | 不诱导夸大或编造事实 | 暗含承诺或排名 |

总分：

```text
total = userRealness * 1.2
      + commercialValue * 1.0
      + aiAnswerability * 1.2
      + platformExtensibility * 0.8
      + novelty * 1.0
      + riskControl * 1.3
```

## 9. 模块 3：提问句质检

### 9.1 模块名

`review_question_candidates`

### 9.2 输出 schema

```json
{
  "module": "review_question_candidates",
  "passed": true,
  "validQuestionIds": [],
  "invalidQuestionIds": [],
  "blockingIssues": [
    {
      "code": "",
      "questionId": "",
      "message": "",
      "fix": ""
    }
  ],
  "warnings": [],
  "coverageReview": {
    "hasEnoughQuestions": true,
    "intentCount": 0,
    "aiScenarioCount": 0,
    "hasMainDecisionQuestion": true,
    "hasRiskOrPitfallQuestion": true,
    "hasProcessOrScenarioQuestion": true
  }
}
```

### 9.3 阻断码

```json
[
  "NOT_A_FULL_QUESTION",
  "DUPLICATE_QUESTION",
  "UNANSWERABLE_QUESTION",
  "UNVERIFIABLE_SUPERLATIVE",
  "AD_LIKE_QUESTION",
  "TOO_NARROW_FOR_ARTICLE",
  "MISSING_INTENT",
  "MISSING_AI_SCENARIO"
]
```

质检通过条件：

- 至少 8 条有效问题。
- 至少 4 种 intent。
- 至少覆盖目标 AI 场景。
- 没有 high risk 问题。
- 没有占位符。

## 10. 模块 4：提问句包选择

### 10.1 模块名

`select_question_bundle`

### 10.2 输出 schema

```json
{
  "module": "select_question_bundle",
  "passed": true,
  "selectedQuestionBundle": {
    "bundleId": "",
    "mainQuestion": {
      "id": "",
      "question": "",
      "intent": "",
      "contentAngle": ""
    },
    "supportingQuestions": [
      {
        "id": "",
        "question": "",
        "intent": "",
        "sectionRole": "criteria | risk | process | comparison | scenario | evidence"
      }
    ],
    "followUpQuestions": [
      {
        "id": "",
        "question": "",
        "faqRole": "clarification | objection | next_step | boundary"
      }
    ],
    "primaryAiScenario": "",
    "secondaryAiScenarios": [],
    "primaryAngle": "",
    "readerRole": "",
    "selectionReason": "",
    "riskNotes": []
  },
  "rejectedQuestionIds": [],
  "blockingIssues": [],
  "warnings": []
}
```

### 10.3 选择规则

执行者必须：

1. 选择 1 个主问题。
2. 选择 2 到 4 个辅助问题。
3. 选择 1 到 3 个追问。
4. 主问题必须能作为文章标题基础。
5. 辅助问题之间 intent 不得完全相同。
6. 如果目标是 `deepseek_logic`，必须包含 `selection_criteria`、`risk_boundary` 或 `comparison` 中至少一个。
7. 如果目标是 `yuanbao_qa_chain`，必须包含 `pitfall_avoidance` 或 `faq_cluster`。
8. 如果目标是 `tongyi_structured_summary`，必须包含 `process_solution` 或 `comparison`。
9. 如果目标是 `doubao_plain_answer`，必须包含普通用户能理解的直接问法。

## 11. 模块 5：文章 brief 生成

### 11.1 模块名

`create_article_brief`

### 11.2 输出 schema

```json
{
  "module": "create_article_brief",
  "passed": true,
  "articleBrief": {
    "briefId": "",
    "taskId": "",
    "productProfile": {},
    "selectedQuestionBundle": {},
    "targetPlatform": "",
    "primaryAiScenario": "",
    "contentGoal": "",
    "readerRole": "",
    "mustCover": [],
    "mustAvoid": [],
    "evidenceBoundaries": [
      {
        "claimArea": "",
        "allowedEvidence": [],
        "mustUseCautiousLanguage": true
      }
    ],
    "draftConstraints": {
      "mustUseAnswerBlocks": true,
      "mustIncludeRiskNotes": true,
      "mustIncludeEvidenceBoundary": true,
      "allowMarkdownTable": true,
      "maxTitleLength": null
    }
  },
  "blockingIssues": [],
  "warnings": []
}
```

### 11.3 brief 生成规则

执行者必须把每个已确认问题映射到 `mustCover`。

```json
{
  "questionId": "",
  "question": "",
  "requiredArticleUnit": "title | summary | answerBlock | faq",
  "minimumAnswerRequirements": [
    "directAnswer",
    "decisionCriteria",
    "riskNotes",
    "evidenceBoundary"
  ]
}
```

## 12. 模块 6：AI 可读结构规划

### 12.1 模块名

`plan_ai_readable_structure`

### 12.2 输出 schema

```json
{
  "module": "plan_ai_readable_structure",
  "passed": true,
  "aiStructurePlan": {
    "aiScenario": "",
    "titleStrategy": "",
    "summaryStrategy": "",
    "answerBlockStrategy": "",
    "faqStrategy": "",
    "requiredSections": [
      {
        "questionId": "",
        "headingIntent": "",
        "answerDepth": "short | medium | deep",
        "mustInclude": []
      }
    ],
    "styleConstraints": [],
    "avoidPatterns": []
  },
  "blockingIssues": [],
  "warnings": []
}
```

### 12.3 AI 场景策略

#### 豆包

```json
{
  "answerDepth": "medium",
  "styleConstraints": ["口语清楚", "少术语", "先结论", "短段落"],
  "requiredUnits": ["directAnswer", "checklist", "nextStep"],
  "avoidPatterns": ["研究报告腔", "长推理", "术语堆砌"]
}
```

#### 元宝

```json
{
  "answerDepth": "medium",
  "styleConstraints": ["问答链路", "追问自然", "避坑明确"],
  "requiredUnits": ["directAnswer", "followUpQuestions", "pitfallNotes"],
  "avoidPatterns": ["广告式FAQ", "答非所问", "没有相关追问"]
}
```

#### DeepSeek

```json
{
  "answerDepth": "deep",
  "styleConstraints": ["定义清楚", "维度完整", "边界明确", "推理链稳定"],
  "requiredUnits": ["definition", "decisionCriteria", "analysis", "riskBoundary"],
  "avoidPatterns": ["只给结论", "无依据判断", "情绪化营销"]
}
```

#### 通义千问

```json
{
  "answerDepth": "deep",
  "styleConstraints": ["层级稳定", "步骤清楚", "适合总结", "适合对比"],
  "requiredUnits": ["background", "keyPoints", "steps", "comparison", "summary"],
  "avoidPatterns": ["段落过长", "层级跳跃", "结论分散"]
}
```

## 13. 模块 7：发布平台结构规划

### 13.1 模块名

`plan_platform_structure`

### 13.2 输出 schema

```json
{
  "module": "plan_platform_structure",
  "passed": true,
  "platformStructurePlan": {
    "platform": "",
    "title": {
      "maxLength": null,
      "patternsAllowed": [],
      "patternsBlocked": []
    },
    "body": {
      "paragraphLength": "short | medium | long",
      "headingStyle": "",
      "allowMarkdownTable": true,
      "allowFaq": true,
      "ctaStyle": ""
    },
    "metadata": {
      "allowPublicTraceId": false,
      "allowTimestamp": false,
      "allowFullHash": false
    },
    "mustTransform": [],
    "mustAvoid": []
  },
  "blockingIssues": [],
  "warnings": []
}
```

### 13.3 平台策略

| platform | 结构策略 |
| --- | --- |
| `blog` | 保留 H1/H2/H3、摘要、FAQ、元描述、更新时间、结构化字段 |
| `wechat` | 加强引言、观点、小结、行动建议，保留逻辑链 |
| `toutiao` | 缩短段落，强化钩子、判断点、避坑清单 |
| `xiaohongshu` | 转成场景经验、清单、避坑，不写报告腔 |
| `douyin` | 转成口播脚本、前三秒钩子、分镜和互动 |

## 14. 模块 8：相似性离散规划

### 14.1 模块名

`plan_similarity_dispersion`

### 14.2 输出 schema

```json
{
  "module": "plan_similarity_dispersion",
  "passed": true,
  "similarityPlan": {
    "newAngle": "",
    "avoidTitlePatterns": [],
    "avoidIntroPatterns": [],
    "avoidHeadingSequences": [],
    "avoidFaqQuestions": [],
    "requiredDifferences": [
      "title_pattern",
      "intro_pattern",
      "section_order",
      "faq_direction",
      "cta"
    ],
    "rewriteLevel": "none"
  },
  "historyMatches": [],
  "blockingIssues": [],
  "warnings": []
}
```

### 14.3 决策规则

如果历史中存在相同 `mainQuestion`，必须改选主问题或设置 `rewriteLevel=L3`。

如果历史中存在相同 `primaryAngle` 但不同问题，至少设置 `rewriteLevel=L2`。

如果历史 FAQ 重合超过 50%，必须重写 FAQ。

如果历史标题结构相同，必须更换标题模式。

## 15. 模块 9：文章生成

### 15.1 模块名

`draft_article`

### 15.2 输入

```json
{
  "articleBrief": {},
  "aiStructurePlan": {},
  "platformStructurePlan": {},
  "similarityPlan": {}
}
```

### 15.3 输出 schema

```json
{
  "module": "draft_article",
  "passed": true,
  "articleDraft": {
    "title": "",
    "summary": "",
    "intro": "",
    "answerBlocks": [
      {
        "questionId": "",
        "question": "",
        "heading": "",
        "directAnswer": "",
        "decisionCriteria": [],
        "analysis": "",
        "applicableScenarios": [],
        "notApplicableScenarios": [],
        "riskNotes": [],
        "evidenceBoundary": "",
        "sourceUse": []
      }
    ],
    "faq": [
      {
        "questionId": "",
        "question": "",
        "answer": ""
      }
    ],
    "cta": "",
    "tags": [],
    "metadata": {
      "aiScenario": "",
      "platform": "",
      "contentAngle": "",
      "lastReviewedAt": ""
    }
  },
  "selfCheck": {
    "allSelectedQuestionsCovered": true,
    "hasDirectAnswers": true,
    "hasDecisionCriteria": true,
    "hasRiskNotes": true,
    "hasEvidenceBoundaries": true,
    "noForbiddenClaims": true,
    "noInternalTraceLeak": true
  },
  "blockingIssues": [],
  "warnings": []
}
```

### 15.4 生成规则

执行者必须：

1. 标题回应主问题。
2. 摘要包含结论、适用对象、判断标准。
3. 每个辅助问题生成一个 `answerBlock`。
4. 每个 `answerBlock.directAnswer` 必须能单独回答问题。
5. 每个 `decisionCriteria` 至少 2 条，最多 5 条。
6. 每个 `answerBlock` 必须包含 `riskNotes`。
7. 每个 `answerBlock` 必须包含 `evidenceBoundary`。
8. FAQ 不得重复 answerBlock 的标题。
9. CTA 必须柔和，不得保证效果。
10. 不得生成来源不明的数据。

## 16. 模块 10：可信标记

### 16.1 模块名

`attach_trust_marker`

### 16.2 输出 schema

```json
{
  "module": "attach_trust_marker",
  "passed": true,
  "trustMarker": {
    "public": {
      "header": "",
      "footer": "",
      "disclaimer": "",
      "shortTraceId": ""
    },
    "internal": {
      "traceId": "",
      "taskId": "",
      "questionBundleId": "",
      "contentHash": "",
      "promptVersions": {},
      "strategyVersions": {},
      "generatedAt": ""
    },
    "exposurePolicy": {
      "showTimestamp": false,
      "showShortTraceId": false,
      "showFullHash": false,
      "showPgpSignature": false,
      "showPhpComment": false
    }
  },
  "blockingIssues": [],
  "warnings": []
}
```

### 16.3 暴露规则

| platform | 可公开 | 不可公开 |
| --- | --- | --- |
| `blog` | 更新时间、适用范围、轻量免责声明、短编号 | PGP 块、复杂 hash |
| `wechat` | 轻量版本说明、免责声明 | 完整 hash、PGP、PHP 注释 |
| `toutiao` | 通常不展示追踪码 | 完整 hash、PGP、PHP 注释 |
| `xiaohongshu` | 通常不展示追踪码 | 完整 hash、PGP、PHP 注释 |
| `douyin` | 不展示机器追踪码 | 完整 hash、PGP、PHP 注释 |

## 17. 模块 11：文章质检

### 17.1 模块名

`review_article`

### 17.2 输出 schema

```json
{
  "module": "review_article",
  "passed": true,
  "articleReview": {
    "blockingIssues": [
      {
        "code": "",
        "location": "",
        "message": "",
        "evidence": "",
        "fix": ""
      }
    ],
    "warnings": [],
    "scores": {
      "questionCoverage": 0,
      "aiRetrievalFit": 0,
      "platformFit": 0,
      "evidenceControl": 0,
      "readability": 0,
      "similarityControl": 0
    },
    "passDecision": "passed | needs_revision | blocked"
  }
}
```

### 17.3 阻断码

```json
[
  "UNANSWERED_SELECTED_QUESTION",
  "MISSING_DIRECT_ANSWER",
  "MISSING_DECISION_CRITERIA",
  "MISSING_RISK_BOUNDARY",
  "MISSING_EVIDENCE_BOUNDARY",
  "UNVERIFIED_CLAIM",
  "FORBIDDEN_ABSOLUTE_CLAIM",
  "AD_LIKE_FAQ",
  "KEYWORD_STUFFING",
  "INTERNAL_TRACE_LEAK",
  "PLATFORM_MISMATCH",
  "AI_SCENARIO_MISMATCH",
  "HIGH_SIMILARITY_RISK"
]
```

### 17.4 通过条件

- `blockingIssues` 为空。
- `questionCoverage >= 90`。
- `aiRetrievalFit >= 75`。
- `platformFit >= 75`。
- `evidenceControl >= 80`。
- `similarityControl >= 70`。

## 18. 模块 12：发布包生成

### 18.1 模块名

`create_publishable_article_package`

### 18.2 输出 schema

```json
{
  "module": "create_publishable_article_package",
  "passed": true,
  "publishableArticlePackage": {
    "taskId": "",
    "status": "ready_for_human_review",
    "platform": "",
    "aiScenario": "",
    "title": "",
    "summary": "",
    "body": "",
    "faq": [],
    "tags": [],
    "cta": "",
    "publicTrace": {},
    "internalTrace": {},
    "reviewReport": {},
    "sourceQuestionBundle": {}
  },
  "blockingIssues": [],
  "warnings": []
}
```

### 18.3 包装规则

执行者必须：

1. 把 `answerBlocks` 转换为目标平台正文。
2. 保留内部 `sourceQuestionBundle`。
3. 不把内部 trace 泄露到正文。
4. 如果质检未通过，`status` 不得为 `ready_for_human_review`。

## 19. Prompt 契约

### 19.1 通用 system prompt

```text
你是 GEO 内容生成链路中的一个严格 JSON 模块。
你必须只返回符合当前模块 schema 的 JSON。
你不得在 JSON 外输出解释、Markdown 或自然语言说明。
你不得编造事实、数据、案例、认证、排名或平台内部规则。
如果事实无法从输入资料判断，请写入 unknowns、warnings 或 evidenceBoundary。
如果发现阻断问题，请设置 passed=false 并写入 blockingIssues。
```

### 19.2 提问句生成 user prompt

```text
模块：generate_question_candidates

请根据输入 productProfile 生成 questionCandidates。
目标是面向豆包、元宝、DeepSeek、通义千问生成真实用户会问的完整中文问题。

必须执行：
1. 每条 question 必须是完整问题。
2. 每条必须包含 intent、targetAiScenarios、contentAngle、userRole、scores。
3. 不得输出孤立关键词。
4. 不得生成夸大承诺型问题。
5. 不得输出占位符。
6. 问题之间必须有明显差异。

输入：
{{json_input}}

只返回 JSON。
```

### 19.3 文章生成 user prompt

```text
模块：draft_article

请根据 articleBrief、aiStructurePlan、platformStructurePlan、similarityPlan 生成 articleDraft。

必须执行：
1. 标题回应 mainQuestion。
2. 每个 supportingQuestion 都要生成 answerBlock。
3. 每个 answerBlock 必须包含 directAnswer、decisionCriteria、analysis、riskNotes、evidenceBoundary。
4. 不得虚构案例、数据、资质、官方背书、排名。
5. 不得堆关键词。
6. 不得泄露内部 trace。

输入：
{{json_input}}

只返回 JSON。
```

### 19.4 质检 user prompt

```text
模块：review_article

请按 review_article schema 检查 articleDraft。
如果发现阻断问题，必须写入 blockingIssues，并给出 fix。
不得因为文章语言流畅就忽略事实、证据边界、问题覆盖和平台结构。

输入：
{{json_input}}

只返回 JSON。
```

## 20. 伪代码

```ts
async function runGeoKeywordToArticlePipeline(input: GeoPipelineInput): Promise<GeoPipelineOutput> {
  const profile = await runModule("normalize_product_profile", input);
  if (!profile.passed) return blocked(profile);

  let questions = await runModule("generate_question_candidates", {
    productProfile: profile.productProfile,
    targetAiScenarios: input.task.targetAiScenarios,
    targetPlatform: input.task.targetPlatform,
    history: input.history,
    operatorPreferences: input.operatorPreferences
  });

  let questionReview = await runModule("review_question_candidates", questions);
  if (!questionReview.passed) {
    questions = await retryModule("generate_question_candidates", {
      reason: questionReview.blockingIssues,
      previousOutput: questions
    });
    questionReview = await runModule("review_question_candidates", questions);
  }
  if (!questionReview.passed) return blocked(questionReview);

  const bundle = await runModule("select_question_bundle", {
    questionCandidates: questions.questionCandidates,
    questionReview,
    targetAiScenarios: input.task.targetAiScenarios,
    targetPlatform: input.task.targetPlatform
  });
  if (!bundle.passed) return blocked(bundle);

  const brief = await runModule("create_article_brief", {
    productProfile: profile.productProfile,
    selectedQuestionBundle: bundle.selectedQuestionBundle,
    targetPlatform: input.task.targetPlatform
  });
  if (!brief.passed) return blocked(brief);

  const aiPlan = await runModule("plan_ai_readable_structure", brief);
  const platformPlan = await runModule("plan_platform_structure", brief);
  const similarityPlan = await runModule("plan_similarity_dispersion", {
    articleBrief: brief.articleBrief,
    history: input.history
  });

  let draft = await runModule("draft_article", {
    articleBrief: brief.articleBrief,
    aiStructurePlan: aiPlan.aiStructurePlan,
    platformStructurePlan: platformPlan.platformStructurePlan,
    similarityPlan: similarityPlan.similarityPlan
  });

  const trust = await runModule("attach_trust_marker", {
    articleDraft: draft.articleDraft,
    articleBrief: brief.articleBrief,
    platformStructurePlan: platformPlan.platformStructurePlan
  });

  let review = await runModule("review_article", {
    articleDraft: draft.articleDraft,
    selectedQuestionBundle: bundle.selectedQuestionBundle,
    aiStructurePlan: aiPlan.aiStructurePlan,
    platformStructurePlan: platformPlan.platformStructurePlan,
    similarityPlan: similarityPlan.similarityPlan,
    trustMarker: trust.trustMarker
  });

  if (review.articleReview.passDecision === "needs_revision") {
    draft = await retryModule("draft_article", {
      reason: review.articleReview.blockingIssues,
      previousDraft: draft,
      articleBrief: brief.articleBrief
    });
    review = await runModule("review_article", { articleDraft: draft.articleDraft });
  }
  if (review.articleReview.passDecision !== "passed") return blocked(review);

  return runModule("create_publishable_article_package", {
    profile,
    questions,
    questionReview,
    bundle,
    brief,
    aiPlan,
    platformPlan,
    similarityPlan,
    draft,
    trust,
    review
  });
}
```

## 21. 最小可执行样例

### 21.1 输入

```json
{
  "task": {
    "taskId": "geo-demo-001",
    "createdAt": "2026-05-30T10:00:00+08:00",
    "operator": "demo",
    "targetAiScenarios": ["deepseek_logic", "doubao_plain_answer"],
    "targetPlatform": "blog",
    "outputLanguage": "zh-CN"
  },
  "rawProductInput": {
    "productName": "示例工业设计服务",
    "category": "工业设计服务",
    "region": "上海",
    "targetAudience": "准备开发硬件产品的企业负责人",
    "sellingPoints": ["提供外观设计、结构建议和打样协同"],
    "usageScenarios": ["新产品立项", "产品外观升级", "样机打样前评估"],
    "serviceProcess": ["需求沟通", "方案草图", "效果图", "结构建议", "打样协同"],
    "pricingFactors": ["项目复杂度", "设计轮次", "是否需要打样协同"],
    "deliveryCapabilities": ["可配合本地沟通", "可协同供应链打样"],
    "materials": [],
    "complianceNotes": ["不得承诺一定量产成功"],
    "forbiddenClaims": ["行业第一", "保证爆款", "一定降低成本"]
  },
  "history": {
    "questions": [],
    "articles": [],
    "titles": [],
    "faqQuestions": [],
    "angles": []
  },
  "operatorPreferences": {
    "questionCount": 10,
    "selectedQuestionCount": 5,
    "preferredIntents": [],
    "blockedIntents": [],
    "preferredTone": "专业但易懂",
    "manualMustCover": [],
    "manualMustAvoid": []
  }
}
```

### 21.2 期望提问句形态

```json
{
  "question": "上海怎么判断一家工业设计服务商是否靠谱？",
  "intent": "selection_criteria",
  "targetAiScenarios": ["deepseek_logic", "doubao_plain_answer"],
  "contentAngle": "选择标准",
  "userRole": "准备开发硬件产品的企业负责人"
}
```

### 21.3 期望 answerBlock 形态

```json
{
  "question": "上海怎么判断一家工业设计服务商是否靠谱？",
  "heading": "判断工业设计服务商是否靠谱，要先看交付链路而不是只看效果图",
  "directAnswer": "可以从需求理解、设计表达、结构落地、打样协同和沟通透明度五个维度判断。只看案例图片或低价报价，容易忽略后续落地风险。",
  "decisionCriteria": [
    "是否能把需求拆成明确设计目标",
    "是否能说明外观方案和结构限制的关系",
    "是否能配合打样和修改",
    "报价是否说明轮次、交付物和边界"
  ],
  "analysis": "工业设计不是单张效果图交付，真正影响项目结果的是从需求到打样的连续协同能力。",
  "applicableScenarios": ["新产品立项", "产品外观升级", "样机打样前评估"],
  "notApplicableScenarios": ["只需要临时视觉概念且不进入打样"],
  "riskNotes": ["不能仅凭低价判断；需要确认交付物、修改轮次和打样协同边界。"],
  "evidenceBoundary": "以上判断基于用户输入的服务范围和通用项目管理经验；具体能力仍需查看合同、案例和沟通记录。"
}
```

## 22. 自检清单

AI Agent 在输出最终包前必须逐项检查：

- `productProfile.category` 非空。
- `questionCandidates` 不少于 8 条有效问题。
- 每个 `questionCandidate.question` 是完整问题。
- 每个 `questionCandidate` 有 intent 和 targetAiScenarios。
- `selectedQuestionBundle.mainQuestion` 非空。
- 每个 supportingQuestion 都映射到 answerBlock。
- 每个 answerBlock 有 directAnswer。
- 每个 answerBlock 有至少 2 条 decisionCriteria。
- 每个 answerBlock 有 riskNotes。
- 每个 answerBlock 有 evidenceBoundary。
- articleDraft 不含 forbiddenClaims。
- articleDraft 不含内部 hash、PGP、PHP 注释。
- articleReview.passDecision 为 passed。
- publishableArticlePackage.status 为 ready_for_human_review。

## 23. 版本管理

```json
{
  "specName": "geo-keyword-to-article-ai-executable-spec",
  "specVersion": "1.0.0",
  "compatibleHumanSpec": "2026-05-30-geo-keyword-to-article-logic-design",
  "breakingChangeRules": {
    "major": "修改顶层输入输出 schema 或模块输出 schema",
    "minor": "新增模块字段、评分规则、平台策略或 AI 场景策略",
    "patch": "修正文案、示例或非结构性说明"
  }
}
```

## 24. 关键结论

本规格把 GEO 内容生成拆成可执行模块，而不是依赖一个长 prompt。AI Agent 执行时必须先生成问题，再筛选问题，再生成文章 brief，最后按 AI 场景和发布平台生成文章。

核心约束是：

```text
不得先写文章再补关键词。
不得用孤立关键词代替用户问题。
不得让文章章节脱离已确认问题。
不得让内容质量依赖模型自由发挥。
```

只有当问题、结构、文章、质检和追踪都按 schema 串起来，系统才具备可复用、可测试、可回滚的 GEO 内容生产能力。
