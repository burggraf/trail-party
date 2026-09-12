# Trail Party — development contract

## Mission and boundaries

Recreate the **functionality** of the current Trivia Party application as a learning exercise using TrailBase, Svelte, shadcn-svelte, and Tauri. This is a new application, not a PocketBase production cutover. Use functional/responsive parity, not pixel-perfect React reproduction.

- Reference source: `~/dev/trivia-party` (read-only). Reference live app: https://trivia.azabab.com/.
- Target: browser host/player/controller; browser-testable display; native macOS and Android TV display applications. Windows and Apple TV were only planned in the reference and are not required.
- Import **questions only** from `~/dev/trivia-party/pb_data/data.db`. The requested shorthand `~/trivia-party/pb_data/data.db` did not exist at planning time. Support an explicit source-path option; never create a missing source DB.
- Start with fresh users, games, teams, answers, and display identities. Never copy authentication tables, production avatars, logs, secrets, signing keys, or PocketBase runtime directories.
- Keep Google OAuth in scope; credentials are an explicit owner-dependent release gate.
- Planning/bootstrap is not an implemented app. Do not call scaffolding, mocked flows, or skipped tests functional parity.

## Start every session here

1. `cd ~/dev/trail-party` (or the current checkout); confirm `pwd`, `git status --short`, and branch.
2. Read `docs/STATUS.json`, `docs/HANDOFF.md`, and `docs/plans/2026-09-11-trail-party.md`.
3. Run `pnpm plan:check` and `pnpm plan:status`.
4. Read the selected phase, its dependencies and criteria, plus `docs/PARITY.md` and relevant reference source. Compare the current source commit with the recorded baseline; record meaningful changes rather than silently expanding scope.
5. Run `trail --version`. Required backend: **v0.33.14**, source `3f965de7ea516c43a54ca70a495e97f0c6d991ab`, embedded SQLite **3.53.2**. Stop on an incompatible backend, never silently upgrade.
6. Confirm prerequisite tests and tools actually work. Missing tools, credentials, hardware, or commands are blockers, not successful skips.
7. Choose the first ready incomplete task. Set its phase/task `in_progress` before writing application code. Recover abandoned `in_progress` work from Git and evidence; do not reset it blindly.

## Stack and architecture rules

- pnpm only; no npm/yarn commands. Lock dependencies and commit pnpm/Cargo lockfiles when scaffolded.
- Resolve stable frontend versions at scaffold time against `docs/STACK.md`; exclude prereleases and check peer compatibility. Pin TrailBase independently; current online docs may describe a different version.
- One SvelteKit static SPA, Svelte 5 runes, strict TypeScript, shadcn-svelte components and compatible Tailwind 4. No SvelteKit runtime server, API routes, or server actions; backend logic belongs in TrailBase.
- Tauri wraps the same `/display` UI. Use small platform-specific modules; no copied frontend/service tree.
- Use the official `trailbase` JS SDK (not an invented `@trailbase/client`). Verify its real methods and return types against v0.33.14.
- When it provides useful local TrailBase inspection/operation leverage, use `trail mcp [ADDRESS]` only with an owned, isolated local depot and loopback/test server—never production or an unowned depot. Verify the pinned binary/help first; keep tokens/credentials private and never paste them into prompts, logs, or Git. Treat `--user`/`--tokens` as operator authentication mechanisms, not browser/admin authorization shortcuts. MCP complements, but never replaces, required real backend/API/SSE/E2E acceptance tests; use read-only inspection by default and require explicit owner authorization for writes/destructive operations.
- Prefer Record APIs and SQL constraints. Use small authenticated WASM handlers only where authorization, atomic multi-record operations, or missing query features require them. Do not implement a PocketBase compatibility layer, generic repository abstraction, custom ORM, or event bus.
- Authorization and answer grading are server responsibilities. A client-supplied host ID, score, answer key, or role is never authority. Ordinary hosts are not TrailBase administrators.
- Correct-answer mappings and unrevealed answer keys must not leak through REST, expanded relations, SSE, static bundles, or player/display state. Backend tests must enforce this.
- Use parameterized SQL, explicit input validation and transactions/CAS for concurrent changes. Fail visibly without partial success. Never hide errors as empty data.
- No hard-coded collection IDs, secrets, backend hostnames, production accounts, or signed release keys.
- Mobile-first from 375px, 44px touch targets, keyboard/focus/label semantics, dark/light mode, long text and TV readability. Use shadcn-svelte primitives rather than recreating controls.

## Acceptance-driven development loop (mandatory)

For **each task**, in order:

1. Read the exact reference behavior and write a measurable acceptance test/check before implementation. Map it to a parity ID and phase criterion.
2. Run the new check and capture the expected failure. For documentation-only tasks use structural/link/status validation instead of a fake red UI test.
3. Implement the smallest working change; then rerun the check and the affected regression gates.
4. On failure, preserve diagnostics, investigate the root cause, add a regression check, fix, rerun. Do not raise timeouts/retries, weaken assertions, add sleeps, or mark tests skipped to get green.
5. Record evidence in `docs/evidence/<phase-id>.md`: source and tested commit, commands, environment, exit codes, assertion summaries, artifact locations and residual limitations. Keep sensitive/raw artifacts in ignored local storage or access-controlled CI artifacts.
6. Update `docs/STATUS.json` task and criterion results and `docs/HANDOFF.md` with the next exact action. Commit cohesive changes; never claim a commit passed checks that were run against different application code.
7. A phase becomes `complete` only when **all** its tasks and criteria pass, dependencies are complete, evidence is present and review finds no unresolved scope/security defects. `pnpm plan:check` checks bookkeeping, not whether tests really passed.
8. After three unsuccessful fix/verification cycles for the same issue, document the reproducible failure, attempted fixes and decision needed; mark blocked and ask the owner. Do not loop indefinitely or replace the tool/protocol secretly.

