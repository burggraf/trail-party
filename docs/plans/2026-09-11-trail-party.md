# Trail Party Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task when available. In any harness, the equivalent mandatory process is the acceptance-first loop in AGENTS.md.

**Goal:** Recreate current Trivia Party functionality in a new public application, importing its question corpus and proving real multi-user gameplay automatically.

**Architecture:** One SvelteKit static SPA shares host/player/controller/display UI and talks directly to TrailBase v0.33.14. Tauri packages the display route for macOS and Android TV. Use SQL/Record APIs for ordinary data and small authenticated WASM commands for atomic gameplay where needed.

**Tech Stack:** Stable Svelte 5, SvelteKit/static adapter, TypeScript compatible with Kit, shadcn-svelte, Tailwind 4, Tauri 2, pnpm, pinned TrailBase v0.33.14/SQLite 3.53.2, official trailbase SDK, Playwright, unit/backend/import checks. Exact verified candidates: `docs/STACK.md`.

---

## Reading order and current boundary

1. `AGENTS.md`: binding development and safety rules.
2. `docs/STATUS.json`: canonical phase/task/criterion status.
3. `docs/HANDOFF.md`: last session and next precise action.
4. This plan, `docs/PARITY.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`.

The initial repository contains planning/governance and a runnable status validator. **The frontend, backend schema, question import and game tests are not implemented yet.** Questions are imported in P03, not published to Git. P00 is the only bootstrap phase eligible for completion now.

## Execution protocol

Each numbered task is a bounded work unit, usually a few hours or less. Split a task further into local test/fix steps without changing its stable ID. For each new behavior:

1. Inspect referenced source and write the smallest failing unit/integration/E2E assertion.
2. Run it and record the intended failure.
3. Implement the minimum behavior, then rerun the assertion and affected gates.
4. Inspect diff and test artifacts; fix defects and rerun, never weaken requirements for green.
5. Record evidence, update status/handoff, commit a cohesive change.

For new phase gates, expected initial outcome is a failing test or missing implementation, **not** a skipped suite. After three repeated failed iterations on one issue, record a blocker and ask for a decision. A complete phase requires every criterion passed with evidence. An unavailable external provider/signing key/hardware requirement stays blocked; independent ready tasks may continue, but final release cannot pass.

No automatic production writes, deployments or release publication are authorized by this plan. Local isolated test runs are authorized. Review current reference source before every feature phase; source/live discrepancies need a recorded decision.

## Phase graph

| Phase | Deliverable | Depends on | Indicative effort |
|---|---|---|---|
| P00 | Public repo, contract, plan and resume tooling | — | bootstrap |
| P01 | Verified stack, shared shell, pinned-backend capability spike | P00 | 1–2 days |
| P02 | Schema, auth, ACLs and backend contracts | P01 | 2–4 days |
| P03 | Safe full question import | P02 | 1–2 days |
| P04 | Real multi-context test infrastructure | P02 | 1–3 days |
| P05 | Host game/round/question setup | P03, P04 | 2–3 days |
| P06 | Lobby/join/teams/presence | P05 | 2–3 days |
| P07 | Playable scored multi-user game | P06 | 3–5 days |
| P08 | Timers, early reveal and controller controls | P07 | 2–3 days |
| P09 | Shared display enrollment/pairing/rendering | P08 | 2–3 days |
| P10 | Recovery, cross-browser/mobile/accessibility hardening | P09 | 2–4 days |
| P11 | macOS and Android TV packaging/native acceptance | P10 | 3–5 days |
| P12 | Release, private corpus game, OAuth and operations acceptance | P11 | 2–4 days plus external waits |

This is a **Svelte rewrite plus backend learning project**, not the earlier backend-only migration estimate. Budget roughly 4–8 focused developer weeks, with learning/credentials/hardware extending elapsed time. Estimates are planning ranges, not promises. P03/P04 may run independently in separate worktrees after P02; default to sequential work for simplicity.

---

## P00 — Planning foundation

**Files:** `README.md`, `AGENTS.md`, `package.json`, `.gitignore`, `docs/{ARCHITECTURE,STACK,PARITY,TESTING,HANDOFF}.md`, `docs/STATUS.json`, this plan, `scripts/plan.mjs`, `scripts/plan.test.mjs`, `docs/evidence/P00.md`, `.github/workflows/plan.yml`.

### P00.T1 — Confirm boundaries and create repository

Use the authenticated owner's gh account, create public `burggraf/trail-party` at `~/dev/trail-party`, and perform all new-project work there. Record installed backend and reference commit. Confirm questions-only import, existing platform scope, functional UI parity and OAuth inclusion. Inspect registry versions and pinned TrailBase source, not just live docs. Do not modify `~/dev/trivia-party`.

### P00.T2 — Write specification and durable governance

Write architecture alternatives/decision, F01–F30 traceability inventory, acceptance-first development policy, safe reference/data use, per-phase work and full-game test oracle. Mark version/API and external-service unknowns explicitly. All future app commands must be distinguished from implemented bootstrap commands.

