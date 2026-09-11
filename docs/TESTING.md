# Testing contract — real games, real users, real backend

## Non-negotiable acceptance

The app is not complete until a repeatable, unattended browser suite runs a **real two-round game** against TrailBase v0.33.14 with a host, four separately logged-in players on two teams and a separately enrolled display, verifies exact outcomes, and survives disruptions. Opening several pages with one shared login is not multi-user testing.

This document defines implementation gates; STATUS/evidence distinguish implemented checks from future commands. A missing command is a blocker, never a pass.

## Standard browser tooling (owner decision, 2026-09-11)

Use the repository-pinned **Playwright Test** runner for committed browser checks. For local Chromium testing use the already-installed Google Chrome via `channel: 'chrome'`, not a downloaded Playwright Chromium binary or a personal Chrome profile. The shell config is `playwright.shell.config.ts`; run `pnpm build && pnpm test:shell`. P04's full harness must retain the same local Chrome choice and actor-isolation rules. Use a `chromium` project name for the Chromium engine, with the explicit Chrome channel recorded in evidence.

- One fresh `browser.newContext()` per actor: host H, A1/A2, B1/B2, display D, outsider X. All contexts remain open together with independent cookies/localStorage/auth. Log each normal actor in through the UI. Multiple tabs in one context intentionally share identity; use them only for two-host-tab tests. Never reuse the same saved auth state across different actors.
- Playwright can interleave actor actions and coordinate concurrent requests; SSE continues in each open context. Use real state/event barriers and concurrent UI actions for race checks, not arbitrary sleeps. Close contexts and owned server processes in teardown.
- Record the actual browser version (`browser.version()`) with each run: the installed Chrome may auto-update. The library remains exactly pinned in pnpm-lock.yaml. CI must provision a known Chrome version and record its provenance; local auto-updated Chrome is not a pinned-browser reproducibility claim. Firefox/WebKit remain separate required projects in P10; Chrome does not substitute for them or native Tauri acceptance.
- Agent-browser and Chrome DevTools MCP are optional exploratory/debug tools, **not replacements for committed acceptance tests**. Inspection here found agent-browser 0.23.4 rejected by its wrapper (requires >=0.35.0; recommends 0.37.0), and a DevTools MCP new-page call timed out. Neither was verified usable. Do not change global tools or silently switch testing protocols to hide failures.
- Local Chrome 153.0.8010.37 actually launched under Playwright 1.63.0 and passed the shell suite, including seven concurrently open contexts with isolated preferences. This is not yet authenticated multi-user gameplay. The earlier bundled-browser download blocker is resolved by the explicit owner-approved channel choice, not by raising timeouts/retries. See `docs/evidence/P01.md`.

