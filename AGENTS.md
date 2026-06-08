# GEO Platform Multi-Agent Handoff

## Current Baseline

- Local workspace: `D:\geo`
- Current active branch observed: `production-publish-link-20260606...origin/production-publish-link-20260606`
- Current working tree observed before this handoff rewrite: `task_plan.md` is untracked; no other dirty files were reported by `git status --short --branch`.
- Product execution source: `task_plan.md` dated 2026-06-06.
- Existing implementation shape:
  - Next.js 14 + React 18 + Electron desktop app.
  - Main scripts: `npm run check`, `npm run build:web`, `npm run dev:web`, `npm run dev:electron`.
  - Current UI routes include legacy task, keywords, content strategy, publish, accounts, and settings pages.
  - Existing service modules already cover tasks, keywords, content, images, publish workbench, accounts, jobs, storage, and model integrations.

Do not assume the workspace is clean just because this file records one snapshot. Every agent must run `git status --short --branch` before editing.

## Required Product Direction

The first implementation phase is now:

**Frontend basic rebuild + minimum data/API support.**

This is not a light UI polish pass. The user-facing navigation, page structure, interaction path, visual hierarchy, and Chinese copy should be rebuilt around a clear five-step GEO production workflow. Existing service code, route handlers, data models, and business components may be reused where they help, but the visible product experience should follow the new workflow.

The five required user-facing steps are:

1. 企业信息
2. 客户关键词
3. 创建任务
4. 内容池
5. 执行发布

Settings must be reduced to a secondary entry, not a main workflow step. Settings should expose only:

- 文字模型
- 图片模型

## Hard Rules

1. Never run `git reset --hard`, `git checkout -- .`, destructive cleanup, or broad file deletion unless the user explicitly asks for it.
2. Before editing, run `git status --short --branch` and inspect whether target files are already modified.
3. Do not let two agents edit the same file set at the same time.
4. Do not rewrite the complete backend, publish chain, or Electron automation in Phase 1.
5. Do not introduce a new UI framework.
6. Do not create a marketing landing page or dashboard-heavy homepage.
7. Do not edit generated `.next` files.
8. Do not commit generated `.next`, `dist`, runtime `data`, browser profiles, local bridge/session artifacts, API keys, cookies, or auth payloads.
9. Preserve mock fallback behavior for local demo paths.
10. Keep route handlers thin. Services and typed local storage should hold product logic.
11. Chinese UI copy must be valid UTF-8 and must not contain mojibake.
12. Every worker must report changed files, checks run, unresolved risks, and whether another worker may be affected.

## Phase 1 Scope

Phase 1 must do enough data/API work to make the new flow real and recoverable. It must not stop at a pure frontend mock.

Required:

- Enterprise profile persistence.
- Customer keyword set persistence.
- Publish task persistence.
- Account detection result recording with 30-minute cache and manual refresh.
- Content pool item state recording.
- Publish progress recording.
- Article-level resume data for interrupted publishing.

Not required in Phase 1:

- Full backend architecture rewrite.
- Full generation engine rewrite.
- Full publishing automation rewrite.
- Full distributed queue.
- Multi-enterprise profile switching.
- Advanced publishing calendar or account weighting.
- Complex animations.

## Data Semantics That Must Not Be Lost

### Enterprise Profile

Long term the local exe version supports one enterprise profile. Do not build a multi-company switcher in Phase 1.

Required fields:

- Company name.
- Brand short name.
- Product/service.
- Region.
- Brand story.
- Product features.
- Audience.
- Trust proof.
- User pain points.
- Customer cases.
- Uploaded material files.
- Uploaded product/company images.
- Parse status.
- Last saved time.

Rules:

- Company name, brand short name, product/service, and region are required.
- File parsing failure does not block the flow. The user can fill fields manually and continue.
- File parsing results only backfill the form. They are not persisted until the user clicks save.
- Saved enterprise information must survive refresh/restart.

### Customer Keyword Set

