import { withSentryApiRoute } from "../_sentry.js";
import { offerToTemplatePayloads } from "../_offer-schedule.js";
export const maxDuration = 60; // several runtime calls (+ maybe a temp-staff mint)

// ⚠️ DRAFT - Path B orchestrator. NOT wired to any trigger yet, and it can't be
// live-tested until the academy has a bookable_program (created by offers-sync
// once the Stripe Matcher confirms pricing). See docs/offer-schedule-to-slots-spec.md.
//
// Turns a Training offer's captured schedule (data.classes[].weekly_times[]) +
// data.capacity into portal-native bookable slots on Luka's runtime spine. This
// is the ONLY place the portal writes to the calendar spine, and it does so via
// his sanctioned staff endpoints - never raw inserts.
//
//   POST /api/schedule/sync-offer   { client_id, offer_id, dry_run? }
//     → { ok, program_id, created, skipped, deactivated, slots, warnings }
//
// Pipeline:
//   1. load offer → offerToTemplatePayloads(offer, { clientId, bookableProgramId })
//   2. GET runtime templates → dedupe by matchKey (recurrence|start|end)
//   3. POST the new ones; PATCH is_active:false on templates no longer in the offer
//   4. generate-slots in 92-day windows (MAX_GENERATION_DAYS) out to +365d
//      (Zoran: rolling 1-year coverage; a cron keeps extending after)
//
// Auth: staff, OR a client_users member of client_id. Luka's runtime endpoints
// are staff-only, so we drive them with a staff token - the caller's own when
// they are staff, else a short-lived temp staff session (service role) removed
// in finally. Trials cost 0 credits; capacity comes from the offer.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const PORTAL = "https://portal.byanymeansbusiness.com";
const RUNTIME = `${PORTAL}/api/runtime/schedule`;
const MAX_WINDOW_DAYS = 92;   // generate-slots hard cap (MAX_GENERATION_DAYS)
const COVERAGE_DAYS = 365;    // rolling 1-year coverage

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Caller auth (mirrors offers/create-price.js): staff (any academy) or an active
// client_users member of client_id. Returns the caller's bearer token too.
async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, token, isStaff, clientIds };
}

async function runtimeFetch(staffToken, method, path, body) {
  const r = await fetch(`${RUNTIME}${path}`, {
    method,
    headers: { Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  const json = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw Object.assign(new Error(`runtime ${method} ${path}: ${json.error || r.status}`), { detail: json });
  return json;
}

// Run fn(staffToken) against Luka's staff-only endpoints. Reuse the caller's
// token if they're staff; otherwise mint a temp staff session (service role,
// like scripts/extend-gta-slots.mjs) and delete it in finally.
async function withStaffToken(ctx, fn) {
  if (ctx.isStaff && ctx.token) return await fn(ctx.token);
  if (!ANON_KEY) throw Object.assign(new Error("owner-triggered sync needs the anon key to mint a staff session"), { status: 500 });

  const email = `schedule-sync+${ctx.user.id}@bam.local`;
  const pass = `Sx-${ctx.user.id}-${SUPABASE_SERVICE_KEY.slice(-8)}`;
  let userId = null, staffId = null;
  try {
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass, email_confirm: true }),
    }).then(r => r.json());
    userId = created.id || created.user?.id;
    const staffRow = await sb(`staff`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{ name: "Schedule Sync (temp)", role: "admin", email, user_id: userId }]) });
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

// Dedupe key - MUST mirror offerToTemplatePayloads' matchKey. DB times can be
// "HH:MM:SS"; normalize to "HH:MM".
const hhmm = (t) => String(t || "").slice(0, 5);
const matchKeyOf = (t) => `${t.recurrence_rule || ""}|${hhmm(t.default_start_time)}|${hhmm(t.default_end_time)}`;

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = String(body.client_id || ctx.clientIds[0] || "").trim();
    const offerId = String(body.offer_id || "").trim();
    const dryRun = body.dry_run === true;
    if (!clientId || !offerId) return res.status(400).json({ error: "client_id and offer_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    // 1. Offer + its bookable program (offers-sync must have created it).
    const offers = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,title,data&limit=1`);
    const offer = Array.isArray(offers) && offers[0];
    if (!offer) return res.status(404).json({ error: "offer not found for this client" });

    const programs = await sb(`bookable_programs?tenant_id=eq.${encodeURIComponent(clientId)}&status=eq.ACTIVE&select=id&order=sort_order.asc&limit=1`);
    const programId = Array.isArray(programs) && programs[0] && programs[0].id;
    if (!programId) return res.status(409).json({ error: "no active bookable program yet - run the Stripe Matcher (offers-sync) first" });

    // 2. Transform the offer's schedule → template payloads.
    const { templates, warnings } = offerToTemplatePayloads(offer, { clientId, bookableProgramId: programId });
    if (dryRun) return res.status(200).json({ ok: true, dry_run: true, program_id: programId, planned: templates.map(t => t.payload), warnings });

    const result = await withStaffToken(ctx, async (staffToken) => {
      // 3. Existing templates → dedupe by matchKey.
      const listed = await runtimeFetch(staffToken, "GET", `/templates?client_id=${encodeURIComponent(clientId)}`);
      const existing = new Map((listed.templates || listed || []).map(t => [matchKeyOf(t), t]));
      const wanted = new Set(templates.map(t => t.matchKey));

      const created = [], skipped = [], deactivated = [];
      // create the new ones
      for (const { payload, matchKey } of templates) {
        if (existing.has(matchKey)) { skipped.push(matchKey); continue; }
        const r = await runtimeFetch(staffToken, "POST", `/templates`, payload);
        created.push({ matchKey, id: (r.template || r).id || null });
      }
      // deactivate templates that dropped out of the offer (this program only)
      for (const [key, t] of existing) {
        if (!wanted.has(key) && t.is_active && t.bookable_program_id === programId) {
          await runtimeFetch(staffToken, "PATCH", `/template?template_id=${encodeURIComponent(t.id)}`, { is_active: false });
          deactivated.push(key);
        }
      }

      // 4. Generate slots out to +365d in 92-day windows (rolling 1-year coverage).
      const today = new Date();
      let slots = 0, from = today;
      for (let off = 0; off < COVERAGE_DAYS; off += MAX_WINDOW_DAYS) {
        // generate-slots validates the INCLUSIVE span (daySpanInclusive counts
        // both endpoints), so a window must end at from+91 to span exactly 92
        // days - ending at +92 spans 93 and fails validation (bit Detail's
        // unattended activation on its first window).
        const to = addDays(today, Math.min(off + MAX_WINDOW_DAYS - 1, COVERAGE_DAYS));
        const g = await runtimeFetch(staffToken, "POST", `/generate-slots`, { client_id: clientId, date_from: ymd(from), date_to: ymd(to) });
        slots += Number(g.created || 0);
        from = addDays(to, 1);
      }
      return { created, skipped, deactivated, slots };
    });

    return res.status(200).json({ ok: true, program_id: programId, ...result, warnings });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e), detail: e.detail || undefined });
  }
}

export default withSentryApiRoute(handler);
