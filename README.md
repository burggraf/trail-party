# Trail Party

A learning project recreating [Trivia Party](https://trivia.azabab.com/) using **TrailBase v0.33.14**, **Svelte**, **shadcn-svelte/Tailwind**, and **Tauri**.

**Current state: shared shell plus a local native email-auth/profile slice.** The static SvelteKit app has landing/role-entry previews, persistent themes, `/auth`, authenticated profile creation and a browser/native `/display` route. Pairing, lobby, gameplay and question import are **not implemented**. The tested shell/auth slice is not functional game parity; STATUS/evidence track the remaining work.

## Continue development

```bash
cd ~/dev/trail-party
pnpm plan:check
pnpm plan:status
pnpm test:plan
```

Read [AGENTS.md](AGENTS.md) and [the handoff](docs/HANDOFF.md), then execute the first ready task. Work directly on `main` per owner preference; no worktrees.

## Run the shell

Tested toolchain: Node 26.7.0, pnpm 11.22.0, Rust 1.91.1, installed Google Chrome 153.0.8010.37 on macOS arm64. Node 24 is within dependency engine ranges but has not been separately verified. Native development also needs Xcode. No global tool upgrades are automatic.

```bash
pnpm install --frozen-lockfile
pnpm dev                         # browser: http://127.0.0.1:5173; prints owned Mailpit inbox URL
pnpm check && pnpm lint && pnpm test:unit && pnpm build
pnpm test:scaffold
pnpm test:shell                  # built static app; installed Chrome, isolated profiles
pnpm test:backend -- capabilities # real pinned TrailBase, owned throwaway depot
cargo build --locked --manifest-path src-tauri/Cargo.toml
pnpm tauri dev --no-watch        # owns a dev server; stop pnpm dev first
# Open the printed Mailpit URL to click verification/reset links; no TrailBase admin login is needed.
```

Playwright is the committed browser-test runner; local Chromium checks use `channel: 'chrome'`, not a personal profile or another browser download. Seven isolated contexts can run together; full-game actors will log in separately through the UI. Shell checks currently prove only navigation, theme persistence/isolation and browser-safe rendering. See [the testing contract](docs/TESTING.md). Native window smoke is separate from browser tests; packaged/native gameplay acceptance comes later.

Backend probes exercise real CRUD/auth/ACL/SSE and WASM transaction/CAS behavior using synthetic-only fixtures. They are not application signup, game schema or multi-user gameplay acceptance. The SDK's small pinned SSE fix and its regressions are documented in [patches/README.md](patches/README.md); [STACK](docs/STACK.md) records the measured contracts and CLI limitation.

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
