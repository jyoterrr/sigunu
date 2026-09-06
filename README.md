# Sigunu

A live video-chat platform for running interactive, team-based quizzes: a LiveKit video call, a
real-time leaderboard, team-private audio channels, and AI-assisted extraction of *existing* quiz
content from a PDF (the AI never invents questions).

Designed and load-targeted for **up to 100 concurrent participants in one session**.

---

## Decisions locked for this build

| Area | Decision | Notes |
|---|---|---|
| Frontend | React + TypeScript + Vite, `@livekit/components-react` | LiveKit's first-class SDK surface. |
| Backend | Node + TypeScript, Fastify | Shares types with the web app; native LiveKit server SDK. |
| Game-state transport | Server-authoritative **Socket.IO** rooms | Referee for answer-locking/scoring; room-scoped broadcast fan-out to 100 in one emit. **Not** LiveKit data channels (those can't enforce first-write-wins). |
| Database | PostgreSQL + Prisma | Atomic team-lock via a partial unique index; unique team names per session. |
| Scale cache / pub-sub | Redis (optional at single-node) | Socket.IO adapter + leaderboard cache; keeps broadcast horizontally scalable. |
| Video/audio | **LiveKit Cloud** | Env-configured keys; free tier covers all dev/testing. |
| AI extraction | Anthropic SDK, schema-constrained JSON | Extraction only — see below. |
| PDF handling | **Both** text + scanned | Direct text extraction, with a Claude-vision OCR fallback per page when no extractable text is found. |
| Unanswered scoring | **Quiz-master configurable** | Per-quiz toggle: score zero (default) vs. apply wrong-answer penalty. |
| Auth | **Lightweight** | Host gets a session control token on create; players join by code + display name (no accounts). All scoring/locking validated server-side. |

### Audio approach: single-room + track-level subscription permissions (chosen)

Team-only audio is enforced with LiveKit **server-side track subscription permissions**, not by
running a second room per team. Every participant holds **one** LiveKit connection.

- **Why not multi-room:** a second per-team room means each player holds two concurrent WebRTC
  connections for the whole session, roughly **doubling billable participant-minutes** at 100 users,
  plus a second lifecycle/reconnect path per player.
- **Trade-off accepted:** flipping a track's allowed-subscriber set on every audio-state change
  (team-only / open-to-all / mute) and re-applying it on reconnect is more intricate — judged
  cheaper than 2× participant-minutes.

**Hard privacy rule (no exceptions):** the quiz master — and anyone outside a team — can *never*
subscribe to a team's team-only audio. Enforced server-side: the grant is never issued. There is no
listen-in / spectate / override path, by design.

### Capacity note (verified)

LiveKit's 16-core benchmark sustains a 150-pub/150-sub 720p room at ~85% CPU, and a single room must
fit on a single node (LiveKit scales *across* rooms, not within one). 100-in-one-room is fine on
LiveKit Cloud **provided** selective track subscription and simulcast/dynacast are actually enforced
— no client ever subscribes to all video tracks by default.

---

## Structure

```
sigunu/
├── packages/shared/     # TS types shared by web + server
├── apps/server/         # Fastify + Socket.IO + Prisma + LiveKit server SDK + AI pipeline
└── apps/web/            # React + Vite + LiveKit client
```

## Build order

- [x] (a) LiveKit room join + basic video grid
- [x] (b) question/answer + team-locking logic (race-safe, DB-enforced)
- [x] (c) live leaderboard (teams + solo, single broadcast fan-out)
- [x] (d) selective rendering + adaptive per-tile resolution
- [x] (e) dual (three-state) audio channels (server-enforced team-only privacy)
- [x] (f) AI PDF quiz extraction (extraction only)
- [x] manual quiz builder with multi-image/video attachments + correct-answer marking
- [x] 5-question demo seed for testing

## Getting started

```bash
npm install
cp .env.example .env    # fill in LiveKit Cloud keys, Anthropic key (PDF only), Postgres URL
npm run db:push         # apply Prisma schema to your Postgres
npm run db:seed         # optional: create the 5-question demo quiz
npm run dev             # server (:4000) + web (:5173) together
```

Then open http://localhost:5173. To test with the seed: on the **Host** tab choose "Resume as
host", paste the seeded session id + host token (printed by `db:seed`), open the host console,
and have players join with code **TESTQZ** in other tabs/devices.

### What needs external setup (can't run without these)

- **Postgres** — any local or hosted instance; put its URL in `DATABASE_URL`.
- **LiveKit Cloud** — a free project at cloud.livekit.io; put URL + API key/secret in `.env`
  (and `VITE_LIVEKIT_URL`). Video/audio won't connect without it.
- **Anthropic API key** — only needed for the PDF-import feature; everything else works without it.

### Verified

`npm run typecheck` passes for server and web; `vite build` produces a production bundle. Live
video/audio behaviour (LiveKit connection, team-only track permissions) needs a LiveKit project +
multiple clients to exercise — see the note below.
