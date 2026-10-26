#!/usr/bin/env bash
# Create or update the single advisory review comment on a pull request.
# Env: GH_TOKEN, REPO (owner/name), PR_NUMBER, and the comment file as $1.
set -euo pipefail

FILE="${1:?usage: post-comment.sh <comment-file>}"
: "${REPO:?}" "${PR_NUMBER:?}"

if [ ! -s "$FILE" ]; then
  echo "ai-review: nothing to post"
  exit 0
fi

# Only touch a comment the Actions bot wrote and that carries our marker.
EXISTING="$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" --paginate \
  --jq '.[] | select(.user.login == "github-actions[bot]" and (.body | contains("<!-- ai-review -->"))) | .id' |
  head -n 1)"

if [ -n "$EXISTING" ]; then
  gh api -X PATCH "repos/${REPO}/issues/comments/${EXISTING}" -F body=@"$FILE" >/dev/null
  echo "ai-review: updated comment ${EXISTING}"
else
  gh api -X POST "repos/${REPO}/issues/${PR_NUMBER}/comments" -F body=@"$FILE" >/dev/null
  echo "ai-review: posted a new comment"
fi
