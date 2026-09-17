// ---------------------------------------------------------------------------
// Voice agent engine (P4)
//
// Implements the inbound-call flow in BUILD_SPEC §8.1 as a turn-by-turn state
// machine. Everything here is pure: it takes the current requirement, the matched
// inventory and the caller's transcribed turn, and returns what the agent should
// say plus what changed. Persistence, event logging and automation live in
// index.mjs, exactly like the chat path — so voice and chat share one brain
// (nia-brain.mjs) rather than drifting into two different agents.
//
// What is real here and what is not, stated plainly (the same distinction the
// WhatsApp/email senders make):
//   REAL  — slot extraction, intent detection, grounded inventory read-back,
//           scoring, routing, handoff, transcript, requirement versioning,
//           per-turn latency measurement, consent gating.
//   REAL  — audio capture and playback, when the browser Live Call screen is used:
//           that is the Web Speech API doing STT/TTS on the client device.
//   NOT   — carrier telephony. No Exotel/Ozonetel/Plivo/Twilio credentials are
//           configured, so no PSTN call is ever placed or received. Sessions
//           started via the webhook endpoint are explicitly marked
//           `transport: 'simulated'` and are never reported as a real call.
// ---------------------------------------------------------------------------

import * as brain from './nia-brain.mjs';

export const SLOT_ORDER = ['product_type', 'seats', 'market', 'budget', 'move_in_date', 'tenure'];

// §7.2: ask for the highest-value missing slot, one at a time. Never interrogate.
const QUESTIONS = {
  en: {
    product_type: 'Are you looking for a private office, a dedicated desk or a meeting room?',
    seats: 'How many people would be using the space?',
    market: 'Which area or micro-market works best for you?',
    budget: 'And roughly what monthly budget are you working with?',
    move_in_date: 'When would you be looking to move in?',
    tenure: 'And how long a term are you thinking — twelve months, twenty-four?',
  },
  hi: {
    product_type: 'Aap private office dhoond rahe hain, dedicated desk, ya meeting room?',
    seats: 'Kitne log space use karenge?',
    market: 'Kaunsa area ya micro-market aapke liye best rahega?',
    budget: 'Aur monthly budget approximately kitna soch rahe hain?',
    move_in_date: 'Move-in kab tak karna chahenge?',
    tenure: 'Aur tenure kitna — bara mahine, chaubees?',
  },
};

const LINES = {
  en: {
    consent: (tenant) => `Thanks for calling ${tenant}. Just so you know, this call is recorded and handled by an AI assistant so I can pull up live availability for you. Is that alright?`,
    greetKnown: (agent, contact) => `Hi ${contact}, this is ${agent}. Good to hear from you again — I have your earlier requirement in front of me.`,
    greetNew: (agent) => `Hi, this is ${agent}. I can check live workspace availability for you — happy to help.`,
    declined: 'Understood — I won\'t record anything. Let me pass you to one of our team instead.',
    noMatch: 'I don\'t have anything in our current inventory that matches that yet. Let me flag it to the team so we can find you something that works.',
    transfer: 'Let me connect you with one of our team who can take this forward.',
    offer: 'I can send that shortlist over on WhatsApp, book you a tour, or put you through to a colleague — whichever is easiest.',
    closing: 'Thanks for your time — you\'ll hear from us shortly.',
    fallback: 'Sorry, I didn\'t quite catch that — could you say it again?',
  },
  hi: {
    consent: (tenant) => `${tenant} ko call karne ke liye shukriya. Yeh call record ho rahi hai aur ek AI assistant handle kar raha hai, taaki main aapko live availability bata sakoon. Theek hai?`,
    greetKnown: (agent, contact) => `Namaste ${contact}, main ${agent} bol raha hoon. Aapki pichhli requirement mere saamne hai.`,
    greetNew: (agent) => `Namaste, main ${agent} bol raha hoon. Main aapke liye live workspace availability check kar sakta hoon.`,
    declined: 'Samajh gaya — main kuch record nahi karoonga. Main aapko team se connect karta hoon.',
    noMatch: 'Abhi hamare inventory mein iske liye exact match nahi hai. Main team ko flag kar deta hoon.',
    transfer: 'Main aapko hamari team se connect karta hoon.',
    offer: 'Main shortlist WhatsApp par bhej sakta hoon, tour book kar sakta hoon, ya colleague se connect kar sakta hoon.',
    closing: 'Aapke time ke liye shukriya — hum jaldi contact karenge.',
    fallback: 'Maaf kijiye, samajh nahi aaya — dobara bata sakte hain?',
  },
};

