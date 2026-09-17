# Deskline — Build Specification

**How to use this document:** paste it as the opening context for a coding agent (Claude Code, Cursor, or equivalent). Work through Section 14 in order. Do not attempt to build the whole system in one pass.

---

## 0. Instructions to the agent

You are building a production system, not a demo. Follow these rules throughout:

1. **Build in the milestone order in Section 14.** Each milestone must be runnable and testable on its own before the next begins.
2. **Never let a language model produce a price, an availability date, or a unit name.** These come from database lookups exposed as tools. If a model output contains an unverified number, that is a defect.
3. **Multi-tenancy is structural, not a feature flag.** Every table carries `tenant_id`. Every query is scoped. There is no code path where tenant isolation is optional.
4. **When the spec is ambiguous, stop and ask** rather than inventing behaviour. Specifically: ask about pricing approval hierarchies, CRM field mappings, and commission logic — these vary per customer and guessing wastes work.
5. **Write tests for every algorithm in Section 7** before wiring it into a flow. These are the parts that break silently.
6. **Do not scaffold an admin panel, a billing page, or a settings screen** until Milestone 6. They absorb time and prove nothing.
7. Commit per logical unit with descriptive messages. Keep migrations reversible.

---

## 1. What the business is

The customer is a **commercial office space operator** — coworking, managed offices, private cabins, virtual offices — typically operating 3 to 60 centres across Indian metros. Examples of the category: Awfis, Smartworks, Table Space, IndiQube, plus hundreds of regional independents.

Deskline is sold **white-labelled** to these operators. Each operator is a tenant. Operators compete with each other, so data isolation is a commercial requirement, not just a technical one.

**The problem being solved:** operator sales teams are slow and leaky. A lead from a portal or a Google ad waits hours for a first response. Key Account Managers (KAMs) spend the first twenty minutes of every conversation asking the same eight questions. Nothing gets logged, so managers cannot see the pipeline, and when a KAM resigns their deals leave with them.

**What Deskline does:**
- Captures leads from every channel into one normalised record
- Qualifies them with an AI agent over voice and chat, in minutes rather than hours
- Matches the requirement against live inventory and sends a tracked shortlist
- Hands the qualified lead to the right KAM with full context
- Captures every subsequent interaction automatically so the CRM fills itself
- Runs follow-up cadences, tour scheduling and reactivation without human effort
- Gives managers pipeline truth and demand intelligence

---

## 2. Users

| Role | Primary job | Interface |
|---|---|---|
| **Client** (prospective tenant) | Find office space fast | Voice call, WhatsApp, web chat, shortlist microsite |
| **KAM** | Close deals; avoid admin | Web app + mobile; WhatsApp for quick actions |
| **Centre manager** | Run tours, confirm availability | Light mobile view |
| **Sales head** | Pipeline truth, team performance, pricing discipline | Manager dashboard |
| **Operator admin** | Inventory, pricing rules, users, branding | Admin console |
| **Platform admin** (you) | Tenant provisioning, usage, billing | Internal console |

---

## 3. Non-negotiable principles

**Grounding.** Every factual claim the agent makes about inventory, price, or availability must originate from a tool call returning a database row. The model composes language around retrieved facts; it never supplies the facts.

**Capture-first.** The CRM is an output of the system, not an input to it. If a piece of data requires a human to type it into a form, assume it will not exist. Design every interaction so the record writes itself.

**Schema-first.** The `Requirement` object defined in Section 6 is the lingua franca. Every channel produces one. Every match query consumes one. Every CRM sync serialises one.

**Latency budget.** Voice turn latency (end of client speech → start of agent speech) must stay under 800ms at p50 and 1200ms at p95. Anything slower feels broken on a phone call and the client hangs up.

**Hinglish by default.** Indian commercial real estate conversations code-mix constantly. Every STT and TTS choice must be validated against real recorded Hinglish calls before adoption, not against English benchmarks.

---

## 4. Architecture

