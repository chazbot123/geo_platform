# Enterprise Profile Keyword Staleness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When core enterprise profile fields change, mark customer keywords stale and guide the user to regenerate instead of silently reusing old keywords.

**Architecture:** Customer keyword sets keep a generated-at enterprise snapshot and explicit stale metadata. Enterprise profile save compares previous and next core fields (`companyName`, `brandShortName`, `productService`, `region`) and marks existing keywords stale after successful persistence. Keyword reads also dynamically detect mismatch as a safety net while leaving already-running content generation batches untouched.

**Tech Stack:** Next.js 14 route handlers, TypeScript service modules, JSON file storage, Vitest.

---

### Task 1: Add service-level staleness tests

**Files:**
- Modify: `tests/enterprise-profile-service.test.ts`
- Modify: `tests/workflow-status.test.ts`

- [ ] Write failing tests that save keywords, change `productService`, and expect stale metadata plus `canCreateTask=false`.
- [ ] Write a test that changes only a non-core field and expects no stale metadata.
- [ ] Write a workflow test that stale keywords do not complete the customer keyword step.
- [ ] Run `npx vitest run tests/enterprise-profile-service.test.ts tests/workflow-status.test.ts` and verify failures are about missing stale behavior.

### Task 2: Implement keyword stale metadata and comparison helpers

**Files:**
- Modify: `src/lib/keywords/service.ts`

- [ ] Add `staleAt`, `staleReason`, and `staleFields` to `CustomerKeywordSet`.
- [ ] Add exported core field helpers to compare `companyName`, `brandShortName`, `productService`, and `region`.
- [ ] Add `markCustomerKeywordsStaleForEnterpriseChange(previous, next)` that writes stale metadata only when core fields differ.
- [ ] Make `getCustomerKeywordWorkbenchData()` return effective stale data even when old keyword files lack explicit stale metadata but no longer match the current enterprise profile.
- [ ] Make `saveCustomerKeywordSelection()` reject stale keyword sets.

### Task 3: Wire enterprise save to stale marking

**Files:**
- Modify: `src/lib/enterprise/service.ts`

- [ ] Read previous profile before save.
- [ ] Save the normalized next profile as before.
- [ ] After successful write, call keyword stale marking using previous and next profiles.
- [ ] Keep validation behavior unchanged.

### Task 4: Update workflow completion

**Files:**
- Modify: `src/lib/workflow/status-service.ts`

- [ ] Use the keyword service stale helper/effective status.
- [ ] Treat stale keywords as incomplete even with five saved selected questions.
- [ ] Return a clear reason that enterprise information changed and keywords need regeneration.

### Task 5: Update customer keyword UI guidance

**Files:**
- Modify: `src/components/keywords/customer-keyword-workbench.tsx`

- [ ] Add stale fields to `WorkbenchData`/`CustomerKeywordSet` usage.
- [ ] Show a warning when current keywords are stale.
- [ ] Disable saving old selections and task creation when stale.
- [ ] Keep the generate button available so users can regenerate immediately.

### Task 6: Verify

**Files:**
- No new files.

- [ ] Run `npx vitest run tests/enterprise-profile-service.test.ts tests/workflow-status.test.ts tests/customer-keyword-loading-lock.test.ts`.
- [ ] Run `npm run check`.
- [ ] Do not run `npm run build:web` unless needed; AGENTS notes it may hang and requires process inspection first.
