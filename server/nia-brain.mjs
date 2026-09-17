// NIA decision engine.
//
// Pure functions only — no I/O, no DB access, no side effects. server/index.mjs owns
// persistence and turns the `next_action` this module returns into a real backend
// effect (sending a message, creating a handoff, etc). Keeping this file pure is what
// makes it possible to unit test the algorithms in isolation (BUILD_SPEC §0 rule 5)
// instead of only exercising them through the HTTP API.

// ---------------------------------------------------------------------------
// 1. INTENT DETECTION (BUILD_SPEC / master prompt §9)
// ---------------------------------------------------------------------------

export const INTENTS = [
  'BOOKING_REQUEST', 'TOUR_REQUEST', 'PRICE_REQUEST', 'SHORTLIST_REQUEST',
  'INVENTORY_REQUEST', 'HUMAN_REQUEST', 'COMPETITOR_OBJECTION', 'PRICE_OBJECTION',
  'LOCATION_OBJECTION', 'AVAILABILITY_OBJECTION', 'CONTRACT_QUESTION',
  'PURCHASE_INTENT', 'LOST_INTENT', 'FOLLOWUP', 'QUALIFICATION', 'NEW_INQUIRY',
];

// Ordered rules: first match wins. Order encodes priority (a booking request that
// also mentions price should still be treated as a booking request).
const INTENT_RULES = [
  ['BOOKING_REQUEST', /\b(let'?s book|book it|go ahead and book|i want to book|confirm the booking|please confirm)\b/i],
  ['TOUR_REQUEST', /\b(can (i|we) (visit|see|tour|come)|book a tour|schedule a (tour|visit)|site visit|walk ?through)\b/i],
  ['HUMAN_REQUEST', /\b(talk to (a|someone|a human|a person|your team)|speak to (a|someone)|human agent|real person|call me|connect me (to|with))\b/i],
  ['LOST_INTENT', /\b(not interested|no longer looking|going with (someone|another)|we'?ve decided against|please stop|remove (me|us))\b/i],
  ['PURCHASE_INTENT', /\b(let'?s proceed|ready to (go ahead|sign|proceed)|send (the|me an?) agreement|how do we proceed|sounds good,? let'?s|we'?ll take it)\b/i],
  ['COMPETITOR_OBJECTION', /\b(wework|awfis|smartworks|indiqube|table space|cowrks|91springboard|regus|quoted us|cheaper (at|with|elsewhere)|better (deal|offer) (at|from|elsewhere))\b/i],
  ['PRICE_OBJECTION', /\b(too (expensive|high|much)|can'?t afford|over (my|our) budget|reduce the price|any discount|lower the price|price is (high|steep))\b/i],
  ['LOCATION_OBJECTION', /\b(too far|not (in|near) |wrong (area|location)|different (area|location|market)|far from)\b/i],
  ['AVAILABILITY_OBJECTION', /\b(not available|no availability|out of stock|sold out|nothing (left|available))\b/i],
  ['CONTRACT_QUESTION', /\b(contract|agreement|lock.?in|minimum tenure|notice period|terms and conditions|cancellation policy)\b/i],
  ['SHORTLIST_REQUEST', /\b(send (me )?(the )?shortlist|show me (some )?options|what do you have|what'?s available)\b/i],
  ['PRICE_REQUEST', /\b(how much|what'?s the (price|cost|rate)|pricing|cost per seat|per seat price)\b/i],
  ['INVENTORY_REQUEST', /\b(any (space|office|desk|cabin)|looking for (a|an)|need (a|an|some) (space|office|desk|cabin))\b/i],
  ['QUALIFICATION', /\b(\d+\s*seats?|budget|move.?in|tenure|₹)\b/i],
];

/**
 * Classify the intent of a single inbound message.
 * @returns {{intent:string, confidence:number}}
 */
export function detectIntent(text) {
  const t = String(text || '').trim();
  if (!t) return { intent: 'NEW_INQUIRY', confidence: 0.3 };
  for (const [intent, re] of INTENT_RULES) {
    if (re.test(t)) return { intent, confidence: 0.85 };
  }
  return { intent: 'NEW_INQUIRY', confidence: 0.4 };
}

// ---------------------------------------------------------------------------
// 2. REQUIREMENT EXTRACTION (§6 / master prompt §6-7)
// ---------------------------------------------------------------------------

const PRODUCT_PATTERNS = [
  ['meeting_room', /\bmeeting room\b/i],
  ['virtual_office', /\bvirtual office\b/i],
  ['day_pass', /\bday pass\b/i],
  ['dedicated_desk', /\b(dedicated desk|hot desk)\b/i],
  ['managed_suite', /\bmanaged suite\b/i],
  ['private_office', /\b(private office|private cabin|cabin|office)\b/i],
];

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function wordToNumber(w) {
  return NUMBER_WORDS[String(w || '').toLowerCase()] ?? null;
}

/**
 * Extract structured requirement slots from free text. `base` is the requirement
 * already on file (new info overwrites it — see BUILD_SPEC §7 "requirement memory").
 * `markets` is the list of known micro-markets, used to recognise a location mention.
 */
export function extractRequirement(text, base = {}, markets = []) {
  const slots = { ...base };
  const confidence = { ...(base.confidence || {}) };
  const t = String(text || '');

  // Seats — explicit range ("25 to 30"), "around N", digits, or number words.
  const range = t.match(/(\d{1,4})\s*(?:-|to|–)\s*(\d{1,4})\s*(?:seats?|people|people)?/i);
  // "8 people" / "12 pax" is how callers actually phrase headcount out loud — far
  // more common on a voice turn than the written "8 seats". Without these the agent
  // asked "how many people?" immediately after being told, which is the single most
  // obvious way for a voice agent to sound like it isn't listening.
  const seatWord = t.match(/(\d{1,4})\s*(?:seats?|people|persons?|pax|folks|heads?|desks?)\b/i);
  const approxWord = t.match(/(?:around|about|approx(?:imately)?)\s*(\d{1,4})/i);
  if (range) {
    slots.seats_min = Number(range[1]); slots.seats_max = Number(range[2]);
    slots.seats = Math.round((Number(range[1]) + Number(range[2])) / 2);
    confidence.seats = 0.9;
  } else if (seatWord) {
    slots.seats = Number(seatWord[1]); confidence.seats = 0.95;
  } else if (approxWord) {
    slots.seats = Number(approxWord[1]); confidence.seats = 0.7;
  } else if (!slots.seats) {
    const numWordMatch = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b\s*(?:seats?|people|of us)/i);
    if (numWordMatch) { slots.seats = wordToNumber(numWordMatch[1]); confidence.seats = 0.75; }
  }

  // Product type
  for (const [type, re] of PRODUCT_PATTERNS) {
    if (re.test(t)) { slots.product_type = type; confidence.product_type = 0.9; break; }
  }

  // Market / micro-location
  for (const m of markets) {
    if (m && t.toLowerCase().includes(String(m).toLowerCase())) { slots.market = m; confidence.market = 0.9; break; }
  }

  // Budget
  const budgetFlexible = /budget is flexible|budget'?s flexible|budget no bar|flexible on budget/i.test(t);
  if (budgetFlexible) slots.budget_flexible = true;
  const belowMatch = t.match(/(?:below|under|less than|max(?:imum)?)\s*(?:₹|rs\.?)?\s*([\d,]{3,7})/i);
  const rupeeMatch = t.match(/₹\s?([\d,]{3,7})/);
  const bareNumber = t.match(/\b([\d,]{4,7})\s*(?:per seat|\/seat|per month|\/month)?\b/);
  if (belowMatch) { slots.budget = Number(belowMatch[1].replace(/,/g, '')); confidence.budget = 0.9; }
  else if (rupeeMatch) { slots.budget = Number(rupeeMatch[1].replace(/,/g, '')); confidence.budget = 0.9; }
  else if (bareNumber && !slots.seats_min) { slots.budget = Number(bareNumber[1].replace(/,/g, '')); confidence.budget = 0.55; }

  // Move-in date
  if (/\bimmediate|asap|right away|straight ?away\b/i.test(t)) { slots.move_in_date = 'Immediate'; confidence.move_in_date = 0.9; }
  else {
    const monthMatch = t.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
    if (monthMatch) { slots.move_in_date = monthMatch[1][0].toUpperCase() + monthMatch[1].slice(1).toLowerCase(); confidence.move_in_date = 0.75; }
  }

  // Tenure
  const tenureMatch = t.match(/(\d+)\s*(?:months?|mo)\b/i);
  const yearMatch = t.match(/(\d+)\s*(?:years?|yrs?)\b/i);
  if (yearMatch) { slots.tenure = `${Number(yearMatch[1]) * 12} months`; confidence.tenure = 0.9; }
  else if (tenureMatch) { slots.tenure = `${tenureMatch[1]} months`; confidence.tenure = 0.9; }
  else if (/\bat least (two|three|2|3) years?\b/i.test(t)) {
    const n = t.match(/at least (two|three|2|3) years?/i)[1];
    const num = wordToNumber(n) ?? Number(n);
    slots.tenure = `${num * 12} months`; confidence.tenure = 0.75;
  }

  // Furnishing / parking / amenities
  if (/\bfurnished\b/i.test(t)) { slots.fit_out = 'furnished'; confidence.fit_out = 0.85; }
  else if (/\bunfurnished|bare ?shell\b/i.test(t)) { slots.fit_out = 'unfurnished'; confidence.fit_out = 0.85; }
  if (/\bparking\b/i.test(t)) { slots.parking_required = !/no parking needed|don'?t need parking/i.test(t); confidence.parking_required = 0.7; }
  const amenityHits = ['wifi', 'reception', 'cafeteria', 'gym', 'conference', 'cctv', 'pantry'].filter(a => new RegExp(`\\b${a}\\b`, 'i').test(t));
  if (amenityHits.length) slots.amenities = [...new Set([...(slots.amenities || []), ...amenityHits])];

  // Urgency / decision maker signals
  if (/\basap|urgent|by (this|end of) week|immediately\b/i.test(t)) slots.urgency = 'high';
  if (/\bi (decide|am the decision maker)|i'?ll (decide|sign)|final call is mine\b/i.test(t)) slots.decision_maker = true;
  if (/\bneed(s)? approval from|my (manager|boss|founder|ceo) (needs to|has to) approve\b/i.test(t)) slots.decision_maker = false;

  slots.confidence = confidence;
  return slots;
}

// ---------------------------------------------------------------------------
// 3. OBJECTION + COMPETITOR EXTRACTION (§9-10 / master prompt §14-15)
// ---------------------------------------------------------------------------

const OBJECTION_RULES = [
  ['PRICE', /\b(too (expensive|high|much)|can'?t afford|over (my|our) budget|reduce the price|any discount|lower the price|price is (high|steep))\b/i],
  ['LOCATION', /\b(too far|not (in|near) |wrong (area|location)|different (area|location|market)|far from)\b/i],
  ['AVAILABILITY', /\b(not available|no availability|out of stock|sold out|nothing (left|available))\b/i],
  ['AMENITIES', /\b(missing .*(wifi|amenit)|need (more|better) amenities)\b/i],
  ['CONTRACT', /\b(contract is too long|lock.?in|minimum tenure|notice period too)\b/i],
  ['TIMELINE', /\b(too (soon|late)|can'?t move in|need more time|not ready yet)\b/i],
  ['PARKING', /\bparking\b/i],
  ['SIZE', /\btoo (small|big|large|cramped)\b/i],
  ['COMPETITOR', /\b(wework|awfis|smartworks|indiqube|table space|cowrks|91springboard|regus)\b/i],
];

/** @returns {string[]} objection types detected in this message */
export function extractObjections(text) {
  const t = String(text || '');
  const found = [];
  for (const [type, re] of OBJECTION_RULES) if (re.test(t)) found.push(type);
  return found;
}

const COMPETITOR_NAMES = ['WeWork', 'Awfis', 'Smartworks', 'IndiQube', 'Table Space', 'CoWrks', '91springboard', 'Regus'];

/** @returns {{name:string, quoted_price:number|null}|null} */
export function extractCompetitor(text) {
  const t = String(text || '');
  const name = COMPETITOR_NAMES.find(n => new RegExp(n.replace(/\s/g, '\\s?'), 'i').test(t));
  if (!name) return null;
  const priceMatch = t.match(/₹\s?([\d,]{3,7})|\b([\d,]{4,7})\b/);
  const quoted_price = priceMatch ? Number((priceMatch[1] || priceMatch[2]).replace(/,/g, '')) : null;
  return { name, quoted_price };
}

// ---------------------------------------------------------------------------
// 4. LEAD SCORING (§11 / master prompt §8)
// ---------------------------------------------------------------------------

export const DEFAULT_SCORE_WEIGHTS = {
  intent: 0.25, requirement: 0.20, inventoryFit: 0.20, budgetFit: 0.15, timeline: 0.10, engagement: 0.10,
};

/**
 * @param {object} params
 * @param {object} params.requirement
 * @param {object[]} params.matches - top ranked inventory matches (with .score)
 * @param {{repliesReceived:number, shortlistOpened:boolean, lastIntent:string}} params.engagement
 * @param {object} [params.weights]
 */
export function computeLeadScore({ requirement = {}, matches = [], engagement = {}, weights = DEFAULT_SCORE_WEIGHTS }) {
  const w = { ...DEFAULT_SCORE_WEIGHTS, ...weights };

  const intentScore = {
    BOOKING_REQUEST: 100, PURCHASE_INTENT: 95, TOUR_REQUEST: 85, SHORTLIST_REQUEST: 65,
    PRICE_REQUEST: 55, INVENTORY_REQUEST: 50, QUALIFICATION: 45, HUMAN_REQUEST: 70,
    CONTRACT_QUESTION: 75, COMPETITOR_OBJECTION: 40, PRICE_OBJECTION: 35, LOCATION_OBJECTION: 35,
    AVAILABILITY_OBJECTION: 30, LOST_INTENT: 0, FOLLOWUP: 40, NEW_INQUIRY: 30,
  }[engagement.lastIntent] ?? 30;

  const fields = ['product_type', 'seats', 'market', 'budget', 'move_in_date', 'tenure'];
  const requirementScore = Math.round((fields.filter(k => requirement[k] != null && requirement[k] !== '').length / fields.length) * 100);

  const inventoryFitScore = matches.length ? Math.max(0, Math.min(100, matches[0].score)) : 0;

  let budgetFitScore = 50;
  if (requirement.budget && matches.length) {
    const best = matches[0];
    budgetFitScore = best.price <= requirement.budget ? 100 : Math.max(0, 100 - ((best.price - requirement.budget) / requirement.budget) * 150);
  } else if (requirement.budget_flexible) budgetFitScore = 70;

  const timelineScore = requirement.move_in_date === 'Immediate' ? 100 : requirement.move_in_date ? 65 : requirement.urgency === 'high' ? 80 : 30;

  const engagementScore = Math.min(100, (engagement.repliesReceived || 0) * 20 + (engagement.shortlistOpened ? 30 : 0));

  const total = (intentScore * w.intent) + (requirementScore * w.requirement) + (inventoryFitScore * w.inventoryFit)
    + (budgetFitScore * w.budgetFit) + (timelineScore * w.timeline) + (engagementScore * w.engagement);

  return {
    score: Math.max(1, Math.min(99, Math.round(total))),
    breakdown: {
      intent: Math.round(intentScore), requirement: requirementScore, inventoryFit: Math.round(inventoryFitScore),
      budgetFit: Math.round(budgetFitScore), timeline: Math.round(timelineScore), engagement: Math.round(engagementScore),
    },
  };
}

// ---------------------------------------------------------------------------
// 5. NEXT-BEST-ACTION (§12 / master prompt §16)
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ['product_type', 'seats', 'market', 'budget'];

/**
 * Decide what NIA should do next for a lead, given its current state.
 * This never performs the action itself — server/index.mjs executes it and logs
 * the result, so every decision stays observable (master prompt §33).
 */
export function nextBestAction({ requirement = {}, matches = [], objections = [], competitor = null,
  lastIntent = 'NEW_INQUIRY', leadScore = 0, hasOpenHandoff = false, seatsAboveSelfServe = false } = {}) {

  if (lastIntent === 'LOST_INTENT') {
    return { action: 'MARK_LOST', priority: 'LOW', reason: 'Lead explicitly indicated they are no longer interested.', requires_human: false };
  }
  if (lastIntent === 'HUMAN_REQUEST' && !hasOpenHandoff) {
    return { action: 'HANDOFF', priority: 'HIGH', reason: 'Lead explicitly asked to speak with a person.', requires_human: true };
  }
  if (lastIntent === 'BOOKING_REQUEST' || lastIntent === 'PURCHASE_INTENT') {
    if (seatsAboveSelfServe) {
      return { action: 'HANDOFF', priority: 'HIGH', reason: 'High purchase intent on an above-self-serve requirement — needs a rep to close.', requires_human: true };
    }
    return { action: 'BOOK', priority: 'HIGH', reason: 'Lead signalled readiness to book and the product qualifies for self-serve booking.', requires_human: false };
  }
  if (lastIntent === 'TOUR_REQUEST') {
    return { action: 'SCHEDULE_TOUR', priority: 'HIGH', reason: 'Lead explicitly requested a tour.', requires_human: false };
  }
  if (lastIntent === 'CONTRACT_QUESTION') {
    return { action: 'HANDOFF', priority: 'MEDIUM', reason: 'Contract/legal questions require human authority.', requires_human: true };
  }
  if (objections.includes('COMPETITOR') || competitor) {
    return { action: 'HANDLE_OBJECTION', priority: 'HIGH', reason: competitor ? `Lead is comparing against ${competitor.name}${competitor.quoted_price ? ` at ₹${competitor.quoted_price.toLocaleString('en-IN')}` : ''}.` : 'Lead mentioned a competitor.', requires_human: false };
  }
  if (objections.length) {
    return { action: 'HANDLE_OBJECTION', priority: 'MEDIUM', reason: `Lead raised a ${objections[0].toLowerCase()} objection.`, requires_human: false };
  }

  const missing = REQUIRED_FIELDS.filter(k => requirement[k] == null || requirement[k] === '');
  if (missing.length) {
    return { action: 'ASK_QUESTION', priority: 'MEDIUM', reason: `Still missing ${missing[0].replaceAll('_', ' ')} to qualify the lead.`, requires_human: false, ask_for: missing[0] };
  }
  if (!matches.length) {
    return { action: 'ESCALATE', priority: 'MEDIUM', reason: 'Requirement is complete but no inventory matches — this is a demand gap.', requires_human: true };
  }
  if (leadScore >= 75 && !hasOpenHandoff) {
    return { action: 'HANDOFF', priority: 'HIGH', reason: 'Lead score indicates high purchase intent.', requires_human: true };
  }
  if (matches.length) {
    return { action: 'SEND_SHORTLIST', priority: leadScore >= 55 ? 'HIGH' : 'MEDIUM', reason: 'Requirement is complete and grounded inventory matches exist.', requires_human: false };
  }
  return { action: 'FOLLOW_UP', priority: 'LOW', reason: 'No new signal since last contact.', requires_human: false };
}

// ---------------------------------------------------------------------------
// 6. ADAPTIVE FOLLOW-UP TIMING (§13 / master prompt §13)
// ---------------------------------------------------------------------------

/**
 * @param {{repliesReceived:number, hoursSinceLastReply:number, lastIntent:string}} engagement
 * @returns {{delayHours:number, channel:string, reason:string}}
 */
export function nextFollowUpDelay({ repliesReceived = 0, hoursSinceLastReply = 0, lastIntent = 'NEW_INQUIRY' } = {}) {
  if (lastIntent === 'TOUR_REQUEST' || lastIntent === 'BOOKING_REQUEST') {
    return { delayHours: 0, channel: 'WhatsApp', reason: 'High-intent request — respond immediately, no cadence delay.' };
  }
  if (repliesReceived >= 2) {
    return { delayHours: 4, channel: 'WhatsApp', reason: 'Lead is engaged — shorten the follow-up window.' };
  }
  if (hoursSinceLastReply >= 72) {
    return { delayHours: 168, channel: 'WhatsApp', reason: 'No response in 3 days — reduce frequency and move toward nurture.' };
  }
  return { delayHours: 24, channel: 'WhatsApp', reason: 'Standard cadence step.' };
}

// ---------------------------------------------------------------------------
// 7. SLA POLICY (§15 / master prompt §20)
// ---------------------------------------------------------------------------

export function slaMinutesForScore(score) {
  if (score >= 80) return 15;   // HOT
  if (score >= 55) return 60;   // WARM
  return 240;                   // QUALIFIED
}

export function isSlaBreached(handoffCreatedAt, leadScore, now = Date.now()) {
  const ageMinutes = (now - new Date(handoffCreatedAt).getTime()) / 60000;
  return ageMinutes > slaMinutesForScore(leadScore);
}

// ---------------------------------------------------------------------------
// 8. KAM BRIEFING (§14 / master prompt §19)
// ---------------------------------------------------------------------------

export function buildBriefing({ lead, requirement = {}, matches = [], objections = [], competitor = null, engagement = {} }) {
  const reqLine = [
    requirement.seats ? `${requirement.seats} seats` : null,
    requirement.product_type ? String(requirement.product_type).replaceAll('_', ' ') : null,
    requirement.market || null,
    requirement.budget ? `₹${Number(requirement.budget).toLocaleString('en-IN')} max` : null,
    requirement.tenure || null,
  ].filter(Boolean).join(' · ');

  const opener = competitor
    ? `The lead likes ${matches[0]?.unit || 'the top match'} but is comparing us against a ${competitor.quoted_price ? `₹${competitor.quoted_price.toLocaleString('en-IN')} ` : ''}${competitor.name} quote.`
    : objections.length
      ? `The lead raised a ${objections[0].toLowerCase()} objection — lead with how we address it.`
      : `The lead has a complete, grounded requirement and is ready for a human conversation.`;

  return {
    company: lead.company, contact: lead.contact, requirement_summary: reqLine || 'Requirement still incomplete',
    matched_inventory: matches.slice(0, 3).map(m => ({ id: m.id, unit: m.unit, centre: m.centre, price: m.price, fit_score: m.score })),
    objections, competitor,
    engagement: { replies: engagement.repliesReceived || 0, last_intent: engagement.lastIntent || 'NEW_INQUIRY' },
    recommended_action: objections.length || competitor ? 'Call immediately — address the objection before it cools the lead.' : 'Call now — warm lead SLA is active.',
    suggested_opener: opener,
  };
}