```
┌─────────────────────── INGESTION ────────────────────────┐
│ Voice (Exotel/Ozonetel/Plivo/Twilio)                     │
│ WhatsApp (Cloud API or BSP: Gupshup/AiSensy/Interakt)    │
│ Email parser (IndiaMART, 99acres, Magicbricks, direct)   │
│ Web form + web chat widget                               │
│ CRM webhooks (HubSpot, Zoho, LeadSquared, Salesforce)    │
└───────────────────────────┬──────────────────────────────┘
                            ▼
                   ┌────────────────┐
                   │  Normaliser    │  → canonical Lead + Contact
                   │  + Dedup       │  → broker/duplicate detection
                   └───────┬────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │      QUALIFICATION ENGINE            │
        │  slot extraction · confidence ·      │
        │  next-question selection · barge-in  │
        │  TOOLS: search_inventory,            │
        │         check_availability,          │
        │         get_price_band,              │
        │         book_tour, transfer_to_kam   │
        └──────────────┬───────────────────────┘
                       ▼
   ┌───────────────┐   ┌───────────────┐   ┌──────────────┐
   │  MATCHING     │   │  SCORING      │   │  ROUTING     │
   │  hard filter  │──▶│  fit × value  │──▶│  capacity +  │
   │  + soft rank  │   │  × urgency    │   │  market +    │
   └───────────────┘   └───────────────┘   │  language    │
                                            └──────┬───────┘
                       ┌───────────────────────────┘
                       ▼
        ┌──────────────────────────────────────┐
        │   ORCHESTRATION (Temporal)           │
        │   cadences · SLA timers · tours ·    │
        │   reactivation · renewals            │
        └──────────────┬───────────────────────┘
                       ▼
   ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌────────────┐
   │ Shortlist│  │ KAM app   │  │ Manager  │  │ CRM        │
   │ microsite│  │ + copilot │  │ dashboard│  │ write-back │
   └──────────┘  └───────────┘  └──────────┘  └────────────┘
```

**Stack:**
- Backend: TypeScript / Node (Fastify or NestJS). Python only if a specific ML need forces it.
- Database: PostgreSQL 15+ with `pgvector` for soft preference matching. Row-level security scoped by `tenant_id`.
- Queue/workflow: Temporal for anything long-running or retried. Do not use cron.
- Cache/rate limiting: Redis.
- Object storage: S3-compatible for recordings, floor plans, KYC docs.
- Voice agent: start with a managed framework (LiveKit Agents, Vapi, or Retell). Do not build a custom audio pipeline in Milestone 1.
- Frontend: React + Vite, TypeScript, Tailwind. TanStack Query for server state.
- Auth: Auth.js or Clerk, with tenant-scoped RBAC.

---

## 5. Product taxonomy

```
ProductType = HOT_DESK | DEDICATED_DESK | PRIVATE_CABIN |
              MANAGED_SUITE | VIRTUAL_OFFICE | MEETING_ROOM | DAY_PASS
```

Serving rules:
- `VIRTUAL_OFFICE`, `DAY_PASS`, `MEETING_ROOM` → **fully self-serve**, no KAM, close end-to-end including KYC upload and payment.
- `HOT_DESK`, `DEDICATED_DESK` under 10 seats → agent handles through to booking; KAM notified only.
- `PRIVATE_CABIN`, `MANAGED_SUITE`, or anything above 10 seats → qualify, shortlist, then hand to KAM.

---

## 6. Data model

### Core entities

