#!/usr/bin/env bash
# Clean-clone proof: build and start the whole stack, then test it.
# Usage: scripts/compose-smoke.sh            (builds, tests, tears down)
#        KEEP_UP=1 scripts/compose-smoke.sh  (leave the stack running afterwards)
# Needs: docker (or podman) with compose, curl, jq, openssl.
# Works with bash 3.2 (the macOS default).
set -euo pipefail

cd "$(dirname "$0")/.."

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
  CONTAINER_ENGINE=docker
elif podman compose version >/dev/null 2>&1; then
  COMPOSE=(podman compose)
  CONTAINER_ENGINE=podman
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
  CONTAINER_ENGINE=docker
else
  echo "FAIL: no supported Docker or Podman Compose command is available" >&2
  exit 1
fi

PORT="${GATEWAY_PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"
APP_BASE="${PUBLIC_BASE_URL:-http://localhost:${PORT}}"
GW=http://supabase-gateway:8000 # the internal Supabase gateway, reachable only on the internal network
failures=0
tmp_dirs=()

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; failures=$((failures + 1)); }

check() { # check "<description>" <command...>
  local description=$1
  shift
  if "$@" >/dev/null 2>&1; then pass "$description"; else fail "$description"; fi
}

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; } # a TCP connect: true if anything listens
reaches() { # reaches <exec args...>: true if the command gets ANY HTTP response (a 4xx still counts as reached)
  local out
  out=$(dc_exec "$@" 2>&1 || true)
  case "$out" in *HTTP/*) return 0 ;; *) return 1 ;; esac
}

expect_failure() { # expect_failure "<description>" <command...>: passes only if the command FAILS
  local description=$1
  shift
  if "$@" </dev/null >/dev/null 2>&1; then fail "$description"; else pass "$description"; fi
}

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ] || [ "$failures" -ne 0 ]; then
    echo "--- service logs (tail) ---" >&2
    "${COMPOSE[@]}" logs --tail=25 >&2 || true
  fi
  if [ "${KEEP_UP:-0}" != "1" ]; then
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  fi
  for dir in ${tmp_dirs[@]+"${tmp_dirs[@]}"}; do rm -rf "$dir"; done
}
trap cleanup EXIT

# ---- secrets: resolve exactly as compose does (environment, then .env, then the dev default) ----
DEFAULT_JWT_SECRET='dev-only-jwt-secret-change-me-minimum-32-characters'
JWT_SECRET="${JWT_SECRET:-}"
if [ -z "$JWT_SECRET" ] && [ -f .env ]; then
  JWT_SECRET=$(sed -n 's/^JWT_SECRET=//p' .env | head -n 1)
fi
JWT_SECRET="${JWT_SECRET:-$DEFAULT_JWT_SECRET}"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
sign_key() { # sign_key <role>: the same fixed-claims algorithm as supabase/gateway/docker-entrypoint.sh
  local header payload signature
  header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":1700000000,"exp":4102444800}' "$1" | b64url)
  signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$signature"
}
ANON=$(sign_key anon)
SERVICE=$(sign_key service_role)

# `exec` must never read this script's stdin, or it swallows the rest of the file.
dc_exec() { "${COMPOSE[@]}" exec -T "$@" </dev/null; }
strip_ansi() { perl -pe 's/\e\[[0-9;]*[[:alpha:]]//g'; }
internal_curl() { dc_exec realtime curl -s -m 10 "$@"; } # a client that lives on the internal network
http_code() { internal_curl -o /dev/null -w '%{http_code}' "$@"; }

echo "== build and start =="
"${COMPOSE[@]}" up --build --detach --wait

headers() { curl -sS -D - -o /dev/null "$1" | tr -d '\r'; }
header_value() { # header_value <url> <name>
  headers "$1" | awk -v n="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]'):" 'tolower($1)==n {sub(/^[^:]*: */, ""); print; exit}'
}
container_of() { "${COMPOSE[@]}" ps -a -q "$1" | head -n 1; }

