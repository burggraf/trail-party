# Stack and version evidence

Verified 2026-09-11. This is a planning snapshot, not an installed frontend or a proven compatibility test. At P01 recheck stable registry releases, peer dependencies and toolchain requirements, then pin the tested combination and commit lockfiles. Do not use floating `latest` in CI. TrailBase remains fixed regardless of frontend changes.

| Component | Verified version / choice | Evidence |
|---|---|---|
| TrailBase executable | `v0.33.14-0-g3f965de7 (2026-09-10)` | Local `trail --version` |
| Embedded SQLite | `3.53.2` | Local `trail --version`; do not confuse with OS sqlite3 |
| TrailBase source | `3f965de7ea516c43a54ca70a495e97f0c6d991ab` | GitHub commit associated with installed release |
| Official JS SDK `trailbase` | `0.14.1` | Registry and package.json at pinned backend commit agree |
| `trailbase-wasm` | `0.6.0` registry stable candidate | Build/transaction API must be tested with pinned backend |
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
| TypeScript | Choose supported stable **6.x**, candidate `6.0.3` | Registry newest is 7.0.2, but Kit 2.70.3 declares ^5.3.3 or ^6.0.0; do not force unsupported TS7 |
| Runtime/tooling | Node 24 LTS candidate; pnpm 11.22.0 available | Host currently Node 26.7.0 and Rust 1.91.1; P01 must establish supported Node/Rust versions, not assume current host meets all engines/MSRV |

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

## Unknowns to prove in P01/P02

- Fresh-depot layout/config serialization and exact migrations directory (`migrations/main` in pinned examples); don't use stale unqualified migration paths.
- SDK 0.14.1 stream framing/reconnect behavior on split UTF-8/SSE chunks, cleanup and refresh on reconnect. `onLoss` is not an automatic reliable-delivery guarantee.
- ACLs on subscribe/filter/expanded data and revocation after membership changes. If a subscription outlives auth expiry, implement a documented revalidation strategy.
- WASM transaction semantics and authenticated request identity for atomic game transitions/answer grading; do not assume independent queries share a transaction.
- Exact avatar and OAuth callback APIs, auth persistence across browser reload/native restart.
- Display credential mechanism: prefer built-in anonymous identity if durable token refresh + re-pair is sufficient; otherwise a narrowly scoped device flow. No fake verified email or browser administrator token.
- JSON/booleans/timestamps and UUID representation over SDK boundaries. Keep generated API types separate from view/domain models.
- Native macOS testing limits: official Tauri WebDriver does not provide equivalent macOS coverage. Browser WebKit is not the actual Tauri WKWebView. Choose a supported native automation method or keep an explicit manual gate.

## Documentation consulted

- [Tauri SvelteKit integration](https://v2.tauri.app/start/frontend/sveltekit/): static adapter, SSR disabled, common frontend build.
- [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/).
- [SvelteKit SPA](https://svelte.dev/docs/kit/single-page-apps).
- [shadcn-svelte installation](https://www.shadcn-svelte.com/docs/installation/sveltekit) and [Tailwind 4](https://www.shadcn-svelte.com/docs/migration/tailwind-v4).
- [TrailBase auth](https://trailbase.io/documentation/auth/), [Record APIs](https://trailbase.io/documentation/apis_record/), [production](https://trailbase.io/documentation/production/). These live pages are secondary to the pinned binary/source.

Registry checks used `pnpm view <package> version --json` and peerDependencies. Tauri release check used `gh api repos/tauri-apps/tauri/releases/latest`. Exact frontend patches are individually versioned; do not force every Tauri package to one patch number.
