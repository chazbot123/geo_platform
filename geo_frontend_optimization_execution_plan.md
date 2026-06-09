# GEO 前端体验优化执行计划

日期：2026-06-08

## 目标

在当前五步 GEO 工作流基础上继续优化前端体验和最低必要数据支持，使产品更像稳定的本地生产工具，而不是简单页面拼接。

本轮不重写发布链路或 Electron 自动化主体。重点是把现有能力重新组织到正确入口、补齐保存态、图标化平台选择、账号登录信息展示、模型设置、服务端意见反馈、用户更新入口，并修复深色主题可读性。

新增服务端方向：

- `8.134.115.153` 作为反馈、后台管理、设备授权、版本更新的服务端入口。
- 先用 Docker 搭数据库和后台管理服务。
- 意见反馈先上线可用；设备指纹一机一码授权先预留数据结构和后台页面入口，后续再接入授权校验。
- 更新系统先做“检查更新入口 + 服务端版本 manifest + 下载新版本安装包”的方案，不在客户端放源码更新逻辑。

## 当前基线

当前分支：

```text
geo-five-step-rebuild-20260608
```

远端对齐状态（2026-06-08 已执行 `git fetch origin --prune`）：

```text
当前 HEAD = origin/geo-five-step-rebuild-20260608 = 1f3965a rebuild geo five step workflow
origin/HEAD -> origin/main = a4a2871 Restore multi-platform draft workbench and publish updates
```

说明：当前执行分支已和 GitHub 同名远端分支对齐；`origin/main` 仍是线上主线基线，不包含当前五步重建分支的大量新增内容。不要在未协调的情况下把当前分支直接重置或回退到 `origin/main`。

当前工作树已有修改，任何执行者不得覆盖：

```text
 M AGENTS.md
 M .gitignore
 M package.json
?? "AGENTS（new).md"
?? geo_frontend_optimization_execution_plan.md
?? src/img/
```

当前 `.gitignore` 增加了 `release-dir/`；`package.json` 将 `dist:installer` 指向 `npm run dist`，并把 Windows 打包 target 调整为 `dir`。后续处理更新系统和 release 产物时必须先确认这两个改动是否保留。

已确认 `src/img` 包含平台图标：

```text
csdn.svg
deepseek.svg
百家号-nh.svg
抖音.svg
豆包.svg
公众号.svg
今日头条.svg
视频号.svg
腾讯元宝.svg
通义千问.svg
微博.svg
小红书.svg
知乎.svg
```

## 头脑风暴结论

推荐方案：在现有五步工作流上做“结构升级”，同时新增一个轻量服务端运营面板，不另起一个账号中心或新设置系统。

原因：

- 账号登录、检测、发布平台描述、任务保存、内容池和执行发布已有服务基础，重做会破坏 Phase 1 已形成的数据语义。
- 用户明确要求复用原本登录账号入口，并把入口放入创建任务模块。
- 设置入口已经被降级为侧边栏次级入口，只需要命名、默认值、反馈箱和视觉层级优化。
- 导航打勾必须从真实保存状态读取，不能继续用“当前步骤之后自动打勾”的视觉假象。
- 意见反馈、授权、更新都需要远端状态，继续本地 JSON 无法满足后续运营和发版。

备选方案已排除：

- 只改文案和颜色：工作量小，但账号入口、导航完成态、反馈服务端化和更新入口仍是错的。
- 重做完整设计系统：能统一视觉，但会扩散到全部业务组件，风险超过本轮目标。
- 在客户端直接写数据库：实现看似简单，但会暴露数据库连接和权限，不能采用。

## 范围

### 1. 模型设置

要求：

- 侧边栏入口从“设置”改为“模型设置”。
- 设置页标题保持“模型设置”。
- 服务商默认第一选择是 GPT。
- 文字模型默认名称为 `gpt5.5`。
- 图片模型默认名称为 `gpt-image2`。
- 仍保留服务商、接口地址、模型名称、API Key、连接测试。
- 不在主路径暴露高级参数。

建议实现：

- 更新 `src/lib/config/defaults.ts`：
  - `stage1ModelApiConfig.provider = "openai"`
  - `contentModelApiConfig.provider = "openai"`
  - `contentModelApiConfig.modelName = "gpt5.5"`
  - `imageModelApiConfig.provider = "openai"`
  - `imageModelApiConfig.modelName = "gpt-image2"`
