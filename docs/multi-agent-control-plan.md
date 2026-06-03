# GEO Multi-Agent Control Plan

## Purpose

This document is for the controller agent that will dispatch multiple worker agents.

The decision is:

- Use the GitHub `origin/main` version as the new product baseline.
- Preserve the current local mixed workspace before changing branches.
- Stabilize the online baseline first.
- Only dispatch parallel agents after the baseline is clean enough to avoid file conflicts.

## Current Situation

Repository:

```text
D:\geo
https://github.com/chazbot123/geo_platform.git
```

Known state from the latest audit:

```text
main...origin/main [ahead 2, behind 3]
origin/main latest inspected: a4a2871 Restore multi-platform draft workbench and publish updates
```

Interpretation:

- Local `main` is not the same as GitHub `origin/main`.
- Local has 2 commits not on GitHub.
- GitHub has 3 commits not on local `main`.
- The working tree has many modified, deleted, and untracked files.
- The current workspace is a mixed state, not a reliable baseline for multi-agent work.

## Non-Negotiable Rules

1. Do not run `git reset --hard`.
2. Do not discard local changes.
3. Do not let multiple agents edit the same file set at the same time.
4. Do not start feature work before the online baseline is protected and checked.
5. Every worker must report:
   - files changed
   - tests/checks run
   - unresolved risks
   - whether another worker may be affected
6. Keep `AGENTS.md` as the project handoff policy.
7. Do not edit generated `.next` files.
8. Do not commit secrets, API keys, cookies, browser sessions, runtime `data`, `.next`, `dist`, or local machine artifacts.

## Phase 0: Baseline Switch

This phase must be done by the controller or one coordinator agent only. Do not parallelize it.

### Goal

Create a clean branch from GitHub `origin/main`, while preserving the current local mixed state.

### Recommended Commands

Run from `D:\geo`:

```powershell
git status --short --branch
git branch backup/local-mixed-before-online-baseline
git stash push -u -m "backup local mixed workspace before adopting origin main"
git fetch origin main:refs/remotes/origin/main
git switch -c online-baseline origin/main
```

Then restore the handoff docs if they were stashed:

```powershell
git stash show --name-only stash@{0}
git checkout stash@{0} -- AGENTS.md docs/multi-agent-control-plan.md
```

If the checkout command fails because a file is not inside the stash, recreate or copy the missing doc manually from the controller context.

### Baseline Verification

Run:

```powershell
npm run check
npm run build:web
```

Expected possibilities:

- If both pass, proceed to Phase 1.
- If `npm run check` fails because source routes are missing, restore the source routes from `origin/main`, not generated `.next` files.
- If build fails on real source errors, assign a single stabilization worker before parallel work.

### Phase 0 Success Criteria

- Active branch is `online-baseline`.
- `AGENTS.md` exists.
- `docs/multi-agent-control-plan.md` exists.
- `git status --short --branch` is understood and documented.
- The controller knows whether `npm run check` and `npm run build:web` pass.

## Phase 1: Stabilization Worker

This is still mostly serial. Do not start broad parallel refactors yet.

### Stabilization Worker Prompt

```text
You are the GEO baseline stabilization worker.

Project path: D:\geo
Branch target: online-baseline

Read:
- AGENTS.md
- docs/multi-agent-control-plan.md
- package.json
- src/app/**
- src/lib/**

Goal:
Make the GitHub origin/main baseline verifiable without changing product direction.

Tasks:
1. Run git status --short --branch and report the branch/state.
2. Run npm run check.
3. Run npm run build:web if typecheck passes, or after fixing source-level type errors.
4. Fix only baseline-blocking source errors.
5. Do not edit publishing automation or model adapter logic unless a compile error directly requires it.
6. Do not edit generated .next files.
7. Do not remove local docs.

Deliver:
- changed files
- exact errors fixed
- commands run
- pass/fail result
- remaining blockers
```

### Success Criteria

- Typecheck is passing, or remaining failures are documented as external/environmental.
- Build is passing, or remaining failures are documented with exact source files.
- No broad refactor has started.

## Phase 2: Parallel Work Split

Start this phase only after Phase 0 is complete and Phase 1 has a known result.

