#!/bin/bash
# Readiness probe for the internal Supabase gateway (ours, not vendored; see supabase/UPSTREAM.md).
# A TCP check only proves Envoy is listening. This proves the whole path works with the derived
# API keys: auth is healthy (200), REST answers the service role (200) and realtime is not
# reporting "no healthy upstream" (503) in Envoy's own view. The image has no curl or wget, so it
# speaks HTTP/1.1 over bash's /dev/tcp (Envoy answers 426 to HTTP/1.0).
set -eu

lds=/tmp/envoy/lds.yaml

key() { grep -o "local $1 = \"[^\"]*\"" "$lds" | head -1 | cut -d'"' -f2; }

status_of() { # status_of <path> <apikey>
  exec 3<>/dev/tcp/127.0.0.1/8000
  printf 'GET %s HTTP/1.1\r\nHost: probe\r\nConnection: close\r\napikey: %s\r\nAuthorization: Bearer %s\r\n\r\n' "$1" "$2" "$2" >&3
  read -r _ code _ <&3
  exec 3<&- 3>&-
  echo "$code"
}

[ "$(status_of /auth/v1/health "$(key ANON_KEY)")" = 200 ]
[ "$(status_of /rest/v1/ "$(key SERVICE_ROLE_KEY)")" = 200 ]
[ "$(status_of /realtime/v1/ "$(key ANON_KEY)")" != 503 ]