### P00.T3 — Verify restart tooling and publish the foundation

Implement the dependency-free status validator/status display and small Node regression tests. Verify missing evidence, unmet prerequisites, invalid state transitions and incomplete criteria cannot masquerade as complete. Add plan-only CI. Run checks, inspect staged files for secrets/corpus, commit and push; verify remote is public and HEAD matches.

**Acceptance:**
- **P00.C1:** Public repo URL/visibility and owner confirmed; local checkout has origin and published main branch.
- **P00.C2:** Plan, F01–F30 inventory, full-game multi-user spec, version findings and AGENTS contract exist with no claimed application implementation.
- **P00.C3:** `pnpm plan:check`, `pnpm plan:status`, `pnpm test:plan` pass; the next task is unambiguous and all implementation phases remain pending.
- **P00.C4:** Staged/published files contain no private data, imported corpus, credentials, DBs or unrelated reference changes.

---

## P01 — Scaffold once; prove the pinned backend

**Files:** create `src/routes/{+layout.ts,+layout.svelte,+page.svelte,display/+page.svelte}`, `src/app.css`, `src/lib/backend/{client,realtime}.ts`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `components.json`, `src-tauri/{Cargo.toml,tauri.conf.json}`, `backend/config/`, `backend/functions/`, `scripts/dev.mjs`, `tests/unit/`, `tests/backend/capabilities.test.ts`, `docs/evidence/P01.md`; update package/lockfiles, STACK and ARCHITECTURE.

### P01.T1 — Resolve compatible stable versions and scaffold

Recheck `pnpm view` versions/peers, Tauri stable release and supported Node/Rust toolchains. Pin the compatible combination and lock it. Use SvelteKit static adapter with `ssr=false`, fallback index.html, strict TypeScript, Svelte 5 runes and shadcn-svelte/Tailwind Vite integration. No application SvelteKit server. Add check/lint/build/test:unit commands and basic routing/theme/accessible button smoke. Initialize Tauri against the same build; default native route `/display`. Keep Tauri calls behind runtime guards so browsers never invoke native-only APIs.

### P01.T2 — Prove TrailBase contracts in a throwaway owned depot

Write failing contract probes for fresh migrations, CRUD return values, filtered SSE create/update/delete, auth login/refresh/logout, JSON/UUID/timestamp serialization, generated schema and authorization denial. Start installed `trail` on a private loopback port/depot. Use the exact pinned examples to build one minimal authenticated WASM operation and prove transaction/CAS behavior before selecting the mutation mechanism. Capture actual CLI flags, depot paths, config format and component version. Check SSE framing/cleanup/reconnect rather than trusting stream availability alone. Dispose of the spike's data without touching a real dev depot.

### P01.T3 — Resolve behavioral/API decisions and bootstrap safety

Record decisions for verification-first signup, first-answer semantics, display identity expiry/re-pair, controller-offline timer policy, late team changes and back/reveal boundaries. Inspect fresh reference code/live behavior as needed, using approved test accounts only for live writes. Add one safe dev launcher with health/schema readiness and child-process ownership. Pin CI TrailBase release artifact URLs/digests; verify current installed version and downloaded target binary. Do not silently upgrade Rust or global tools—document required setup.

**Acceptance:**
- **P01.C1:** `pnpm check && pnpm lint && pnpm test:unit && pnpm build` exits 0; deep links and `/display` render without Tauri globals in a browser.
- **P01.C2:** `pnpm test:backend -- capabilities` runs real v0.33.14 and proves CRUD/auth/filtered SSE plus cancellation and a denied request; no mocks.
- **P01.C3:** Minimal WASM build/authenticated mutation and atomicity probe pass on the installed binary; build/config/toolchain versions and artifact provenance recorded.
- **P01.C4:** Native dev shell loads the same static app on macOS; launcher owns/cleans its processes; P01 decisions are explicit with no unresolved architectural blocker.

**Expected checkpoint:** A small real foundation, not a game. Commit `chore: scaffold shared Svelte and pinned TrailBase foundation` after evidence is green.

---

## P02 — Data model, real authentication and authorization

**Files:** create `backend/migrations/main/`, `backend/config/{development,test,production}.textproto.example`, `backend/functions/src/{index,auth,commands}.ts` as needed, `src/lib/backend/{auth,records}.ts`, `src/lib/types/`, `src/routes/auth/`, `src/lib/components/ProfileDialog.svelte`, `tests/backend/{schema,auth,authorization}.test.ts`, `docs/API.md`, `docs/ACCESS.md`, `docs/evidence/P02.md`.

### P02.T1 — Define schema and safe API projections

Implement only the labelled **P02 design contract** in [ARCHITECTURE](../ARCHITECTURE.md), [API](../API.md) and [ACCESS](../ACCESS.md): strict columns/defaults/FK actions/indexes/JSON metadata, immutable history/audit, integer question PK plus unique source_id, separate private assignment/grade material and safe read-only projections. Apply baseline to two fresh depots, export insert/select/update schemas/types and prove convergence. No private collection/expand/SSE or legacy deleted AI/audio/event collections. P02 game/round/member/answer/state data is synthetic schema/ACL fixture data, not gameplay implementation.

