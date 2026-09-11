# Development handoff

Updated: 2026-09-11. Repo: https://github.com/burggraf/trail-party. Checkout: `~/dev/trail-party`, branch **main**. Owner preference: **no worktrees; work on main**.

## Current boundary

**P01.T1/T2 complete; P01.C1/C2/C3 passed.** Independent review found no issues. T3/C4 remain pending; P01 is not complete.

Accepted T2 work is based on `44a52e7a1721afe636006711539f1fd1a7695d76` (commit/exact-commit verification follows): real owned-depot CRUD/auth/ACL/serialization/schema/SSE probes, minimal authenticated WASM CAS/rollback fixture, and a small pinned SDK SSE patch. Do not discard/restart it blindly. No application accounts UI, gameplay schema, pairing, questions import or full-game E2E is implemented. Synthetic capability fixtures are not the production schema or an allowed gameplay backdoor.

## Resume / next exact action

1. Confirm Git status/branch; read STATUS, P01.T2/T3 and evidence; run `pnpm plan:check`, `pnpm plan:status`, `pnpm test:plan`, `trail --version`.
2. Confirm the T2 commit/exact-commit verification checkpoint below. Fresh read-only review **`adddf6f6-28b1-4345-a3fc-1e8e18f3ecfa`** returned **OK — ready, no issues found**; output `.artifacts/p01-t2/review.md`. No code changes followed the full gate/review.
3. **P01.T3**: read its product decisions and relevant reference behavior; add safe dev-launcher readiness/ownership and pin/verify CI backend release artifacts. Mark it in_progress before implementation. The T2 probe runner is not the T3 dev launcher. Owner authorized source Git commit/push, not deployment/release publication.

## Actual verification

Full pre-review run **`proc_9d5d`** exited 0: frozen install, type/lint, unit **2**, static build, backend **8**, scaffold **3**, Chrome shell **3**, Cargo fmt/build, plan validation/regression **7**. Zero retries/skips. Logs `.artifacts/p01-t2/pre-review.{stdout,stderr}.log`; exact component hash and red/green history in `docs/evidence/P01.md`. Source code was unchanged after that run; documentation was updated afterward.

The backend tests prove real authorization, filtered insert/update/delete events, cancellation/resubscription, Unicode under single-byte splitting of actual network data, auth refresh/logout, and concurrent WASM CAS plus second-write rollback. The separate parser-only unit test is not real-backend evidence. These are not browser-auth, verification-mail, automatic recovery, full-game or ten-run stability acceptance.

```bash
pnpm install --frozen-lockfile
pnpm check && pnpm lint && pnpm test:unit && pnpm build
pnpm test:backend -- capabilities
pnpm test:scaffold
pnpm test:shell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo build --locked --manifest-path src-tauri/Cargo.toml
pnpm dev                       # browser localhost:5173
pnpm tauri dev --no-watch       # stop pnpm dev first; starts its own server
```

## Backend findings to retain

- Required binary stays **v0.33.14**, source `3f965de7ea516c43a54ca70a495e97f0c6d991ab`, SQLite **3.53.2**. SDK **0.14.1**, WASM SDK **0.6.0**, JCO **1.32.1**. JCO reports compatibility fallback to locked componentize-js **0.19.3**; actual resulting component passes on the pinned backend.
- `trail user add` is broken against the removed `verified` column. The isolated fixture uses real anonymous auth, CLI admin promotion, refresh and `/api/_admin/user` to provision ordinary baseline actors. Never use this bootstrap in normal browser flows.
- UUIDs are padded URL-safe Base64; timestamps are seconds. Structured JSON requires `jsonschema_matches` metadata. SDK `FetchError` does not extend Error. See STACK for measured contracts.
- The unpatched SDK loses partial SSE/UTF-8 frames and per-chunk sequence history. `patches/trailbase@0.14.1.patch` fixes the existing SDK implementation; retain both regressions before removing it. No generic wrapper/event bus was added. Future app code still needs lifecycle/reconciliation.
- Fixture depots are generated under `.local/test-runs/`; no external depot/URL option. Raw backend logs can contain generated bootstrap credentials and stay ignored/private. Do not publish them.

## Consistent browser/native tooling

Use repository-pinned **Playwright 1.63.0**, installed Google Chrome **`channel: 'chrome'`**, fresh BrowserContext per actor, real UI login once implemented. Tested Chrome **153.0.8010.37**; log its actual version each run because it can update. Never reuse personal profiles or share different actors' auth state. Shell tests prove preferences/navigation only. CI browser pinning, Firefox/WebKit and native acceptance remain separate.

The earlier bundled-Chromium download issue is resolved by the owner's installed-Chrome choice, not extra retries/timeouts. Agent-browser is currently rejected by its wrapper (0.23.4 versus required >=0.35.0); DevTools MCP smoke timed out. Neither is the acceptance runner.

T1 native window actually rendered shared `/display`, with owned cleanup. Its screenshot/evidence remain in P01; no new native-window/Android TV proof is claimed for T2. Tauri =2.11.5 / tauri-build =2.6.3; Rust 1.91.1, Node 26.7.0, pnpm 11.22.0, macOS 26.6.2 arm64. No global upgrades or pnpm release-age exemptions.

## Processes, scope and owner gates

No dev/native/backend processes remain from `proc_9d5d`; backend port **57762** and shell **4173** are clear, `.local/test-runs/` is empty. The read-only review is complete; no active work remains from that run. Never kill an unknown listener or wipe an unmarked directory.

Reference HEAD unchanged: `442890dda579c6cb108d2f4851816e4388207627`. No source DB access/import or production action. Google OAuth/callbacks, production SMTP/host, signing/updater/Android keys, corpus/license rights and native hardware remain later owner gates. The SDK's upstream notice is retained separately; no project/reference/corpus redistribution license was invented.
