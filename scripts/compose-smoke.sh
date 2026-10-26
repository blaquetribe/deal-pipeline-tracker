#!/usr/bin/env bash
# Clean-clone proof: build and start the stack, then test it only through the gateway.
# Usage: scripts/compose-smoke.sh            (builds, tests, tears down)
#        KEEP_UP=1 scripts/compose-smoke.sh  (leave the stack running afterwards)
set -euo pipefail

cd "$(dirname "$0")/.."

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "FAIL: neither 'docker compose' nor 'docker-compose' is available" >&2
  exit 1
fi

PORT="${GATEWAY_PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"
failures=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; failures=$((failures + 1)); }

check() { # check "<description>" <command...>
  local description=$1
  shift
  if "$@" >/dev/null 2>&1; then pass "$description"; else fail "$description"; fi
}

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ] || [ "$failures" -ne 0 ]; then
    echo "--- service logs (tail) ---" >&2
    "${COMPOSE[@]}" logs --tail=40 >&2 || true
  fi
  if [ "${KEEP_UP:-0}" != "1" ]; then
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "== build and start =="
"${COMPOSE[@]}" up --build --detach --wait

headers() { curl -sS -D - -o /dev/null "$1" | tr -d '\r'; }
header_value() { # header_value <url> <name>
  headers "$1" | awk -v n="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]'):" 'tolower($1)==n {sub(/^[^:]*: */, ""); print; exit}'
}

echo "== gateway =="
check "gateway liveness /healthz" curl -fsS "${BASE}/healthz"
check "web page served through the gateway" bash -c "curl -fsS '${BASE}/' | grep -q 'Deal Pipeline Tracker'"
check "api health reachable at /api/health" bash -c "curl -fsS '${BASE}/api/health' | grep -q '\"status\":\"ok\"'"
check "unknown api route returns 404" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${BASE}/api/does-not-exist')\" = 404 ]"

echo "== headers =="
for url in "${BASE}/" "${BASE}/api/health"; do
  [ "$(header_value "$url" x-content-type-options)" = "nosniff" ] \
    && pass "nosniff on ${url}" || fail "nosniff on ${url}"
  [ -n "$(header_value "$url" referrer-policy)" ] \
    && pass "referrer-policy on ${url}" || fail "referrer-policy on ${url}"
  [ -n "$(header_value "$url" permissions-policy)" ] \
    && pass "permissions-policy on ${url}" || fail "permissions-policy on ${url}"
  [ -z "$(header_value "$url" server)" ] \
    && pass "no Server header on ${url}" || fail "Server header leaked on ${url}"
done
case "$(header_value "${BASE}/api/health" content-security-policy)" in
  *"default-src 'none'"*"frame-ancestors 'none'"*) pass "api CSP is locked down" ;;
  *) fail "api CSP is locked down" ;;
esac
[ "$(header_value "${BASE}/api/health" cache-control)" = "no-store" ] \
  && pass "api responses are no-store" || fail "api responses are no-store"

echo "== exposure =="
# Only the gateway may publish a host port.
published=$("${COMPOSE[@]}" config --format json | jq -r '
  .services | to_entries[] | select((.value.ports // []) | length > 0) | .key')
if [ "$published" = "gateway" ]; then
  pass "only the gateway publishes a host port"
else
  fail "only the gateway publishes a host port (published by: ${published:-none})"
fi
for svc in web api; do
  check "${svc} is not reachable on the host" bash -c "! curl -s --max-time 2 http://127.0.0.1:$([ $svc = web ] && echo 3000 || echo 3001)/ -o /dev/null"
done

echo
if [ "$failures" -ne 0 ]; then
  echo "${failures} check(s) failed" >&2
  exit 1
fi
echo "all smoke checks passed"
