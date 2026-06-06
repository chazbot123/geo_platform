# GEO 提示词核心能力调研与设计文档

日期：2026-05-29  
适用角色：提示词负责人、内容运营、产品经理、研发对接人  
项目位置：`D:\geo`

## 1. 文档定位

本文档用于梳理 GEO 项目中“提示词核心部分”的接手边界和工作方法。接手者不负责前端、后端、Electron 自动发布、接口配置等开发工作，只负责定义和维护内容生成链路中的提示词策略、文章结构策略、平台适配策略、相似性离散策略、可信标记策略、质检规则，以及可交给研发封装的 skills 或脚本规范。

当前项目已有基础链路：

- 第一阶段：根据产品资料生成 AI 用户提问句。
- 第二阶段：围绕已确认提问句生成权威报告型文章。
- 图片阶段：根据文章生成配图 prompt。
- 发布阶段：按平台规则生成标题、正文、标签，并执行发布。

现有提示词更偏“单一报告模板”。下一阶段需要补齐的是“可运营、可复用、可扩展”的提示词体系，而不是继续堆单个长 prompt。

## 2. 接手边界

### 2.1 负责内容

提示词负责人负责以下事项：

- 定义不同 AI 检索环境下的文章结构，例如 DeepSeek、豆包、通义、元宝等 AI 场景更容易理解和引用什么内容。
- 定义不同发布平台的文章结构，例如公众号深度逻辑型、今日头条钩子型、网站博客 SEO/GEO 型、小红书种草型、抖音口播脚本型。
- 设计相似性离散规则，降低同平台批量发布时标题、开头、段落顺序、句式、案例、FAQ、CTA、标签过于相似的风险。
- 设计可信标记规则，例如时间戳、版本号、内容 hash、内部追踪码、页头页脚、PGP 签名说明等。
- 编写主稿 prompt、平台改写 prompt、离散改写 prompt、质检 prompt、素材注入 prompt。
- 输出可封装成 skills 的操作规范，让运营或研发可以调用固定能力包。

### 2.2 不负责内容

提示词负责人不直接负责：

- 模型 API 接入。
- 数据库存储和字段设计实现。
- 前端页面。
- Electron 自动发布脚本。
- 平台账号登录和授权。
- 真实平台算法逆向。
- 绕过平台风控、批量洗稿、伪造原创证明等高风险行为。

### 2.3 对研发的交付物

提示词负责人交付的不是代码，而是清晰规则：

- prompt 模板。
- 输入字段要求。
- 输出 JSON 或 Markdown 结构。
- 质检标准。
- 不同平台的结构差异。
- 哪些规则适合自动执行，哪些必须人工确认。

## 3. 产品与市场问题拆解

### 3.1 市场背景

GEO 内容系统的目标不是“生成一篇文章”，而是让内容同时适配三个分发环境：

- 搜索引擎：需要标题、摘要、关键词、结构化段落、可索引信息。
- AI 检索和回答：需要清晰问题、直接答案、判断标准、FAQ、可引用结论。
- 内容平台：需要符合平台用户阅读习惯，避免低质营销、重复搬运、标题党和夸大表达。

市面上的普通 AI 写作工具通常只解决“写得出来”，没有系统解决：

- 同一产品在多个平台如何变成不同结构。
- 同一平台多篇相似内容如何做离散。
- AI 检索型文章如何兼顾可读性和可引用性。
- 内容如何保留内部追踪信息但不影响用户体验。
- 如何把提示词能力变成可复用的工作流。

### 3.2 平台侧共性风险

公开平台规则通常会强调原创、真实、合规、反低质、反搬运、反虚假夸大。不同平台不会公开具体判重阈值，因此文档中不能写“相似度低于多少一定安全”。更合理的做法是把它转化为提示词侧的风险控制：

- 不复制同一篇主稿到多个平台。
- 不只替换标题和少量词语。
- 不批量输出同样段落顺序和同样案例。
- 不用同一套 FAQ、CTA、标签和摘要。
- 不伪造第三方认证、官方背书、用户案例、检测数据。

### 3.3 用户侧需求

客户真正需要的是：

- 一套内容可以被多平台分发，但每个平台看起来都像为该平台原生写作。
- 同一个产品可以持续产出内容，但每篇文章有不同切入点。
- 文章既能被人读懂，也能被 AI 摘录和搜索系统识别。
- 批量发布时能保留内部追踪能力，方便复盘哪篇内容来自哪个任务、版本和策略。

## 4. 提示词能力地图

建议把提示词核心能力拆成六个能力包。

### 4.1 AI 适配层

目标：让文章更适合被 AI 搜索、AI 问答和 AI 摘录。

能力包括：

- 把用户问题转成文章章节。
- 每个章节给出直接答案、判断标准、适用场景、风险提醒。
- 结论前置，避免长篇铺垫。
- 使用 FAQ 和对比表增强 AI 可提取性。
- 避免空泛广告语，优先写可验证、可解释、可引用的信息。

### 4.2 平台结构层

目标：让同一主题在不同发布平台呈现不同结构。

能力包括：

- 今日头条：钩子标题、短引入、强信息密度、分段清晰、避免过长报告腔。
- 微信公众号：完整逻辑、层层推进、适合深度阅读，有摘要、目录感、结论和行动建议。
- 网站博客：SEO/GEO 结构，标题、摘要、H2/H3、FAQ、关键词自然分布、元描述友好。
- 小红书：场景化、经验化、清单化、避坑化、口语表达，不写成硬广告。
- 抖音：口播脚本结构，前三秒钩子、镜头段落、口语节奏、结尾互动。

### 4.3 可信标记层

目标：让内容具备版本追踪和来源说明，但不干扰用户阅读。

能力包括：

- 公开可见标记：更新时间、版本说明、资料来源范围、适用地区、免责声明。
- 半公开标记：文章末尾的内容编号、主题编号、任务编号。
- 内部标记：hash、prompt 版本、素材版本、模型版本、生成时间、平台策略版本。
- 不建议公开使用的标记：大段 PGP 签名、复杂 hash、PHP 注释、难懂的机器码。

### 4.4 相似性离散层

