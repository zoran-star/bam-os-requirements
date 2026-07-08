import { withSentryApiRoute } from "../_sentry.js";
import { offerToTemplatePayloads } from "../_offer-schedule.js";
export const maxDuration = 90; // waits on one sync-offer invocation (itself up to 60s)

// Unattended executor for activation-checklist step 2 (calendar cutover):
// run api/schedule/sync-offer for real, link the offer's calendar entry
// points to the bookable program, then flip clients.booking_provider='portal'.
//
// The human "eyeball the dry-run" step is NOT skipped - it moves into code
// review: an academy only activates when someone adds it to ACTIVATIONS below
// with the expected template count, after eyeballing the planned payloads
// (offline dry-run or sync-offer dry_run:true). The runner re-checks that
// expectation at execution time and refuses to flip on any drift or warning,
// so a schedule edited between review and run fails safe.
//
//   GET /api/schedule/cron-activate-booking               (Vercel cron, x-vercel-cron)
//   GET /api/schedule/cron-activate-booking?client_id=…   (manual, Bearer CRON_SECRET)
//
// Idempotent: once booking_provider='portal' the entry costs one clients read
// plus an entry-point link check (which also heals a partial earlier run).
// V2-only by construction: activations are explicit rows in this file.

// ── Approved activations (adding a row here = the eyeball record) ──────────
const ACTIVATIONS = [
  {
    // DETAIL Miami - Training offer. Approved by Zoran 2026-07-08 after
    // eyeballing the planned template: "Training - DETAIL Academy
    // (Mon, Wed, Fri)" 18:00-20:00, capacity 25, trial credit cost 0.
    client_id: "4708a68d-5365-48bf-a404-72a69fadd34d",
    offer_id: "7d82f15e-db2e-45e5-9f22-9de86ff88254",
    expect_templates: 1,
  },
];

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const PORTAL = "https://portal.byanymeansbusiness.com";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Same disposable-staff pattern as make-sellable.js / sync-offer.js: sync-offer
// authenticates staff via the staff table, so the cron mints a temp staff
// session to drive it and deletes it in finally.
async function withTempStaff(fn) {
  if (!ANON_KEY) throw new Error("cron activation needs the anon key to mint a staff session");
  const email = "booking-activate+cron@bam.local";
  const pass = `Ba-cron-${SUPABASE_SERVICE_KEY.slice(-8)}`;
  let userId = null, staffId = null;
  try {
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass, email_confirm: true }),
    }).then(r => r.json());
    userId = created.id || created.user?.id;
    if (!userId) throw new Error(`temp staff user create failed: ${created.msg || created.error_description || created.message || "no id"}`);
    const staffRow = await sb(`staff`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{ name: "Booking Activate (temp)", role: "admin", email, user_id: userId }]) });
    staffId = staffRow?.[0]?.id;
    const signin = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pass }),
    }).then(r => r.json());
    if (!signin.access_token) throw new Error("temp staff sign-in failed");
    return await fn(signin.access_token);
  } finally {
    if (staffId) await sb(`staff?id=eq.${staffId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
    if (userId) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }).catch(() => {});
  }
}

async function runActivation(a) {
  const report = { client_id: a.client_id, offer_id: a.offer_id };

  const clients = await sb(`clients?id=eq.${encodeURIComponent(a.client_id)}&select=id,business_name,booking_provider&limit=1`);
  const client = Array.isArray(clients) && clients[0];
  if (!client) return { ...report, error: "client not found" };
  report.business = client.business_name;

  // offers-sync (make-sellable) must have created the program first; until
  // then this activation just waits - no error, the next cron tick retries.
  const programs = await sb(`bookable_programs?tenant_id=eq.${encodeURIComponent(a.client_id)}&status=eq.ACTIVE&select=id&order=sort_order.asc&limit=1`);
  const programId = Array.isArray(programs) && programs[0] && programs[0].id;
  if (!programId) return { ...report, waiting: "no active bookable program yet" };
  report.program_id = programId;

  if (client.booking_provider !== "portal") {
    // Guard: the schedule must still produce exactly what was eyeballed.
    const offers = await sb(`offers?id=eq.${encodeURIComponent(a.offer_id)}&client_id=eq.${encodeURIComponent(a.client_id)}&select=id,title,data&limit=1`);
    const offer = Array.isArray(offers) && offers[0];
    if (!offer) return { ...report, error: "offer not found" };
    const { templates, warnings } = offerToTemplatePayloads(offer, { clientId: a.client_id, bookableProgramId: programId });
    if (warnings.length || templates.length !== a.expect_templates) {
      return { ...report, guard_failed: true, planned: templates.length, expected: a.expect_templates, warnings };
    }

    // Execute the real sync through the deployed orchestrator (templates +
    // dedupe + deactivations + 365d slot generation live in ONE place there).
    const result = await withTempStaff(async (staffToken) => {
      const r = await fetch(`${PORTAL}/api/schedule/sync-offer`, {
        method: "POST",
        headers: { Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: a.client_id, offer_id: a.offer_id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(`sync-offer failed: ${j.error || r.status}`);
      return j;
    });
    report.sync = {
      created: (result.created || []).length,
      skipped: (result.skipped || []).length,
      deactivated: (result.deactivated || []).length,
      slots: result.slots,
    };
    // Templates must actually exist on the spine before booking leaves GHL.
    if (report.sync.created + report.sync.skipped < a.expect_templates) {
      return { ...report, error: "sync produced fewer templates than expected - not flipping" };
    }

    await sb(`clients?id=eq.${encodeURIComponent(a.client_id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ booking_provider: "portal" }),
    });
    report.flipped = true;
  } else {
    report.already = true;
  }

  // Link the offer's calendar entry points to the program (idempotent; also
  // heals a run that flipped but crashed before linking).
  const linked = await sb(
    `entry_points?client_id=eq.${encodeURIComponent(a.client_id)}&offer_id=eq.${encodeURIComponent(a.offer_id)}&type=eq.calendar&bookable_program_id=is.null`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ bookable_program_id: programId }) }
  );
  report.linked_entry_points = Array.isArray(linked) ? linked.length : 0;

  return report;
}

async function handler(req, res) {
  const isCron = !!req.headers["x-vercel-cron"];
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!isCron && !(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const one = String(req.query.client_id || "").trim();
    const results = [];
    for (const a of ACTIVATIONS) {
      if (one && a.client_id !== one) continue;
      try {
        results.push(await runActivation(a));
      } catch (e) {
        results.push({ client_id: a.client_id, offer_id: a.offer_id, error: e.message });
      }
    }
    return res.status(200).json({ ok: true, activations: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
