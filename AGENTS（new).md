# GEO Platform Multi-Agent Handoff

## Current Baseline

- Workspace: `D:\geo`
- Current branch observed: `geo-five-step-rebuild-20260608`
- Remote alignment observed after `git fetch origin --prune`: `HEAD` equals `origin/geo-five-step-rebuild-20260608` at `1f3965a`; `origin/HEAD` points to `origin/main` at `a4a2871`.
- Current date: 2026-06-08
- Product direction source for this round: `geo_frontend_optimization_execution_plan.md`
- App shape:
  - Next.js 14 + React 18 + Electron desktop app.
  - Main scripts: `npm run check`, `npm run build:web`, `npm run dev:web`, `npm run dev:electron`.
  - Five-step routes already exist:
    - `src/app/enterprise/page.tsx`
    - `src/app/customer-keywords/page.tsx`
    - `src/app/tasks/create/page.tsx`
    - `src/app/content-pool/page.tsx`
    - `src/app/publish-execution/page.tsx`
  - Existing account login center:
    - `src/app/accounts/page.tsx`
    - `src/components/publish/platform-account-center.tsx`
    - `src/lib/publish/accounts-service.ts`
    - `src/app/api/publish/accounts/**`
  - Platform icons are available under `src/img`.

Every worker must run `git status --short --branch` before editing. Do not assume the workspace is clean.

## Dirty State Observed Before This Handoff

```text
 M AGENTS.md
 M .gitignore
 M package.json
?? geo_frontend_optimization_execution_plan.md
?? AGENTS（new).md
?? src/img/
```

These may be user or other-agent changes. Do not revert them. If a worker needs one of these files, inspect it first and report overlap risk.

Notes:

- `.gitignore` currently adds `release-dir/`.
- `package.json` currently changes `dist:installer` to `npm run dist` and changes the Windows build target from `nsis` to `dir`.
- Current `npm run check` baseline passes after remote alignment.
- `AGENTS.md` is now synchronized to the current round handoff. `AGENTS（new).md` is kept as the same-content copy used during this adjustment.

## Required Product Direction

Continue optimizing the current five-step GEO workflow. This round now includes frontend work plus a light server-side operations layer for feedback, future device authorization, and app updates.

Required changes:

1. Rename the secondary settings entry to **模型设置**.
2. Model provider default first choice is GPT.
3. Text model default name is `gpt5.5`.
4. Image model default name is `gpt-image2`.
5. Move/reuse the existing account login entry inside **创建任务**.
6. In **创建任务**, use vertical navigation:
   - GEO AI platform vertical navigation.
   - Publish platform vertical secondary navigation.
   - Account list on the right.
7. All GEO AI platforms and publish platforms must use SVG icons from `src/img`.
8. Account list must show login entry, avatar, account name, and account ID.
9. 小红书 is only mapped to 千问 by default in this round.
10. Feedback box below 模型设置 must submit to `8.134.115.153`, not only local storage.
11. Add Docker-backed server storage and admin web page for feedback.
12. Reserve database/admin structures for device fingerprint and one-machine-one-code authorization.
13. Add a user-facing update check entry that compares current version with `8.134.115.153`.
14. Server update source must be release files and manifests, not source code.
15. Fix low-contrast gray text in dark theme.
16. Improve frontend visual quality while staying quiet, operational, and not marketing-like.
17. Navigation checkmarks must be driven by real saved state. A module checks only after save/persistence succeeds.

## Hard Rules