Keywords here mean AI-search/user-question style customer questions, not generic SEO terms.

Required:

- High/mid/low heat candidate groups.
- Each group should contain 10-15 generated candidates when generation succeeds.
- Exactly 5 selected core questions are required before entering task creation.
- Generation and save timestamps should be recorded.

The model may judge heat by likely question frequency, business value, specificity, regional relevance, and long-tail quality, but the UI should only show simple high/mid/low groups.

### Publish Task

Task creation must happen after enterprise profile and 5 core questions are saved.

Required behavior:

- User first selects GEO AI platform: 豆包, DeepSeek, 元宝, 千问.
- System shows built-in AI-platform to publish-platform mapping.
- User may enable/disable mapped publish platforms.
- User cannot freely add publish platforms in Phase 1.
- Account detection uses only logged-in and currently publishable accounts for `accountCount`.
- Unlogged, expired, manual-only, or unavailable accounts do not count toward automatic article totals.
- Minimum publish duration is 5 days.
- Articles per account per day is fixed to 2 in Phase 1.
- Publish time window defaults to 9:00-18:00.
- Two articles on the same account must be at least 3 hours apart.
- Task total article count must be visible and must equal enabled publishable account count x days x 2.

Built-in platform mapping:

- 豆包 -> 今日头条, 百家号, 抖音, 小红书
- DeepSeek -> CSDN, 知乎
- 元宝 -> 微信公众号, 视频号, 小红书
- 千问 -> 知乎, 微博, 小红书

小红书 is only mapped to 豆包, 元宝, and 千问. DeepSeek does not generate 小红书 content by default.

### Content Pool

The content pool is the production center. It must default to the current task, with history available through a filter/tab/history entry rather than mixed into the default list.

Each content item must carry:

- Unique content ID or visible sequence number.
- Task ID.
- AI platform.
- Publish platform.
- Account ID.
- Customer keyword ID or keyword sequence.
- Planned publish time.
- Title, summary, body.
- Image prompt and image list.
- Risk level: `low`, `medium`, `high`.
- Content status: pending generation, sample, pending publish, publishing, published, failed, manual pending, or equivalent typed state.

Generation pipeline semantics:

- Negative words/risk checks participate in the flow.
- Sample draft must pass quality checks before batch expansion.
- Platform style adaptation must be traceable.
- Batch dispersion must cover title, opening, section order, judgment wording, CTA, and image prompt.
- Same batch content should vary at least 3 of those 6 dimensions.
- `low` risk can publish.
- `medium` risk needs confirmation or rewrite.
- `high` risk blocks publishing.
- Negative-word hits cannot be forcibly released; they must be rewritten and rechecked.
- Automatic rewrite does not need user confirmation, but the UI must show processing status and result.
- Different accounts must start the 5-keyword cycle at offset positions assigned by the system.

### Publish Execution

Execution publish is the final step and must reuse the existing publishing chain as much as possible.

Required:

- Show total, published, remaining.
- Show current platform, current account, current article, and latest execution time.
- Persist progress at article level.
- Resume after restart/interruption from task + platform + account + article + execution stage.
- Avoid duplicate publishing and missed publishing.
- On automation failure, mark current account/article as manual publish pending.
- Manual fallback should open the relevant creator page and fill title/body/tags/images as much as possible, leaving the final publish click to the user.
- After manual handling, the user can continue the remaining publish plan.

## UI And Copy Principles

- This is a quiet production tool, not a marketing site.
- Use a clear stepper or stage navigation for the five-step flow.
- Reduce long explanatory paragraphs. Prefer short headings, statuses, empty states, and action buttons.
- Avoid exposing terms like "状态机", "批量离散", or "负面词分类" as primary user copy. Prefer "当前进度", "降低重复", "检查风险", "可发布", "需处理".
- Support light/dark theme with shared layout and color variables.
- Dark theme should reduce glow and translucent stacking.
- Light theme should control borders/shadows and avoid a traditional heavy admin-table feel.
- Do not use decorative gradient blobs/orbs or heavy glassmorphism.
- Cards are for real inputs, candidates, drafts, and records; avoid card nesting and card-heavy page sections.
- Use `lucide-react` icons for common button/tool actions where helpful.
- Keep text within containers on desktop and mobile.

