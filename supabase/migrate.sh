#!/bin/sh
# One-shot migration runner (no Supabase CLI needed). Used by the `migrate` compose service.
#
#  - Applies supabase/migrations/<digits>_<name>.sql in order, each in ONE transaction together
#    with its bookkeeping rows. A migration must therefore not contain begin/commit/rollback.
#  - Records versions in supabase_migrations.schema_migrations (the table the Supabase CLI uses,
#    so switching tools later stays possible) plus a SHA-256 per file.
#  - Refuses to run if an already-applied migration file was edited: add a new migration instead.
#  - Optionally runs supabase/seed.sql (must be idempotent) when SEED_DEV_DATA=true.
set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
SEED_FILE="${SEED_FILE:-/seed.sql}"
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-postgres}" PGDATABASE="${PGDATABASE:-postgres}"
: "${PGPASSWORD:?PGPASSWORD is required}"
export PGPASSWORD

run_sql() { psql -X -v ON_ERROR_STOP=1 -q -t -A "$@"; }

run_sql <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
create table if not exists supabase_migrations.migration_checksums (
  version text primary key references supabase_migrations.schema_migrations (version),
  sha256 text not null
);
SQL

applied_count=0
for file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  base=$(basename "$file" .sql)
  version=${base%%_*}
  name=${base#*_}

  case "$version" in
    '' | *[!0-9]*) echo "migrate: bad migration file name '$base' (expected <digits>_<name>.sql)" >&2; exit 1 ;;
  esac
  case "$name" in
    '' | *[!a-z0-9_-]*) echo "migrate: bad migration name '$name' in '$base' (use a-z 0-9 _ -)" >&2; exit 1 ;;
  esac
  if grep -Eiq '^[[:space:]]*(begin|commit|rollback)[[:space:]]*;' "$file"; then
    echo "migrate: $base contains transaction control; the runner wraps each migration in one transaction" >&2
    exit 1
  fi

  sum=$(sha256sum "$file" | cut -d' ' -f1)
  recorded=$(run_sql -c "select sha256 from supabase_migrations.migration_checksums where version = '$version'")

  if [ -n "$recorded" ]; then
    if [ "$recorded" != "$sum" ]; then
      echo "migrate: $base was modified after it was applied. Never edit an applied migration; add a new one." >&2
      exit 1
    fi
    continue
  fi

  already=$(run_sql -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")
  if [ -n "$already" ]; then
    # Applied by another tool: trust it and record the checksum from now on.
    run_sql -c "insert into supabase_migrations.migration_checksums (version, sha256) values ('$version', '$sum')"
    continue
  fi

  echo "migrate: applying $base"
  {
    echo "begin;"
    cat "$file"
    echo
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');"
    echo "insert into supabase_migrations.migration_checksums (version, sha256) values ('$version', '$sum');"
    echo "commit;"
  } | run_sql
  applied_count=$((applied_count + 1))
done

if [ "${SEED_DEV_DATA:-false}" = "true" ] && [ -s "$SEED_FILE" ]; then
  echo "migrate: seeding"
  run_sql -f "$SEED_FILE"
fi

echo "migrate: done ($applied_count applied)"
