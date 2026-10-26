# ADR 0010: AI-assisted pull request review at CI level

Status: proposed (research complete, nothing implemented). Needs the owner's pick of the phase 1 option.

## Question
Is there a **free** way to get AI help reviewing PRs in CI, and does GitHub provide something?

## What I found (web research; most pricing facts could not be confirmed on official pages, so each is marked)
| Option | Cost | Notes | Confidence |
|---|---|---|---|
| **GitHub Models + `actions/ai-inference`** (GitHub-native) | Free tier with rate limits; no extra account or API key (uses `GITHUB_TOKEN` with `permissions: models: read`) | Third-party sources report roughly 50 requests/day on high-tier models and tight input/output token limits; a GitHub community thread says free limits may be restricted after recent Copilot changes. GitHub itself lists PR triage and review bots as a fit. | Medium. Check the live rate-limit page before relying on numbers. |
| **GitHub Copilot code review** (GitHub-native) | Not clearly free. Copilot moved to usage-based billing on 2026-06-01 (AI credits); a source says reviews on private repos also consume Actions minutes. Whether the Free plan includes code review was **not confirmed**. | Best integrated UX (reviewer in the PR UI). | Low on the free question. |
| **Gemini Code Assist (GitHub app)** | A March 2025 article says free for public and private repos; **no official current terms found** | Installs a third-party app that reads private code; reviews automatically on PR open and on `/gemini` comments; skips `.github/workflows` files. | Low-medium. |
| **CodeRabbit** | Official docs say a free plan covers public and private repos, but line-by-line review on private repos may need the paid plan or a trial; sources conflict on limits | Third-party app reads private code. | Low-medium. |
| **PR-Agent** (open source, now community-owned) | Software is free to self-host; **you supply a model API key**, so not zero cost | Runs in your Actions. | Medium. |
| **`claude-code-action`** (Anthropic, official) | Works with an API key (paid) **or** a Pro/Max subscription OAuth token (`claude setup-token`), which uses subscription allowance | One secondary source says a February 2026 policy restricts subscription OAuth tokens to official tools and is unclear about CI; an open issue reports auth failures after a plan upgrade. **Check Anthropic's current terms before using a subscription token in CI.** | Low-medium. |
| **Local `/code-review` in Claude Code** | Already available in this setup; no CI cost | Run before pushing; not automatic. | High. |

Also free from GitHub and already in place: Dependabot (dependencies, actions, Docker). From general knowledge, not verified here: CodeQL and secret-scanning push protection are free on public repos but need a paid add-on on private ones.

## Recommendation
**Phase 1 (zero cost, zero sign-up): a non-blocking GitHub Models review comment.** An `actions/ai-inference` step on non-draft, same-repo PRs that sends a size-capped diff plus our standards and posts one advisory comment.
- Trigger `pull_request` (**never** `pull_request_target`); skip forks and drafts; `permissions: contents: read, pull-requests: write, models: read`; no other secrets.
- **Advisory only, never a required check**, and `continue-on-error` so a rate limit cannot fail CI.
- Cap the diff (token limits are tight); review only changed files; tell the model to ignore instructions found inside the diff.
- Prompt carries our non-negotiables (`AGENTS.md`, security checklist) so the review matches this project.

**Phase 2 (optional):** trial Gemini Code Assist or `claude-code-action` after confirming current free terms and ToS, and decide whether you are comfortable with another vendor reading the repo.

## Risks to state plainly
- **Prompt injection:** the reviewer reads untrusted PR content. Least privilege (comment-only token, no secrets) is the mitigation, and output is advisory.
- **Data sharing:** diffs go to a third-party model. GitHub Models is first-party; app-based options add another vendor. For this assessment, disclose AI-review use in the README's AI section.
- **Quality:** free-tier models and truncated diffs will miss things and produce noise; this complements, never replaces, human review and the deterministic gates (oxlint, tests, Trivy).
- **Reliability:** rate limits may change; design for graceful failure.

## Why not implemented yet
It cannot be verified without a live PR run and current rate limits, and the first CI run of the main workflow is still in flight. Implement after the owner picks the phase 1 option; verify on a throwaway PR.

## Sources
- https://github.blog/changelog/2026-06-02-github-copilot-code-review-for-azure-repos-is-now-in-technical-preview/
- https://docs.github.com/fr/copilot/get-started/plans
- https://agentpatterns.ai/tools/copilot/github-models-in-actions/
- https://github.com/orgs/community/discussions/137298
- https://developers.google.com/gemini-code-assist/docs/set-up-code-assist-github
- https://docs.coderabbit.ai/about/pricing
- https://github.com/The-PR-Agent/pr-agent
- https://code.claude.com/docs/en/github-actions