## Recommended Module Boundaries

### Design System And Shell

Files:

- `src/components/layout/app-shell.tsx`
- `src/app/layout.tsx`
- `src/app/globals.css`
- shared UI helpers if added under `src/components/ui/**`

Owns:

- Five-step navigation.
- Settings secondary entry.
- Theme variables and global visual language.
- Shared page frame, status rail, and responsive layout primitives.

Does not own:

- Enterprise form business logic.
- Keyword generation logic.
- Publishing service logic.

### Enterprise Profile

Files:

- `src/app/enterprise/page.tsx`
- `src/components/enterprise/**`
- enterprise-specific route handlers under `src/app/api/enterprise/**` if added
- enterprise-specific service/storage helpers under `src/lib/enterprise/**` if added
- narrow additions to `src/lib/storage/**`, `src/lib/types.ts`, or `src/lib/paths.ts` only for shared typed persistence

Owns:

- Enterprise form.
- Required-field validation.
- File/image upload UI state.
- Parse-backfill behavior.
- Save/load persistence for the single enterprise profile.

Does not own:

- Keyword generation algorithm beyond consuming saved enterprise data.
- Publish account detection.

### Customer Keywords

Files:

- `src/app/customer-keywords/page.tsx`
- `src/components/keywords/customer-keyword-workbench.tsx`
- existing `src/components/keywords/keyword-workbench.tsx` only if reused/refactored for the new page
- `src/lib/keywords/service.ts`
- `src/app/api/keywords/**`
- narrow additions to shared types/storage

Owns:

- High/mid/low candidate display.
- Selecting exactly 5 core questions.
- Save/load keyword set.
- Gating into task creation.

Does not own:

- Enterprise profile persistence except read access.
- Publish platform/account logic.

### Task Planning

Files:

- `src/app/tasks/create/page.tsx`
- `src/components/tasks/task-planning-workbench.tsx`
- `src/lib/tasks/service.ts`
- `src/lib/publish/accounts-service.ts`
- `src/lib/publish/provider-platform-matrix.ts`
- account-detection route handlers under `src/app/api/publish/accounts/**` or a new thin task-planning route
- narrow shared type/storage additions

Owns:

- AI platform selection.
- Built-in platform mapping display.
- Enable/disable publish platforms.
- Account detection status and 30-minute cache.
- Publish-day selection and total article calculation.
- Time-window and 3-hour spacing rule.
- Saving publish task.

Does not own:

- Content draft generation internals.
- Electron automation internals.

### Content Pool

Files:

- `src/app/content-pool/page.tsx`
- `src/components/content/content-pool.tsx`
- existing `src/components/content/report-workbench.tsx` only if reused/refactored for the new page
- `src/lib/content/**`
- `src/lib/images/**`
- `src/lib/integrations/content/**`
- `src/lib/integrations/images/**`
- content/image route handlers under `src/app/api/content/**` and `src/app/api/images/**`
- narrow shared type/storage additions

Owns:

- Current-task content list.
- History filter/tab/entry.
- Negative-word/risk status display.
- Sample draft and quality result display.
- Batch expansion and dispersion status display.
- Image prompt/image generation status.
- Content item persistence and publishability flags.

Does not own:

- Publish execution runner.
- Electron automation scripts.
- Model endpoint normalization unless a compile-safe response type requires a narrow change.

### Publish Execution

Files:

- `src/app/publish-execution/page.tsx`
- `src/components/publish/publish-execution-workbench.tsx`
- existing `src/components/publish/publish-workbench.tsx` only if reused/refactored for the final execution page
- `src/lib/publish/jobs-service.ts`
- `src/lib/publish/publish-orchestrator.ts`
- `src/lib/publish/server-publish-runner.ts`
- `src/lib/publish/manual-delivery-service.ts`
- `src/lib/publish/workbench-service.ts`
- publish route handlers under `src/app/api/publish/**`
- narrow shared type/storage additions

