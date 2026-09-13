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

<a id="p02-design-contract--data-model-not-implementation"></a>

## P02 design contract — data model and current T1/T2 boundary

This contract replaces the preliminary table sketch. P02 remains in progress, not phase-accepted: T1 migrations/projections and the narrow T2 native auth/profile/return-to subset now exist, while P02.T3 authorization, avatars/devices and gameplay remain pending. [API](API.md) defines the closed endpoint/projection inventory; [ACCESS](ACCESS.md) defines every actor/operation and named negative check. P01 capability fixtures are not application permissions. P02 creates schema/constraints and synthetic security fixtures; P03 imports questions; P05 populates setup/assignment/history; P06 adds joining/teams/presence; P07 adds answers/state/grading; P08 adds timers; P09/P10 add complete display/recovery behavior. Do not implement those later commands merely to seed a P02 test.

### Common column, FK and generated-contract rules

All tables are SQLite `STRICT`. The notation below is exhaustive: `T=TEXT`, `I=INTEGER`, `R=REAL`, `U=BLOB` containing a 16-byte UUID; `U_app` and `U_native` refine `U`. Every column is `NOT NULL` with **no default** unless `?` (nullable, SQL default NULL), `=value`, `PK`, or a shared group explicitly says otherwise.

- Application-generated `U_app PK` is NOT NULL, defaults to `uuid_v7()`, and has `CHECK(is_uuid_v7(id))` (use the actual PK column name). Shared/FK application primary keys retain the UUIDv7 check but have no UUID default.
- Inherited `U_native PK` is NOT NULL, has no default, and uses `CHECK(is_uuid(id))` with an FK to `_user.id`. It accepts the pinned native UUIDv4 default (`uuid_v4()`), not a UUIDv7-only restriction. Never alter the built-in auth schema to fit application IDs.

User IDs are inherited native `_user.id` BLOBs, never application-generated IDs or an email/role. UUID JSON is padded URL-safe Base64, not UUID text. Questions use positive integer PKs, not UUID functions.

Shared group **M** expands to `created_at I=unixepoch()`, `updated_at I=unixepoch()`, `version I=0 CHECK(version>=0)`. Shared group **A** expands to `created_at I=unixepoch()` only. All server times are Unix seconds, `CHECK(time>=0)` when non-null. Clients cannot set these columns. Successful logical mutations set updated_at from server time and increment version exactly once using expected-version CAS in the same transaction; timestamp is not an ordering token. SQL immutability guards reject PK/created/ownership changes. Handler writes own version/time increments (no second increment from a timestamp trigger); direct client writes are disabled. Maintenance must obey the same invariants. Integer booleans have `CHECK(value IN (0,1))`; generated TS must not silently assume boolean serialization until proven.

**Every FK is `ON UPDATE RESTRICT`; `ON DELETE RESTRICT` unless the specific table says CASCADE.** Composite FK targets have the stated UNIQUE keys. Add an index on every non-PK child FK tuple (unless an existing index has that prefix); additional hot-query/unique indexes appear below. No cross-table CHECK fiction: cross-row invariants use composite FKs plus SQL triggers/transaction checks. For optional composite references, nullable identity components must be all-null or all-present; their non-null game-scope column stays populated. CHECKs require any dependent identity (for example assignment -> round) to be present, rather than permitting SQLite's NULL bypass. Mutable gameplay parents use soft deletion/retirement; no user-facing hard purge endpoint in P02.

**Generated insert/select/update contract:** for every table, derive an internal select shape containing exactly the listed columns, insert requiring every non-null/no-default column, update a partial shape (omission differs from explicit NULL). M/A/server/FK/default fields are not writable just because an inferred schema includes them. Export `trail --depot <owned> schema <api> --mode insert|select|update` for each configured public API. For server-only tables, compare SQL introspection and server-internal types; do not configure a private Record API just to generate a schema. P02.C1 must pin inferred UUID/JSON/null/default/boolean/file behavior on two fresh depots; if CLI table-name inference works without exposure, use it only locally. Public API insert/update types are **never usable mutations** (all denied); handler inputs are separate exact allowlists in API. No private generated type/data is imported by the static bundle.