1. Never run `git reset --hard`, `git checkout -- .`, destructive cleanup, or broad file deletion unless explicitly asked.
2. Before editing, run `git status --short --branch`.
3. Inspect any target file that is already modified.
4. Do not let two agents edit the same file set at the same time.
5. Do not rewrite the publish chain or Electron automation body in this round.
6. Do not introduce a new UI framework.
7. Do not create a marketing landing page or dashboard-heavy homepage.
8. Do not edit generated `.next` files.
9. Do not commit generated `.next`, `dist`, runtime `data`, browser profiles, local bridge/session artifacts, API keys, cookies, or auth payloads.
10. Preserve mock fallback behavior.
11. Keep route handlers thin. Services and typed storage hold product logic.
12. Chinese UI copy must be valid UTF-8 and must not contain mojibake.
13. Every worker must report changed files, checks run, unresolved risks, and whether another worker may be affected.
14. Do not put database credentials, admin passwords, cookies, license secrets, or release signing secrets into source code.

## Platform Mapping

Use these exact files from `src/img`:

```text
doubao -> 豆包.svg
deepseek -> deepseek.svg
yuanbao -> 腾讯元宝.svg
tongyi -> 通义千问.svg
toutiao -> 今日头条.svg
baijiahao -> 百家号-nh.svg
douyin -> 抖音.svg
xiaohongshu -> 小红书.svg
wechat -> 公众号.svg
videohao -> 视频号.svg
zhihu -> 知乎.svg
weibo -> 微博.svg
csdn -> csdn.svg
```

Default platform mapping for this round:

```text
豆包 -> 今日头条, 百家号, 抖音
DeepSeek -> CSDN, 知乎
元宝 -> 微信公众号, 视频号
千问 -> 知乎, 微博, 小红书
```

Rules:

- 小红书 only appears under 千问 by default.
- Users cannot freely add unmapped publish platforms in this phase.
- If 豆包/元宝 should support 小红书 again later, use a config or product flag, not scattered hardcoded UI exceptions.

Recommended helper:

- `src/lib/platform-icons.ts` or `src/components/ui/platform-icon.tsx`

Keep the helper narrow. Do not use external icon packages for these platform logos.

## Saved-State Navigation Semantics

Current `AppShell` uses route order to infer completed steps. That must be replaced.

Completion rules:

1. 企业信息: required fields are saved and a saved timestamp exists.
2. 客户关键词: exactly 5 selected questions are saved.
3. 创建任务: a publish plan exists with `totalArticleCount > 0`.
4. 内容池: current task has persisted content pool items and at least one item has reached sample or pending publish state.
5. 执行发布: current task has publish progress or any article-level job record.

Recommended files:

- `src/lib/workflow/status-service.ts`
- `src/app/api/workflow/status/route.ts`
- `src/components/layout/app-shell.tsx`

The shell should refresh status after save actions by listening for:

```ts
window.dispatchEvent(new Event("geo-workflow-status-refresh"));
```

Workers editing save actions must dispatch this event only after the API returns success.

## Account Integration Requirements

The account login entry must be reused, not rebuilt from scratch.

Relevant existing files:

- `src/components/publish/platform-account-center.tsx`
- `src/lib/publish/electron-login-client.ts`
- `src/lib/publish/accounts-service.ts`
- `src/app/api/publish/accounts/login/route.ts`
- `src/app/api/publish/accounts/detect/route.ts`
- `src/app/api/publish/accounts/[accountId]/route.ts`

Required account display:

- Platform icon.
- Avatar if available.
- Account display name or account name.
- Account ID.
- Login status.
- Last validation time.
- Login button for missing/invalid accounts.
- Refresh detection button with 30-minute cache semantics preserved.

Data note:

- `PlatformAccountRecord` already has `avatarUrl`.
- `PublishableAccountSummary` should be extended narrowly with `avatarUrl?: string` if the task page needs it from detection results.
- If platform account ID cannot be crawled, show the local account record ID.

Do not log cookies, sessions, API keys, auth payloads, or raw browser storage.

## Model Settings Requirements

Files:

- `src/app/settings/page.tsx`
- `src/components/settings/settings-form.tsx`
- `src/lib/config/defaults.ts`
- `src/lib/config/service.ts` only if needed
- `src/app/api/config/**` only if needed

Required behavior:

- Sidebar entry says `模型设置`.
- Page title says `模型设置`.
- Provider dropdown first option is GPT.
- Default text model is `gpt5.5`.
- Default image model is `gpt-image2`.
- Existing saved config must not be overwritten by new defaults.
- Keep probe/test status visible.

## Feedback And Admin Requirements

Feedback is no longer local-only. It must submit to the server at `8.134.115.153`.

Client files:

- `src/components/settings/feedback-box.tsx`
- `src/lib/feedback/client.ts` or `src/app/api/feedback/route.ts` as a thin forwarder
- optional local pending queue only for server-unreachable retry

Feedback issue types:

- 模型连接问题
- 内容生成问题
- 账号登录问题
- 发布失败问题
- 界面体验问题
- 其他问题

Client payload:

- `id`
- `type`
- `message`
- `contact`
- `appVersion`
- `deviceFingerprint`
- `platform`
- `clientTime`
- `createdAt`

Server files/directories, if created in this repo:

- `server/admin-api/**`
- `server/admin-web/**`
- `deploy/docker-compose.yml`
- `deploy/nginx/**` if needed
- migration/schema files under `server/**` or `deploy/**`

Docker services:

- `postgres`: feedback, devices, license codes, release metadata.
- `admin-api`: feedback submit, admin APIs, authorization placeholders, update manifest API.
- `admin-web`: admin pages.
- `nginx`: reverse proxy and static release file hosting.

Admin page first phase:

- Login protection.
- Feedback list.
- Filter by issue type, status, version, device.
- Feedback detail.
- Mark status: 新建, 处理中, 已处理, 忽略.

Authorization is reserved for later:

- Add tables/pages for devices, license codes, bindings, expiry, disabled status.
- Do not enforce license blocking in the client in this round unless explicitly assigned.

## Update System Requirements

Add a user-facing “检查更新” entry, preferably in 模型设置 near feedback. A secondary sidebar entry is acceptable if it stays outside the five-step workflow.

Server update source:

- Do not use server-hosted source code as the client update source.
- Source code stays in Git/build machine/CI.
- Server stores release artifacts, manifests, checksums, and release notes.

Recommended release layout:

```text
/releases/
  latest.json
  GEO-Desktop-0.2.0-Setup.exe
  GEO-Desktop-0.2.0-Setup.exe.sha256
  GEO-Desktop-0.2.0-notes.md
```

Initial manifest API:

```text
GET https://8.134.115.153/api/releases/latest?platform=win32&arch=x64&version=<currentVersion>
```

Client flow:

1. User clicks 检查更新.
2. Client requests latest release manifest.
3. Client compares semantic version.
4. If no update, show 已是最新版本.
5. If update exists, show version, notes, size, and download button.
6. Download release file.
7. Verify sha256.
8. Open installer or hand off to Electron updater.
9. If verification fails, delete the downloaded file and show retry.

Security:

- Prefer HTTPS and a domain before production use.
- Release files must include sha256.
- Client must not execute arbitrary scripts returned by the server.
- If scripts ever become necessary, they must be bundled in signed release packages, not fetched as free-form remote code.

## Visual Quality Requirements

This remains a quiet production tool.

Do:

- Use platform SVG logos for platform identity.
- Improve spacing, alignment, state hierarchy, and loading/empty states.
- Improve dark theme contrast.
- Use restrained borders, clear panels, and precise text hierarchy.
- Keep page sections unframed when they are structural, and use cards only for real records/inputs.

Do not:

- Add decorative gradient blobs/orbs.
- Add heavy glassmorphism.
- Add a marketing landing page.
- Add complex animations.
- Make text tiny or low-contrast in dark theme.

## Phase Execution Order

### Phase 0: Coordinator Baseline

Serial only.

Tasks:

1. Run `git status --short --branch`.
2. Read `AGENTS.md`, `geo_frontend_optimization_execution_plan.md`, and `package.json`.
3. Confirm dirty files and icon files.
4. Run `npm run check` if dependencies are present.
5. Record baseline failures before dispatching workers.

Success:

- Branch and dirty state are documented.
- Baseline typecheck result is known.
- Worker file ownership is confirmed.

### Phase 1: Workflow Status And Shell

Serial or one worker only. This owns global shell state.

Own files:

- `src/components/layout/app-shell.tsx`
- `src/lib/workflow/status-service.ts`
- `src/app/api/workflow/status/route.ts`
- narrow save-action edits only to dispatch `geo-workflow-status-refresh`

Tasks:

1. Replace route-order completion with real saved-state completion.
2. Fetch workflow status in the shell.
3. Refresh shell status after successful saves.
4. Rename secondary entry to 模型设置.
5. Run `npm run check`.

Do not edit task account layout, server feedback, or update system.

### Phase 2: Model Settings Defaults

Can run after Phase 1 starts only if `app-shell.tsx` ownership is coordinated.

Own files:

- `src/app/settings/page.tsx`
- `src/components/settings/settings-form.tsx`
- `src/lib/config/defaults.ts`

Tasks:

1. Provider dropdown first option is GPT.
2. Default text model is `gpt5.5`.
3. Default image model is `gpt-image2`.
4. Do not overwrite existing saved config.
5. Keep probe/test behavior.
6. Run `npm run check`.

Do not edit task planning, feedback server, or update logic.

### Phase 3: Task Vertical Platform Navigation And Account List

One worker only; this touches the most interactive frontend.

Own files:

- `src/components/tasks/task-planning-workbench.tsx`
- `src/lib/publish/provider-platform-matrix.ts`
- `src/lib/platform-icons.ts` or `src/components/ui/platform-icon.tsx`
- `src/components/publish/platform-account-center.tsx` only if extracting reusable account UI
- `src/lib/publish/accounts-service.ts` only for narrow account summary/avatar fields
- `src/app/api/publish/accounts/**` only for narrow account display fields
- `src/lib/types.ts` only for narrow type additions

Tasks:

1. Use `src/img` icons for GEO AI platforms and publish platforms.
2. GEO AI platform selection stays limited to 豆包, DeepSeek, 元宝, 千问.
3. Change GEO AI platform navigation to vertical.
4. Change publish platform secondary navigation to vertical.
5. Adjust built-in mapping so 小红书 only defaults under 千问.
6. Right side shows account list for selected publish platform.
7. Reuse existing login flow.
8. Show avatar, account name, account ID, login status, and last validation time.
9. Keep 30-minute detection cache and manual refresh.
10. Preserve total article formula.
11. Run `npm run check`.

Do not rewrite Electron automation or publish execution.

### Phase 4: Server Feedback And Admin Base

Serial or one backend-focused worker. This adds new server/deploy scope.

Own files:

- `src/components/settings/feedback-box.tsx`
- `src/lib/feedback/**`
- `src/app/api/feedback/**`
- `server/admin-api/**`
- `server/admin-web/**`
- `deploy/docker-compose.yml`
- `deploy/nginx/**` if needed
- schema/migration files under `server/**` or `deploy/**`

Tasks:

1. Add feedback box below 模型设置.
2. Submit feedback to `8.134.115.153` through a thin client/API boundary.
3. Use Docker Compose for PostgreSQL, admin API, admin web, and nginx.
4. Create feedback persistence schema.
5. Create device/license placeholder schema and admin entries.
6. Build admin feedback list/detail/status handling.
7. Keep server credentials in env files or deployment secrets, not source code.
8. Run relevant checks and `npm run check` if frontend files are touched.

Do not implement license enforcement in the desktop app yet.

### Phase 5: Update System Entry

Serial or one focused worker.

Own files:

- `src/components/settings/**` or a narrow update component
- `src/lib/updates/**`
- `src/app/api/updates/**` if using a local forwarder
- `electron/main.js` only if installer launch/download needs Electron main-process support
- `server/admin-api/**` release manifest route
- `deploy/nginx/**` release static hosting if needed

Tasks:

1. Add 检查更新 entry.
2. Implement latest release manifest API.
3. Host release files and checksums on the server.
4. Compare current app version with server version.
5. Show update notes and download entry when newer version exists.
6. Verify sha256 after download.
7. Open installer or hand off to Electron updater.
8. Do not fetch or execute server-side source code/scripts as updates.
9. Run relevant checks and `npm run check` if frontend files are touched.

### Phase 6: Dark Theme And Frontend Polish

Can run after shell/task layout changes are stable. Coordinate if editing `globals.css`.

Own files:

- `src/app/globals.css`
- shared UI helpers under `src/components/ui/**`
- narrow class cleanup in workflow page components if needed

Tasks:

1. Fix dark theme low-contrast gray text.
2. Improve shared panel, input, status, empty-state, and list styling.
3. Keep UI restrained and operational.
4. Verify vertical task navigation and account list do not overflow on desktop/mobile.
5. Run `npm run check`.

Do not change business logic.

### Phase 7: Integration Coordinator

Serial only.

Tasks:

1. Run `git status --short --branch`.
2. Inspect shared type, shell, settings, task planning, server, and update diffs.
3. Resolve conflicts without reverting unrelated user changes.
4. Verify navigation checkmarks only appear after saved persistence.
5. Verify 模型设置 defaults.
6. Verify feedback submits to server and appears in admin.
7. Verify authorization schema/admin placeholders exist but do not block client usage.
8. Verify update check compares against server manifest and does not use source-code updates.
9. Verify 创建任务 vertical platform/account icon navigation.
10. Verify account detection count and total article formula.
11. Run `npm run check`.
12. Run `npm run build:web`.
13. Record final status and unresolved risks.

Do not start new feature work.

## Suggested Worker Prompts

### Worker 0: Baseline Coordinator

```text
You are the GEO baseline coordinator.

Project path: D:\geo

Read:
- AGENTS.md
- geo_frontend_optimization_execution_plan.md
- package.json

Tasks:
1. Run git status --short --branch.
2. Confirm current dirty files and src/img icon files.
3. Run npm run check if dependencies are installed.
4. Record branch state, dirty files, check status, and safe worker dispatch order.

Do not change product code unless fixing a baseline-blocking compile error assigned by the controller.

Deliver changed files, commands run, failures, and dispatch recommendations.
```

### Worker A: Workflow Status And Shell

```text
You are Worker A: Workflow Status And Shell.

Read AGENTS.md and geo_frontend_optimization_execution_plan.md first.

Goal:
Make left navigation checkmarks reflect real saved state, and rename settings to 模型设置.

Own files:
- src/components/layout/app-shell.tsx
- src/lib/workflow/status-service.ts
- src/app/api/workflow/status/route.ts
- narrow save-action edits only if needed to dispatch geo-workflow-status-refresh

Required:
1. Replace route-order completion logic.
2. Add an API/service that computes completion from persisted data.
3. Refresh completion after successful saves.
4. Change sidebar settings label to 模型设置.
5. Run npm run check.

Do not edit task account layout, settings form internals, feedback server, or updates.

Deliver changed files, completion semantics, commands run, and risks.
```

### Worker B: Model Settings Defaults

```text
You are Worker B: Model Settings Defaults.

Read AGENTS.md and geo_frontend_optimization_execution_plan.md first.

Goal:
Update 模型设置 defaults without changing feedback, update, or account logic.

Own files:
- src/app/settings/page.tsx
- src/components/settings/settings-form.tsx
- src/lib/config/defaults.ts

Required:
1. Provider dropdown first option is GPT.
2. Text model default is gpt5.5.
3. Image model default is gpt-image2.
4. Do not overwrite existing saved config.
5. Keep probe/test behavior.
6. Run npm run check.

Deliver changed files, config behavior, commands run, and risks.
```

