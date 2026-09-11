# Functionality parity inventory

Reference baseline: `~/dev/trivia-party`, commit `442890dda579c6cb108d2f4851816e4388207627`, inspected 2026-09-11. The current source remains available and may evolve. Revisit before each phase; document deltas in HANDOFF and evidence. Code paths below are relative to that reference, not this new repository. Legacy docs contain stale claims (e.g. timers not implemented, 60K questions, all records host-only); inspect active code and observed behavior.

Each row is required unless the owner explicitly changes scope. Status belongs in `docs/STATUS.json`; this table is a traceability inventory, not a second status tracker. P01 refines ambiguous edge cases before their phase implements them.

| ID | User capability and acceptance focus | Reference paths | Phase / tests |
|---|---|---|---|
| F01 | Landing, host/player entry, theme persistence, navigation | `src/pages/LandingPage.tsx`, `src/App.tsx`, `src/contexts/ThemeContext.tsx` | P01/P10; shell.spec.ts, visual.spec.ts |
| F02 | Signup, login, logout, verification, resend, reset, return-to route | `src/pages/AuthPage.tsx`, `src/components/AuthGuard.tsx` | P02/P04; auth.spec.ts |
| F03 | Google OAuth and return-to join/role | `src/pages/AuthPage.tsx` | P02/P12; oauth.spec.ts + real Google gate |
| F04 | Edit profile name, upload/remove avatar, validation, updated roster identity | `src/components/ProfileModal.tsx`, `src/components/ui/AppHeader.tsx` | P02/P06; profile.spec.ts |
| F05 | Host game list, create/edit/delete, start date/duration/location, status setup/ready/in-progress/completed | `src/pages/HostPage.tsx`, `src/components/games/GameEditModal.tsx`, `GameStatusModal.tsx`, `src/lib/games.ts` | P05; setup.spec.ts |
| F06 | Create/configure/reorder/delete rounds, question counts/categories/difficulty-level bounds | `src/components/games/RoundEditModal.tsx`, `src/lib/rounds.ts`, `src/types/rounds.ts` | P05; setup.spec.ts |
| F07 | Import full question corpus losslessly and rerun safely | `pb_data/data.db:questions`, `scripts/import-questions-efficient.js`, `scripts/import-jeopardy-questions.js` | P03; import.test.py + private corpus gate |
| F08 | Random selection, avoid host-used questions, inspect/recycle assignment while retaining history | `src/lib/questions.ts`, `src/lib/gameQuestions.ts`, `src/components/games/QuestionsList.tsx` | P05; questions.spec.ts |
| F09 | Persist shuffled choices; original answer_a correctness translated to shown A/B/C/D; no answer leakage | `src/lib/answerShuffler.ts`, `src/pages/ControllerPage.tsx`, `src/lib/gameAnswers.ts` | P07; answers.test.ts, authorization.test.ts, game.spec.ts |
| F10 | Join by six-character code or QR/deep link, preserve intent through auth, copy join URL | `src/pages/JoinPage.tsx`, `src/components/games/QrCodeCard.tsx`, `src/lib/networkUrl.ts`, `src/lib/clipboard.ts` | P06; join.spec.ts |
| F11 | Lobby, active games, leave/rejoin ready or in-progress game, reject invalid/completed code | `src/pages/LobbyPage.tsx`, `src/pages/JoinPage.tsx`, `src/lib/games.ts` | P06/P10; join.spec.ts, recovery.spec.ts |
| F12 | Create/join/change teams; roster, team details/player details, leave flows | `src/components/games/TeamSelectionModal.tsx`, `TeamCard.tsx`, `TeamDetailsModal.tsx`, `PlayerDetailsModal.tsx`, `src/pages/GamePage.tsx` | P06; teams.spec.ts |
| F13 | Live roster scoreboard and per-round/final scores; all clients converge | `src/lib/scoreboard.ts`, `src/components/games/TeamDisplay.tsx`, display `TeamScoreCard.tsx` | P06/P07; game.spec.ts |
| F14 | Host control: start, next/reveal/back, round boundaries, end, thanks, return-to-lobby | `src/pages/ControllerPage.tsx`, `src/components/games/GameStateDisplay.tsx`, `GameStateRenderer.tsx` | P07; game.spec.ts, transitions.spec.ts |
| F15 | Player answers once per team/question, pending/accepted/revealed states; two teammates synchronize | `src/pages/GamePage.tsx`, `src/components/games/RoundPlayDisplay.tsx`, `src/lib/gameAnswers.ts` | P07; game.spec.ts, concurrent-answers.spec.ts |
| F16 | Controller compact layout, counts, next-question preview, keyboard next/back/pause, suppress shortcuts while typing | `src/components/games/ControllerGrid.tsx`, `ControllerHeader.tsx`, `ControllerStatsLine.tsx`, `NextQuestionPreview.tsx`, `src/hooks/useKeyboardShortcuts.ts` | P07/P08; controller.spec.ts |
| F17 | Seven editable timer values, null/zero no limit, synchronized circular countdown | `src/types/games.ts`, `src/components/games/TimersAccordion.tsx`, `src/components/ui/circular-timer.tsx`, controller createTimerForState | P08; timers.spec.ts |
| F18 | Expiry auto-advance, pause/resume, refresh retains deadline and paused remainder | `src/pages/ControllerPage.tsx`, `src/pages/GamePage.tsx` | P08/P10; timers.spec.ts, recovery.spec.ts |
| F19 | Optional auto-reveal after all teams answered, 3-second notification and <=3s edge | `src/pages/ControllerPage.tsx:handleAllTeamsAnswered`, both `RoundPlayDisplay.tsx` implementations | P08/P09; timers.spec.ts |
| F20 | Realtime presence, online/away status, visibility/heartbeat/stale cutoff, team-name changes | `src/hooks/usePresenceTracking.ts`, `src/components/games/OnlinePlayersPanel.tsx`, `e2e/online-players.spec.ts` | P06/P10; presence.spec.ts |
| F21 | Controller refresh/rejoin preserves current question, reveal, timer, scores; clients recover connectivity | `src/pages/ControllerPage.tsx`, `src/pages/GamePage.tsx`, `e2e/rejoin-in-progress.spec.ts` | P10; recovery.spec.ts |
| F22 | Display enrolls, shows six-digit pairing code/QR, host claims it, one or multiple displays per game | `src/components/games/DisplayManagement.tsx`, `ConnectedDisplays.tsx`, display `contexts/DisplayContext.tsx`, `components/CodeDisplay.tsx` | P09; display.spec.ts |
| F23 | Display release at startup/completion, reassign/disconnect/error handling, new pairing code | display `contexts/DisplayContext.tsx`, `components/ErrorBanner.tsx` | P09/P10; display.spec.ts, recovery.spec.ts |
| F24 | Display all game states, team roster, round/end scores, all-answered notification, theme and text sizing | display `components/GameDisplay.tsx`, `RoundStartDisplay.tsx`, `RoundPlayDisplay.tsx`, `TeamRoster.tsx`, `states/*`, `contexts/TextSizeContext.tsx` | P09/P10; display.spec.ts, visual.spec.ts |
| F25 | macOS fullscreen Cmd+F, menus, display selection, borderless/projector presentation, controls | display `src-tauri/src/lib.rs`, `src/lib/window.ts`, `components/DisplaySelector.tsx`, `ControlPanel.tsx` | P11; native acceptance |
| F26 | Android TV APK, fullscreen, remote/focus/back behavior, resume/reconnect, no desktop menus | display `src-tauri/gen/android`, `src/lib/platform.ts`, `src/App.tsx` | P11; Android TV acceptance |
| F27 | Check/download/install/relaunch supported macOS updates, failure handling, visible version, downloads page | display `src/lib/updater.ts`, `components/UpdateNotification.tsx`, `src/pages/DownloadPage.tsx` | P11/P12; download.spec.ts + signed update gate |
| F28 | Responsive mobile forms, keyboard usability, touch targets, dark/light, long questions/team names/rosters | `docs/design/ui-style-guide.md`, `e2e/mobile-*.spec.ts`, both text-size contexts | P10; accessibility.spec.ts, visual.spec.ts |
| F29 | Host isolation, membership-only writes, display scope, server-owned grades and safe profile access | effective PocketBase collection rules plus live caller behavior | P02 onward; authorization.test.ts + isolation.spec.ts |
| F30 | Cold-start deployment, persisted state after restart, backup/restore, safe versioned release | `dev.sh`, `scripts/deploy-*.sh`, `docs/deployment-plan.md`, display `BUILD.md` | P12; deployment smoke + restore rehearsal |

