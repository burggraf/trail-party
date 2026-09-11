# Trail Party

A learning project recreating [Trivia Party](https://trivia.azabab.com/) using **TrailBase v0.33.14**, **Svelte**, **shadcn-svelte/Tailwind**, and **Tauri**.

**Current state: planning foundation only.** No application is scaffolded, questions are not imported yet, and gameplay tests do not exist yet. The repository contains a detailed implementation plan, acceptance criteria, source-functionality inventory, real multi-user E2E specification, and runnable resume/status checks.

## Continue development

```bash
cd ~/dev/trail-party
pnpm plan:check
pnpm plan:status
pnpm test:plan
```

Bootstrap checks require Node >=24 and pnpm 11.22.0; no dependencies or install step are needed. Read [AGENTS.md](AGENTS.md) and [the handoff](docs/HANDOFF.md), then execute the first ready task. Application setup begins in P01.

## Plan and progress

- [Detailed phased implementation plan](docs/plans/2026-09-11-trail-party.md)
- [Machine-readable status](docs/STATUS.json) — canonical task and acceptance results
- [Architecture and trade-offs](docs/ARCHITECTURE.md)
- [Verified versions and pinned TrailBase APIs](docs/STACK.md)
- [Functionality parity inventory](docs/PARITY.md)
- [Testing contract](docs/TESTING.md) — host + four independent players + paired display, real backend/auth/SSE, exact scores, recovery and 10-run stability gate

## Scope

- Browser host, player, controller and display routes in one static SvelteKit app.
- macOS and Android TV display apps wrapping the same UI with Tauri.
- Functional and responsive parity; not pixel-perfect React reproduction.
- Email/password/verification/reset/profile plus Google OAuth (owner credentials required).
- Fresh accounts/games; import **questions only** from the local reference DB during P03.

Reference source: `~/dev/trivia-party`; question source: `~/dev/trivia-party/pb_data/data.db` (explicit override supported by the planned importer). The corpus stays local and out of Git. Public CI uses original synthetic questions. Do not copy private production accounts, assets, credentials or data into this public repository.

There is no license selected yet. Public repository visibility is not permission to redistribute the original question corpus or third-party assets; obtain owner approval before licensing/publishing them.
