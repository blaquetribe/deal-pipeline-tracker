# ADR 0017: patched Caddy gateway build

Status: accepted
Date: 2026-10-28

## Context

The gateway's pinned official Caddy image contains `github.com/go-jose/go-jose/v4` v4.1.5 and `golang.org/x/net` v0.59.0. go-jose v4.1.6 fixes GHSA-mgcc-cww5-fp2q, a high-severity CPU denial of service while parsing attacker-controlled RSA JWKs. x/net v0.60.0 fixes CVE-2026-78669, a high-severity HTTP/2 SETTINGS denial of service. The current official Caddy release is v2.11.7 and its published image has not incorporated these dependency updates. Trivy fails CI on the fixed findings, and the repository does not permit unexplained or indefinite ignores.

## Decision

- Keep Caddy v2.11.7 and the pinned official Alpine runtime image.
- Build the Caddy binary from the official, digest-pinned `2.11.7-builder-alpine` image and replace only go-jose v4 with v4.1.6 and x/net with v0.60.0 through `xcaddy --replace`.
- Continue copying the binary without file capabilities. Keep `admin off` and `auto_https off`; TLS terminates upstream in production.
- Do not add Trivy exceptions for CVE-2026-116587 or CVE-2026-78669. Retire this custom build when a pinned official Caddy image includes both fixes and the replacement image passes the same scan.

The upstream dependency graph also includes go-jose v3.0.5, for which the advisory currently lists no patched release. The production Caddy configuration exposes only reverse proxy routes, disables its admin API and automatic TLS, and does not configure a JWK parsing endpoint. This is a reachability assessment from the committed configuration, not a claim that the v3 dependency is fixed. Reassess when upstream publishes a v3 fix or removes that dependency.

## Alternatives considered

- Wait for a new upstream Caddy image: leaves the only open PR failing a fixed high-severity scanner finding with no known release date.
- Add a Trivy ignore: suppresses a fixed vulnerability and is rejected.
- Replace Caddy: broadens the change and requires revalidating gateway behavior without a need to change the proxy architecture.

## Verification

The pinned builder rebuilt Caddy v2.11.7; final binary metadata reports go-jose v4.1.6 and x/net v0.60.0 as replacements. The pinned Trivy image reports zero HIGH/CRITICAL findings and no suppressions. Pinned hadolint passes, the production Caddyfile validates, and the isolated full compose smoke test passes. GitHub CI must still pass its amd64 build and the full PR workflow before merge.