### Worker C: Task Vertical Platform Icons And Account List

```text
You are Worker C: Task Vertical Platform Icons And Account List.

Read AGENTS.md and geo_frontend_optimization_execution_plan.md first.

Goal:
Rebuild 创建任务 platform/account area into vertical icon navigation plus reusable account login list.

Own files:
- src/components/tasks/task-planning-workbench.tsx
- src/lib/publish/provider-platform-matrix.ts
- src/lib/platform-icons.ts or src/components/ui/platform-icon.tsx
- src/components/publish/platform-account-center.tsx only if extracting reusable account UI
- src/lib/publish/accounts-service.ts only for narrow account summary/avatar fields
- src/app/api/publish/accounts/** only for narrow account display fields
- src/lib/types.ts only for narrow type additions

Required:
1. Use src/img icons for GEO AI platforms and publish platforms.
2. GEO AI platform navigation is vertical.
3. Publish platform secondary navigation is vertical.
4. 小红书 only defaults under 千问.
5. Right side shows account list for selected platform.
6. Reuse existing login flow.
7. Show avatar, account name, account ID, login status, and last validation time.
8. Keep 30-minute detection cache and manual refresh.
9. Preserve total article formula.
10. Run npm run check.

Do not rewrite Electron automation or publish execution.

Deliver changed files, account behavior, calculation examples, commands run, and risks.
```

### Worker D: Server Feedback And Admin

```text
You are Worker D: Server Feedback And Admin.

Read AGENTS.md and geo_frontend_optimization_execution_plan.md first.

Goal:
Make feedback submit to 8.134.115.153 and add Docker-backed admin storage for feedback plus authorization placeholders.

Own files:
- src/components/settings/feedback-box.tsx
- src/lib/feedback/**
- src/app/api/feedback/**
- server/admin-api/**
- server/admin-web/**
- deploy/docker-compose.yml
- deploy/nginx/** if needed
- schema/migration files under server/** or deploy/**

Required:
1. Feedback box supports issue type, message, optional contact.
2. Feedback submits to the server, not local-only storage.
3. Server uses Docker Compose with PostgreSQL, admin API, admin web, and nginx.
4. Admin web lists feedback, shows detail, filters, and updates status.
5. Create device/license placeholder schema and admin entries.
6. Do not enforce device authorization in the desktop client yet.
7. Keep credentials out of source code.
8. Run relevant checks and npm run check if frontend files are touched.

Deliver changed files, API endpoints, database schema, commands run, and risks.
```

### Worker E: Update System Entry

```text
You are Worker E: Update System Entry.

Read AGENTS.md and geo_frontend_optimization_execution_plan.md first.

Goal:
Add a user update check entry that compares with the server release manifest and downloads release files, not source code.

Own files:
- src/components/settings/** or a narrow update component
- src/lib/updates/**
- src/app/api/updates/** if using a local forwarder
- electron/main.js only if installer launch/download needs Electron main-process support
- server/admin-api/** release manifest route
- deploy/nginx/** release static hosting if needed

Required:
1. Add 检查更新 entry outside the five-step workflow.
2. Implement latest release manifest API.
3. Server hosts release files, checksums, and notes.
4. Client compares current version with latest version.
5. New version UI shows version, notes, size, and download entry.
6. Verify sha256 after download.
7. Open installer or hand off to Electron updater.
8. Do not fetch or execute server-side source code/scripts as updates.
9. Run relevant checks and npm run check if frontend files are touched.

Deliver changed files, update flow, server artifact layout, commands run, and risks.
```

### Worker F: Dark Theme And Frontend Polish