- 更新 `src/components/settings/settings-form.tsx`：
  - provider 下拉中 GPT 排第一。
  - 空模型名可通过默认值回填，但不得覆盖用户已保存配置。
- 更新 `src/components/layout/app-shell.tsx`：
  - 次级入口显示“模型设置”。

### 2. 创建任务内嵌账号入口与纵向平台导航

要求：

- 复用仓库原本的登录账号入口。
- 账号登录入口放在“创建任务”模块内。
- GEO AI 平台、发布平台、账号做成类似导航栏的二级结构。
- GEO AI 平台导航改为纵向排列。
- 发布平台二级导航也改为纵向排列。
- 左侧是纵向平台列表，右侧是账号列表。
- 平台全部用 `src/img` 中的 SVG 图标，不再只用文字卡片。
- 账号列表展示登录入口、头像、账号名、账号 ID。
- 登录后尽量从平台页面/会话检测结果提取头像、账号名、账号 ID，并写回账号记录。
- 本轮按“前问”为“千问”的笔误处理：小红书只默认归到千问下，豆包和元宝不再默认展示小红书；DeepSeek 仍不展示小红书。

推荐结构：

```text
创建任务
├─ 左侧 GEO AI 平台纵向导航
│  ├─ 豆包
│  ├─ DeepSeek
│  ├─ 元宝
│  └─ 千问
└─ 二级账号区
   ├─ 左：当前 GEO AI 平台映射出的发布平台纵向图标列表
   │  ├─ 今日头条
   │  ├─ 百家号
   │  └─ ...
   └─ 右：当前发布平台账号列表
      ├─ 已登录账号：头像、账号名、账号 ID、状态、最近校验时间
      ├─ 未登录空态：登录按钮
      └─ 刷新检测：30 分钟缓存 + 手动刷新
```

图标映射：

```text
doubao -> src/img/豆包.svg
deepseek -> src/img/deepseek.svg
yuanbao -> src/img/腾讯元宝.svg
tongyi -> src/img/通义千问.svg
toutiao -> src/img/今日头条.svg
baijiahao -> src/img/百家号-nh.svg
douyin -> src/img/抖音.svg
xiaohongshu -> src/img/小红书.svg
wechat -> src/img/公众号.svg
videohao -> src/img/视频号.svg
zhihu -> src/img/知乎.svg
weibo -> src/img/微博.svg
csdn -> src/img/csdn.svg
```

本轮默认映射调整：

```text
豆包 -> 今日头条, 百家号, 抖音
DeepSeek -> CSDN, 知乎
元宝 -> 微信公众号, 视频号
千问 -> 知乎, 微博, 小红书
```

说明：

- 小红书只在千问下默认出现。
- 用户不能在 Phase 1 自由添加未映射平台。
- 后续如果要恢复“豆包/元宝也支持小红书”，应通过服务配置或产品开关处理，不在本轮硬编码扩散。

数据要求：

- `PlatformAccountRecord` 已有 `avatarUrl`，UI 应直接使用。
- `PublishableAccountSummary` 当前缺少 `avatarUrl`，需要补上窄字段。
- 登录结果如果无法爬取头像或平台账号 ID，不阻塞保存，显示账号记录 ID。
- 可发布账号仍只统计 `loginStatus === "authenticated"` 且 `status === "valid"` 的账号。

### 3. 意见反馈箱与服务端后台

要求：

- 放在“模型设置”的下面。
- 列出几个问题类型。
- 允许输入具体问题。
- 提交后发送到 `8.134.115.153` 服务器。
- 用 Docker 在服务器上搭数据库。
- 增加后台管理网页，用于查看和处理意见反馈。
- 同一个后台后续承接设备指纹一机一码授权。

建议问题类型：

- 模型连接问题
- 内容生成问题
- 账号登录问题
- 发布失败问题
- 界面体验问题
- 其他问题

客户端最低实现：

- 新增 `src/components/settings/feedback-box.tsx`。
- 新增 `src/lib/feedback/client.ts` 或通过 `src/app/api/feedback/route.ts` 做转发。
- 提交 payload：
  - `id`
  - `type`
  - `message`
  - `contact`
  - `appVersion`
  - `deviceFingerprint`
  - `platform`
  - `clientTime`
  - `createdAt`
