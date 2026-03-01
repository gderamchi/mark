# Mark Voice Action Agent

Authenticated voice-first web app using:
- Supabase (Google OAuth + persistent audit storage)
- Composio (connectable app catalog + tool execution)
- Anthropic (reasoning + tool orchestration + draft revision)
- ElevenLabs (one-shot STT + streaming TTS)
- Speechmatics (STT/TTS fallback providers)

Flow:
- Browser records utterances, auto-detects end-of-speech, encodes to MP3, and sends one-shot audio for STT.
- Agent can auto-execute read tools.
- Mutating tools create pending drafts and require explicit approval/rejection.
- Approval loop supports iterative voice revisions.
- Gmail triage supports relative windows such as `last hour` (mapped to `newer_than:1h`).
- In Gmail triage mode, the agent can prepare draft-reply actions for approval directly from the selected email.

## Requirements

- Node.js 20+
- pnpm 10+

## Setup

```bash
pnpm install
cp apps/server/.env.example apps/server/.env.local
cp apps/web/.env.example apps/web/.env.local
# fill keys in both .env.local files
```

Required server env keys:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `COMPOSIO_API_KEY`
- `COMPOSIO_CONNECT_CALLBACK_URL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (recommended: `claude-haiku-4-5`)
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_STT_MODEL_ID` (default `scribe_v1`)
- `SPEECHMATICS_API_KEY` (optional fallback)
- `SPEECHMATICS_TTS_BASE_URL` (optional fallback, default provided)
- `SPEECHMATICS_TTS_VOICE` (optional fallback, default `sarah`)
- `SPEECHMATICS_TTS_OUTPUT_FORMAT` (optional fallback, default `wav_16000`)

Required web env keys:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` (optional, defaults to `http://localhost:4000`)

Supabase schema:
- The schema is now a Supabase CLI migration in [`supabase/migrations/20260301042017_init_agent_action_schema.sql`](/Users/guillaume_deramchi/Documents/mark/supabase/migrations/20260301042017_init_agent_action_schema.sql).
- Apply it with:
  - `supabase link --project-ref <your-project-ref>`
  - `supabase db push`

Supabase CLI bootstrap done in this repo:
- [`supabase/config.toml`](/Users/guillaume_deramchi/Documents/mark/supabase/config.toml) initialized
- [`supabase/seed.sql`](/Users/guillaume_deramchi/Documents/mark/supabase/seed.sql) created
- auth redirect defaults updated to `http://localhost:5173`

## Run

```bash
pnpm dev
```

- Web UI: `http://localhost:5173`
- API: `http://localhost:4000`
- Voice health: `http://localhost:4000/health/voice`

## Scripts

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm test
```

## Notes

- Authentication is mandatory for action-capable sessions.
- General chat memory remains in-memory and can reset on restart.
- Gmail triage workflow memory (selection/draft/sent progress) is persisted locally in `apps/server/.runtime/email-workflows.json`.
- Action/audit persistence is available when Supabase schema is applied.
- STT/TTS priority is ElevenLabs first, then Speechmatics fallback.
- Real credentials should stay in `.env.local` only.
