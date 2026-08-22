#!/usr/bin/env bash
set -euo pipefail

source_branch="main"
targets="chromium,firefox"
do_push=false
current=""

usage() {
  echo "usage: sync-target-branches.sh [-s source] [-t branch,branch] [-p]" >&2
  echo "  -s  source branch (default: main)" >&2
  echo "  -t  comma-separated target branches (default: chromium,firefox)" >&2
  echo "  -p  force-update origin/<target> with --force-with-lease" >&2
  exit 1
}

while getopts "s:t:ph" opt; do
  case "$opt" in
    s) source_branch="$OPTARG" ;;
    t) targets="$OPTARG" ;;
    p) do_push=true ;;
    *) usage ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)" || {
  echo "error: not inside a git repository" >&2
  exit 1
}
cd "$repo_root"

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty. commit or stash changes before syncing target branches." >&2
  exit 1
fi

git rev-parse --verify --quiet "$source_branch" >/dev/null || {
  echo "error: source branch '$source_branch' not found" >&2
  exit 1
}

IFS=',' read -r -a target_branches <<< "$targets"
for branch in "${target_branches[@]}"; do
  branch="$(echo "$branch" | tr -d '[:space:]')"
  [ -n "$branch" ] || continue
  git branch -f "$branch" "$source_branch"
  echo "$branch now points at $source_branch"

  if [ "$do_push" = true ]; then
    git push --force-with-lease origin "${branch}:${branch}"
  fi
done

current="$(git branch --show-current)"
[ -z "$current" ] || git checkout --quiet "$current"
