Deskline v1.7 — real-time activity stream, voice agent

# Deskline Complete v1.7

Deskline is a sales-agent operating system for workspace/proptech teams: it captures leads, qualifies them with AI, matches live inventory, and hands warm leads to a human rep.

## New in v1.5

- **Concurrent lead conversations.** A new "Conversations" tab lets you open several leads side by side, each with its own live chat thread. The agent extracts requirements, matches inventory and replies to every open thread independently — so it can genuinely be "talking" to multiple leads at once. Backed by `GET/POST /api/leads/:id/messages`.
- **Team roster with Excel import.** A new "Team" tab lets you upload an `.xlsx`/`.xls`/`.csv` file with your team's `name`, `email`, `role`, `markets` and `capacity` columns. Deskline parses it in the browser (via SheetJS) and adds every teammate to the roster — no manual entry required. `POST /api/team/import` on the backend, plus `GET/POST/PUT/DELETE /api/team`.
- **Smart handoff routing.** Warm leads are now automatically routed to the least-loaded rep whose markets match the lead's requirement, instead of a hardcoded or empty owner.
- **Simplified naming.** "KAM Inbox" is now "Lead Inbox", the "KAM" role label is now "Sales Rep", and related copy throughout the app has been generalized so it isn't tied to key-account-manager-specific language. (If you'd prefer different terminology — e.g. "Agent", "Closer", your own team's title — it's a quick find-and-replace in `src/main.jsx`.)

## New in v1.7

### Real-time activity feed (P3)

Every write NIA makes is now pushed to the browser the moment it happens, over Server-Sent Events.

- **`GET /api/stream`** — tenant-wide feed. **`GET /api/leads/:id/stream`** — the same feed scoped to one lead.
- A new **Live Feed** tab shows decisions, call turns, messages, handoffs and SLA breaches as they land, with filters and a pause control that freezes the view without dropping the connection.
- The **lead drawer** keeps its own lead-scoped subscription, so an action taken by automation (or by a teammate) appears in that lead's timeline without a refresh.
- The header carries a live/reconnecting/offline indicator.

Two things worth knowing about the design. The stream is a **fan-out over writes that already happened**, not a second source of truth — nothing is broadcast that was not persisted first, so a client that never connects sees identical state on a normal refresh. And a pushed frame only tells the UI *that* something changed; the collections are still fetched normally (debounced), rather than the screen being patched together from event payloads that could drift.

Reconnects are handled: the server keeps a bounded replay buffer and honours `Last-Event-ID`, so a tab that loses its connection catches up on what it missed instead of leaving a hole.

### Voice agent (P4)

`BUILD_SPEC` §8.1 implemented as a real turn-by-turn state machine, on a new **Live Call** tab.

- **Consent first.** The recording announcement is delivered and answered before a single turn is accepted — the API returns `409` on any turn sent before consent. Declining ends the AI leg and opens a human handoff.
- **Live slot filling.** Each caller turn runs through the same `nia-brain` extraction the chat path uses; filled slots highlight in a requirement grid as they land, and the requirement is versioned every turn.
- **Grounded read-back.** The agent reads back the top 3 units **from the matcher result only**. With no match it says so; it never quotes a price without a matched unit.
- **Scoring, routing, transcript, metering** all run on call end, and voice usage is logged to `db.usage` from day one.
- **Latency is measured against the §4 budget** (p50 < 800ms, p95 < 1200ms) and shown per turn and in the call summary. The browser reports true end-to-end latency (caller stopped speaking → agent audio started), since the server can only time its own half.
- Hindi/Hinglish prompts alongside English.

**What is real and what is not.** Audio capture and playback are real — the Web Speech API, running locally in your browser. Everything downstream is the production path. What does *not* exist is a carrier leg: no Exotel/Ozonetel/Plivo/Twilio credentials are configured, so no PSTN call is placed or received. The app says this in a banner on the Live Call screen and marks such sessions `transport: 'simulated'`, rather than letting a demo imply otherwise — the same distinction the WhatsApp/email senders already make.

