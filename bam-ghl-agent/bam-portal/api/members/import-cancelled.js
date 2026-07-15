import { withSentryApiRoute } from "../_sentry.js";

// Import CANCELLED members (the accepted onboarding mini-flow, 2026-07-14).
//
// The owner clicks "Import cancelled" in the onboarding flow. We pull their
// churned Stripe subscriptions, match each one against the contacts already
// imported (this is WHY contacts import first), and hand back three buckets:
//
//   matched    exact email hit on a contact           → bulk-approve
//   review     phone or name hit only (fuzzy)         → human confirms which
//   none       nobody in the CRM matches              → create from Stripe, or skip
//
// Applying a decision tags the contact 'cancelled' and stores the cancel meta
// (cancelled_at / cancel_reason / last_plan / monthly_amount) in the contact's
// custom_fields jsonb - ON the record, deliberately NOT as custom_field_defs
// (Zoran 2026-07-14: no custom fields in the cancelled flow). Win-back and
// nurture read real history; nothing new appears on any form.
//
//   GET  /api/members/import-cancelled?client_id=
//     → { ok, buckets: { matched:[], review:[], none:[], already_member:[] } }
//   POST /api/members/import-cancelled
//     body { client_id, decisions: [{ customer_id, action: 'link'|'create'|'skip',
//            contact_id? }] }   (cancel meta rides each GET row and is echoed back)
//     → { ok, linked, created, skipped }
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_KEY           = process.env.STRIPE_SECRET_KEY;
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

