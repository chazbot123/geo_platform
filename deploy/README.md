# GEO Server Deployment Runbook

This deploys the feedback, admin, license, and release-manifest services. Do not put secrets in source control.

## Environment

1. Copy `deploy/.env.example` to `deploy/.env`.
2. Replace every `replace-with-*` value with a strong secret.
3. Set all public endpoints to your HTTPS domain:
   - `RELEASE_BASE_URL=https://geo.example.com`
   - desktop `GEO_FEEDBACK_ENDPOINT=https://geo.example.com/api/feedback`
   - desktop `GEO_RELEASE_ENDPOINT=https://geo.example.com/api/releases/latest`
   - desktop `GEO_LICENSE_ACTIVATION_ENDPOINT=https://geo.example.com/api/licenses/activate`
   - desktop `GEO_LICENSE_STATUS_ENDPOINT=https://geo.example.com/api/licenses/status`

Raw HTTP IP endpoints are not production defaults. Production Next.js forwarders reject non-HTTPS upstreams.

## Start

```powershell
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
curl.exe -fsS https://geo.example.com/health
```

## HTTPS

`deploy/nginx/nginx.conf` is the plain reverse proxy for local or first boot. For production TLS, copy `deploy/nginx/nginx.tls.example.conf` to the active nginx config, replace `geo.example.com`, mount the certificate directories, and expose port 443.

Recommended certificate layout:

```text
/etc/letsencrypt/live/geo.example.com/fullchain.pem
/etc/letsencrypt/live/geo.example.com/privkey.pem
```

The TLS example redirects HTTP to HTTPS, adds HSTS and security headers, serves `/releases/`, and rate-limits `/api/` and `/api/admin/`.

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
  -ReleaseBaseUrl https://geo.example.com `
  -OutputPath .\deploy\releases\latest.json
```

Upload the installer and `latest.json` into the release volume or insert matching metadata into `release_metadata`. The server returns `sha256`, `size`, release notes, and the asset URL. Clients must block downloads when the SHA-256 does not match.

## Logs

`admin-api` writes JSON logs to stdout. Collect Docker logs with the host logging driver or a log collector. Request logs do not include request bodies, cookies, license codes, or admin passwords.
