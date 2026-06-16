# 内容生成逻辑说明

本文档记录当前项目中“生成文章/内容池”的实际代码逻辑，便于后续排查和迭代。

## 1. 前置条件

开始生成文章前，系统要求已经完成：

- 企业信息已保存。
- 已确认 5 个客户问题/关键词。
- 已保存发布计划。

发布计划会决定：

- 使用哪个 AI 平台。
- 启用哪些发布平台。
- 每个平台使用哪些账号。
- 生成天数。
- 每账号每天文章数。
- 计划发布时间。
- 每篇文章期望图片数。

相关代码：

- `src/lib/tasks/service.ts`
- `src/components/tasks/task-planning-workbench.tsx`

## 2. 生成入口

前端点击开始生成后，请求：

```txt
POST /api/content/generation/start
```

接口会调用：

```ts
enqueueContentGenerationBatch(taskId)
```

这个接口只负责启动后台生成任务，不会等待所有文章生成完成后才返回。

相关代码：

- `src/app/api/content/generation/start/route.ts`
- `src/lib/content/service.ts`

## 3. 创建内容池

系统会先按发布计划创建一批 `pending_generation` 内容项。

文章数量大致为：

```txt
启用平台下账号数 × 天数 × 每账号每天文章数
```

每条内容池记录会包含：

- 文章序号。
- 目标发布平台。
- 绑定账号。
- 关键词/客户问题。
- 计划发布时间。
- 图片提示词。
- 当前生成状态。

关键词分配逻辑：

- 系统固定使用 5 个客户问题/关键词。
- 每个账号有一个 `accountKeywordOffset`。
- 同账号下的多篇文章按 5 个关键词循环分配。

相关代码：

- `buildPendingContentPoolRecord(...)`
- `buildPendingContentPoolItem(...)`
- `src/lib/content/service.ts`

## 4. 批量生成流程

后台任务按内容池 `sequence` 顺序逐篇生成。

每篇文章开始前会标记为：

```txt
generating
```

然后调用：

```ts
generateArticleForContentPool(...)
```

如果单篇生成成功，会替换内容池中的对应文章；如果失败，会写入失败原因，并标记为 `failed`。

相关代码：

- `runContentGenerationBatch(...)`
- `markContentPoolItemGenerating(...)`
- `buildFailedContentPoolItem(...)`
- `src/lib/content/service.ts`

## 5. 单篇文章黑盒生成链路

单篇文章内部分为多个阶段：

1. `draft_generating`：生成首稿。
2. `style_rewriting`：按目标平台风格改写。
3. `dedupe_rewriting`：降重与差异化改写。
4. `risk_rewriting`：风险语言修正。
5. `quality_reviewing`：最终模型复检。
6. `finalizing`：写入最终成稿，并处理图片生成。

每个阶段都会写入 `stageLog`，用于前端展示生成进度和排查失败原因。

相关代码：

- `generateArticleForContentPool(...)`
- `src/lib/content/article-generation-service.ts`

## 6. 提示词构造

提示词由 `prompt-builder.ts` 生成，核心输入包括：

- 企业/产品信息。
- 目标关键词/客户问题。
- 发布平台。
- AI 平台。
- 账号名称。
- 计划发布时间。
- 同批次前文标题和开头，用于降重。

主要提示词：

- `buildDraftPrompt(...)`
- `buildStyleRewritePrompt(...)`
- `buildDedupeRewritePrompt(...)`
- `buildRiskRewritePrompt(...)`
- `buildQualityReviewPrompt(...)`

相关代码：

- `src/lib/content/prompt-builder.ts`

## 7. 模型调用和兜底

文本模型使用：

```ts
contentModelApiConfig
```

如果没有配置可用模型，或模型超时、返回空正文，系统会使用本地兜底文章。

一旦某个阶段进入兜底，后续阶段会继续使用兜底，避免同一篇文章反复卡住。

相关代码：

- `callArticleStage(...)`
- `buildDevArticle(...)`
- `src/lib/content/article-generation-service.ts`

## 8. 风险复检和可发布判断

文章生成后会调用：

```ts
reviewContent(...)
```

判断结果：

- 如果存在阻断问题，文章标记为 `failed`，不可发布。
- 如果存在 warning 或模型自报中高风险，风险等级可能为 `medium`。
- 没有阻断问题时，文章进入 `pending_publish`。

最终写入字段包括：

- `riskLevel`
- `riskCodes`
- `pipeline`
- `publishable`
- `status`
- `displayStatus`
- `failedReason`

相关代码：

- `reviewContent(...)`
- `buildRisk(...)`
- `buildPipeline(...)`
- `src/lib/content/review-service.ts`
- `src/lib/content/article-generation-service.ts`

## 9. 图片生成

只有文章可发布时，系统才会调用图片模型：

```ts
runImageModel(...)
```

图片生成成功后会本地化保存，并写入 `imageList`。

如果图片生成失败：

- 文章不会直接失败。
- 系统会创建失败图片占位。
- `pipeline.imageGeneration.status` 会标记为 `needs_action`。
- 后续可以单张重试，或一键重生所有失败图片。

相关代码：

- `runImageModel(...)`
- `materializeScopedImageAssetToLocal(...)`
- `retryContentPoolItemImage(...)`
- `retryAllFailedContentPoolImages(...)`
- `src/lib/content/article-generation-service.ts`
- `src/lib/content/service.ts`

## 10. 生成完成后的发布任务创建

所有文章生成结束后，系统会自动为可发布文章创建发布任务：

```ts
createContentPoolPublishingJob(...)
```

创建条件：

- `publishable === true`
- 状态属于可进入发布的范围

发布任务状态：

- 自动化支持的平台：`queued`
- 不支持自动化的平台：`manual_pending`

小红书会额外处理：

- 关键词会被清洗成平台允许的话题。
- 正文长度会按小红书限制裁剪。
- 发布前还会再次清理正文和话题中的特殊符号。

相关代码：

- `enqueueAutoPublishingJobs(...)`
- `createContentPoolPublishingJob(...)`
- `src/lib/content/service.ts`
- `src/lib/publish/jobs-service.ts`
- `src/lib/publish/server-publish-runner.ts`

## 11. 恢复与重试

系统支持生成过程恢复：

- 如果任务状态是 `generation_queued` 或 `generation_running`，读取内容池时会尝试恢复队列。
- 如果没有待生成项，则会把任务同步为 `generation_completed`。
- 失败文章可以进入失败重试队列。

相关代码：

- `resumeContentPoolQueuesIfNeeded(...)`
- `enqueueResumedContentGenerationBatch(...)`
- `enqueueRetryFailedContentPoolItems(...)`
- `runRetryFailedContentPoolItems(...)`
- `src/lib/content/service.ts`

## 12. 关键文件索引

- 生成启动接口：`src/app/api/content/generation/start/route.ts`
- 内容池查询/重新生成接口：`src/app/api/content/pool/route.ts`
- 批量生成与内容池状态：`src/lib/content/service.ts`
- 单篇文章生成：`src/lib/content/article-generation-service.ts`
- 提示词构造：`src/lib/content/prompt-builder.ts`
- 内容复检：`src/lib/content/review-service.ts`
- 发布任务创建：`src/lib/publish/jobs-service.ts`
- 自动发布执行：`src/lib/publish/server-publish-runner.ts`
