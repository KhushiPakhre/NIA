import assert from 'node:assert/strict';
import * as voice from './voice.mjs';
import * as realtime from './realtime.mjs';

const INVENTORY = [
  { id: 'A', unit: 'Cabin 704', centre: 'Vantage', market: 'Golf Course Road', seats: 8, price: 12500, score: 82 },
  { id: 'B', unit: 'Office 12A', centre: 'Vantage', market: 'Cyber Hub', seats: 12, price: 18000, score: 61 },
  { id: 'C', unit: 'Suite 3', centre: 'Vantage', market: 'Sector 44', seats: 10, price: 15000, score: 55 },
  { id: 'D', unit: 'Desk Row', centre: 'Vantage', market: 'Sector 44', seats: 6, price: 9000, score: 40 },
];
const MARKETS = ['Golf Course Road', 'Cyber Hub', 'Sector 44'];
const COMPLETE = { product_type: 'private_office', seats: 8, market: 'Golf Course Road', budget: 15000 };

// --- consent -----------------------------------------------------------------
{
  const s = voice.openingScript({ tenantName: 'Vantage Workspaces', agentName: 'Nia', contact: 'Rhea', known: true });
  assert.ok(s.requires_consent, 'consent is never optional');
  assert.match(s.consent, /recorded/i, 'the consent line must actually say the call is recorded');
  assert.match(s.greeting, /Rhea/, 'a known caller is greeted by name');
  const unknown = voice.openingScript({ tenantName: 'Vantage Workspaces' });
  assert.doesNotMatch(unknown.greeting, /undefined|null/, 'an unknown caller gets a clean greeting');
  assert.match(voice.openingScript({ locale: 'hi' }).consent, /record/i);
  console.log('PASS: opening script + consent announcement');
}

// --- slot filling and question selection --------------------------------------
{
  // Spoken headcount ("8 people") is the common case on a call — it must fill the
  // seats slot, or the agent asks a question it was just answered.
  const u = voice.extractTurn({ text: 'We need a private office for 8 people', requirement: {}, markets: MARKETS });
  assert.equal(u.slots.seats, 8);
  assert.equal(u.slots.product_type, 'private_office');
  assert.deepEqual(u.filled.sort(), ['product_type', 'seats']);

  const r = voice.composeReply({ understanding: u, matches: [] });
  assert.equal(r.decision.action, 'ASK_QUESTION');
  assert.ok(['market', 'budget'].includes(r.ask_for), `expected a gating slot, got ${r.ask_for}`);
  assert.doesNotMatch(r.reply, /how many people/i, 'must not re-ask a slot the caller just filled');
  console.log('PASS: spoken slot extraction + next question');
}