Use at most 4 workers at once. Avoid running multiple heavy builds concurrently.

## Worker A: Model Adapter And Doubao/Ark

### File Ownership

Primary files:

- `src/lib/integrations/openai-compatible.ts`
- `src/lib/config/service.ts`
- `src/lib/integrations/stage1/client.ts`
- `src/lib/integrations/content/client.ts`
- optional test/script files under `scripts/` or a test folder if the repo has one

Do not edit:

- `src/lib/publish/**`
- `electron/**`
- UI pages/components unless needed only for type shape propagation

### Prompt

```text
You are Worker A: Model Adapter And Doubao/Ark.

Read AGENTS.md and docs/multi-agent-control-plan.md first.

Goal:
Make the model adapter provider-aware and make Doubao/Volcano Ark endpoint handling explicit.

Required work:
1. Inspect src/lib/integrations/openai-compatible.ts and src/lib/config/service.ts.
2. Add or refactor provider profile logic for:
   - newapi-auto
   - generic OpenAI-compatible
   - deepseek if already represented
   - volcengine-ark / doubao-style Ark endpoint
3. Ensure Ark can resolve:
   - https://ark.cn-beijing.volces.com/api/v3
   - https://ark.cn-beijing.volces.com/api/v3/chat/completions
4. Preserve NewAPI auto probing behavior.
5. Preserve mock fallback behavior in stage1/content flows.
6. Add focused tests or a lightweight verification script for endpoint candidate generation and error mapping.
7. Run npm run check.

Constraints:
- Do not change publishing service behavior.
- Do not touch Electron automation scripts.
- Do not log API keys.

Deliver:
- changed files
- endpoint examples verified
- commands run
- remaining risks
```

## Worker B: Content Strategy Quality Gate

### File Ownership

Primary files:

- `skills/**`
- `src/lib/content/prompt-loader.ts`
- `src/lib/content/review-service.ts`
- `src/lib/content/dispersion-service.ts`
- `src/lib/integrations/content/content-report-prompt.md`
- content-related route/service files only if necessary

Do not edit:

- `src/lib/integrations/openai-compatible.ts`
- `src/lib/publish/**`
- `electron/**`

### Prompt

```text
You are Worker B: Content Strategy Quality Gate.

Read AGENTS.md and docs/multi-agent-control-plan.md first.

Goal:
Make GEO content strategy assets safer and make review results first-class before publishing.

Required work:
1. Inspect skills/, src/lib/content/prompt-loader.ts, review-service.ts, dispersion-service.ts.
2. Treat skills/ as product strategy assets, not runtime agent instructions.
3. Add validation or defensive parsing for:
   - platform strategy JSON
   - risk words JSON
   - angle library JSON
   - AI scenario template loading
4. Ensure content review can report blockingIssues and warnings clearly.
5. If a content generation route already exists, make review output available in the service/API response without changing unrelated UI.
6. Run npm run check.

Constraints:
- Do not edit model adapter internals.
- Do not edit publishing automation.
- Keep mock generation path working.

Deliver:
- changed files
- validation behavior added
- commands run
- remaining risks
```

## Worker C: Publishing Service Refactor

### File Ownership

Primary files:

- `src/lib/publish/workbench-service.ts`
- `src/lib/publish/publish-orchestrator.ts`
- `src/lib/publish/jobs-service.ts`
- `src/lib/publish/platforms.ts`
- `src/lib/publish/provider-platform-matrix.ts`
- `src/lib/types.ts` only if necessary

Do not edit:

- `electron/**`
- `src/lib/integrations/openai-compatible.ts`
- content prompt assets

### Prompt

```text
You are Worker C: Publishing Service Refactor.

Read AGENTS.md and docs/multi-agent-control-plan.md first.

Goal:
Clean up publishing service boundaries without changing the product workflow.

Required work:
1. Inspect workbench-service.ts, publish-orchestrator.ts, jobs-service.ts, platforms.ts, provider-platform-matrix.ts.
2. Extract shared draft-building helpers so platform drafts and account drafts do not duplicate title/body/tag/image logic.
3. Implement or remove the misleading getDraftForJob function.
4. Make publishing job status transitions more explicit through helper functions.
5. Preserve manual delivery notes and existing execution modes.
6. Add invariants:
   - no publishing job without draft title/body
   - no ready automation job without platform/account prerequisites when available
7. Run npm run check.

Constraints:
- Do not edit Electron automation scripts.
- Do not edit model adapter internals.
- Keep existing UI API contracts unless a type-safe response adjustment is required.

Deliver:
- changed files
- duplicated logic removed
- job transition behavior
- commands run
- remaining risks
```