async function stripeGet(path, stripeAccount) {
  const headers = { Authorization: `Bearer ${STRIPE_KEY}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`https://api.stripe.com/v1${path}`, { headers });
  const j = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${(j.error && j.error.message) || "error"}`);
  return j;
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
  return { isStaff, clientIds };
}

const normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-10) || null;
const normName  = (n) => String(n || "").toLowerCase().replace(/[^a-z ]/g, "").trim();

// One row per Stripe CUSTOMER (dedupe: cancelled → resubbed → cancelled is one
// person). Latest cancellation wins; sub count noted.
function collapseByCustomer(subs) {
  const by = new Map();
  for (const s of subs) {
    const cu = (s.customer && typeof s.customer === "object") ? s.customer : { id: s.customer };
    const prev = by.get(cu.id);
    const canceledAt = s.canceled_at || s.ended_at || null;
    const item = (s.items && s.items.data && s.items.data[0]) || {};
    const price = item.price || {};
    const row = {
      customer_id: cu.id,
      email: (cu.email || "").toLowerCase() || null,
      phone: cu.phone || null,
      name: cu.name || null,
      cancelled_at: canceledAt ? new Date(canceledAt * 1000).toISOString().slice(0, 10) : null,
      cancel_reason: (s.cancellation_details && (s.cancellation_details.feedback || s.cancellation_details.reason)) || null,
      last_plan: price.nickname || (price.product && price.product.name) || null,
      monthly_amount: price.unit_amount != null ? Math.round(price.unit_amount) / 100 : null,
      subs: 1,
    };
    if (!prev) by.set(cu.id, row);
    else {
      prev.subs += 1;
      if ((row.cancelled_at || "") > (prev.cancelled_at || "")) Object.assign(prev, { ...row, subs: prev.subs });
    }
  }
  return [...by.values()];
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = q.client_id || b.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const cRows = await sb(`clients?id=eq.${enc(clientId)}&select=stripe_connect_account_id,stripe_connect_status&limit=1`);
    const client = (Array.isArray(cRows) && cRows[0]) || {};
    const acct = client.stripe_connect_account_id;
    if (!acct) return res.status(400).json({ error: "Connect Stripe first - there is no account to read cancelled subscriptions from" });

    if (req.method === "GET") {
      // Cancelled subs (up to ~300 - plenty for an academy), one row per customer.
      let subs = [], starting_after = null;
      for (let page = 0; page < 3; page++) {
        const qs = new URLSearchParams({ status: "canceled", limit: "100" });
        qs.append("expand[]", "data.customer");
        qs.append("expand[]", "data.items.data.price.product");
        if (starting_after) qs.set("starting_after", starting_after);
        const r = await stripeGet(`/subscriptions?${qs.toString()}`, acct);
        subs = subs.concat(r.data || []);
        if (!r.has_more || !r.data.length) break;
        starting_after = r.data[r.data.length - 1].id;
      }
      const rows = collapseByCustomer(subs);

      // Match targets: the imported contacts (why contacts import FIRST) + the
      // live roster (a cancelled customer who resubscribed is a member - skip).
      const [contacts, members] = await Promise.all([
        sb(`contacts?client_id=eq.${enc(clientId)}&select=id,name,first_name,last_name,email,phone,tags&limit=2000`),
        sb(`members?client_id=eq.${enc(clientId)}&select=id,stripe_customer_id&limit=1000`),
      ]);
      const memberCustomers = new Set((members || []).map(m => m.stripe_customer_id).filter(Boolean));
      const byEmail = new Map(), byPhone = new Map(), byName = new Map();
      for (const c of contacts || []) {
        const nm = c.name || [c.first_name, c.last_name].filter(Boolean).join(" ");
        if (c.email) byEmail.set(String(c.email).toLowerCase(), c);
        const ph = normPhone(c.phone);
        if (ph) byPhone.set(ph, c);
        const nn = normName(nm);
        if (nn) byName.set(nn, { ...c, _name: nm });
      }
      const contactLabel = (c) => c.name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || c.phone || c.id;

      const buckets = { matched: [], review: [], none: [], already_member: [] };
      for (const row of rows) {
        if (memberCustomers.has(row.customer_id)) { buckets.already_member.push(row); continue; }
        const emailHit = row.email && byEmail.get(row.email);
        if (emailHit) {
          const already = Array.isArray(emailHit.tags) && emailHit.tags.includes("cancelled");
          buckets.matched.push({ ...row, contact_id: emailHit.id, contact_name: contactLabel(emailHit), why: "email", already_tagged: already });
          continue;
        }
        const phoneHit = normPhone(row.phone) && byPhone.get(normPhone(row.phone));
        const nameHit = normName(row.name) && byName.get(normName(row.name));
        if (phoneHit || nameHit) {
          const cand = phoneHit || nameHit;
          buckets.review.push({ ...row, candidate_id: cand.id, candidate_name: contactLabel(cand), why: phoneHit ? "phone" : "name" });
          continue;
        }
        buckets.none.push(row);
      }
      return res.status(200).json({ ok: true, total: rows.length, buckets });
    }

    if (req.method === "POST") {
      const decisions = Array.isArray(b.decisions) ? b.decisions : [];
      if (!decisions.length) return res.status(400).json({ error: "decisions required" });
      let linked = 0, created = 0, skipped = 0;
      const nowIso = new Date().toISOString();
      const metaOf = (d) => {
        const m = {};
        if (d.cancelled_at) m.cancelled_at = d.cancelled_at;
        if (d.cancel_reason) m.cancel_reason = d.cancel_reason;
        if (d.last_plan) m.last_plan = d.last_plan;
        if (d.monthly_amount != null) m.last_monthly_amount = d.monthly_amount;
        m.stripe_customer_id = d.customer_id;
        return m;
      };
      for (const d of decisions) {
        if (!d || !d.customer_id) continue;
        if (d.action === "skip") { skipped++; continue; }
        if (d.action === "link" && d.contact_id) {
          const rows = await sb(`contacts?id=eq.${enc(d.contact_id)}&client_id=eq.${enc(clientId)}&select=id,tags,custom_fields&limit=1`);
          const c = Array.isArray(rows) && rows[0];
          if (!c) { skipped++; continue; }
          const tags = Array.isArray(c.tags) ? c.tags.slice() : [];
          if (!tags.includes("cancelled")) tags.push("cancelled");
          await sb(`contacts?id=eq.${enc(c.id)}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ tags, custom_fields: { ...(c.custom_fields || {}), ...metaOf(d) }, updated_at: nowIso }),
          });
          linked++;
          continue;
        }
        if (d.action === "create") {
          // Mint a portal contact from the Stripe data (same id=ghl_contact_id
          // convention as _contacts.js resolveOrMintPortalContact).
          const minted = globalThis.crypto.randomUUID();
          await sb(`contacts?select=id`, {
            method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify([{
              id: minted, client_id: clientId, ghl_contact_id: minted,
              name: d.name || null, email: d.email || null, phone: d.phone || null,
              tags: ["cancelled"], custom_fields: metaOf(d),
              date_added: nowIso, updated_at: nowIso,
            }]),
          });
          created++;
          continue;
        }
        skipped++;
      }
      return res.status(200).json({ ok: true, linked, created, skipped });
    }

    return res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
