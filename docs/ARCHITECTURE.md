# Architecture and decisions

## Chosen approach

One **SvelteKit static SPA** uses Svelte 5, TypeScript, shadcn-svelte and Tailwind 4. Browser routes provide landing/auth, host setup, lobby/join, player, controller, downloads and display. Tauri loads the same `/display` route on macOS and Android TV. TrailBase v0.33.14 is the only application backend; SQLite stores authoritative state. No PocketBase runtime or compatibility shim.

Alternatives considered:

1. **Shared static SPA + Tauri (chosen):** existing web/browser flows and native displays share code; Playwright exercises the actual application UI. SvelteKit supplies routing without inventing a router.
2. Separate web/display Svelte applications: closer to current structure, but duplicates code, fixtures, auth and visual states. No demonstrated need.
3. SSR SvelteKit server + TrailBase: adds another production service and server-bound routes incompatible with the static Tauri bundle. Unnecessary for this exercise.

This document defines implementation direction, not unverified backend APIs. Resolve pinned-version questions in P01 before building feature layers.

P01.T1 implements only the shared static shell: `/`, honest `/auth` entry placeholders and `/display`, with shadcn controls and mode-watcher theme persistence. No auth authority is derived from the role query parameter. Tauri starts `/display`, bundles the same `build/`, grants no frontend native permissions, and invokes no native JS API; guarded platform modules will be added only when needed. Browser shell checks use Playwright with installed Chrome and a generic static preview server (no Kit SSR runtime); seven-context theme isolation is not backend/auth/SSE proof. The future data/API sections below remain unimplemented.

## Proposed paths (created by their implementation phases)

```text
src/routes/                       # SvelteKit page routes, no +server or server actions
  +page.svelte                    # landing
  auth/                          # login/signup/verify/reset/OAuth return
  host/                          # games and setup
  lobby/                         # join/rejoin
  join/                          # code/QR deep link
  game/[id]/                     # player
  controller/[id]/               # host controller
  display/                       # web + Tauri display
  download/                      # native releases
src/lib/
  backend/{client,auth,records,realtime}.ts
  state/                         # small Svelte rune state by active role/session
  game/                          # pure state/score/answer contracts
  components/ui/                 # generated shadcn-svelte components
  components/game/               # shared visual states
  platform/                      # guarded web/native operations only
src-tauri/                       # native shell, capabilities, icons, Android config
backend/
  config/                        # sanitized configuration templates
  migrations/main/               # SQL baseline + append-only changes
  functions/                     # small TrailBase TS WASM handlers + lock/build config
scripts/                         # lifecycle, import, verification
tests/                           # unit, backend, import, E2E and native checks
```

`tests/unit`, `tests/backend`, `tests/e2e`, `tests/fixtures`, `tests/native`. Runtime depots, generated credentials and downloads live in ignored `.local/` or `.artifacts/`. Version SQL/config outside writable depots and copy it into each owned runtime instance through a deterministic bootstrap command.

## Data model

Use explicit strict SQL tables; application IDs should be UUIDs, with the exception of efficient integer question IDs if P02 proves this cleanly. Keep PocketBase question IDs only as a unique `source_id`, not as TrailBase Record API primary keys. Relate identity columns to built-in `_user` using its native representation. Do not mutate built-in auth schema.

| Data | Purpose / invariants |
|---|---|
| `profiles` | User display name and avatar reference; separate from auth identity; safe roster projection |
| `questions` | Imported corpus, source_id unique, original fields preserved, host-only authoring access; original answer_a is correct |
| `games` | Host, unique 6-character join code, schedule/location/duration, status, timer settings, versioned current state |
| `rounds` | Game FK, title/categories/count/order; ordering unique within game |
| `game_questions` | Assigned question, sequence, persisted answer permutation/key; retired assignments retain used-question history |
| `game_teams` | Team names and game FK |
| `game_players` | User/game/team membership, one membership per game/user; safe profile snapshot if required |
| `game_answers` | One accepted answer per game-question/team, translated label and grade controlled by backend; FK and uniqueness |
| `displays` | Device identity, claiming code, available/claimed state, host/game, theme settings; race-safe claim/release |
| `online` | User/game activity heartbeat, server timestamps, stale-presence cutoff |

Start from a clean schema, not the 93 historical PocketBase migrations. Use FKs, uniqueness, CHECKs, null semantics and timestamp triggers where supported. Full table/column contract, generated types, indexes, cascade policy and access matrix are P02 outputs.

Existing JSON state is a behavioral reference, not an obligation to reproduce redundant data. Persist enough to reconstruct current game, round, question, reveal, scores and timer after any reload. If scores are materialized, updates and re-grading must be idempotent and atomic; never increment twice.

## Authority and game commands

