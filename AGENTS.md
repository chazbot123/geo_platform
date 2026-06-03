# GEO Platform Agent Handoff

## Current Baseline

- Local workspace: `D:\geo`
- Remote repository: `https://github.com/chazbot123/geo_platform.git`
- Remote branch checked: `origin/main`
- Remote latest commit inspected: `a4a2871c6e1b9cbfa62b5db1aa079a45c4bcafe4` (`Restore multi-platform draft workbench and publish updates`)
- Current local state after fetch: `main...origin/main [ahead 2, behind 3]` with many modified, deleted, and untracked files.
- Do not overwrite or reset local changes. Treat the current workspace as an in-progress merge between earlier local work and the newer GitHub version.

## Product Direction

The project direction is sound: build a GEO desktop workflow that turns product/material input into AI-search-oriented questions, structured content, images, platform-specific drafts, and publishing assistance.

The intended flow is:

1. Create a task from product, brand, region, audience, scenario, and optional local materials.
2. Generate AI-search questions for providers such as Doubao, Yuanbao, Tongyi, and DeepSeek.
3. Review and select question bundles.
4. Generate a structured authority-style content draft using AI scenario templates and platform strategies.
5. Generate or attach article images.
6. Produce platform-specific publishing drafts.
7. Publish through the best available route: official API where approved, Electron browser automation where viable, manual delivery where automation is not reliable.

## Doubao Link Assessment

The "Doubao path is connected" claim is partly correct, but the implementation should be described precisely:

- The code does not directly automate the Doubao consumer app.
- The code uses a `doubao` search-provider scenario, mapped to `doubao_plain_answer`.
- Text generation is routed through `newapi-auto` / OpenAI-compatible chat-completions logic in `src/lib/integrations/openai-compatible.ts`.
- Stage 1 question generation maps `doubao` to Doubao-style plain-answer content expectations in `src/lib/integrations/stage1/client.ts`.
- Content generation injects scenario and platform templates through `src/lib/content/prompt-loader.ts` and `src/lib/integrations/content/client.ts`.
- Publishing maps Doubao output to `toutiao`, `baijiahao`, and `douyin` in `src/lib/publish/provider-platform-matrix.ts`.

This is a reasonable product path, but it needs stronger tests and stricter boundaries before more features are added.

Relevant external facts checked:

- Volcano Ark / Doubao supports a Chat API at `https://ark.cn-beijing.volces.com/api/v3/chat/completions` with Bearer API key auth and OpenAI-style `model` plus `messages` payloads.
- OpenAI-compatible Chat Completions APIs use `POST /v1/chat/completions` style request contracts built around `model` and `messages`.
- Douyin official publishing paths require platform capability approval and user authorization. OpenAPI video upload/create requires the `video.create.bind` scope and permission application. OpenSDK publish/share capabilities also have application and review requirements.

Implication: keep the OpenAI-compatible adapter, but make endpoint normalization provider-aware. For Doubao/Ark, the canonical base should be `https://ark.cn-beijing.volces.com/api/v3`, resolving to `/api/v3/chat/completions`, not only `/v1/chat/completions` or `/chat/completions`.

## Refactor Verdict

This codebase needs phased refactoring. It should not be rewritten from scratch.

Reasons:

- The domain model and workflow are valuable and mostly coherent.
- The remote version adds useful concepts: prompt skills, content review, angle dispersion, account-level drafts, provider-to-platform matrix, and Electron-based publishing.
- The implementation currently mixes product logic, prompt logic, draft transformation, publishing state, DOM automation, and persistence concerns too tightly.
- Several modules duplicate draft-building logic.
- Some functions are unfinished or misleading, for example `getDraftForJob` in `src/lib/publish/jobs-service.ts` returns `null`.
- Electron automation scripts are long monoliths, especially `electron/publish-automation/baijiahao.js`, making them hard for multiple agents to change safely.
- Storage is plain JSON file based, which is acceptable for MVP, but it has no migration layer, no schema validation, and no transaction semantics.
- Current `npm run check` fails because `.next/types` references route files that exist in remote `origin/main` but are missing from the current local working tree (`src/app/api/content/angles/route.ts`, `src/app/content-strategy/[taskId]/page.tsx`). This confirms the workspace is in a mixed state.

