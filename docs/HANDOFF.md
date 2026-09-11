# Development handoff

Updated: 2026-09-11. Repository: https://github.com/burggraf/trail-party. Checkout: `~/dev/trail-party`, branch **main**. Owner explicitly requests **no worktrees; work on main** (recorded in AGENTS).

## Current boundary

P00 remains complete. **P01.T1 started, now blocked on the pinned Chromium download. No P01 criterion passed.** Base commit `9c971dc`; this checkpoint commits documentation only. Partial application/tooling files remain in the worktree, intentionally uncommitted; do not reset them. See `docs/evidence/P01.md` for their content manifest and actual results. STATUS is canonical.

The placeholder SvelteKit static SPA typechecks/lints/builds; it is not a usable application. No theme, role entry, display route, shadcn components, backend schema/API, question import or gameplay E2E yet. Tauri CLI generated a template only; it has not been pinned/built/launched.

## Next exact action / blocker

Playwright 1.63.0 needs Chromium build 1243 (Chrome for Testing 153.0.8010.12 mac-arm64). It is absent. `pnpm exec playwright install chromium` exited 1 downloading from `cdn.playwright.dev` with default timeout errors. No timeout/retry settings changed, no alternate browser substituted.

**Owner decision:** restore access to the official artifact, or explicitly approve an identified installed browser channel for shell testing. Do not label missing browser or no tests as a skip/pass.

After access is restored:

```bash
cd ~/dev/trail-party
pnpm plan:check
pnpm plan:status
pnpm test:plan
trail --version
pnpm exec playwright install chromium
pnpm build && pnpm test:shell
```

The shell suite should then reach **behavioral red** (missing landing/theme/display); its first run only proved a missing browser. Clear the blocker/set P01/T1 in_progress in STATUS, implement the measured shell checks, and rerun gates. Do not advance to T2 yet.

Continue T1 with:
1. Finish shadcn-svelte 1.6.1 init: it now needs an explicit preset (see `pnpm exec shadcn-svelte init --help`); use the simplest neutral preset, generate/review button, pin added deps. `$lib` alias is now generated after creating `src/lib` and running sync.
2. Implement F01 role navigation (honest auth-not-yet-available destination), light/dark/system persistence, accessible controls, shared `/display`; add a meaningful unit test before the behavior.
3. Trim/review generated `src-tauri`, replace template metadata, pin Tauri 2.11.5 and compatible tauri-build, commit Cargo.lock when actually scaffolded. Set native URL `/display`, minimal capabilities/CSP, no unused logging/serde plugins or extra platform assets. Build and prove actual macOS shell separately from browser smoke.
4. Run `pnpm check && pnpm lint && pnpm test:unit && pnpm build`, `pnpm test:scaffold`, `pnpm test:shell`; update evidence/status and commit the cohesive tested scaffold. Preserve pending C2/C3/T2/T3 scope.

## Partial changed files

- `package.json`, `pnpm-lock.yaml`: exact compatible frontend/testing/lint pins and commands.
- `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`: minimal static SPA/tool configs.
- `src/app.html`, `src/app.css`, `src/routes/+layout.ts`, `src/routes/+page.svelte`: SSR disabled; placeholder only.
- `scripts/scaffold.test.mjs`, `playwright.shell.config.ts`, `tests/shell/shell.spec.ts`: structural and browser acceptance checks, still red.
- `src-tauri/`: CLI template with placeholder identifier/version, floating crates, default permissions/icons. **Unreviewed template, not acceptance-ready.** No Cargo.lock yet.
- Documentation checkpoint: AGENTS, STATUS, STACK, this handoff, evidence/P01.

## Checks and diagnostics

- Plan check/status: exit 0; plan regression: 7 passed, zero skipped.
- Initial structural red: missing command/config, exit 1.
- Final `pnpm check`, `pnpm lint`, `pnpm build`: exit 0 on placeholder code.
- `pnpm test:unit`: exit 1 (no unit tests yet).
- `pnpm test:scaffold`: exit 1 (native default route missing).
- `pnpm test:shell`: exit 1 (browser launch unavailable, zero retries/skips).
- Browser install: exit 1; ignored local logs and traces under `.artifacts/p01/` and `.artifacts/shell/`.
- shadcn first init failed for absent generated `$lib`; creating `src/lib` and sync fixed that prerequisite. Second invocation reached a preset prompt and was deliberately stopped on browser blocker.

Reference commit remains `442890dda579c6cb108d2f4851816e4388207627`, no drift. Required backend verified unchanged: v0.33.14 / source 3f965de7 / SQLite 3.53.2. Node 26.7.0, pnpm 11.22.0, Rust 1.91.1, macOS 26.6.2. No global tool upgrade, production action, source DB access or data import.

## Processes and ownership

All managed processes stopped/exited: install `proc_168c`, shell red `proc_b319`, browser install `proc_0f6a`, shadcn init `proc_7663` / `proc_d19f`, checkpoint gates `proc_2c5f`. Playwright-owned preview used loopback port 4173 and shut down. No running dev/native/backend processes or owned TrailBase depots. No unknown listener was killed.

## Owner inputs retained for later

Google OAuth credentials/callbacks and production SMTP/host configuration remain P12 gates. Native signing/updater keys/Android keystore and public publication require approval. Actual macOS multi-monitor and Android TV hardware remain P11 gates. Reference license and question/asset redistribution rights are unresolved: do not invent a license or publish the corpus. Live reference writes require session-specific approval; local isolated synthetic testing remains authorized.