Record APIs handle normal CRUD. Small authenticated backend commands are justified for:

- choosing/recycling unused random questions with preserved history;
- joining/changing team if multi-record validation cannot be expressed safely by Record ACLs;
- starting, moving next/back, revealing/grading, completing, and pausing/resuming a game;
- submitting one team answer at a question boundary;
- claiming/releasing a display without a concurrent takeover.

Do not build every possible endpoint up front. Establish the smallest tested set at each phase. Use SDK transactions/SQL constraints first where they safely cover the operation.

Transitions carry an expected state version and operation identity; conflicts return authoritative current state. Repeated requests/retries do not create duplicate questions, answers or scores. Check current host/membership/device authorization on the server, not an asserted role. Parameterize SQL, bound request sizes and code-attempt rates, and keep ownership fields immutable to ordinary clients.

Before reveal, player/display responses contain question text and shuffled choices only. Correct answer, original position, shuffle key and grading results remain private. Authoring access can expose the bank to a host creating their own game, but being a host elsewhere must not authorize another host's control endpoints. Explicitly test all read paths including SSE and expansion.

## Realtime and timers

One small subscription helper owns stream cancellation, reconnect with bounded backoff and fresh auth, then re-reads authoritative state after reconnect or loss. Subscriptions are scoped to the active game/team/device. No full question-bank subscriptions. A snapshot/subscription race must not miss an update: subscribe/buffer then snapshot and reconcile by version, or prove an equivalent ordering strategy.

Persist server-originated deadlines, remaining paused duration and phase version. Clients render countdowns locally; they must not write every tick. Manual next/back, timer expiry, early-reveal and duplicate host tabs must converge on one transition. Timers are not a reason to invent a distributed scheduler: an active controller requests an idempotent server-validated expiry. P01-D4 below fixes the offline/reconnect policy; there is no unattended scheduling.

Seven timer settings: game_start, round_start, question, answer, round_end, game_end, thanks. Null/zero disables a timer. Auto-reveal when all teams answer is configurable; the reference uses a three-second notification only when more than three seconds remain, and does not trigger while paused. Count registered eligible teams, not currently visible players; verify zero teams and late joins.

## Auth and device identity

Email/password signup, verification, login, reset, profile name/avatar and logout use real TrailBase auth. Retain return-to/join-link intent across login. Google OAuth uses real configuration and a credential-dependent acceptance gate; local controlled OAuth-provider testing may validate callback logic but cannot prove Google success.

P01-D1 approves verification-first signup rather than the reference's immediate login. P01-D3 selects anonymous display identity, stable refresh and explicit re-pair after irreversible expiry. T2 proves anonymous refresh retains identity; browser/native persistence, pairing and expiry remain P02/P09/P10 work. Never put admin tokens or arbitrary user-creation powers in the display bundle.

## Corpus import

Run only after schema P02 exists. The current known source has 591,183 questions (a local observation, not a hard-coded future count). Preserve every source field: id as source_id, external_id, category, subcategory, difficulty, question, answer_a/b/c/d, level, metadata, imported_at. Preserve source text without trimming/normalizing/reinterpreting it. `answer_a` remains original correct answer; shuffling is an assignment concern.

Use Python stdlib sqlite3 for read-only source + SQLite backup and batched prepared imports, provided the destination schema requires no unavailable TrailBase-only SQL functions. If it does, import through a version-proven backend-supported path; never disable constraints or write through a missing UUID function. Prefer simple integer question keys to make offline import standard SQLite-compatible.

Destination must be an explicitly selected stopped local depot with ownership marker. Dry-run validates schema/source, reports exact counts and bad rows; real import is transactional or journaled with a deterministic resume key. Unique source_id makes reruns idempotent; changed source rows need an explicit update policy, not silent overwrite. Compare canonical field digests keyed by source_id, count, category/difficulty distribution and foreign-key/integrity checks. Fail on malformed rows with a report rather than dropping them. Copy no other tables. Never commit corpus, snapshot, artifacts or questions of uncertain redistribution rights.

## Test and deployment boundary

Every implementation phase extends real backend and browser tests. `docs/TESTING.md` is binding. CI uses synthetic, original questions; a separate required local corpus gate checks the full private import. Identical migrations/Record APIs/handlers run in development, tests and production with configuration-only differences.

Browser production uses built static assets, preferably served by `trail run --public-dir ... --spa` or nginx static fallback; API/realtime paths must never be rewritten to index.html. Tauri bundles those assets and connects to its configured backend, not an embedded PocketBase or per-device database. Use HTTPS and precise production CORS/CSP. Native updater keys, OAuth/SMTP configuration and signing remain outside Git.

## P01 approved behavioral decisions (specification, not implemented gameplay)

