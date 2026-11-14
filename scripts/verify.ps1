$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  node scripts/generate-manifests.js --check
  if ($LASTEXITCODE -ne 0) { throw "Generated manifests are stale" }
  foreach ($manifest in @("manifest.json", "manifest.chromium.json", "manifest.firefox.json")) {
    Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json | Out-Null
  }

  $rootManifest = Get-Content -Raw -LiteralPath "manifest.json" | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress
  $chromiumManifest = Get-Content -Raw -LiteralPath "manifest.chromium.json" | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress
  if ($rootManifest -ne $chromiumManifest) {
    throw "manifest.json and manifest.chromium.json must stay semantically identical"
  }

  node scripts/verify.js
  if ($LASTEXITCODE -ne 0) { throw "Local verification failed" }

  & $PSScriptRoot/build-extension.ps1 -Target chromium | Out-Host
  & $PSScriptRoot/build-extension.ps1 -Target firefox | Out-Host
}
finally {
  Pop-Location
}
