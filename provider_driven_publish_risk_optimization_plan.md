# 板块驱动账号级发布风险评估与优化方案

日期：2026-06-01

## 1. 背景

当前项目已经具备从任务创建、AI 提问句生成、内容生成、图片生成到今日头条自动发布的基础链路。但新的业务目标不再是“单平台发布”，而是：

- 用户在第一步选择的检索板块决定后续发布平台组合。
- 同一主题需要按平台和账号生成不同发布稿。
- 一个账号对应一篇内容。
- 不同平台下的标题、篇幅、结构、CTA 和表达风格需要匹配目标平台。
- 今日头条现有真发布链路继续保留，并作为后续平台接入模板。

因此，当前系统需要从“今日头条单平台草稿 + 账号绑定”升级为“板块驱动 + 平台组合 + 账号级发布稿 + 账号级任务”的发布模型。

## 2. 现有逻辑概览

当前项目中的关键现状如下：

- `searchProvider` 已经写入任务，但主要用于第一阶段检索和提问句生成，还没有进入发布链路。
- `SocialPlatform` 目前只支持 `toutiao`。
- `publishPlatformDescriptors` 目前只注册今日头条。
- 发布工作台当前默认生成今日头条草稿。
- 发布任务以 `draftId + accountId` 创建，但草稿本身仍是平台级草稿，不是账号级稿件。
- 账号中心和发布任务 API 明确限制只支持今日头条。
- Electron 自动化入口只解析今日头条脚本。
- 内容策略平台支持不完整，缺少百家号、视频号、知乎、微博、CSDN 等目标平台。

## 3. 核心风险点

### 3.1 平台类型被写死为今日头条

文件：`src/lib/types.ts`

当前：

```ts
export type SocialPlatform = "toutiao";
```

风险：

- 账号、草稿、任务、发布器都只能合法表达今日头条。
- 直接新增 UI 或自动化脚本会在类型、存储、API 校验处反复失败。
- 多平台扩展会变成零散补丁，而不是稳定模型升级。

### 3.2 发布平台描述只有头条

文件：`src/lib/publish/platforms.ts`

风险：

- 工作台、账号中心、发布入口、执行模式都没有统一平台元数据来源。
- 新平台无法被前端识别，也无法进入发布编排。
- 没有办法区分“已自动化”“仅手动”“计划接入”等平台状态。

### 3.3 工作台仍是平台草稿模型

文件：`src/lib/publish/workbench-service.ts`

当前 `buildDraft()` 固定构造今日头条草稿。

风险：

- 同平台多个账号时容易共用同一篇稿。
- 无法满足“一号一篇”。
- 平台差异、账号差异和发布任务差异没有数据边界。

### 3.4 Job 只保存草稿快照，没有账号稿身份

文件：`src/lib/publish/jobs-service.ts`

当前 Job 绑定 `draftId + accountId`，但没有 `accountPublishingDraftId`。

风险：

- 无法追踪“这个账号对应哪篇独立变体稿”。
- 重试时可能拿到已经变化的草稿状态。
- 发布审计、失败复盘、账号差异化生成都会混乱。

### 3.5 API 路由硬拦截非头条

文件：

- `src/app/api/publish/jobs/route.ts`
- `src/app/api/publish/accounts/route.ts`

风险：

- 即使前端和类型加入新平台，也无法创建账号或发布任务。
- 多平台扩展会卡在 API 层。
- 后续自动化脚本接入前缺少“手动/计划中”的中间状态。

### 3.6 内容策略平台不完整

文件：`src/lib/content/prompt-loader.ts`

当前只支持：

- `toutiao`
- `wechat`
- `blog`
- `xiaohongshu`
- `douyin`

缺少：

- `baijiahao`
- `videohao`
- `zhihu`
- `weibo`
- `csdn`

风险：

- 新平台内容生成会被 `normalizePlatform()` 静默降级成 `toutiao`。
- 平台风格、篇幅、标题规则和 CTA 会错乱。
- 无法可靠生成“同主题不同平台风格”的账号稿。

### 3.7 内容仍是单份 `ContentDraft`

文件：`src/lib/content/service.ts`

风险：

- 当前 `ContentDraft` 适合作为主题母稿，但不适合直接承担多平台、多账号变体稿。
- 如果直接复用单份内容发布到多个账号，会产生重复内容风险。
- 平台差异无法沉淀为结构化数据。

### 3.8 Electron 自动化入口只识别头条

文件：

- `electron/main.js`
- `src/lib/publish/platform-publishers/index.ts`

风险：

- 新平台没有自动化脚本时会直接执行失败。
- 缺少平台能力状态，会误把“未接入平台”当作“发布失败”。
- 如果同时接多个平台，调试成本和失败面会快速扩大。

## 4. 目标平台映射

按当前业务方案，检索板块和发布平台组合如下：

| 检索板块 | 发布平台组合 |
| --- | --- |
| 豆包 | 今日头条、百家号、抖音 |
| 元宝 | 视频号、微信公众号 |
| 通义千问 | 知乎、微博 |
| DeepSeek | 知乎、CSDN |

该映射应成为发布链路的源头配置，而不是散落在 UI 或服务函数中。

