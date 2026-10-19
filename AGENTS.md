# AGENTS.md

This repo's agent instructions live in [CLAUDE.md](./CLAUDE.md). It applies to every coding agent (Claude Code, Codex, Cursor, ...). Read it, then the relevant file in [docs/](./docs).

The non-negotiables, repeated:

1. Production has live users: **no deploy without ATD's explicit go-ahead.**
2. Run `npm test` before any deploy or code push (it includes the inline-script syntax test).
3. After every restart, check the live site; **roll back first**, debug second.
4. Never print or commit secrets (`.env`, `scripts/deploy.config`, tokens, IPs).
5. `sites/`, `data/`, `.env` and `.claude/` stay untracked.
