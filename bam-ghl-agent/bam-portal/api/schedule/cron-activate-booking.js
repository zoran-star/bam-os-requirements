import { withSentryApiRoute } from "../_sentry.js";
import { offerToTemplatePayloads } from "../_offer-schedule.js";
export const maxDuration = 90; // waits on one sync-offer invocation (itself up to 60s)

// Unattended executor for activation-checklist step 2 (calendar cutover):
// run api/schedule/sync-offer for real, link the offer's calendar entry
// points to the bookable program, then flip clients.booking_provider='portal'.
//
// The human "eyeball the dry-run" step is NOT skipped - it moved from a
// hardcoded ACTIVATIONS[] array in this file (edit + deploy per academy) to a
// DB-driven request: api/schedule/activate-booking.js shows the owner the
// planned templates + warnings, and on approval stamps
// bookable_programs.config.{activation_requested_at, activation_offer_id,
// expect_templates, activation_approved_by}. This cron picks those up. The
// runner still re-checks the expectation at execution time and refuses to flip
// on any drift or warning, so a schedule edited between review and run fails
// safe. (DETAIL Miami, the one ACTIVATIONS[] entry, flipped 2026-07-08 - its
// booking_provider is already 'portal', so nothing regresses.)
//
//   GET /api/schedule/cron-activate-booking               (Vercel cron, x-vercel-cron)
//   GET /api/schedule/cron-activate-booking?client_id=…   (manual, Bearer CRON_SECRET)
//
// Idempotent: once booking_provider='portal' the entry costs one clients read
// plus an entry-point link check (which also heals a partial earlier run).
// V2-only by construction: requests only come from the activate-booking flow.

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

// Persist the last report onto the program row (config.activation_report) so
// the public offer endpoint's telemetry block can surface WHY an activation
// is stuck - the cron's own response needs CRON_SECRET nobody has at hand.
async function recordReport(report) {
  if (!report) return;
  try {
    if (!report.program_id) {
      // Failure before the program lookup - resolve it so the error still lands.
      const progs = await sb(`bookable_programs?tenant_id=eq.${encodeURIComponent(report.client_id)}&status=eq.ACTIVE&select=id&order=sort_order.asc&limit=1`);
      report.program_id = progs?.[0]?.id || null;
      if (!report.program_id) return;
    }
    const rows = await sb(`bookable_programs?id=eq.${encodeURIComponent(report.program_id)}&select=config&limit=1`);
    const config = (rows?.[0] && rows[0].config) || {};
    await sb(`bookable_programs?id=eq.${encodeURIComponent(report.program_id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ config: { ...config, activation_report: { ...report, at: new Date().toISOString() } } }),
    });
  } catch (_) { /* telemetry only - never fail the run over it */ }
}

async function handler(req, res) {
  const isCron = !!req.headers["x-vercel-cron"];
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!isCron && !(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const one = String(req.query.client_id || "").trim();
    // DB-driven work list: programs whose config carries an activation request
    // (stamped by api/schedule/activate-booking.js on owner approval).
    const rows = await sb(
      `bookable_programs?status=eq.ACTIVE&config->>activation_requested_at=not.is.null&select=id,tenant_id,config`
    ) || [];
    const activations = rows.map(r => ({
      client_id: r.tenant_id,
      offer_id: (r.config || {}).activation_offer_id || (r.config || {}).source_offer_id || null,
      expect_templates: Number((r.config || {}).expect_templates) || 0,
    })).filter(a => a.client_id && a.offer_id && a.expect_templates > 0);
    const results = [];
    for (const a of activations) {
      if (one && a.client_id !== one) continue;
      let report;
      try {
        report = await runActivation(a);
      } catch (e) {
        report = { client_id: a.client_id, offer_id: a.offer_id, error: e.message };
      }
      results.push(report);
      await recordReport(report);
    }
    return res.status(200).json({ ok: true, activations: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