## Worker D: Electron Automation Isolation

### File Ownership

Primary files:

- `electron/main.js`
- `electron/local-bridge.js`
- `electron/publish-automation/*.js`
- `src/lib/publish/platform-publishers/electron-browser-publisher.ts`

Do not edit:

- model adapter files
- content strategy files
- publishing workbench service files unless a contract type needs one narrow change

### Prompt

```text
You are Worker D: Electron Automation Isolation.

Read AGENTS.md and docs/multi-agent-control-plan.md first.

Goal:
Make Electron/browser automation safer to maintain while preserving behavior.

Required work:
1. Inspect electron/publish-automation scripts and electron-browser-publisher.ts.
2. Identify shared DOM helpers currently duplicated across platform scripts.
3. Extract safe reusable helpers if possible without breaking script injection.
4. Standardize result shape:
   - status
   - failureStage
   - errorMessage
   - executionLog
   - verificationEvidence
5. Keep stage names stable and readable.
6. Preserve manual fallback if automation cannot verify a stage.
7. Run npm run check.

Constraints:
- Do not change model/content/publishing service logic.
- Do not weaken login/session safety.
- Do not log cookies or auth payloads.

Deliver:
- changed files
- helper extraction summary
- behavior preserved
- commands run
- remaining risks
```

## Worker E: Frontend Workflow

Start this worker only after Worker A/B/C have either completed or confirmed no API response shape changes are pending.

### File Ownership

Primary files:

- `src/app/**`
- `src/components/**`
- `src/hooks/use-task-draft-store.ts`
- route handlers only for UI response shape integration

Do not edit:

- `electron/**`
- core model adapter internals
- publishing service internals except response type integration

### Prompt

```text
You are Worker E: Frontend Workflow.

Read AGENTS.md and docs/multi-agent-control-plan.md first.

Goal:
Make the online-baseline workflow clear and operable in the UI.

Required work:
1. Inspect src/app/**, src/components/**, and route handlers.
2. Ensure the pages/routes expected by the accepted baseline exist.
3. Surface:
   - model probe status
   - content review blocking issues/warnings
   - draft generation status
   - publish execution status
4. Keep route handlers thin and services authoritative.
5. Improve error display without large visual redesign.
6. Run npm run check and npm run build:web if feasible.

Constraints:
- Do not refactor service internals.
- Do not create a marketing/landing-page style UI.
- Keep the desktop workflow dense and operational.

Deliver:
- changed files
- workflow states surfaced
- commands run
- remaining risks
```

## Merge Order

Use this order:

1. Phase 0 baseline switch.
2. Phase 1 stabilization.
3. Worker A and Worker B can run in parallel.
4. Worker C can run in parallel with A/B only if it does not need their response shapes.
5. Worker D can run in parallel with A/B/C because it owns Electron automation.
6. Worker E runs after A/B/C or after their API changes are known.
7. Final coordinator merges and runs:

```powershell
npm run check
npm run build:web
git status --short --branch
```

## Conflict Policy

If two workers touch the same file:

1. Stop merging that worker.
2. Ask the controller to inspect both diffs.
3. Prefer the change that preserves module boundaries.
4. If both are needed, create a coordinator patch rather than asking workers to keep editing blindly.

## Final Coordinator Checklist

- `AGENTS.md` still matches the project direction.
- `docs/multi-agent-control-plan.md` still matches actual branch state.
- GitHub online baseline features remain present:
  - provider/platform matrix
  - content strategy assets
  - content review
  - account publishing drafts
  - Electron automation publishers
- Doubao/Ark adapter behavior is explicit.
- Publishing services do not duplicate major draft logic.
- Automation scripts report stable stages.
- UI exposes actionable blockers.
- `npm run check` result is recorded.
- `npm run build:web` result is recorded.