## 5. 优化方案

### 5.1 新增板块到平台组合配置层

新增文件：

```text
src/lib/publish/provider-platform-matrix.ts
```

建议能力：

```ts
getPlatformsBySearchProvider(searchProvider)
getProviderPublishBundle(searchProvider)
```

建议映射：

```ts
doubao -> ["toutiao", "baijiahao", "douyin"]
yuanbao -> ["videohao", "wechat"]
tongyi -> ["zhihu", "weibo"]
deepseek -> ["zhihu", "csdn"]
```

收益：

- 让 `searchProvider` 正式进入发布链路。
- 发布工作台可以根据任务来源自动展示目标平台组。
- 后续平台变更只改配置，不改业务代码。

### 5.2 扩展平台基础模型

修改文件：

```text
src/lib/types.ts
src/lib/publish/platforms.ts
```

建议将 `SocialPlatform` 扩展为：

```ts
export type SocialPlatform =
  | "toutiao"
  | "baijiahao"
  | "douyin"
  | "wechat"
  | "videohao"
  | "zhihu"
  | "weibo"
  | "csdn";
```

建议平台描述增加字段：

```ts
automationStatus: "ready" | "manual_only" | "planned";
contentProfile: string;
```

策略：

- 今日头条保持 `ready`。
- 新平台初期全部设为 `manual_only` 或 `planned`。
- 自动化脚本打通后再逐个平台切到 `ready`。

### 5.3 新增账号级发布稿模型

不要立刻删除 `PublishingDraft`，建议新增：

```ts
export interface AccountPublishingDraft {
  id: string;
  taskId: string;
  platform: SocialPlatform;
  accountId: string;
  accountName?: string;
  searchProvider: SearchProvider;
  sourceContentTaskId?: string;
  sourceTheme?: string;
  title: string;
  body: string;
  tags: string[];
  coverImageUrl?: string;
  imageUrls: string[];
  localImagePaths: string[];
  publishMode?: "text_only" | "with_images";
  publishEntryUrl?: string;
  styleProfile?: string;
  contentLengthProfile?: string;
  updatedAt: string;
}
```

收益：

- 真正表达“一号一篇”。
- 同平台多个账号可以生成不同标题和正文。
- Job 可以稳定追踪具体账号稿件。

### 5.4 新增发布编排层

新增文件：

```text
src/lib/publish/publish-orchestrator.ts
```

职责：

1. 读取任务和 `searchProvider`。
2. 根据 `provider-platform-matrix` 获取目标平台组。
3. 获取目标平台下可用账号。
4. 为每个账号生成或刷新账号发布稿。
5. 聚合返回工作台数据。
6. 为每个账号稿创建独立发布任务。

收益：

- 避免发布逻辑散落在 `workbench-service.ts` 和前端组件中。
- 新业务主流程清晰：任务 -> 板块 -> 平台组 -> 账号 -> 发布稿 -> Job。
- 后续扩平台时只接编排层，不破坏头条现有链路。

### 5.5 内容生成升级为“母稿 + 账号变体”

当前 `ContentDraft` 保留为主题母稿。

新增账号变体生成函数，例如：

```ts
generateAccountPublishingDraft(taskId, accountId, platform)
```

平台风格建议：

| 平台 | 内容风格 |
| --- | --- |
| 今日头条 | 长图文分析稿，标题强判断，段落短 |
| 百家号 | 知识解释型图文，信息密度略高 |
| 抖音 | 短标题、短段落、口播/图文脚本 |
| 微信公众号 | 长文，逻辑完整，阅读连续性强 |
| 视频号 | 短文案，节奏型表达，适合配视频 |
| 知乎 | 问答体或分析回答体 |
| 微博 | 短观点，可拆条，传播性更强 |
| CSDN | 经验、技术、方法论结构 |

需要同步扩展：

```text
src/lib/content/prompt-loader.ts
skills/platform-article-structure/platform-strategies/baijiahao.json
skills/platform-article-structure/platform-strategies/videohao.json
skills/platform-article-structure/platform-strategies/zhihu.json
skills/platform-article-structure/platform-strategies/weibo.json
skills/platform-article-structure/platform-strategies/csdn.json
```

### 5.6 发布工作台改成账号视角

修改文件：

```text
src/components/publish/publish-workbench.tsx
src/lib/publish/workbench-service.ts
```

建议展示结构：

```text
任务
  -> 来源板块
  -> 目标平台分组
    -> 账号卡片
      -> 账号级发布稿
      -> 发布任务
      -> 状态和日志
```

行为调整：

- 工作台不再默认只生成今日头条草稿。
- 根据 `searchProvider` 展示目标平台组。
- 每个平台下展示账号。
- 每个账号对应一篇独立稿。
- 每个账号单独创建 Job、单独重试、单独补录结果。

### 5.7 发布任务改成账号级任务

修改文件：

```text
src/lib/publish/jobs-service.ts
src/app/api/publish/jobs/route.ts
src/app/api/publish/jobs/[jobId]/route.ts
```

建议 `PublishingJobRecord` 增加：

