# 内容池黑盒生成执行方案

日期：2026-06-10

## 结论

本轮不再把“内容池”做成用户手动干预的内容工序工作台，而是改成“任务生成中心 + 文章结果列表 + 文章详情”的产品形态。

核心调整：

- 创建任务页保存后不直接把用户推进到“工序式内容池”
- 保存计划后新增主按钮：`开始生成`
- 点击 `开始生成` 后，系统按总篇数持续生成文章，用户只看结果进度，不需要理解样文、改写、复检、离散等后端术语
- 内容池首页只展示任务级进度和文章列表
- 正文、图片、生成细节进入文章详情
- 专业工序仅作为黑盒内部状态存在，允许在生成中的动态条目里短暂显示，如“改写完成”“风险检查中”“降重完成”

## 当前问题

当前实现与目标不一致，主要体现在以下几处：

- `src/components/tasks/task-planning-workbench.tsx`
  - 只有“保存任务”，没有“开始生成”
- `src/components/content/content-pool.tsx`
  - 直接暴露“自动改写”“确认可发布”“重新降重”等用户操作
- `src/lib/content/service.ts`
  - 内容池构建与内容读取耦合，打开内容池会隐式生成
- `src/lib/content/service.ts`
  - 批量文章仍偏模板拼接，不是稳定的真实批量文章生成管线
- `src/lib/tasks/service.ts`
  - 任务保存只完成计划持久化，没有独立的生成任务启动动作

## 目标产品形态

### 任务页

- 用户完成账号登录、发布节奏、总篇数确认后点击 `保存计划`
- 保存成功后停留当前页，显示“计划已保存”
- 主按钮切换为 `开始生成`
- 点击 `开始生成` 后：
  - 创建本次任务的文章生成批次
  - 写入任务级生成状态
  - 跳转到内容池

### 内容池页

- 顶部展示：
  - 总篇数
  - 已生成篇数
  - 生成中篇数
  - 失败篇数
  - 待发布篇数
- 主列表仅展示：
  - 序号
  - 标题
  - AI 平台
  - 发布平台
  - 账号
  - 关键词
  - 当前状态
  - 更新时间
- 列表不展示整篇正文
- 点击条目进入详情页或详情抽屉查看：
  - 标题
  - 摘要
  - 正文
  - 图片
  - 风险结果
  - 发布信息

### 用户可见状态文案

用户侧统一文案：

- 待生成
- 生成中
- 已完成
- 待发布
- 发布中
- 已发布
- 失败

生成中的滚动状态可以短暂出现：

- 正在生成标题
- 正在生成正文
- 改写完成
- 降重完成
- 风险检查中
- 图片处理中

禁止作为主操作和主模块直接暴露：

- 样文
- 母版
- 离散
- 复检
- 确认可发布
- 重新降重

## 设计原则

前端改造必须按 `frontend-design` 技能方向执行：

- 简洁、安静、生产型界面
- 用户只看到“开始生成 -> 查看结果 -> 执行发布”
- 复杂工序只作为系统行为反馈，不变成用户学习成本
- 列表强调产出结果，不堆砌工序按钮
- 详情页承接正文、图片、生成信息，不把长内容放在首页列表

## 代码改造范围

### 前端

- `src/components/tasks/task-planning-workbench.tsx`
  - 新增“保存计划”和“开始生成”的双阶段状态
  - 保存后不再直接跳内容池
  - 仅当计划已保存且总篇数大于 0 时允许开始生成
- `src/app/content-pool/page.tsx`
  - 保留路由，但页面语义改为“生成结果中心”
- `src/components/content/content-pool.tsx`
  - 重做为“任务汇总 + 文章列表”
  - 移除用户侧改写/降重/复检操作入口
  - 增加生成进度、筛选、本次任务/历史任务切换
- 新增文章详情组件或路由
  - 例如 `src/components/content/content-item-detail.tsx`
  - 或 `src/app/content-pool/[itemId]/page.tsx`
- `src/components/layout/app-shell.tsx`
  - 流程文案同步改成黑盒结果导向表达

### 后端

- `src/lib/tasks/service.ts`
  - 新增“计划已保存但尚未开始生成”的任务状态
- `src/app/api/tasks/plan/route.ts`
  - 保存计划只做保存，不隐式触发生成
- 新增生成启动接口
  - 例如 `src/app/api/content/generation/start/route.ts`
- 新增生成进度接口
  - 例如 `src/app/api/content/generation/status/route.ts`
- `src/lib/content/service.ts`
  - 把“读取内容池”和“启动生成”解耦
  - 建立文章级生成任务模型
  - 保留内部工序状态，但统一映射为用户侧简化状态
- 发布侧保持复用：
  - `src/lib/publish/jobs-service.ts`
  - `src/lib/publish/execution-service.ts`

## 数据模型调整

### 任务状态

建议把任务主状态收敛为：

- `task_planned`
- `generation_queued`
- `generation_running`
- `generation_completed`
- `publishing`
- `published`
- `failed`

### 文章状态

新增或收敛文章级外显状态：

