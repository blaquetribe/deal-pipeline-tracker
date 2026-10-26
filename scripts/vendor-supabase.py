#!/usr/bin/env python3
"""Vendor the parts of Supabase's official self-hosting files that we use (ADR 0013, 0014).

Usage: python3 -I scripts/vendor-supabase.py <path to supabase/supabase checkout>

Reads <checkout>/docker/volumes and writes:
  supabase/db/init/*.sql        verbatim copies of the init scripts we need
  supabase/gateway/*            Envoy config, trimmed to the services we run
  supabase/UPSTREAM.md          provenance (commit, licence, every edit)

Every edit is asserted: if upstream changes shape, this script fails loudly instead of
producing a subtly different gateway. Standard library only.
"""

import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO / "supabase"

KEEP_CLUSTERS = {"auth", "rest", "realtime"}
DROP_CLUSTERS = {"functions", "storage", "meta", "studio"}
DB_SCRIPTS = ["roles.sql", "jwt.sql", "realtime.sql"]
ROUTE_INDENT = " " * 22

ENTRYPOINT = '''#!/bin/sh
# Adapted from supabase/supabase docker/volumes/api/envoy/docker-entrypoint.sh (Apache-2.0),
# upstream commit {commit}. See supabase/UPSTREAM.md.
#
# Change: ANON_KEY and SERVICE_ROLE_KEY are DERIVED from JWT_SECRET with fixed claims instead
# of being supplied. Envoy compares the apikey header by exact string equality, so the keys
# must be deterministic; deriving them means no JWT is ever committed and a fresh clone needs
# no key generation. Clients (the API, tests) recompute the same strings:
#   header  = {{"alg":"HS256","typ":"JWT"}}
#   payload = {{"role":"<anon|service_role>","iss":"supabase","iat":1700000000,"exp":4102444800}}
#   token   = base64url(header).base64url(payload).base64url(HMAC-SHA256(JWT_SECRET, header.payload))
set -eu

: "${{JWT_SECRET:?JWT_SECRET is required}}"
: "${{DASHBOARD_USERNAME:?DASHBOARD_USERNAME is required}}"
: "${{DASHBOARD_PASSWORD:?DASHBOARD_PASSWORD is required}}"

b64url() {{ openssl base64 -A | tr '+/' '-_' | tr -d '='; }}

sign_key() {{
  header=$(printf '%s' '{{"alg":"HS256","typ":"JWT"}}' | b64url)
  payload=$(printf '{{"role":"%s","iss":"supabase","iat":1700000000,"exp":4102444800}}' "$1" | b64url)
  signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$signature"
}}

ANON_KEY=$(sign_key anon)
SERVICE_ROLE_KEY=$(sign_key service_role)
# Legacy-key mode only: the sb_ publishable/secret key translation and asymmetric keys are unused.
SUPABASE_PUBLISHABLE_KEY=""
SUPABASE_SECRET_KEY=""
ANON_KEY_ASYMMETRIC=""
SERVICE_ROLE_KEY_ASYMMETRIC=""
SUPABASE_PUBLIC_URL="${{SUPABASE_PUBLIC_URL:-http://localhost}}"

# Generate the SHA1 base64 hash for the (now unrouted) dashboard basic-auth user list.
PASSWORD_HASH=$(printf '%s' "${{DASHBOARD_PASSWORD}}" | openssl sha1 -binary | openssl base64)
DASHBOARD_BASIC_AUTH="${{DASHBOARD_USERNAME}}:{{SHA}}${{PASSWORD_HASH}}"

# lds.yaml is generated into a tmpfs so the container filesystem can stay read-only.
mkdir -p /tmp/envoy
echo "Generating Envoy configuration..."
sed -e "s|\\${{ANON_KEY}}|${{ANON_KEY}}|g" \\
    -e "s|\\${{ANON_KEY_ASYMMETRIC}}|${{ANON_KEY_ASYMMETRIC}}|g" \\
    -e "s|\\${{SERVICE_ROLE_KEY}}|${{SERVICE_ROLE_KEY}}|g" \\
    -e "s|\\${{SERVICE_ROLE_KEY_ASYMMETRIC}}|${{SERVICE_ROLE_KEY_ASYMMETRIC}}|g" \\
    -e "s|\\${{SUPABASE_PUBLISHABLE_KEY}}|${{SUPABASE_PUBLISHABLE_KEY}}|g" \\
    -e "s|\\${{SUPABASE_SECRET_KEY}}|${{SUPABASE_SECRET_KEY}}|g" \\
    -e "s|\\${{SUPABASE_PUBLIC_URL}}|${{SUPABASE_PUBLIC_URL}}|g" \\
    -e "s|\\${{DASHBOARD_BASIC_AUTH}}|${{DASHBOARD_BASIC_AUTH}}|g" \\
    /etc/envoy/lds.template.yaml > /tmp/envoy/lds.yaml

echo "Envoy configuration generated (legacy API key mode)"
echo "Starting Envoy..."
exec envoy -c /etc/envoy/envoy.yaml "$@"
'''

