# Mark

Hands-free voice assistant MVP (Expo React Native iOS + NestJS) with Speechmatics STT, ElevenLabs TTS, Backboard, and Composio adapters.

## Workspaces

- `apps/api`: NestJS orchestrator backend.
- `apps/mobile`: Expo iOS-first app (dev client ready).
- `packages/contracts`: shared API and event contracts.
- `packages/ui`: reusable React Native UI primitives.
- `infra/docker`: self-host stack and ops scripts.

## Quickstart

1. Install and configure:

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
```

2. Start backend:

```bash
pnpm --filter @mark/api dev
```

3. Point mobile to your reachable backend URL (LAN/public):

```bash
# apps/mobile/.env
EXPO_PUBLIC_API_BASE_URL=https://your-public-api-domain.tld
```

4. Start mobile app:

```bash
# Expo Go (QR code)
pnpm --filter @mark/mobile start

# If Expo starts in development build mode, press `s` in the terminal
# to switch to Expo Go and scan the displayed QR code.

# Dev client mode (optional)
pnpm --filter @mark/mobile dev
```

5. Build iOS dev client (first time):

```bash
pnpm --filter @mark/mobile ios
```

6. Quality gates:

```bash
pnpm --filter @mark/api test
pnpm typecheck
pnpm --filter @mark/mobile run doctor
```

## Environment

Copy `.env.example` files in app workspaces and fill credentials.

For voice reliability:
- Set `ELEVENLABS_API_KEY` and `SPEECHMATICS_API_KEY` in `apps/api/.env`.
- Optionally tune STT with `SPEECHMATICS_RT_URL`, `SPEECHMATICS_LANGUAGE`, `SPEECHMATICS_ENABLE_PARTIALS`, and `SPEECHMATICS_MAX_DELAY_SECONDS`.
- `SPEECHMATICS_LANGUAGE` should be set (default in code and env example: `en`).
- If Speechmatics STT keys are missing, the API runs in fallback mode and emits diagnostic status events.
- Check voice readiness at `GET /health/voice` (`sttConfigured`, `ttsConfigured`, `lastSttErrorAt`, `mode`).

## Debug Logging Mode

To trace the full login + voice flow end-to-end, enable debug logging on both sides:

```bash
# apps/api/.env
APP_DEBUG_LOGS=true

# apps/mobile/.env
EXPO_PUBLIC_DEBUG_LOGS=true
```

Then restart both processes:

```bash
pnpm --filter @mark/api dev
pnpm --filter @mark/mobile start
```

Debug output includes:
- API HTTP request/response traces (`[http] inbound/outbound ...`)
- API auth + voice pipeline events (`[debug] auth.*`, `[debug] stt.*`, `[debug] tts.*`)
- Mobile API requests, auth refresh, WS events, and mic chunk/commit forwarding (`[debug][api|ws|voice|voice-io] ...`)

## Notes

- Mobile auth is email/password (`/v1/auth/register`, `/v1/auth/login`).
- HTTP endpoints are protected by JWT bearer auth (except `/health` and auth routes).
- WebSocket `/v1/session` requires `Authorization: Bearer <accessToken>`.
