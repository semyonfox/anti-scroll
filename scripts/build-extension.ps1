param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chromium", "firefox")]
  [string] $Target,

  [string] $OutRoot = "dist"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$outRootPath = Join-Path $repoRoot $OutRoot
$outDir = Join-Path $outRootPath $Target
$resolvedOutRoot = [System.IO.Path]::GetFullPath($outRootPath)
$resolvedOutDir = [System.IO.Path]::GetFullPath($outDir)

if (-not $resolvedOutDir.StartsWith($resolvedOutRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write outside output root: $resolvedOutDir"
}

if (Test-Path $resolvedOutDir) {
  Remove-Item -LiteralPath $resolvedOutDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $resolvedOutDir | Out-Null

foreach ($folder in @("src", "popup")) {
  Copy-Item -LiteralPath (Join-Path $repoRoot $folder) -Destination $resolvedOutDir -Recurse
}

Copy-Item -LiteralPath (Join-Path $repoRoot "README.md") -Destination $resolvedOutDir

$manifestFile = Join-Path $repoRoot "manifest.$Target.json"
Copy-Item -LiteralPath $manifestFile -Destination (Join-Path $resolvedOutDir "manifest.json")

Write-Output "Built $Target extension at $resolvedOutDir"