## Mandatory E2E policy

Read `docs/TESTING.md`. Real multi-user web E2E is a core deliverable, not optional polish.

- Use the repository-pinned Playwright Test runner for durable browser checks; local Chromium projects use installed Google Chrome via `channel: 'chrome'` (no personal profile). Record the actual browser version. Agent-browser/DevTools are optional exploration, not acceptance replacements; do not silently switch tools or upgrade global tooling. See `docs/TESTING.md` for CI and cross-browser boundaries.
- Playwright drives independently authenticated browser contexts against a **real isolated TrailBase process and SQLite database**, with real SSE and real auth.
- No mocked API/SSE, forged tokens, shared host/player storage state, direct DB writes for gameplay, or JS calls that bypass UI actions in the full-game gate.
- Fixtures may provision deterministic questions and baseline accounts outside the dedicated signup scenario. Every full-game actor logs in through the UI; registration/verification/reset have their own real local-mail tests.
- The required game has a host, four players on two teams, and a paired display; a separate unauthorized user probes isolation. Prove both teammate synchronization and opponent isolation.
- Complete two rounds, reveal/grade every question, verify exact round/final scores and cleanup. Include simultaneous submissions, reload/rejoin, dropped connections, backend restart, timers, and two active host tabs.
- Use role/label/test-id locators, bounded state-based assertions and condition polling, not arbitrary sleeps. Realtime checks must prove delivery without a page reload.
- Test-specific depots/ports, unique test IDs, owned process cleanup, and production URL guards are mandatory. Never kill an unknown listener or wipe an unmarked directory.
- Full acceptance requires passing required tests with **zero retries and zero unexpected skips**. A retry can collect diagnostics but cannot conceal flakiness. Record 10 consecutive core-game passes.
- Browser tests are not native Tauri proof. Test macOS window/update behavior and Android TV installation/remote/focus separately. Explicitly report hardware/signing limitations.

## Safety, public repository, and reference use

- Public Git includes code, synthetic fixtures, sanitized configuration and documents only. Do not publish the question corpus unless the owner establishes redistribution rights.
- Open the source database read-only and take a consistent SQLite backup into ignored local storage before import. Never connect the new app to the production PocketBase API for writes.
- Production inspection may be read-only. Creating test games, signing up players, pairing displays, sending real emails, or interacting with real games needs explicit owner approval for that session and controlled test accounts. Do not interfere with real players.
- Redact tokens, cookies, passwords, emails, names, avatars and private game content before committing screenshots/logs. Prefer synthetic local screenshots.
- Never commit `.env`, DB files/WAL, token state, mail storage, keystores, signing credentials or updater private keys. Check staged files before every push.
- Do not copy reference source wholesale or invent a license. The reference has no declared license in the inspected checkout; ask the owner before adding a redistribution license or copied assets.
- Deployments, public release publication, destructive resets, signing and production configuration changes need explicit authorization. Local isolated test actions are permitted by the development plan.

## Restart and collaboration

`docs/STATUS.json` is the sole machine-readable task/criterion status source. The plan defines scope; evidence proves results; `docs/HANDOFF.md` records the most recent handoff. Do not maintain conflicting checkbox lists.

### Mandatory subagent dispatch

For all additional work, dispatch a subagent for every task. Luna tasks should use `openai-codex/gpt-5.6-luna:max` by default; high/medium remain available only when explicitly requested or required by a recorded gate. Explicitly pin and record the actual provider, model and reasoning level; report routing mismatches rather than silently substituting. The owner has approved P02.T1 implementation and changed the repeated-approval rule: no per-dispatch approval is required for this bounded, pre-approved Astra review pattern—exact runtime `openai-codex/gpt-6-astra:medium`; fresh, read-only design/security review before P02, P07, P09, P10 and P12; fresh independent post-phase reviews; and final release and concurrency reviews named by the plan. Any other Astra use (implementation, mutation, scout, general advice, or a different model/reasoning level) still requires explicit owner approval; an actual Astra route outside this pattern without that approval is unauthorized and must stop/report. Astra xhigh/max remain prohibited. Luna/max remains the default for implementation and ordinary workers. Verify every run's actual provider, model and reasoning level and stop on mismatch. Historical Astra xhigh/max records are evidence only and do not authorize future use. Pending approval for any approval-gated use pauses the gate; it does not waive the gate or substitute Luna as equivalent. Each independent review must use a fresh reviewer, not the phase implementer.

The parent retains supervision, acceptance and Git publication authority. Use stable phase/task/criterion IDs and consume review results before declaring acceptance. Keep one writer per working tree, work directly on `main`, and do not create worktrees unless the owner explicitly changes that preference. Do not commit another worker's unrelated changes.

End every development session with: completed work, actual checks run, current blockers, next command/task, and any running process IDs/ports. A fresh session must be able to continue without chat history.
