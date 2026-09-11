# TrailBase SDK 0.14.1: downstream SSE fix

`trailbase@0.14.1.patch` changes the published SDK's `RecordApi.subscribeImpl`, not TrailBase or a copied reference application. It retains incomplete LF-delimited SSE frames, decodes UTF-8 across transport chunks, and keeps `onLoss` sequence state across chunks. The SDK still owns requests, auth, parsing and cancellation. No compatibility layer/event bus.

Provenance: [`record_api.ts` at the pinned TrailBase commit](https://github.com/trailbaseio/trailbase/blob/3f965de7ea516c43a54ca70a495e97f0c6d991ab/crates/assets/js/client/src/record_api.ts). `pnpm patch-commit` binds the patch/hash in the workspace/lockfile; frozen installation must apply it. Remove only after an explicitly selected SDK version passes both regressions without it:

- `pnpm test:backend -- capabilities`: genuine backend response split into single-byte chunks, including Unicode; no invented API/SSE data.
- `pnpm test:unit`: deterministic parser-only sequence-gap regression (not real-backend evidence).

This is a targeted fix for the pinned server's LF-delimited events, not a general-purpose SSE parser or automatic reconnect implementation. EOF still requires consumer resubscription/state reconciliation; P02/P07 own application lifecycle/recovery. Large frames arriving in tiny chunks rescan the buffer; do not use this as an unbounded blob transport.

The SDK package declares `Apache-2.0 OR OSL-3.0`; the upstream Apache license is retained in `trailbase-LICENSE-APACHE` for this SDK modification. This third-party notice does not assign a redistribution license to Trail Party or to the unlicensed reference application.
