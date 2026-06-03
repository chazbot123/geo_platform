# GEO 发布链路接手文档

日期：2026-06-03

目标仓库：`https://github.com/chazbot123/geo_platform.git`

当前接手重点：把 GEO 从“生成内容”推进到“可登录账号、可生成平台草稿、可通过 Electron 自动化或手动交付发布”的闭环。本文面向下一位接手工程师，说明当前状态、关键模块、已验证链路、未完成风险和推荐继续顺序。

## 1. 当前结论

发布链路不是单一 API 链路，而是三类路径并存：

1. 官方 API：仅在平台开放能力、应用审核、账号授权和 scope 都满足时使用。
2. Electron 浏览器自动化：用于 Toutiao、Baijiahao、Douyin 等账号登录后可脚本操作的平台。
3. 账号登录 + 手动交付：用于 Weibo、Zhihu、CSDN、Videohao 等暂不稳定或不适合假设公开写入 API 的平台。

产品上必须把“账号登录是否可用”和“是否支持自动发布”分开显示。用户当前要的是登录真实账号，而不是创建一个手动账号占位。

## 2. 本地工作区状态

本地目录：`D:\geo`

当前工作区是混合状态：

- 有大量已修改、已暂存和未跟踪文件。
- 不要运行 `git reset --hard`、`git checkout -- .` 或清理未跟踪文件。
- 当前本地状态应视为多个阶段性改动叠加后的工作区。
- 本文档分支只应提交接手文档，避免把未确认归属的代码一起推送。

关键注意：

- `electron/main.js` 里已有发布自动化、会话校验和 WeChat 相关改动。
- `src/lib/publish/*`、`src/components/publish/*`、`src/app/api/publish/*` 有多处发布工作台改动。
- `docs/geo-model-publish-chain-brainstorm.md` 是模型到平台发布链路的详细任务流，应继续作为发布链路规划依据。

## 3. 端到端流程

推荐继续围绕以下流水线收敛：

1. 创建任务：输入产品、品牌、地区、受众、场景和本地素材。
2. 生成 AI 搜索问题：按 Doubao、Tongyi、DeepSeek、Yuanbao/Hunyuan 等 provider 生成问题。
3. 选择问题束：用户确认要覆盖的 AI 搜索问题。
4. 生成权威内容：按 AI 场景模板和平台策略生成结构化正文。
5. 内容审查：输出风险词、缺失覆盖、平台不适配点。
6. 生成平台草稿：标题、正文、标签、图片、账号级草稿。
7. 发布执行：
   - API 可用则走官方 API。
   - API 不可靠但浏览器可操作则走 Electron 自动化。
   - 自动化不可稳定验证则走账号登录 + 手动交付。

## 4. 平台路由矩阵

当前推荐矩阵：

| Provider | 推荐平台 | 发布方式 |
| --- | --- | --- |
| Doubao / Volcano Ark | Toutiao | Electron 自动化优先 |
| Doubao / Volcano Ark | Baijiahao | Electron 自动化优先 |
| Doubao / Volcano Ark | Douyin | Electron 脚本路径，避免宣称官方 API 已通 |
| Tongyi / Qwen | Zhihu | 账号登录 + 手动交付 |
| Tongyi / Qwen | Weibo | 账号登录 + 手动交付 |
| DeepSeek | CSDN | 账号登录 + 手动交付 |
| DeepSeek | Zhihu | 账号登录 + 手动交付 |
| Yuanbao / Hunyuan | WeChat Official Account | 官方 API 可作为强路线，但必须接入授权和 publish 状态查询 |
| Yuanbao / Hunyuan | Videohao | 账号登录 + 手动交付或后续 Electron |

不要把 Douyin 写成官方 API 已打通。Douyin 对新号和低信任账号不友好，脚本路径会遇到验证码、风控、投稿限制和审核不确定性。

## 5. 模型适配器

关键文件：

- `src/lib/integrations/openai-compatible.ts`
- `src/lib/integrations/stage1/client.ts`
- `src/lib/integrations/content/client.ts`
- `src/lib/config/service.ts`

当前方向：

- 保留 OpenAI-compatible adapter。
- Provider-aware endpoint normalization 必须明确区分 OpenAI、NewAPI、Volcano Ark、DeepSeek、DashScope/Qwen。
- Doubao / Volcano Ark 标准地址应规范到：
  - base：`https://ark.cn-beijing.volces.com/api/v3`
  - chat completions：`https://ark.cn-beijing.volces.com/api/v3/chat/completions`

继续工作：

- 给 Ark base URL、`/api/v3`、`/api/v3/chat/completions` 加测试。
- NewAPI auto-detect 要保留，但需要显示探测结果和失败尝试。
- 错误要区分 timeout、auth、404/405、bad JSON、模型输出解析失败。

## 6. 发布账号和会话校验

关键文件：

- `src/components/publish/platform-account-center.tsx`
- `src/app/api/publish/accounts/login/route.ts`
- `src/lib/publish/account-session-validator.ts`
- `electron/main.js`

已确认的问题：

- Weibo 已登录页面仍可能包含“登录”文字。
- 如果用页面全文包含 `"登录"` 作为失败条件，会误判成“页面显示登录提示：登录”。

