# CLAUDE.md

@AGENTS.md

## Claude Code specifics
- Standards are imported here so they are loaded before coding starts:
  @docs/standards/SECURITY_STANDARDS.md
  @docs/standards/CODING_STANDARDS.md
  @docs/standards/ENGINEERING_STANDARDS.md
- Not imported, to save context; read them before touching that area: `docs/standards/MARKUP_STANDARDS.md` (any JSX or email template), `TESTING_STANDARDS.md` (any test), `CONTAINER_STANDARDS.md` (Dockerfile, compose, CI image build).
- At the start of a session read `docs/HANDOFF.md` and `docs/PROGRESS.md`; at the end of a session update them.
- Use the task list for multi-step work; keep exactly one step in progress.
- Prefer dedicated file tools over shell for reading and editing.
- Append a short entry to `docs/AI_USAGE.md` for each feature: what Claude did, what the human decided or corrected, what was verified. This feeds the README reflection the brief requires.
- Ask before anything outward-facing or hard to reverse (pushing, creating the GitHub repo, sharing access, sending email through a real provider).