Owns:

- Article-level progress display.
- Resume/continue publish.
- Failure-to-manual-pending behavior in UI/service boundary.
- Integration with existing publish jobs and drafts.
- User-facing recovery paths.

Does not own:

- Rewriting Electron automation platform scripts.
- Model/content generation internals.

### Settings Simplification

Files:

- `src/app/settings/page.tsx`
- `src/components/settings/settings-form.tsx`
- `src/lib/config/**`
- `src/app/api/config/**`

Owns:

- Reducing model configuration UI to text model and image model entry points.
- Probe status display.
- Hiding advanced parameters from the primary path.

Does not own:

- Provider endpoint refactor unless separately assigned.

### Model Adapter Reliability

Files:

- `src/lib/integrations/openai-compatible.ts`
- `src/lib/config/service.ts`
- `src/lib/integrations/stage1/client.ts`
- `src/lib/integrations/content/client.ts`
- `src/lib/integrations/images/client.ts`

Owns:

- Provider-aware endpoint normalization.
- Doubao/Volcano Ark canonical chat completions handling.
- NewAPI auto-probing preservation.
- Mock fallback preservation.

This worker can run independently from the UI rebuild only if it does not touch UI files.

### Electron Automation

Files:

- `electron/main.js`
- `electron/local-bridge.js`
- `electron/publish-automation/*.js`
- `src/lib/publish/platform-publishers/electron-browser-publisher.ts`

Owns:

- Automation helper extraction.
- Stable stage/result contracts.
- Manual fallback preservation.

Do not schedule this at the same time as Publish Execution if both intend to edit `electron-browser-publisher.ts`.

## Multi-Agent Execution Order

### Phase 0: Coordinator Baseline

Serial only.

Tasks:

- Run `git status --short --branch`.
- Confirm current branch strategy.
- Confirm `task_plan.md` is kept as planning input or moved into docs if desired.
- Run `npm run check` if dependencies are present.
- Run `npm run build:web` only after typecheck is understood.
- Record the true baseline failures before dispatching workers.

Success:

- Branch and dirty state are documented.
- `AGENTS.md` is current.
- Build/typecheck status is known.

### Phase 1: Architecture Skeleton

Prefer one coordinator or one shell/design worker first.

Tasks:

- Create/adjust five visible routes:
  - `src/app/enterprise/page.tsx`
  - `src/app/customer-keywords/page.tsx`
  - `src/app/tasks/create/page.tsx`
  - `src/app/content-pool/page.tsx`
  - `src/app/publish-execution/page.tsx`
- Update `app-shell` navigation to the five-step flow.
- Keep legacy routes available until the new workflow is wired, unless the coordinator explicitly retires them.
- Establish shared theme/layout primitives without broad visual churn in business modules.

Success:

- The five-step navigation exists.
- Pages can render basic typed shells.
- No worker has started deep service changes in overlapping files.

### Phase 2: Parallel Feature Workers

Run at most 4 workers at once. Avoid running multiple heavy builds concurrently.

Safe parallel groups if file ownership is respected:

- Enterprise Profile + Customer Keywords.
- Task Planning + Settings Simplification.
- Content Pool + Model Adapter Reliability.
- Publish Execution + Design System only if `app-shell` ownership is stable.

Do not run these together without coordinator approval:

- Content Pool and Publish Execution if both edit shared publish/content types heavily.
- Publish Execution and Electron Automation if both edit `electron-browser-publisher.ts`.
- Task Planning and Publish Execution if both edit account/job service contracts.

### Phase 3: Integration Coordinator

Serial.

Tasks:

- Resolve shared type/storage changes.
- Verify gating between five steps.
- Verify account count affects task totals.
- Verify content pool items have account/keyword/planned-time assignment.
- Verify publish progress resumes at article level.
- Run `npm run check`.
- Run `npm run build:web`.