- 提交成功显示“已提交”。
- 服务器不可达时显示“提交失败，可稍后重试”，并可先落本地 pending 队列。

服务端最低实现：

- 新增独立后台服务目录，建议：
  - `server/admin-api/**`
  - `server/admin-web/**`
  - `deploy/docker-compose.yml`
- Docker Compose 服务：
  - `postgres`：保存反馈、设备、授权码、版本信息。
  - `admin-api`：提供反馈提交、后台管理、授权预留、更新 manifest API。
  - `admin-web`：后台管理页面。
  - `nginx`：反向代理和静态 release 文件下载。
- 数据库建议使用 PostgreSQL。
- 管理后台第一期功能：
  - 登录保护。
  - 反馈列表。
  - 按问题类型、状态、版本、设备筛选。
  - 查看详情。
  - 标记状态：新建、处理中、已处理、忽略。
- 设备指纹一机一码授权先预留：
  - 设备列表。
  - 授权码列表。
  - 绑定关系。
  - 过期时间。
  - 禁用状态。

反馈表建议字段：

```text
id
type
message
contact
app_version
device_fingerprint
device_label
os
client_time
server_time
status
handler_note
created_at
updated_at
```

设备授权预留表：

```text
devices
- id
- fingerprint
- machine_code
- device_label
- first_seen_at
- last_seen_at
- status

license_codes
- id
- code
- max_devices
- expires_at
- status
- created_at

device_license_bindings
- id
- device_id
- license_code_id
- bound_at
- revoked_at
- status
```

### 4. 用户更新系统入口

要求：

- 增加一个用户可点击的“检查更新”入口。
- 点击后对比 `8.134.115.153` 服务器上的最新版本。
- 如果服务端有新版本，引导下载并更新。

推荐入口：

- 放在“模型设置”页面底部，和意见反馈同级。
- 也可以在侧边栏底部增加小入口“检查更新”，但不要放入五步主流程。

服务器上放什么：

- 不建议把源码放在服务器作为客户端更新源。
- 源码留在 Git 仓库和构建机器/CI。
- 服务器只放发布产物、版本描述文件、校验和、更新说明。
- 每次发版由构建机生成 Windows 安装包、校验和、版本 manifest，再上传到服务器。

服务器 release 文件建议：

```text
/releases/
  latest.json
  GEO-Desktop-0.2.0-Setup.exe
  GEO-Desktop-0.2.0-Setup.exe.sha256
  GEO-Desktop-0.2.0-notes.md
```

如果后续接入 `electron-updater`，可以改用 electron-builder 标准产物：

```text
/releases/
  latest.yml
  GEO桌面版 Setup 0.2.0.exe
  GEO桌面版 Setup 0.2.0.exe.blockmap
```

第一期推荐使用自定义 `latest.json`，更容易控制：

```json
{
  "version": "0.2.0",
  "channel": "stable",
  "minSupportedVersion": "0.1.0",
  "publishedAt": "2026-06-08T10:00:00.000Z",
  "notes": "更新说明",
  "windows": {
    "url": "https://8.134.115.153/releases/GEO-Desktop-0.2.0-Setup.exe",
    "sha256": "PLACEHOLDER",
    "size": 123456789
  },
  "mandatory": false
}
```

客户端更新流程：

1. 用户点击“检查更新”。
2. 客户端请求 `https://8.134.115.153/api/releases/latest?platform=win32&arch=x64&version=<currentVersion>`。
3. 服务端返回当前最新版本、下载地址、sha256、更新说明。
4. 客户端比较语义版本号。
5. 无新版本：显示“已是最新版本”。
6. 有新版本：显示版本号、更新说明、文件大小和“下载更新”按钮。
7. 下载完成后校验 sha256。
8. 校验通过后打开安装包或交给 Electron updater。
9. 校验失败则删除下载文件并提示重试。

安全要求：

- 正式使用前必须配置域名和 HTTPS，不建议长期裸用 IP + HTTP。
- release 文件必须带 sha256。
- 客户端不得执行服务端返回的任意脚本。
- 服务器只提供安装包和静态更新文件，不向客户端下发源码。
- 如确需脚本，只能是版本内置脚本，由安装包签名和版本校验保护。