### P02.T2 — Implement auth/profile flows

Use real TrailBase register/verification/login/refresh/logout/reset APIs and local SMTP settings. Build profile name and avatar upload/removal using proven APIs, with file validation at the server. Preserve role/join return targets safely (no open redirect). Set reactive auth state and origin-scoped session storage policy; clear tokens and active subscriptions on logout. Provide Google configuration/return route but no claim of real OAuth success without credentials. Implement selected display identity primitives without admin-in-browser or fake verified email.

### P02.T3 — Enforce and attack the access matrix

Execute ACCESS's actor × resource × operation matrix against real REST/Record, expand and filtered SSE. Deny forged identity/role/ownership/grade/key/score, cross-game access, private bank/assignment/file leaks and stale version/idempotency changes. Prove legitimate scoped reads and auth/profile/device commands; fixture-only membership/lock checks do not claim functioning P06 joins. Test FK mismatch, uniqueness races, partial updates and already-open streams on revocation. Bootstrap fixture admins only outside normal UI; no production test reset or relaxed fixture ACL.

### Pre-coding red checks

Each named check must **first fail against the current P01-only repository**, with an executable assertion for missing required behavior, then be implemented minimally in its owning P02 task. A wrapper usage error alone, mocked service, skipped test or document marker is not behavioral acceptance. ACCESS supplies named subcases/oracles; extend the existing backend runner's schema/auth/authorization selectors as their tests arrive, without starting P03/P05–P10 commands.

- **`schema-two-depots` — T1/C1:** two-fresh-depot migration/schema/generated-contract convergence; all column defaults/JSON/nullability/index/FK checks, integer question/source identity, immutable private-partner/history constraints, restart without reseed. Include `native-user-profile-linkage`: on each fresh marked local depot provision a genuine native user using synthetic account data with its ID omitted, assert the pinned `uuid_v4()` default produced UUIDv4, and successfully insert its profile bound to that unchanged ID; reject malformed IDs, well-formed foreign IDs absent from `_user`, and another existing user's ID bound to the wrong caller. Prove linked rows survive restart and schema/generated-contract convergence across both depots. Never alter the built-in auth schema.
- **`projection-rest-expand-sse` — T1/T3, C1/C3:** public/private leakage via REST/list/count/schema/filter/order, nested expand and actual filtered SSE; exact safe projections and already-open stream revocation, not client-filter-only isolation.
- **`auth-local-mail` — T2/C2:** register -> verification-pending -> resend -> real local-mail verification -> login -> reset -> login -> refresh -> logout/rejected refresh reuse. Confirm pinned native HTTP details, visible mail/logout transport failure and startup session validation. Google OAuth credentials/real success stay externally gated; local callback validation is not Google evidence.
- **`return-to-origin` — T2/C2:** validated same-origin relative return-to/join intent survives verification/login; reject open redirects, absolute/protocol-relative/double-encoded/backslash/control/userinfo targets and expired/nested intent.
- **`avatar-boundary` — T2/T3, C2/C3:** server MIME/actual bytes/size/dimensions/ownership validation, safe roster projection and protected file access; replacement/removal, old URL denial, stale-write winner retention and cleanup.
- **`device-claim-lifecycle` — T2/T3, C2/C3:** native anonymous refresh, one device identity, concurrent host claim CAS, HMAC hash/expiry/persistent rate limits (including unknown codes), release/reassign, lost local code, startup versus reconnect, irreversible refresh loss with explicit new pairing/no claim transfer.
- **`constraint-partial-races` — T1/T3, C1/C3:** uniqueness/FK/partial-update races, cross-game composite keys, permanent roster lock even after Back, exactly one expected-version winner/audit, second-write rollback, operation retry/mismatched payload/expired operation rejection.
- **`authority-forgery` — T3/C3:** forged user/host/game/device/role/ownership/grade/key/score/source labels; cross-game REST/expand/SSE and unrestricted private bank/assignment/file denial for every actor, including unrelated host and anonymous device. No admin/browser bootstrap.

These are acceptance-first implementation obligations, **not tests executed by the documentation remediation**. P02 remains pending/unstarted until the parent authorizes its implementation; criterion and task IDs below remain unchanged.

**Acceptance:**
- **P02.C1:** `pnpm test:backend -- schema` proves repeatable fresh migrations, constraints/indexes, JSON/type contracts and generated types on v0.33.14.
- **P02.C2:** `pnpm test:backend -- auth` proves register/verify/login/reset/profile/logout/refresh using actual auth and local mail; no plaintext credential storage in Git.
- **P02.C3:** `pnpm test:backend -- authorization` passes all permitted and denied actor cases, including unrevealed key/grade/expand/SSE checks and forged updates.
- **P02.C4:** `pnpm check && pnpm lint && pnpm build` passes; docs/API and ACCESS specify every exposed endpoint/table and device/auth decision. Google remains explicitly externally gated, not silently dropped.

