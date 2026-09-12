# Stack and version evidence

Verified 2026-09-11. Registry findings, P01.T1 shell verification and P01.T2 real backend probes are distinguished below; see P01 evidence for acceptance/review status. Exact application dependencies are pinned in package.json/pnpm-lock.yaml and src-tauri/Cargo.toml/Cargo.lock. Do not use floating `latest` in CI. TrailBase remains fixed regardless of frontend changes.

| Component | Verified version / choice | Evidence |
|---|---|---|
| TrailBase executable | `v0.33.14-0-g3f965de7 (2026-09-10)` | Local `trail --version` |
| Embedded SQLite | `3.53.2` | Local `trail --version`; do not confuse with OS sqlite3 |
| TrailBase source | `3f965de7ea516c43a54ca70a495e97f0c6d991ab` | GitHub commit associated with installed release |
| Official JS SDK `trailbase` | `0.14.1` + pinned SSE patch | Real CRUD/auth/ACL/SSE probes; see patches/README.md |
| `trailbase-wasm` | `0.6.0` | Real authenticated transaction/CAS and rollback probe |
| `@bytecodealliance/jco` | `1.32.1` | Builds fixture component; reports compatibility fallback to locked componentize-js 0.19.3 |
| Svelte | `5.57.0` | `pnpm view svelte version` |
| SvelteKit | `2.70.3` | `pnpm view @sveltejs/kit version` |
| `@sveltejs/adapter-static` | `3.0.10` | Registry |
| `@sveltejs/vite-plugin-svelte` | `7.3.0` | Peers: Vite 8, Svelte >=5.46.4 |
| Vite | `8.3.0` | Registry; within SvelteKit's Vite 8 peer range |
| shadcn-svelte CLI/registry | `1.6.1` | Registry; copied components must also be versioned/reviewed |
| Tailwind / `@tailwindcss/vite` | `4.3.3` / `4.3.3` | Current shadcn-svelte Tailwind 4 integration |
| Tauri Rust release | `2.11.5` | Latest stable `tauri-v2.11.5` GitHub release |
| `@tauri-apps/cli` | `2.11.4` | Registry (patches differ legitimately) |
| `@tauri-apps/api` | `2.11.1` | Registry |
| Playwright | `1.63.0` | `pnpm view @playwright/test version` |
| TypeScript | Pinned `6.0.3` | Registry newest is 7.0.2, but Kit 2.70.3 declares ^5.3.3 or ^6.0.0; do not force unsupported TS7 |
| Runtime/tooling | Node 24 LTS candidate; pnpm 11.22.0 available | Host currently Node 26.7.0 and Rust 1.91.1; P01 must establish supported Node/Rust versions, not assume current host meets all engines/MSRV |

## P01.T1 resolution checkpoint (2026-09-11)

Registry versions above were rechecked and still match. Additional exact pins: Vitest 5.0.0, svelte-check 4.7.6, ESLint 10.10.0, @eslint/js 10.0.1, eslint-plugin-svelte 3.23.0, typescript-eslint 8.70.0, globals 17.12.0, @types/node 22.20.2, mode-watcher 1.1.0. The Vega/neutral preset supplies the generated button/native-select, utility and color tokens; their reviewed source is committed, never fetched during builds. Fonts are bundled locally (@fontsource-variable/inter 5.3.0), not loaded from an external font service.

Other exact generated-component dependencies: clsx 2.1.1, tailwind-merge 3.6.0, tailwind-variants 3.3.1, tw-animate-css 1.4.0, @lucide/svelte **1.44.0** (Svelte ^5 peer). The generator selected 1.45.0, published less than 24 hours ago, and created a minimumReleaseAge exemption. That exemption was removed, the last policy-eligible stable 1.44.0 selected (published 2026-09-10 07:32 UTC), and the lockfile regenerated with pnpm's normal security checks. Frozen install passes with no exemptions. Do not reintroduce the generator's bypass.

