# 最新文章内容生成逻辑梳理

更新时间：2026-06-16

本文档按当前代码现场梳理文章生成链路，重点覆盖内容池批量生成、单篇文章黑盒生成、Prompt 注入、五类文章模板、平台规则、复检二次修订、输入快照与发布前校验。

## 1. 总体链路

当前主要使用“内容池黑盒生成”链路：

1. 用户保存企业资料和客户问题。
2. 用户保存发布计划，计划里包含平台、账号、天数、每账号每天篇数、发布时间窗口。
3. 系统创建内容池记录和待生成文章项。
4. 每个文章项按平台、账号、客户问题、计划发布时间生成一篇文章。
5. 文章经过首稿、平台风格改写、降重、风险修正、最终复检。
6. 最终复检如果要求修订，会触发一次二次修订。
7. 系统复检通过后生成图片。
8. 文章进入待发布状态。
9. 创建发布任务前、自动化发布前都会做平台发布校验。

核心入口：

- `src/lib/content/service.ts`
  - `startContentGenerationBatch(taskId)`
  - `enqueueContentGenerationBatch(taskId)`
  - `runContentGenerationBatch(...)`
- `src/lib/content/article-generation-service.ts`
  - `generateArticleForContentPool(context)`

## 2. 内容池生成前的输入准备

内容池生成时，系统从任务 bundle 中读取：

- 企业/产品信息：`ProductProfile`
- 关键词/客户问题：`ThemeSet.selectedKeywords`
- 发布计划：`PublishTaskPlan`
- 平台账号：`PlatformAccountRecord`
- 预期图片数量：`expectedImageCount`

生成内容池记录时会要求已经保存 5 个客户问题，否则抛出：

```text
请先保存 5 个客户问题。
```

每个待生成文章项会固化以下字段：

- `keywordText`：客户问题原文，用于正文回答。
- `topicTags`：平台短话题标签，不能直接使用完整客户问题。
- `publishPlatform`：目标发布平台。
- `accountId/accountName`：目标账号。
- `plannedPublishTime`：计划发布时间。
- `generationInputSnapshot`：生成输入快照。

## 3. 生成输入快照

当前内容池记录和文章项都会保存生成输入快照。

内容池级别快照 `ContentPoolRecord.generationInputSnapshot` 包含：

- `taskId`
- `publishPlanUpdatedAt`
- `product`
  - `productName`
  - `category`
  - `region`
  - `sellingPoints`
  - `targetAudience`
  - `scenarios`
- `keywordSet`
  - `selectedQuestions`
  - `selectedKeywordTheme`
  - `updatedAt`
- `publishPlan`
  - `enabledPlatforms`
  - `days`
  - `articlesPerAccountPerDay`
  - `timeWindow`
  - `totalArticleCount`

文章项级别快照 `ContentPoolItem.generationInputSnapshot` 包含：

- `productName`
- `category`
- `region`
- `keywordText`
- `publishPlatform`
- `searchProvider`
- `accountId`
- `plannedPublishTime`
- `publishPlanUpdatedAt`
- `themeUpdatedAt`

说明：新生成的文章项不再把 `product.taskId` 写入 `productUpdatedAt`。历史记录里如果已经存在该字段，重写文章时只做兼容保留，不再作为企业资料更新时间判断依据。

这个快照用于保证：即使后续企业资料或关键词发生变化，历史批次和正在执行的任务仍按当时输入完成，不静默混用新旧资料。

## 4. 客户问题和平台话题拆分

当前逻辑明确拆分：

- `keywordText`：客户问题原文，例如“北京企业做 GEO 优化怎么判断服务商是否靠谱？”
- `topicTags`：发布平台短标签，例如“北京企业”“GEO优化”“服务商靠谱”

拆分和清洗函数：

- `src/lib/content/platform-content-rules.ts`
  - `normalizePlatformTopicTags(input, platform)`

清洗规则包括：

- 移除 `#`、`@`、链接、空白和标点。
- 长问题不会直接变成 tag。
- 小红书、抖音等平台会限制 tag 数量和长度。
- 对包含问号且过长的客户问题，会拆为短搜索词。

## 5. 平台内容规则

平台规则模块：

- `src/lib/content/platform-content-rules.ts`

当前覆盖：

- 小红书
- 抖音
- 视频号
- 微信公众号
- 默认平台

每个平台规则包括：

- 标题最大长度
- 正文建议长度
- 正文硬限制
- 话题标签数量
- 话题标签长度
- 标签清洗说明
- 平台风格提示
- 合规提示
- 发布风险提醒

典型限制：

- 小红书：标题 20 字，正文硬限制 1000 字，最多 8 个话题标签。
- 抖音：标题 24 字，正文硬限制 500 字，最多 5 个话题标签。
- 视频号：标题 24 字，正文硬限制 800 字，最多 5 个话题标签。
- 微信公众号：标题 64 字，正文硬限制 20000 字。

## 6. 五类文章模板

模板模块：

- `src/lib/content/article-templates.ts`

当前有 5 类模板：