echo "== services =="
for svc in db auth rest realtime supabase-gateway mailpit api web gateway; do
  state=$($CONTAINER_ENGINE inspect --format '{{.State.Health.Status}}' "$(container_of "$svc")" 2>/dev/null || echo missing)
  [ "$state" = healthy ] && pass "${svc} is healthy" || fail "${svc} is healthy (state: ${state})"
done
migrate_id=$(container_of migrate)
[ "$($CONTAINER_ENGINE inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$migrate_id" 2>/dev/null)" = "exited 0" ] \
  && pass "migrate ran to completion (exit 0)" || fail "migrate ran to completion (exit 0)"
seed_id=$(container_of demo-seed)
[ "$($CONTAINER_ENGINE inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$seed_id" 2>/dev/null)" = "exited 0" ] \
  && pass "development seed ran to completion (exit 0)" || fail "development seed ran to completion (exit 0)"
grep -q -F "$DEFAULT_JWT_SECRET" docker-compose.yml \
  && pass "this script's dev JWT default matches docker-compose.yml" \
  || fail "this script's dev JWT default matches docker-compose.yml"

echo "== gateway =="
check "gateway liveness /healthz" curl -fsS "${BASE}/healthz"
check "web page served through the gateway" bash -c "curl -fsSL '${BASE}/' | grep -q 'Deal Pipeline Tracker'"
check "api health reachable at /api/health" bash -c "curl -fsS '${BASE}/api/health' | grep -q '\"status\":\"ok\"'"
check "unknown api route returns 404" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${BASE}/api/does-not-exist')\" = 404 ]"
check "Mailpit inbox is served at /mail/ (development gateway)" bash -c "curl -fsS '${BASE}/mail/' | grep -qi mailpit"

echo "== seeded reviewer path =="
DEMO_PASSWORD="${SEED_DEMO_PASSWORD:-}"
if [ -z "$DEMO_PASSWORD" ] && [ -f .env ]; then
  DEMO_PASSWORD=$(sed -n 's/^SEED_DEMO_PASSWORD=//p' .env | head -n 1)
fi
DEMO_PASSWORD="${DEMO_PASSWORD:-Dev-only-demo-password-change-me}"
review_dir=$(mktemp -d "${TMPDIR:-/tmp}/smoke-reviewer.XXXXXX")
tmp_dirs+=("$review_dir")
login_code=$(curl -sS -o "$review_dir/login.json" -w '%{http_code}' -c "$review_dir/cookies" \
  -H "Origin: ${APP_BASE}" -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg email 'owner@asteron.example.test' --arg password "$DEMO_PASSWORD" '{email:$email,password:$password}')" \
  "${BASE}/api/auth/login")
if [ "$login_code" = 200 ]; then
  pass "seeded reviewer can sign in through the gateway"
  csrf=$(jq -r '.csrfToken // empty' "$review_dir/login.json")
  tenant_json=$(curl -sS -b "$review_dir/cookies" "${BASE}/api/auth/tenants")
  tenant_id=$(printf '%s' "$tenant_json" | jq -r '.tenants[]? | select(.tenantName == "Asteron Capital") | .tenantId' | head -n 1)
  if [ -n "$tenant_id" ]; then
    pass "seeded reviewer can see the Asteron tenant"
    tenant_code=$(curl -sS -o "$review_dir/tenant.json" -w '%{http_code}' -b "$review_dir/cookies" -c "$review_dir/cookies" \
      -H 'Content-Type: application/json' -H "X-CSRF-Token: ${csrf}" \
      -H "Origin: ${APP_BASE}" \
      -d "{\"tenantId\":\"${tenant_id}\"}" "${BASE}/api/auth/tenant")
    [ "$tenant_code" = 200 ] && pass "seeded reviewer can select the tenant" || fail "seeded reviewer can select the tenant"
    dashboard=$(curl -sS -b "$review_dir/cookies" "${BASE}/api/deals/dashboard-summary")
    printf '%s' "$dashboard" | jq -e '.. | objects | select(.name? == "Asterion Renewable Storage")' >/dev/null 2>&1 \
      && pass "seeded deal is visible through the authenticated dashboard" \
      || fail "seeded deal is visible through the authenticated dashboard"
    "${COMPOSE[@]}" run --rm -T demo-seed >/dev/null \
      && pass "re-running the seed job succeeds" || fail "re-running the seed job succeeds"
    dashboard_again=$(curl -sS -b "$review_dir/cookies" "${BASE}/api/deals/dashboard-summary")
    [ "$(printf '%s' "$dashboard_again" | jq -r '[.. | objects | select(.name? == "Asterion Renewable Storage")] | length')" = 1 ] \
      && pass "re-running the seed preserves one copy of each sample deal" \
      || fail "re-running the seed preserves one copy of each sample deal"
  else
    fail "seeded reviewer can see the Asteron tenant"
  fi
