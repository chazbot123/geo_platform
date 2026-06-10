# GEO Admin Management Agent Dispatch

Date: 2026-06-10
Source requirements: `docs/superpowers/specs/2026-06-10-geo-admin-management-requirements.md`
Target domain: `https://geoadmin.jizhidaoai.com`

## Required Worker Rules

Every worker must start with:

```powershell
git status --short --branch
```

Do not run `git reset --hard`, `git checkout -- .`, broad cleanup commands, or destructive filesystem operations.

Do not commit or log:

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

When touching user-facing Chinese copy, verify it is clean UTF-8 and not mojibake.

## Delivery Shape

The target implementation is方案 2:

- 后台管理只保留三个一级功能：授权管理、意见箱、版本管理。
- 桌面端未授权时可浏览但不可操作。
- 意见箱上传到服务器 Postgres。
- 版本管理通过 Docker 部署的后台上传和发布更新包。
- 生产域名为 `geoadmin.jizhidaoai.com`，生产环境必须使用 HTTPS。

Backend architecture must be project-level Docker architecture:

- `server/admin-api` owns API, database migrations, release metadata, upload handling.
- `server/admin-web` owns admin UI.
- `deploy/docker-compose.yml` starts Postgres, admin-api, admin-web, nginx.
- `deploy/nginx/**` owns domain, TLS, `/api/*`, `/admin/*`, `/releases/*`, `/health` routing.
- Release files live in a Docker volume or configured server directory, never in source code.

## Worker 1: Admin API

Ownership:

- `server/admin-api/src/server.js`
- `server/admin-api/db/schema.sql`
- `server/admin-api/db/migrations/**`
- API-level tests if introduced under the server package or root test suite

Responsibilities:

- Normalize feedback type strings to clean UTF-8.
- Keep existing public endpoints:
  - `POST /api/feedback`
  - `POST /api/licenses/activate`
  - `GET /api/licenses/status`
  - `GET /api/releases/latest`
- Add admin release endpoints:
  - `GET /api/admin/releases`
  - `POST /api/admin/releases`
  - `POST /api/admin/releases/:id/publish`
  - `PATCH /api/admin/releases/:id`
- Add authorization reset endpoint:
  - `POST /api/admin/license-codes/:id/reset-binding`
- Ensure reset marks active bindings as `revoked`, sets `revoked_at`, and returns the license to `available` unless it is `disabled` or `expired`.
- Ensure version package upload calculates SHA-256 server-side and stores file metadata in `release_metadata`.
- Keep admin authentication and rate limiting active on all admin endpoints.
- Avoid logging license codes, upload auth headers, cookies, or secrets.

Verification:

```powershell
npm run check
```

Add or update focused tests for:

- feedback validation
- license activation success
- duplicate device rejection for `maxDevices=1`
- license binding reset
- disabled license status
- release metadata SHA-256 validation

## Worker 2: Admin Web

Ownership:

- `server/admin-web/src/index.html`
- `server/admin-web/src/app.js`
- `server/admin-web/src/styles.css`

Responsibilities:

- Replace current tab structure with exactly three primary sections:
  - 授权管理
  - 意见箱
  - 版本管理
- Fix all admin-web mojibake.
- 授权管理 must show:
  - create authorization code form
  - license list
  - bound device summary
  - reset binding action
  - disable action
- 意见箱 must show:
  - feedback list
  - filters for status, type, version, device
  - detail panel
  - status and handler note update
- 版本管理 must show:
  - version upload form
  - version, platform, arch, notes, mandatory flag, min supported version
  - release list with SHA-256, size, published state, download path
  - publish or disable action
- Keep the UI dense and operational. This is an admin tool, not a marketing page.

Verification:

- Load admin web locally through the configured dev or Docker route.
- Confirm only three primary navigation items exist.
- Confirm text is clean Chinese.
- Confirm forms call the expected API endpoints and display API errors.