Application JSON columns use `CHECK(jsonschema_matches('<schema>', column))`, not only `is_json`. Closed objects reject unknown keys; SQL defaults include required keys, since JSON Schema defaults do not populate values. Definitions below specify complete JSON schemas in compact form: an object lists its required keys and has `additionalProperties:false`; arrays have typed items. Source question metadata is deliberately raw TEXT, not application JSON. The native file metadata exception is described under profiles. No legacy AI/audio/event collections; `audit_events` is a security/idempotency ledger, not an event bus.

### Table: `profiles`

| Columns | Constraints / ownership |
|---|---|
| `id U_native PK` (no default; `CHECK(is_uuid(id))`; FK `_user.id`), `display_name T`, M | `length(trim(display_name)) BETWEEN 1 AND 80`; server binds id to verified caller. ON DELETE CASCADE from user; id immutable. |
| `avatar_file T?`, `avatar_mime T?`, `avatar_bytes I?`, `avatar_revision I=0` | All three nullable fields absent together or present together; revision >=0, increment on replace/remove. MIME is image/png, image/jpeg or image/webp; bytes BETWEEN 1 AND 5242880. |

Create/provision the native account before inserting its profile; inherit that existing ID unchanged. Profile creation rejects malformed IDs, well-formed foreign IDs absent from `_user`, and mismatched bindings to another existing user; FK existence does not replace verified-caller authorization.

`avatar_file` is private TrailBase native single-file metadata: `jsonschema('std.FileUpload', avatar_file)` (exact pinned registry name/extra validation arguments must be confirmed by `avatar-boundary`, not invented). Observed SDK FileUpload shape: required `objectstore_path:string`; optional nullable strings `filename`, `content_type`, `mime_type`. No caller-provided path/metadata accepted. Server validates actual bytes, MIME and size, rejects SVG/HTML, malformed images and excessive decoded dimensions (maximum 4096 per axis), and strips identifying metadata when supported by the proven image path; unsupported validation is a failing T2 gate, never client-only acceptance. Native file route/cleanup and WASM file integration remain first-red proof obligations.

Owner-only profile/avatar handlers atomically change the profile pointer/version plus audit. Upload to private temporary storage, validate, then CAS; failure retains the previous avatar and removes only the new owned temporary file. Replacement/removal makes the old URL unreadable immediately by current-pointer authorization; reclaim superseded/unreferenced files within 24 hours with retryable owned cleanup, never delete the current file on a failed CAS. No auth-table avatar or external image URL is used. Indexes: PK sufficient. No direct base Record API/expand/SSE. Read-only `profiles_public` alias excludes avatar_file/bytes and exposes only the safe roster columns in API; scoped SSE must prove the same exclusion. File bytes require a fresh authorized handler read, not a public object-store URL. Retention: profile lifetime, old-file cleanup as above.

### Table: `questions`

| Columns | Constraints / ownership |
|---|---|
| `id I PK`, `source_id T` | id >0, source_id nonempty UNIQUE; integer generated by SQLite or importer. |
| `external_id T?`, `category T`, `subcategory T`, `difficulty T`, `question T`, `answer_a T`, `answer_b T`, `answer_c T`, `answer_d T`, `level R?`, `metadata T?`, `imported_at T?`, `ingested_at I=unixepoch()` | Preserve source values including empty text/NULL, Unicode and source imported_at; do not trim, impose reference UI length limits, parse metadata or assume external_id unique. Level is source numeric, not text (reference migration 1764360710); malformed nonnumeric input fails import validation rather than coercion. Original answer_a is correct and private. |