```ts
accountPublishingDraftId?: string;
sourceSearchProvider?: SearchProvider;
automationStatus?: "ready" | "manual_only" | "planned";
```

创建任务时：

- 每个账号稿创建一条 Job。
- Job 绑定 `accountPublishingDraftId`。
- 如果平台未自动化，创建 `manual_pending` 或直接阻止自动执行。

### 5.8 账号中心升级为多平台统一管理

修改文件：

```text
src/components/publish/platform-account-center.tsx
src/app/api/publish/accounts/route.ts
src/app/api/publish/accounts/login/route.ts
src/lib/publish/accounts-service.ts
```

目标：

- 按平台展示账号。
- 支持创建多个平台账号。
- 显示平台能力状态。
- 未自动化平台可以先允许“账号记录 + 手动发布”。
- 自动化平台再启用登录检测和自动发布。

### 5.9 逐个平台接入 Electron 自动化

修改或新增：

```text
electron/main.js
electron/publish-automation/baijiahao.js
electron/publish-automation/douyin.js
electron/publish-automation/wechat.js
electron/publish-automation/videohao.js
electron/publish-automation/zhihu.js
electron/publish-automation/weibo.js
electron/publish-automation/csdn.js
src/lib/publish/platform-publishers/index.ts
```

推荐接入顺序：

1. 百家号：与头条最像，复用度最高。
2. 抖音：业务优先级高。
3. 公众号/视频号：微信生态共性较多。
4. 知乎：文本型平台，适合问答体。
5. 微博：短内容，发布简单但登录和风控容易变。
6. CSDN：更偏技术/方法论结构，最后接入。

原则：

- 不同时接入所有平台。
- 每个平台先完成平台描述、账号记录、手动发布状态，再接自动化。
- 今日头条现有自动发布链路不做破坏性改造。

## 6. 推荐落地顺序

### 阶段 1：配置和类型基础

1. 新增 `provider-platform-matrix.ts`。
2. 扩展 `SocialPlatform`。
3. 扩展 `publishPlatformDescriptors`。
4. 增加平台能力状态字段。

验收：

- 不同 `searchProvider` 能得到正确平台组合。
- 平台描述能覆盖 8 个目标平台。
- 今日头条现有发布不受影响。

### 阶段 2：账号中心多平台化

1. 账号中心取消“只允许头条”的限制。
2. 按平台展示账号。
3. 支持新平台账号记录创建。
4. 未自动化平台显示为手动或计划接入。

验收：

- 可创建百家号、抖音、公众号、视频号、知乎、微博、CSDN 账号记录。
- 头条账号登录检测保持可用。

### 阶段 3：账号级发布稿

1. 新增 `AccountPublishingDraft`。
2. 新增账号稿存储函数。
3. `publish-orchestrator` 按账号生成发布稿。
4. 工作台展示账号稿。

验收：

- 同一平台多个账号会生成多篇独立稿。
- 同一主题不同平台稿件标题、正文结构、篇幅有明显差异。

### 阶段 4：账号级 Job

1. Job 增加 `accountPublishingDraftId`。
2. Job 创建逻辑按账号稿创建。
3. 未自动化平台进入 `manual_pending`。
4. 头条平台继续走现有自动化。

验收：

- 一个账号稿对应一条发布任务。
- 重试时可准确找到原账号稿。
- 头条自动发布无回归。

### 阶段 5：补齐内容策略

1. 扩展 `SUPPORTED_PLATFORMS`。
2. 新增五个策略 JSON。
3. 账号稿生成时注入平台策略。

验收：

- 平台不再静默降级为头条。
- 各平台稿件符合各自篇幅和结构要求。

### 阶段 6：逐个平台自动化

按推荐顺序逐个平台接入 Electron 脚本。

验收：

- 每个平台都完成登录、会话校验、发布页注入、内容填写、提交、结果核验。
- 未接入平台不会被误判为自动发布失败。

## 7. 验收清单

- 豆包任务发布工作台只出现今日头条、百家号、抖音。
- 元宝任务发布工作台只出现视频号、微信公众号。
- 通义任务发布工作台只出现知乎、微博。
- DeepSeek 任务发布工作台只出现知乎、CSDN。
- 同平台多个账号时，每个账号都有独立发布稿。
- 同一主题在不同平台下标题、篇幅、段落结构和 CTA 明显不同。
- 今日头条现有自动发布链路不回归。
- 新平台未自动化前显示为手动或计划接入，不误触自动发布。
- Job 能追踪到具体账号稿。
- 重试发布使用的是对应账号稿，而不是平台共享草稿。

## 8. 关键结论

本项目当前最需要优化的不是直接新增多个平台脚本，而是先把发布链路的核心模型升级：

```text
任务 -> 检索板块 -> 发布平台组合 -> 平台账号 -> 账号级发布稿 -> 账号级发布任务
```

只有先完成这层模型升级，后续平台自动化接入才会稳定。否则会出现平台类型不统一、草稿复用错误、账号稿无法追踪、Job 重试混乱和内容风格错配等问题。

推荐采用渐进式改造：保留今日头条已打通链路，先补配置、类型、账号稿、编排层和工作台，再逐个平台接入自动化。