Success:

- New five-step workflow is navigable.
- Required persistence works.
- Typecheck/build results are recorded.

## Suggested Worker Prompts

### Worker 0: Baseline Coordinator

```text
You are the GEO baseline coordinator.

Project path: D:\geo

Read:
- AGENTS.md
- task_plan.md
- package.json

Tasks:
1. Run git status --short --branch.
2. Inspect current route/component/service shape.
3. Run npm run check if dependencies are installed.
4. Do not change product code unless fixing a baseline-blocking compile error assigned by the controller.
5. Record branch state, dirty files, check/build status, and safe worker dispatch order.

Deliver changed files, commands run, failures, and dispatch recommendations.
```

### Worker A: Five-Step Shell And Visual System

```text
You are Worker A: Five-Step Shell And Visual System.

Read AGENTS.md and task_plan.md first.

Goal:
Rebuild the app shell around the five-step GEO workflow without implementing deep business logic.

Own files:
- src/components/layout/app-shell.tsx
- src/app/layout.tsx
- src/app/globals.css
- shared UI primitives under src/components/ui/** if needed
- page shell stubs only when coordinated

Required:
1. Replace legacy main navigation with 企业信息, 客户关键词, 创建任务, 内容池, 执行发布.
2. Move settings to a secondary icon/entry.
3. Establish light/dark theme variables with restrained production-tool styling.
4. Avoid card-heavy layout, decorative blobs, heavy glow, and long explanatory copy.
5. Keep existing routes from breaking unless coordinator explicitly retires them.
6. Run npm run check.

Do not edit service logic, publish automation, or model adapters.

Deliver changed files, screenshots/check notes if any, commands run, and risks.
```

### Worker B: Enterprise Profile

```text
You are Worker B: Enterprise Profile.

Read AGENTS.md and task_plan.md first.

Goal:
Implement the 企业信息 step with real local persistence and parse-backfill semantics.

Own files:
- src/app/enterprise/page.tsx
- src/components/enterprise/**
- src/lib/enterprise/** if created
- src/app/api/enterprise/** if created
- narrow shared type/storage additions only as needed

Required:
1. Build form fields for company name, brand short name, product/service, region, brand story, product features, audience, trust proof, pain points, customer cases.
2. Enforce required fields before next-step availability.
3. Support material/image upload UI state using existing import/storage patterns where possible.
4. File parse failure must not block manual save.
5. Parse results backfill the form only; persistence happens only after user save.
6. Save/load one enterprise profile locally with last saved time.
7. Run npm run check.

Do not edit keyword generation, publish services, or Electron automation.

Deliver changed files, persistence behavior, commands run, and risks.
```

### Worker C: Customer Keywords

```text
You are Worker C: Customer Keywords.

Read AGENTS.md and task_plan.md first.

Goal:
Implement 客户关键词 as a saved 5-question selection step.

Own files:
- src/app/customer-keywords/page.tsx
- src/components/keywords/customer-keyword-workbench.tsx
- src/components/keywords/keyword-workbench.tsx only if refactoring existing logic
- src/lib/keywords/service.ts
- src/app/api/keywords/**
- narrow shared type/storage additions only as needed

Required:
1. Load saved enterprise profile and require it before generation.
2. Generate or reuse high/mid/low heat candidates, 10-15 per group when possible.
3. Let the user select exactly 5 core questions.
4. Persist selected questions and timestamps.
5. Block entering 创建任务 until 5 are saved.
6. Keep mock/local fallback behavior working.
7. Run npm run check.

Do not edit publish service, Electron automation, or model adapter internals.

Deliver changed files, API/persistence behavior, commands run, and risks.
```

### Worker D: Task Planning And Account Detection