`pnpm view` confirms Kit accepts TS ^6.0.0 and Vite ^8; plugin-svelte requires Svelte >=5.46.4/Vite 8; svelte-check accepts TS6; typescript-eslint accepts TS <6.1 and ESLint 10; eslint-plugin-svelte accepts ESLint 10/Svelte 5. No peer conflicts reported on install. Host Node 26.7.0 satisfies all selected engines, including Vitest (^22.12 / ^24 / >=26) and plugin-svelte (^20.19 / ^22.12 / >=24). Node 24 LTS remains a future clean-environment check, not a proven runtime in this checkpoint.

`gh api repos/tauri-apps/tauri/releases/latest` still reports `tauri-v2.11.5`; that release declares Rust 1.77.2/edition 2021. This project records its tested Rust 1.91.1 minimum and uses resolver 3 to select compatible dependencies. Tauri =2.11.5 and tauri-build =2.6.3 are exact pins; Cargo.lock is present. `cargo build --locked` passes on macOS arm64. An actual `pnpm tauri dev --no-watch` window rendered `/display`; native screenshot/cleanup evidence is in P01. This is not packaged, Android TV, multi-monitor or updater proof. No frontend native API is invoked or needed yet, so @tauri-apps/api remains an uninstalled candidate, not unused scaffolding.

**Browser tooling decision:** owner approved existing installed Chrome instead of retrying a bundled-browser download. Playwright Test 1.63.0 with `channel: 'chrome'` actually ran Chrome 153.0.8010.37 and passed the shell checks, including seven independent live contexts (preferences only; no auth/SSE/gameplay claim). This resolves the earlier download blocker without changing timeouts/retries or global tools. `docs/TESTING.md` defines this consistent local tooling choice and CI/browser-version recording. Agent-browser is currently incompatible with its wrapper; DevTools MCP also failed a smoke call. Neither is the acceptance runner.

## Verified pinned-backend facts

Inspected the following files at the exact TrailBase commit, not reconstructed API examples:

- [`client.ts`](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/crates/assets/js/client/src/client.ts): `initClient`, `user()`, `tokens()`, `onAuthChange`, registration, login, anonymous sign-in and promotion exist. Auth user contains id/email/username, not the app's full profile.
- [`record_api.ts`](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/crates/assets/js/client/src/record_api.ts): `create` returns an ID, `update` returns void, `read` returns the record. `subscribe(id)` and `subscribeAll({filters,onLoss})` return streams. `list` uses `filters`, `order`, `pagination`, `count`, `expand`. Do not assume PocketBase return values.
- [`config.proto`](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/crates/core/proto/config.proto): Record APIs have `enable_subscriptions` and SQL access rules; auth has configurable identifiers, anonymous sign-in and token TTLs; SMTP settings include secrets.
- [`register.rs`](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/crates/core/src/auth/api/register.rs): email registration requires verification; username-only registration depends on a global identifier policy. Do not change global policy casually just to accommodate displays.
- [`profiles migration`](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/examples/blog/traildepot/migrations/main/U1725019361__create_profiles.sql): strict table, BLOB user FK, SQL timestamp trigger; views need inferred/cast types.
- [`WASM example`](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/examples/collab-clicker-ssr/guests/typescript/src/index.ts): `defineConfig`, `HttpHandler`, SQL query API, exported WASM endpoints. Use this pinned build convention rather than older addRoute examples.

### CLI facts from installed binary

```text
trail --depot <path> run --address <host:port> [--dev]
trail --depot <path> run --public-dir <path> --spa
trail --depot <path> schema <api> --mode insert|select|update
trail migration
trail user add|verify|mint|invalidate-session|import|...
trail components add|remove|list|installed|update
```

These are capability observations, not commands to mutate the original application. User/admin CLI is restricted to isolated test/bootstrap depots. `trail --help` is the source for flags, and P01 must capture help for each command actually used.