目标：同一产品、同一平台、多篇内容之间不能只是轻微改写。

离散维度包括：

- 选题角度离散：选择标准、避坑、价格、场景、对比、案例拆解、FAQ、趋势解读。
- 标题结构离散：疑问型、结论型、清单型、对比型、风险提示型、场景型。
- 开头方式离散：问题开场、场景开场、误区开场、结论开场、数据假设开场。
- 章节顺序离散：先结论、先问题、先场景、先对比、先风险。
- 句式离散：长短句比例、口语/专业语比例、列表/段落比例。
- 素材离散：不同案例角度、不同 FAQ、不同 CTA、不同标签。
- 图片 prompt 离散：主体、场景、构图、色调、镜头、信息层级不同。

### 4.5 风格与人设层

目标：让内容不是统一 AI 腔。

能力包括：

- 专家顾问型：适合 B2B、技术服务、企业采购。
- 本地服务顾问型：适合地区服务、工厂、门店。
- 消费决策型：适合普通消费者选择商品或服务。
- 避坑清单型：适合平台流量内容。
- 研究报告型：适合网站博客、公众号深度稿。

### 4.6 质检与复写层

目标：生成后自动检查内容是否满足要求。

质检项包括：

- 是否覆盖所有选定提问句。
- 是否存在高风险词，例如“最强”“绝对”“根治”“保赚”。
- 是否有无法验证的案例、数据、资质、官方背书。
- 是否过度重复上一次同平台草稿。
- 是否符合目标平台标题长度、正文结构和语气。
- 是否保留必要追踪信息。

### 4.7 外部规则依据映射

提示词体系不能只来自内部经验，需要和公开搜索/平台规则对齐。当前可稳定引用的外部依据如下：

| 外部依据 | 对提示词体系的影响 | 应落到的能力包 |
| --- | --- | --- |
| Google Search Central 强调 helpful、reliable、people-first content，要求内容提供原创信息、完整描述、超出显而易见的信息，并避免主要为搜索排名而生产内容。参考：https://developers.google.com/search/docs/fundamentals/creating-helpful-content | 不允许只为关键词堆砌生成内容；每篇文章必须有用户问题、实质判断、适用边界和可验证依据。 | AI 适配层、质检与复写层 |
| Google Spam Policies 将大量生成低原创、低价值页面用于操纵排名定义为 scaled content abuse，并明确反对同义词替换、拼接、抓取后轻度改写。参考：https://developers.google.com/search/docs/essentials/spam-policies | 相似性离散不能等同于洗稿；必须从用户意图、结构路径和信息增量上重写。 | 相似性离散层 |
| Schema.org 的 BlogPosting/Article 支持 articleBody、articleSection、datePublished、dateModified、author、publisher、keywords 等字段。参考：https://schema.org/BlogPosting | 网站博客稿要天然支持结构化元数据和追踪字段。 | 平台结构层、可信标记层 |
| Schema.org 的 FAQPage 使用 mainEntity 表达页面主要问答实体。参考：https://schema.org/FAQPage | FAQ 不能只是装饰，应是可被抽取的真实问答单元。 | AI 适配层、平台结构层 |
| 微信公众平台长期存在原创声明、转载、抄袭治理和原创保护机制；公开报道和平台规则均强调原创、授权、转载来源。 | 公众号稿要保留独立观点、来源范围和原创边界；不能把拼凑、翻译、整理他人内容包装为原创。 | 平台结构层、质检与复写层 |
| 抖音、小红书等内容社区公开规则普遍强调真实、合规、反低质营销、反搬运和社区体验。 | 信息流和社区内容要更像原生经验或口播，不应带大量机器追踪码、报告腔或夸大营销承诺。 | 平台结构层、风格与人设层 |

这些外部依据不能推导出任何“平台判重阈值”。因此工程设计里只能使用内部风险等级，例如 low、medium、high，不能向客户承诺“低于某个相似度就一定不会判重”。

### 4.8 工程实现视角的能力边界

为了让研发可以落地，六个能力包应被看成六个可组合的“策略模块”，而不是六段固定 prompt。建议每个模块都输出稳定 JSON，供后续模块继续消费。

统一模块契约：

```json
{
  "module": "ai_adaptation | platform_structure | trust_marker | similarity_dispersion | persona_style | content_review",
  "inputVersion": "v1",
  "strategyVersion": "geo-prompt-core-v1",
  "inputs": {},
  "outputs": {},
  "warnings": [],
  "trace": {
    "taskId": "",
    "platform": "",
    "aiScenario": "",
    "generatedAt": "",
    "promptVersion": ""
  }
}
```

工程上不要把所有策略塞进一个超长提示词。推荐链路是：

1. `ai_adaptation` 先决定 AI 可读结构。
2. `platform_structure` 再决定平台表达结构。
3. `similarity_dispersion` 根据历史内容调整角度和结构。
4. `persona_style` 给语气和人设。
5. `trust_marker` 生成公开/内部标记。
6. `content_review` 做最终审核。

这样做的好处是每个模块都能单独测试、单独更新、单独回滚。

## 5. 不同 AI 场景的文章结构策略

### 5.1 DeepSeek 场景

适合结构：

- 结论摘要。
- 问题定义。
- 判断维度。
- 分项分析。
- 适用/不适用场景。
- 风险和限制。
- FAQ。

写法重点：

- 逻辑链清楚。
- 避免营销腔。
- 多使用“判断标准”“适用条件”“限制因素”。

### 5.2 豆包场景

适合结构：

- 直接回答。
- 普通用户能理解的解释。
- 简短清单。
- 场景举例。
- 下一步建议。

写法重点：

- 口语化但不低质。
- 少用行业黑话。
- 更像给普通用户答疑。

### 5.3 通义场景

适合结构：

- 背景说明。
- 结构化要点。
- 对比分析。
- 实施建议。
- 总结。

写法重点：

- 信息层级稳定。
- 适合表格、编号、分点表达。
- 结论要明确。

### 5.4 元宝场景

适合结构：

- 高频问题。
- 直接答案。
- 选择建议。
- 避坑提醒。
- 相关追问。

写法重点：