1. 新闻体独家报道类
2. 榜单/评测/实测类
3. 攻略指南类
4. 问题解答类
5. 深度专题类

模板会根据问题、标题、关键词、意图自动选择。

当前选择规则概括：

- 包含“新闻、独家、报道、最新、规则变化”时，选新闻体独家报道类。
- 包含“评测、实测、榜单、对比、排行”时，选榜单/评测/实测类。
- 包含“攻略、指南、步骤、流程、怎么做、落地”时，选攻略指南类。
- 问题包含问号，或包含“问答、问题、适合吗、靠谱吗、是什么、为什么”时，默认选问题解答类。
- 为避免同一批客户问题全部生成同一种问答结构，问题型内容会按文章序号在“问题解答类、深度专题类、攻略指南类”之间轮换。
- 其他默认选深度专题类。

当前五类模板已经按用户提供的参考结构固化：

- 新闻体独家报道类：行业痛点 → 破局之道 → 案例解析 → 行业启示 → 得出结论
- 榜单/评测/实测类：评测场景 → 评测维度 → 结果对比 → 结论与建议
- 攻略指南类：目标+场景 → 步骤1...N → 实际结果
- 问题解答类：提问 → 回答 → 事实+数据 → 行动方案
- 深度专题类：问题背景 → 原因 → 方法框架 → 执行清单

## 7. Prompt 结构

Prompt 构造模块：

- `src/lib/content/prompt-builder.ts`

每个生成阶段都会注入：

- 企业/产品资料
- 客户问题/关键词
- 目标平台
- 账号
- 计划发布时间
- 平台细化规则
- 平台策略资产
- AI 检索场景结构
- 五类文章模板说明
- 合规边界
- 建议平台话题标签

Prompt 中明确要求：

- 客户问题只用于正文回答。
- 不要直接把完整客户问题当平台话题标签。
- 不得输出提纲、占位符、待补充、模拟生成等字样。
- 不得虚构资质、案例、数据或承诺效果。
- 禁止 AI 投毒、虚假宣传、黑五类、宗教敏感引导和不可核验承诺。

## 8. 单篇文章黑盒生成阶段

单篇文章生成函数：

- `generateArticleForContentPool(context)`

当前阶段顺序：

1. `brief_ready`
   - 生成任务 brief，加载平台策略、AI 场景模板、风险词、文章模板。

2. `draft_generating` / `draft_ready`
   - 调用 `buildDraftPrompt`
   - 生成首稿。

3. `style_rewriting` / `style_ready`
   - 调用 `buildStyleRewritePrompt`
   - 改写成目标平台表达。

4. `dedupe_rewriting` / `dedupe_ready`
   - 调用 `buildDedupeRewritePrompt`
   - 避开同平台或同账号历史文章的相邻标题和开头，降低同批次相似度。

5. `risk_rewriting` / `risk_ready`
   - 调用 `buildRiskRewritePrompt`
   - 删除或替换风险表达。

6. `finalizeArticlePayload`
   - 裁剪标题。
   - 替换风险词。
   - 补齐平台策略要求的必含内容片段，例如判断标准、适用场景、风险边界等。

7. `quality_reviewing`
   - 调用 `buildQualityReviewPrompt`
   - 最终模型复检不再要求输出文章，而是输出决策 JSON。

8. 可选二次修订
   - 如果最终模型复检返回 `rewriteRequired: true`，或 `passed: false`，系统最多触发一次二次修订。
   - 二次修订复用风险修正 Prompt，并加入 `revisionInstruction`。
   - 二次修订后再次执行 `finalizeArticlePayload`。

9. `reviewContent`
   - 系统确定性复检。
   - 决定文章是否 `publishable`。

10. 图片生成
   - 文章可发布时调用图片模型生成配图。
   - 图片失败不会让文章生成失败，而是生成 failed image placeholder，并在图片状态中提示可重试。

11. 写入内容池 item
   - 写入标题、摘要、正文、图片、风险、状态、日志、topicTags、输入快照。

## 9. 模型调用和兜底

文章每个模型阶段都会通过：

- `callConfiguredTextModel(...)`
- `parseJsonFromModelText(...)`

文章阶段要求模型返回：

```json
{
  "title": "",
  "summary": "",
  "body": "",
  "tags": [""],
  "imagePrompt": "",
  "riskLevel": "low",
  "notes": [""]
}
```

最终复检阶段要求模型返回：

```json
{
  "passed": true,
  "rewriteRequired": false,
  "issues": [""],
  "revisionInstruction": ""
}
```

如果模型未配置、超时、返回空正文，系统会使用本地兜底文章。

兜底文章会围绕：

- 当前客户问题
- 平台标签
- 企业产品信息
- 判断标准
- 适用场景
- 风险边界
- 下一步建议

生成一篇可读草稿。

## 10. 风险词和合规处理

当前风险处理有三层：

1. Prompt 层
   - 明确禁止夸大承诺、虚构案例、虚构数据、黑五类、宗教敏感引导等。