```sql
tenant(id, name, slug, branding_json, custom_domain, locale_default,
       plan, created_at)

centre(id, tenant_id, name, micro_market, city, lat, lng,
       address, amenities_json, operating_hours, active)

floor(id, centre_id, label, total_seats)

unit(id, tenant_id, centre_id, floor_id, label, product_type,
     seats, sqft, list_price_per_seat, floor_price_per_seat,
     available_from, status,            -- AVAILABLE|HELD|OCCUPIED|BLOCKED
     amenities_json, images_json, floor_plan_url, tour_url,
     updated_at, source)                -- MANUAL|OFFICERND|NEXUDUS|SHEET

company(id, tenant_id, name, industry, size_band, funding_stage,
        current_office, gst_number, website)

contact(id, tenant_id, company_id, name, phone_e164, email,
        role_title, decision_role,      -- DECISION_MAKER|INFLUENCER|ADMIN|BROKER
        preferred_language, consent_json)

lead(id, tenant_id, company_id, contact_id, channel, source, campaign,
     requirement_id, stage, score, est_contract_value,
     owner_kam_id, sla_due_at, created_at, closed_at, loss_reason,
     broker_id, parent_lead_id)         -- parent_lead_id set on dedup merge

requirement(id, tenant_id, lead_id, version,
            seats_min, seats_max, seats_horizon_12m,
            product_type, micro_markets text[],
            budget_per_seat_max, budget_is_hard,
            tenure_months, lock_in_appetite,
            move_in_date, urgency_trigger,
            parking_count, amenities_required text[],
            compliance_json,             -- gst, kyc, sez, fire_noc
            slot_confidence jsonb,       -- {seats: 0.94, budget: 0.71, ...}
            embedding vector(768),
            created_at)

interaction(id, tenant_id, lead_id, actor_type,   -- AI|KAM|CLIENT|SYSTEM
            actor_id, channel, direction,
            started_at, duration_s,
            recording_url, transcript_url,
            extracted_json,               -- slot updates, objections, competitors
            captured)                     -- boolean: on-platform or reconstructed

proposal(id, tenant_id, lead_id, slug, unit_ids uuid[],
         quoted_prices jsonb, sent_at, expires_at)

proposal_event(id, proposal_id, type,     -- OPEN|UNIT_VIEW|DOWNLOAD|CTA_CLICK
               unit_id, dwell_ms, ip_hash, at)

tour(id, tenant_id, lead_id, centre_id, scheduled_at, status,
     attended_by, outcome, feedback_json)

quote(id, tenant_id, lead_id, unit_id, price_per_seat,
      discount_pct, approval_status, approved_by, created_by)

kam(id, tenant_id, user_id, name, markets text[], languages text[],
     capacity_max, active)

cadence_run(id, tenant_id, lead_id, template_id, step_index,
            next_fire_at, status)
```

### Indexes that matter

```sql
CREATE INDEX ON unit (tenant_id, product_type, seats, status, available_from);
CREATE INDEX ON lead (tenant_id, stage, sla_due_at);
CREATE INDEX ON interaction (tenant_id, lead_id, started_at DESC);
CREATE INDEX ON requirement USING ivfflat (embedding vector_cosine_ops);
CREATE UNIQUE INDEX ON contact (tenant_id, phone_e164);
```

---

## 7. Algorithms

### 7.1 Slot extraction with confidence

After each client turn, run structured extraction against the transcript window (last 6 turns for context).

```
extract(turn_text, context_window, current_requirement) -> SlotDelta[]

SlotDelta = {
  slot: string,
  value: any,
  confidence: float,   // 0..1
  evidence: string     // verbatim span supporting the value
}
```

Rules:
- Require `evidence` to be a literal substring of the transcript. If the model returns evidence not present in the text, **discard the delta** — it is hallucinating.
- Confidence bands: `>= 0.85` accept silently. `0.60–0.85` accept but mark for confirmation. `< 0.60` discard and re-ask.
- Never overwrite a high-confidence slot with a lower-confidence one unless the client explicitly corrects ("actually, make that 28").
- Store every version of `requirement` — do not update in place. Requirement drift over a deal's life is valuable signal.

### 7.2 Next-question selection

Do not ask slots in a fixed order. Choose the next question by expected information value.

```
score_slot(s) = w_match(s) × (1 - confidence(s)) × askability(s)

w_match:     how much this slot narrows the inventory set
             seats 1.0, product 1.0, market 0.9, budget 0.8,
             move_in 0.5, tenure 0.4, parking 0.3, authority 0.3
askability:  penalty for asking sensitive things early
             budget 0.5 before turn 4, then 1.0
             authority 0.4 before turn 6, then 1.0

next = argmax(score_slot) over unfilled or low-confidence slots
```