- 适合问答链路。
- 每个段落围绕一个明确问题。
- FAQ 要真实，不要像广告。

### 5.5 AI 场景选择表

工程侧可以把 AI 场景视为枚举值，不要让运营每次手写自由文本。

| aiScenario | 适用目标 | 结构倾向 | 禁忌 |
| --- | --- | --- | --- |
| `deepseek_logic` | 深度分析、复杂决策、B2B 选型 | 定义、维度、推理、边界、FAQ | 空泛口播、过短结论、缺少判断链 |
| `doubao_plain_answer` | 普通用户答疑、本地生活、服务选择 | 直接答案、口语解释、清单、下一步 | 行业黑话、报告腔、过度术语 |
| `tongyi_structured_summary` | 总结、对比、方案说明、知识库内容 | 背景、要点、对比、建议、总结 | 信息层级混乱、段落过长 |
| `yuanbao_qa_chain` | 高频问答、追问链路、用户决策 | 问题、答案、避坑、相关追问 | FAQ 像广告、回答不直接 |
| `generic_ai_retrieval` | 不确定 AI 来源时的通用 GEO 内容 | 结论前置、H2 问题、FAQ、元信息 | 只堆关键词、不回答问题 |

### 5.6 AI 可读文章结构规范

不论目标 AI 是哪一个，文章都应该满足以下“机器可读 + 人可读”结构：

```json
{
  "title": "必须能概括主题和结论，不使用夸张标题党",
  "summary": "120-180 字，直接说明结论、适用对象和核心判断",
  "answerBlocks": [
    {
      "question": "真实用户会问的问题",
      "directAnswer": "先用 1-3 句话直接回答",
      "decisionCriteria": ["判断标准 1", "判断标准 2"],
      "analysis": "解释为什么这样判断",
      "applicableScenarios": ["适用场景"],
      "riskNotes": ["限制或风险"],
      "evidenceBoundary": "说明依据来自产品资料、公开信息还是经验判断"
    }
  ],
  "faq": [
    {
      "question": "追问",
      "answer": "简短、直接、可独立理解"
    }
  ],
  "metadata": {
    "aiScenario": "",
    "contentAngle": "",
    "lastReviewedAt": ""
  }
}
```

AI 可读性的关键不是字数，而是“可抽取单元”是否稳定。每个 answerBlock 都要能被单独拿出来回答一个问题。

### 5.7 AI 适配 Prompt 片段

下面片段可作为主稿 prompt 中的固定约束：

```text
你必须把文章写成可被 AI 摘录的结构化内容。

每个核心段落都必须包含：
1. 一个真实用户问题。
2. 一个直接答案。
3. 2 到 4 个判断标准。
4. 适用场景和不适用场景。
5. 风险或限制说明。

不要只给宽泛结论。不要为了 SEO 堆关键词。不要虚构数据、案例、认证、用户评价。
如果某个事实无法从输入资料判断，请写成“需要进一步确认”，不要编造。
```

## 6. 不同平台的文章结构策略

### 6.1 今日头条：钩子型信息流文章

目标：短时间抓住注意力，同时保持信息密度。

建议结构：

1. 标题：30 字以内，优先疑问、对比、避坑、结论。
2. 开头：用 2 到 3 句话说明用户痛点。
3. 主体：3 到 5 个小节，每节一个判断点。
4. 中段：加入选择标准或避坑清单。
5. 结尾：自然 CTA，不强推。

不建议：

- 长篇报告腔。
- 大量 Markdown 表格。
- 过度官方口吻。
- 标题过长。

### 6.2 微信公众号：深度逻辑型文章

目标：适合完整阅读和转发收藏。

建议结构：

1. 标题：可以稍长，但要有清晰主题。
2. 摘要：一句话说明文章价值。
3. 引言：交代问题背景。
4. 主体：按“问题 - 分析 - 判断标准 - 建议”展开。
5. 小结：每个大段给一个明确结论。
6. 结尾：总结和行动建议。

适合加入：

- 目录感标题。
- 案例化场景。
- 对比维度。
- 适用/不适用说明。

### 6.3 网站博客：SEO/GEO 型文章

目标：适合搜索收录和 AI 摘录。

建议结构：

1. H1：关键词 + 用户问题 + 结论价值。
2. 摘要：150 字以内，包含核心关键词和结论。
3. H2：围绕真实提问句展开。
4. 每节开头先给简短答案。
5. 正文提供判断标准和解释。
6. FAQ：3 到 5 个真实追问。
7. 更新时间、适用范围、免责声明。

适合加入：

- 元描述。
- 结构化 FAQ。
- llms.txt 或站点内容摘要。
- 内部追踪 ID，但不影响正文阅读。

### 6.4 小红书：场景种草/避坑型

目标：看起来像真实经验，不像硬广。

建议结构：

1. 标题：场景 + 结果/避坑。
2. 开头：真实场景痛点。
3. 主体：清单化经验。
4. 中段：选择标准或踩坑点。
5. 结尾：轻 CTA 或评论互动。

不建议：

- 权威报告腔。
- 过度堆品牌名。
- 夸张承诺。
- 一看就是通用广告文。

### 6.5 抖音：口播脚本型

目标：适合短视频表达。

建议结构：

1. 前 3 秒钩子：问题、反常识、避坑。
2. 正文 3 到 5 段：每段一句核心信息。
3. 镜头提示：产品、场景、对比、结果。
4. 结尾：评论/私信/收藏引导。

不建议：

- 长句。
- 复杂定义。
- 大量书面语。

### 6.6 平台策略工程表

平台策略需要以配置形式存在，避免散落在不同 prompt 里。建议研发按以下字段建配置。

```json
{
  "platform": "toutiao | wechat | blog | xiaohongshu | douyin",
  "title": {
    "maxLength": 30,
    "patterns": ["question", "comparison", "risk_warning", "conclusion"],
    "bannedPatterns": ["clickbait_without_answer", "absolute_claim"]
  },
  "body": {
    "preferredStructure": "",
    "paragraphLength": "short | medium | long",
    "headingStyle": "hook | logical | seo | note | script",
    "ctaStyle": "soft_consult | bookmark | comment | private_message | read_more"
  },
  "metadata": {
    "allowPublicTraceId": false,
    "allowTimestamp": false,
    "allowMarkdownTable": false,
    "allowFaq": true
  },
  "review": {
    "riskWords": [],
    "mustHave": [],
    "mustNotHave": []
  }
}
```