### 5. 深色主题可读性

问题：

- 深色主题中部分灰色字、描边、禁用态、详情文本对比度不足。

要求：

- 提高 `--color-muted`、`--color-stroke`、`--color-panel-soft` 的暗色对比。
- 检查 `text-muted/60`、`text-muted/70`、`opacity-60`、`bg-white/5` 等组合。
- 不增加重发光和重玻璃效果。
- 暗色主题应更沉稳清晰，文字优先。

建议调整：

- `--color-muted` 暗色从 `151 164 173` 提高到接近 `176 187 195`。
- 禁用态不要只靠低透明度，配合图标/文案状态表达。
- 对账号 ID、检测时间、错误详情这类小字，使用 `text-xs text-muted`，避免 `text-muted/60`。

### 6. 前端高级感优化

方向：

- 继续保持简洁，但提高信息层级、间距、细节状态和图标一致性。
- 不做营销页，不做 dashboard-heavy 首页。
- 不使用渐变光球、复杂玻璃、过度阴影。
- 主要增强：
  - 更明确的页面标题区。
  - 更紧凑的操作工具栏。
  - 平台图标导航。
  - 保存态和校验态。
  - 列表空态和加载态。
  - 暗色主题可读性。

建议视觉语言：

- 背景保持低噪声，减少装饰存在感。
- 卡片只用于真实输入、账号、候选问题、内容条目、反馈记录。
- 平台选择用图标 + 标签 + 轻量状态线。
- 保存后导航打勾用真实完成状态。
- 页面内长说明压缩为短状态、短提示和按钮文案。

### 7. 导航栏保存后才打勾

当前问题：

- `AppShell` 里通过 `activeIndex > index` 推断前面步骤完成，用户未保存也可能显示完成。

要求：

- 每个模块点击保存且本地持久化成功后，导航栏对应步骤才打勾。
- 页面跳转不能自动打勾。

推荐实现：

- 新增工作流状态服务：
  - `src/lib/workflow/status-service.ts`
  - `src/app/api/workflow/status/route.ts`
- `AppShell` 客户端加载 `/api/workflow/status`。
- 完成态定义：
  - 企业信息：必填字段存在且 `lastSavedAt` 存在。
  - 客户关键词：已保存且 selected questions 正好 5 个。
  - 创建任务：存在 `publishPlan` 且 `totalArticleCount > 0`。
  - 内容池：当前任务有内容池 items，且至少生成过样文或待发布内容。
  - 执行发布：当前任务有发布进度或至少有 published/manual_pending/failed job 记录。
- 保存动作成功后派发轻量事件：
  - `window.dispatchEvent(new Event("geo-workflow-status-refresh"))`
- `AppShell` 监听该事件刷新状态。

## 推荐执行顺序

### Phase 0：基线确认

串行。

任务：

- 运行 `git status --short --branch`。
- 记录当前脏文件。
- 确认 `src/img` 图标文件存在。
- 运行 `npm run check`，记录真实 baseline。

### Phase 1：状态与设置

可并行拆分，但建议先完成导航状态服务。

任务：

- 实现真实保存态驱动的导航打勾。
- 模型设置命名与默认值调整。

### Phase 2：创建任务账号结构

串行或一个主 worker。

任务：

- 抽出平台图标映射 helper。
- 改造 `TaskPlanningWorkbench` 为 GEO AI 平台纵向导航 + 发布平台纵向图标导航 + 右侧账号列表。
- 调整内置映射：小红书只默认归到千问下。
- 复用 `PlatformAccountCenter` 的登录函数或抽出更小的账号登录组件。
- 账号列表显示头像、账号名、账号 ID、状态、登录入口。
- 保持任务总文章数计算不变。

### Phase 3：服务端反馈与后台基础

建议串行，先搭服务端契约，再接客户端。

任务：

- 用 Docker Compose 建 PostgreSQL、admin-api、admin-web、nginx。
- 建反馈表和设备授权预留表。
- 实现反馈提交 API。
- 实现后台反馈列表和详情。
- 在模型设置下方添加反馈箱并发送到服务端。
- 服务器不可达时给出明确错误，可选本地 pending 队列。
- 运行 `npm run check`。