No FKs, application JSON or update version. P03 owns offline source-safe insertion and explicit source-change conflict policy; rows referenced by history cannot be deleted. Indexes: UNIQUE(source_id), (category,difficulty,level,id), (subcategory,id). Retention: corpus lifetime. Generated internal contracts follow the common rule; no browser types containing original answer order. **No direct client collection**, expand, file endpoint or SSE, including ordinary hosts. P05 adds only scoped authoring/selection handlers, not a global bank feed.

### Table: `games`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK`, `host_id U FK _user.id`, `join_code T`, `title T`, `location T=''`, `starts_at I?`, `duration_minutes I=120`, M | host immutable and verified on server; join_code exactly six uppercase ASCII letters/digits UNIQUE; title trimmed length 1..120, location <=240, duration 1..1440. Server allocates collision-checked code. |
| `lifecycle T='setup'`, `roster_locked_at I?`, `roster_version I=0`, `deleted_at I?`, `completed_at I?` | lifecycle in setup/ready/in-progress/completed; roster_version >=0. in-progress/completed requires non-null permanent roster_locked_at; completed iff completed_at non-null. Cannot clear lock or regress lifecycle through Back. |
| `timers T` default all seven keys null, `auto_reveal I=0` | Closed JSON object: game_start, round_start, question, answer, round_end, game_end, thanks, each required integer 0..86400 or null. Null/zero disables. |

Indexes: UNIQUE(id,host_id), UNIQUE(join_code), (host_id,deleted_at,lifecycle,starts_at), (lifecycle,deleted_at). SQL guards preserve host, lock monotonicity, and frozen membership; later start atomically bumps game version and roster_version and sets lock. No base API; `games_host` exposes host-safe setup including code and settings to its host only; `games_public` excludes code/timer configuration/deletion bookkeeping. Both are read-only with scoped SSE only after projection tests. No expand. Retention: soft-deleted history retained, no automatic game/history purge.

### Table: `rounds`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK`, `game_id U FK games.id`, `ordinal I`, `title T`, `question_count I=5`, `categories T='[]'`, `difficulty T?`, `level_min R?`, `level_max R?`, `deleted_at I?`, M | ordinal >=1, title trimmed length 1..120, question_count 1..100. JSON categories array of unique strings, maxItems 100 (empty means all); difficulty NULL or easy/medium/hard; min<=max when both set. Game immutable. |

Indexes: UNIQUE(id,game_id); UNIQUE(game_id,ordinal) WHERE deleted_at IS NULL; (game_id,deleted_at). RESTRICT protects assignments/history. Retention: soft-delete, retain referenced rows. Server-only base, no direct Record/expand/SSE in P02; safe current round title/ordinal is copied to public state in later transitions. P05 owns setup CRUD/reorder transaction; no P02 reorder endpoint.

### Table: `game_teams`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK`, `game_id U FK games.id`, `name T`, `deleted_at I?`, M | name trimmed length 1..80; game immutable. No team creation/deletion after roster lock; no reassignment. |

Indexes: UNIQUE(id,game_id); UNIQUE(game_id,name) WHERE deleted_at IS NULL (binary exact-name comparison); (game_id,deleted_at). Retention: soft-delete, RESTRICT from accepted attribution. Generated internal shape as above; read-only same-name Record API selects id/game_id/name/version/updated_at only, no direct C/U/D or expand; game-scoped SSE. Team-name editing after lock may be host-authorized in P06; this never changes membership or accepted team identity.

### Table: `game_players`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK`, `game_id U FK games.id`, `user_id U FK profiles.id`, `team_id U?`, `left_at I?`, M | UNIQUE(game_id,user_id) even after leave; immutable game/user identity. Composite (team_id,game_id) FK game_teams(id,game_id), NULL team permitted before selection only. |

