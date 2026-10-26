# Take-Home Brief (verbatim summary)

CVC Capital Partners, Engineering South Africa. Senior Software Engineer: Supabase, TypeScript, GitHub Actions, Claude Code.
Time: one week from receipt; expected effort 6-10 hours. Anything not completed must be noted in the README.

## Product
**Deal Pipeline Tracker**: deal teams log investment opportunities and move them through
Sourcing -> Screening -> Due Diligence -> IC Review -> Signed -> Closed, with a "Passed" outcome for deals that do not proceed.

- Deal fields are deliberately unspecified; the modelling is evaluated.
- Auditable trail per deal: notes/decisions, attributed to the recorder, **cannot be edited or deleted once posted** (hard requirement, mechanism free).
- At-a-glance pipeline view, including what is **coming up for closing soon**.
- Small team with different roles (junior -> senior decision-makers); access model is ours; be ready to explain.
- Whole app authentication-gated.
- Enough realistic sample data that a reviewer sees it working without a live walkthrough.

## Technical
- Supabase, default Postgres. Schema changes captured in the repo, **not applied by hand against the live database**.
- Security is not an afterthought: access genuinely controlled by who is signed in, **not just hiding buttons in the UI**.
- TypeScript throughout.
- Supabase Auth (email/password or magic link). **No page or API route reachable while signed out.** Auth code behind one clean boundary (single module/hook).
- GitHub + GitHub Actions CI/CD.
- `docker-compose.yml` brings up the entire stack with one command. Reviewer: `docker compose up`, open browser, sign in, see seeded data.
- README on how Claude Code / AI was used.

## Stretch (optional)
Document extraction: upload pdf/word/image at a pipeline step and auto-populate required fields.

## Submit
Private GitHub repo shared with handles supplied separately. README covering: setup/run, architecture decisions and trade-offs, what we would do next, Claude Code reflection.