- `pending`
- `generating`
- `ready`
- `pending_publish`
- `publishing`
- `published`
- `failed`

### 黑盒内部阶段

内部阶段保留，但不直接作为用户操作：

- `outline`
- `draft`
- `rewrite`
- `dispersion`
- `risk_review`
- `image_prompt`
- `image_generation`
- `finalize`

### 关键字段

任务级：

- `generationStartedAt`
- `generationFinishedAt`
- `generationProgress`
- `generatedArticleCount`
- `failedArticleCount`

文章级：

- `displayStatus`
- `internalStage`
- `stageMessage`
- `title`
- `summary`
- `body`
- `images`
- `riskLevel`
- `publishStatus`

## API 方案

### 1. 保存计划

- `POST /api/tasks/plan`
- 只保存：
  - AI 平台
  - 平台映射
  - 账号数量
  - 天数
  - 时间窗
  - 总篇数

### 2. 开始生成

- `POST /api/content/generation/start`
- 输入：
  - `taskId`
- 行为：
  - 校验计划已保存
  - 创建文章级生成记录
  - 进入 `generation_queued` / `generation_running`
  - 异步启动批量文章生成

### 3. 查询生成进度

- `GET /api/content/generation/status?taskId=...`
- 返回：
  - 总篇数
  - 已生成数
  - 生成中数
  - 失败数
  - 文章列表摘要

### 4. 查询文章详情

- `GET /api/content/pool/item?id=...`
- 返回：
  - 标题
  - 摘要
  - 正文
  - 图片
  - 风险信息
  - 发布信息

## 真实 AI 生成链路改造方案

### 结论

这个问题本轮必须直接解决，不能继续使用模板拼文、占位正文、半成品草稿。

硬性要求：

- 禁止用固定模板拼正文充当批量文章
- 禁止用占位文案或伪生成结果进入内容池
- 每一篇文章都必须经过真实 AI 生成
- 每一篇文章都必须经过 AI 改写和降重
- 改写和降重不是可选补丁，而是生成主链路的一部分

### 目标链路

每篇文章统一走下面这条链路：

1. 根据企业信息、关键词、平台、账号、发布时间生成文章 brief
2. 调用 AI 生成首稿
3. 调用 AI 做平台风格改写
4. 调用 AI 做降重与差异化改写
5. 调用 AI 做风险语言修正
6. 通过规则和模型双重复检
7. 产出最终正文、摘要、标题、标签、图片提示词
8. 仅最终结果写入内容池对外展示

用户只看到结果，不看到工序入口。

### 后端必须新增的生成阶段

建议在文章级内部状态里明确拆成：

- `brief_ready`
- `draft_generating`
- `draft_ready`
- `style_rewriting`
- `style_ready`
- `dedupe_rewriting`
- `dedupe_ready`
- `risk_rewriting`
- `risk_ready`
- `quality_reviewing`
- `quality_passed`
- `finalizing`
- `ready`
- `failed`

用户侧统一映射为：

- 待生成
- 生成中
- 已完成
- 失败

### 一步到位实现原则

本轮不接受“先模板拼文占位，后续再换真实链路”的方案。

允许的折中只有：

- 同一篇文章在内部多次调用 AI 完成改写和降重
- 同一篇文章在失败时自动重试有限次数

不允许的折中：

- 先写模板正文再假装走改写
- 先落占位内容到内容池，后面再异步替换
- 用户打开详情时仍看到半成品正文

### 具体改造点

#### 1. 替换当前模板拼文入口

当前 `src/lib/content/service.ts` 中的模板拼文逻辑必须下线。

改造要求：

- 删除或停用正文模板拼接主路径
- 保留它只能作为测试兜底或开发模式，不能进入正式内容池主流程
- 内容池主流程改为真实 AI 生成服务调用

#### 2. 建立文章级 AI 执行器

建议新增独立服务，例如：

- `src/lib/content/article-generation-service.ts`

职责：

- 接收单篇文章生成上下文
- 串行执行首稿生成、平台改写、降重改写、风险修正、复检
- 统一返回最终文章结果和阶段日志

建议入参：

- `taskId`
- `contentItemId`
- `searchProvider`
- `platform`
- `accountId`
- `keyword`
- `enterprise profile`
- `publish plan`

建议出参：

- `title`
- `summary`
- `body`
- `tags`
- `imagePrompt`
- `riskLevel`
- `trace`
- `finalStatus`

#### 3. 建立统一 Prompt 组合器

建议新增：

- `src/lib/content/prompt-builder.ts`

职责：

- 按平台和关键词生成首稿 prompt
- 按平台风格生成改写 prompt
- 按差异化约束生成降重 prompt
- 按风险语言约束生成修正 prompt

要求：

- Prompt 必须显式包含企业信息、关键词、平台风格、禁用表达、差异化要求
- 不允许不同阶段共用一份笼统 prompt

#### 4. 把降重改写变成硬性环节

降重不是“如果命中风险再处理”，而是每篇文章固定执行。

最少规则：