Indexes: UNIQUE(id,game_id), UNIQUE(id,game_id,team_id); (game_id,team_id,user_id); (user_id,left_at,game_id). Same-game FK alone is insufficient: SQL guards/handlers reject a deleted team, first join unless ready/game-start, and every team change, new member or row deletion after permanent roster lock, even if presentation returns to game-start. Pre-lock membership changes bump roster_version with the game transaction. Leaving after lock affects left_at/presence only; registered eligible teams stay fixed, rejoin uses this same row/team. No arbitrary role column. Retention: row for game lifetime, RESTRICT. Read-only same-name API selects id/game_id/user_id/team_id/left_at/version/updated_at; scoped SSE, no expand or direct mutation. Full membership commands P06, accepted attribution P07.

### Table: `game_questions`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK`, `game_id U FK games.id`, `round_id U`, `ordinal I`, `question_text T`, `choices T`, `retired_at I?`, A | Composite (round_id,game_id) FK rounds(id,game_id); ordinal >=1. choices is a closed object with required A/B/C/D string values, no default. |

This is **public-shaped assignment content**, NOT the bank or a stored answer key: no source question ID, source order, correct label, permutation, grade or score columns. Indexes: UNIQUE(id,game_id), UNIQUE(id,game_id,round_id); UNIQUE(round_id,ordinal) WHERE retired_at IS NULL; (game_id,round_id,retired_at). Retain retired assignments; immutable content/order once accepted, recycle creates a new identity and retires the old one. No direct client collection/expand/SSE in P02 (future question schedules are private too). P07 publishes only the current text/choices through game_state_public. The id also references assignment_private(assignment_id) and used_question_history(assignment_id), each `ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`. Their UNIQUE/PK constraints make these one-to-one links. These reverse FKs require both partners by commit, including for retired assignments; insert the circular references in one transaction. Test this exact pinned SQLite contract, not a handler-only promise.

### Table: `assignment_private`

| Columns | Constraints / ownership |
|---|---|
| `assignment_id U_app PK FK game_questions.id` (no default), `question_id I FK questions.id`, `permutation T`, `correct_label T`, A | permutation: array, exactly 4 unique integers 0..3 mapping displayed A/B/C/D to source a/b/c/d. correct_label in A/B/C/D; transaction/trigger verifies it indexes the source-a position. |

One-to-one private storage; assignment creation must insert both halves and history in one transaction, never leave only a public half. Indexes: (question_id). Immutable after assignment, RESTRICT deletion, same retention as used history. Server-internal generated shape only. **No direct client collection**, expand or SSE; even host preview later uses an authorized command, never a base API. P05 owns assignment allocation; P07 owns use, not creation of new shuffles on reload.

### Table: `game_state_public`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK FK games.id` (no default), `phase T='game-start'`, `round_id U?`, `assignment_id U?`, `round_title T?`, `round_ordinal I?`, `question_ordinal I?`, `question_text T?`, `choices T?`, M | phase in game-start/round-start/round-play/round-end/game-end/thanks/lobby. Nullable composite (round_id,id) -> rounds(id,game_id), (assignment_id,id,round_id) -> game_questions(id,game_id,round_id). Assignment requires round; question fields/choices all present only in round-play; round phases require round title/ordinal. Ordinals >=1. Choices schema exactly as game_questions. |
| `revealed I=0`, `deadline_at I?`, `paused_remaining_seconds I?`, `all_answered_at I?` | paused remainder >=0; deadline and paused remainder cannot coexist. revealed=1 only in round-play. No key/grade/score JSON slot. |

Outside round-start/round-play/round-end, round_id/title/ordinal are all NULL; outside round-play, assignment_id/question fields/choices are all NULL and revealed=0. Within round-play all round/assignment/question fields are present. This prevents partial nullable composite keys from bypassing scope.

Indexes: PK and FK indexes. Server-only writes; read-only same-name API emits exactly these safe columns, scoped SSE, no expand. Public version is the game's committed version, not a separately racing clock; transition updates both once atomically. Retention: game lifetime, RESTRICT. P02 synthetic schemas/ACLs only; P07/P08 implement state, contextual Back, reveal and timer invariants. Future revealed key/grade/score output requires a separate authorized projection/handler design and tests; P02 exposes none even with revealed=1.

