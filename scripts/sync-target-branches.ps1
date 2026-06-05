param(
  [string] $SourceBranch = "main",
  [string[]] $TargetBranches = @("chromium", "firefox"),
  [switch] $Push
)

$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
if (-not $repoRoot) {
  throw "Not inside a git repository"
}

Push-Location $repoRoot
try {
  $dirty = git status --porcelain
  if ($dirty) {
    throw "Working tree is dirty. Commit or stash changes before syncing target branches."
  }

  $currentBranch = git branch --show-current
  git rev-parse --verify $SourceBranch | Out-Null

  foreach ($branch in $TargetBranches) {
    git branch -f $branch $SourceBranch | Out-Null
    Write-Output "$branch now points at $SourceBranch"

    if ($Push) {
      git push --force-with-lease origin "${branch}:${branch}"
    }
  }

  if ($currentBranch) {
    git checkout $currentBranch | Out-Null
  }
}
finally {
  Pop-Location
}
