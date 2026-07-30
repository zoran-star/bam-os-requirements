// The Hawkeye gate: the server-side backstop that keeps a flagged lead's reply
// inside the Hawkeye deck.
//
// Why it exists: when a lead has a PENDING agent card and staff answers them from
// the regular inbox instead of the deck, Hawkeye learns nothing. The teach-on-edit
// signal ("why did you change it" -> agent_lessons) and the draft-vs-final audit
// (agent_approvals) only fire inside the deck, the card is left stale, and a
// quiet-hours-PARKED agent send can later double-text a lead a human already
// answered. ~13 staff reply surfaces POST /api/ghl/send-message, so one gate there
// covers all of them (the three agent APIs send directly and deliberately bypass it,
// so there is no loop risk).
//
// Two halves, deliberately different in severity:
//
//   pendingHawkeyeCard  - a card is waiting for review. SMS sends 409 and the UI
//                         reroutes staff into the deck.
//   cancelParkedHawkeye - an APPROVED-but-unsent (parked for quiet hours) card is
//                         now stale because a human just replied. Never blocks;
//                         it cancels the park so the lead can't be double-texted.
//                         Parked cards are invisible in the deck (_hk2Load filters
//                         status=pending), so 409'ing on one would dead-end staff
//                         at an empty queue. Runs on ALL channels - a human touch
//                         makes the parked message stale regardless of medium.
//
// FAIL OPEN, always. A Supabase blip, a slow query, an unexpected shape: every
// failure path returns "no card" / zero and lets the staff send proceed. Trapping
// staff behind a broken gate is far worse than one un-taught reply.
//
// Portal-native tables only (the V2 agent queues) - never reads or writes GHL, so
// V1 academies (which have zero agent rows) are completely inert here.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// The three Hawkeye review queues, in the deck's own priority order (booking ->
// confirm -> closing, matching _hmHawkIndex on the client). agent_followups is
// deliberately NOT here: it holds legacy quiet-lead nudges, not reviewable cards.
const QUEUES = [
  { agent: "booking", table: "agent_ready_replies"   },
  { agent: "confirm", table: "agent_confirm_replies" },
  { agent: "closing", table: "agent_closing_replies" },
];

const p10 = (raw) => { const d = String(raw || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

// Resolve a ghl_contact_id from a phone number via contacts.phone10 (the generated
// last-10-digits column - never match on raw `phone`, the shapes differ by source).
// Returns null on anything unexpected.
export async function hawkContactIdFromPhone(clientId, phone) {
  const ten = p10(phone);
  if (!ten) return null;
  try {
    const rows = await sb(`contacts?client_id=eq.${encodeURIComponent(clientId)}&phone10=eq.${encodeURIComponent(ten)}&select=ghl_contact_id&limit=1`);
    return (Array.isArray(rows) && rows[0] && rows[0].ghl_contact_id) || null;
  } catch (_) { return null; }
}

// Is there a PENDING Hawkeye card for this contact? -> { agent, card_id, contact_id }
// or null. Resolves contactId from phone when the caller only has a number.
//
// Hard 1200ms ceiling on the whole thing (Promise.race) and every error path
// returns null: the gate must never be the reason a staff message doesn't go out.
export async function pendingHawkeyeCard(clientId, { contactId = null, phone = null } = {}) {
  if (!clientId) return null;
  const work = (async () => {
    let cid = contactId ? String(contactId) : null;
    if (!cid && phone) cid = await hawkContactIdFromPhone(clientId, phone);
    if (!cid) return null;
    const enc = encodeURIComponent(cid);
    const hits = await Promise.all(QUEUES.map(async (q) => {
      try {
        const rows = await sb(`${q.table}?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${enc}&status=eq.pending&select=id&limit=1`);
        return (Array.isArray(rows) && rows[0]) ? { agent: q.agent, card_id: rows[0].id, contact_id: cid } : null;
      } catch (_) { return null; }
    }));
    return hits.find(Boolean) || null;
  })();
  try {
    return await Promise.race([work, new Promise((r) => setTimeout(() => r(null), 1200))]);
  } catch (_) { return null; }
}

// Cancel every PARKED Hawkeye card for this contact: approved, never sent, holding
// a send_after (the quiet-hours park). A human just answered this lead, so the
// queued message is stale. Returns how many rows were canceled. Never throws.
export async function cancelParkedHawkeye(clientId, contactId, reason = "staff replied directly") {
  if (!clientId || !contactId) return 0;
  const enc = encodeURIComponent(String(contactId));
  let n = 0;
  await Promise.all(QUEUES.map(async (q) => {
    try {
      const rows = await sb(
        `${q.table}?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${enc}` +
        `&status=eq.approved&sent_at=is.null&send_after=not.is.null`,
        {
          method: "PATCH", headers: { Prefer: "return=representation" },
          body: JSON.stringify({ status: "canceled", send_error: reason, updated_at: new Date().toISOString() }),
        }
      );
      if (Array.isArray(rows)) n += rows.length;
    } catch (e) { console.error(`[_hawk-gate] cancelParked ${q.table} failed (soft):`, e.message); }
  }));
  return n;
}