### Phase 4：更新系统入口

建议串行。

任务：

- 服务端实现 release manifest API。
- 服务器静态托管 release 文件。
- 客户端增加“检查更新”入口。
- 客户端比较当前版本和服务端版本。
- 有新版本时展示更新说明和下载入口。
- 下载前后校验 sha256。
- 不从服务器下发源码或任意脚本。
- 运行 `npm run check`。

### Phase 5：视觉整合

可并行，但需要避开 `TaskPlanningWorkbench` 冲突。

任务：

- 做全局视觉统一和响应式检查。
- 修复深色主题低对比灰字。
- 检查创建任务的纵向导航和账号列表在桌面/移动端不溢出。
- 运行 `npm run check`。

### Phase 6：集成验收

串行。

任务：

- 运行 `npm run check`。
- 运行 `npm run build:web`。
- 启动 `npm run dev:web` 并检查：
  - `/enterprise`
  - `/customer-keywords`
  - `/tasks/create`
  - `/content-pool`
  - `/publish-execution`
  - `/settings`
- 检查服务端：
  - `https://8.134.115.153/api/feedback`
  - `https://8.134.115.153/admin`
  - `https://8.134.115.153/api/releases/latest`
- 记录检查结果和剩余风险。

## 验收清单

- 侧边栏次级入口显示“模型设置”。
- 模型设置服务商下拉默认第一项为 GPT。
- 文字模型默认 `gpt5.5`。
- 图片模型默认 `gpt-image2`。
- 模型设置下方有意见反馈箱。
- 反馈箱支持问题类型和具体问题输入，并发送到 `8.134.115.153`。
- 服务器 Docker 数据库可保存反馈。
- 后台管理网页可查看反馈。
- 后台预留设备指纹和一机一码授权数据结构。
- 模型设置或侧边栏有检查更新入口。
- 检查更新会对比服务端版本。
- 新版本可展示更新说明和下载入口。
- 服务端只存 release 文件、manifest、校验和，不存源码作为客户端更新源。
- 创建任务中可以直接进入账号登录。
- GEO AI 平台和发布平台均使用 `src/img` 对应 SVG。
- 创建任务 GEO AI 平台为纵向导航。
- 创建任务发布平台为纵向二级导航。
- 小红书只默认归到千问下。
- 创建任务平台区为左平台列表、右账号列表结构。
- 账号列表显示头像、账号名、账号 ID。
- 账号检测仍使用 30 分钟缓存和手动刷新。
- 文章总数仍等于启用可发布账号数 x 天数 x 2。
- 深色主题小字可读。
- 前端视觉比当前更精致，但不是营销页。
- 导航栏只有保存成功的步骤才打勾。
- `npm run check` 结果已记录。
- `npm run build:web` 结果已记录。

## 风险

- 头像和平台账号 ID 是否能抓取，取决于 Electron 登录窗口和平台 DOM。无法抓取时不能阻塞登录。
- `PlatformAccountCenter` 当前较大，直接搬入创建任务会让页面复杂。优先抽出小组件，避免复制整文件。
- `AppShell` 是全局文件，导航状态 worker 不应和视觉 worker 同时编辑。
- 当前已有 `.gitignore`、`package.json` 修改，接手打包/更新 worker 必须先看 diff。
- `AGENTS.md` 已同步为当前轮协作文档；`AGENTS（new).md` 作为同内容副本保留，便于核对本轮调整来源。
- 当前 `task_plan.md` 终端读取出现乱码，新文档和新增中文必须确认 UTF-8。
- `8.134.115.153` 目前只有 IP 信息，正式上线前需要确认域名、HTTPS、服务器登录方式、开放端口和部署目录。
- 反馈和更新接口如果裸 HTTP，存在篡改风险；更新系统必须优先支持 HTTPS 和 sha256 校验。
- 设备指纹一机一码授权涉及隐私和误判，第一期只预留结构，不要强制拦截用户。

## 本轮文档验证记录

2026-06-08 重新对齐远端后已执行：

```powershell
npm run check
```

结果：通过。

```text
> geo-desktop@0.1.0 check
> tsc --noEmit
```

后续 worker 应继续把 `npm run check` 作为每个聚焦改动后的门禁；最终集成前再运行 `npm run build:web`。