```text
You are Worker D: Task Planning And Account Detection.

Read AGENTS.md and task_plan.md first.

Goal:
Implement 创建任务 with AI platform mapping, account detection, article total calculation, and persisted task planning.

Own files:
- src/app/tasks/create/page.tsx
- src/components/tasks/task-planning-workbench.tsx
- src/lib/tasks/service.ts
- src/lib/publish/accounts-service.ts
- src/lib/publish/provider-platform-matrix.ts
- account-detection route handlers as needed
- narrow shared type/storage additions only as needed

Required:
1. Require saved enterprise profile and saved 5-question keyword set.
2. Support AI platform selection: 豆包, DeepSeek, 元宝, 千问.
3. Use the built-in mapping from AGENTS.md.
4. Allow enabling/disabling mapped publish platforms; do not allow arbitrary new platforms.
5. Detect logged-in publishable account counts; cache results for 30 minutes and provide manual refresh.
6. Count only logged-in/currently publishable accounts for automatic totals.
7. Enforce minimum 5 days, 2 articles per account per day, 9:00-18:00 window, and 3-hour same-account spacing.
8. Persist the task plan and show total article count.
9. Run npm run check.

Do not edit content generation internals, publish execution internals, or Electron automation.

Deliver changed files, calculation examples verified, commands run, and risks.
```

### Worker E: Content Pool

```text
You are Worker E: Content Pool.

Read AGENTS.md and task_plan.md first.

Goal:
Implement 内容池 as the production center for current-task content, with history available but not mixed by default.

Own files:
- src/app/content-pool/page.tsx
- src/components/content/content-pool.tsx
- src/components/content/report-workbench.tsx only if refactoring existing logic
- src/lib/content/**
- src/lib/images/**
- src/app/api/content/**
- src/app/api/images/**
- narrow shared type/storage additions only as needed

Required:
1. Load the saved task plan and generate/display content items tied to AI platform, publish platform, account, keyword, task, and planned time.
2. Assign keywords in 5-question cycles, offset by account.
3. Display current task by default; expose history through filter/tab/history entry.
4. Represent negative-word/risk review, sample draft, platform style adaptation, batch dispersion, and image prompt/image generation states.
5. Enforce risk behavior: low publishable, medium rewrite/confirm, high blocked; negative-word hits cannot be forced through.
6. Provide automatic rewrite/dispersion entry points where service support exists; otherwise record typed pending/mock state without breaking the UI contract.
7. Persist content pool item states.
8. Run npm run check.

Do not edit publish execution runner, Electron automation, or model adapter internals unless only a narrow response type is required.

Deliver changed files, content item schema/state behavior, commands run, and risks.
```

### Worker F: Publish Execution

```text
You are Worker F: Publish Execution.

Read AGENTS.md and task_plan.md first.

Goal:
Implement 执行发布 with article-level progress, resume, and manual fallback while reusing the existing publish chain.

Own files:
- src/app/publish-execution/page.tsx
- src/components/publish/publish-execution-workbench.tsx
- src/components/publish/publish-workbench.tsx only if refactoring existing logic
- src/lib/publish/jobs-service.ts
- src/lib/publish/publish-orchestrator.ts
- src/lib/publish/server-publish-runner.ts
- src/lib/publish/manual-delivery-service.ts
- src/lib/publish/workbench-service.ts
- src/app/api/publish/**
- narrow shared type/storage additions only as needed

Required:
1. Show total, published, remaining, current platform, current account, current article, and latest execution time.
2. Persist progress at task + platform + account + article + execution stage level.
3. Resume from the last article/stage after interruption.
4. Prevent duplicate publishing and missed publishing.
5. On automation failure, mark current account/article as manual publish pending.
6. Preserve existing manual delivery notes and Electron/browser automation fallback behavior.
7. Do not rewrite the publishing chain body; organize new UI and minimum state support around it.
8. Run npm run check.

Do not edit model adapters, content generation internals, or Electron platform scripts.

Deliver changed files, resume behavior, commands run, and risks.
```

### Worker G: Settings Simplification

