# API-Logic Mismatch Audit (2026-03-01)

## Scope
- Mobile (`apps/mobile`) ↔ API (`apps/api`) HTTP contracts.
- WebSocket session (`/v1/session`) event/state logic.
- External adapter boundaries: Anthropic, Speechmatics, ElevenLabs, Backboard, Composio.
- MVP stubs treated as mismatch risk when they produce behavior drift.

## Method
- Static contract inventory from controllers/DTOs/services and mobile API/socket consumers.
- Runtime probes against local API (`http://localhost:4000`) with JWT auth.
- Socket smoke tests for: `session.started`, STT path, proposal/confirm executed, proposal/confirm blocked.

## Runtime Probe Summary
- HTTP: register/login/refresh, connectors, rules, memory, and audit all returned expected shapes/statuses.
- 401 refresh flow: invalid access token returned 401; refresh token exchange succeeded; retry succeeded.
- WS flow observed:
  - `session.started` handshake.
  - `action.proposed` + `action.confirmation.required`.
  - `action.executed` after `action.confirmed` (connected connector).
  - `action.blocked` after disconnect-before-confirm.

## Contract Matrix

### HTTP
| Route | Consumer | Auth | Runtime | Status | Notes |
|---|---|---|---|---|---|
| `GET /health` | none (ops) | public | 200 | OK | Public health endpoint works. |
| `POST /v1/auth/register` | mobile `apiClient.register` | public | 201 | OK | Shape matches session contract. |
| `POST /v1/auth/login` | mobile `apiClient.login` | public | 201 | OK | Shape matches session contract. |
| `POST /v1/auth/refresh` | mobile refresh path | public | 201 | OK | Refresh and retry confirmed. |
| `GET /v1/connectors` | mobile settings | bearer | 200 | OK | Connectors payload matches. |
| `POST /v1/connectors/:id/connect` | mobile settings | bearer | 201 | RISK | Marks connected locally with stub OAuth URL only. |
| `POST /v1/connectors/:id/disconnect` | mobile settings | bearer | 201 | RISK | Pure local state toggle. |
| `GET /v1/rules/importance` | mobile (available method) | bearer | 200 | OK | Rules shape matches. |
| `PUT /v1/rules/importance` | mobile settings | bearer | 200 | OK | Partial update merges/normalizes. |
| `POST /v1/memory/opt-out` | mobile settings | bearer | 201 | RISK | No read endpoint for initial state sync. |
| `POST /v1/memory/purge` | mobile settings | bearer | 201 | OK | Purge returns expected payload. |
| `GET /v1/audit/events` | mobile settings | bearer | 200 | OK | Limit handling and shape match. |

### WebSocket Events
| Event | Producer | Consumer | Runtime | Status | Notes |
|---|---|---|---|---|---|
| `session.started` | API | mobile | observed | OK | Used to set `sessionConnected`. |
| `audio.user.chunk` | mobile | API | observed | OK | Audio ingress path exists. |
| `stt.partial` | API | mobile | env-dependent | RISK | In stub mode only partials are synthesized. |
| `stt.final` | API and mobile contract | API | observed (server side) | RISK | Mobile never consumes server `stt.final`; mobile send API exists but is unused. |
| `agent.reply.partial` | API | mobile | observed | OK | Used for speaking state. |
| `agent.reply.final` | API | mobile | observed | OK | Used for latest reply. |
| `timeline.card.created` | API | mobile | observed | OK | Used in timeline store. |
| `action.proposed` | API | mobile | observed | RISK | Added to store but no UI/action path to confirm. |
| `action.confirmation.required` | API | none | observed | MISMATCH | Emitted but not handled by mobile. |
| `action.confirmed` | mobile | API | observed via scripted client | MISMATCH | `sessionSocket.confirmAction` is never invoked by app UI/voice flow. |
| `action.executed` | API | mobile | observed | OK | Removes pending action. |
| `action.blocked` | API | mobile | observed | OK | Removes pending + timeline warning. |
| `error.raised` | API | mobile | observed | OK | Error card shown. |
| `tts.preview` | contract only | none | not observed | MISMATCH | Declared but unused dead event. |
| `tts.audio` | API | mobile | observed | OK | Audio playback path wired. |

### External Adapters
| Adapter | Wired in runtime path | Status | Notes |
|---|---|---|---|
| Anthropic | Yes (`AgentService`) | RISK | Fallback responses are in-memory/stateless quality downgrade. |
| Speechmatics | Yes (`VoiceGateway`) | RISK | Stub mode emits partial text only; no final-transcript progression. |
| ElevenLabs | Yes (`VoiceGateway`) | RISK | Stub mode emits zero audio chunks; relies on client timeout fallback. |
| Backboard | Yes (`MemoryService`) | RISK | In-memory fallback loses user memory on restart. |
| Composio | Not used by connectors flow | MISMATCH | Adapter exists but connector connect/execute paths bypass it. |