推荐初始配置：

| platform | 标题长度 | 结构 | 段落 | FAQ | 公开追踪码 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `toutiao` | 30 字以内 | 钩子 + 判断点 + 避坑 | 短 | 可少量 | 不建议 | 信息流阅读，正文要快进入主题 |
| `wechat` | 64 字以内 | 引言 + 深度分析 + 小结 | 中长 | 适合 | 可轻量 | 适合完整逻辑和作者人设 |
| `blog` | 不固定 | H1/H2/H3 + FAQ + 元信息 | 中 | 必须 | 可展示 | 适合 SEO/GEO 和结构化数据 |
| `xiaohongshu` | 短标题 | 场景 + 经验 + 清单 | 短 | 不建议传统 FAQ | 不建议 | 像经验笔记，不像报告 |
| `douyin` | 口播标题 | 3 秒钩子 + 分镜脚本 | 极短 | 不适用 | 不建议 | 输出应是脚本，不是文章 |

### 6.7 平台输出 JSON 规范

平台改写模块必须输出稳定结构，方便发布侧直接使用。

```json
{
  "platform": "toutiao",
  "platformTitle": "",
  "platformSummary": "",
  "platformBody": "",
  "sections": [
    {
      "heading": "",
      "body": "",
      "purpose": "hook | evidence | decision | risk | cta"
    }
  ],
  "tags": [],
  "cta": "",
  "publicTraceNote": "",
  "internalTrace": {
    "sourceDraftId": "",
    "platformStrategyVersion": "",
    "rewriteLevel": "L1 | L2 | L3"
  },
  "reviewHints": []
}
```

### 6.8 平台策略 Prompt 片段

```text
你正在执行平台结构改写，不是简单改写措辞。

目标平台：{{platform}}
平台策略：{{platformStrategyJson}}

你必须：
1. 按平台策略重写标题、开头、章节和 CTA。
2. 保留事实，不新增无法验证的案例和数据。
3. 将不适合该平台的结构删除或转写。例如抖音不保留长篇 FAQ，小红书不保留报告式页脚。
4. 输出 JSON，不输出解释。
5. 在 internalTrace 中说明本次改写使用的策略版本和离散等级。
```

## 7. 可信标记策略

### 7.1 时间戳

适用场景：

- 网站博客。
- 公众号深度稿。
- 内部内容包。
- 需要说明内容时效性的行业。

建议写法：

```text
更新时间：2026-05-29
适用范围：本文基于当前公开资料、产品资料和用户输入信息整理，仅供选型参考。
```

不建议每段都插入时间戳，容易影响阅读。

### 7.2 内容 hash

适用场景：

- 内部追踪。
- 发布任务回溯。
- 判断草稿版本差异。

公开正文不建议展示完整 hash。可以在页脚展示短编号：

```text
内容编号：GEO-20260529-TT-8F3A
```

内部记录可以保存：

```json
{
  "contentHash": "sha256:...",
  "promptVersion": "geo-content-v1.3",
  "platformStrategy": "toutiao-hook-v1",
  "generatedAt": "2026-05-29T15:00:00+08:00"
}
```

### 7.3 页头页脚

页头适合网站博客和内部报告，不适合信息流平台。

页脚适合放：

- 更新时间。
- 内容编号。
- 免责声明。
- 联系方式或 CTA。

不建议在今日头条、小红书、抖音文案中加入明显机器编号，容易破坏内容原生感。

### 7.4 PHP 标记

PHP 注释或隐藏字段只适合网站系统内部，不适合平台发布正文。

可用于网站模板：

```php
<?php
// GEO_CONTENT_ID: GEO-20260529-BLOG-8F3A
// GEO_PROMPT_VERSION: geo-blog-v1.3
// GEO_GENERATED_AT: 2026-05-29T15:00:00+08:00
?>
```

发布到第三方平台时不应带出 PHP 注释。

### 7.5 PGP 签名

PGP 签名适合证明“这份内容包由内部系统生成或审核”，但不适合普通平台正文。

推荐用途：

- 内部归档。
- 高价值行业白皮书。
- 下载版报告。
- 合同或合规附件。

不推荐用途：

- 今日头条正文。
- 小红书笔记。
- 抖音口播稿。
- 普通公众号文章末尾大段签名。

推荐公开写法是轻量说明，而不是完整签名块：

```text
本文已由 GEO 内容流程生成并完成内部审核，内容版本：GEO-20260529-WX-8F3A。
```

完整 PGP 签名应放在内部归档或附件中。

### 7.6 标记暴露矩阵

| 标记类型 | 网站博客 | 微信公众号 | 今日头条 | 小红书 | 抖音 | 内部归档 |
| --- | --- | --- | --- | --- | --- | --- |
| 更新时间 | 推荐展示 | 可展示 | 不建议强展示 | 不建议 | 不适用 | 必须 |
| 内容编号 | 可展示短编号 | 可展示短编号 | 不建议 | 不建议 | 不适用 | 必须 |
| 完整 hash | 不展示 | 不展示 | 不展示 | 不展示 | 不展示 | 必须 |
| prompt 版本 | 不展示 | 不展示 | 不展示 | 不展示 | 不展示 | 必须 |
| 平台策略版本 | 不展示 | 不展示 | 不展示 | 不展示 | 不展示 | 必须 |
| PHP 注释 | 可用于模板 | 不适用 | 不适用 | 不适用 | 不适用 | 可保存 |
| PGP 签名 | 附件可用 | 附件可用 | 不适用 | 不适用 | 不适用 | 可选 |
| 免责声明 | 推荐 | 推荐 | 轻量 | 轻量或不展示 | 口播化 | 推荐 |

### 7.7 内部追踪数据结构

建议所有内容生成结果都保存一份内部追踪对象。这个对象不进入第三方平台正文。