Stop conditions:
- All slots with `w_match >= 0.8` are filled at confidence `>= 0.85`, **or**
- Turn count exceeds 14, **or**
- Client signals impatience (detected: interruptions > 2, or explicit phrases)

On stop, run matching immediately and present options. Never end a call without giving the client something concrete.

### 7.3 Inventory matching

Two stages. Hard filters in SQL, soft ranking after.

**Stage 1 — hard filter:**
```sql
SELECT * FROM unit
WHERE tenant_id = $1
  AND status = 'AVAILABLE'
  AND product_type = $2
  AND seats BETWEEN $3 * 0.8 AND $3 * 1.5
  AND available_from <= $4 + INTERVAL '30 days'
  AND (NOT $5 OR list_price_per_seat <= $6)   -- $5 = budget_is_hard
  AND centre_id IN (SELECT id FROM centre WHERE micro_market = ANY($7))
```

If fewer than 3 rows, relax in this order and **tell the client what was relaxed**:
1. widen micro-market to adjacent markets (maintain an adjacency table — Cyber City ↔ Golf Course Road ↔ Udyog Vihar)
2. widen the seat band to `0.7×` – `2.0×`
3. allow `available_from` up to +60 days
4. allow price up to `1.1 ×` budget **only if** `budget_is_hard = false`

Never relax past these. Showing a ₹19,000 unit to someone with a hard ₹14,000 ceiling destroys trust and wastes a KAM's time.

**Stage 2 — rank:**
```
fit(unit, req) =
    0.30 × seat_fit         // 1 - |unit.seats - req.seats| / req.seats, floored at 0
  + 0.25 × price_fit        // 1 - max(0, unit.price - req.budget) / req.budget
  + 0.20 × market_fit       // 1.0 exact, 0.6 adjacent, 0.3 same city
  + 0.15 × timing_fit       // 1.0 if available <= move_in, decaying 0.02/day after
  + 0.10 × amenity_fit      // |matched required amenities| / |required amenities|

Return top 3. Never more than 5 — choice paralysis kills conversion.
```

Add a diversity constraint: if the top 3 are all in one centre, swap the third for the best unit from a different centre. Clients want to feel they have options.

### 7.4 Price governance

```
quote_price(unit, req, kam):
  base = unit.list_price_per_seat
  auto_floor = unit.floor_price_per_seat

  allowed_discount = tenant.discount_ladder(req.tenure_months, req.seats)
  // e.g. 24mo + 25 seats → up to 12%

  proposed = base × (1 - allowed_discount)

  if proposed >= auto_floor:
      status = AUTO_APPROVED
  else:
      proposed = auto_floor
      status = NEEDS_APPROVAL     // route to sales head, do not quote below floor
```

The AI agent may quote down to `auto_floor` without human involvement. Below floor is never quoted by the agent under any circumstance. Log `discount_pct` on every quote — it feeds the discount discipline metric.

### 7.5 Lead scoring

```
score = 100 × normalise(
    0.35 × value_component
  + 0.25 × urgency_component
  + 0.20 × fit_component
  + 0.20 × engagement_component
)

value_component     = log1p(seats × budget × tenure_months) / log1p(MAX_DEAL)
urgency_component   = 1.0 if move_in <= 30d
                      0.7 if <= 60d
                      0.4 if <= 120d
                      0.2 otherwise
                      +0.15 if urgency_trigger in (LEASE_EXPIRY, FUNDING, NEW_TEAM)
fit_component       = best_match_fit_score (from 7.3)
engagement_component= min(1.0,
                        0.3 × proposal_opens
                      + 0.4 × (dwell_seconds / 180)
                      + 0.3 × unit_clicks)
```

Recompute on every interaction and every proposal event. Store the delta — a score that jumped 20 points overnight is the single best trigger for a KAM's morning call list.

