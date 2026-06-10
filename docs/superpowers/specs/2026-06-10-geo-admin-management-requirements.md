# GEO Admin Management Requirements

Date: 2026-06-10
Scope: GEO 后台管理、桌面端授权门禁、意见箱上报、版本更新管理
Target domain: `https://geoadmin.jizhidaoai.com`

## 1. Goal

建设一个可部署到服务器的 GEO 后台管理系统，后台只暴露三个一级功能：

1. 授权管理：管理设备的一机一码授权，支持生成授权码、查看绑定、重置授权、禁用授权。
2. 意见箱：收集 GEO 桌面端上传到服务器数据库的用户反馈，支持查询、处理和标记状态。
3. 版本管理：上传 GEO 平台更新包并发布版本清单，桌面端检测到新版本后提示更新。

桌面端未授权时仍可浏览 GEO 系统界面和历史内容，但所有会改变状态、调用模型、导入数据、登录账号、生成内容、发布内容、下载更新包的操作都必须被禁用或拦截。

## 2. Current Baseline

项目已经具备以下基础：

- `server/admin-api`：Express + Postgres 后台 API，已有反馈、授权、版本元数据相关表和接口雏形。
- `server/admin-web`：静态后台页面雏形，当前页面包含反馈、设备、授权码、绑定关系 tab，但中文存在 mojibake，信息架构不符合目标三功能。
- `deploy/docker-compose.yml` 与 `deploy/nginx/**`：已有 Docker 部署基础。
- `src/app/api/feedback/route.ts`：桌面端反馈转发器。
- `src/app/api/license/activate/route.ts` 与 `src/app/api/license/status/route.ts`：桌面端授权转发器。
- `src/app/api/updates/latest/route.ts`：桌面端版本检查转发器。
- `src/lib/license/client.ts` 与 `src/components/settings/license-status-box.tsx`：授权状态和激活 UI 雏形。
- `src/lib/updates/client.ts` 与 `src/components/settings/update-check-box.tsx`：版本检查、下载、SHA-256 校验雏形。

必须复用这些基础，不从零另建一套后台。

## 3. Product Rules

### 3.1 Admin Navigation

后台管理页面只保留三个一级功能：

- `授权管理`
- `意见箱`
- `版本管理`

后台不再以“设备、授权码、绑定关系”作为一级导航。这些信息应合并到授权管理页面内，形成一个业务闭环。

### 3.2 Authorization Mode

授权策略为“一机一码”：

- 每个授权码默认只能绑定 1 台设备。
- 授权码可以被管理员创建、禁用、重置绑定。
- 设备首次激活时提交授权码、设备指纹、机器码、设备名称、应用版本。
- 授权成功后服务端写入设备与授权码绑定。
- 同一个授权码已经绑定其他设备时，新设备激活应失败，除非管理员先重置该授权码绑定。
- 管理员重置授权后，旧设备下一次状态检查应变成未授权或失效。
- 禁用授权后，所有相关设备下一次状态检查应变成 disabled。

桌面端未授权时：

- 允许浏览主界面、查看本地已有配置和历史内容。
- 禁止保存企业资料、保存关键词、创建任务、导入文件、调用模型、生成内容、登录发布账号、发布内容、修改设置中的敏感配置、下载更新包。
- 允许打开授权激活入口。
- 允许提交意见箱反馈，便于未授权用户求助。
- 所有被禁用操作都应显示统一提示：`当前设备未授权，请先在设置中激活授权码。`

### 3.3 Feedback Box

桌面端意见箱必须上传到服务器数据库，而不是只保存在本地。

生产 endpoint：

- 桌面端 Next.js 转发：`/api/feedback`
- 服务端 API：`https://geoadmin.jizhidaoai.com/api/feedback`
- 管理端列表：`https://geoadmin.jizhidaoai.com/admin`

反馈数据至少包含：

- 反馈 ID
- 反馈类型
- 反馈内容
- 联系方式
- 应用版本
- 设备指纹
- 设备名称或平台信息
- 客户端时间
- 服务端时间
- 处理状态：`new`、`processing`、`resolved`、`ignored`
- 处理备注

后台意见箱页面必须支持：

- 按状态筛选
- 按反馈类型筛选
- 按应用版本筛选
- 按设备指纹筛选
- 查看反馈详情
- 更新处理状态和处理备注

### 3.4 Version Management

版本管理用于发布 GEO 平台更新包。

后台版本管理页面必须支持：

- 上传更新包文件。
- 输入版本号，例如 `0.2.0`。
- 选择平台和架构，当前默认 `win32/x64`。
- 输入更新说明。
- 设置是否强制更新。
- 设置最低支持版本。
- 服务端计算并保存 SHA-256。
- 发布后更新最新版本清单。

桌面端更新规则：

- 桌面端带当前版本、平台、架构请求最新版本。
- 服务端返回最新版本、更新说明、下载地址、文件大小、SHA-256、是否强制更新。
- 如果服务端版本高于当前版本，桌面端提示更新。
- 下载后必须校验 SHA-256，校验失败必须阻止更新包使用。
- 客户端不得执行服务器下发的远程脚本。

## 4. Project-Level Docker Architecture

后台必须按规范项目级架构部署，不把后台管理当成临时页面或本机脚本。

推荐服务边界：

```text
deploy/docker-compose.yml
  postgres        持久化数据库
  admin-api       Express API，连接 Postgres，读写反馈、授权、版本
  admin-web       后台管理前端，调用 admin-api
  nginx           HTTPS 入口，绑定 geoadmin.jizhidaoai.com

volumes
  postgres_data   数据库数据
  release_files   更新包、更新说明、manifest 静态文件
```