### Table: `game_answers`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK`, `game_id U FK games.id`, `assignment_id U`, `team_id U`, `accepted_player_id U`, `displayed_label T`, `accepted_state_version I`, `operation_id T`, A | FKs (assignment_id,game_id) -> game_questions(id,game_id); (team_id,game_id) -> game_teams(id,game_id); (accepted_player_id,game_id,team_id) -> game_players(id,game_id,team_id). Label A/B/C/D, state version >=0, operation_id canonical UUIDv7 text. |

Indexes: UNIQUE(assignment_id,team_id), UNIQUE(accepted_player_id,operation_id), (game_id,team_id,assignment_id). All rows append-only, RESTRICT. No translated source label, correctness or points here. P07 derives team/player/game from current authenticated membership, accepts first valid only, and stores immutable attribution in the same transaction; invalid/stale attempts cannot reserve a slot. Accepted choice/attribution is potentially public **to teammates and game host**, not opponents before reveal. No direct Record/expand/SSE in P02; P07 will add scoped output after tests. Retention: game lifetime, no automatic purge.

### Table: `answer_grades_private`

| Columns | Constraints / ownership |
|---|---|
| `answer_id U_app PK FK game_answers.id` (no default), `source_label T`, `is_correct I`, `points I`, `graded_state_version I`, `operation_id T`, A | source_label a/b/c/d, boolean is_correct, points 0 or 1 with points=is_correct, graded version >=0, operation UUIDv7 text. |

Immutable one-to-one grade, RESTRICT; no update on repeated reveal. Aggregate round/final scores are derived with SUM(points) over accepted answers, **no score table or incrementing client total**. Indexes: PK sufficient; query joins use answer indexes. No direct client collection, expand or SSE; all internal select/insert contracts only, update forbidden. P07 grading/reveal transaction must never score twice; retention equals answers. P02 seeds synthetic grades only to prove denial.

### Table: `used_question_history`

| Columns | Constraints / ownership |
|---|---|
| `id I PK`, `host_id U FK _user.id`, `question_id I FK questions.id`, `game_id U`, `assignment_id U`, `operation_id T`, A | id>0, operation UUIDv7 text; composite (game_id,host_id) -> games(id,host_id), (assignment_id,game_id) -> game_questions(id,game_id); trigger verifies question_id matches assignment_private. |

Indexes: UNIQUE(assignment_id), UNIQUE(host_id,operation_id,question_id), (host_id,question_id), (game_id,created_at). Rows are immutable, no UPDATE/DELETE by app. **Not** UNIQUE(host_id,question_id): explicitly approved later reuse may create another history row; selection excludes all recorded host/question pairs, without first-page limits. Retention: indefinitely across recycle, game soft-delete, restart and P05 reselect; all FKs RESTRICT. Hard account/corpus purge requires a separately approved retention operation; built-in user deletion is not an exposed P02 app feature. No direct Record API/expand/SSE; internal select/insert only. P05 writes history atomically with every allocation, not when a question is revealed.

### Table: `displays`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK`, `device_user_id U FK _user.id`, M | UNIQUE(device_user_id); identity immutable. This FK alone is ON DELETE CASCADE so stale anonymous cleanup removes scope; audit retains non-secret actor snapshots. Enroll checks actual anonymous auth state, not merely email=null in a client token. |
| `code_hash BLOB?`, `code_epoch I=0`, `code_created_at I?`, `expires_at I?`, `failed_attempts I=0`, `attempt_window_at I?`, `blocked_until I?` | Hash exactly 32 bytes when present; hash/creation/expiry all present or all NULL, expiry>creation; epoch/attempts>=0. Server HMAC-SHA256 over six-digit code using an out-of-Git pepper; not unsalted SHA of a million-value space. |
| `claim_version I=0`, `host_id U?`, `game_id U?`, `claimed_at I?`, `released_at I?`, `last_seen_at I=unixepoch()`, `revoked_at I?`, `settings T='{"theme":"dark","text_scale":1}'` | host/game/claimed_at all-null or all-present; (game_id,host_id) FK games(id,host_id), claim_version>=0. Closed settings object: theme dark/light; text_scale number 0.5..2. Revoked device cannot be claimed. |

