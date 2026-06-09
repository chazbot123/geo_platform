param(
  [string]$ComposeFile = "deploy/docker-compose.yml",
  [string]$OutputDir = "deploy/backups"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputFile = Join-Path $OutputDir "geo-admin-$timestamp.dump"

docker compose -f $ComposeFile exec -T postgres sh -lc 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > $outputFile

Write-Host "Backup written to $outputFile"