// --- grounded read-back --------------------------------------------------------
{
  const u = voice.extractTurn({ text: 'Golf Course Road, around 15000, moving in immediately', requirement: COMPLETE, markets: MARKETS });
  const r = voice.composeReply({ understanding: u, matches: INVENTORY.slice(0, 2) });
  assert.equal(r.decision.action, 'SEND_SHORTLIST');
  assert.match(r.reply, /Cabin 704/);
  assert.match(r.reply, /12,500/, 'prices are read back from the tool result');
  assert.doesNotMatch(r.reply, /Suite 3|Desk Row/, 'only units the matcher returned may be named');

  // Cap at three even when more matched — §8.1 step 7.
  const many = voice.readBack(INVENTORY);
  assert.doesNotMatch(many, /Desk Row/);
  assert.match(many, /3 options/);

  // The hard case: no match must produce an honest "I don't have that" rather
  // than an invented unit.
  const none = voice.composeReply({ understanding: voice.extractTurn({ text: 'anything in Whitefield?', requirement: COMPLETE, markets: MARKETS }), matches: [] });
  assert.match(none.reply, /don't have|flag it/i);
  assert.doesNotMatch(none.reply, /₹/, 'no price is ever quoted without a matched unit');
  console.log('PASS: grounded read-back (top 3, tool result only, honest empty)');
}

// --- routing -------------------------------------------------------------------
{
  const human = voice.composeTurn({ text: 'Can I just speak to a person please', requirement: COMPLETE, markets: MARKETS, matches: INVENTORY.slice(0, 1) });
  assert.equal(human.decision.action, 'HANDOFF');

  const big = voice.composeTurn({ text: 'Yes I want to book it', requirement: { ...COMPLETE, seats: 25 }, markets: MARKETS, matches: INVENTORY.slice(0, 1), seatsAboveSelfServe: true });
  assert.equal(big.decision.requires_human, true, 'above-self-serve bookings go to a rep');

  const lost = voice.composeTurn({ text: 'We have gone with someone else, not interested', requirement: COMPLETE, markets: MARKETS, matches: INVENTORY.slice(0, 1) });
  assert.equal(lost.decision.action, 'MARK_LOST');
  assert.equal(lost.end_call, true);
  console.log('PASS: routing (human request, above-self-serve booking, lost)');
}

// --- latency accounting ---------------------------------------------------------
{
  assert.deepEqual(voice.latencyStats([]), { samples: 0, p50: null, p95: null, max: null, within_budget: true });
  const fast = voice.latencyStats([{ latency_ms: 400 }, { latency_ms: 600 }, { latency_ms: 700 }]);
  assert.equal(fast.within_budget, true);
  // Nearest-rank: on small samples p95 must surface the slow turn, not hide it
  // behind the median — the bug that made an over-budget call look compliant.
  const slow = voice.latencyStats([{ latency_ms: 420 }, { latency_ms: 2400 }]);
  assert.equal(slow.p95, 2400);
  assert.equal(slow.within_budget, false);
  // Turns with no measurement are skipped rather than counted as zero.
  assert.equal(voice.latencyStats([{ latency_ms: 500 }, { from: 'caller' }]).samples, 1);
  console.log('PASS: latency percentiles vs the 800/1200ms budget');
}

// --- provider honesty -------------------------------------------------------------
{
  const bare = voice.providerStatus({});
  assert.equal(bare.configured, false);
  assert.equal(bare.transport, 'simulated');
  assert.match(bare.note, /no PSTN call/i, 'the absence of a carrier leg must be stated, not implied');
  const half = voice.providerStatus({ VOICE_PROVIDER: 'exotel' });
  assert.equal(half.configured, false, 'a provider name without credentials is still not configured');
  const full = voice.providerStatus({ VOICE_PROVIDER: 'exotel', VOICE_API_KEY: 'k', VOICE_FROM_NUMBER: '+911234567890' });
  assert.equal(full.configured, true);
  assert.equal(full.transport, 'telephony');
  console.log('PASS: telephony provider status is honest about what is configured');
}

// --- realtime bus -------------------------------------------------------------------
{
  realtime._reset();
  const sink = (leadId) => {
    const written = [];
    const res = { writeHead() {}, write(c) { written.push(c); }, end() {} };
    const req = { on() {}, headers: {} };
    realtime.subscribe(req, res, { leadId });
    return written;
  };

  const all = sink(null);
  const scoped = sink('lead_1');
  realtime.publish('event', { lead_id: 'lead_1', event: { id: 'e1' } });
  realtime.publish('event', { lead_id: 'lead_2', event: { id: 'e2' } });

  const parse = (rows) => rows.filter(r => r.includes('data: ')).map(r => JSON.parse(r.slice(r.indexOf('data: ') + 6)));
  assert.equal(parse(all).filter(f => f.kind === 'event').length, 2, 'the tenant feed sees both leads');
  const scopedFrames = parse(scoped).filter(f => f.kind === 'event');
  assert.equal(scopedFrames.length, 1, 'a lead-scoped feed sees only its own lead');
  assert.equal(scopedFrames[0].event.id, 'e1');

  // Reconnect replay: a client that missed frame 1 gets it back via Last-Event-ID
  // rather than silently losing the decisions taken while it was away.
  const resumed = parse(sink(null));
  assert.ok(resumed.some(f => f.kind === 'ready'));
  const catchUp = [];
  realtime.subscribe({ on() {}, headers: {} }, { writeHead() {}, write(c) { catchUp.push(c); }, end() {} }, { lastEventId: '1' });
  const replayed = parse(catchUp).filter(f => f.kind === 'event');
  assert.equal(replayed.length, 1, 'replay resumes after the last seen id, not from the start');
  assert.equal(replayed[0].event.id, 'e2');

  assert.equal(realtime.stats().subscribers, 4);
  realtime._reset();
  assert.equal(realtime.stats().subscribers, 0);
  console.log('PASS: realtime fan-out, lead scoping and Last-Event-ID replay');
}

console.log('\nALL VOICE + REALTIME UNIT TESTS PASSED');