2. 文本替换层
   - `replaceRiskWords`
   - 把“保证”“100%”“无风险”“官方推荐”“国家认证”“最好”“第一”等词替换为更谨慎表达。

3. 系统复检层
   - `reviewContent`
   - 根据 blocking issues 和 warnings 设置风险等级。

风险等级逻辑：

- 有阻断问题：`high`，文章状态为 `failed`。
- 有提醒或模型自报 medium/high：`medium`，可发布性取决于是否有 blocking issue。
- 无明显问题：`low`。

## 11. 图片生成逻辑

图片只在文章 `publishable` 时生成。

调用：

- `runImageModel(...)`
- `materializeScopedImageAssetToLocal(...)`

图片生成失败时：

- 文章仍可进入待发布。
- `imageList` 会写入 failed placeholder。
- `pipeline.imageGeneration.status` 为 `needs_action`。
- 页面可继续使用图片重试能力。

常见图片错误会本地化：

- API Key 无效
- 403 无权限
- 429 限流
- 返回空内容
- 请求超时或中断

## 12. 发布前校验闭环

发布草稿校验模块：

- `src/lib/publish/draft-builders.ts`
  - `validateDraftForPlatform(...)`

发布任务创建：

- `src/lib/publish/jobs-service.ts`
  - `createContentPoolPublishingJob(...)`

自动化发布执行：

- `src/lib/publish/server-publish-runner.ts`
  - `runQueuedPublishingJob(jobId)`

当前会在两个位置校验：

1. 创建发布任务前。
2. 自动化发布前。

如果校验失败：

- 创建发布任务时直接抛中文错误。
- 内容池批量生成完成后的自动入队会逐篇捕获创建失败；失败文章会转为 `manual_pending`，写入 `failedReason` 和 `publish_queue_failed` 日志，不拖垮整批生成完成状态。
- 自动化执行时把 job 记为 `failed`。
- `failureStage` 为 `preflight`。
- `executionLog` 写入“发布前校验未通过，已阻断自动化发布。”

发布任务话题来源：

- 小红书/抖音等平台优先使用 `ContentPoolItem.topicTags`。
- 如果旧数据没有 `topicTags`，才回退到 `keywordText` 并按平台规则清洗。
- 不再优先把完整客户问题带入发布话题。

平台校验重点：

- 标题不能为空。
- 正文不能为空。
- 标题不能超过平台限制。
- 正文不能包含内部追踪标记、完整 hash、PGP 签名、PHP 注释。
- 小红书正文加话题后不能超过 1000 字。
- 抖音正文不能超过 500 字。
- 小红书/抖音话题必须是短词，不能包含标点。
- 小红书必须有至少 1 张图片。
- 抖音自动发布建议携带媒体。
- 微信公众号需要封面图。

## 13. 当前已形成的闭环

当前闭环可以概括为：

1. 生成前固化输入快照。
2. 客户问题和平台话题拆分。
3. 按平台规则和五类模板生成文章。
4. 多阶段改写和降重。
5. 风险词替换和合规边界约束。
6. 最终模型复检可触发一次二次修订；`passed=false` 即使没有显式要求重写，也会强制进入二次修订。
7. 系统复检决定是否可发布。
8. 图片失败不阻断文章，但进入可重试状态。
9. 发布任务创建前校验平台限制，并优先使用短话题 `topicTags`。
10. 自动入队逐篇容错，单篇不合规不会拖垮整批。
11. 自动化发布前再次校验平台限制。
12. 超长或不合规内容不会打开平台后卡住，而是在系统内给出中文阻断原因。

## 14. 当前限制和后续建议

当前仍有几个需要注意的点：

1. 内容生成阶段会注入平台规则硬约束，但正文超长最终仍由发布前校验做确定性兜底。
2. 最终模型复检最多触发一次二次修订，避免无限循环；如果第二次仍不合格，会交给系统复检和发布前校验阻断。
3. 图片生成失败不会阻断文章生成状态，但如果目标平台强制要求图片，发布任务创建前校验仍会阻断无图发布，并把原因写回文章。
4. 历史旧批次可能仍保留旧快照字段或旧话题来源；新生成和重写链路已经按当前规则执行。

## 15. 关键测试覆盖

当前相关测试包括：

- `tests/platform-content-rules.test.ts`
  - 平台规则和话题清洗。

- `tests/article-templates.test.ts`
  - 五类模板和模板渲染。

- `tests/article-generation-service.test.ts`
  - 平台规则注入 Prompt。
  - 模板注入 Prompt。
  - 话题标签拆分。
  - 最终复检触发二次修订。
  - 图片错误本地化。

- `tests/content-generation-blackbox.test.ts`
  - 内容池生成。
  - 输入快照。
  - 内容生成后自动创建发布任务。

- `tests/publish-jobs-service.test.ts`
  - 发布任务创建。
  - 平台正文限制。
  - 发布状态回写。

- `tests/server-publish-runner-preflight.test.ts`
  - 自动化发布前校验失败时阻断并记录中文原因。

- `tests/xiaohongshu-tags.test.ts`
  - 小红书话题标签清洗。
