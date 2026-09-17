// ---------------------------------------------------------------------------
// Real-time event bus (P3)
//
// Everything NIA does already lands in two places: the human-readable `activities`
// feed and the structured `events` log. Until now both were pull-only — the UI had
// to re-poll `/api/leads` and `/api/leads/:id/activity` to notice that anything had
// happened, so an autonomous decision taken while a rep was looking at a different
// tab was invisible until the next manual refresh.
//
// This module turns those same writes into a push stream over Server-Sent Events.
// It deliberately does NOT introduce a second source of truth: nothing is broadcast
// that was not also persisted. The bus is a fan-out over the existing writes, so a
// client that misses the stream entirely still sees identical state on a refresh.
//
// SSE rather than WebSockets on purpose: the feed is strictly server → client, it
// rides on plain HTTP (no upgrade handling in the zero-dependency Node server), and
// EventSource reconnects on its own with `Last-Event-ID`, which the replay buffer
// below honours so a reconnecting tab does not silently lose the events that
// happened while it was away.
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 25000;   // below the usual 30s idle-proxy timeout
const REPLAY_LIMIT = 300;     // frames retained for Last-Event-ID resume
const RETRY_MS = 3000;        // client reconnect backoff hint

let seq = 0;
const buffer = [];
const clients = new Set();

function encode(frame) {
  return `id: ${frame.seq}\nevent: ${frame.kind}\ndata: ${JSON.stringify(frame)}\n\n`;
}

/**
 * Broadcast a frame to every subscriber whose filter accepts it.
 * Frames are also retained in a bounded ring buffer for reconnect replay.
 */
export function publish(kind, payload = {}) {
  const frame = {
    seq: ++seq,
    kind,
    at: new Date().toISOString(),
    lead_id: payload.lead_id ?? null,
    ...payload,
  };
  buffer.push(frame);
  if (buffer.length > REPLAY_LIMIT) buffer.splice(0, buffer.length - REPLAY_LIMIT);

  for (const client of clients) {
    if (client.leadId && frame.lead_id !== client.leadId) continue;
    try { client.res.write(encode(frame)); }
    catch { drop(client); }
  }
  return frame;
}

function drop(client) {
  clearInterval(client.timer);
  clients.delete(client);
  try { client.res.end(); } catch { /* already gone */ }
}

/**
 * Attach an HTTP response as an SSE subscriber.
 * `leadId` scopes the stream to a single lead (used by the lead drawer);
 * `lastEventId` replays anything the client missed while disconnected.
 */
export function subscribe(req, res, { leadId = null, lastEventId = null } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Last-Event-ID',
  });
  res.write(`retry: ${RETRY_MS}\n\n`);

  const client = { res, leadId, timer: null };
  clients.add(client);

  // Replay first, then announce readiness, so a reconnecting client never sees a
  // "connected" marker sitting in the middle of the events it actually missed.
  const since = Number(lastEventId);
  if (Number.isFinite(since) && since > 0) {
    for (const frame of buffer) {
      if (frame.seq <= since) continue;
      if (leadId && frame.lead_id !== leadId) continue;
      res.write(encode(frame));
    }
  }
  res.write(encode({ seq, kind: 'ready', at: new Date().toISOString(), lead_id: leadId, resumed: Number.isFinite(since) && since > 0 }));

  client.timer = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); }
    catch { drop(client); }
  }, HEARTBEAT_MS);
  if (client.timer.unref) client.timer.unref();

  req.on('close', () => drop(client));
  req.on('error', () => drop(client));
  return client;
}

export function stats() {
  return { subscribers: clients.size, last_seq: seq, buffered: buffer.length };
}

// Test seam only — lets the unit tests assert fan-out without opening sockets.
export function _reset() {
  for (const client of [...clients]) drop(client);
  buffer.length = 0;
  seq = 0;
}
