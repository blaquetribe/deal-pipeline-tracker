#!/bin/sh
# Runs every *.test.sql in this directory with pgTAP, as a superuser, inside the db container:
#   docker compose exec -T db sh /tests/run.sh      (make test-db)
# No Supabase CLI and no pg_prove needed: it parses the TAP output itself.
# Exit code is non-zero if any assertion fails, a plan does not match, or psql errors.
set -eu

DIR="${TESTS_DIR:-$(cd "$(dirname "$0")" && pwd)}" # TESTS_DIR lets the smoke test point at a deliberately failing test
export PGUSER="${PGUSER:-supabase_admin}" PGDATABASE="${PGDATABASE:-postgres}"

psql -X -q -v ON_ERROR_STOP=1 -c "create extension if not exists pgtap with schema extensions"

passed=0
failed=0
files=0
for file in $(ls "$DIR"/*.test.sql | sort); do
  files=$((files + 1))
  echo "== $(basename "$file")"
  status=0
  output=$(psql -X -v ON_ERROR_STOP=1 -t -A -c "set search_path to public, extensions" -f "$file" 2>&1) || status=$?
  printf '%s\n' "$output"

  ok_count=$(printf '%s\n' "$output" | grep -c '^ok ' || true)
  not_ok_count=$(printf '%s\n' "$output" | grep -c '^not ok ' || true)
  passed=$((passed + ok_count))
  failed=$((failed + not_ok_count))

  if [ "$status" -ne 0 ] || [ "$not_ok_count" -ne 0 ] || printf '%s\n' "$output" | grep -q '^# Looks like'; then
    failed=$((failed + 1))
    echo "FAILED: $(basename "$file")" >&2
  fi
done

echo
echo "pgTAP: $files file(s), $passed passed, $failed failed"
[ "$failed" -eq 0 ] && [ "$passed" -gt 0 ]