```json
{
  "traceId": "GEO-20260529-BLOG-8F3A",
  "taskId": "",
  "sourceDraftId": "",
  "contentHash": "sha256:<hex>",
  "promptVersion": "geo-content-v1.3",
  "aiAdaptationVersion": "deepseek_logic-v1",
  "platformStrategyVersion": "blog-seo-geo-v1",
  "dispersionVersion": "similarity-dispersion-v1",
  "modelProvider": "",
  "modelName": "",
  "generatedAt": "2026-05-29T15:00:00+08:00",
  "reviewedAt": "",
  "reviewResult": "passed | warning | rejected",
  "publicExposure": {
    "timestamp": true,
    "shortTraceId": true,
    "disclaimer": true,
    "fullHash": false,
    "pgpSignature": false
  }
}
```

### 7.8 Hash 生成建议

hash 用于判断版本变化，不用于证明平台原创。推荐 hash 输入采用规范化后的内容包：

```text
hashInput = normalize(title) + "\n" +
            normalize(summary) + "\n" +
            normalize(body) + "\n" +
            normalize(tags.join(",")) + "\n" +
            platform + "\n" +
            promptVersion
```

规范化建议：

- 去除首尾空白。
- 统一换行符。
- 合并连续空格。
- 保留中文标点。
- 不把生成时间放入 hashInput，否则每次生成都会变成新 hash。

### 7.9 可信标记的红线

可信标记只能用于追踪、说明和合规，不应用于伪造权威。

禁止写法：

- “本文已通过官方认证”，除非确有官方认证。
- “本文由平台原创保护”，除非平台后台已声明并通过。
- “PGP 签名证明内容真实”，PGP 只能证明签名者和内容未变，不能证明内容事实真实。
- “hash 可避免平台判重”，hash 只能用于内部版本识别。

## 8. 相似性离散策略

### 8.1 基本原则

相似性离散不是“洗稿”，而是同一产品在不同内容场景下做真实差异化表达。每篇内容都应该有不同的用户问题、平台目标、结构路径和信息组织方式。

### 8.2 离散等级

#### L1 轻度离散

适合：同一篇文章发布到不同平台前的基础适配。

动作：

- 改标题。
- 改开头。
- 调整小标题。
- 改 CTA。
- 调整语气。

风险：如果正文主体不变，仍然容易显得重复。

#### L2 中度离散

适合：同一产品在同一平台发布多篇相近主题内容。

动作：

- 更换文章角度。
- 调整章节顺序。
- 重写摘要和开头。
- 更换 FAQ。
- 改写 50% 以上段落表达。
- 换案例或场景。

这是常规推荐等级。

#### L3 深度离散

适合：批量内容、同平台连续发布、高相似主题。

动作：

- 重新定义选题。
- 重新生成大纲。
- 更换人设和表达风格。
- 更换主问题和子问题。
- 重新组织论证路径。
- 图片 prompt 同步重写。

深度离散不应只基于同一篇原稿改写，而应从“用户意图”重新生成。

### 8.3 离散矩阵

| 维度 | 可变项 | 示例 |
| --- | --- | --- |
| 标题 | 疑问/结论/清单/避坑/对比 | “怎么选”改为“这 5 点先看清” |
| 开头 | 场景/问题/误区/结论 | 从“很多人不知道”改为“如果你正在比较报价” |
| 章节 | 顺序和数量 | 先讲价格，改为先讲适用场景 |
| 论据 | 选择标准/风险/案例 | 从服务能力改为交付周期 |
| 语气 | 专家/顾问/口语/经验 | 报告腔改为本地顾问口吻 |
| FAQ | 追问方向 | 价格 FAQ 改为售后 FAQ |
| CTA | 咨询/对比/收藏/评论 | “咨询方案”改为“先列需求清单” |
| 标签 | 核心词/场景词/地区词 | “品牌词”改为“品类 + 地区 + 场景” |
| 图片 | 主体/场景/构图/色调 | 产品图改为使用场景图 |

### 8.4 相似性检测指标

平台不会公开真实判重规则，所以内部检测应使用多指标风险评估。不要用单一相似度分数做最终判断。

建议指标：

| 指标 | 检查什么 | 工程实现建议 | 风险解释 |
| --- | --- | --- | --- |
| 标题相似度 | 标题结构和关键词是否重复 | 字符 n-gram、编辑距离、关键词重合 | 标题过像会让用户和平台都感觉重复 |
| 开头相似度 | 前 150-300 字是否重复 | n-gram Jaccard、SimHash | 开头重复是批量稿最明显信号 |
| 章节结构相似度 | H2/H3 顺序是否相同 | heading 序列相似度 | 结构相同但换词，仍然像模板稿 |
| 段落语义相似度 | 主体段落是否表达同一内容 | embedding cosine | 检测“换词不换意思” |
| FAQ 重合度 | 问答是否重复 | 问题文本重合、语义聚类 | FAQ 是 GEO 内容的重要判重区域 |
| CTA 重合度 | 转化话术是否重复 | 规则匹配 | 批量 CTA 会显得机械 |
| 图片 prompt 相似度 | 图像生成提示是否重复 | prompt token overlap、主体/场景字段比较 | 图像相似也会暴露批量生产 |

### 8.5 内部风险等级

以下阈值只用于内部质检，不代表任何平台规则。

| 风险等级 | 建议条件 | 处理方式 |
| --- | --- | --- |
| low | 标题、开头、结构、FAQ 均有明显差异，主体语义有新增角度 | 可进入人工审核 |
| medium | 某 1-2 个维度明显重复，例如章节顺序或 FAQ 重复 | 必须 L2 离散改写 |
| high | 标题结构、开头、章节顺序、主体语义大面积相似 | 必须 L3 重写，不允许发布 |

建议工程评分：

```json
{
  "titleSimilarity": 0.0,
  "introSimilarity": 0.0,
  "headingStructureSimilarity": 0.0,
  "bodySemanticSimilarity": 0.0,
  "faqOverlap": 0.0,
  "ctaSimilarity": 0.0,
  "imagePromptSimilarity": 0.0,
  "risk": "low | medium | high",
  "requiredRewriteLevel": "none | L2 | L3",
  "reasons": []
}
```

