# GEO Server Deployment Runbook

This compose stack only starts basic infrastructure services such as PostgreSQL. Run the feedback, admin, license, release-manifest API, static admin web files, and nginx on the host or with your process supervisor. Do not put secrets in source control.

## Environment

1. Copy `deploy/.env.example` to `deploy/.env`.
2. Replace `POSTGRES_PASSWORD` with a strong secret.
3. Configure the host-running admin API with environment variables:
   - `PORT=8080`
   - `DATABASE_URL=postgres://geo_admin:<POSTGRES_PASSWORD>@127.0.0.1:5432/geo_admin`
   - `ADMIN_USERNAME=geo-admin`
   - `ADMIN_PASSWORD=<strong secret>`
   - `CORS_ORIGIN=https://geoadmin.jizhidaoai.com`
   - `RELEASE_BASE_URL=https://geoadmin.jizhidaoai.com`
   - `RELEASES_DIR=/var/www/releases`
   - `RATE_LIMIT_WINDOW_MS=60000`
   - `PUBLIC_RATE_LIMIT_MAX=60`
   - `ADMIN_RATE_LIMIT_MAX=300`
   - `RELEASE_UPLOAD_LIMIT=500mb`
4. Set all public endpoints to your HTTPS domain:
   - `RELEASE_BASE_URL=https://geoadmin.jizhidaoai.com`
   - desktop `GEO_FEEDBACK_ENDPOINT=https://geoadmin.jizhidaoai.com/api/feedback`
   - desktop `GEO_RELEASE_ENDPOINT=https://geoadmin.jizhidaoai.com/api/releases/latest`
   - desktop `GEO_LICENSE_ACTIVATION_ENDPOINT=https://geoadmin.jizhidaoai.com/api/licenses/activate`
   - desktop `GEO_LICENSE_STATUS_ENDPOINT=https://geoadmin.jizhidaoai.com/api/licenses/status`

Raw HTTP IP endpoints are not production defaults. Production Next.js forwarders reject non-HTTPS upstreams.

## Start

```powershell
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
cd server/admin-api
npm install
npm start
curl.exe -fsS https://geoadmin.jizhidaoai.com/health
```

The compose command starts PostgreSQL only. Keep `admin-api` under a host process supervisor such as systemd, PM2, or your deployment platform. Serve `server/admin-web/src` from host nginx at `/admin/`; the provided nginx examples assume the repository is deployed at `/opt/geo`.

## HTTPS

`deploy/nginx/nginx.conf` is the plain host nginx reverse proxy for local or first boot. For production TLS, copy `deploy/nginx/nginx.tls.example.conf` to the active host nginx config, install certificates for `geoadmin.jizhidaoai.com`, and expose port 443.

Recommended certificate layout:

```text
/etc/letsencrypt/live/geoadmin.jizhidaoai.com/fullchain.pem
/etc/letsencrypt/live/geoadmin.jizhidaoai.com/privkey.pem
```

The TLS example redirects HTTP to HTTPS, adds HSTS and security headers, serves `/admin/` from `/opt/geo/server/admin-web/src`, serves `/releases/` from `/var/www/releases`, proxies `/api/` to the host API on `127.0.0.1:8080`, and rate-limits `/api/` and `/api/admin/`.

## Migrations

`server/admin-api/src/server.js` always runs `db/schema.sql`, then applies ordered files from `server/admin-api/db/migrations`. Applied migration versions are stored in `schema_migrations`.

Rules:

- migrations must be idempotent where possible;
- never edit an already-deployed migration;
- add a new timestamped migration file for production changes.

## Backups

Create a dump:

```powershell
.\deploy\scripts\backup-postgres.ps1
```

Restore a dump:

```powershell
.\deploy\scripts\restore-postgres.ps1 -BackupFile .\deploy\backups\geo-admin-YYYYMMDD-HHMMSS.dump
```

Restore replaces objects in the configured admin database. Take a fresh backup before restoring.

## Release Manifest

Generate release notes and SHA-256 manifest:

```powershell
.\deploy\scripts\generate-release-manifest.ps1 `
  -ArtifactPath .\release-dir\GEO-Desktop-0.1.0.exe `
  -Version 0.1.0 `
  -NotesPath .\release-dir\notes-0.1.0.md `
  -ReleaseBaseUrl https://geoadmin.jizhidaoai.com `
  -OutputPath .\deploy\releases\latest.json
```

Upload the installer and `latest.json` into `RELEASES_DIR` or insert matching metadata into `release_metadata`. The server returns `sha256`, `size`, release notes, and the asset URL. Clients must block downloads when the SHA-256 does not match.

## Logs

`admin-api` writes JSON logs to stdout. Collect host process logs with your service manager or log collector. Request logs do not include request bodies, cookies, license codes, or admin passwords.
