import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 60;

// The missing backend handshake between the Stripe Matcher and the sellable
// runtime (Zoran 2026-07-08: "auto-fire after price match"). Once an offer's
// prices are CONFIRMED in pricing_catalog, this bridges them into Luka's typed
// runtime via /api/runtime/offers-sync - creating the bookable_program (unlocks
// the trial calendar) + the typed offer_prices (fills the enroll page's
// `purchasable`). Entitlement rules are DERIVED from the plan names:
//   "1x/week" -> 1 session credit/week · "2x/week" -> 2 · "Unlimited" -> unlimited
// (Future: these become an explicit field in the offer wizard's pricing section
// when academies turn on the parent app; the derivation is the interim default.)
//
//   POST /api/offers/make-sellable   { client_id, offer_id?, force? }
//     - no offer_id: syncs every offer that has confirmed canonical prices
//     - skips offers already synced (typed prices exist) unless force
//     → { synced: [{ offer_id, rules, result | already }] }
//
// Auth: staff or an active client_users member. The runtime endpoint itself is
// staff-only, so this drives it with the caller's staff token when they are
// staff, else a short-lived temp staff session (service role) removed in finally
// - same pattern as api/schedule/sync-offer.js.

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

// Same temp-staff pattern as api/schedule/sync-offer.js: the runtime endpoints
// are staff-only, so owner-triggered syncs mint a disposable staff session.
async function withStaffToken(ctx, fn) {
  if (ctx.isStaff && ctx.token) return await fn(ctx.token);
  if (!ANON_KEY) throw Object.assign(new Error("owner-triggered sync needs the anon key to mint a staff session"), { status: 500 });
  const email = `make-sellable+${ctx.user.id}@bam.local`;
  const pass = `Ms-${ctx.user.id}-${SUPABASE_SERVICE_KEY.slice(-8)}`;
  let userId = null, staffId = null;
  try {
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass, email_confirm: true }),
    }).then(r => r.json());
    userId = created.id || created.user?.id;
    const staffRow = await sb(`staff`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{ name: "Make Sellable (temp)", role: "admin", email, user_id: userId }]) });
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

// "1x/week" -> WEEKLY_CREDITS 1 · "2x / week" -> 2 · "Unlimited" -> UNLIMITED.
// Unparseable plan names default to UNLIMITED (no enforcement) rather than
// guessing a limit - credits get explicit wizard inputs later.
function deriveRules(planKeys) {
  const rules = {};
  for (const key of planKeys) {
    if (/unlimited/i.test(key)) { rules[key] = { kind: "UNLIMITED_BOOKING" }; continue; }
    const m = String(key).match(/(\d+)\s*x/i);
    const n = m ? Math.max(1, Math.min(14, parseInt(m[1], 10))) : null;
    rules[key] = n ? { kind: "WEEKLY_CREDITS", credits_per_period: n } : { kind: "UNLIMITED_BOOKING" };
  }
  return rules;
}

// The whole bridge for one client, callable without an HTTP request (the cron
// backstop uses this too). ctx defaults to a synthetic non-staff caller so
// withStaffToken mints its disposable staff session.
export async function runMakeSellable(clientId, { offerId = "", force = false, ctx = null } = {}) {
  // Offers with confirmed canonical pricing = ready to become sellable.
  const rows = await sb(
    `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&match_status=eq.confirmed&tier=eq.canonical&offer_id=not.is.null&offer_price_key=not.is.null` +
    (offerId ? `&offer_id=eq.${encodeURIComponent(offerId)}` : "") +
    `&select=offer_id,offer_price_key`
  ) || [];
  const byOffer = new Map();
  for (const r of rows) {
    if (!byOffer.has(r.offer_id)) byOffer.set(r.offer_id, new Set());
    byOffer.get(r.offer_id).add(String(r.offer_price_key).split("|")[0]);
  }
  if (!byOffer.size) return { synced: [], note: "no offers with confirmed pricing yet - run the Stripe Matcher first" };

  const synced = [];
  await withStaffToken(ctx || { isStaff: false, user: { id: "cron" } }, async (staffToken) => {
    for (const [oid, planSet] of byOffer) {
      // Idempotence: typed prices already exist -> already sellable.
      if (force !== true) {
        const typed = await sb(`offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&source_offer_id=eq.${encodeURIComponent(oid)}&select=id&limit=1`);
        if (Array.isArray(typed) && typed[0]) { synced.push({ offer_id: oid, already: true }); continue; }
      }
      const rules = deriveRules([...planSet]);
      const r = await fetch(`${PORTAL}/api/runtime/offers-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, offer_id: oid, mode: "apply", entitlement_rules: rules, offer_type: "TRAINING", purchase_kind: "MEMBERSHIP" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { synced.push({ offer_id: oid, error: j.error || `runtime ${r.status}` }); continue; }
      synced.push({ offer_id: oid, rules, result: { options: j.options?.length ?? j.planned?.options?.length, prices: j.prices?.length ?? undefined, ok: true } });
    }
  });
  return { synced };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = String(body.client_id || ctx.clientIds[0] || "").trim();
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const { synced, note } = await runMakeSellable(clientId, {
      offerId: String(body.offer_id || "").trim(),
      force: body.force === true,
      ctx,
    });
    return res.status(200).json({ ok: true, synced, ...(note ? { note } : {}) });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