修复方向：

- 不要使用裸 `"登录"`、`"注册"` 作为强登录失败信号。
- 登录失败应优先依据：
  - URL 命中真实登录页，例如 `/login`、`/newlogin`、`passport`、`signin`。
  - 页面存在可见的手机号、密码、验证码、扫码登录、账号登录等登录控件。
- 已登录页面上的导航、弹窗入口或营销文案不应直接导致失败。

已验证结果：

- Electron bridge：`http://127.0.0.1:3217/health` 返回 ready。
- Weibo 账号 `52cd9429-785b-4bad-a0fb-07f594a2ed21` 复核结果：`authenticated`。
- 复核 URL：`https://weibo.com/`。
- 检测到 5 个会话 Cookie。

不要在日志、文档或错误信息里输出 Cookie、token、authorization header、session payload。

## 7. Electron 自动化

关键文件：

- `electron/main.js`
- `electron/local-bridge.js`
- `electron/publish-automation/toutiao.js`
- `electron/publish-automation/baijiahao.js`
- `electron/publish-automation/douyin.js`
- `electron/publish-automation/dom-helpers.js`
- `src/lib/publish/platform-publishers/electron-browser-publisher.ts`

当前原则：

- 自动化必须有稳定阶段名。
- 自动化结果必须返回标准结构：
  - `status`
  - `draftUrl`
  - `publishUrl`
  - `verificationUrl`
  - `executionLog`
  - `verificationEvidence`
  - `failureStage`
  - `errorMessage`
- 不能只因为“点了提交按钮”就返回发布成功。必须等待平台反馈、草稿页变化、审核状态或可解释的阻塞诊断。

Douyin 注意：

- 使用脚本路径，不是官方 API。
- 新号可能被验证码、实名、风控、审核、投稿限制拦截。
- UI 文案应标注“Electron 自动化”及账号成熟度风险。

## 8. 发布服务

关键文件：

- `src/lib/publish/workbench-service.ts`
- `src/lib/publish/publish-orchestrator.ts`
- `src/lib/publish/jobs-service.ts`
- `src/lib/publish/draft-builders.ts`
- `src/lib/publish/provider-platform-matrix.ts`
- `src/lib/publish/platforms.ts`

继续工作：

- 用一个共享 draft builder 生成平台草稿和账号草稿。
- `getDraftForJob` 不能继续返回空结果，必须能从 job 找回源 draft。
- 发布 job 要有明确状态机，不要任意 patch 状态。
- 发布前 invariant：
  - 没有标题不能发布。
  - 没有正文不能发布。
  - 需要自动化的平台必须有有效账号 session。
  - 自动化不可用时必须保留手动交付说明。

## 9. UI 接手要求

关键文件：

- `src/app/publish/page.tsx`
- `src/components/publish/platform-account-center.tsx`
- `src/components/publish/publish-workbench.tsx`
- `src/components/settings/settings-form.tsx`

UI 必须清楚区分：

- `已自动化`：可通过 Electron 自动执行。
- `账号登录`：支持真实账号登录，但发布可能仍需手动交付。
- `手动发布`：可导出或复制草稿，由用户在已登录页面完成。
- `计划接入`：只能用于确实还没有登录/草稿/交付路径的平台。

用户已经明确反对：

- 把已支持登录的平台显示成“计划接入”。
- 把真实账号登录说成“创建手动账号”。
- 把 Douyin 说成官方 API 链路。

## 10. 验证命令

本次已运行并通过：

```powershell
node --check electron\main.js
npm run check
```

本次尝试过但未完成：

```powershell
npm run build:web
```

原因：用户中断了长时间运行的 `next build`。当前同时有 `next dev` 和 Electron runner 在运行，完整 build 可能和 dev server 争用 `.next` 目录。建议下一位工程师在需要完整构建验证时先停 dev server，再运行：

```powershell
npm run build:web
```

## 11. 推荐下一步顺序

1. 固化账号登录校验测试：覆盖 Weibo 已登录页、Weibo `/newlogin`、无 Cookie session、含泛化“登录”文案但不是登录页的页面。
2. 把发布 job 状态机收敛到一个服务层。
3. 完成 `getDraftForJob`，确保发布任务可追溯到草稿。
4. 把 Electron 自动化脚本继续拆成 DOM helper、平台填充、提交、验证四层。
5. 在 UI 增加四个状态面板：模型探测、内容审查、草稿路由、发布执行。
6. 对 Doubao / Ark endpoint normalization 加专门测试。
7. 只在确认平台官方权限后接入官方 API，否则保持 Electron 或手动交付。

## 12. 给下一位工程师的硬规则

1. 不要重置工作区。
2. 不要提交 `.next`、`dist`、runtime `data`、本地 session、bridge artifact。
3. 不要记录或打印账号 Cookie、token、授权 header。
4. 不要把“账号登录可用”等同于“自动发布已通”。
5. 不要把 Douyin 当作官方 API 已打通。
6. 每次只改一个域：模型适配器、内容策略、发布服务、Electron 自动化、存储、UI。
7. 改完至少跑 `npm run check`；涉及 Electron 主进程时跑 `node --check electron\main.js`。