- 每篇文章生成首稿后必须经过一次 AI 降重改写
- 同账号相邻文章必须比较标题、开头、结构、CTA、关键词表达
- 同批次文章如相似度超过阈值，必须再次触发 AI 改写
- 复写后仍高相似度，则标记失败，不允许进入 ready

#### 5. 建立模型复检，不只靠规则

建议复检分两层：

- 规则层：
  - 长度
  - 标题重复
  - 禁用词
  - 结构缺失
  - 平台不匹配
- 模型层：
  - 是否像真实文章
  - 是否回答关键词问题
  - 是否仍然模板化
  - 是否存在重复表达
  - 是否存在风险语言

只有规则层和模型层都通过，才能进入 `ready`。

#### 6. 内容池只写最终版

内容池写入策略必须改成：

- 生成中：只写元数据和阶段状态，不写占位正文
- 已完成：一次性写入最终标题、摘要、正文、图片提示词
- 失败：写失败原因，不写占位内容

这样用户在详情里不会看到半成品。

### 推荐服务拆分

建议新增或重构为以下服务：

- `src/lib/content/article-generation-service.ts`
- `src/lib/content/prompt-builder.ts`
- `src/lib/content/article-rewrite-service.ts`
- `src/lib/content/article-dedup-service.ts`
- `src/lib/content/article-review-service.ts`

分工如下：

- `article-generation-service`
  - 编排整篇文章的 AI 流程
- `prompt-builder`
  - 生产各阶段 prompt
- `article-rewrite-service`
  - 平台风格改写、风险修正
- `article-dedup-service`
  - 相似度比较、降重改写、重试
- `article-review-service`
  - 最终模型复检和规则复检

### 存储要求

每篇文章建议记录：

- `generationAttemptCount`
- `rewriteAttemptCount`
- `dedupeAttemptCount`
- `reviewAttemptCount`
- `internalStage`
- `stageMessage`
- `stageLog[]`
- `similarityScore`
- `riskCodes[]`
- `failedReason`

这些字段可以存内部，但前端只展示简化结果。

### 失败处理

失败策略建议：

- 首稿生成失败：自动重试 2 次
- 改写失败：自动重试 2 次
- 降重失败：自动重试 2 次
- 复检失败：
  - 若可修复，则回退到改写阶段
  - 若连续失败超过阈值，则标记文章失败

禁止：

- 失败后直接落模板正文
- 失败后直接把半成品标记为已完成

### 验收口径

满足以下条件才算解决“模板拼文”问题：

- 随机抽查任意文章，正文不是固定模板套壳
- 同批次文章标题和开头有明显差异
- 内容池详情页只出现最终成稿
- 内部日志能证明每篇文章走过生成、改写、降重、复检链路
- 相似度过高的文章不会进入 `ready`
- `npm run check` 通过
- 联调时至少验证一个真实任务批次的文章生成结果

### 对执行阶段的影响

原执行阶段中的“阶段 4：真实批量生成补齐”不再是后补项，而是本轮主路径。

新的优先级应为：

1. 流程改名和按钮重构
2. 生成入口解耦
3. 真实 AI 生成链路落地
4. 文章级记录落地
5. 发布衔接

## 执行阶段

### 阶段 1：流程改名和按钮重构

- 把“保存后进入内容池”改为“保存计划 + 开始生成”
- 增加“开始生成”
- 内容池先改成结果页结构

### 阶段 2：生成入口解耦

- 去掉内容池 GET 的隐式生成副作用
- 增加显式生成启动接口
- 建立任务级生成进度

### 阶段 3：真实 AI 生成链路落地

- 把当前模板拼文替换为真实 AI 生成链路
- 每篇文章强制经过 AI 首稿、AI 改写、AI 降重、AI 风险修正、AI/规则复检
- 中间工序内部化
- 禁止占位正文进入内容池

### 阶段 4：文章级记录落地

- 每篇文章单独记录状态
- 列表只展示摘要和基础信息
- 详情查看正文

### 阶段 5：发布衔接

- 仅 `ready` / `pending_publish` 条目进入发布
- 保持现有发布链路复用
- 不再让用户在内容池里手动点“改写/降重/确认”

## 验收标准

- 创建任务页保存成功后出现 `开始生成`
- 不点击 `开始生成` 时，不自动开始生成文章
- 点击后按总篇数陆续出现文章记录
- 内容池首页显示任务总量和实时进度
- 列表只显示基础信息，不铺正文
- 详情能看到完整正文和图片
- 用户侧不再出现“样文、改写、复检、离散”等主流程字眼
- 生成中的动态提示允许出现“改写完成、降重完成、风险检查中”
- 内容池不再依赖 GET 隐式生成
- 任意文章不得是模板拼文或占位正文
- 每篇文章必须经过真实 AI 改写和降重
- 相似度过高文章不能进入 `ready`
- `npm run check` 通过
- 执行期前再评估 `npm run build:web`

## 风险

- 当前代码里已经存在模板拼文路径，实施时必须彻底切出主流程，否则会继续污染内容池结果
- 当前内容池与任务默认偏最新任务单例，进入多任务并行前要显式加 `taskId`
- 发布链路复用时要避免新状态模型破坏旧的 `publish jobs` 逻辑
