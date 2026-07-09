import { withSentryApiRoute } from "../_sentry.js";
import { resolveOrMintPortalContact } from "../_contacts.js";
export const maxDuration = 60; // pages Stripe customers + batch contact lookups

// Vercel Serverless Function - Stripe-contact link cleanup (STAFF ONLY)
//
// Links every Stripe customer on an academy's connected account to a portal
// contact (the GHL contact import store). Locked decisions (2026-07-08):
//   C1 staff side (this tool)  C2 exact-email single match auto-links silently
//   C3 no match -> contact created (source='stripe-import')
//   C4 duplicates -> the existing merge tool (api/ghl/merge-contacts.js)
//
// POST /api/contacts/stripe-link  body: { action, client_id, ... }
//   action=sweep { cursor? }  -> pages /v1/customers (5 pages of 100 per call;
//       call again with next_cursor until has_more=false). Per customer:
//       already linked / decided -> skip; single exact-email contact match ->
//       AUTO-LINK (stamp contacts.stripe_customer_id); multi-email or
//       phone-only or conflicting link -> stripe_link_reviews row (pending);
//       no match -> mint a contact (needs email or phone, else review).
//   action=list               -> { reviews: [pending rows] }
//   action=link { review_id, contact_key } -> stamp + mark linked
//   action=skip { review_id } -> mark skipped
//
// Auth: BAM STAFF only - this is the staff-portal Stripe Link-Up view.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";
const PAGES_PER_CALL = 5; // 5 x 100 customers per invocation, cursor continues

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

async function resolveStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("auth required"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,name,email&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,email&limit=1`);
  }
  const row = Array.isArray(staff) && staff[0] ? staff[0] : null;
  if (!row) throw Object.assign(new Error("BAM staff only"), { status: 403 });
  return { user, staff: row };
}

function stripeKey() { return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY; }
async function stripeFetch(path, { stripeAccount } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

const normEmail = (e) => String(e || "").trim().toLowerCase();
const phone10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const contactLite = (c, reason) => ({
  ghl_contact_id: c.ghl_contact_id, name: c.name || null, email: c.email || null,
  phone: c.phone || null, athlete_name: c.athlete_name || null, reason,
});

// ── action: sweep ──────────────────────────────────────────
async function actionSweep(res, { clientId, acct, ctx, body }) {
  const cid = encodeURIComponent(clientId);
  const counts = { scanned: 0, already_linked: 0, auto_linked: 0, orphans_created: 0, review_added: 0, review_existing: 0, no_identifiers: 0 };
  let cursor = body.cursor || null;
  let hasMore = false;

  for (let page = 0; page < PAGES_PER_CALL; page++) {
    const qs = `limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`;
    const batch = await stripeFetch(`/customers?${qs}`, { stripeAccount: acct });
    const customers = Array.isArray(batch.data) ? batch.data : [];
    if (!customers.length) { hasMore = false; break; }
    cursor = customers[customers.length - 1].id;
    hasMore = batch.has_more === true;
    counts.scanned += customers.length;

    const ids = customers.map(c => c.id);
    const idList = ids.map(encodeURIComponent).join(",");
    const emails = [...new Set(customers.map(c => normEmail(c.email)).filter(Boolean))];
    const emailList = emails.map(e => encodeURIComponent(`"${e}"`)).join(",");

    // Batch lookups: contacts already linked to these customers, contacts by
    // email, and existing review decisions.
    const linkedRows = await sb(`contacts?client_id=${cid}&stripe_customer_id=in.(${idList})&select=id,ghl_contact_id,stripe_customer_id`).catch(() => []) || [];
    const linkedSet = new Set(linkedRows.map(r => r.stripe_customer_id));
    const emailRows = emails.length
      ? await sb(`contacts?client_id=${cid}&email=in.(${emailList})&select=id,ghl_contact_id,name,email,phone,athlete_name,stripe_customer_id`).catch(() => []) || []
      : [];
    const byEmail = new Map();
    for (const r of emailRows) {
      const k = normEmail(r.email);
      if (!byEmail.has(k)) byEmail.set(k, []);
      byEmail.get(k).push(r);
    }
    const reviewRows = await sb(`stripe_link_reviews?client_id=${cid}&stripe_customer_id=in.(${idList})&select=stripe_customer_id,status`).catch(() => []) || [];
    const reviewSet = new Set(reviewRows.map(r => r.stripe_customer_id));

    const newReviews = [];
    for (const c of customers) {
      if (linkedSet.has(c.id)) { counts.already_linked++; continue; }
      if (reviewSet.has(c.id)) { counts.review_existing++; continue; }
      const email = normEmail(c.email);
      const p10 = phone10(c.phone);
      const snapshot = {
        name: c.name || null, email: c.email || null, phone: c.phone || null,
        created_iso: c.created ? new Date(c.created * 1000).toISOString().slice(0, 10) : null,
      };

      // 1. Exact-email match.
      const emailMatches = email ? (byEmail.get(email) || []) : [];
      if (emailMatches.length === 1) {
        const m = emailMatches[0];
        if (m.stripe_customer_id && m.stripe_customer_id !== c.id) {
          // Contact already linked to a DIFFERENT customer -> human call.
          newReviews.push({ customer: c, snapshot, candidates: [contactLite(m, "email match, but contact is linked to another Stripe customer")] });
          continue;
        }
        await sb(`contacts?id=eq.${encodeURIComponent(m.id)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ stripe_customer_id: c.id, updated_at: new Date().toISOString() }),
        });
        counts.auto_linked++;
        continue;
      }
      if (emailMatches.length > 1) {
        newReviews.push({ customer: c, snapshot, candidates: emailMatches.map(m => contactLite(m, "same email on multiple contacts - consider the merge tool")) });
        continue;
      }

      // 2. Phone match (reviewed, never silent - families share phones).
      // Formats vary ("+1905...", "(905) 928-..."), so fetch by trailing last-4
      // (formatted numbers end with the last 4 digits together) and compare the
      // normalized last-10 in JS.
      if (p10.length === 10) {
        const phoneRows = await sb(
          `contacts?client_id=${cid}&phone=ilike.*${p10.slice(-4)}&select=id,ghl_contact_id,name,email,phone,athlete_name,stripe_customer_id&limit=25`
        ).catch(() => []) || [];
        const phoneMatches = phoneRows.filter(r => phone10(r.phone) === p10).slice(0, 6);
        if (phoneMatches.length) {
          newReviews.push({ customer: c, snapshot, candidates: phoneMatches.map(m => contactLite(m, "phone match")) });
          continue;
        }
      }

      // 3. No match -> mint a contact (needs email or phone to be findable later).
      if (email || p10.length === 10) {
        const parts = String(c.name || "").trim().split(/\s+/).filter(Boolean);
        const key = await resolveOrMintPortalContact(clientId, {
          name: c.name || null,
          first_name: parts[0] || null,
          last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
          email: email || null,
          phone: c.phone || null,
          stripe_customer_id: c.id,
          source: "stripe-import",
        });
        if (key) { counts.orphans_created++; continue; }
      }
      counts.no_identifiers++;
      newReviews.push({ customer: c, snapshot, candidates: [] });
    }

    if (newReviews.length) {
      await sb(`stripe_link_reviews?on_conflict=client_id,stripe_customer_id`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(newReviews.map(r => ({
          client_id: clientId,
          stripe_customer_id: r.customer.id,
          customer: r.snapshot,
          candidates: r.candidates,
          status: "pending",
        }))),
      });
      counts.review_added += newReviews.length;
    }

    if (!hasMore) break;
  }

  // One audit line per sweep call so the run is traceable.
  await sb(`member_audit_log`, {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      client_id: clientId, action_type: "stripe-contact-sweep",
      args: counts, performed_by_name: ctx.staff.name || ctx.staff.email || "staff",
    }]),
  }).catch(() => {});

  return res.status(200).json({ ok: true, ...counts, has_more: hasMore, next_cursor: hasMore ? cursor : null });
}