---

## P03 — Import the original question corpus safely

**Files:** create `scripts/import_questions.py`, `scripts/verify_corpus.py` (or one file with subcommands if smaller), `tests/import/test_import.py`, `docs/DATA.md`, `docs/evidence/P03.md`; update package scripts and ignore rules. Actual depot, snapshot and manifest stay in `.local/`/`.artifacts/`.

### P03.T1 — Build source-safe import with a synthetic fixture first

Write a small synthetic PocketBase-shaped DB in the test temporary directory with Unicode, null/empty values, duplicate external_id cases and malformed rows. Implement explicit `--source`, `--depot`, `--dry-run`, existing-path validation, SQLite URI read-only open, safe snapshot via backup and destination ownership/lock checks. Source is never attached for writes. Import only questions using parameterized/batched operations and one deterministic unique source_id. Preserve all original fields exactly; report rather than silently coerce invalid records. Implement restart/idempotency semantics and source-change conflict handling.

### P03.T2 — Verify interruption, rerun and all-field preservation

Failing tests must cover missing source (creates nothing), malformed source (no partial false success), interrupted import, rollback/resume, duplicate rerun (no extra rows), Unicode/text fidelity and bad destination (refused). Produce a manifest with source snapshot count, canonical digest over all mapped fields ordered by source_id, target count/digest, distributions and error count. Document SQL engine differences and preserve source imported_at separately from target import time. Do not depend on unavailable TrailBase SQLite extension functions in Python's SQLite engine.

### P03.T3 — Import all actual questions locally and verify

Run dry-run, then real import from `~/dev/trivia-party/pb_data/data.db` into the owned local TrailBase depot, with source opened read-only and destination stopped. Record actual snapshot row count (591,183 observed at planning time, not an invariant), checksums, distinct category/difficulty distributions and no errors. Re-run import and prove no duplicates. Start TrailBase and retrieve representative questions through the real API. Keep the full corpus private; public CI runs the synthetic fixture only.

**Acceptance:**
- **P03.C1:** `pnpm test:import` passes missing-file, preservation, invalid-row, interrupted/resume, repeat and destination-safety cases.
- **P03.C2:** Dry-run reports the real source/destination without inserting rows; the actual import succeeds with source snapshot count equal to target imported count and zero unexplained rejected rows.
- **P03.C3:** `pnpm verify:corpus -- --source <snapshot> --depot <depot>` passes all-field canonical digests, distributions, SQLite integrity/FK checks and an idempotent rerun.
- **P03.C4:** Source was never opened writable and no private data is staged; API retrieval works after starting TrailBase. Store only sanitized counts/digests/commands in committed evidence.

---

## P04 — Real multi-user test harness before feature expansion

**Files:** create `playwright.config.ts`, `scripts/{test-stack,seed-test-data}.mjs` or typed equivalents, `tests/e2e/{fixtures,harness.spec,auth.spec}.ts`, `tests/fixtures/questions.json`, `.github/workflows/test.yml`, `docs/evidence/P04.md`; extend scripts introduced in P01/P02.

### P04.T1 — Own an isolated stack and deterministic fixtures

Implement the stack lifecycle and safety rules in TESTING: unique owned depot/ports, pinned real backend, local mail sink, same production schema/rules, original synthetic questions, bounded readiness, cleanup even on failure. Serial worker mode is acceptable initially; do not claim parallel isolation until tested. Add repeatable tests proving production URL rejection, foreign-directory cleanup refusal and no orphan processes.

### P04.T2 — Create independent browser actors and real auth tests

Build a fixture for H, A1/A2, B1/B2, X and D, each with separate BrowserContext. Drive normal actors' login through UI, assert distinct backend identities and no cookie/localStorage cross-contamination. Complete signup -> mail verification -> login -> reset -> login -> logout through the browser and local captured emails. Prove one actor changing authorized persistent profile data updates another authorized observer through genuine SSE. Do not substitute game simulation or mock events for this smoke.

### P04.T3 — Install reproducible diagnostics and CI

Add Chromium browser run, headed developer mode and failure traces per named actor, sanitized logs, retained artifacts and fail-on-unexpected-skip handling. CI uses exact backend artifact and locked dependencies, never local source DB or production URLs. Force one failing assertion to verify diagnostics and teardown, then restore and rerun green. Document using traces to iterate and replay seeds/run IDs.

**Acceptance:**
- **P04.C1:** `pnpm test:e2e -- --project=chromium` completes real signup/verification/reset/login/logout and isolated actor-identity assertions.
- **P04.C2:** Live authorized data/SSE changes cross distinct contexts; an unauthorized context cannot mutate them; no API/SSE mocks or token injection.
- **P04.C3:** Harness lifecycle/safety tests prove foreign target refusal, run isolation and cleanup after success/failure; CI artifacts explain an induced failure without exposing secrets.
- **P04.C4:** Plan, unit, backend and implemented E2E tests run reproducibly in CI. Full gameplay is still pending and is not represented by a skipped passing test.