## Findings (Ordered by Severity)

### P0 — No user-reachable confirmation path for proposed actions
- Evidence:
  - `action.confirmation.required` is emitted by gateway: `apps/api/src/modules/voice/voice.gateway.ts:315`.
  - Mobile never subscribes to `WS_EVENTS.ACTION_CONFIRMATION_REQUIRED`: `apps/mobile/src/services/sessionSocket.ts:65-186`.
  - `confirmAction` exists but is unused in app code: `apps/mobile/src/services/sessionSocket.ts:61-63`; only reference is declaration (`rg sendTranscript|confirmAction` result).
  - Pending actions are stored but never rendered/acted on: `apps/mobile/src/store/useAppStore.ts:18`, `apps/mobile/src/store/useAppStore.ts:87-91`.
- Runtime impact:
  - Critical write actions can be proposed but cannot be confirmed from the shipped mobile UX.
- Minimal fix:
  - Add a pending-action UI on Home (or modal) that consumes `pendingActions` and calls `sessionSocket.confirmAction(actionId)`.
  - Handle `action.confirmation.required` to present guardrail reason and required confirmations.
- Regression test to add:
  - Mobile integration test: when `action.proposed` + `action.confirmation.required` arrives, tapping confirm emits `action.confirmed` and removes pending on `action.executed`.

### P0 — Voice prompt says “say confirm”, but spoken confirm is not wired to execution
- Evidence:
  - Agent prompt instructs spoken confirmation: `apps/api/src/modules/agent/agent.service.ts:167`.
  - STT final handler routes every transcript to `processUtterance` and never maps confirm intents to pending action IDs: `apps/api/src/modules/voice/voice.gateway.ts:161-193`.
  - Execution requires explicit `action.confirmed` event with `actionId`: `apps/api/src/modules/voice/voice.gateway.ts:200-214`.
- Runtime impact:
  - Voice-only users cannot complete the “draft then confirm” loop promised by assistant copy.
- Minimal fix:
  - Add confirm-intent resolution in `onSttFinal` (e.g., map “confirm/yes/send it” to latest pending action for user), or remove spoken-confirm copy.
- Regression test to add:
  - Gateway test: with one pending proposal, `stt.final: "confirm"` executes action and emits `action.executed`.

### P1 — Expired access token can break voice socket even when refresh token is valid
- Evidence:
  - Root nav allows entering Home with expired access token if refresh token is valid: `apps/mobile/src/navigation/RootNavigator.tsx:41-43`.
  - Socket connect uses current access token directly: `apps/mobile/src/services/sessionSocket.ts:26-37`.
  - On socket auth failure, app sets idle and does not refresh/reconnect: `apps/mobile/src/services/sessionSocket.ts:74-87`.
  - Voice session connect is one-shot on mount: `apps/mobile/src/hooks/useVoiceSession.ts:42-44`.
- Runtime impact:
  - After access expiry, HTTP may recover via refresh while WS remains disconnected until remount/restart.
- Minimal fix:
  - Add socket auth refresh strategy on `connect_error` for auth failures, then reconnect with fresh token.
- Regression test to add:
  - Mobile socket test: expired access + valid refresh results in successful reconnection without app restart.

### P1 — Memory preference UI is not source-of-truth synchronized
- Evidence:
  - Settings initializes `optOut` to `false` locally: `apps/mobile/src/screens/SettingsScreen.tsx:55`.
  - Switch binds to `!optOut`: `apps/mobile/src/screens/SettingsScreen.tsx:213`.
  - API has only write endpoints (`opt-out`, `purge`) and no read endpoint: `apps/api/src/modules/memory/memory.controller.ts:12-19`.
  - Backend already has readable opt-out state in service context path: `apps/api/src/modules/memory/memory.service.ts:44-49`.
- Runtime impact:
  - UI can display wrong initial toggle state and invert user intent on first interaction.
- Minimal fix:
  - Add `GET /v1/memory/context` (or dedicated preferences endpoint) and hydrate `optOut` on screen load.
- Regression test to add:
  - E2E/API test: opt-out true persists and is reflected on subsequent settings load.

