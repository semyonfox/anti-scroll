$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  foreach ($manifest in @("manifest.json", "manifest.chromium.json", "manifest.firefox.json")) {
    Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json | Out-Null
  }

  $rootManifest = Get-Content -Raw -LiteralPath "manifest.json" | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress
  $chromiumManifest = Get-Content -Raw -LiteralPath "manifest.chromium.json" | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress
  if ($rootManifest -ne $chromiumManifest) {
    throw "manifest.json and manifest.chromium.json must stay semantically identical"
  }

  node --check src/constants.js
  node --check src/page-lock.js
  node --check src/background.js
  node --check src/content.js
  node --check popup/popup.js
  node scripts/smoke-test.js

  & $PSScriptRoot/build-extension.ps1 -Target chromium | Out-Host
  & $PSScriptRoot/build-extension.ps1 -Target firefox | Out-Host
}
finally {
  Pop-Location
}