Pinned release assets: https://github.com/trailbaseio/trailbase/releases/tag/v0.33.14. Both aarch64/x86_64 macOS and Linux binaries exist, as does a versioned auth UI WASM component. CI downloads exact artifacts and verifies a recorded SHA256; never installs latest. P01 must capture official digest where available or independently verify the downloaded release artifact and record provenance. Never fabricate a digest.

## P01.T2 measured contracts

`pnpm test:backend -- capabilities` builds a synthetic-only WASM component, starts real v0.33.14 on an ephemeral loopback port, migrates a marked `.local/test-runs/capabilities-*` depot, and disposes it. Config is textproto, migrations live in `migrations/main/`, and components load from `wasm/*.wasm`. A per-run public readiness API exposes only a constant row, proving depot identity before any auth mutation. There is no application/dev depot or game schema yet.

- `create` returns a padded URL-safe Base64 UUIDv7 string (24 characters, `==` suffix); `update`/`delete` return `undefined`. Integer timestamps are Unix **seconds**, not JS milliseconds. JSON object roundtrip needs metadata such as `CHECK(jsonschema_matches('{"type":"object"}', payload))`; `is_json` alone validates text but does not expose a structured JSON column through the Record API. `trail schema <api> --mode insert|select|update` produces schemas.
- Ownership autofill plus SQL `_USER_`/`_REQ_`/`_ROW_` rules enforce ordinary-account isolation and prevent owner/version forgery. `FetchError` implements Error but does **not** extend it: check `instanceof FetchError` and `status`, not `instanceof Error` alone.
- Login, forced refresh, logout and rejected reuse of the logged-out refresh token pass. Anonymous identity refresh retains the ID. This does not prove verification mail, OAuth, persisted browser auth, device pairing/expiry or immediate revocation of every old access JWT.
- **Pinned CLI defect:** `trail user add` still inserts the removed `verified` column (`auth/cli.rs` versus migration `U1785764695__unverified_email.sql`). It fails on a fresh v0.33.14 depot. The fixture instead creates a real anonymous identity, promotes that identity with the local admin CLI, forces refresh, then uses `/api/_admin/user` to provision verified **non-admin** baseline accounts. No invented JWT, copied account, direct auth-table write, parsed bootstrap password or email delivery. This bootstrap stays outside normal UI/production flows.
- **Pinned SDK defect:** unpatched 0.14.1 drops partial SSE frames/UTF-8 and resets `onLoss` sequence state per chunk. A small pnpm patch retains frames/sequence state in the existing SDK (no new client/event bus). Real filtered create/update/delete, owner/filter exclusion, cancellation, resubscription and single-byte response fragmentation pass; a separate unit test covers sequence gaps. See `patches/README.md`. Automatic reconnect/reconciliation is not implemented.
- WASM `HttpRequest.user()` is trusted server identity (padded Base64 user ID). Parameterized `base64_url_safe(?)` converts it to the BLOB FK. `new Transaction()` from `trailbase-wasm/db` provides synchronous `query`/`execute`/`commit`/`rollback`; do not await between statements. Two simultaneous expected-version mutations yield one commit and one 409, with an audit row in the same transaction. A second-write CHECK failure rolls back the first write.
- Build: Vite ES library, strict entry exports and external `wasi:`/`trailbase:` imports, then `jco componentize ... --wit node_modules/trailbase-wasm/wit`. JCO reports its compatibility fallback to componentize-js **0.19.3**, retained in the lockfile; the resulting component is tested on the pinned backend. This does not upgrade TrailBase or global tools. Artifact/source hashes are in P01 evidence.

## Remaining acceptance and P02 onward

