# GEO Platform Agents Guide

Workspace: `D:\geo`
Remote: `https://github.com/chazbot123/geo_platform.git`
Current production-readiness document: `docs/production_landing_execution_plan_20260609.md`

## Baseline Rules

Every worker must run this before editing:

```powershell
git status --short --branch
```

Do not assume the workspace is clean. This repository may contain user edits, generated runtime files, and other-agent changes.

Never run:

- `git reset --hard`
- `git checkout -- .`
- broad delete/cleanup commands
- destructive filesystem operations

Generated/runtime data must not be committed:

- `.next/`
- `dist/`
- `release-dir/`
- `data/`
- `logs/`
- `.ccpanes/`
- `public/generated-images/`
- browser profiles
- cookies
- auth payloads
- API keys
- license secrets
- release signing secrets

## Current Product Shape

The app is a Next.js 14 + React 18 + Electron desktop product.

Main commands:

```powershell
npm run check
npm run build:web
npm run dev:web
npm run dev:electron
npm run dist
```

Main workflow routes:

- `src/app/enterprise/page.tsx`
- `src/app/customer-keywords/page.tsx`
- `src/app/tasks/create/page.tsx`
- `src/app/content-pool/page.tsx`
- `src/app/publish-execution/page.tsx`
- `src/app/settings/page.tsx`

Server/admin scope:

- `server/admin-api/**`
- `server/admin-web/**`
- `deploy/docker-compose.yml`
- `deploy/nginx/**`

## Current Verification Status

Known passing:

```powershell
npm run check
```

Known unresolved:

```powershell
npm run build:web
```

The previous build attempt hung and was interrupted. Before retrying, inspect active `node.exe` processes and clear stale dev/build sessions safely.

## Production Blockers

These are priority blockers before real deployment:

1. Fix all mojibake and verify clean UTF-8 Chinese UI copy.
2. Remove runtime `data` from Electron `extraResources`.
3. Make `npm run build:web` complete reliably.
4. Add a minimal automated test suite.
5. Add HTTPS/domain deployment for feedback, admin, and update APIs.
6. Harden admin authentication, rate limiting, logs, backups, and release handling.
7. Add a durable publish queue with account cooldown/rate limits.
8. Replace demo/sequence-based risk behavior with content-derived review results.
9. Add real similarity scoring and duplicate prevention.
10. Finish authorization activation/binding before enforcing license checks.

## Platform Mapping

Default mapping for this round:

```text
doubao -> toutiao, baijiahao, douyin
deepseek -> csdn, zhihu
yuanbao -> wechat, videohao
tongyi -> zhihu, weibo, xiaohongshu
```

Rules:

- Xiaohongshu only appears under Tongyi by default in this phase.
- Users cannot freely add unmapped publish platforms in this phase.
- Future mapping changes must use configuration or product flags, not scattered hardcoded UI exceptions.

Platform icon helper:

- `src/lib/platform-icons.ts`

SVG assets:

- `src/img/豆包.svg`
- `src/img/deepseek.svg`
- `src/img/腾讯元宝.svg`
- `src/img/通义千问.svg`
- `src/img/今日头条.svg`
- `src/img/百家号-nh.svg`
- `src/img/抖音.svg`
- `src/img/小红书.svg`
- `src/img/公众号.svg`
- `src/img/视频号.svg`
- `src/img/知乎.svg`
- `src/img/微博.svg`
- `src/img/csdn.svg`

If cross-platform build encoding becomes brittle, add ASCII alias filenames or an asset manifest.

## Workflow Completion Semantics

Navigation checkmarks must be driven by real saved state, not route order.

Completion rules:

- Enterprise: required fields are saved and `lastSavedAt` exists.
- Customer keywords: exactly 5 selected questions are saved.
- Task creation: a publish plan exists with `totalArticleCount > 0`.
- Content pool: current task has persisted content pool items and at least one item reached sample or pending publish state.
- Publish execution: current task has publish progress or any article-level job record.

Relevant files:

- `src/lib/workflow/status-service.ts`
- `src/app/api/workflow/status/route.ts`
- `src/components/layout/app-shell.tsx`

Save actions should dispatch only after successful persistence:

```ts
window.dispatchEvent(new Event("geo-workflow-status-refresh"));
```

## Account and Publishing Rules

Relevant account files:

- `src/components/publish/platform-account-center.tsx`
- `src/components/tasks/task-planning-workbench.tsx`
- `src/lib/publish/accounts-service.ts`
- `src/lib/publish/electron-login-client.ts`
- `src/app/api/publish/accounts/**`

Rules:

- Do not log cookies, sessions, API keys, auth payloads, raw browser storage, or license secrets.
- Account deletion/down-account must remove task and draft bindings.
- Account detection cache remains 30 minutes with manual refresh.
- A publishable account is authenticated, valid, Electron/session based, and not manual-only.

## Content Quality and Skills

Do not import arbitrary remote skills into the executable at runtime.

Approved direction:

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

Skill/reference assets must be:

- reviewed before vendoring
- committed as source assets
- schema-validated before use
- loaded through typed services, not dynamically executed as remote prompt code

Preferred integration points:

- `src/lib/content/prompt-loader.ts`
- `src/lib/content/review-service.ts`
- `src/lib/content/dispersion-service.ts`
- `src/lib/publish/draft-builders.ts`

Platform writing references should define:

- title style
- opening pattern
- body structure
- evidence boundaries
- risk language
- CTA style
- image requirements
- public trace policy
- forbidden markers
- publish constraints

Current PGP/PHP/hash behavior:

- PGP signing is not implemented.
- PHP comment signing is not implemented.
- Full hash is internal only.
- Internal markers must not enter public article body.

## Server and Update Rules

Feedback and updates currently route through local Next.js forwarders:

- `src/app/api/feedback/route.ts`
- `src/app/api/updates/latest/route.ts`

Production requirements:

- Use domain + HTTPS, not long-term raw HTTP IP.
- Keep server credentials in deployment environment variables.
- Store releases as artifacts/manifests/checksums/notes, not source code.
- Release files must include SHA-256.
- Client must not execute arbitrary remote scripts.

Server directories:

- `server/admin-api/**`
- `server/admin-web/**`
- `deploy/**`

## Worker Ownership Guidance

Use one worker per area. Do not let two workers edit the same file set at the same time.

Recommended ownership:

- Encoding/repo hygiene: `AGENTS.md`, docs, package metadata, user-facing strings.
- Workflow shell: `app-shell`, workflow service/API, save-event dispatches.
- Task/account UI: task planning workbench, platform matrix, icons, account display.
- Content quality: content services, prompt loader, review, dispersion, draft builders.
- Publishing queue: jobs service, execution service, publish execution UI, server runner.
- Server/admin: admin API/web, Docker, nginx, schema.
- Update/release: update client/API, release manifest server, Electron updater.
- Testing: unit tests, API tests, Playwright smoke tests.

## Required Final Report Format

Every worker must report:

- changed files
- commands run
- verification results
- unresolved risks
- whether another worker may be affected

If `npm run build:web` is not run, say why.

If a production blocker remains, state it directly.