Nginx 路由建议：

- `/api/*` 反向代理到 `admin-api`
- `/admin/*` 或 `/` 反向代理到 `admin-web`
- `/releases/*` 只读托管更新包文件
- `/health` 反向代理到 `admin-api`

生产安全要求：

- `geoadmin.jizhidaoai.com` 必须使用 HTTPS。
- 数据库密码、后台账号、上传目录、CORS 白名单必须来自环境变量。
- 更新包目录必须是服务端 volume，不进入源码仓库。
- API 日志不得输出授权码明文、Cookie、账号会话、API key、发布平台凭证。
- 管理后台必须有认证保护；当前 Basic Auth 可作为第一阶段实现，但部署文档必须标明后续需要更强认证。

## 5. Data Model Requirements

现有表可以继续使用并补齐字段或接口：

- `feedback_submissions`
- `devices`
- `license_codes`
- `device_license_bindings`
- `release_metadata`

授权管理还需要显式支持“重置绑定”：

- 重置某个授权码时，相关 active binding 应被标记为 `revoked` 并写入 `revoked_at`。
- 重置后授权码状态应回到 `available`，除非授权码已 disabled 或 expired。
- 设备状态不应被删除，方便追溯。

版本管理需要保证：

- `release_metadata.sha256` 是 64 位十六进制字符串。
- 同一 `version/platform/arch` 唯一。
- 最新版本查询按版本号和发布时间返回唯一结果。
- 更新包文件必须存放在 release volume 中，数据库只保存相对路径、hash、大小和说明路径。

## 6. API Requirements

公共 API：

- `POST /api/feedback`：保存桌面端反馈。
- `POST /api/licenses/activate`：激活授权码并绑定设备。
- `GET /api/licenses/status?deviceFingerprint=...`：查询设备授权状态。
- `GET /api/releases/latest?platform=win32&arch=x64&version=0.1.0`：查询最新版本。

管理 API：

- `GET /api/admin/feedback`
- `GET /api/admin/feedback/:id`
- `PATCH /api/admin/feedback/:id`
- `GET /api/admin/license-codes`
- `POST /api/admin/license-codes`
- `PATCH /api/admin/license-codes/:id`
- `POST /api/admin/license-codes/:id/reset-binding`
- `GET /api/admin/device-license-bindings`
- `GET /api/admin/devices`
- `GET /api/admin/releases`
- `POST /api/admin/releases`
- `POST /api/admin/releases/:id/publish`
- `PATCH /api/admin/releases/:id`

上传版本包时，管理 API 应使用受控上传流程：

- 限制文件大小。
- 限制扩展名到安装包或压缩包格式。
- 计算 SHA-256。
- 保存到 release volume。
- 返回版本元数据。

## 7. Desktop Integration Requirements

桌面端需要一个统一授权状态服务，供页面和操作函数复用。

需要纳入授权拦截的动作包括：

- 企业资料保存
- 客户关键词保存和确认
- 任务创建
- 文件夹导入
- 内容生成
- 内容池修改
- 发布账号登录或删除
- 发布任务创建和执行
- 设置中的模型/API 配置保存
- 更新包下载

不需要拦截的动作：

- 浏览页面
- 查看本地已有数据
- 刷新授权状态
- 激活授权码
- 提交意见箱反馈
- 检查是否有新版本

## 8. Acceptance Criteria

授权管理：

- 管理员可以创建一个默认 `maxDevices=1` 的授权码。
- 第一台设备可以激活成功。
- 第二台设备使用同一个授权码激活时失败。
- 管理员重置授权码绑定后，另一台设备可以重新激活。
- 管理员禁用授权码后，已绑定设备状态检查返回 disabled。
- 未授权桌面端可浏览页面，但保存、生成、导入、登录、发布等操作会被统一拦截。

意见箱：

- 桌面端反馈提交后写入服务器 Postgres。
- 后台意见箱可以查看、筛选、更新状态和备注。
- 反馈 API 对无效 payload 返回 400。
- 生产环境反馈 endpoint 必须为 HTTPS。

版本管理：

- 管理员可以上传版本包并保存版本元数据。
- 服务端保存 SHA-256、文件大小、更新说明和下载地址。
- 桌面端低版本检测到新版本时提示更新。
- SHA-256 不匹配时桌面端阻止更新包使用。
- 版本包不会进入源码仓库。

部署：

- `docker compose up -d` 能启动 Postgres、admin-api、admin-web、nginx。
- `https://geoadmin.jizhidaoai.com/health` 返回健康状态。
- `https://geoadmin.jizhidaoai.com/admin` 需要认证后才能访问管理功能。

## 9. Verification Plan

第一阶段必须覆盖：

- `npm run check`
- 反馈 payload 校验测试
- 授权激活、重复绑定、重置绑定、禁用授权测试
- 更新版本比较和 SHA-256 校验测试
- admin-api 关键接口测试
- admin-web 三个一级导航的浏览器冒烟测试
- Docker compose 配置静态检查

如果 `npm run build:web` 没有运行，必须说明原因。当前仓库记录显示之前构建曾经挂起，重试前应先检查活跃 `node.exe` 进程，避免误杀其他 worker 的服务。

## 10. Out of Scope For First Delivery

第一阶段不实现：

- 复杂 RBAC 多角色权限。
- 自动静默安装更新。
- 远程执行脚本。
- 授权码明文列表长期展示。
- 发布平台账号、Cookie、浏览器会话上传到服务器。
- 多租户 SaaS 计费系统。

这些能力可以在后台稳定上线后再做第二阶段。
