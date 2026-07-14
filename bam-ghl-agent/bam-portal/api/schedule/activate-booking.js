import { withSentryApiRoute } from "../_sentry.js";
import { offerToTemplatePayloads } from "../_offer-schedule.js";

// Owner-facing booking go-live (Gap #1). Replaces the "edit ACTIVATIONS[] and
// deploy" step: the owner previews the planned slot templates generated from the
// offer's Schedule section, approves, and the request is stored on the bookable
// program; cron-activate-booking picks it up (within ~10 min), runs sync-offer,
// links the calendar entry points, and flips clients.booking_provider='portal'.
//
//   GET  /api/schedule/activate-booking?client_id=&offer_id=
//     → { ok, booking_provider, program_id, requested_at, report, planned:[...], warnings:[...] }
//   POST /api/schedule/activate-booking   body { client_id, offer_id }
//     → { ok, queued: true, expect_templates }
//        409 when the schedule has warnings / no templates (fix the offer first)
//        409 when no bookable program exists yet (confirm pricing first)
//
// The cron's fail-safe guard is preserved: it re-runs the transformation at
// execution time and refuses to flip on any drift from expect_templates.
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const enc = encodeURIComponent;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds, email: user.email || null };
}

async function loadContext(clientId, offerId) {
  const [clients, offers, programs] = await Promise.all([
    sb(`clients?id=eq.${enc(clientId)}&select=id,booking_provider&limit=1`),
    sb(`offers?id=eq.${enc(offerId)}&client_id=eq.${enc(clientId)}&select=id,title,data&limit=1`),
    sb(`bookable_programs?tenant_id=eq.${enc(clientId)}&status=eq.ACTIVE&select=id,config&order=sort_order.asc&limit=1`),
  ]);
  return {
    client: Array.isArray(clients) && clients[0],
    offer: Array.isArray(offers) && offers[0],
    program: Array.isArray(programs) && programs[0],
  };
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = q.client_id || b.client_id;
    const offerId = q.offer_id || b.offer_id;
    if (!clientId || !offerId) return res.status(400).json({ error: "client_id and offer_id required" });
    const { isStaff, clientIds, email } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const { client, offer, program } = await loadContext(clientId, offerId);
    if (!client) return res.status(404).json({ error: "academy not found" });
    if (!offer) return res.status(404).json({ error: "offer not found for this academy" });

    const programId = program ? program.id : null;
    const { templates, warnings } = offerToTemplatePayloads(offer, { clientId, bookableProgramId: programId });
    const planned = templates.map(t => ({
      name: t.payload.name,
      recurrence: t.payload.recurrence_rule,
      start: t.payload.default_start_time,
      end: t.payload.default_end_time,
      capacity: t.payload.default_capacity,
    }));

    if (req.method === "GET") {
      const cfg = (program && program.config) || {};
      return res.status(200).json({
        ok: true,
        booking_provider: client.booking_provider || "ghl",
        program_id: programId,
        requested_at: cfg.activation_requested_at || null,
        report: cfg.activation_report || null,
        planned, warnings,
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST required" });

    // Go live: the program must exist (offers-sync creates it once pricing is
    // confirmed), and the schedule must transform cleanly.
    if (!programId) {
      return res.status(409).json({ error: "No bookable program yet. Confirm your pricing first (the price match creates it automatically), then try again." });
    }
    if (warnings.length) return res.status(409).json({ error: "Fix the schedule first", warnings });
    if (!templates.length) return res.status(409).json({ error: "The Schedule section has no weekly class times yet - add them first." });
    if ((client.booking_provider || "ghl") === "portal") {
      return res.status(200).json({ ok: true, already: true });
    }

    // Record the approval on the program row - the same "eyeball record" the
    // hardcoded ACTIVATIONS[] array used to be, now DB-driven.
    const cfg = (program.config) || {};
    await sb(`bookable_programs?id=eq.${enc(programId)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        config: {
          ...cfg,
          activation_requested_at: new Date().toISOString(),
          activation_offer_id: offerId,
          expect_templates: templates.length,
          activation_approved_by: email,
        },
      }),
    });
    return res.status(200).json({ ok: true, queued: true, expect_templates: templates.length });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
