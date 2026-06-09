# GEO Platform Production Landing Execution Plan

Date: 2026-06-09
Workspace: `D:\geo`
Target remote: `https://github.com/chazbot123/geo_platform.git`
Current working branch before push: `geo-five-step-rebuild-20260608`

## 1. Current State Summary

This project is beyond a prototype. It has a usable Next.js + Electron desktop workflow, a five-step GEO production flow, local JSON persistence, platform account login/session handling, content pool generation, Electron publishing automation scripts, feedback/admin server scaffolding, and update manifest support.

It is not production-ready yet. The main blockers are release hygiene, encoding reliability, deploy hardening, automated publishing reliability, queue/rate-control, authorization completion, test coverage, and operational observability.

Verified in this review:

- `npm run check` passed.
- `npm run build:web` was attempted earlier but hung and was interrupted. Build status is currently unknown.
- The workspace is dirty and includes multiple feature additions from this round.
- `.gitignore` excludes `.next/`, `dist/`, `release-dir/`, `data/`, `logs/`, `.ccpanes/`, `public/generated-images/`, and temp files.
- `package.json` no longer includes `extraResources.from = "data"`, so runtime account/session/auth data is no longer explicitly bundled into production installers.

## 2. Implemented Capabilities

### 2.1 Five-Step Desktop Workflow

Implemented routes:

- `/enterprise`
- `/customer-keywords`
- `/tasks/create`
- `/content-pool`
- `/publish-execution`
- `/settings`

The shell has a workflow status service and API. Navigation completion is now intended to come from persisted state instead of route order.

Production gap:

- Several status reason strings still show mojibake in terminal reads and must be verified in browser output.
- Workflow completion should be covered by tests because it gates user trust.

### 2.2 Model Settings

Implemented:

- Provider defaults now use OpenAI-compatible GPT.
- Text model default is `gpt5.5`.
- Image model default is `gpt-image-2`.
- Existing saved config is expected to merge with defaults rather than be overwritten.

Production gap:

- Provider/model names are product defaults but not proof that the upstream models exist or are available. The probe path must remain the source of truth.
- API key storage remains local JSON. For production, local config must be excluded from packaging and logs.

### 2.3 Task Planning, Platform Mapping, and Accounts

Implemented:

- Vertical GEO AI platform navigation.
- Vertical publish platform navigation.
- Platform SVG helper under `src/lib/platform-icons.ts`.
- Account list in task creation.
- Login/re-login and down-account/remove actions.
- Account detection with 30-minute cache.
- Default mapping:
  - `doubao -> toutiao, baijiahao, douyin`
  - `deepseek -> csdn, zhihu`
  - `yuanbao -> wechat, videohao`
  - `tongyi -> zhihu, weibo, xiaohongshu`
- Xiaohongshu is only mapped under Tongyi for this round.

Production gap:

- Icon imports currently depend on Chinese filenames. This is acceptable if UTF-8 is stable, but brittle in cross-platform build environments. Consider adding ASCII alias filenames or an asset manifest.
- The account list reuses the existing login APIs but does not yet extract full platform account IDs/avatars reliably from every platform DOM.
- Account deletion now removes saved task/draft bindings, but this needs tests.

### 2.4 Content Pool, Similarity Dispersion, and Risk Review

Implemented:

- Content pool expands publish plan into platform/account/day/slot items.
- Formula is account count x days x 2 articles per day.
- Per-account keyword offset exists.
- Planned publish time uses fixed slots.
- Risk levels exist: low, medium, high.
- Basic risky-word and platform-strategy checks exist.
- Similarity dispersion exists as angle/structure/prompt variation.
- Internal marker leakage checks block strings such as `sha256:`, `PGP SIGNATURE`, `<?php`, `GEO_CONTENT_ID:`, and `GEO_PROMPT_VERSION:`.

Production gap:

- Similarity dispersion is not a real similarity engine. There is no embedding, shingling, MinHash, cosine score, or threshold by platform/account.
- Risk review is partly rule-driven and partly sequence-driven in the content pool. Sequence-driven test/demo behavior must be replaced with content-derived review results.
- PGP/PHP signing is not implemented. Current code prevents such markers from leaking into public content.
- Public header/footer trust markers exist in execution-package design, but the publish draft insertion path must be verified per platform.

### 2.5 Publishing Automation

Implemented:

- Electron automation scripts exist for Toutiao, Baijiahao, Douyin, Xiaohongshu, WeChat, Videohao, Zhihu, Weibo, and CSDN.
- Jobs support statuses such as queued, running, submitted, pending review, verification failed, failed, and published.
- The Electron bridge uses `sessionPartition` per platform account.
- Several scripts detect login/verification/risk blocking text.