---

## P05 — Host games, rounds and question selection

**Files:** create `src/routes/host/+page.svelte`, `src/lib/components/game/{GameEditor,RoundEditor,QuestionList}.svelte`, minimal setup services/handlers, `tests/e2e/{setup,questions}.spec.ts`, `docs/evidence/P05.md`.

### P05.T1 — Recreate game lifecycle setup

Write UI tests for own-game listing and sorting, create/edit/delete, name/schedule/location/duration, validation, unique code and setup/ready/completed statuses. Implement with shadcn-svelte dialogs/forms and normal-user backend credentials. Deep-link/reload preserves edits. Another host cannot change/delete the game. Destructive actions require confirmation and correct dependent-record policy.

### P05.T2 — Recreate round setup and order

Write tests for create/edit/reorder/delete, per-round counts, categories and level bounds. Implement atomic ordering to avoid duplicate sequences during swaps. Define errors for no rounds, zero eligible questions and invalid counts before start. Edit/delete actions must preserve intended used-history/cascade behavior from the source. Set all seven timer values as configuration; enforcement is P08.

### P05.T3 — Random selection, history and recycling

Write backend tests for random eligible selection, host history exclusion across games, no duplicates within a batch, full-corpus categories and insufficient pool. Prefer one parameterized SQL selection/assignment transaction rather than client full-table fetches or per-question sleeps. Persist permutation/private key per assignment and category snapshot. Recycle atomically replaces assignment while retaining retired used history. UI previews and count remain coherent; benchmark selection against the real imported corpus and record bounds rather than assume raw Rust makes inefficient queries free.

**Acceptance:**
- **P05.C1:** `pnpm test:e2e -- setup.spec.ts --project=chromium` passes real create/edit/reorder/delete/status/validation and reload persistence.
- **P05.C2:** `pnpm test:e2e -- questions.spec.ts --project=chromium` plus backend selection tests prove eligibility/history/recycle/insufficient-pool behavior.
- **P05.C3:** Actual imported corpus provides categories and selectable questions without loading the full corpus into the browser; timing/query measurements recorded.
- **P05.C4:** Type/lint/build/unit/backend/implemented E2E gates pass, with timer settings retained across edits and no cross-host mutation.

---

## P06 — Lobby, teams, profiles and presence

**Files:** create `src/routes/{lobby,join}/+page.svelte`, player route skeleton `src/routes/game/[id]/+page.svelte`, `src/lib/components/game/{TeamPicker,Roster,JoinCode,PresencePanel}.svelte`, presence state helper, `tests/e2e/{join,teams,profile,presence}.spec.ts`, `docs/evidence/P06.md`.

### P06.T1 — Code/QR join and active-game rejoin

Test a new browser following `/join?code=...` through auth and back to joining; valid ready/in-progress, invalid/empty/expired/completed codes, case handling and rate limits. Implement active games in lobby and leave/rejoin flows without duplicate membership. Generate actual QR payloads/copyable public links with proper backend-independent frontend origin. No localhost/tauri scheme in public join links.

### P06.T2 — Multi-user team/roster synchronization

H creates a game; four users log in and join through UI. A1 creates Alpha, A2 joins it; B1/B2 form Beta. Change teams and leave/rejoin, show player/team detail dialogs, update own profile/avatar and observe appropriate roster updates. Use the real shared backend and subscriptions. Enforce one user membership per game and correct team/game ownership; no game host impersonation from request fields.

### P06.T3 — Presence without relying on unload

Implement heartbeat + visibility + server timestamp/stale cutoff using one scoped row per required identity/game model. Test online, away, background, tab close with no beacon, stale recovery, multiple tabs and team rename/change. Clean up on navigation/logout; unsubscribing twice must be harmless. Presence data does not grant authorization. Decide documented heartbeat/cutoff values and test bounded convergence.

**Acceptance:**
- **P06.C1:** `pnpm test:e2e -- join.spec.ts teams.spec.ts --project=chromium` proves H + four distinct users, two teams, UI-driven join/change/leave/rejoin and live roster without refresh.
- **P06.C2:** QR decode/copy URL and auth return-to tests pass; invalid/closed games and spoofed membership are denied at backend.
- **P06.C3:** `pnpm test:e2e -- profile.spec.ts presence.spec.ts --project=chromium` proves profile updates, avatar validation, visibility/stale/tab cleanup and recovery.
- **P06.C4:** All prior gates pass; H2/X isolation tests remain green as access expands for legitimate players.

---

## P07 — Complete scored game through the actual UI

**Files:** create controller/player routes and `src/lib/components/game/{GameState,Question,RoundStart,RoundEnd,GameEnd,Thanks,NextQuestionPreview}.svelte`, `src/lib/game/{state,answers,scores}.ts`, minimal backend game commands, `tests/unit/{state,answers,scores}.test.ts`, `tests/e2e/{game,transitions,concurrent-answers,controller}.spec.ts`, `docs/evidence/P07.md`.

### P07.T1 — Persist and render the state machine

