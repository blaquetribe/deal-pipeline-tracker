#!/usr/bin/env bash
# Stop hook: when TypeScript/JSON files changed, run typecheck and tests before Claude finishes.
# Exit 2 sends the output back to Claude so it fixes the failure; exit 0 lets it stop.
set -u

input=$(cat)
# A previous failure already made Claude continue once: do not loop forever.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

changed=$(git status --porcelain 2>/dev/null | grep -E '\.(ts|tsx|mts|json)$' || true)
[ -z "$changed" ] && exit 0

if ! out=$(pnpm typecheck 2>&1 && pnpm test 2>&1); then
  {
    echo "typecheck/test failed; fix before finishing. Last output:"
    printf '%s\n' "$out" | tail -40
  } >&2
  exit 2
fi
exit 0