else
  fail "seeded reviewer can sign in through the gateway (HTTP ${login_code})"
fi

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
# Nothing else answers on the host, whatever compose says.
for p in 3000 3001 4000 5432 8000 8025 9999; do
  expect_failure "nothing listens on host port ${p}" port_open "$p"
done
auth_probe=$(curl -s --max-time 5 "${BASE}/auth/v1/health" || true)
case "$auth_probe" in
  *GoTrue*) fail "Supabase auth is not reachable through the public gateway" ;;
  *) pass "Supabase auth is not reachable through the public gateway" ;;
esac
rest_probe=$(curl -s --max-time 5 -H "apikey: ${ANON}" "${BASE}/rest/v1/" || true)
case "$rest_probe" in
  *swagger* | *openapi* | *PostgREST*) fail "Supabase REST is not reachable through the public gateway" ;;
  *) pass "Supabase REST is not reachable through the public gateway" ;;
esac
for svc in web gateway; do
  expect_failure "${svc} cannot reach the Supabase gateway (different network)" \
    reaches "$svc" wget -S -q -T 3 -O /dev/null "${GW}/"
done
# Plain HTTP on purpose: this image's curl cannot do HTTPS even when egress works, which would make
# an https probe fail for the wrong reason and the check pass falsely.
expect_failure "the internal network has no internet egress" \
  "${COMPOSE[@]}" exec -T realtime curl -s -m 5 -o /dev/null http://example.com

echo "== supabase (from the BFF's network position) =="
gateway_key=$(dc_exec supabase-gateway sh -c "grep -o 'local ANON_KEY = \"[^\"]*\"' /tmp/envoy/lds.yaml | head -1 | cut -d'\"' -f2")
[ "$gateway_key" = "$ANON" ] \
  && pass "derived anon key equals the key inside the running gateway" \
  || fail "derived anon key equals the key inside the running gateway"
api_with_key=$(dc_exec api wget -q -O- --header "apikey: ${ANON}" "${GW}/auth/v1/health" 2>/dev/null || true)
case "$api_with_key" in
  *GoTrue*) pass "api reaches Supabase auth through the internal gateway" ;;
  *) fail "api reaches Supabase auth through the internal gateway" ;;
esac
api_without_key=$(dc_exec api wget -S -q -O /dev/null "${GW}/auth/v1/health" 2>&1 || true)
case "$api_without_key" in
  *401*) pass "api is refused without an API key (401)" ;;
  *) fail "api is refused without an API key (401)" ;;
esac
[ "$(http_code -H "apikey: ${ANON}" "${GW}/rest/v1/")" = 403 ] \
  && pass "REST root is denied to the anon key (403)" || fail "REST root is denied to the anon key (403)"
[ "$(http_code -H "apikey: ${SERVICE}" -H "Authorization: Bearer ${SERVICE}" "${GW}/rest/v1/")" = 200 ] \
  && pass "REST root is open to the service role (200)" || fail "REST root is open to the service role (200)"
[ "$(http_code -H "apikey: ${SERVICE}" -H "Authorization: Bearer ${SERVICE}" "${GW}/realtime/v1/api/tenants")" = 403 ] \
  && pass "realtime tenant management is blocked even for the service role" \
  || fail "realtime tenant management is blocked even for the service role"
