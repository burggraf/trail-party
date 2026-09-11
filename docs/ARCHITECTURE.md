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

Persist server-originated deadlines, remaining paused duration and phase version. Clients render countdowns locally; they must not write every tick. Manual next/back, timer expiry, early-reveal and duplicate host tabs must converge on one transition. Timers are not a reason to invent a distributed scheduler: begin with an active controller requesting an idempotent server-validated expiry, then reconcile expired state on reconnect. Define and test behavior while every controller is disconnected; do not silently promise unattended scheduling absent from the reference.

Seven timer settings: game_start, round_start, question, answer, round_end, game_end, thanks. Null/zero disables a timer. Auto-reveal when all teams answer is configurable; the reference uses a three-second notification only when more than three seconds remain, and does not trigger while paused. Count registered eligible teams, not currently visible players; verify zero teams and late joins.

## Auth and device identity

Email/password signup, verification, login, reset, profile name/avatar and logout use real TrailBase auth. Retain return-to/join-link intent across login. Google OAuth uses real configuration and a credential-dependent acceptance gate; local controlled OAuth-provider testing may validate callback logic but cannot prove Google success.

The current reference auto-logs in before email verification, while TrailBase does not. Preserve the user's ability to register and join, with a clearly documented verification step; do not weaken TrailBase security to copy this detail. Confirm that interpretation in P01's behavior decisions.

The reference creates fake-email device accounts; do not copy that trick. P01 must prove anonymous device identity renewal/re-pair or a minimal durable device enrollment mechanism under the fixed version. Losing an expired identity may require re-pair, but app restart with valid credentials must preserve identity. Session TTL/garbage collection is explicitly tested and documented. Never put admin tokens or arbitrary user-creation powers in the display bundle.

## Corpus import

Run only after schema P02 exists. The current known source has 591,183 questions (a local observation, not a hard-coded future count). Preserve every source field: id as source_id, external_id, category, subcategory, difficulty, question, answer_a/b/c/d, level, metadata, imported_at. Preserve source text without trimming/normalizing/reinterpreting it. `answer_a` remains original correct answer; shuffling is an assignment concern.

Use Python stdlib sqlite3 for read-only source + SQLite backup and batched prepared imports, provided the destination schema requires no unavailable TrailBase-only SQL functions. If it does, import through a version-proven backend-supported path; never disable constraints or write through a missing UUID function. Prefer simple integer question keys to make offline import standard SQLite-compatible.

Destination must be an explicitly selected stopped local depot with ownership marker. Dry-run validates schema/source, reports exact counts and bad rows; real import is transactional or journaled with a deterministic resume key. Unique source_id makes reruns idempotent; changed source rows need an explicit update policy, not silent overwrite. Compare canonical field digests keyed by source_id, count, category/difficulty distribution and foreign-key/integrity checks. Fail on malformed rows with a report rather than dropping them. Copy no other tables. Never commit corpus, snapshot, artifacts or questions of uncertain redistribution rights.

## Test and deployment boundary

Every implementation phase extends real backend and browser tests. `docs/TESTING.md` is binding. CI uses synthetic, original questions; a separate required local corpus gate checks the full private import. Identical migrations/Record APIs/handlers run in development, tests and production with configuration-only differences.

Browser production uses built static assets, preferably served by `trail run --public-dir ... --spa` or nginx static fallback; API/realtime paths must never be rewritten to index.html. Tauri bundles those assets and connects to its configured backend, not an embedded PocketBase or per-device database. Use HTTPS and precise production CORS/CSP. Native updater keys, OAuth/SMTP configuration and signing remain outside Git.