Test every forward/back/reveal/round/end boundary using the current reference and documented decisions. Implement versioned authoritative state and normal-host controls. All clients render shared views of game-start/round-start/question/reveal/round-end/game-end/thanks/return. Persist current permutation and state so reload doesn't reshuffle. Keep next-question/key preview host-private. Persist state before reporting success; invalid transitions return useful errors.

### P07.T2 — Accept one answer, reveal once, grade atomically

Write backend concurrency/authorization tests before handlers. The server checks game/team/current-question/deadline, accepts first valid team response under the approved rule, rejects spoofed grades/keys, and atomically reveals/grades or uses proven transaction semantics. Both teammates converge; opposing teams cannot see private answers early. Retries, duplicate reveals, backwards navigation and simultaneous host tabs cannot double count scores. Protect against answer-arriving-during-reveal races.

### P07.T3 — Run the deterministic two-round game

Implement TESTING's exact H + four player scenario and 3–1 scoring oracle with UI-driven setup/start/answers/reveal/end. Include X negative attacks, wrong answer and no answer, different teammates submitting each turn, persisted round/final scores. Positive gameplay uses no DB seeding of results, hidden JS helper or fake auth. Introduce `pnpm test:e2e:game`; make it blocking in CI. Until P09, record that display enrollment/cleanup coverage is not yet present; do not call this final app acceptance.

**Acceptance:**
- **P07.C1:** `pnpm test:unit` and backend command tests prove state boundaries, stable permutation, authorization, atomic grading and idempotency.
- **P07.C2:** `pnpm test:e2e:game -- --project=chromium --retries=0` completes 2 rounds x 2 questions with four distinct logged-in players; final scores Alpha=3/Beta=1 and round scores [1,2]/[1,0] on every applicable UI.
- **P07.C3:** Concurrent teammates/reveal races/duplicate host requests produce one accepted answer and one state transition; zero unrevealed key/grade leakage via REST/expand/SSE.
- **P07.C4:** Controller navigation/preview/counts and player feedback/reload work; all earlier gates pass and full-game CI is mandatory.

---

## P08 — Timer behavior and controller ergonomics

**Files:** extend game commands/state, create `src/lib/components/game/{CircularTimer,ControllerSettings,AllAnsweredNotice}.svelte`, `tests/unit/timers.test.ts`, `tests/e2e/timers.spec.ts`, extend controller tests, `docs/evidence/P08.md`.

### P08.T1 — Shared timer deadlines and pause/resume

Test mapping all seven metadata timers to presentation states including question vs revealed-answer durations. Server persists deadline/paused remainder/version; UI renders locally with no write per tick. Null/0 means no limit; reject invalid/negative/oversized input. Pause, reload, resume, expire and manual advance must use one authoritative version. Record behavior while controllers are absent and reconcile on return; no hidden assumption of continuous host connectivity.

### P08.T2 — All-answered notification and early reveal

Count eligible teams consistently with source behavior, including empty teams/late changes. Option off waits for manual/normal expiry. Option on and >3 seconds remaining (or no timer) produces a 3-second notification then a single reveal; <=3 seconds does not extend the remaining deadline. Paused state suppresses early advance. Race timer expiry, two hosts and final simultaneous answers; preserve at-most-once grading.

### P08.T3 — Keyboard, controller settings and timers in real games

Implement ArrowRight/ArrowLeft/Space with focus/input/modifier suppression and accessible controls. Persist QR/link toggles and text settings as appropriate. Tests run real short deadlines, pause across refresh, and timer/reveal transitions in multi-user contexts. Keep pure fake-clock math tests separate from real integration evidence.

**Acceptance:**
- **P08.C1:** `pnpm test:unit -- timers` and `pnpm test:e2e -- timers.spec.ts --project=chromium` cover seven timer types, null/0, question/reveal switch, expiry, pause/resume and restored countdowns.
- **P08.C2:** Early-reveal on/off/>3s/<=3s/no-timer/paused/zero-team and race cases pass with exactly one transition and no extra points.
- **P08.C3:** Countdown divergence stays <=1 second after sync in the local test; no tick writes; lost-controller policy is documented and tested.
- **P08.C4:** Keyboard/focus/controller setting persistence tests and the full scored game remain green.

---

## P09 — Display enrollment, pairing and shared rendering

**Files:** extend `src/routes/display/+page.svelte`, create `src/lib/state/display.svelte.ts`, `src/lib/components/game/{PairingCode,DisplayManagement,ConnectedDisplays,TeamRoster}.svelte`, backend claim/release command as needed, `tests/e2e/display.spec.ts`, extend `game.spec.ts`, `docs/evidence/P09.md`.

### P09.T1 — Device identity and claim/release lifecycle

Implement P01's proven scoped identity. Test startup/restart with valid auth, expired/unrecoverable device auth and safe re-pair. Generate six-digit code, bounded claim attempts/expiry and atomic assignment so two hosts cannot win. Implement host release, completion release, reassignment and startup policy matching source. Available public code does not grant general user/game access. Persist only device-scope auth in local storage/secure native storage as selected; never administrator credentials.