signup=$(internal_curl -X POST "${GW}/auth/v1/signup" -H "apikey: ${ANON}" -H 'Content-Type: application/json' \
  -d '{"email":"smoke-signup@example.test","password":"Smoke-Pass-123456"}')
case "$signup" in
  *signup_disabled*) pass "public sign-up is disabled" ;;
  *) fail "public sign-up is disabled" ;;
esac

email="smoke-$$@example.test"
password="Smoke-Pass-123456"
user_json=$(internal_curl -X POST "${GW}/auth/v1/admin/users" -H "apikey: ${SERVICE}" -H "Authorization: Bearer ${SERVICE}" \
  -H 'Content-Type: application/json' -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"email_confirm\":false}")
user_id=$(printf '%s' "$user_json" | jq -r '.id // empty')
[ -n "$user_id" ] && pass "admin API creates an unconfirmed user" || fail "admin API creates an unconfirmed user"
login() { internal_curl -X POST "${GW}/auth/v1/token?grant_type=password" -H "apikey: ${ANON}" \
  -H 'Content-Type: application/json' -d "{\"email\":\"${email}\",\"password\":\"${password}\"}"; }
[ "$(login | jq -r '.error_code // empty')" = email_not_confirmed ] \
  && pass "an unconfirmed user cannot log in (email_not_confirmed)" || fail "an unconfirmed user cannot log in"
internal_curl -o /dev/null -X PUT "${GW}/auth/v1/admin/users/${user_id}" -H "apikey: ${SERVICE}" \
  -H "Authorization: Bearer ${SERVICE}" -H 'Content-Type: application/json' -d '{"email_confirm":true}'
[ -n "$(login | jq -r '.access_token // empty')" ] \
  && pass "after confirmation the user can log in and receives a token" || fail "after confirmation the user can log in"

internal_curl -o /dev/null -X POST "${GW}/auth/v1/recover" -H "apikey: ${ANON}" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${email}\"}"
mail_ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s "${BASE}/mail/api/v1/messages" | jq -e '.messages[]? | select(.Subject | test("password"; "i"))' >/dev/null 2>&1; then
    mail_ok=1
    break
  fi
  sleep 1.5
done
[ "$mail_ok" = 1 ] && pass "auth email reaches Mailpit (GoTrue to SMTP to inbox)" || fail "auth email reaches Mailpit"
internal_curl -o /dev/null -X DELETE "${GW}/auth/v1/admin/users/${user_id}" -H "apikey: ${SERVICE}" -H "Authorization: Bearer ${SERVICE}"

ws_js='
const ws = new WebSocket(`ws://supabase-gateway:8000/realtime/v1/websocket?apikey=${process.env.ANON}&vsn=1.0.0`);
setTimeout(() => { console.log("timeout"); process.exit(1); }, 10000);
ws.onerror = () => { console.log("socket error"); process.exit(1); };
ws.onopen = () => ws.send(JSON.stringify({ topic: "realtime:smoke", event: "phx_join", ref: "1", join_ref: "1",
  payload: { config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [] }, access_token: process.env.ANON } }));
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.event === "phx_reply" && m.ref === "1") { console.log(m.payload.status); process.exit(m.payload.status === "ok" ? 0 : 1); } };
'
ws_out=$(dc_exec -e ANON="$ANON" api node -e "$ws_js" 2>&1 | strip_ansi | tail -n 1)
[ "$ws_out" = ok ] \
  && pass "api opens a realtime WebSocket through the internal gateway" \
  || fail "api opens a realtime WebSocket through the internal gateway (${ws_out:-no response})"