```text
You are Worker G: Settings Simplification.

Read AGENTS.md and task_plan.md first.

Goal:
Reduce 设置 to two primary model configuration entries: 文字模型 and 图片模型.

Own files:
- src/app/settings/page.tsx
- src/components/settings/settings-form.tsx
- src/lib/config/**
- src/app/api/config/**

Required:
1. Keep service provider, endpoint, model name, API key, and basic probe/test.
2. Hide advanced parameters from the primary path.
3. Clearly show probe status and errors.
4. Do not expose unnecessary model internals in normal UI.
5. Run npm run check.

Do not edit workflow pages or publish automation.

Deliver changed files, settings behavior, commands run, and risks.
```

### Worker H: Model Adapter Reliability

```text
You are Worker H: Model Adapter Reliability.

Read AGENTS.md and task_plan.md first.

Goal:
Keep model integration reliable for the new workflow.

Own files:
- src/lib/integrations/openai-compatible.ts
- src/lib/config/service.ts
- src/lib/integrations/stage1/client.ts
- src/lib/integrations/content/client.ts
- src/lib/integrations/images/client.ts
- optional focused verification script/test

Required:
1. Make endpoint normalization provider-aware.
2. Ensure Doubao/Volcano Ark supports https://ark.cn-beijing.volces.com/api/v3/chat/completions.
3. Preserve NewAPI auto probing.
4. Preserve mock fallback behavior.
5. Map auth, timeout, 404/405, bad JSON, and output parse failures clearly where feasible.
6. Run npm run check.

Do not edit UI pages, publishing services, or Electron automation.

Deliver changed files, endpoint examples verified, commands run, and risks.
```

### Worker I: Electron Automation Isolation

```text
You are Worker I: Electron Automation Isolation.

Read AGENTS.md and task_plan.md first.

Goal:
Only if separately assigned, improve Electron automation maintainability without changing the Phase 1 product workflow.

Own files:
- electron/main.js
- electron/local-bridge.js
- electron/publish-automation/*.js
- src/lib/publish/platform-publishers/electron-browser-publisher.ts

Required:
1. Preserve current behavior.
2. Extract shared DOM helpers only where safe.
3. Standardize status, failureStage, errorMessage, executionLog, and verificationEvidence.
4. Do not log cookies, sessions, API keys, or auth payloads.
5. Preserve manual fallback.
6. Run npm run check.

Do not edit model/content/task-planning UI or services.

Deliver changed files, behavior preserved, commands run, and risks.
```

## Verification Commands

Run after every focused change:

```powershell
npm run check
```

Run before final integration handoff:

```powershell
npm run build:web
git status --short --branch
```

For frontend visual work, also start the web app when feasible:

```powershell
npm run dev:web
```

Then inspect the affected routes in a browser. Do not leave required dev servers running without telling the coordinator.

## Conflict Policy

If two workers touch the same file:

1. Stop merging that worker.
2. Coordinator inspects both diffs.
3. Prefer the diff that preserves module boundaries and typed service contracts.
4. If both are needed, make a coordinator patch.
5. Do not ask both workers to continue editing the same conflict area blindly.

## Final Acceptance Checklist

- The app opens into a clear five-step workflow.
- 首页 or shell makes 企业信息 the natural starting point.
- Enterprise required fields save and reload.
- Material parse failure is visible and non-blocking.
- Customer keyword generation/selection saves exactly 5 core questions.
- Task creation requires saved enterprise + saved 5 questions.
- AI platform mapping matches this document.
- Account detection caches for 30 minutes and supports manual refresh.
- Task total article count is visible and correct.
- Content pool defaults to current task.
- Content items show AI platform, publish platform, account, keyword, task, planned time, and status.
- Keyword cycling is offset by account.
- Risk levels and rewrite/blocking behavior are represented.
- Publish execution shows total/published/remaining/current position.
- Publish progress resumes at article level.
- Automation failure has manual-pending fallback.
- Settings show only text model and image model primary entries.
- Chinese copy is clean UTF-8.
- UI is restrained, operational, and not a marketing page.
- `npm run check` result is recorded.
- `npm run build:web` result is recorded.