Indexes: UNIQUE(device_user_id), UNIQUE(code_hash) WHERE code_hash IS NOT NULL; (host_id,game_id), (expires_at), (last_seen_at). One row has at most one claim; multiple displays per game allowed. Claim/release/reassign increment both version and claim_version atomically and audit; code rotation also increments code_epoch. Actual startup releases, transient reconnect does not; completion or expired/lost local code rotates. Clear expired hashes before reuse; never log/return hash, pepper or attempts to hosts. Claim is bounded by server expiry and available/unrevoked state, not client clock. Code hash may remain while claimed but only available devices can be claimed.

No base Record/expand/SSE; read-only displays_public excludes identity/code/security fields (API). Code delivered only to its device by private no-store enroll/code response and retained in device-local storage with identity/epoch; hash is not reversible. A lost response/local plaintext requires an explicit code rotation with the same identity, not guessing/recovering the hash. A lost refresh identity requires a new row/code, never claim transfer. Retention: configure anonymous refresh TTL and cleanup; initial design uses 90-day refresh TTL (pinned default, deployment-configurable), unclaimed/revoked stale display removal after that TTL, claimed scope checked on every read and removed when identity disappears. No P02 scheduler; cleanup integration is a pinned T2 test obligation.

### Table: `pairing_limits`

| Columns | Constraints / ownership |
|---|---|
| `id T PK`, `window_at I=unixepoch()`, `attempts I=0`, `blocked_until I?`, `updated_at I=unixepoch()`, `version I=0` | id is server-derived `actor:<UUID>` or `global`; attempts/version>=0. No raw IP, code or user input as arbitrary bucket key. No FK: short-lived rate buckets survive actor deletion until expiry. |

Indexes: (updated_at). Needed because attempts against nonexistent codes have no display row to count. Transactionally enforce actor <=5 claims/minute and global <=60/minute (including invalid/nonexistent codes); per-device <=5 failed matched-code claims/minute, blocked 60 seconds. Enroll/rotation <=5/minute/identity and <=60/minute globally using separately prefixed bucket keys for that operation. No stable unauthenticated identity is assumed. Pinned built-in anonymous signup needs its own edge/global abuse limit before public deployment; do not trust forwarded IP headers (WASM request has no proven peer-IP method). A single global cap may deny legitimate traffic at scale; move to proven per-source limits if measured P09 throughput requires it, not extra infrastructure in P02. Server-owned/no direct Record/expand/SSE; expiry cleanup after 24 hours, no application JSON; update requires CAS in limiter transaction. Failed attempts persist their counters even though no claim mutation commits.

### Table: `online`

| Columns | Constraints / ownership |
|---|---|
| `id U_app PK` (no default), `game_id U FK games.id`, `last_seen_at I=unixepoch()`, `visibility T='visible'`, `version I=0` | Composite (id,game_id) -> game_players(id,game_id) ON DELETE CASCADE; this is the member FK. visibility visible/hidden, version>=0. Membership identity server-bound, heartbeat time never caller-supplied. |

Indexes: (game_id,last_seen_at). No sensitive session/browser identifier; one row per member so duplicate tabs coalesce. Future P06 heartbeat no more often than 15 seconds, online only within 45 seconds of server time and not hidden/left; no unload dependency. Retention: remove stale rows after 24 hours or membership purge, not membership/history. Generated contracts as listed; read-only same-name Record/filtered SSE to current game scope, no expand/direct mutations. P02 schema/fixture only.

### Table: `audit_events`