# PostgREST must switch to the roles named in a JWT (ADR 0015): api_service reaches only the session
# functions, a signed-in user reaches their own data through app.uid(), and neither can do the other's job.
dc_exec db psql -U supabase_admin -tA -c "insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values ('aaaaaaaa-1111-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'roles-smoke@example.test', now())" >/dev/null
roles_js='
const { createHmac } = require("node:crypto");
const b64 = (t) => Buffer.from(t).toString("base64url");
const sign = (claims) => { const h = b64("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"), p = b64(JSON.stringify(claims));
  return `${h}.${p}.${createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const now = Math.floor(Date.now() / 1000), uid = "aaaaaaaa-1111-4000-8000-000000000001";
const anon = sign({ role: "anon", iss: "supabase", iat: 1700000000, exp: 4102444800 });
const svc = sign({ role: "api_service", iat: now, exp: now + 60 });
const usr = sign({ role: "authenticated", sub: uid, iat: now, exp: now + 60 });
const call = async (method, path, token, body) => {
  const r = await fetch(`http://supabase-gateway:8000/rest/v1${path}`, { method, body: body && JSON.stringify(body),
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  return { status: r.status, text: await r.text() }; };
(async () => {
  const hash = "a".repeat(64);
  const results = [
    [(await call("POST", "/rpc/session_create", svc, { p_session_hash: hash, p_user: uid, p_tokens_enc: "\\x0102" })).status, 200],
    [(await call("POST", "/rpc/session_lookup", svc, { p_session_hash: hash })).text.includes(uid), true],
    [(await call("GET", "/profiles", svc)).status, 403],
    [(await call("POST", "/rpc/session_lookup", usr, { p_session_hash: hash })).status, 403],
    [(await call("POST", "/rpc/profile_upsert", usr, { p_display_name: "Smoke User" })).status, 204],
    [(await call("GET", "/profiles?select=display_name", usr)).text.includes("Smoke User"), true],
    [(await call("GET", "/profiles?select=display_name", anon)).status, 401],
  ];
  const bad = results.map(([got, want], i) => (got === want ? null : `#${i + 1} got ${got} want ${want}`)).filter(Boolean);
  console.log(bad.length === 0 ? "ok" : bad.join("; "));
  process.exit(bad.length === 0 ? 0 : 1);
})();
'
roles_out=$(JWT_SECRET="$JWT_SECRET" dc_exec -e JWT_SECRET api node -e "$roles_js" 2>&1 | strip_ansi | tail -n 1)
[ "$roles_out" = ok ] \
  && pass "PostgREST switches to api_service and to the signed-in user from the JWT role (app.uid works)" \
  || fail "PostgREST role switching: ${roles_out}"
dc_exec db psql -U supabase_admin -tA -c "delete from public.api_sessions; delete from public.profiles; delete from auth.users where id = 'aaaaaaaa-1111-4000-8000-000000000001'" >/dev/null

echo "== database =="
recorded=$(dc_exec db psql -U postgres -tA -c "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null | tr -d '[:space:]')
[ "${recorded:-0}" -ge 1 ] && pass "migrations are recorded (${recorded})" || fail "migrations are recorded"
check "pgTAP suite passes" dc_exec db sh /tests/run.sh
# The same checks must be able to FAIL: a deliberately failing test and a tampered migration.
failing_sql=$'begin;\nselect plan(1);\nselect ok(false, \'deliberate failure\');\nselect * from finish();\nrollback;\n'
expect_failure "pgTAP detects a failing assertion (negative test)" \
  "${COMPOSE[@]}" exec -T -e TESTS_DIR=/tmp/failing -e FAILING_SQL="$failing_sql" db \
  sh -c 'mkdir -p /tmp/failing && printf "%s" "$FAILING_SQL" > /tmp/failing/x.test.sql && sh /tests/run.sh'
tamper_dir=$(mktemp -d "${TMPDIR:-/tmp}/smoke-migrations.XXXXXX")
tmp_dirs+=("$tamper_dir")
cp supabase/migrations/*.sql "$tamper_dir/"
printf '\n-- edited after it was applied\n' >> "$tamper_dir"/20261026000000_baseline_extensions.sql
expect_failure "migrate refuses an edited, already-applied migration (negative test)" \
  "${COMPOSE[@]}" run --rm -T -v "${tamper_dir}:/migrations:ro" migrate

echo
if [ "$failures" -ne 0 ]; then
  echo "${failures} check(s) failed" >&2
  exit 1
fi
echo "all smoke checks passed"