Set `VOICE_PROVIDER`, `VOICE_API_KEY` and `VOICE_FROM_NUMBER` and `GET /api/voice/status` flips to `configured: true`; `POST /api/voice/webhook` is the carrier entry point.

### Fixes and cleanup in this build

- **`src/main.jsx` used `useRef` without importing it.** This threw a `ReferenceError` the moment a Conversations thread rendered — the whole tab was broken.
- **No `vite.config.js` existed**, so despite `@vitejs/plugin-react` being a dependency, Vite never ran the JSX transform and `npm run dev` failed on the first tag. Added.
- **The agent could read back inventory matched against the previous turn's requirement** — it would cheerfully offer a Cyber Hub cabin one sentence after the caller said "Golf Course Road". The voice turn now extracts, persists, *re-matches*, then speaks.
- **`extractRequirement` did not understand spoken headcount.** "8 people" left the seats slot empty, so the agent asked "how many people would be using the space?" immediately after being told. `people`/`pax`/`persons`/`desks` now count.
- **Percentiles used floor interpolation**, which on the handful of samples one call produces reported p95 as the median and hid the slow turn. Now nearest-rank.
- **`POST /api/voice`** (the old single-turn endpoint) ran its own hand-rolled regexes and could disagree with the rest of the app. It now goes through the same engine.
- **Deleted `src/AutomationConsole.jsx` and `src/Prototype.jsx`** — orphaned, unwired, not part of the shipped app.

## New in v1.2 – v1.4

- Seed Demo entry at the bottom of the Lead Inbox.
- New lead flow: CRM entry → live qualification → inventory matching → shortlist → warming → human handoff.
- Connected automation controls for qualification, matching, shortlist, nurture/warm and handoff.
- Send Shortlist action on every lead with grounded inventory.
- Per-lead Voice on/off toggle in the inbox and lead drawer.
- Inventory redesigned as a vertical card/list experience with room-type illustrations.
- Demand Gap screen comparing lead demand clusters against available inventory.
- Local JSON persistence plus PostgreSQL/RLS production schema.

## Run locally

From the `deskline-app` directory:

```powershell
npm install
```

Then use two terminals:

```powershell
npm run api
```

and:

```powershell
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

## Team Excel import — expected columns

Any of these column names are recognized (case-insensitive), everything else is optional:

| Column | Notes |
|---|---|
| `name` | required |
| `email` | optional |
| `role` | defaults to "Sales Rep" |
| `markets` | comma/semicolon/pipe separated, e.g. `Golf Course Road; Cyber Hub` |
| `capacity` | defaults to 10 open handoffs |

## Tests

```powershell
npm test
```

Runs three suites:

| Script | Covers |
|---|---|
| `npm run test:brain` | Pure decision-engine units — intent, extraction, scoring, next-best-action, SLA, briefing |
| `npm run test:voice` | Voice engine and the realtime bus — consent, slot filling, grounded read-back, routing, latency percentiles, provider honesty, SSE fan-out/scoping/replay |
| `npm run test:api` | Full HTTP suite — health, inventory, leads, matching, CRUD, analytics, team import, concurrent messaging, the NIA journey tests, the SSE stream and voice sessions end to end |

`test:voice` and `test:brain` need nothing running. `test:api` needs `npm run api` in another terminal.

## Important

The application requires the npm dependencies in `node_modules`. If `vite is not recognized`, run `npm install` from the `deskline-app` directory first. This project now depends on `xlsx` (SheetJS) for the Team Excel import — it's already listed in `package.json`, so a normal `npm install` picks it up.

The backend can run independently with Node 22+ because it uses Node's built-in HTTP server for the local persistence mode.

The `dist/` folder is not included in this build — run `npm run build` to generate a fresh production build after `npm install`.

## v1.4 UX update
- Simplified primary navigation to Lead Inbox, Conversations, Dashboard, Demand Gap, Inventory, Team and Automation.
- Bookings, tours, handoffs and demand gap are surfaced inside Dashboard.
- Settings moved to the sidebar utility area.
- Seed Demo layout polished into a centered, aligned three-step flow.