Owner-approved through the supervisor, 2026-09-11. Reference paths/line ranges below are relative to read-only `~/dev/trivia-party` at **442890dda579c6cb108d2f4851816e4388207627**; no live behavior or production mutation is claimed. TrailBase sources are pinned to **3f965de7ea516c43a54ca70a495e97f0c6d991ab**. PARITY maps each decision to future executable acceptance. These decisions resolve P01 ambiguity, not P02–P10 implementation.

### P01-D1 — Verification-first signup

Register, retain a validated same-origin return-to/join intent, then show **verification-pending** with resend/retry. No authenticated application session until verification succeeds; normal login restores intent. Mail-delivery failure is visible/recoverable, not success merely because an account exists. Verify actual local mail, link, resend, login, reset and safe return-to in P02/P04.

Source: `src/pages/AuthPage.tsx:121-152` requests verification, swallows mail failure and immediately logs in. That auto-login is intentionally reconciled with pinned [SDK client.ts:209-216](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/crates/assets/js/client/src/client.ts#L209-L216): email registration does not sign in until verified. Do not weaken identifier/verification policy.

### P01-D2 — First valid team answer wins

The server atomically accepts the **first valid** answer per current unrevealed game-question/eligible team from a current team member. Invalid, unauthorized or stale attempts never reserve the slot. Same operation identity retries are idempotent; a later different answer conflicts and returns/points to the authoritative accepted answer. Simultaneous teammates converge. Accepted answer, attribution and stored permutation never change on back/reveal/reconnect. Client-supplied grade, translated answer, score, host/team ID or key is not authority.

Source: `src/components/games/RoundPlayDisplay.tsx:186-201,248-277` locks UI after one answer; `src/pages/GamePage.tsx:228-288` synchronizes teammates. `src/lib/gameAnswers.ts:108-161` nevertheless read-then-creates/updates and calculates a client grade. `pb_migrations/1761489194_updated_game_answers.js:1-10` has the unique team/question index; `1761844722_updated_game_answers.js:1-16` makes updates host-only. Editing/races/client grading are defects, not intentional answer-edit parity.

### P01-D3 — Anonymous display identity and re-pair

Use TrailBase anonymous identity, not fake email/password users. Persist SDK tokens in platform-appropriate local storage; validate/refresh before device-record work. Valid refresh retains identity (real T2 probe `tests/backend/capabilities.test.ts:162-179`). Actual application startup intentionally releases a claim and shows the existing valid code without changing identity. Transient reconnect does not release. Ordinary startup/release retains valid code; completion, explicit code-expiry policy or new identity rotates it.

Only definitive **unrecoverable** auth loss (pinned SDK refresh 401 clears auth) creates a new identity/code and requires new host pairing; never transfer the old claim. Network refusal, timeout, 5xx or SSE loss retains identity and retries/reconciles. Claim/release are atomic authenticated commands. Configure anonymous refresh TTL and stale anonymous/display cleanup; pinned default is 90 days, not a hard-coded production promise.

Source: display `trivia-party-display/src/contexts/DisplayContext.tsx:84-160,219-257,292-344` persists identity, releases at startup and rotates at completion but over-broadly clears credentials on 400. `src/components/games/DisplayManagement.tsx:86-108` has a race-prone query/update claim. Pinned [client.ts:685-715](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/crates/assets/js/client/src/client.ts#L685-L715) and [config.proto:101-126,204-220](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/crates/core/proto/config.proto#L101-L126) define irreversible loss, TTL and cleanup. Fake credentials/permissive claim are repaired, not preserved.

### P01-D4 — Controller-only expiry, no offline catch-up

Persist server-originated deadline and phase version; clients render locally, with no tick writes. Only an active authenticated controller requests expiry. Server checks current version, phase, unpaused status and expired deadline, then performs one idempotent transition. With all controllers offline, countdown reaches zero and authoritative state remains unchanged indefinitely; players/displays never advance it. First controller load/reconnect requests exactly one current-version expiry; the next phase gets a fresh deadline from transition time. There is **no offline catch-up** through multiple phases. Duplicate tabs/manual-next versus expiry use expected-version CAS; loser resnapshots.

Source: `src/pages/GamePage.tsx:460-474` and display `components/GameDisplay.tsx:89-105` render only. `src/pages/ControllerPage.tsx:878-902` alone calls next on expiry. Retain that authority split, repair unversioned client races; do not add an unattended scheduler.

### P01-D5 — Permanent roster/team lock at first in-progress transition

Membership/team choice is mutable only while `ready` at `game-start`. The first transition to `in-progress` atomically locks roster/team assignments. Existing members may rejoin; reject new players and every team change after lock on all routes. Presentation back to game-start **never unlocks** membership. A hypothetical reopening would require a separate explicit lifecycle operation, not navigation. Accepted answers remain attributed to their immutable accepted team; no transfer.

Source: ready-only Change Team `src/components/games/states/GameStart.tsx:50-72`, start status `src/pages/ControllerPage.tsx:649-666`, existing-member rejoin/new-player rejection `src/pages/LobbyPage.tsx:64-88` and `e2e/rejoin-in-progress.spec.ts:4-8,51-95`. `src/pages/JoinPage.tsx:37-65` omits the in-progress guard: a source-observed direct-link bypass, not observed live behavior. Chosen option A repairs it. Late join eligible-next-question (B) or immediate join/transfer (C) were rejected as unsupported complexity.

### P01-D6 — Back uses the contextual predecessor

| Current presentation | Approved Back target |
|---|---|
| `game-start` | Disabled |
| First `round-start` | `game-start` |
| Later `round-start` | Previous round's `round-end` |
| Q1 unrevealed | Current `round-start` |
| Qn unrevealed, n > 1 | Q(n-1), unrevealed |
| Qn revealed | Same Qn, unrevealed |
| `round-end` | That round's last question, revealed |
| `game-end` | Final `round-end` |
| `thanks` | `game-end` |
| completion / return-to-lobby | Terminal; cannot reopen |

Every backward transition clears the active timer. Forward creates only the normal fresh resulting-phase timer. Accepted answers, permutation, private grades and aggregate scores stay stable; re-reveal cannot grade/score twice. Hiding reveal removes key/grade details from current player/display projections but cannot undo human knowledge. Returning to game-start does not change lifecycle or roster lock.

Source: `src/pages/ControllerPage.tsx:793-854` implements same-question hide/previous-question hide and clean writes without timers. Its enum fallback `:858-864` loses context: forward `:630-643,717-745` drops question/round fields. Contextual predecessor (A) repairs incomplete/wrong-round states; disabling all boundary Back (B) or copying broken enum order (C) were rejected. `src/lib/scoreboard.ts:44-180` recalculates from accepted graded answers rather than incrementing on each reveal. This boundary table is an explicit target decision, not a claim the broken source boundary works.

## P01 local launcher and release setup

`pnpm dev` owns TrailBase plus installed Vite's JavaScript server in one Node lifetime, retaining Tauri's existing `beforeDevCommand` and shared `/display`. No pnpm/Vite child tree, gameplay schema, WASM fault endpoint or automatic install. `backend/config/development.textproto` and the single append-only readiness migration are source-controlled; a new public read-only API nonce each start exposes only `{id:1,schema_version:1}`. Readiness requires that owned child alive, health, this schema/instance row, then Vite `/display` HTML. This is migration/bootstrap readiness, not application auth/gameplay acceptance.

Default depot `.local/dev/depot` persists on stop. Overrides must be direct named children of `.local/dev/`; existing unmarked/wrong-owner paths, external targets, root/marker/depot-tree symlinks and file hardlinks are refused. An exclusive sibling `.lock` covers creation through awaited cleanup; a stale lock is not automatically stolen (inspect processes before manual recovery). Port/host/version preflight occurs before depot writes. Only `127.0.0.1` and decimal ports 1–65535 are accepted. Occupied ports fail without signaling listeners. Normal stop, SIGINT/SIGTERM/SIGHUP, startup/child failure close Vite and terminate only the created TrailBase process group, with 5s escalation; depot data is never reset. Uncatchable SIGKILL/machine loss may require explicit stale-lock recovery. This is cooperative local ownership, not a sandbox against a hostile same-UID process changing files concurrently.

Backend stdout/stderr go only to exclusive mode-0600 ignored `.artifacts/p01-t3/dev/run-*/trail.log`; terminal errors disclose sanitized status/paths, never credentials. Logs/depots must not be served by Vite or published. `pnpm test:bootstrap` uses real successful stacks, persistent SQLite restart and narrowly injected negative children; synthetic test workspaces alone are removed.

Explicit setup: `node scripts/setup-trailbase.mjs`, then add its printed `.local/tools/trailbase-v0.33.14-<platform>-<arch>` directory to PATH. Requires Node and `unzip`; supports actual macOS arm64/Linux x86_64 only, refuses destination overrides/existing installs/cache substitution. Shared `scripts/trailbase-releases.json` pins official URLs, sizes, SHA256, full source and SQLite. Download bytes are verified before extracting only the expected `trail` member into a fresh private directory; execute/assert the exact version before installation. No global install/upgrade, floating installer or binary cache reuse. The manifest's short CLI source identifier maps to the independently checked official full tag commit. Linux CI uses this same command and frozen dependencies; local Mac execution is not Linux/native-window evidence. C4 stays pending parent native/remote-CI acceptance.
