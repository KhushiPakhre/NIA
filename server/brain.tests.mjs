import assert from 'node:assert/strict';
import * as brain from './nia-brain.mjs';

// --- Intent detection -------------------------------------------------------
assert.equal(brain.detectIntent('Can we book a tour for tomorrow afternoon?').intent, 'TOUR_REQUEST');
assert.equal(brain.detectIntent("Let's proceed, we'll take it").intent, 'PURCHASE_INTENT');
assert.equal(brain.detectIntent('WeWork quoted us 17000, can you match it?').intent, 'COMPETITOR_OBJECTION');
assert.equal(brain.detectIntent('This is too expensive for us').intent, 'PRICE_OBJECTION');
assert.equal(brain.detectIntent("We're not interested anymore, please stop").intent, 'LOST_INTENT');
assert.equal(brain.detectIntent('Can I talk to a human agent?').intent, 'HUMAN_REQUEST');
assert.equal(brain.detectIntent('We need 28 seats, budget 18000').intent, 'QUALIFICATION');
console.log('PASS: detectIntent');

// --- Requirement extraction --------------------------------------------------
const markets = ['Cyber City', 'Golf Course Road', 'Sector 44'];
let req = brain.extractRequirement('We are looking for around 25 to 30 seats near Cyber City. Budget max 18000. Move in November for at least two years.', {}, markets);
assert.equal(req.seats_min, 25);
assert.equal(req.seats_max, 30);
assert.equal(req.seats, 28); // (25+30)/2 rounded
assert.equal(req.market, 'Cyber City');
assert.equal(req.budget, 18000);
assert.equal(req.move_in_date, 'November');
assert.equal(req.tenure, '24 months');
assert.ok(req.confidence.seats > 0.5);
console.log('PASS: extractRequirement (range + budget + tenure + market)');

req = brain.extractRequirement('Need a meeting room for 4 people, furnished, parking required, wifi please.', {}, markets);
assert.equal(req.product_type, 'meeting_room');
assert.equal(req.fit_out, 'furnished');
assert.equal(req.parking_required, true);
assert.ok(req.amenities.includes('wifi'));
console.log('PASS: extractRequirement (product/furnishing/parking/amenities)');

// requirement memory: new message overwrites old value
let base = { seats: 20, confidence: { seats: 0.9 } };
req = brain.extractRequirement('Actually we are expanding to 35 seats now.', base, markets);
assert.equal(req.seats, 35);
console.log('PASS: extractRequirement (overwrite on update)');

// --- Objection + competitor extraction --------------------------------------
assert.deepEqual(brain.extractObjections('This is too expensive and also no parking here'), ['PRICE', 'PARKING']);
const comp = brain.extractCompetitor('WeWork quoted us ₹17,000 for the same seats');
assert.equal(comp.name, 'WeWork');
assert.equal(comp.quoted_price, 17000);
assert.equal(brain.extractCompetitor('just checking availability'), null);
console.log('PASS: extractObjections / extractCompetitor');

// --- Lead scoring -------------------------------------------------------------
const highIntent = brain.computeLeadScore({
  requirement: { product_type: 'private_office', seats: 28, market: 'Cyber City', budget: 18000, move_in_date: 'Immediate', tenure: '24 months' },
  matches: [{ score: 90, price: 17000 }],
  engagement: { repliesReceived: 3, shortlistOpened: true, lastIntent: 'BOOKING_REQUEST' },
});
const lowIntent = brain.computeLeadScore({ requirement: {}, matches: [], engagement: { lastIntent: 'NEW_INQUIRY' } });
assert.ok(highIntent.score > lowIntent.score, `expected high-intent score (${highIntent.score}) > low-intent score (${lowIntent.score})`);
assert.ok(highIntent.score >= 75);
console.log('PASS: computeLeadScore (ordering + high-intent threshold)');

// --- Next best action ----------------------------------------------------------
let d = brain.nextBestAction({ requirement: {}, matches: [], lastIntent: 'NEW_INQUIRY' });
assert.equal(d.action, 'ASK_QUESTION');

