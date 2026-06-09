param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$ComposeFile = "deploy/docker-compose.yml"
)

$ErrorActionPreference = "Stop"

$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
if (-not $resolvedBackup) {
  throw "Backup file not found: $BackupFile"
}

Write-Host "Restoring $resolvedBackup"
Write-Host "This replaces objects in the configured GEO admin database."

docker compose -f $ComposeFile cp $resolvedBackup postgres:/tmp/geo-restore.dump
docker compose -f $ComposeFile exec -T postgres sh -lc 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/geo-restore.dump'

Write-Host "Restore completed"