## Worker 3: Desktop Authorization Gate

Ownership:

- `src/lib/license/client.ts`
- `src/components/settings/license-status-box.tsx`
- shared authorization guard module to be created under `src/lib/license/`
- workflow pages and components that perform write/generate/publish actions

Responsibilities:

- Implement a reusable authorization state service.
- Preserve browsing access for unauthorized devices.
- Disable or intercept these actions when unauthorized:
  - enterprise profile save
  - customer keyword save and confirm
  - task creation
  - folder import
  - content generation
  - content pool mutation
  - publishing account login or removal
  - publish job creation and execution
  - model/API settings save
  - update package download
- Allow these actions when unauthorized:
  - browsing pages
  - viewing local data
  - checking license status
  - activating license
  - submitting feedback
  - checking latest version
- Use this message for blocked actions:
  - `当前设备未授权，请先在设置中激活授权码。`

Verification:

```powershell
npm run check
```

Add tests for the guard decision matrix and at least one representative blocked action.

## Worker 4: Feedback And Update Client Integration

Ownership:

- `src/app/api/feedback/route.ts`
- `src/app/api/updates/latest/route.ts`
- `src/app/api/license/activate/route.ts`
- `src/app/api/license/status/route.ts`
- `src/lib/feedback/**`
- `src/lib/updates/client.ts`
- `src/components/settings/feedback-box.tsx`
- `src/components/settings/update-check-box.tsx`

Responsibilities:

- Point production env examples and documentation to:
  - `https://geoadmin.jizhidaoai.com/api/feedback`
  - `https://geoadmin.jizhidaoai.com/api/licenses/activate`
  - `https://geoadmin.jizhidaoai.com/api/licenses/status`
  - `https://geoadmin.jizhidaoai.com/api/releases/latest`
- Fix mojibake in feedback, license, and update UI strings.
- Keep production HTTPS enforcement.
- Keep SHA-256 verification before update package use.
- Ensure update check can run while unauthorized, but update download is blocked unless authorized.

Verification:

```powershell
npm run check
```

Run focused tests for:

- feedback payload validation
- version comparison
- SHA-256 match and mismatch
- update download blocked when unauthorized

## Worker 5: Docker Deployment

Ownership:

- `deploy/docker-compose.yml`
- `deploy/nginx/nginx.conf`
- `deploy/nginx/nginx.tls.example.conf`
- `deploy/README.md`
- `.env.example` or deployment example file if present or added

Responsibilities:

- Ensure Docker compose defines:
  - postgres
  - admin-api
  - admin-web
  - nginx
- Add or verify persistent volumes:
  - Postgres data
  - release upload files
- Route:
  - `/api/*` to admin-api
  - `/admin/*` or `/` to admin-web
  - `/releases/*` to read-only release files
  - `/health` to admin-api
- Document production domain:
  - `geoadmin.jizhidaoai.com`
- Document required environment variables without secrets:
  - `DATABASE_URL`
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`
  - `CORS_ORIGIN`
  - `RELEASE_BASE_URL`
  - `RELEASES_DIR`
  - rate limit settings
- Keep release files outside source code and outside git.

Verification:

```powershell
docker compose -f deploy/docker-compose.yml config
```

If running services is safe in the current environment:

```powershell
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps
```

## Coordination Rules

- Worker 1 and Worker 2 may work in parallel after agreeing on API request and response shapes.
- Worker 3 must wait for Worker 1's license status response contract or mock it explicitly in tests.
- Worker 4 can proceed in parallel for mojibake and endpoint cleanup, but must coordinate with Worker 3 before adding update-download authorization blocking.
- Worker 5 can proceed independently as long as it does not change API route names without notifying Worker 1 and Worker 2.

## Final Report Required From Each Worker

Each worker must report:

- changed files
- commands run
- verification results
- unresolved risks
- whether another worker may be affected

If `npm run build:web` is not run, state why. If a production blocker remains, state it directly.