### P09.T2 — Shared screen renders every gameplay state

Use the same game components for the browser-testable display. Render readable roster, question/choices, answer reveal, round/final scores, countdown and all-answered notice. Propagate host-controlled display theme/settings. Test multiple paired displays, long text, a reconnect mid-question and notification timing. Show helpful disconnected/error states; don't masquerade stale data as live.

### P09.T3 — Add display to the blocking full-game test

The full-game suite now launches D in a separate BrowserContext, enrolls/pairs through UI, asserts roster/state/answer/score updates without reload, and verifies completion returns to a new pairing code. Run host + four players + display + outsider together. This is the first phase allowed to call the full required browser gameplay path feature-complete.

**Acceptance:**
- **P09.C1:** `pnpm test:e2e -- display.spec.ts --project=chromium` proves identity restart, claim race, invalid/expired code, scope denial, release/reassign and multiple displays.
- **P09.C2:** D sees every presentation state, timer/notification and exact score in the full multi-user game without mocked streams or refreshing to receive updates.
- **P09.C3:** Display completion/startup release and new code behavior passes; no credentials/key/answer leakage or arbitrary-game subscriptions.
- **P09.C4:** Full-game CI includes real D enrollment/pairing/cleanup and all earlier tests remain green.

---

## P10 — Recovery, accessibility and repeatable cross-browser games

**Files:** create `tests/e2e/{recovery,isolation,accessibility,visual}.spec.ts`, `scripts/repeat-game.mjs`, local corpus-game runner, extend Playwright projects/CI and realtime/auth helpers, `docs/evidence/P10.md`.

### P10.T1 — Break networks, restart backend, restore state

Test source rejoin/refresh scenarios across question, reveal, paused timer and round end. Disconnect individual browser contexts, close SSE cleanly, restart actual backend preserving depot, expire auth, navigate away/back, and advance from another host tab during the outage. On recovery reauthenticate/re-read/re-subscribe without lost updates or duplicate listeners. Test snapshot/subscribe race and access revocation. Add regression checks at the shared subscription/state boundary rather than patching every page.

### P10.T2 — Cross-browser/mobile/TV and accessibility

Run Chromium/Firefox/WebKit with independently sized role contexts. Test minimum 375px, representative mobile phones, tablet/desktop, 1080p/4K display, light/dark and long text/rosters. Test keyboard-only forms/dialogs/controls, touch targets, focus and errors. Use deterministic synthetic screenshots to approve functional layouts; never replace behavioral assertions with screenshots or claim pixel-perfect reference parity.

### P10.T3 — Repeated real games and imported-question smoke

Implement repeat runner with clean run IDs/depots and zero retries, failing on unexpected skips. Require 10 consecutive complete H+4P+D games in Chromium and complete games on Firefox/WebKit. Run one opt-in local full game selecting actual imported questions (not just listing rows); use the source answer text as a private test oracle and preserve shuffle correctness. Keep corpus screenshots/traces local. Record any flake as a bug and rerun the series after a fix.

**Acceptance:**
- **P10.C1:** `pnpm test:e2e -- recovery.spec.ts isolation.spec.ts --project=chromium` survives real backend restart and per-actor network loss, rejoin, expired auth, snapshot race and revoked access; state converges within 10s of readiness.
- **P10.C2:** Required browser/mobile/display projects and keyboard/accessibility/visual checks pass; no uncaught errors or hidden controls due to clipping.
- **P10.C3:** `pnpm test:e2e:repeat -- --runs=10` reports 10/10 complete real games with zero retries/unexpected skips; Firefox/WebKit each pass the complete game.
- **P10.C4:** `pnpm test:e2e:corpus` passes a real multi-user game using the privately imported corpus; evidence is sanitized and no original text/data is published.

---

## P11 — Native macOS and Android TV display applications

**Files:** extend `src-tauri/`, create `src/lib/platform/{window,updater,identity}.ts`, native control components, `tests/native/`, `docs/NATIVE.md`, `.github/workflows/native.yml`, `docs/evidence/P11.md`.

### P11.T1 — Real macOS shell features

Use supported Tauri window/menu APIs for fullscreen Cmd+F, monitor selection, borderless/resizable projector presentation and normal quit. Wrap only platform differences. Configure minimal capabilities and CSP/backend origin; no broad arbitrary remote IPC. Pair real packaged app with a browser-hosted game and verify actual state/score updates. Test close/reopen/reconnect and identity persistence. For multiple monitors, exercise real screen movement and scaling. No hardware => that criterion remains blocked.

### P11.T2 — Android TV app and remote navigation

Initialize the Android target using the compatible SDK/NDK/JDK. Configure TV launcher/leanback requirements, fullscreen, supported orientation, D-pad/OK/back behavior, focus indication, no desktop menu and graceful resume/network change. Install debug APK on an actual TV emulator/device and pair it to the same real backend while H and players run in browsers. Test long questions, roster and timer readability. Document reproducible emulator/device commands and required tool versions.

