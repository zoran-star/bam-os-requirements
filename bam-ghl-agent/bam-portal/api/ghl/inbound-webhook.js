import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — GHL inbound-message webhook  ("P1 Spine")
//
//   POST /api/ghl/inbound-webhook
//
// GoHighLevel calls this whenever a parent REPLIES (configured per academy as a
// Workflow "Webhook" action on the "Customer replied" trigger). It's the shared
// signal the later phases consume:
//   • Nudge engine → cancel pending scheduled sends the instant a lead replies
//   • Sales agent  → wake up and own the thread on the first reply
// For now P1 just records the reply event into `ghl_inbound_messages`; the
// consumers are built in later phases.
//
// Auth: a shared secret (NOT a GHL marketplace signature, so it works with a
// plain Workflow Webhook action). Set GHL_WEBHOOK_SECRET in env and send it on
// the webhook as the `X-Webhook-Secret` header (same convention as
// /api/members/intake) OR a `?key=` query param.
//
// Gating: only V1.5 / V2 academies (clients.v15_access OR v2_access). V1
// (GoHighLevel-native) academies are skipped — the spine never touches them.
//
// Always replies 200 (except auth/method) so GHL never retry-storms us; real
// problems are logged + returned in the body for inspection.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// GHL's webhook payload keys vary by trigger/marketplace-vs-workflow, so read
// each value from a small list of likely field names.
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Shared-secret auth.
  const expected = (process.env.GHL_WEBHOOK_SECRET || "").trim();
  const provided = (req.headers["x-webhook-secret"] || req.query.key || "").toString().trim();
  if (!expected || provided !== expected) return res.status(401).json({ error: "unauthorized" });

  const p = req.body && typeof req.body === "object" ? req.body : {};

  // Only inbound replies. The "Customer replied" trigger only fires inbound, but
  // guard anyway in case the academy wired a broader trigger.
  const direction = String(pick(p, ["direction"]) || "").toLowerCase();
  if (direction === "outbound") return res.status(200).json({ skipped: "outbound" });

  const locationId      = pick(p, ["locationId", "location_id"]);
  const contactId       = pick(p, ["contactId", "contact_id"]);
  const conversationId  = pick(p, ["conversationId", "conversation_id"]);
  const messageId       = pick(p, ["messageId", "message_id", "id"]);
  const body            = pick(p, ["body", "message"]) || "";
  const channelRaw      = pick(p, ["messageType", "message_type", "channel", "type"]) || "";
  const channel         = String(channelRaw).replace(/^TYPE_/i, "").toLowerCase() || null;
  const occurredAtRaw   = pick(p, ["dateAdded", "createdAt", "timestamp", "date"]);

  if (!locationId) return res.status(200).json({ skipped: "no locationId in payload" });

  // Resolve the academy by GHL location, and GATE to V1.5/V2 only.
  let client;
  try {
    const rows = await sb(
      `clients?ghl_location_id=eq.${encodeURIComponent(String(locationId))}` +
      `&select=id,business_name,v15_access,v2_access&limit=1`
    );
    client = Array.isArray(rows) && rows[0];
  } catch (e) {
    console.error("ghl inbound-webhook lookup error:", e.message);
    return res.status(200).json({ error: e.message });
  }
  if (!client) return res.status(200).json({ skipped: "no academy for location", locationId });
  if (!client.v15_access && !client.v2_access) {
    return res.status(200).json({ skipped: "V1 academy — spine disabled", client_id: client.id });
  }

  // Record the reply event (idempotent on client_id + GHL message id).
  let occurredAt;
  try { occurredAt = occurredAtRaw ? new Date(occurredAtRaw).toISOString() : new Date().toISOString(); }
  catch (_) { occurredAt = new Date().toISOString(); }

  try {
    await sb(`ghl_inbound_messages?on_conflict=client_id,ghl_message_id`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify([{
        client_id:           client.id,
        ghl_location_id:     String(locationId),
        ghl_contact_id:      contactId ? String(contactId) : null,
        ghl_conversation_id: conversationId ? String(conversationId) : null,
        ghl_message_id:      messageId ? String(messageId) : null,
        channel,
        direction:           direction || "inbound",
        body:                String(body).slice(0, 8000),
        occurred_at:         occurredAt,
        raw:                 p,
      }]),
    });
  } catch (e) {
    console.error("ghl inbound-webhook insert error:", e.message);
    return res.status(200).json({ error: e.message });
  }

  return res.status(200).json({ ok: true, client_id: client.id, recorded: true });
}

export default withSentryApiRoute(handler);