const lines = (locale) => LINES[locale] || LINES.en;
const questions = (locale) => QUESTIONS[locale] || QUESTIONS.en;

/**
 * §8.1 step 2-3: tenant persona + greeting, personalised when the caller is known.
 * The consent announcement is returned separately and always precedes capture —
 * it is not optional and not merged into the greeting, so a UI cannot accidentally
 * start recording before it has been delivered.
 */
export function openingScript({ tenantName = 'our team', agentName = 'Nia', contact = '', known = false, locale = 'en' } = {}) {
  const L = lines(locale);
  return {
    consent: L.consent(tenantName),
    greeting: known && contact ? L.greetKnown(agentName, contact) : L.greetNew(agentName),
    requires_consent: true,
  };
}

/** What the agent says when the caller declines AI handling / recording. */
export function declineLine(locale = 'en') {
  return lines(locale).declined;
}

export function missingSlots(requirement = {}) {
  return SLOT_ORDER.filter((k) => requirement[k] == null || requirement[k] === '');
}

export function nextQuestion(requirement = {}, locale = 'en') {
  const missing = missingSlots(requirement);
  if (!missing.length) return null;
  return { slot: missing[0], text: questions(locale)[missing[0]], remaining: missing.length };
}

/**
 * §8.1 step 7: read back the top 3 **from the tool result only**. If the matcher
 * returned nothing, the agent says so — it never invents a unit, a price or an
 * availability date to keep the conversation moving.
 */
export function readBack(matches = [], locale = 'en') {
  if (!matches.length) return lines(locale).noMatch;
  const top = matches.slice(0, 3);
  const spoken = top.map((m, i) => {
    const price = Number(m.price).toLocaleString('en-IN');
    const ordinal = i === 0 ? 'First' : i === 1 ? 'Second' : 'Third';
    return `${ordinal}, ${m.unit} at ${m.centre} in ${m.market} — ${m.seats} seats, ₹${price} a month.`;
  }).join(' ');
  return `I have ${top.length} option${top.length > 1 ? 's' : ''} available right now. ${spoken}`;
}

/**
 * One caller turn. Extract → update requirement → decide → speak.
 *
 * The reply is composed around the decision engine's chosen action rather than the
 * other way round, mirroring `agentReply` on the chat path: the grounded action
 * decides what gets said, the model never picks a sentence and back-fills a reason.
 */
/**
 * Turn, part 1 — understand. Pure extraction with no inventory involved.
 *
 * Split out from reply composition on purpose: the caller's new slots have to be
 * written to the requirement and the inventory re-matched against the *updated*
 * requirement before the agent opens its mouth. Composing in one pass read back
 * units matched against the previous turn's requirement, so the agent could
 * cheerfully offer a Cyber Hub cabin one sentence after the caller said
 * "Golf Course Road". Grounded means grounded in current state, not recent state.
 */
export function extractTurn({ text = '', requirement = {}, markets = [] } = {}) {
  const utterance = String(text || '').trim();
  if (!utterance) {
    return { empty: true, slots: { ...requirement }, filled: [], objections: [], competitor: null, intent: 'NEW_INQUIRY', confidence: 0 };
  }
  const before = { ...requirement };
  const slots = brain.extractRequirement(utterance, requirement, markets);
  const { intent, confidence } = brain.detectIntent(utterance);
  return {
    empty: false,
    slots,
    filled: SLOT_ORDER.filter((k) => (before[k] == null || before[k] === '') && slots[k] != null && slots[k] !== ''),
    objections: brain.extractObjections(utterance),
    competitor: brain.extractCompetitor(utterance),
    intent,
    confidence,
  };
}

/**
 * Turn, part 2 — decide and speak, against inventory matched on the updated
 * requirement.
 *
 * The reply is composed around the decision engine's chosen action rather than the
 * other way round, mirroring `agentReply` on the chat path: the grounded action
 * decides what gets said, the agent never picks a sentence and back-fills a reason.
 */