### 8.6 离散生成流程

工程上建议先“规划差异”，再生成正文，不要先生成再随便改。

```text
输入：产品资料、目标平台、历史内容摘要、本次内容目标

步骤：
1. 从历史内容中抽取 usedAngles、usedTitlePatterns、usedIntroPatterns、usedFaqQuestions。
2. 选择一个未使用或低使用频次的 newAngle。
3. 根据 newAngle 生成新大纲。
4. 检查大纲是否和历史结构过近。
5. 生成正文。
6. 运行相似性检测。
7. 如果 risk=medium，做 L2 改写；如果 risk=high，回到步骤 2。
```

### 8.7 离散角度库

建议建立角度库，避免每次靠人工临时想。

| angleId | 角度 | 适用平台 | 示例标题方向 |
| --- | --- | --- | --- |
| `selection_criteria` | 选择标准 | blog、wechat、toutiao | “怎么判断一家服务商靠不靠谱” |
| `pitfall_avoidance` | 避坑 | toutiao、xiaohongshu、douyin | “这几个坑先避开” |
| `price_logic` | 价格/报价 | toutiao、blog、xiaohongshu | “报价差这么多，主要差在哪” |
| `scenario_fit` | 场景匹配 | all | “什么情况适合选这种方案” |
| `comparison` | 对比 | blog、wechat、toutiao | “A 和 B 到底怎么选” |
| `local_service` | 本地服务 | xiaohongshu、toutiao、blog | “本地找服务商先看哪几点” |
| `faq_cluster` | 高频问答 | blog、yuanbao | “关于 X 的 5 个常见问题” |
| `risk_boundary` | 风险边界 | wechat、blog | “哪些情况不建议直接选” |

## 9. Prompt 模板

### 9.1 主稿生成 Prompt

```text
你是 GEO 内容生成助手。

请基于以下资料生成一篇适合 [目标 AI 场景] 和 [目标发布平台] 的文章。

输入资料：
- 产品名称：{{productName}}
- 产品品类：{{category}}
- 核心卖点：{{sellingPoints}}
- 目标人群：{{targetAudience}}
- 使用场景：{{scenarios}}
- 地区信息：{{region}}
- 合规限制：{{complianceNotes}}
- 已确认用户提问句：{{selectedQuestions}}
- 平台：{{platform}}
- AI 场景：{{aiScenario}}
- 内容角度：{{contentAngle}}

生成要求：
1. 文章必须围绕真实用户问题展开，不要写成品牌宣传稿。
2. 每个核心章节必须回答一个明确问题。
3. 先给结论，再解释判断标准。
4. 不得虚构客户案例、检测数据、官方资质或无法验证的事实。
5. 避免“最强、绝对、根治、保赚、唯一”等高风险词。
6. 根据目标平台调整结构和语气。
7. 根据目标 AI 场景增强可摘录性。

输出结构：
- title
- summary
- intro
- sections
- faq
- cta
- traceNote
```

工程建议：主稿生成 prompt 最好拆成 system、developer/context、user 三层，不要把所有内容塞进一个 user prompt。

推荐消息结构：

```json
[
  {
    "role": "system",
    "content": "你是 GEO 内容生成助手。必须只返回符合 schema 的 JSON，不输出解释。不得虚构事实。"
  },
  {
    "role": "user",
    "content": {
      "productProfile": {},
      "selectedQuestions": [],
      "aiScenario": "generic_ai_retrieval",
      "platform": "blog",
      "contentAngle": "selection_criteria",
      "complianceNotes": ""
    }
  }
]
```

推荐输出 schema：

```json
{
  "title": "",
  "summary": "",
  "intro": "",
  "sections": [
    {
      "question": "",
      "heading": "",
      "directAnswer": "",
      "decisionCriteria": [],
      "body": "",
      "riskNotes": [],
      "evidenceBoundary": ""
    }
  ],
  "faq": [
    {
      "question": "",
      "answer": ""
    }
  ],
  "cta": "",
  "traceNote": {
    "aiScenario": "",
    "contentAngle": "",
    "promptVersion": ""
  }
}
```

### 9.2 平台改写 Prompt

```text
你是多平台内容结构改写助手。

请把以下主稿改写为适合 {{platform}} 发布的版本。

原始主稿：
{{sourceArticle}}

平台策略：
{{platformStrategy}}

改写要求：
1. 保留事实和核心结论，不新增无法验证的信息。
2. 重写标题、开头、章节标题和 CTA。
3. 调整正文结构，使其符合平台阅读习惯。
4. 不要只做同义词替换。
5. 输出内容必须像为该平台原生创作。
6. 保留必要的内部追踪信息，但不要破坏用户阅读体验。

输出：
- platformTitle
- platformBody
- tags
- traceNote
```

平台改写必须传入平台策略 JSON。不要只传平台名称，否则模型会按泛化印象写。

平台策略输入示例：

```json
{
  "platform": "toutiao",
  "titleMaxLength": 30,
  "headingStyle": "hook",
  "paragraphLength": "short",
  "allowMarkdownTable": false,
  "allowPublicTraceId": false,
  "ctaStyle": "soft_consult",
  "mustAvoid": ["长篇报告腔", "完整 hash", "PGP 签名块", "夸大承诺"]
}
```

### 9.3 相似性离散 Prompt

```text
你是内容相似性离散助手。

目标：基于同一产品和同一平台，生成一篇与历史内容明显不同的新文章。

产品资料：
{{productProfile}}

本次目标平台：
{{platform}}

历史内容摘要：
{{historySummaries}}

历史标题：
{{historyTitles}}

本次内容角度：
{{newAngle}}

离散要求：
1. 不复用历史标题结构。
2. 不复用历史开头方式。
3. 不沿用相同章节顺序。
4. FAQ 至少 70% 与历史不同。
5. CTA 表达必须不同。
6. 主体论证角度必须围绕本次 newAngle 重新组织。
7. 不得通过生硬替换同义词制造差异。

输出：
- title
- differenceSummary
- outline
- article
- faq
- cta
```

相似性离散 prompt 必须要求模型先输出差异计划，再输出文章。否则模型容易只做同义词替换。