### P11.T3 — Build and update pipeline

Produce macOS/Android artifacts with synchronized app versions, installability and platform-correct download information. Integrate Tauri updater only on supported platforms (macOS here); Android uses the appropriate APK distribution path, not an assumed desktop updater. Prove update failure states and local signed fixture upgrade/relaunch without publishing release keys. Public signing/notarization and actual distributed upgrade remain owner-gated in P12. Separate automated native checks from explicitly evidenced manual checks; official macOS WebDriver limitations cannot be covered by saying browser WebKit passed.

**Acceptance:**
- **P11.C1:** Actual macOS packaged display pairs and completes a browser-hosted multi-user game, including fullscreen/menu/borderless/monitor movement and restart identity; record OS/arch/hardware.
- **P11.C2:** Android TV debug APK installs/launches, remote focus/back/fullscreen work and a real multi-user browser game updates it correctly after resume/network loss.
- **P11.C3:** Native build checks pass with minimal capabilities; browser mode still builds/tests without invoking native APIs; versions/download metadata agree.
- **P11.C4:** macOS local signed update fixture installs/relaunches and preserves pairing, invalid update/signature fails safely; publish signing keys absent from Git. Unautomatable native checks have explicit human evidence, not skips.

---

## P12 — Final parity, release and operations rehearsal

**Files:** create `docs/{OPERATIONS,ACCEPTANCE,RELEASE}.md`, `scripts/verify-release.mjs`, deployment/config examples, release CI, download route, `docs/evidence/P12.md`; reconcile all status/evidence and parity IDs.

### P12.T1 — Close every parity and external-service gate

Review F01–F30 against source and current live behavior; map each to a passing test/manual evidence and tested commit. Obtain owner Google OAuth credentials and approved callback URLs, configure outside Git, complete real Google login/return-to/profile/logout and negative callback tests. Validate production SMTP/verification/reset using controlled accounts. Confirm question and copied-asset redistribution rights and choose repository license with owner; keep full corpus private by default. No silent exclusions for missing credentials.

### P12.T2 — Rehearse deploy/backup/restore/upgrade safely

On an owner-approved isolated staging target, deploy pinned TrailBase plus built SPA using correct static deep-link/API handling and HTTPS/SSE reverse-proxy configuration. Restrict admin access, CORS/CSP, secret files and rate limits. Run full H+4P+D browser game against staging with explicitly approved synthetic users. Create consistent backup of database, objects and relevant secrets/config, restore to a separate instance and verify users/game state/avatars and schema. Prove migration and native client compatibility, document rollback via backup and artifact version, not unsupported down-migrations. Never practice destructive restore on reference production.

### P12.T3 — Run release gate and publish only with approval

`verify:release` aggregates all required unit/backend/import/E2E/corpus/native/parity checks and external blockers. Run complete browser matrix and ten-run flake gate for release candidate, inspect artifacts/security, build sign/notarize macOS and sign Android with owner credentials, verify download links and actual supported upgrade path. Keep release publication as a separate explicit owner action; a passing release gate is not publication permission. Record final source baseline and residual differences, then update status/handoff and tag only when authorized.

**Acceptance:**
- **P12.C1:** F01–F30 each has current passing evidence or an explicitly owner-approved scope change; no mandatory criterion is blocked/skipped. Google OAuth and verification/reset work against approved real services.
- **P12.C2:** `pnpm verify:release` exits 0 after all required commands and zero-skip checks, including full two-round multi-user browser game, real question import/game, native platforms and clean-build reproducibility.
- **P12.C3:** Isolated staging HTTPS/deep-link/SSE game and backup/restore/upgrade rehearsal pass; operations docs let a fresh operator reproduce them without chat history.
- **P12.C4:** macOS/Android release artifacts, signatures, download/version links and supported update path verified; owner publication/license decisions recorded, public artifacts contain no private corpus/PII/secrets.

---

## Evidence and resume format

For each `docs/evidence/Pxx.md` record:

```text
Phase and task IDs:
Reference source commit / live observation version/date:
Tested application commit (or explicit pre-commit worktree content identity):
OS, browser versions, trail --version, Node/pnpm/Rust:
New acceptance test expected failure and command:
Commands run, UTC timestamp, exit codes, assertion summaries:
Artifact paths/digests or access-controlled CI URLs:
Each criterion ID -> exact check and outcome:
Review findings, fixes and residual risks:
Blocked criteria, required owner input, next exact action:
```

Record actual observations, never anticipated outcomes. Passing criterion status references this tracked, sanitized evidence. Raw local artifacts may expire; keep enough textual evidence/commands/seeds to reproduce. `plan:check` ensures structural consistency and presence, not truth. A new application-code change invalidates affected acceptance evidence until rerun; do not rely on a previous commit's green results.

Update HANDOFF on interruption even when no phase is complete. It must include active branch/commit, task, partial changes, failing command, known cause, next step, runtime processes/ports, and blockers. A clean restart should require only the repo, its documented toolchain and locally available question source.