## Hard Rules For Future Agents

1. Never run `git reset --hard`, `git checkout -- .`, or destructive cleanup unless the user explicitly asks for it.
2. Before editing, run `git status --short --branch` and identify whether the target files are already modified.
3. Do not mix unrelated domains in one change. Keep work inside one area: model adapter, content strategy, publishing, Electron automation, storage, UI, or tests.
4. Prefer small extraction/refactor steps over feature rewrites.
5. Keep mock fallback behavior working. It is the local demo path.
6. Preserve the provider-driven idea: provider scenario first, then content strategy, then platform draft, then publishing route.
7. Any official-publish work must respect platform permission requirements. If official API access is unavailable, keep manual delivery or browser automation as fallback.
8. Do not log API keys, session cookies, access tokens, browser profiles, or auth payloads.
9. Do not commit generated `.next`, `dist`, runtime `data`, or local bridge/session artifacts unless explicitly required.
10. When adding routes or pages, run `npm run check` after clearing stale route-type assumptions if necessary.

## Recommended Module Boundaries

### Model Adapters

Files:

- `src/lib/integrations/openai-compatible.ts`
- `src/lib/integrations/stage1/client.ts`
- `src/lib/integrations/content/client.ts`
- `src/lib/integrations/images/client.ts`

Target:

- Provider-aware endpoint normalization.
- Clear errors for timeout, auth, 404/405, bad JSON, and model output parse failure.
- Testable adapter functions without UI or task persistence.

Immediate refactor:

- Add a provider profile layer: `openai`, `newapi-auto`, `volcengine-ark`, `deepseek`, generic compatible.
- Make Ark/Doubao endpoint normalization support `/api/v3/chat/completions`.
- Keep `newapi-auto` probing, but cap attempts and report the winning endpoint/auth mode.

### GEO Content Strategy

Files:

- `skills/*`
- `src/lib/content/prompt-loader.ts`
- `src/lib/content/review-service.ts`
- `src/lib/content/dispersion-service.ts`
- `src/lib/integrations/content/content-report-prompt.md`

Target:

- Treat `skills/` as product strategy assets, not runtime agent skills.
- Validate templates and JSON strategies at startup or build time.
- Keep content generation deterministic enough to review.

Immediate refactor:

- Add schema validation for platform strategy JSON and risk words.
- Wire review results visibly into the content/publish workflow.

### Publishing Workbench

Files:

- `src/lib/publish/workbench-service.ts`
- `src/lib/publish/publish-orchestrator.ts`
- `src/lib/publish/jobs-service.ts`
- `src/lib/publish/provider-platform-matrix.ts`
- `src/lib/publish/platforms.ts`

Target:

- One shared draft transformation pipeline.
- Clear difference between generic platform drafts and account-specific drafts.
- Jobs should be state-machine driven, not loosely patched records.

Immediate refactor:

- Extract common title/body/tag/image draft builders from `workbench-service.ts` and `publish-orchestrator.ts`.
- Implement or remove `getDraftForJob`.
- Add invariants: no publishing job without draft body/title, no ready automation without a valid account/session.

### Electron Automation

Files:

- `electron/main.js`
- `electron/local-bridge.js`
- `electron/publish-automation/*.js`
- `src/lib/publish/platform-publishers/electron-browser-publisher.ts`

Target:

- Browser automation should be isolated behind a stable contract.
- Platform scripts should be smaller: page navigation, editor detection, text insertion, image insertion, submit, verification.

Immediate refactor:

- Extract reusable DOM helpers from platform scripts.
- Add execution logs with stable stage names.
- Keep manual fallback if any stage cannot be verified.

### Storage

Files:

- `src/lib/storage/data-store.ts`
- `src/lib/storage/json-store.ts`
- `src/lib/paths.ts`
- `src/lib/types.ts`

Target:

- JSON storage is fine for MVP, but must have migrations and validation.

Immediate refactor:

- Add versioned record migration for tasks/themes/content/images/publishing jobs.
- Add write-atomic behavior in `json-store.ts` if not already present.
- Add a small set of storage tests around listing, save/update, and delete.

### UI

Files:

- `src/app/**`
- `src/components/**`
- `src/hooks/use-task-draft-store.ts`

Target:

- UI should call services through route handlers and display explicit stage/result status.
- Do not bury operational errors in generic toast text.

Immediate refactor:

- Restore or reconcile remote routes/pages currently missing locally:
  - `src/app/api/content/angles/route.ts`
  - `src/app/content-strategy/[taskId]/page.tsx`
- Surface `NewAPIProbeError` attempts in settings/testing UI.
- Surface content review blocking issues before publishing.

## Multi-Agent Execution Plan

### Phase 0: Stabilize Baseline

Owner: repo coordinator agent.

Tasks:

- Snapshot current `git status`.
- Decide whether to merge `origin/main` into local state or preserve local as a separate branch.
- Restore missing remote files that current `.next/types` expects, or remove stale `.next` from type checking workflow.
- Run `npm run check`.

Success criteria:

- Workspace has a documented branch strategy.
- Type check failure list is understood and reduced to real source errors only.

### Phase 1: Adapter And Doubao/Ark Reliability

Owner: model adapter agent.

Tasks:

- Refactor endpoint normalization into provider profiles.
- Add Ark canonical endpoint handling.
- Add unit tests for base URL inputs:
  - root domain
  - `/api/v3`
  - `/api/v3/chat/completions`
  - `/v1`
  - `/v1/chat/completions`
- Keep NewAPI auto-detect compatibility.

Success criteria:

- Doubao/Ark endpoint handling is explicit and tested.
- Stage 1 and content generation still support mock mode.

### Phase 2: Content Strategy Quality Gate

Owner: content strategy agent.

Tasks:

- Validate `skills/` JSON assets.
- Make review output first-class in service/API response.
- Ensure selected question coverage is checked before publishing draft generation.

Success criteria:

- Content can fail review with actionable blocking issues.
- Platform and AI scenario prompt versions are visible in generated drafts.

### Phase 3: Publishing Service Refactor

Owner: publishing service agent.

Tasks:

- Deduplicate draft building logic.
- Implement the missing job-to-draft lookup.
- Convert job status changes into explicit transition helpers.
- Keep manual delivery notes intact.

Success criteria:

- One shared draft builder is used for both platform and account drafts.
- Publishing jobs have reliable state transitions and traceable source draft IDs.

### Phase 4: Electron Automation Isolation

Owner: automation agent.

Tasks:

- Extract DOM utility functions from `baijiahao.js`, `toutiao.js`, and `douyin.js`.
- Define platform automation contract:
  - input payload shape
  - stage names
  - result shape
  - failure shape
- Add dry-run or fill-only mode if feasible.

Success criteria:

- Each platform script is small enough to review.
- Failures identify a stable stage and preserve manual fallback.

### Phase 5: UI And Workflow Polish

Owner: frontend/workflow agent.

Tasks:

- Reconcile current local UI with remote `origin/main`.
- Restore content strategy and platform copy pages if they are part of the accepted direction.
- Add clear status panels for model probing, content review, draft generation, and publish execution.

Success criteria:

- User can see where a task is blocked.
- No route expected by Next type generation is missing.

## Suggested First Agent Prompts

Model adapter agent:

> Read `src/lib/integrations/openai-compatible.ts`, `src/lib/config/service.ts`, `src/lib/integrations/stage1/client.ts`, and `src/lib/integrations/content/client.ts`. Refactor endpoint normalization into provider profiles with explicit Volcano Ark/Doubao support for `https://ark.cn-beijing.volces.com/api/v3/chat/completions`. Preserve `newapi-auto` probing and mock fallback. Add focused tests or a script that verifies endpoint candidates and error mapping. Do not touch publishing or UI files.