## State transition contract to validate

Lifecycle: `setup -> ready -> in-progress -> completed`.

Presentation: `game-start -> round-start -> round-play(question) -> round-play(reveal) -> next question or round-end -> next round-start or game-end -> thanks -> return-to-lobby`.

Back navigation includes removing a reveal, revisiting a previous question, and previous presentation states. Capture exact boundary behavior from the reference before implementing P07; do not infer it solely from enum ordering. Revisit/reveal must not duplicate scores or alter the saved permutation. Determine whether late joiners are immediately eligible for the current question and whether team changes after an answer affect that answer. Persist the approved rule and test it.

## Explicit interpretation / reconciliation items

- **First team answer:** current UI/service suggests one answer but tries updating an existing answer while PocketBase permissions restrict player updates. P01 records observed behavior. Default target: first valid answer wins; later attempts return the existing accepted answer/conflict consistently. Owner review required if evidence shows intentional answer editing.
- **Registration:** fixed TrailBase email verification differs from reference immediate auto-login. Retain all account capabilities using a verification-first flow, documenting this necessary backend difference.
- **Security:** do not reproduce answer leakage, permissive rules, stale presence, client-forged scoring or race conditions as parity requirements. Document differences and tests; seek owner input for changes to intentional visible behavior.
- **Question filters:** limited first-page category sampling and first-500 used-history queries are implementation limitations, not intended features. Preserve the ability to choose categories/levels and avoid previously used questions across the full corpus.
- **Old features:** AI token requests, bans, audio generation and game-events migrations include removed functionality. Do not recreate abandoned schema just because a local DB still contains a table. Trace current callers.
- **Native test/debug components:** inspect which test/text-size controls are reachable from normal UI before deciding whether they are user capabilities. Developer-only demos may be replaced by deterministic test fixtures, not quietly counted as missing production features.
- **Public corpus/source licenses:** fresh implementation source may be public; dataset/asset redistribution remains separate and unapproved.

## Source drift procedure

At phase start run `git -C ~/dev/trivia-party rev-parse HEAD` and inspect diffs in referenced paths since the last recorded baseline. Add/update F IDs for confirmed scope changes with owner confirmation if substantial. Record active-source commit and any live app version/date in evidence. Reference deployment can diverge from local code; log discrepancies and choose explicitly. Never overwrite this baseline without keeping the prior commit in evidence.
