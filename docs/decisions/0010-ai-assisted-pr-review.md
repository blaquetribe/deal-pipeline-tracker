# ADR 0010: AI-assisted pull request review at CI level

Status: accepted and implemented; **awaiting its first live run**, which needs two secrets that only the owner can create.
This replaces the earlier "proposed" version of this ADR.

## Correction (read this first)
The first version of this ADR recommended **GitHub Models via `actions/ai-inference`** using the workflow's own `GITHUB_TOKEN` (`models: read`). That recommendation came from web-search summaries of how the service *used* to work, and it was wrong. Checking before building showed:

- GitHub's own docs say **GitHub Models was fully retired on 2026-07-30** (playground, model catalog, inference API and bring-your-own-key). `https://models.github.ai/inference` now answers a bare `OK`.
- **`actions/ai-inference` v3 (released 2026-07-29) is Copilot-only**: it needs the Copilot CLI installed and a `COPILOT_GITHUB_TOKEN` personal access token from an account with Copilot. It is not free with just the workflow token.

Lesson recorded for the team: verify availability and pricing against the vendor's primary pages **at decision time**; search summaries go stale quickly.

## Decision
Build the advisory review on **Cloudflare Workers AI** (the owner already has a Cloudflare account for R2), called with plain `curl` from a workflow that uses only first-party GitHub actions.

| Fact | Source |
|---|---|
| Free allowance **10,000 Neurons/day** on the Workers Free plan, resets 00:00 UTC; beyond it requests **fail** (hard cap) | Cloudflare Workers AI pricing page (last updated 2026-10-20) |
| `@cf/qwen/qwen2.5-coder-32b-instruct` (code-specialised) is not marked paid-only: 60,000 Neurons per 1M input tokens, 90,909 per 1M output tokens | same page |
| "Cloudflare does not use Customer Content processed by Workers AI to train AI models"; standard inference inputs and outputs are not retained after the response | Cloudflare Workers AI data-usage page |
| REST: `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}`, `Authorization: Bearer`, token needs Workers AI Read and Edit, answer in `result.response` | Cloudflare REST API page |

**Budget:** at the default 48,000-byte diff cap a review is about 1,000 Neurons (measured by `make ai-review-dry` on this repo's large PR: about 1,024). That is roughly nine reviews a day, so the workflow runs on **PR opened, reopened or ready for review, and when the `ai-review` label is applied**, not on every push.

## How it works
1. `.github/workflows/ai-review.yml` (trigger `pull_request`, same-repo, non-draft, non-Dependabot PRs; `continue-on-error`; permissions `contents: read`, `pull-requests: write`).
2. `.github/ai-review/review.sh` builds the diff (excluding `docs/`, markdown, lockfile and snapshots), truncates to the cap, wraps it in **random per-run delimiters**, prepends `system-prompt.md` (our non-negotiables and review rules), calls the API and writes one comment body. Every failure path logs and exits 0.
3. `.github/ai-review/post-comment.sh` creates or updates **one** comment, matching only comments written by `github-actions[bot]` that carry a hidden marker.

## Safeguards
- **Advisory only:** never a required check; `continue-on-error`; a rate limit or outage cannot fail CI.
- **Prompt injection:** the diff is delimited and declared untrusted data; the system prompt says to ignore instructions inside it. The token has comment-only permission and the job has no other secrets, so a successful injection can at worst produce a misleading comment.
- **Output is untrusted too:** capped at 8,000 bytes, HTML comments stripped (so the model cannot forge our marker) and `@mentions` defused (so it cannot ping people).
- **`pull_request`, never `pull_request_target`**; fork PRs and Dependabot are skipped (they get no secrets).
- **No secrets are logged;** the token is only sent as a bearer header.
- **Data sharing:** diffs go to Cloudflare (a processor the owner already uses). Disclose AI-review use in the README's AI section.

## What was verified and what was not
**Verified locally:** 30 offline tests (`make ai-review-test`, also run in CI) against a mock of the API and a stub `gh`: no-secrets skip, success, exact endpoint and bearer header, exclusions, delimiters and injection placement, mention defusing, marker forgery, truncation and bounded prompt, HTTP 500, unreachable API, empty response, empty diff, dry run, create-versus-update comment logic. The suite was **mutation-tested** (removing the defusing and the truncation made the matching tests fail). shellcheck and actionlint are clean.

**Not verified (needs a live run with your secrets):**
- That this model accepts `prompt` and `max_tokens` and returns `result.response` (the docs page shows `prompt`; it does not document a chat `messages` shape).
- The model's context window (assumed 32k tokens; the 48 KB cap leaves headroom) and that it stays free-eligible. Cloudflare retires models (a source reports Llama 3.1 8B was retired in May 2026), so the model is configurable via `AI_MODEL`.
- Review quality, which is the real question: expect noise from a free 32B model.
- GitHub-side behaviour: the `labeled` trigger, the `hashFiles` condition and creating or updating the comment with `GITHUB_TOKEN`.

## Setup (owner only; secrets are never typed into chat)
1. Cloudflare dashboard: create an API token from the **Workers AI** template (Read and Edit) and note your **Account ID**.
2. Add two repository secrets: `AI_REVIEW_CF_ACCOUNT_ID` and `AI_REVIEW_CF_API_TOKEN`.
3. Create the label `ai-review`. Applying it (re)runs the review on a PR.

## Alternatives still open
Copilot-based review (`actions/ai-inference` v3 plus a Copilot PAT; entitlement and cost unconfirmed), Gemini Code Assist GitHub app (free terms unconfirmed), CodeRabbit (private-repo free tier unclear), `claude-code-action` (subscription token terms unclear for CI), and the local `/code-review` skill, which already works for free before pushing.

## Revisit when
Cloudflare changes the free allowance or retires the model; review quality is poor (try `@cf/openai/gpt-oss-120b`, whose request shape must be verified first); the team outgrows about nine reviews a day.

## Sources
- https://docs.github.com/en/github-models (retirement notice)
- https://github.com/actions/ai-inference (v3 README: Copilot-only)
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/platform/data-usage/
- https://developers.cloudflare.com/workers-ai/get-started/rest-api/
