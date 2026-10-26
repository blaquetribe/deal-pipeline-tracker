#!/bin/sh
# Adapted from supabase/supabase docker/volumes/api/envoy/docker-entrypoint.sh (Apache-2.0),
# upstream commit f4d6d9052788b70c7c712e552fe98b1af8649a73. See supabase/UPSTREAM.md.
#
# Change: ANON_KEY and SERVICE_ROLE_KEY are DERIVED from JWT_SECRET with fixed claims instead
# of being supplied. Envoy compares the apikey header by exact string equality, so the keys
# must be deterministic; deriving them means no JWT is ever committed and a fresh clone needs
# no key generation. Clients (the API, tests) recompute the same strings:
#   header  = {"alg":"HS256","typ":"JWT"}
#   payload = {"role":"<anon|service_role>","iss":"supabase","iat":1700000000,"exp":4102444800}
#   token   = base64url(header).base64url(payload).base64url(HMAC-SHA256(JWT_SECRET, header.payload))
set -eu

: "${JWT_SECRET:?JWT_SECRET is required}"
: "${DASHBOARD_USERNAME:?DASHBOARD_USERNAME is required}"
: "${DASHBOARD_PASSWORD:?DASHBOARD_PASSWORD is required}"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

sign_key() {
  header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":1700000000,"exp":4102444800}' "$1" | b64url)
  signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$signature"
}

ANON_KEY=$(sign_key anon)
SERVICE_ROLE_KEY=$(sign_key service_role)
# Legacy-key mode only: the sb_ publishable/secret key translation and asymmetric keys are unused.
SUPABASE_PUBLISHABLE_KEY=""
SUPABASE_SECRET_KEY=""
ANON_KEY_ASYMMETRIC=""
SERVICE_ROLE_KEY_ASYMMETRIC=""
SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-http://localhost}"

# Generate the SHA1 base64 hash for the (now unrouted) dashboard basic-auth user list.
PASSWORD_HASH=$(printf '%s' "${DASHBOARD_PASSWORD}" | openssl sha1 -binary | openssl base64)
DASHBOARD_BASIC_AUTH="${DASHBOARD_USERNAME}:{SHA}${PASSWORD_HASH}"

# lds.yaml is generated into a tmpfs so the container filesystem can stay read-only.
mkdir -p /tmp/envoy
echo "Generating Envoy configuration..."
sed -e "s|\${ANON_KEY}|${ANON_KEY}|g" \
    -e "s|\${ANON_KEY_ASYMMETRIC}|${ANON_KEY_ASYMMETRIC}|g" \
    -e "s|\${SERVICE_ROLE_KEY}|${SERVICE_ROLE_KEY}|g" \
    -e "s|\${SERVICE_ROLE_KEY_ASYMMETRIC}|${SERVICE_ROLE_KEY_ASYMMETRIC}|g" \
    -e "s|\${SUPABASE_PUBLISHABLE_KEY}|${SUPABASE_PUBLISHABLE_KEY}|g" \
    -e "s|\${SUPABASE_SECRET_KEY}|${SUPABASE_SECRET_KEY}|g" \
    -e "s|\${SUPABASE_PUBLIC_URL}|${SUPABASE_PUBLIC_URL}|g" \
    -e "s|\${DASHBOARD_BASIC_AUTH}|${DASHBOARD_BASIC_AUTH}|g" \
    /etc/envoy/lds.template.yaml > /tmp/envoy/lds.yaml

echo "Envoy configuration generated (legacy API key mode)"
echo "Starting Envoy..."
exec envoy -c /etc/envoy/envoy.yaml "$@"