d = brain.nextBestAction({
  requirement: { product_type: 'private_office', seats: 8, market: 'Cyber City', budget: 15000 },
  matches: [{ id: 'x', score: 80, price: 12000 }], lastIntent: 'QUALIFICATION',
});
assert.equal(d.action, 'SEND_SHORTLIST');

d = brain.nextBestAction({ requirement: { seats: 8 }, matches: [], objections: [], lastIntent: 'QUALIFICATION' });
// complete? no (missing product_type/market/budget) -> still ASK_QUESTION even with no matches
assert.equal(d.action, 'ASK_QUESTION');

d = brain.nextBestAction({
  requirement: { product_type: 'private_office', seats: 8, market: 'X', budget: 1000 },
  matches: [], lastIntent: 'QUALIFICATION',
});
assert.equal(d.action, 'ESCALATE');
assert.equal(d.requires_human, true);

d = brain.nextBestAction({ requirement: {}, matches: [], objections: ['PRICE'], lastIntent: 'PRICE_OBJECTION' });
assert.equal(d.action, 'HANDLE_OBJECTION');

d = brain.nextBestAction({ requirement: {}, matches: [], lastIntent: 'TOUR_REQUEST' });
assert.equal(d.action, 'SCHEDULE_TOUR');

d = brain.nextBestAction({ requirement: { product_type: 'private_office', seats: 28 }, matches: [], lastIntent: 'BOOKING_REQUEST', seatsAboveSelfServe: true });
assert.equal(d.action, 'HANDOFF');
assert.equal(d.requires_human, true);

d = brain.nextBestAction({ requirement: { product_type: 'meeting_room', seats: 4 }, matches: [], lastIntent: 'BOOKING_REQUEST', seatsAboveSelfServe: false });
assert.equal(d.action, 'BOOK');

d = brain.nextBestAction({ requirement: {}, matches: [], lastIntent: 'LOST_INTENT' });
assert.equal(d.action, 'MARK_LOST');

d = brain.nextBestAction({ requirement: {}, matches: [], lastIntent: 'HUMAN_REQUEST', hasOpenHandoff: false });
assert.equal(d.action, 'HANDOFF');
console.log('PASS: nextBestAction (all branches)');

// --- Adaptive follow-up --------------------------------------------------------
assert.equal(brain.nextFollowUpDelay({ lastIntent: 'TOUR_REQUEST' }).delayHours, 0);
assert.equal(brain.nextFollowUpDelay({ repliesReceived: 3, lastIntent: 'QUALIFICATION' }).delayHours, 4);
assert.equal(brain.nextFollowUpDelay({ hoursSinceLastReply: 100, lastIntent: 'QUALIFICATION' }).delayHours, 168);
console.log('PASS: nextFollowUpDelay');

// --- SLA -------------------------------------------------------------------------
assert.equal(brain.slaMinutesForScore(90), 15);
assert.equal(brain.slaMinutesForScore(60), 60);
assert.equal(brain.slaMinutesForScore(30), 240);
const oldTs = new Date(Date.now() - 20 * 60000).toISOString();
assert.equal(brain.isSlaBreached(oldTs, 90), true);  // 20min > 15min SLA for hot lead
assert.equal(brain.isSlaBreached(oldTs, 30), false); // 20min < 240min SLA for cold lead
console.log('PASS: SLA policy');

// --- KAM briefing ----------------------------------------------------------------
const brief = brain.buildBriefing({
  lead: { company: 'Northstar Analytics', contact: 'Rhea Kapoor' },
  requirement: { seats: 28, product_type: 'private_office', market: 'Cyber City', budget: 18000, tenure: '24 months' },
  matches: [{ id: 'VW-OFF-12A', unit: 'Private Office 12A', centre: 'Vantage Workspaces', price: 18000, score: 80 }],
  objections: [], competitor: { name: 'WeWork', quoted_price: 17000 },
  engagement: { repliesReceived: 4, lastIntent: 'PRICE_REQUEST' },
});
assert.equal(brief.company, 'Northstar Analytics');
assert.ok(brief.requirement_summary.includes('28 seats'));
assert.ok(brief.suggested_opener.includes('WeWork'));
assert.equal(brief.matched_inventory[0].id, 'VW-OFF-12A');
console.log('PASS: buildBriefing');

console.log('\nALL NIA BRAIN UNIT TESTS PASSED');