NOT_FOUND_ROUTE = """                      - name: not-found
                        match:
                          prefix: /
                        direct_response:
                          status: 404
                          body:
                            inline_string: "Not found"
                        typed_per_filter_config:
                          envoy.filters.http.basic_auth:
                            '@type': >-
                              type.googleapis.com/envoy.config.route.v3.FilterConfig
                            disabled: true
                          envoy.filters.http.rbac:
                            '@type': >-
                              type.googleapis.com/envoy.extensions.filters.http.rbac.v3.RBACPerRoute
                            rbac:
                              rules:
                                action: ALLOW
                                policies:
                                  allow_all:
                                    permissions:
                                      - any: true
                                    principals:
                                      - any: true

"""


def fail(message: str) -> None:
    sys.exit(f"vendor-supabase: {message}")


def trim_roles(text: str) -> str:
    """Drop the ALTER USER lines for roles we do not use.

    The image runs init scripts with ON_ERROR_STOP, so an ALTER USER for a role that does not
    exist (supabase_functions_admin comes from the omitted webhooks.sql) would silently abort the
    rest of database initialisation. The other unused roles simply keep no password.
    """
    unused = ["pgbouncer", "supabase_functions_admin", "supabase_storage_admin"]
    lines = text.split("\n")
    for role in unused:
        matches = [line for line in lines if line.startswith(f"ALTER USER {role} WITH PASSWORD")]
        if len(matches) != 1:
            fail(f"roles.sql: expected one ALTER USER line for {role}, found {len(matches)}")
        lines.remove(matches[0])
    for role in ["authenticator", "supabase_auth_admin"]:
        if not any(line.startswith(f"ALTER USER {role} WITH PASSWORD") for line in lines):
            fail(f"roles.sql: the ALTER USER line for {role} is missing")
    return "\n".join(lines)


def trim_cds(text: str) -> str:
    parts = re.split(r"(?m)^(?=  - '@type': type\.googleapis\.com/envoy\.config\.cluster\.v3\.Cluster)", text)
    header, clusters = parts[0], parts[1:]
    kept = []
    seen = set()
    for cluster in clusters:
        match = re.search(r"(?m)^    name: (\S+)$", cluster)
        if not match:
            fail("a cluster without a name in cds.yaml")
        name = match.group(1)
        seen.add(name)
        if name in KEEP_CLUSTERS:
            kept.append(cluster)
    if seen != KEEP_CLUSTERS | DROP_CLUSTERS:
        fail(f"cds.yaml clusters changed upstream: {sorted(seen)}")
    return header + "".join(kept)