// ── action: list / link / skip ─────────────────────────────
async function actionList(res, { clientId }) {
  const rows = await sb(
    `stripe_link_reviews?client_id=eq.${encodeURIComponent(clientId)}&status=eq.pending&select=id,stripe_customer_id,customer,candidates,created_at&order=created_at.asc&limit=200`
  ) || [];
  return res.status(200).json({ reviews: rows });
}

async function loadReview(clientId, reviewId) {
  const rows = await sb(
    `stripe_link_reviews?id=eq.${encodeURIComponent(reviewId)}&client_id=eq.${encodeURIComponent(clientId)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function actionLink(res, { clientId, ctx, body }) {
  const review = await loadReview(clientId, body.review_id);
  if (!review) return res.status(404).json({ error: "review row not found" });
  if (review.status !== "pending") return res.status(409).json({ error: `already ${review.status}` });
  const contactKey = String(body.contact_key || "").trim();
  if (!contactKey) return res.status(400).json({ error: "contact_key required" });
  const rows = await sb(
    `contacts?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactKey)}&select=id&limit=1`
  );
  const contact = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!contact) return res.status(404).json({ error: "contact not found for this academy" });
  await sb(`contacts?id=eq.${encodeURIComponent(contact.id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ stripe_customer_id: review.stripe_customer_id, updated_at: new Date().toISOString() }),
  });
  await sb(`stripe_link_reviews?id=eq.${encodeURIComponent(review.id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "linked", decided_contact: contactKey, decided_by: ctx.staff.name || ctx.staff.email, decided_at: new Date().toISOString() }),
  });
  return res.status(200).json({ ok: true, linked: review.stripe_customer_id, contact_key: contactKey });
}

async function actionSkip(res, { clientId, ctx, body }) {
  const review = await loadReview(clientId, body.review_id);
  if (!review) return res.status(404).json({ error: "review row not found" });
  if (review.status !== "pending") return res.status(409).json({ error: `already ${review.status}` });
  await sb(`stripe_link_reviews?id=eq.${encodeURIComponent(review.id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "skipped", decided_by: ctx.staff.name || ctx.staff.email, decided_at: new Date().toISOString() }),
  });
  return res.status(200).json({ ok: true, skipped: review.stripe_customer_id });
}

// ── handler ────────────────────────────────────────────────
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    const ctx = await resolveStaff(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });

    const clientRows = await sb(
      `clients?id=eq.${encodeURIComponent(clientId)}&select=id,stripe_connect_account_id,stripe_connect_status&limit=1`
    );
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });

    if (body.action === "list") return await actionList(res, { clientId });
    if (body.action === "link") return await actionLink(res, { clientId, ctx, body });
    if (body.action === "skip") return await actionSkip(res, { clientId, ctx, body });

    if (body.action === "sweep") {
      if (!stripeKey()) throw new Error("Stripe secret key not configured");
      if (!client.stripe_connect_account_id || client.stripe_connect_status !== "connected") {
        return res.status(409).json({ error: "Stripe isn't connected for this academy" });
      }
      return await actionSweep(res, { clientId, acct: client.stripe_connect_account_id, ctx, body });
    }
    return res.status(400).json({ error: `unknown action: ${body.action || "(none)"}` });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
