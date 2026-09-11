# Development handoff

Updated: 2026-09-11. Repo: https://github.com/burggraf/trail-party. Checkout: `~/dev/trail-party`, branch **main**. Owner preference: **no worktrees; work on main** (AGENTS).

## Current boundary

**P01.T1 complete; P01.C1 passed. P01 remains in progress.** T2/T3 and C2/C3 are pending; C4 has actual native-shell/cleanup evidence but still awaits the T3 launcher/decisions. No backend schema, auth, pairing, game, question import or multi-user gameplay implementation. The seven-context shell test proves preferences/storage isolation, not authenticated game users or real SSE.

Changes include the shared static SvelteKit shell, strict TS6/Svelte5, generated shadcn button/native-select, persisted light/dark/system theme, honest role-entry previews, shared `/display`, exact pnpm/Cargo pins and lockfiles, no native JS calls, minimal Tauri CSP/empty permissions. Native dev window actually rendered `/display`. Source baseline `63b93b6`; the scaffold commit and post-commit verification identity are recorded in `docs/evidence/P01.md`/Git log. No unrelated worker changes.

## Consistent testing tooling — keep this choice

Use repository-pinned **Playwright Test 1.63.0** with installed Google Chrome (`channel: 'chrome'`) for local Chromium browser checks. Actual tested version **153.0.8010.37**; log the browser version each run, because installed Chrome can update. Fresh BrowserContext per actor, login through UI once auth exists, no shared personal profiles or copied auth state. Multiple tabs share one context's identity intentionally.

This owner-approved choice resolves the old bundled-Chromium download blocker. Do not retry that download as the default setup, raise timeouts/retries, or silently switch testing protocols. Agent-browser is presently rejected by its wrapper (0.23.4 versus required >=0.35.0); a DevTools MCP smoke call timed out. They are optional exploration tools, not acceptance replacements. `docs/TESTING.md` and AGENTS contain the durable policy, including CI version pinning and future Firefox/WebKit requirements.

## Resume / next exact task: P01.T2

```bash
cd ~/dev/trail-party
git status --short
git log -3 --oneline
pnpm plan:check
pnpm plan:status
pnpm test:plan
trail --version
trail --help
trail run --help
trail components --help
```

Read P01.T2 and the pinned examples linked in STACK. Mark T2 in_progress **before implementation**. Write failing probes for migrations, CRUD returns/serialization, real auth login/refresh/logout, filtered SSE create/update/delete and cancellation, denial, and minimal authenticated WASM mutation/transaction or CAS behavior. Run only on a marker-owned throwaway loopback depot, never the reference DB or a normal dev/production depot. Capture the exact installed CLI/config/WASM contracts before writing any general client/realtime helper. T3 must then resolve the documented behavioral decisions and safe dev-launcher readiness/ownership.

## Current commands and verification

```bash
pnpm install --frozen-lockfile
pnpm check && pnpm lint && pnpm test:unit && pnpm build
pnpm test:scaffold
pnpm test:shell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo build --locked --manifest-path src-tauri/Cargo.toml
pnpm dev                       # browser localhost:5173
pnpm tauri dev --no-watch       # stop pnpm dev first; native command starts its own
```

Last complete pre-commit gate (`proc_6b84`, 2026-09-11T19:35:27Z log completion): frozen install/type/lint/unit/build/scaffold/shell/Cargo fmt+build/plan checks all exit 0. Unit 1, structural 3, browser 3, plan regression 7; zero retries/skips. Browser checks cover 375px, keyboard/44px host action, theme persistence/system changes, seven isolated contexts, and direct `/auth?role=host` plus `/display` reloads without native globals/page errors. Real static `build/` is served by Vite without Kit SSR middleware.

Fresh reviewer accepted T1 with a deep-link coverage note; the extra direct auth check was added and all gates rerun. Logs, review, code manifest and synthetic browser/native screenshots are ignored under `.artifacts/p01/` / `.artifacts/shell/`; sanitized summaries/provenance are in `docs/evidence/P01.md`.

## Dependency/safety findings to retain

shadcn CLI 1.6.1 Vega/neutral generated the controls. Default controls were raised to 44px; internal button URLs are typed and centrally resolved. Generated source/notice is versioned; do not fetch current registry components during builds. The generator added a pnpm minimum-release-age exemption for @lucide/svelte 1.45.0. It was removed; policy-eligible stable 1.44.0 is pinned, the lockfile regenerated, and frozen install passes without bypasses. All direct packages use exact stable versions.

Tauri =2.11.5 / tauri-build =2.6.3; Rust 1.91.1 and resolver 3, locked dependencies; Node 26.7.0 / pnpm 11.22.0 / macOS 26.6.2 arm64 tested. No global tool upgrades. Backend remains v0.33.14 / source 3f965de7 / SQLite 3.53.2. Reference HEAD unchanged: `442890dda579c6cb108d2f4851816e4388207627`. No source DB read/import or production action.

## Processes and artifacts

No running dev/native/backend processes. Native smoke `proc_9669` (app PID 29688, own window 99212, Vite port 5173) was stopped; app exit and port release verified. Shell runs owned preview port 4173 and shut it down. Final gates `proc_6b84` exited. No backend depots created, no unknown listener killed. Native screenshot proves only the shared dev shell, not packaged/native gameplay or Android TV acceptance.

## Owner inputs retained for later

Google OAuth/callbacks, production host/SMTP, native signing/updater keys/Android keystore, license/corpus rights, macOS multi-monitor and Android TV hardware remain their planned later gates. No app/reference/corpus redistribution license invented; upstream generated-component notice is retained separately. Deployment/public release/native signing and live-reference writes still require explicit approval.
