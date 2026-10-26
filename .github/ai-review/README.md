# Advisory AI review

Posts one advisory comment on a pull request using Cloudflare Workers AI. Decision, limits and caveats: [ADR 0010](../../docs/decisions/0010-ai-assisted-pr-review.md).

| File | Role |
|---|---|
| `../workflows/ai-review.yml` | Trigger and permissions |
| `review.sh` | Builds the diff, calls the API, writes the comment body (never fails the build) |
| `post-comment.sh` | Creates or updates the single review comment |
| `system-prompt.md` | Project rules and review instructions given to the model |
| `test.sh` | Offline tests against a mock API (`make ai-review-test`) |

## One-time setup
Secrets are entered by you, never pasted into chat or committed.

```bash
gh secret set AI_REVIEW_CF_ACCOUNT_ID -R blaquetribe/deal-pipeline-tracker
```

```bash
gh secret set AI_REVIEW_CF_API_TOKEN -R blaquetribe/deal-pipeline-tracker
```

```bash
gh label create ai-review -R blaquetribe/deal-pipeline-tracker --description "Run the advisory AI review" --color 5319e7
```

Create the token in the Cloudflare dashboard from the **Workers AI** template (Read and Edit). Without the secrets the workflow runs, logs "skipped" and posts nothing.

## Using it
- Runs automatically when a PR is opened, reopened or marked ready for review.
- To run again after more commits, remove and re-add the `ai-review` label (the free allowance is 10,000 neurons a day, so it does not run on every push).
- `make ai-review-dry` shows what the current branch would send and roughly what it would cost, with no network call.

## Tuning
Environment variables read by `review.sh`: `AI_MODEL` (default `@cf/qwen/qwen2.5-coder-32b-instruct`), `MAX_DIFF_BYTES` (default 48000), `MAX_TOKENS` (default 1500).