推荐增强输出：

```json
{
  "differencePlan": {
    "newAngle": "",
    "avoidTitlePatterns": [],
    "avoidIntroPatterns": [],
    "avoidFaqQuestions": [],
    "newStructure": []
  },
  "draft": {
    "title": "",
    "intro": "",
    "sections": [],
    "faq": [],
    "cta": ""
  },
  "selfCheck": {
    "changedTitlePattern": true,
    "changedIntroPattern": true,
    "changedSectionOrder": true,
    "changedFaq": true,
    "addedNewValue": true
  }
}
```

### 9.4 可信标记 Prompt

```text
你是 GEO 内容追踪标记助手。

请根据发布平台和内容类型，为文章生成合适的可信标记。

输入：
- 平台：{{platform}}
- 内容类型：{{contentType}}
- 任务编号：{{taskId}}
- prompt 版本：{{promptVersion}}
- 平台策略版本：{{platformStrategyVersion}}
- 生成时间：{{generatedAt}}
- 内容 hash：{{contentHash}}

规则：
1. 如果是网站博客，可以生成公开更新时间、适用范围、内容编号。
2. 如果是公众号，可以生成轻量版本说明和免责声明。
3. 如果是今日头条、小红书、抖音，只生成内部追踪标记，不要把 hash 或 PGP 签名放入正文。
4. PGP 签名只用于内部归档或附件。
5. PHP 注释只用于网站模板，不进入第三方平台正文。

输出：
- publicHeader
- publicFooter
- internalTrace
- shouldExposeToReader
- riskNote
```

可信标记 prompt 需要把“公开展示”和“内部保存”分开，避免模型把 hash、PGP、PHP 注释写入第三方平台正文。

推荐输出 schema：

```json
{
  "public": {
    "header": "",
    "footer": "",
    "disclaimer": "",
    "shortTraceId": ""
  },
  "internal": {
    "traceId": "",
    "contentHash": "",
    "promptVersion": "",
    "platformStrategyVersion": "",
    "generatedAt": ""
  },
  "exposurePolicy": {
    "showTimestamp": true,
    "showShortTraceId": false,
    "showFullHash": false,
    "showPgpSignature": false,
    "showPhpComment": false
  },
  "riskNote": ""
}
```

### 9.5 质检 Prompt

```text
你是 GEO 内容质检助手。

请检查以下文章是否符合平台结构、AI 摘录、合规和相似性离散要求。

文章：
{{article}}

目标平台：{{platform}}
目标 AI 场景：{{aiScenario}}
历史内容摘要：{{historySummaries}}
必答提问句：{{selectedQuestions}}

检查项：
1. 是否覆盖所有必答提问句。
2. 是否存在高风险词或夸大承诺。
3. 是否存在无法验证的案例、数据、资质或背书。
4. 是否符合目标平台结构。
5. 是否适合 AI 摘录。
6. 是否与历史内容过于相似。
7. 是否包含不适合公开展示的内部标记。

输出 JSON：
{
  "passed": true,
  "warnings": [],
  "rewriteSuggestions": [],
  "similarityRisk": "low|medium|high",
  "platformFit": "low|medium|high",
  "aiRetrievalFit": "low|medium|high"
}
```

推荐把质检拆成两轮：

1. 规则质检：检查必答问题、风险词、平台结构、公开标记。
2. 相似性质检：检查历史内容相似性。

规则质检输出：

```json
{
  "passed": false,
  "blockingIssues": [
    {
      "code": "UNVERIFIED_CLAIM",
      "message": "出现无法验证的数据或案例",
      "evidence": "",
      "fix": "删除或改为保守表达"
    }
  ],
  "warnings": [],
  "scores": {
    "platformFit": 0,
    "aiRetrievalFit": 0,
    "complianceFit": 0,
    "readability": 0
  }
}
```

相似性质检输出：

```json
{
  "similarityRisk": "medium",
  "requiredRewriteLevel": "L2",
  "matchedHistoryItems": [
    {
      "historyId": "",
      "matchedDimensions": ["intro", "faq", "heading_structure"]
    }
  ],
  "rewriteInstructions": [
    "更换开头方式",
    "重排章节顺序",
    "替换 FAQ 方向"
  ]
}
```

### 9.6 Prompt 版本管理规范

每个 prompt 都必须有版本号，便于回溯线上效果。

命名规则：

```text
geo-{module}-{target}-{major}.{minor}
```

示例：

```text
geo-content-blog-1.0
geo-platform-toutiao-1.2
geo-dispersion-general-1.0
geo-review-compliance-1.1
```

版本升级规则：

- 修改输出 schema：major +1。
- 修改平台策略、结构要求：minor +1。
- 修正文案错别字或补充示例：patch，可不进入模型 trace。

### 9.7 脚本化调用伪代码

研发可以把 prompt 能力封装成独立服务函数。

```ts
type PromptModule =
  | "ai_adaptation"
  | "platform_structure"
  | "similarity_dispersion"
  | "trust_marker"
  | "content_review";

interface PromptModuleRequest {
  module: PromptModule;
  strategyVersion: string;
  taskId: string;
  platform?: string;
  aiScenario?: string;
  payload: Record<string, unknown>;
}

interface PromptModuleResponse<T> {
  module: PromptModule;
  strategyVersion: string;
  output: T;
  warnings: string[];
  trace: {
    taskId: string;
    generatedAt: string;
    promptVersion: string;
  };
}

async function runPromptModule<T>(request: PromptModuleRequest): Promise<PromptModuleResponse<T>> {
  const prompt = await loadPromptTemplate(request.module, request.strategyVersion);
  const messages = renderMessages(prompt, request.payload);
  const raw = await callTextModel(messages);
  return parseAndValidateJson<T>(raw, request.module);
}
```

## 10. Skills 化建议

提示词核心能力可以拆成以下 skills。这里的 skill 指运营和研发都能复用的一组固定规则，不要求提示词负责人亲自开发。

### 10.1 `ai-answer-structure`

用途：根据目标 AI 场景生成文章结构。

输入：

- AI 场景。
- 用户提问句。
- 产品资料。
- 内容目标。