### 7.6 Routing

```
eligible = KAMs where:
    req.micro_market ∈ kam.markets
    AND contact.preferred_language ∈ kam.languages
    AND kam.active_leads < kam.capacity_max
    AND kam.active = true

rank by:
    0.4 × (1 - current_load / capacity_max)
  + 0.3 × historical_win_rate(kam, product_type, seat_band)
  + 0.3 × availability_now          // online, not on a call

if eligible is empty:
    → route to the market's team lead
    → raise a capacity alert on the manager dashboard
```

**Handoff payload** (delivered as a WhatsApp card and an in-app notification):
requirement summary, matched units with quoted prices, full transcript link, score with the top three contributing reasons, competitor mentions, and one suggested opening line.

**SLA:** `sla_due_at = now + tenant.sla_minutes` (default 10 for score ≥ 70, 30 otherwise). On breach, escalate to the team lead and reassign after 2× SLA.

### 7.7 Deduplication and broker conflict

This is unglamorous and will cause more support tickets than anything else if skipped.

```
on new lead:
  candidates = leads WHERE tenant_id = same
                 AND created_at > now - 90 days
                 AND (
                      contact.phone_e164 matches
                   OR normalise(company.name) similarity > 0.85
                   OR (email domain matches AND domain not in free_providers)
                 )

  for each candidate:
    if same contact AND same requirement shape  → MERGE into parent
    if different contact, same company          → LINK as sibling, alert both owners
    if either contact.decision_role = BROKER    → flag BROKER_CONFLICT,
                                                  route to team lead for arbitration,
                                                  freeze auto-cadences
```

Never silently merge across different owners. Lead ownership disputes are political; surface them to a human.

### 7.8 Capture coverage

The metric that makes CRM discipline visible without a mandate.

```
coverage(lead) = captured_interactions / estimated_total_interactions

estimated_total = captured_interactions
                + inferred_dark_interactions

inferred_dark_interactions:
  + calls to the KAM's personal number from a known lead contact,
    detected via telco CDR if available
  + gaps: any stage advance with zero captured interactions since
    the previous stage
  + client-reported: "as I told you yesterday" detected in a
    captured transcript with no matching prior interaction
```

Roll up per KAM and per centre. Surface as a coaching metric, framed as *"we have no record of how this deal was won, so we can't repeat it"* — never as surveillance. The framing is load-bearing for adoption.

### 7.9 Cadence engine

Model cadences as Temporal workflows, one per lead.

```
Cadence = ordered steps, each:
  { delay, channel, template, skip_if, stop_if }

Default post-shortlist cadence:
  T+2h    WhatsApp   "did the options land"      skip_if proposal.opened
  T+1d    Call task  → assigned to KAM           skip_if interaction since send
  T+2d    Email      2 alternative units         skip_if tour booked
  T+4d    WhatsApp   tour offer with 3 slots     skip_if tour booked
  T+7d    Call task  final                       stop_if no response
  T+14d   → move to NURTURE, monthly touch

Global stop conditions (checked before every step):
  - lead closed (won or lost)
  - client opts out
  - KAM manually pauses
  - quiet hours: never fire 21:00–09:00 local
  - DND / DLT scrub fails for the number
```

Cadence steps fire only if `next_step` and `next_step_date` exist on the lead. This is the mechanism that makes logging pay for itself — the KAM logs because the automation stops working if they don't.

### 7.10 Reactivation

Runs nightly.

```
for lead in leads where stage in (NURTURE, LOST) and closed_at > now - 18mo:
    triggers = []
    if new unit matches lead.requirement  → triggers += INVENTORY_MATCH
    if lead.move_in_date within 60d       → triggers += TIMING
    if company headcount grew > 30%       → triggers += GROWTH  (enrichment)
    if lease_expiry_estimate within 90d   → triggers += LEASE

    if triggers non-empty and last_contact > 45d:
        queue outbound reactivation (voice for score >= 60, WhatsApp below)
```