- P01.T3 now has shared verified release setup, safe dev launcher and six approved source-cited decisions (ARCHITECTURE/PARITY). Writer local execution is recorded in P01 evidence; fresh review, native startup/cleanup and actual remote Linux CI acceptance remain pending. The T2 probe runner stays separate.
- Subscription lifecycle on auth refresh/expiry, resnapshot/reconnect after loss, and persistence across app reload remain application work. `onLoss` is not an automatic reliable-delivery guarantee.
- ACLs on subscribe/filter/expanded data and revocation after membership changes. If a subscription outlives auth expiry, implement a documented revalidation strategy.
- Apply the proven WASM transaction mechanism to actual game transitions/answer grading with production-equivalent schema and authorization; the current fixture is not game authority.
- Exact avatar and OAuth callback APIs, auth persistence across browser reload/native restart.
- Display credential mechanism is approved as built-in anonymous identity with durable token refresh and explicit re-pair on irreversible expiry (P01-D3). Persistence/expiry/pairing implementation and tests remain P02/P09/P10. No fake verified email or browser administrator token.
- Remaining scalar boolean, file/expanded-relation and generated application type contracts. Keep generated API types separate from view/domain models.
- Native macOS testing limits: official Tauri WebDriver does not provide equivalent macOS coverage. Browser WebKit is not the actual Tauri WKWebView. Choose a supported native automation method or keep an explicit manual gate.

## Documentation consulted

- [Tauri SvelteKit integration](https://v2.tauri.app/start/frontend/sveltekit/): static adapter, SSR disabled, common frontend build.
- [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/).
- [SvelteKit SPA](https://svelte.dev/docs/kit/single-page-apps).
- [shadcn-svelte installation](https://www.shadcn-svelte.com/docs/installation/sveltekit) and [Tailwind 4](https://www.shadcn-svelte.com/docs/migration/tailwind-v4).
- [TrailBase auth](https://trailbase.io/documentation/auth/), [Record APIs](https://trailbase.io/documentation/apis_record/), [production](https://trailbase.io/documentation/production/). These live pages are secondary to the pinned binary/source.

Registry checks used `pnpm view <package> version --json` and peerDependencies. Tauri release check used `gh api repos/tauri-apps/tauri/releases/latest`. Exact frontend patches are individually versioned; do not force every Tauri package to one patch number.

## Explicit verified local backend setup (P01.T3)

Run `node scripts/setup-trailbase.mjs`, then explicitly add the printed repository-local directory to PATH if desired. No global install or `pnpm dev` download. Node + `unzip` required. Existing destination/overrides and unsupported platforms are refused; no substituted archive/binary cache is accepted. Fresh official download bytes are size/SHA256-checked before extracting the sole executable member and asserting version/source/SQLite. Official archives also include CHANGELOG.md/LICENSE; member list is checked, archive paths are never used for writes.

The shared manifest is **`scripts/trailbase-releases.json`**. It pins macOS arm64 (`a28454d67751863a2cce7b1477c603dc2321284d8804d9611aaa612523b5964f`, 25,282,295 bytes) and Linux x86_64 (`ef2f334704835dc67a95bb7f24961a0aa6ea8912d76d4ed2a09d488ddb7da453`, 29,555,962 bytes). [Official release metadata](https://api.github.com/repos/trailbaseio/trailbase/releases/tags/v0.33.14) and [tag ref](https://api.github.com/repos/trailbaseio/trailbase/git/ref/tags/v0.33.14) independently confirmed those digests and full source commit. Both fresh archives matched; compatible downloaded Mac executable passed the assertion and has SHA256 `0bfe77e850e1b3a30161555c4fb34f4eecf7c0f81939fd02aa43aa29bf22eaf9`, equal to installed `trail`. CLI only prints short source `3f965de7`; the official tag maps it to the pinned full commit.

`.github/workflows/trailbase.yml` uses the same setup on actual Ubuntu 24.04/x86_64 with Node 24, pinned pnpm and frozen dependencies. It runs implemented bootstrap, backend, type/lint/unit/build, scaffold and plan gates; no raw credential-bearing log upload. Mac execution is not Linux proof. Browser shell remains installed-Chrome local acceptance, with pinned-browser CI in P04; Linux cannot establish native macOS or Android TV behavior.
