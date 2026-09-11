# Development handoff

Updated: 2026-09-11. Repository: https://github.com/burggraf/trail-party. Working directory: `~/dev/trail-party`. Branch: `main`.

## Current boundary

Planning foundation prepared; P00 publication/verification is being finalized. **No Svelte/Tauri application, TrailBase schema, question import, or game E2E implementation yet.** `package.json` exposes only plan checks. Status: `docs/STATUS.json`.

## Resume commands

```bash
cd ~/dev/trail-party
git status --short
git log -3 --oneline
pnpm plan:check
pnpm plan:status
pnpm test:plan
trail --version
```

After P00 closes, next task is **P01.T1**: read STACK and P01, verify stable compatible frontend/toolchain versions, mark P01/T1 in_progress, and scaffold the shared static SvelteKit/Tauri foundation with failing shell checks first. The backend stays v0.33.14 even if frontend stable releases advance.

## Decisions already confirmed by owner

- Browser host/player/controller; native macOS and Android TV displays; shared browser-testable display.
- Questions-only import; fresh accounts, games and device identities.
- Functional/responsive parity using shadcn-svelte, not pixel-perfect React duplication.
- Google OAuth retained; owner provides credentials later.
- Real multi-user browser E2E is mandatory, not an optional last-phase activity.

## Verified findings

- Local `trail --version`: v0.33.14-0-g3f965de7 (2026-09-10), SQLite 3.53.2.
- Reference commit: `442890dda579c6cb108d2f4851816e4388207627`.
- Existing source DB: `~/dev/trivia-party/pb_data/data.db`; requested `~/trivia-party/pb_data/data.db` does not exist here. Count at inspection: 591,183 questions. Count must be read anew for actual snapshot/import.
- Actual matching SDK: `trailbase@0.14.1`; create returns an ID, update returns void, subscriptions are streams, schema/config include explicit subscription controls.
- Email sign-up verification and device enrollment need the deliberate decisions documented in P01. Do not repeat the reference's fake-email device-account pattern without examining TrailBase semantics.
- Frontend stable snapshot in STACK includes Svelte 5.57.0, shadcn-svelte 1.6.1, Tailwind 4.3.3 and Tauri Rust 2.11.5. TS7 is registry-latest but outside recorded Kit peers; use a supported TS6 version unless compatibility changes.

## Inputs needed later (not blockers to beginning P01)

| Input | Needed by | Default / effect if absent |
|---|---|---|
| Google OAuth client credentials and approved callback domains | P12 real-provider acceptance | Local email flows and controlled provider tests proceed; real Google gate blocked |
| Production/staging domain/host and SMTP settings | P12 deployment | Local isolated development/test stack proceeds; no production deployment assumed |
| Apple signing/notarization credentials and updater release keys; Android release keystore | P12 public distribution | Local debug/package tests proceed; signing/publication gates stay blocked |
| macOS second monitor, Android TV emulator/device | P11 native acceptance | Explicit hardware checks cannot be marked passed until available |
| Source code license choice; rights to redistribute question corpus/assets | P12/public content | No license invented, no original corpus/assets committed |
| Approval for any live-reference write/test with real users | Whenever desired | Source inspection or read-only live exploration only; local synthetic games preferred |

## Verification and artifacts

See `docs/evidence/P00.md` for actual bootstrap checks and publication evidence. Plan tests use only Node built-ins; no framework install is required. pnpm may create its normal ignored node_modules metadata and a dependency-free lockfile.

No dev servers or test backend processes were started by the planning work. No production game/player/display actions were performed. No source DB was modified or imported.

## Future handoff updates must include

Exact active task and tested Git commit; partial changed files; last failing/passing commands; criterion evidence; blocker/owner request; next concrete step; running process IDs/ports/owned depot paths and cleanup responsibility. Never depend on this chat's context.