This is the highest-ROI surface in the product and the best pilot. Every operator has thousands of dead leads and near-zero downside risk in working them.

### 7.11 Demand gap report

```
For each (product_type, seat_band, micro_market) cell:
    demand  = count of qualified requirements matching cell
    supply  = count of units available in cell during the period
    lost    = count of leads in cell with loss_reason = NO_INVENTORY
    value_lost = lost × seat_band_mid × blended_price × 12

Rank cells by value_lost descending.
```

Ship this as a monthly PDF to the operator's leasing head. It frequently justifies the subscription on its own and gets you a second buyer inside the account.

---

## 8. Flows

### 8.1 Inbound voice call

```
1.  Telephony webhook → create/lookup contact by caller ID
2.  Load tenant config: agent persona, language, greeting
3.  If known contact: greet by name, load prior requirement
4.  Stream audio → STT (with endpointing, barge-in enabled)
5.  Per turn: extract slots (7.1) → select next question (7.2)
6.  When enough slots filled: call search_inventory tool (7.3)
7.  Read back top 3 with prices from the tool result only
8.  Offer: shortlist on WhatsApp | tour booking | transfer to KAM
9.  Score (7.5) → route (7.6) → handoff payload
10. Write interaction, transcript, recording, requirement version
11. Fire CRM write-back
12. Start cadence (7.9)
```

**Consent:** announce recording at the start of every call, in the client's language, before any capture begins.

### 8.2 WhatsApp qualification

Same engine, different pacing. Batch 2–3 questions per message rather than one per turn. Use interactive list and button messages for enumerable slots (product type, tenure, move-in window) — tapping beats typing and the extracted value arrives at confidence 1.0.

Send the shortlist as a link preview card, never as a PDF attachment. PDFs are untrackable and die in the chat.

### 8.3 Shortlist microsite

Per-lead slug, no login. Shows the three matched units with images, floor plans, quoted price, and a tour CTA. Every interaction emits a `proposal_event`. Expiry after 14 days, configurable, with a "request fresh options" fallback that re-runs matching.

Telemetry from this surface is more honest than anything the client says on a call. Feed it straight into `engagement_component` (7.5).

### 8.4 Handoff to KAM

Warm transfer where the KAM is available and the call is live: whisper-brief the KAM for 8 seconds, then bridge. Otherwise send the handoff card and start the SLA timer.

The KAM's first action is one tap: **Call now** (click-to-call through the platform, number-masked) or **Snooze with reason**.

### 8.5 Automatic CRM write-back

After every captured interaction:

```
1. Transcript → extraction: stage, next_step, next_step_date,
   objections, competitors, updated slots
2. Build a proposed diff against the current lead record
3. If all fields confidence >= 0.85 → apply, notify KAM
   ("updated 3 fields — tap to correct")
4. If any field < 0.85 → send one-tap confirmation card
5. Sync to the operator's CRM via connector, field-mapped per tenant
6. Never block on CRM sync; queue and retry
```

The KAM never sees a blank form. They only ever confirm or correct.

### 8.6 Tour lifecycle

Book against centre manager calendars with real capacity. Confirmations and reminders at T-24h and T-2h. QR check-in at reception writes attendance automatically. Post-tour, a one-tap outcome card to the KAM and a two-question feedback message to the client. No-shows trigger a recovery cadence.

### 8.7 Close

Generate LOI or term sheet from a tenant template → e-sign (Digio, Leegality, or Zoho Sign) → payment link → handoff to ops with a move-in checklist, seat allocation and access card request. Set a renewal reminder at T-90 days from contract end.

---

## 9. Integrations

