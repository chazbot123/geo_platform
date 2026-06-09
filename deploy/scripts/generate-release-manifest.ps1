param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactPath,
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$NotesPath = "",
  [string]$Platform = "win32",
  [string]$Arch = "x64",
  [string]$Channel = "stable",
  [string]$ReleaseBaseUrl = "",
  [string]$OutputPath = "deploy/releases/latest.json",
  [switch]$Mandatory
)

$ErrorActionPreference = "Stop"

$artifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
if (-not $artifact) {
  throw "Artifact not found: $ArtifactPath"
}

$notes = ""
if ($NotesPath) {
  $notesFile = (Resolve-Path -LiteralPath $NotesPath).Path
  if (-not $notesFile) {
    throw "Release notes file not found: $NotesPath"
  }
  $notes = Get-Content -Raw -LiteralPath $notesFile
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash.ToLowerInvariant()
$fileName = Split-Path -Leaf $artifact
$assetPath = "releases/$fileName"
$base = $ReleaseBaseUrl.TrimEnd("/")
$assetUrl = if ($base) { "$base/$assetPath" } else { "/$assetPath" }
$size = (Get-Item -LiteralPath $artifact).Length

$manifest = [ordered]@{
  version = $Version
  channel = $Channel
  publishedAt = (Get-Date).ToUniversalTime().ToString("o")
  notes = $notes
  mandatory = [bool]$Mandatory
  platform = $Platform
  arch = $Arch
  windows = [ordered]@{
    path = $fileName
    url = $assetUrl
    sha256 = $hash
    size = $size
  }
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Release manifest written to $OutputPath"
Write-Host "SHA-256 $hash"