输出：

- 推荐文章结构。
- 每个章节的写作要求。
- FAQ 方向。

### 10.2 `platform-article-structure`

用途：根据发布平台改写文章结构。

输入：

- 平台。
- 主稿。
- 产品资料。

输出：

- 平台标题。
- 平台正文。
- 标签。
- CTA。

### 10.3 `similarity-dispersion`

用途：针对同平台相似内容做离散。

输入：

- 历史标题。
- 历史摘要。
- 历史正文结构。
- 本次目标角度。

输出：

- 新大纲。
- 差异说明。
- 新文章。
- 相似风险等级。

### 10.4 `content-signature-marker`

用途：生成内容追踪和可信标记。

输入：

- 平台。
- 内容类型。
- 任务编号。
- prompt 版本。
- hash。
- 生成时间。

输出：

- 公开标记。
- 内部标记。
- 是否可展示。
- 风险提醒。

### 10.5 `geo-content-review`

用途：生成后质检。

输入：

- 文章。
- 平台。
- AI 场景。
- 历史内容。
- 必答问题。

输出：

- 是否通过。
- 风险列表。
- 改写建议。
- 平台适配分。
- AI 摘录适配分。

### 10.6 Skill 文件结构建议

如果把这些能力做成 Codex/Claude 可调用的 skills，建议每个 skill 使用独立目录。

```text
skills/
  ai-answer-structure/
    SKILL.md
    templates/
      deepseek_logic.md
      doubao_plain_answer.md
      generic_ai_retrieval.md
    examples/
      input.json
      output.json
  platform-article-structure/
    SKILL.md
    platform-strategies/
      toutiao.json
      wechat.json
      blog.json
      xiaohongshu.json
      douyin.json
  similarity-dispersion/
    SKILL.md
    angle-library.json
    review-schema.json
  content-signature-marker/
    SKILL.md
    exposure-policy.json
  geo-content-review/
    SKILL.md
    risk-words.json
    review-schema.json
```

### 10.7 `SKILL.md` 标准模板

```md
---
name: similarity-dispersion
description: Use when generating or rewriting content for the same product/platform where historical content may be similar.
---

# Similarity Dispersion

## When To Use

Use this skill before producing a new draft if:

- The same product already has historical drafts.
- The target platform is the same as a previous draft.
- The new article shares the same selected questions or keywords.

## Inputs

- productProfile
- targetPlatform
- historicalTitles
- historicalSummaries
- historicalOutlines
- newContentGoal

## Process

1. Extract used angles.
2. Choose a new angle.
3. Create a difference plan.
4. Generate a new outline.
5. Generate the article.
6. Run self-check.

## Output

Return JSON only:

{
  "differencePlan": {},
  "draft": {},
  "selfCheck": {},
  "risk": "low|medium|high"
}
```

### 10.8 Skill 验收标准

每个 skill 都要有可测试的验收标准。

| skill | 必须通过的验收 |
| --- | --- |
| `ai-answer-structure` | 每个章节都有 question、directAnswer、decisionCriteria、riskNotes |
| `platform-article-structure` | 输出符合平台标题长度、正文结构和公开标记策略 |
| `similarity-dispersion` | 必须先输出 differencePlan，再输出 draft；不能只做同义词替换 |
| `content-signature-marker` | 第三方平台正文不得出现完整 hash、PGP 签名块、PHP 注释 |
| `geo-content-review` | 能区分 blockingIssues 和 warnings，并给出可执行修复建议 |

### 10.9 工程师落地顺序

如果研发资源有限，建议按以下顺序落地：

1. 先做 `platform-article-structure`，因为当前项目已有发布平台草稿生成链路。
2. 再做 `similarity-dispersion`，因为同平台重复内容是批量发布的核心风险。
3. 再做 `geo-content-review`，把人工经验转成可检查规则。
4. 再做 `content-signature-marker`，补齐追踪体系。
5. 最后做 `ai-answer-structure` 的多 AI 细分版本，前期可先用 `generic_ai_retrieval`。

## 11. 推荐工作流

### 11.1 单篇内容

1. 确认产品资料。
2. 确认目标 AI 场景。
3. 确认目标平台。
4. 选择文章角度。
5. 生成主稿。
6. 做平台结构改写。
7. 加入合适可信标记。
8. 做质检。
9. 人工微调。

### 11.2 同平台多篇内容

1. 建立历史内容摘要库。
2. 每篇先定义不同内容角度。
3. 使用 `similarity-dispersion` 生成新大纲。
4. 生成文章。
5. 对比历史标题、开头、章节、FAQ、CTA。
6. 相似风险为 medium 或 high 时重写。
7. 发布后记录内容编号、角度、平台和版本。

### 11.3 多平台分发

1. 先生成一篇中立主稿。
2. 不直接复制主稿到平台。
3. 每个平台调用一次平台结构改写。
4. 每个平台生成不同标题、开头、CTA、标签。
5. 网站博客保留更完整 SEO/GEO 结构。
6. 信息流平台压缩报告腔，增强钩子和可读性。

## 12. 优先级建议

### P0：必须先做

- 平台结构策略。
- 相似性离散 prompt。
- 内容质检 prompt。
- 高风险表达清单。

### P1：随后补齐

- AI 场景结构策略。
- 可信标记策略。
- 历史内容摘要库规则。
- 图片 prompt 离散规则。

### P2：后续增强

- PGP 内部归档规范。
- 自动相似度评分。
- 平台表现回传后的 prompt 优化。
- 不同行业模板库。

## 13. 关键结论

这个项目的提示词核心不是“写一个更长的 prompt”，而是建设一套内容策略系统。提示词负责人最重要的工作是把内容生产拆成稳定能力包：

- 先判断目标 AI 怎么读。
- 再判断目标平台怎么呈现。
- 再判断同平台历史内容怎么避开重复。
- 最后判断哪些可信标记该公开，哪些只能内部保存。

只要这四件事定义清楚，研发可以把它们封装成配置、模板、skills 或脚本；运营可以按同一套规则持续产出内容；客户看到的也会是更像平台原生内容的文章，而不是批量 AI 模板稿。