| Category | Priority | Notes |
|---|---|---|
| Telephony | P0 | Exotel or Ozonetel for India. Need number masking and CDR access. |
| WhatsApp | P0 | Cloud API direct, or a BSP. Template approval takes 2–5 days — start early. |
| Inventory | P0 | OfficeRnD, Nexudus, Optix + a Google Sheets/CSV fallback and a manual UI. Most independents have no system; onboarding stalls without the fallback. |
| CRM | P1 | HubSpot, Zoho, LeadSquared, Salesforce. Field mapping is per-tenant config, not code. |
| Portals | P1 | IndiaMART, 99acres, Magicbricks — mostly email parsing, some have APIs. |
| Calendar | P1 | Google and Outlook, for tours and KAM availability. |
| E-sign | P2 | Digio or Leegality. |
| Payments | P2 | Razorpay. |
| Enrichment | P2 | For headcount and funding signals feeding reactivation. |

Build every connector behind a common interface (`InventoryProvider`, `CrmProvider`) so adding the fourth takes a day, not a week.

---

## 10. Frontend

### Screens

**KAM**
- `Leads` — list with SLA countdown, fit score, channel, off-platform flag; detail pane with requirement grid (per-slot confidence), matched inventory with floor price visible, shortlist engagement, activity timeline, one-tap outcome logger, AI-proposed record updates
- `Today` — ranked call list with the reason each deal surfaced
- `Live call` — active call view with real-time slot filling

**Manager**
- `Pipeline` — funnel, first-response trend, qualified rate, revenue at risk
- `Team` — per-KAM table including capture coverage and discount discipline; silent-deal alerts
- `Demand` — demand vs supply gaps, competitor quotes heard on calls

**Admin**
- Inventory, pricing ladders, users and capacity, cadence templates, branding, integrations

### Interaction rules

- Every logging action is **one tap or zero taps**. No free-text field is ever required.
- Voice notes are a first-class input: a KAM records 30 seconds after a site visit, the system parses it into fields.
- Mobile is not a secondary target. KAMs work from cars and building lobbies.
- The lead detail must be readable and actionable on a 380px viewport.

### Design tokens

```
ink        #141C24    primary text, active chrome
ink2       #2B3947    secondary text
slate      #5F6E7D    labels
mute       #8A98A6    metadata
paper      #F4F6F4    app background
card       #FFFFFF    surfaces
rule       #E2E6E3    hairlines
blue       #2748B8    AI / live / primary action
green      #2E6B4F    confirmed, healthy
amber      #8F5D10    needs attention
red        #9E2B20    breach, risk

Type: Archivo, 400/500/600/700. Tabular numerals for all figures,
timers and IDs. Sentence case throughout. No all-caps labels.
```

A working reference implementation of these screens exists as `deskline-prototype.jsx`. Match its information architecture; improve its polish.

---

## 11. White-label

Per-tenant configuration, all data-driven, never forked code:

- Branding: logo, colours, custom domain, email and WhatsApp sender identity
- Agent persona: name, voice, languages, greeting, escalation phrasing
- Pricing: discount ladders, floor price rules, approval thresholds
- Inventory source and sync cadence
- CRM target and field mapping
- Cadence templates
- SLA thresholds and routing weights

**Onboarding target: signup to first test call in under one working day, self-serve.** If onboarding requires your engineers, you are an agency, not a platform. Build the wizard: create tenant → import inventory (CSV or connector) → set pricing → provision number → place test call.

**Isolation:** Postgres row-level security plus tenant-scoped connection contexts. Separate S3 prefixes. Per-tenant encryption keys for recordings. Expect a security questionnaire in every deal — your buyers compete with each other.

**Metering:** per-minute voice, per-message WhatsApp, per-qualified-lead. Log usage events from day one even before billing exists; retrofitting metering is painful.

---

## 12. Compliance (India)

- **DPDP Act 2023** — consent capture with purpose, retention policy per data class, deletion on request, breach notification path.
- **Call recording** — announce at call start in the client's language, before capture.
- **TRAI / DLT** — register headers and templates for SMS. Scrub against DND before outbound. This is a legal requirement with real penalties, not a nicety.
- **WhatsApp** — opt-in required; respect the 24-hour session window; use approved templates outside it.
- **AI disclosure** — the agent identifies itself as automated when asked. Do not let it claim to be human.
- **KYC** — virtual office KYC has statutory requirements. Store documents encrypted, access-logged, with a defined retention period.
- **Data residency** — offer India-region hosting; enterprise operators will ask.