### P1 — Speechmatics stub mode does not progress to actionable STT final events
- Evidence:
  - Stub transcription only returns partial placeholder text: `apps/api/src/modules/voice/speechmatics.adapter.ts:78-90`.
  - Mobile sends audio chunks only; no local transcript emission path is used: `apps/mobile/src/hooks/useVoiceSession.ts:58-64` and unused sender `apps/mobile/src/services/sessionSocket.ts:53-55`.
  - `.env.example` leaves `SPEECHMATICS_API_KEY` empty by default.
- Runtime impact:
  - In local/dev stub mode, voice input may never reach agent intent processing via real final transcript flow.
- Minimal fix:
  - Provide deterministic stub final transcript generation, or fallback local STT path that calls `sendTranscript`.
- Regression test to add:
  - Gateway integration test in no-key mode: audio chunks eventually produce one `stt.final`/agent reply path.

### P2 — Composio adapter boundary is not connected to connector lifecycle or action execution
- Evidence:
  - `ComposioAdapter` is defined and exported: `apps/api/src/modules/connectors/composio.adapter.ts:23`, `apps/api/src/modules/connectors/connectors.module.ts:13-14`.
  - `ConnectorsService` uses only in-memory sets and static OAuth URL; no adapter dependency: `apps/api/src/modules/connectors/connectors.service.ts:52-87`.
  - Action execution is local stub and does not call Composio: `apps/api/src/modules/connectors/connectors.service.ts:164-197`.
- Runtime impact:
  - `COMPOSIO_API_KEY` presence does not alter actual connector or action behavior; external integration assumptions drift from implementation.
- Minimal fix:
  - Inject and use `ComposioAdapter` in `connect`, `disconnect`/status checks, and `executeAction` for supported connectors.
- Regression test to add:
  - Service test: when Composio is configured, connect returns real redirect URL and execute delegates to adapter.

### P2 — Home notification logic depends on connector state loaded only in Settings
- Evidence:
  - Home renders notification list via `useNotifications`: `apps/mobile/src/screens/HomeScreen.tsx:24`, `apps/mobile/src/screens/HomeScreen.tsx:107-110`.
  - `useNotifications` derives from `store.connectors`: `apps/mobile/src/hooks/useNotifications.ts:53-57`.
  - Connectors are fetched in Settings `useEffect`, not globally: `apps/mobile/src/screens/SettingsScreen.tsx:91-96`.
- Runtime impact:
  - Home may show no platform cards until user opens Settings once.
- Minimal fix:
  - Hydrate connectors on app startup/Home mount or in a shared bootstrap hook.
- Regression test to add:
  - App startup test: Home shows connected platforms without navigating to Settings first.

### P3 — Contract drift: dead WS event and ad-hoc untyped payloads
- Evidence:
  - `TTS_PREVIEW` exists in contracts: `packages/contracts/src/index.ts:154`.
  - No server emission or mobile listener for `TTS_PREVIEW` (grep inventory).
  - `TTS_AUDIO` and `ERROR_RAISED` payloads are inline object literals in gateway/session socket, not shared typed event interfaces: `apps/api/src/modules/voice/voice.gateway.ts:339-343`, `apps/mobile/src/services/sessionSocket.ts:135`, `apps/mobile/src/services/sessionSocket.ts:173`.
- Runtime impact:
  - Lower type-safety and increased drift risk as event payloads evolve.
- Minimal fix:
  - Add explicit `TtsAudioEvent`, `ErrorRaisedEvent`, `TtsPreviewEvent` interfaces in `@mark/contracts` and either wire or remove `TTS_PREVIEW`.
- Regression test to add:
  - Type-level contract test (or compile-only fixture) ensuring server/client event payload compatibility.

## Remediation Sequence (Safe Order)
1. Implement confirm path end-to-end (`action.confirmation.required` handling + UI confirm + `action.confirmed` emission).
2. Resolve spoken-confirm semantics (intent parser in gateway, or remove spoken-confirm copy).
3. Add socket auth refresh/reconnect strategy to align WS with HTTP refresh behavior.
4. Add memory preference read endpoint + client hydration.
5. Decide integration mode per environment:
   - true external mode (Composio/Backboard/Speechmatics/ElevenLabs wired), or
   - explicit simulated mode with accurate UX copy and deterministic stubs.
6. Clean WS contract (`TTS_PREVIEW` + typed payload interfaces).

## Recommended Test Additions
- HTTP contract tests for all mobile-used endpoints: success, 401, validation errors.
- WS contract tests ensuring every emitted event is consumed or explicitly deprecated.
- End-to-end action confirmation scenario (proposal -> confirm -> executed).
- End-to-end blocked scenario (proposal -> disconnect -> confirm -> blocked).
- Memory preference sync scenario (read/write round-trip).
- No-key adapter mode scenario for voice progression and user-visible fallbacks.