Production gap:

- There is no durable background job queue.
- There is no account-level cooldown, daily cap, retry backoff, or risk-score scheduler.
- Job creation can immediately execute queued jobs. That is useful for tests but not safe as a production scheduler.
- Platform DOM automation is inherently brittle. Each platform needs smoke tests and fallback handling.
- Browser fingerprint management is not implemented. `sessionPartition` is account session isolation, not a fingerprint browser.

### 2.6 Feedback, Admin, and Server Deployment

Implemented:

- Client feedback component and client helper.
- Next.js feedback forwarder.
- Docker Compose with Postgres, admin API, admin web, and nginx.
- Feedback table and admin filtering/status update.
- Device/license/binding tables reserved.

Production gap:

- Defaults point to `http://8.134.115.153`; production requires domain + HTTPS.
- Admin auth is Basic Auth. This is acceptable for a protected staging server, not for full production.
- No rate limiting, audit log, backup/restore workflow, or structured deployment runbook.
- Feedback types contain mojibake in some files and must be normalized.

### 2.7 Update System

Implemented:

- Client update check component and update client.
- Next.js update forwarder.
- Server release manifest API and static release hosting.
- SHA-256 verification before accepting downloaded release.
- Server stores release files/manifests/checksums rather than source-code update scripts.

Production gap:

- No signed installer pipeline.
- No `electron-updater` integration yet.
- No release upload/admin flow.
- `build:web` and Electron packaging must be made reliable before this is meaningful.

## 3. Agent Skills and Platform Writing Structure

### 3.1 What External Research Shows

Agent skills are typically project or user scoped `SKILL.md` folders with concise instructions and optional reference files. Official Claude documentation describes skills as folder-based assets with a `SKILL.md` entry point. Public repositories such as Anthropic's skills repo and community social-media skill repositories show the same pattern: a small trigger description plus task-specific instructions and references.

Useful sources:

- Claude Agent Skills documentation: https://docs.claude.com/en/docs/claude-code/skills
- Anthropic public skills repository: https://github.com/anthropics/skills
- Social media skills examples: https://github.com/blacktwist/social-media-skills
- Xiaohongshu platform creator service: https://creator.xiaohongshu.com/
- Douyin creator center: https://creator.douyin.com/creator-micro/mobile/content/post?enter_from=douyin_web_mobile

### 3.2 Recommendation for This Project

Do not blindly import arbitrary GitHub skills into the exe. Treat skills as audited product assets.

Recommended structure:

```text
skills/
  geo-platform-writing/
    SKILL.md
    references/
      toutiao.md
      baijiahao.md
      douyin.md
      xiaohongshu.md
      wechat.md
      videohao.md
      zhihu.md
      weibo.md
      csdn.md
      risk-language.md
      similarity-dispersion.md
```

The exe should not rely on a live agent reading arbitrary skills at runtime. Instead:

1. Convert platform writing skills into typed strategy assets.
2. Load them through `src/lib/content/prompt-loader.ts`.
3. Validate them at startup/build time.
4. Use them in content generation, review, and publish draft builders.
5. Keep the original `SKILL.md` as human/agent operating documentation.

This gives the project the benefits of skills while avoiding unreviewed prompt injection or supply-chain risk.

### 3.3 Platform Writing Skill Scope

Each platform reference should define:

- Audience posture.
- Title pattern.
- Opening pattern.
- Body structure.
- Evidence boundary.
- Risk language.
- CTA style.
- Image requirement.
- Forbidden public markers.
- Length constraints.
- Hashtag/topic guidance.
- Publish automation constraints.

Example platform rules:

- Xiaohongshu: practical note style, image-first, avoid fake experience and unverifiable claims, strong title/opening, tags, and concrete scenario.
- WeChat official account: longer logical article, clear sections, cautious evidence boundaries, optional public trace for update date/content ID.
- Zhihu: question-answer style, conclusion first, reasoning and boundaries, avoid advertorial tone.
- Weibo: short opinion/post style, concise body, topics, avoid overlong structured report text.
- CSDN: method/process/technical explanation style, clearer metadata and reproducibility boundaries.
- Douyin: short hook/script style, image/video content constraints, avoid long report structure.

## 4. Production-Grade Work Required

### Phase A: Repository and Encoding Hardening

Goal: make the repository clean, buildable, and free of user-facing mojibake.

Tasks:

- Normalize all Chinese text to UTF-8.
- Replace mojibake in `AGENTS.md`, planning docs, service messages, platform labels, package product name, feedback types, and workflow reasons.
- Add a script to scan for mojibake patterns.
- Keep runtime `data` out of Electron `extraResources`.
- Ensure runtime data lives under app user data or `GEO_DATA_DIR`, not the source tree.
- Confirm `.gitignore` excludes all runtime/generated artifacts.