```text
You are Worker F: Dark Theme And Frontend Polish.

Read AGENTS.md and geo_frontend_optimization_execution_plan.md first.

Goal:
Improve visual quality and fix dark theme low-contrast text without changing business logic.

Own files:
- src/app/globals.css
- shared UI helpers under src/components/ui/**
- narrow class cleanup in workflow page components if needed

Required:
1. Increase dark theme readability for muted text, borders, details, and disabled states.
2. Keep the UI quiet, operational, and higher quality.
3. Do not add marketing hero sections, gradient blobs, heavy glass, or complex animation.
4. Verify vertical task navigation and account list do not overflow on desktop/mobile.
5. Run npm run check.

Do not edit service logic, account login behavior, feedback server, or updates.

Deliver changed files, visual notes, commands run, and risks.
```

### Worker G: Integration Coordinator

```text
You are Worker G: Integration Coordinator.

Read AGENTS.md and geo_frontend_optimization_execution_plan.md first.

Goal:
Integrate all worker results and verify the product flow plus server/update additions.

Tasks:
1. Run git status --short --branch.
2. Inspect shared type, shell, settings, task planning, feedback server, and update diffs.
3. Resolve conflicts without reverting unrelated user changes.
4. Verify navigation checkmarks only appear after saved persistence.
5. Verify 模型设置 defaults.
6. Verify feedback submits to server and appears in admin.
7. Verify authorization schema/admin placeholders exist but do not block client usage.
8. Verify update check uses release manifest/files, not source-code updates.
9. Verify 创建任务 vertical platform/account icon navigation.
10. Verify account detection count and total article formula.
11. Run npm run check.
12. Run npm run build:web.
13. Record final status and unresolved risks.

Do not start new feature work.

Deliver changed files, verification commands, failures, and final handoff notes.
```

## Verification Commands

Run after every focused change:

```powershell
npm run check
```

Run before final handoff:

```powershell
npm run build:web
git status --short --branch
```

For visual work, start the web app when feasible:

```powershell
npm run dev:web
```

Then inspect:

- `/enterprise`
- `/customer-keywords`
- `/tasks/create`
- `/content-pool`
- `/publish-execution`
- `/settings`

For server work, verify the intended endpoints after deployment configuration is available:

- `https://8.134.115.153/api/feedback`
- `https://8.134.115.153/admin`
- `https://8.134.115.153/api/releases/latest`

Do not leave required dev servers running without telling the coordinator.

## Conflict Policy

If two workers touch the same file:

1. Stop merging that worker.
2. Coordinator inspects both diffs.
3. Prefer the diff that preserves module boundaries and typed service contracts.
4. If both are needed, make a coordinator patch.
5. Do not ask both workers to continue editing the same conflict area blindly.

## Final Acceptance Checklist

- Sidebar secondary entry is 模型设置.
- GPT is the first provider option.
- Default text model is `gpt5.5`.
- Default image model is `gpt-image2`.
- Existing saved model config is not overwritten.
- Feedback box appears below model settings.
- Feedback submits to `8.134.115.153`.
- Docker database stores feedback.
- Admin web can view and update feedback.
- Device fingerprint and one-machine-one-code authorization structures are reserved.
- 检查更新 entry exists outside the five-step workflow.
- Update check compares with server release manifest.
- Server stores release files, manifest, checksum, notes, not source code as update source.
- 创建任务 includes account login entry.
- GEO AI platforms use SVG icons.
- Publish platforms use SVG icons.
- 创建任务 uses vertical GEO AI platform navigation.
- 创建任务 uses vertical publish platform secondary navigation.
- 小红书 only defaults under 千问.
- Account list shows avatar, account name, account ID, status, and login entry.
- Account detection still caches for 30 minutes and supports manual refresh.
- Task total article count remains correct.
- Dark theme muted text is readable.
- Frontend feels more refined while staying operational.
- Navigation checkmarks appear only after saved persistence.
- Chinese copy is clean UTF-8.
- `npm run check` result is recorded.
- `npm run build:web` result is recorded.