---

## 13. Guardrails and failure handling

| Failure | Behaviour |
|---|---|
| Inventory tool returns empty | Agent says so honestly, offers the nearest alternatives with the relaxation stated, captures the gap as `NO_INVENTORY` loss reason |
| Model output contains an unsourced number | Block the turn, re-generate from tool results, log for review |
| STT confidence below threshold | Ask the client to repeat once, then offer to continue over WhatsApp |
| Client asks something out of scope (legal, contract terms) | Transfer to human, do not improvise |
| Client is angry or asks for a human | Transfer immediately, no retention attempt |
| CRM sync fails | Queue and retry with backoff; never block the user flow |
| Inventory sync stale > 24h | Banner on the KAM dashboard; agent adds "let me confirm current availability" before quoting |
| Latency exceeds 1.5s | Play a natural filler, and if repeated, offer a callback |

**Test set:** maintain 200+ real recorded Hinglish calls as a regression suite. Every prompt or model change runs against them before shipping. Measure slot accuracy, hallucinated-fact rate, and turn latency.

---

## 14. Build order

**M1 — Foundation (2 weeks).** Tenant model, RLS, auth, RBAC. Inventory schema with CSV import and manual UI. Requirement schema. Matching algorithm (7.3) with tests. No AI yet.

**M2 — Chat qualification (3 weeks).** WhatsApp + web capture. Slot extraction (7.1), next-question selection (7.2), grounded tool calls. Shortlist microsite with tracking. Scoring (7.5) and routing (7.6). CRM write-back for one CRM.

**M3 — KAM app (2 weeks).** Lead inbox, detail view, one-tap logging, AI-proposed updates, click-to-call with number masking, Today list. Cadence engine (7.9).

**M4 — Outbound voice on dead leads (3 weeks).** Voice stack, Hinglish validation, reactivation triggers (7.10). *This is the milestone that produces a provable ROI number for the pilot, with minimal downside risk.*

**M5 — Inbound voice (3 weeks).** Live inbound qualification, warm transfer, tour booking, latency tuning.

**M6 — Manager surface (2 weeks).** Pipeline dashboard, capture coverage (7.8), silent-deal alerts, demand gap report (7.11).

**M7 — Platform (3 weeks).** Self-serve onboarding wizard, admin console, metering, second and third inventory connectors, second CRM.

---

## 15. Acceptance criteria

Ship nothing that fails these.

1. A WhatsApp lead is qualified and receives a matching shortlist in under 3 minutes, unattended.
2. Across 100 test conversations, zero prices or availability dates appear that do not match a database row.
3. A KAM can log a call outcome in one tap, and the CRM record updates without them typing.
4. Voice turn latency: p50 < 800ms, p95 < 1200ms on Indian mobile networks.
5. Slot extraction accuracy ≥ 90% on the Hinglish regression set for seats, product, market and budget.
6. Tenant A cannot read any row belonging to Tenant B, verified by automated test.
7. A new operator can go from signup to a working test call in under one working day with no engineering support.
8. Every outbound message respects quiet hours, DND and opt-out, verified by automated test.
9. Duplicate leads from the same contact within 90 days are merged or flagged, never silently duplicated.
10. The system degrades gracefully with stale inventory: it warns rather than quoting confidently wrong.

---

## 16. What to ask the client before starting

Do not guess these:

1. Which inventory system do the design-partner operators actually use, and can you get API credentials in week one?
2. What is the discount ladder — who can approve what, at what depth?
3. Which CRM, and what are the exact field names to map to?
4. Which micro-markets, and what is the adjacency map between them?
5. What languages beyond English and Hindi — Kannada, Tamil, Marathi, Telugu?
6. Is the first customer a large operator with an existing CRM and ops team, or a 50–500 seat independent with neither? The product shape diverges sharply: the first needs deep integrations, the second needs Deskline to *be* their CRM.