| Columns | Constraints / ownership |
|---|---|
| `id I PK`, `actor_user_id U?`, `actor_device_id U?`, `operation_id T`, `entity_type T`, `entity_id T`, `action T`, `request_hash BLOB?`, `before_version I?`, `after_version I?`, `outcome T`, A | Exactly one actor ID present; id>0; operation canonical UUIDv7 text; entity_type one of profile/game/round/team/member/assignment/answer/display/pairing-limit. entity_id <=128 chars; action <=64 chars from handler allowlist. Request hash 32 bytes if present; versions>=0; outcome success/denied/conflict. CHECK success requires non-null request_hash/after_version; a successful create has NULL before_version and after_version=0, a successful existing-row mutation has after_version=before_version+1. |

Actor identifiers are immutable **snapshots** of `_user.id` for people or `displays.id` for devices, deliberately no live FK; entity is polymorphic with no FK. This prevents account/device deletion or game retirement deleting audit/idempotency history. No names/emails, credentials, reset links, avatar paths, raw request bodies, questions, keys, grades, pairing codes or secret response payloads. request_hash is keyed HMAC of canonical validated operation input, not a dictionary-attackable code digest. No generic JSON payload/default.

Indexes: UNIQUE(actor_user_id,operation_id) WHERE actor_user_id IS NOT NULL; UNIQUE(actor_device_id,operation_id) WHERE actor_device_id IS NOT NULL; (entity_type,entity_id,created_at); (created_at). One terminal audit record per actor/operation; multi-row transaction has one command-level event. Successful mutation and audit commit together; reject replay with different hash/action/entity. Same authorized retry returns recorded outcome/version and a fresh safe authorized projection, never replays an old secret response or restores revoked scope. Denied/conflict attempts use a separate bounded audit/counter transaction after rollback; never replace the original operation row. P02 does not journal passwords/auth-token exchanges into this table; native sanitized auth logs have separate retention.

Append-only guards reject UPDATE/DELETE for application paths. Retention: 180 days minimum; game mutation idempotency rows retained for game lifetime if longer; display/profile operations use canonical UUIDv7 operation IDs and issued_at must match the UUID's embedded timestamp rounded down to seconds. Server validates both the binding and a 24-hour freshness window (at most 60 seconds future); reusing the old ID with a new issued_at is rejected even after audit expiry. Expired operations are rejected, not executed. Audit deletion is an explicit offline administrator retention procedure, not a scheduled P02 app endpoint; it cannot silently expire game idempotency keys. No direct Record API, expand or SSE, including game hosts; server-internal generated select/insert only.

### Migration/projection readiness

Apply append-only migrations after bootstrap_ready: profiles/questions/games/rounds/teams/players, public assignment then private/history/answers/grades, state/display/limits/presence/audit, then cross-row guards and Record config. A committed assignment transaction must contain its private/history partners via the explicit deferred reverse FKs; their commit validation is a first `schema-two-depots` test obligation. No seed of real users/corpus. Export normalized sqlite_schema, table_info, foreign_key_list and index_list/index_xinfo plus generated public schemas on two fresh marked depots; compare without random row IDs/times and restart each without changes. Include missing defaults, explicit NULL, forged generated fields, rollback and composite-key cases. Source import must remain possible with standard SQLite for questions (no TrailBase-only UUID/JSON functions in that table).

No direct client collection for private answer/key/grade/score/assignment material in P02, and no expand allowlist entries at all. Direct source-table aliases use explicit `excluded_columns`; pinned TrailBase v0.33.14 still serializes those source columns in SSE, so subscription-enabled aliases with private source fields use the migration-managed allowlisted `*_public_events` tables and keep those tables internal. Tests prove exact read/list/filter/count/schema output, scoped stream opening/foreign denial and mirror column boundaries; the profile-create command proves a trusted safe insert event. Trusted update/delete event delivery and membership/device revocation remain C3 proof obligations; if they fail, disable the unsafe stream and keep the gate failing rather than publish a whole private table as a workaround.

## Authority and game commands

Record APIs are preferred for ordinary operations that row rules alone can enforce. P02's exposed records are read-only; profile/avatar and display commands need validation, CAS and atomic audit that raw CRUD cannot provide. Later small authenticated backend commands are justified for:

- choosing/recycling unused random questions with preserved history;
- joining/changing team if multi-record validation cannot be expressed safely by Record ACLs;
- starting, moving next/back, revealing/grading, completing, and pausing/resuming a game;
- submitting one team answer at a question boundary;
- claiming/releasing a display without a concurrent takeover.

Do not build every possible endpoint up front. Establish the smallest tested set at each phase. Use SDK transactions/SQL constraints first where they safely cover the operation.

Transitions carry an expected state version and operation identity; conflicts return authoritative current state. Repeated requests/retries do not create duplicate questions, answers or scores. Check current host/membership/device authorization on the server, not an asserted role. Parameterize SQL, bound request sizes and code-attempt rates, and keep ownership fields immutable to ordinary clients.

Before reveal, player/display responses contain current question text and shuffled choices only. Correct answer, original position, shuffle key and grading results remain private. P02 has no direct bank/assignment/grade/score API even for hosts. P05 may add scoped authoring handlers for a host creating their own game; being a host elsewhere never authorizes another game's control endpoints. Explicitly test all read paths including SSE and expansion.

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

`pnpm dev` owns TrailBase, an isolated Mailpit and installed Vite's JavaScript server in one Node lifetime, retaining Tauri's existing `beforeDevCommand` and shared `/display`. Mailpit uses a fresh loopback HTTP/SMTP pair and a marked private depot database; `Ready` prints only the inbox URL/ports, never credentials. No pnpm/Vite child tree, gameplay schema, WASM fault endpoint or automatic install. `backend/config/development.textproto` and the single append-only readiness migration are source-controlled; the launcher injects only the owned dev SMTP settings into its private depot config. A new public read-only API nonce each start exposes only `{id:1,schema_version:1}`. Readiness requires that owned Mailpit/backend children stay alive, health, this schema/instance row, then Vite `/display` HTML. This is migration/bootstrap readiness, not application auth/gameplay acceptance.

Default depot `.local/dev/depot` persists on stop. Overrides must be direct named children of `.local/dev/`; existing unmarked/wrong-owner paths, external targets, root/marker/depot-tree symlinks and file hardlinks are refused. An exclusive sibling `.lock` covers creation through awaited cleanup; a stale lock is not automatically stolen (inspect processes before manual recovery). Port/host/version preflight occurs before depot writes. Only `127.0.0.1` and decimal ports 1–65535 are accepted. Occupied ports fail without signaling listeners. Normal stop, SIGINT/SIGTERM/SIGHUP, startup/child failure close Vite and terminate only the created TrailBase process group, with 5s escalation; depot data is never reset. Uncatchable SIGKILL/machine loss may require explicit stale-lock recovery. This is cooperative local ownership, not a sandbox against a hostile same-UID process changing files concurrently.

Backend stdout/stderr go only to exclusive mode-0600 ignored `.artifacts/p01-t3/dev/run-*/trail.log`; terminal errors disclose sanitized status/paths, never credentials. Logs/depots must not be served by Vite or published. `pnpm test:bootstrap` uses real successful stacks, persistent SQLite restart and narrowly injected negative children; synthetic test workspaces alone are removed.

Explicit setup: `node scripts/setup-trailbase.mjs`, then add its printed `.local/tools/trailbase-v0.33.14-<platform>-<arch>` directory to PATH. Requires Node and `unzip`; supports actual macOS arm64/Linux x86_64 only, refuses destination overrides/existing installs/cache substitution. Shared `scripts/trailbase-releases.json` pins official URLs, sizes, SHA256, full source and SQLite. Download bytes are verified before extracting only the expected `trail` member into a fresh private directory; execute/assert the exact version before installation. No global install/upgrade, floating installer or binary cache reuse. The manifest's short CLI source identifier maps to the independently checked official full tag commit. Linux CI uses this same command and frozen dependencies; local Mac execution is not Linux/native-window evidence. C4 stays pending parent native/remote-CI acceptance.