Acceptance:

- `npm run check` passes.
- `npm run build:web` completes.
- No user-facing mojibake in browser screenshots.
- Installer does not contain account/session/auth data.

### Phase B: Test Foundation

Goal: stop relying only on TypeScript compilation.

Tasks:

- Add a test runner such as Vitest.
- Unit test:
  - version comparison
  - SHA-256 verification logic
  - workflow status completion
  - publish task article formula
  - platform matrix
  - account deletion cascade
  - feedback payload validation
- Add Playwright smoke tests for:
  - `/enterprise`
  - `/customer-keywords`
  - `/tasks/create`
  - `/content-pool`
  - `/publish-execution`
  - `/settings`

Acceptance:

- Tests can run without external APIs.
- Mock fallback behavior remains intact.

### Phase C: Production Deployment

Goal: deploy server components safely.

Tasks:

- Add domain and HTTPS.
- Replace default HTTP IP endpoints with env-controlled HTTPS endpoints.
- Add nginx TLS config or reverse proxy instructions.
- Add rate limiting to feedback and release APIs.
- Add structured logs.
- Add Postgres backup and restore procedure.
- Add migration versioning.
- Add deployment `.env.example` without secrets.

Acceptance:

- `/health` works.
- `/api/feedback` accepts valid payloads over HTTPS.
- `/admin` requires authentication.
- `/api/releases/latest` returns a release manifest with sha256.

### Phase D: Publishing Queue and Risk Control

Goal: make publishing operationally safe and auditable.

Tasks:

- Add durable queue state.
- Add per-account daily caps.
- Add per-platform cooldown.
- Add retry policy with exponential backoff.
- Add account risk state:
  - active
  - cooling_down
  - needs_login
  - verification_blocked
  - disabled
- If verification/risk/captcha appears, pause that account automatically.
- Add manual resume.
- Add publish audit log.

Acceptance:

- Jobs do not all execute immediately by default.
- A failed account does not keep retrying indefinitely.
- Operators can see why a job stopped.

### Phase E: Similarity and Content Quality

Goal: make platform content genuinely different and compliant.

Tasks:

- Add a deterministic similarity score:
  - title similarity
  - opening similarity
  - body shingle similarity
  - FAQ similarity
  - CTA similarity
- Optional later: embedding similarity if a model is configured.
- Store similarity history per platform/account/task.
- Block or require rewrite above thresholds.
- Move demo sequence-based risk generation to actual review outputs.

Acceptance:

- Same-batch articles cannot be near duplicates.
- Medium/high risk content cannot become publishable without review/rewrite.

### Phase F: Skills as Product Assets

Goal: introduce platform writing skills safely.

Tasks:

- Create `skills/geo-platform-writing/SKILL.md`.
- Create per-platform reference files.
- Add schema validation for references.
- Feed reference output into `prompt-loader`, content generation, review, and draft builders.
- Do not allow remote skill downloads inside the exe.
- If external GitHub skills are used, vendor them after review and record source/version.

Acceptance:

- Platform strategy is auditable.
- Generated drafts follow platform-native structures.
- No untrusted remote prompt package is executed at runtime.

### Phase G: Authorization

Goal: finish one-machine-one-code without breaking legitimate users.

Tasks:

- Define stable machine fingerprint rules.
- Add activation API.
- Add license binding API.
- Add disable/expire behavior.
- Add client-side status UI.
- Keep secrets server-side.
- Add grace period and support recovery.

Acceptance:

- Admin can issue/disable licenses.
- Client can activate and show license state.
- No license secret is hardcoded in source.

### Phase H: Release Pipeline

Goal: make updates safe and repeatable.

Tasks:

- Restore production installer target when ready.
- Sign Windows installer.
- Generate sha256 and release notes automatically.
- Upload release artifact to server.
- Update manifest atomically.
- Consider `electron-updater` after first stable manual-update release.

Acceptance:

- A clean machine can install and update.
- SHA-256 mismatch blocks the update.
- The server never serves source code as an update.

## 5. Immediate Next Steps

Recommended order:

1. Push this branch to GitHub for backup and review.
2. Fix encoding/mojibake.
3. Keep bundled `data` out of Electron packaging.
4. Resolve `npm run build:web` hang.
5. Add minimum tests.
6. Add `skills/geo-platform-writing` as audited project assets.
7. Harden server deployment and release endpoints.

## 6. Verification Record

Completed:

```powershell
npm run check
```

Result: passed.

Not completed:

```powershell
npm run build:web
```

Reason: previous run hung and was interrupted. There are multiple active `node.exe` processes on the machine; process ownership should be checked before retrying.