Reference: [Playwright context isolation](https://playwright.dev/docs/browser-contexts), [multiple roles](https://playwright.dev/docs/auth#testing-multiple-roles-together), [Chrome channels](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge).

## Layers

| Layer | What it proves | Tool / target |
|---|---|---|
| Plan bookkeeping | Status schema, dependency order, criterion/evidence consistency | Node built-ins; available now |
| Unit | Transition decisions, permutation, grading, timer math, input validation | Vitest with pure TS; no database mocks pretending to prove backend |
| Import | Read-only source, preservation, idempotency, interruption, malformed data | Python stdlib unittest/sqlite3; synthetic DB fixtures |
| Backend integration | Real auth, ACLs, atomicity, uniqueness, SQL/JSON mapping, stream visibility | Node/TS test runner + real TrailBase + isolated depot |
| Browser E2E | Human-visible workflows and independent sessions using actual UI/API/SSE | Playwright Chromium, Firefox, WebKit |
| Private full-corpus | All original source questions imported and checked | Local opt-in job, not public corpus/artifacts |
| Native | Actual Tauri windows, platform permissions, TV controls, install/update | macOS/Android device or emulator gates; not replaced by browser assertions |
| Release/operations | Fresh install, HTTPS/SSE, migrations, backup/restore, upgrade | Isolated staging rehearsal |

## Test infrastructure (P04)

Proposed files:

- `scripts/test-stack.mjs`: creates marker-owned depot, chooses loopback ports, starts/stops TrailBase and local mail sink; bounds readiness waits; rejects non-test targets.
- `scripts/seed-test-data.ts`: inserts original deterministic synthetic question bank and baseline test identities. Never imports the private corpus in public CI.
- `playwright.config.ts`: starts the owned stack; browser projects; traces/screenshots/video policy; zero acceptance retries.
- `tests/e2e/fixtures.ts`: yields actor-specific BrowserContexts/pages and API readers; closes them in finally/teardown.
- `tests/fixtures/questions.json`: original questions with known answer text, long Unicode examples and category/difficulty/level variety; content safe for public Git.
- `tests/backend/authorization.test.ts`, `tests/backend/contracts.test.ts`.
- `tests/e2e/auth.spec.ts`, `tests/e2e/harness.spec.ts`, then scenario files below as capabilities arrive.

Isolation rules:

1. Use `.local/test-runs/<run-id>/worker-<n>` and an ownership marker. Allocate available ports or fail clearly; never reuse a human dev/production server.
2. Each worker gets its own backend/mailer/database, or deliberately run one worker until this exists. Browser projects must not share mutable games accidentally.
3. Require a test-mode marker and loopback allowlist for setup/reset. A supplied URL outside the harness must be rejected unless explicitly owner-approved; never connect to trivia.azabab.com or a trail-party production host.
4. Start a real local SMTP capture service (e.g. Mailpit) on separate SMTP/HTTP ports; pin its version. Follow real email verification/reset links through the browser after fetching the message from the private test inbox API.
5. Prove readiness by backend health AND successful schema/auth checks, not fixed sleep. Timeout prints owned process logs and exits nonzero.
6. Teardown only owned child processes and marked paths; always run on failure/signals. Do not leave ports, database locks, refresh tokens or orphan mail messages behind.
7. Baseline accounts may be provisioned outside the UI for speed, but full-game login uses real UI username/email and password in each context. The separate auth scenario must exercise user-facing registration through verification and login without CLI verification shortcuts.
8. Test fixtures and config must produce the same production schema, API rules and handlers. No test-only relaxed ACLs, answer backdoors or magic admin UI bypass.

## Required full-game scenario (`tests/e2e/game.spec.ts`, P07 onward)

### Actors

- Host H, normal application user (not TrailBase administrator).
- A1 and A2, separate accounts and BrowserContexts, team Alpha.
- B1 and B2, separate accounts and BrowserContexts, team Beta.
- Display D, its own browser context using the actual `/display` route and real enrollment.
- Outsider X, separate ordinary account, with no membership.
- Optional separate host H2/game for cross-game isolation; a second H context for duplicate-controller tests.

All contexts have distinct cookies/localStorage/token state. Assert backend identity IDs differ for H/A1/A2/B1/B2/X and D is scoped as a device. Multiple tabs in one context are used **only** for same-identity tests.

### Main flow

1. Start fresh backend, mail sink and built/static frontend. Seed only deterministic question data and optional baseline identities.
2. H and all players log in through the UI. Separately test signup/verification in auth.spec.ts.
3. H creates a game through the UI, sets ready status, adds two rounds with two questions each using supported setup controls. Configure no automatic timers in this deterministic scoring test. Capture the generated code from the UI.
4. D opens the real display screen; H pairs its six-digit code through display-management UI. Assert D changes from pairing screen to this game's state without a page reload. During P07 before display pairing ships, this assertion belongs to the dependent P09 gate; do not claim final full-game acceptance until included.
5. A1 joins by code and creates Alpha; A2 joins Alpha using the join link. B1 creates Beta; B2 joins Beta. Assert host and display roster show all four users, and teammate views agree. Verify generated QR payload decodes to the same join URL (not just that an SVG exists).
6. X tries direct player/controller URLs, answer submissions and a foreign-game write using X's own token; server rejects unauthorized access and emits no forbidden events. Use API attacks for negative security checks only, not positive gameplay.
7. H starts the game through UI and advances through game-start and round-start. Every actor shows the same current question, round/index and shuffled answer text.
8. Submit answer text via visible UI choices, not a hard-coded label—the persisted shuffle may place the correct text under any A/B/C/D label. Teammates see the accepted choice via SSE without refresh. Both teammates must get at least one turn initiating their team's answer across the game.
9. H reveals each question. Before reveal no player/display response, expansion, event or visible state contains the answer key/grade. After reveal all eligible views converge to correct text/highlight and expected grade. Check wrong and missing answers explicitly.
10. H completes both rounds, reaches game-end, thanks and return-to-lobby. Verify exact scores on host, players and display, plus read-only backend records. Assert no duplicate accepted answer rows or score events.
11. Completion removes the game from active rejoin choices. Display releases and presents a new usable pairing code. Reopen host history and verify persisted completion/scores.
12. All actors log out/close; owned test infrastructure shuts down.

### Deterministic scoring oracle

| Round/question | Alpha | Beta | Running totals Alpha/Beta |
|---|---|---|---|
| R1/Q1 | correct, submitted by A1 | wrong, B1 | 1 / 0 |
| R1/Q2 | wrong, A2 | correct, B2 | 1 / 1 |
| R2/Q1 | correct, A1 | no submission | 2 / 1 |
| R2/Q2 | correct, A2 | wrong, B1 | 3 / 1 |

Expected round scores: Alpha `[1,2]`, Beta `[1,0]`. Final: Alpha **3**, Beta **1**. A missing answer never receives a point. Repeating reveal or revisiting a question never increments a second time. Backend reads corroborate UI, but do not substitute for checking it.

## Disruption, concurrency and authorization matrix

| Scenario / file | Required observable assertions |
|---|---|
| `concurrent-answers.spec.ts` | A1/A2 submit simultaneously; exactly one team answer is accepted under the documented rule; both UIs converge. Duplicate network retries and cross-team spoofing cannot add rows or points. |
| `transitions.spec.ts` | Manual advance races timer expiry; two H contexts advance/reveal concurrently. Only one version transition and one grading result; stale clients reconcile. |
| `recovery.spec.ts` | Player reload keeps membership/answer; returning to lobby exposes active game; host reload at question/reveal/paused/round-end restores exact state; display restart doesn't silently steal another display. |
| `recovery.spec.ts` | Set only one actor offline, let others advance, restore network; recover snapshot and subscriptions within bounded time without stale scores or duplicate handlers. Simulate clean stream close and dropped SSE. |
| `recovery.spec.ts` | Restart the actual backend while contexts remain open; durable game state survives; all actors recover and continue. This must not wipe the depot. |
| `auth.spec.ts` | Expired auth token refresh with valid refresh token; invalid refresh leads to login; logout prevents continued protected writes. Fresh contexts cannot inherit another account's auth. |
| `timers.spec.ts` | Seven timer settings; null/zero disabled; normal expiry; pause freezes remaining; resume uses remaining; reload restores; question/reveal switch changes duration; clock skew tolerated as documented. |
| `timers.spec.ts` | All-teams answered: option on/off, no timer, >3 seconds, <=3 seconds, paused, zero teams, late join/team change; exactly one reveal; notification visible on H/P/D. |
| `presence.spec.ts` | Visible/background/away, heartbeat cutoff, closed tab without beacon, duplicate same-user tabs, return online, changed team/name. Host and other roles see only authorized presence. |
| `display.spec.ts` | Two hosts race a claim; only one wins. Wrong/expired code denied, unpaired device cannot read arbitrary games, unauthorized release denied. Multiple displays receive the same state; release/reassign/theme works. |
| `isolation.spec.ts` | H2 cannot manage H's game; X cannot self-assign host, forge ownership/grade/state, join a closed game, read unrevealed keys or subscribe to private tables. Test both direct requests and expanded/event payloads. |
| `setup.spec.ts` | Validation and persistence of game/round settings; reorder/delete; no empty/invalid game start; imported/synthetic question categories and levels; unique join codes. |
| `questions.spec.ts` | Random selection respects eligible corpus and history; recycle preserves used history; insufficient pool is visible and safe; page size/count boundaries do not hide categories. |
| `profile.spec.ts` | Update name, upload/remove valid avatar, reject invalid type/oversize input server-side; roster refreshes; another profile cannot be edited. |
| `oauth.spec.ts` | Local controlled provider tests callback/state/PKCE/return-to. Real Google success requires owner credentials and separate evidence; mocks are not a replacement. |
| `download.spec.ts` | Platform download links/version match actual release; unavailable assets display honestly; backend or update service errors are recoverable. |

## Timing, polling and diagnostics

- Normal isolated local realtime propagation budget: **2 seconds** per state assertion; reconnect/restart convergence: **10 seconds after backend readiness**; timer display drift: **<=1 second** between clients after sync. These are initial test budgets, not universal production performance guarantees. Record measured results; changes need justification.
- Use `expect(...).toHaveText`, `expect.poll`, response/event predicates and barriers. No blanket `waitForTimeout`. Real short timers test integration; fake clocks are confined to deterministic unit tests and explicitly clock-controlled tests.
- At least one no-refresh/no-polling assertion proves SSE drove the new state (observe event and UI). A test that repeatedly navigates until the page changes is not realtime proof.
- Capture per-actor named traces, failure screenshots, video-on-failure, console errors, failed requests, sanitized stream lifecycle and test seed/IDs. Auth tokens/mail links are secrets; redact or keep raw artifacts access-controlled.
- Do not upload a full private DB or real question text to public GitHub Actions artifacts. Synthetic fixtures only for public CI. If artifacts cannot be safely redacted, retain locally and commit only a digest/assertion summary.
- Flaky gate: full core scenario **10 consecutive Chromium runs with `--retries=0`**, plus at least one successful full scenario each on Firefox/WebKit. Acceptance runner must fail on any unexpected skipped test.

## Browser/device matrix

PR fast lane: unit + backend + Chromium auth/join/full-game; from P07 the full-game is blocking. Before P07, run only implemented focused specs and clearly identify the incomplete scope.

Nightly/release: Chromium/Firefox/WebKit desktop; mobile Chromium 393x851 and WebKit 390x844; minimum 375px and tablet/desktop; display 1920x1080 and 4K. The role contexts can have different viewport sizes in one game. Test long words, long Unicode questions, avatars missing/loading, large rosters, light/dark and focus rings. Screenshots use synthetic text, stable fonts and frozen visual-only animations; timer gameplay tests remain real.

Accessibility: keyboard-only registration/join/game control; shortcuts ignored in editable controls/dialogs; focus return after dialogs; accessible names and live feedback; contrast and 44px touch targets. Use semantic assertions plus an automated accessibility scan if an existing compatible test dependency supports it, without claiming that a scan replaces keyboard testing.

Native macOS: real packaged app launch -> pair -> render -> menu Cmd+F -> monitor switch/borderless -> close/reopen -> reconnect -> signed updater install/relaunch. Record OS/architecture and monitors. No monitor available = multi-monitor criterion blocked, not passed with mocked coordinates.

Android TV: actual TV emulator/device installs APK, launch icon appears, remote D-pad/OK/back focus works, fullscreen has no desktop menu, network loss/resume recovers and a real browser-hosted game updates the native display. Browser emulation is not Android WebView proof. Test debug and release artifacts; signing blocks publication, not local debug tests.

## Planned command surface

| Command | Introduced | Expected result |
|---|---|---|
| `pnpm check`, `pnpm lint`, `pnpm build` | P01 | Static app typechecks/lints/builds |
| `pnpm test:unit` | P01 | Unit checks exit 0 |
| `pnpm test:backend` | P02 | Isolated real-backend tests exit 0 |
| `pnpm import:questions -- --source <db> --depot <owned-local-depot> --dry-run` | P03 | Reports safe validated source/destination, writes no application rows |
| `pnpm import:questions -- --source <db> --depot <owned-local-depot>` | P03 | Imports questions only, produces integrity manifest |
| `pnpm test:import` / `pnpm verify:corpus -- --source <db> --depot <depot>` | P03 | Synthetic import tests / full private comparison pass |
| `pnpm test:e2e -- --project=chromium` | P04 | All implemented browser scenarios pass |
| `pnpm test:e2e:headed` | P04 | Same genuine multi-context run visibly |
| `pnpm test:e2e:game -- --project=chromium --retries=0` | P07 | Complete 2x2 game; gains D assertions in P09 |
| `pnpm test:e2e:repeat -- --runs=10` | P10 | All ten core games pass without retries |
| `pnpm test:e2e:corpus` | P10 | Opt-in local actual imported-question game; no public artifacts |
| `pnpm test:native:macos` / `pnpm test:native:android` | P11 | Automation where supported; remaining manual checks report blocked until evidenced |
| `pnpm verify:release` | P12 | Aggregates required checks; refuses missing/skipped/blocked requirements |

Scripts must validate flags and document exact argument forwarding when implemented; the commands above are contracts to implement, not assertions that those files already exist.