export function composeReply({
  understanding,
  matches = [],
  leadScore = 0,
  hasOpenHandoff = false,
  seatsAboveSelfServe = false,
  locale = 'en',
} = {}) {
  const L = lines(locale);
  const u = understanding || {};
  if (u.empty) {
    return { decision: null, reply: L.fallback, ask_for: null, end_call: false };
  }

  const decision = brain.nextBestAction({
    requirement: u.slots || {},
    matches,
    objections: u.objections || [],
    competitor: u.competitor || null,
    lastIntent: u.intent,
    leadScore,
    hasOpenHandoff,
    seatsAboveSelfServe,
  });

  let reply;
  let askFor = null;
  let endCall = false;

  if (u.competitor) {
    reply = `Understood — I hear you on the ${u.competitor.name} comparison. Let me see what we can do on our side and a colleague will confirm the specifics with you.`;
  } else if ((u.objections || []).length) {
    reply = `Got it, noted on the ${u.objections[0].toLowerCase()}. Let me check what else might work.`;
  } else {
    switch (decision.action) {
      case 'ASK_QUESTION': {
        // The decision engine's `ask_for` wins: it only counts the four fields that
        // actually gate qualification, so it never sends the agent chasing tenure
        // while the seat count is still unknown. `nextQuestion` is the fallback for
        // the softer slots once the required four are in.
        askFor = decision.ask_for || nextQuestion(u.slots || {}, locale)?.slot || null;
        reply = questions(locale)[askFor] || L.fallback;
        break;
      }
      case 'SEND_SHORTLIST':
        // §8.1 steps 7-8: read back grounded options, then offer the three exits.
        reply = `${readBack(matches, locale)} ${L.offer}`;
        break;
      case 'SCHEDULE_TOUR':
        reply = matches.length
          ? `Happy to arrange a viewing of ${matches[0].unit}. I'll confirm the next open slot and send you the details.`
          : 'I\'d like to set up a viewing — let me confirm availability first and come straight back to you.';
        break;
      case 'BOOK':
        reply = seatsAboveSelfServe
          ? 'That size goes through one of our team rather than an instant booking — let me get a colleague to confirm it with you.'
          : 'Let me confirm that against live availability and I\'ll send the reference across.';
        break;
      case 'HANDOFF':
        reply = L.transfer;
        break;
      case 'ESCALATE':
        reply = L.noMatch;
        break;
      case 'MARK_LOST':
        reply = L.closing;
        endCall = true;
        break;
      default:
        reply = matches.length ? `${readBack(matches, locale)} ${L.offer}` : L.fallback;
    }
  }

  return { decision, reply, ask_for: askFor, end_call: endCall };
}

/**
 * Convenience wrapper for callers that already hold a match list and don't need the
 * re-match step (the single-turn `/api/voice` endpoint). The live session path uses
 * `extractTurn` + `composeReply` directly so it can re-match in between.
 */
export function composeTurn({ text = '', requirement = {}, markets = [], matches = [], ...rest } = {}) {
  const understanding = extractTurn({ text, requirement, markets });
  const spoken = composeReply({ understanding, matches, ...rest });
  return { ...understanding, ...spoken };
}

/**
 * §4 latency budget: end of client speech → start of agent speech must hold
 * p50 < 800ms and p95 < 1200ms. Measured per turn and surfaced on the session so a
 * regression is visible in the product rather than only in a load test.
 */
export function latencyStats(turns = []) {
  const values = turns.map((t) => Number(t.latency_ms)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!values.length) return { samples: 0, p50: null, p95: null, max: null, within_budget: true };
  // Nearest-rank, not floor-interpolated: on the handful of samples a single call
  // produces, floor() quietly reported p95 as the median and hid the slow turn.
  const at = (q) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1))];
  const p50 = at(0.5), p95 = at(0.95);
  return {
    samples: values.length,
    p50, p95,
    max: values[values.length - 1],
    budget: { p50: 800, p95: 1200 },
    within_budget: p50 < 800 && p95 < 1200,
  };
}

/**
 * Telephony provider status. Kept explicit and honest rather than implied: the app
 * shows "simulated" everywhere until real credentials exist, the same way outbound
 * WhatsApp/email/voice sends are logged as activities rather than pretending to
 * have been delivered.
 */
export function providerStatus(env = process.env) {
  const provider = env.VOICE_PROVIDER || null;
  const hasCreds = Boolean(env.VOICE_API_KEY && env.VOICE_FROM_NUMBER);
  return {
    provider,
    configured: Boolean(provider && hasCreds),
    transport: provider && hasCreds ? 'telephony' : 'simulated',
    stt: 'browser-webspeech',
    tts: 'browser-webspeech',
    note: provider && hasCreds
      ? `Outbound and inbound calls route through ${provider}.`
      : 'No telephony provider configured — no PSTN call is placed or received. Audio capture and playback run locally in the browser via the Web Speech API; webhook-started sessions are simulated and logged as such.',
  };
}

export function transcriptText(session) {
  return (session.turns || [])
    .map((t) => `${t.from === 'caller' ? 'Caller' : 'Agent'}: ${t.text}`)
    .join('\n');
}