def trim_lds(text: str) -> str:
    lines = text.split("\n")
    try:
        start = lines.index(" " * 20 + "routes:") + 1
        end = lines.index(" " * 14 + "http_filters:")
    except ValueError:
        fail("lds.template.yaml routes/http_filters markers not found")
    entries: list[list[str]] = []
    for line in lines[start:end]:
        if line.startswith(ROUTE_INDENT + "- "):
            entries.append([line])
        elif entries:
            entries[-1].append(line)
        else:
            fail("unexpected content before the first route")
    kept, dropped = [], []
    for entry in entries:
        block = "\n".join(entry)
        match = re.search(r"(?m)^\s+cluster: (\S+)$", block)
        if match and match.group(1) in DROP_CLUSTERS:
            dropped.append(match.group(1))
        else:
            kept.append(entry)
    expected = {"functions": 1, "storage": 1, "meta": 1, "studio": 3}
    counts = {name: dropped.count(name) for name in expected}
    if counts != expected:
        fail(f"dropped routes per cluster {counts}, expected {expected}: upstream changed")
    body = [line for entry in kept for line in entry]
    while body and body[-1].strip() == "":
        body.pop()
    new_lines = lines[:start] + body + [""] + NOT_FOUND_ROUTE.rstrip("\n").split("\n") + [""] + lines[end:]
    return "\n".join(new_lines)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: vendor-supabase.py <path to supabase/supabase checkout>")
    checkout = pathlib.Path(sys.argv[1]).expanduser().resolve()
    volumes = checkout / "docker" / "volumes"
    if not volumes.is_dir():
        fail(f"{volumes} not found")
    commit = subprocess.run(
        ["git", "-C", str(checkout), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()

    (OUT / "db" / "init").mkdir(parents=True, exist_ok=True)
    (OUT / "gateway").mkdir(parents=True, exist_ok=True)

    for name in DB_SCRIPTS:
        text = (volumes / "db" / name).read_text()
        if name == "roles.sql":
            text = trim_roles(text)
        (OUT / "db" / "init" / name).write_text(text)

    envoy = volumes / "api" / "envoy"
    envoy_yaml = (envoy / "envoy.yaml").read_text()
    if envoy_yaml.count("path: /etc/envoy/lds.yaml") != 1:
        fail("envoy.yaml lds path changed upstream")
    (OUT / "gateway" / "envoy.yaml").write_text(
        envoy_yaml.replace("path: /etc/envoy/lds.yaml", "path: /tmp/envoy/lds.yaml")
    )
    (OUT / "gateway" / "cds.yaml").write_text(trim_cds((envoy / "cds.yaml").read_text()))
    (OUT / "gateway" / "lds.template.yaml").write_text(trim_lds((envoy / "lds.template.yaml").read_text()))
    (OUT / "gateway" / "docker-entrypoint.sh").write_text(ENTRYPOINT.format(commit=commit))

    (OUT / "UPSTREAM.md").write_text(
        f"""# Vendored from Supabase (Apache-2.0)

Source: https://github.com/supabase/supabase, directory `docker/volumes`, commit `{commit}`.
Licence: Apache License 2.0 (the upstream `LICENSE`). Regenerate with
`python3 -I scripts/vendor-supabase.py <checkout>` (`make vendor-supabase UPSTREAM=<checkout>`);
the script asserts the shape of every edit and fails if upstream changed it.

| File | Upstream | Change |
|---|---|---|
| `db/init/jwt.sql`, `realtime.sql` | `volumes/db/*.sql` | verbatim |
| `db/init/roles.sql` | `volumes/db/roles.sql` | the `ALTER USER` lines for `pgbouncer`, `supabase_functions_admin` and `supabase_storage_admin` removed: the image runs init scripts with `ON_ERROR_STOP`, and `supabase_functions_admin` is created by an omitted script, so leaving the line in silently aborts the rest of database initialisation |
| (omitted scripts) | `volumes/db/*.sql` | Omitted: `webhooks.sql` (functions and pg_net), `_supabase.sql`, `logs.sql` (analytics), `pooler.sql` (Supavisor) |
| `gateway/envoy.yaml` | `volumes/api/envoy/envoy.yaml` | one line: the generated listener file is read from `/tmp/envoy/lds.yaml` so the container can have a read-only filesystem |
| `gateway/cds.yaml` | `volumes/api/envoy/cds.yaml` | clusters trimmed to `auth`, `rest`, `realtime` |
| `gateway/lds.template.yaml` | `volumes/api/envoy/lds.template.yaml` | routes to `functions`, `storage`, `meta` (`/pg/`) and `studio` (including `/mcp`) removed, and the Studio catch-all replaced by a 404 route. Everything else, including the API-key checks and the RBAC that denies Realtime tenant management and the REST root to the anon key, is untouched |
| `gateway/docker-entrypoint.sh` | `volumes/api/envoy/docker-entrypoint.sh` | rewritten: derives `ANON_KEY` and `SERVICE_ROLE_KEY` from `JWT_SECRET` with fixed claims (documented in the file), generates the listener config into `/tmp/envoy` |
| `gateway/healthcheck.sh` | (ours, not vendored) | readiness probe that exercises the real routes with the derived keys; not touched by this script |

Why trimmed and why the keys are derived: ADR 0013 and ADR 0014.
"""
    )
    print(f"vendored from {commit}")


main()