Publishing service agent:

> Read `src/lib/publish/workbench-service.ts`, `src/lib/publish/publish-orchestrator.ts`, `src/lib/publish/jobs-service.ts`, `src/lib/publish/platforms.ts`, and `src/lib/types.ts`. Extract shared draft-building helpers, implement or remove `getDraftForJob`, and make publishing job state transitions explicit. Do not edit Electron automation scripts.

Automation agent:

> Read `electron/publish-automation/baijiahao.js`, `electron/publish-automation/toutiao.js`, `electron/publish-automation/douyin.js`, `electron/main.js`, and `src/lib/publish/platform-publishers/electron-browser-publisher.ts`. Extract reusable DOM helpers and standardize stage/result contracts. Preserve current behavior and manual fallback.

Content strategy agent:

> Read `skills/`, `src/lib/content/prompt-loader.ts`, `src/lib/content/review-service.ts`, `src/lib/content/dispersion-service.ts`, and `src/lib/integrations/content/client.ts`. Add validation for prompt strategy assets and make content review blocking issues available before publishing. Do not edit model adapter internals.

Frontend workflow agent:

> Read `src/app/**`, `src/components/**`, and `src/hooks/use-task-draft-store.ts`. Reconcile missing remote routes/pages, display model probe/review/publish status clearly, and keep route handlers thin. Do not change service logic except for response shape typing.

## Verification Commands

Use these commands after each focused change:

```powershell
npm run check
npm run build:web
```

If `npm run check` fails because `.next/types` references deleted routes, either restore the source routes from the accepted baseline or remove stale generated build artifacts before re-running. Do not hide real TypeScript errors by editing generated `.next` files.

## GEO Model Publish Chain Dispatch

Use `docs/geo-model-publish-chain-brainstorm.md` as the detailed task flow for model-to-platform work.

Current provider matrix:

- Doubao / Volcano Ark -> Toutiao, Baijiahao, Douyin.
- Tongyi / Qwen -> Zhihu, Weibo.
- DeepSeek -> CSDN, Zhihu.
- Yuanbao should be treated as Tencent Hunyuan-backed API work until a stable Yuanbao API exists -> Videohao, WeChat official account.

External route assumptions as of 2026-06-02:

- Doubao / Ark chat completions should normalize to `https://ark.cn-beijing.volces.com/api/v3/chat/completions`.
- Qwen should use DashScope / Qwen OpenAI-compatible chat completions.
- DeepSeek should use the official OpenAI-compatible DeepSeek chat API.
- Yuanbao consumer app is not a stable API target; Tencent Hunyuan is the API-backed adapter.
- Douyin official publishing requires approved OpenAPI capability, user authorization, and video creation scope; otherwise keep browser/manual fallback.
- WeChat official account has the strongest official publishing route through material, draft, publish, and status APIs.
- Toutiao, Baijiahao, Zhihu, CSDN, and Videohao should not be assumed to have stable public article publishing APIs for this product. Use Electron automation or manual delivery until official write access is confirmed.
- Weibo publish/share APIs need a fresh permission audit before implementation. Keep manual/browser fallback.

Dispatch order:

1. Stabilize Doubao model adapter.
2. Stabilize Doubao -> Toutiao/Baijiahao/Douyin publishing drafts and job invariants.
3. Standardize Electron automation stages/results for Toutiao, Baijiahao, and Douyin.
4. Expand Tongyi/Qwen and DeepSeek strategy assets and platform drafts.
5. Expand Yuanbao/Hunyuan into WeChat official account and Videohao delivery.
6. Add UI status panels for model probe, content review, draft route availability, and publish job execution.

Do not dispatch two workers to the same file set at the same time. Every worker must state changed files, checks run, external document assumptions, and remaining platform permission risk.

