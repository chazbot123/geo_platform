param(
  [string]$OutputDir = "release-dir\geoadmin-server-package"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$targetRoot = Join-Path $repoRoot $OutputDir

if (Test-Path $targetRoot) {
  Remove-Item $targetRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $targetRoot | Out-Null

$copyItems = @(
  @{ Source = "deploy"; Destination = "deploy" },
  @{ Source = "server\admin-api"; Destination = "server\admin-api" },
  @{ Source = "server\admin-web"; Destination = "server\admin-web" }
)

foreach ($item in $copyItems) {
  $sourcePath = Join-Path $repoRoot $item.Source
  $destinationPath = Join-Path $targetRoot $item.Destination
  $destinationParent = Split-Path -Parent $destinationPath

  if (-not (Test-Path $destinationParent)) {
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  }

  Copy-Item -Path $sourcePath -Destination $destinationPath -Recurse -Force
}

Write-Host "Admin server package prepared at: $targetRoot"
