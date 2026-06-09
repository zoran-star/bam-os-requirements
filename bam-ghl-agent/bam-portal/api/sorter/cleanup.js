import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 60; // Stripe cross-checks + DB promote — avoid the short default timeout
// Vercel Serverless Function — The Pricing Sorter, STEP 3: cleanup checks + promote.
//
// Final step of the import wizard (see memories/project_pricing_sorter.md). Reads
// the staged rows for one import batch, cross-references them against the academy's
// LIVE Stripe customers/subs, their pricing_catalog, and their Offers, then either
// REPORTS what's wrong (action=check) or PROMOTES the clean rows into the live
// `members` table (action=promote). Nothing destructive happens in check mode.
//
// POST /api/sorter/cleanup?action=check
//   body: { client_id, batch_id }
//   → runs 4 check groups, writes match_status/stripe_linked/is_duplicate/
//     cleanup_notes back to members_staging, returns a structured { checks, counts }.
//
// POST /api/sorter/cleanup?action=promote   (or body { apply: true })
//   body: { client_id, batch_id, staging_ids?: [...] }
//   → upserts each eligible staged row into live `members` (dedupe on
//     client_id+parent_email+athlete_name → PATCH if exists, else POST), links the
//     resolved Stripe ids, marks the staging row promoted=true.
//
// Auth: Supabase JWT — staff (any academy) or a client_users member of client_id.
// Needs STRIPE_CONNECT_SECRET_KEY (live platform key).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

function nowIso() { return new Date().toISOString(); }
function normEmail(s) { return (s || "").toString().trim().toLowerCase(); }
function normName(s) { return (s || "").toString().trim().toLowerCase().replace(/\s+/g, " "); }

// members.status is the `member_status` enum (live|paused|payment_method_required|
// payment_failed). Sheet statuses are free text (active/cancelled/paused/…), so map
// the few we can recognize and default everything else to 'live' — never pass a raw
// sheet string straight into the enum column (it would throw on insert/patch).
function toMemberStatus(raw) {
  const s = (raw || "").toString().trim().toLowerCase();
  if (s === "paused" || s === "pause" || s === "on hold" || s === "hold") return "paused";
  return "live";
}

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

// Auth: staff (any client) or active client_users membership of client_id.
async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

function stripeKey() {
  return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
}
async function stripeGet(path, stripeAccount) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

const ACTIVEISH = new Set(["active", "trialing", "past_due", "paused", "unpaid"]);

// Pull all subscriptions on the connected account (any status), expanded, and
// build an email → { customer_id, sub_id, price_id, status } map for both-ways
// linking. Mirrors fetchLiveSubs() in offers/match-prices.js.
async function fetchLiveSubs(stripeAccount) {
  const out = [];
  let startingAfter = null;
  for (let page = 0; page < 20; page++) { // safety cap (20×100 = 2000 subs)
    const qs = new URLSearchParams({ status: "all", limit: "100" });
    qs.append("expand[]", "data.items.data.price");
    qs.append("expand[]", "data.customer");
    if (startingAfter) qs.set("starting_after", startingAfter);
    const r = await stripeGet(`/subscriptions?${qs.toString()}`, stripeAccount);
    const data = r.data || [];
    out.push(...data);
    if (!r.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return out;
}

// email → live Stripe linkage (prefer an active-ish sub when a customer has many).
function buildEmailMap(subs) {
  const map = new Map();
  for (const sub of subs) {
    const cust = sub.customer && typeof sub.customer === "object" ? sub.customer : null;
    const email = normEmail(cust && cust.email);
    if (!email) continue;
    const item = sub.items && sub.items.data && sub.items.data[0];
    const price = item && item.price;
    const entry = {
      customer_id: typeof sub.customer === "string" ? sub.customer : (cust && cust.id) || null,
      sub_id: sub.id,
      price_id: (price && price.id) || null,
      status: sub.status,
      amount_cents: price ? price.unit_amount : null,
    };
    const prev = map.get(email);
    // keep the first active-ish sub; otherwise keep whatever we already have.
    if (!prev || (!ACTIVEISH.has(prev.status) && ACTIVEISH.has(sub.status))) map.set(email, entry);
  }
  return map;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const batchId = body.batch_id || body.import_batch_id;
    if (!batchId) return res.status(400).json({ error: "batch_id required" });

    const action = (req.query && req.query.action) || (body.apply === true ? "promote" : "check");

    // Staged rows for this batch (scoped to the client_id).
    const staging = await sb(
      `members_staging?client_id=eq.${encodeURIComponent(clientId)}` +
      `&import_batch_id=eq.${encodeURIComponent(batchId)}` +
      `&select=*&order=source_row.asc`
    ) || [];

    // ════════════════════════════ PROMOTE ════════════════════════════
    if (action === "promote") {
      const onlyIds = Array.isArray(body.staging_ids) && body.staging_ids.length
        ? new Set(body.staging_ids.map(String)) : null;
      const promoted = [];
      const skipped = [];
      const memberIds = [];

      for (const s of staging) {
        if (onlyIds && !onlyIds.has(String(s.id))) continue;
        if (s.promoted) { skipped.push({ id: s.id, reason: "already promoted" }); continue; }
        if (s.is_duplicate) { skipped.push({ id: s.id, reason: "duplicate" }); continue; }
        const athleteName = (s.athlete_name || "").toString().trim();
        const parentEmail = normEmail(s.parent_email);
        if (!athleteName || !parentEmail) { skipped.push({ id: s.id, reason: "missing athlete_name or parent_email" }); continue; }

        // 1:1 column copy matching the live `members` insert shape in checkout.js.
        const memberFields = {
          client_id:              clientId,
          athlete_name:           athleteName,
          parent_name:            s.parent_name || null,
          parent_email:           parentEmail,
          parent_phone:           s.parent_phone || null,
          plan:                   s.plan || null,
          status:                 toMemberStatus(s.status),
          stripe_customer_id:     s.stripe_customer_id || null,
          stripe_subscription_id: s.stripe_subscription_id || null,
          stripe_price_id:        s.stripe_price_id || null,
          joined_date:            s.joined_date || null,
          updated_at:             nowIso(),
        };

        // Idempotency on (client_id, parent_email, athlete_name): PATCH if exists, else POST.
        const existingRows = await sb(
          `members?client_id=eq.${encodeURIComponent(clientId)}` +
          `&parent_email=eq.${encodeURIComponent(parentEmail)}` +
          `&athlete_name=eq.${encodeURIComponent(athleteName)}` +
          `&select=id&limit=1`
        );
        const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;

        let memberId = null;
        if (existing) {
          await sb(`members?id=eq.${existing.id}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify(memberFields),
          });
          memberId = existing.id;
        } else {
          memberFields.created_at = nowIso();
          const inserted = await sb(`members?select=id`, {
            method: "POST", headers: { Prefer: "return=representation" },
            body: JSON.stringify([memberFields]),
          });
          memberId = Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
        }

        // Mark the staging row promoted + link the live member id.
        await sb(`members_staging?id=eq.${s.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            promoted: true,
            promoted_member_id: memberId,
            match_status: "ok",
            updated_at: nowIso(),
          }),
        });

        // Audit (non-fatal), mirroring checkout.js.
        try {
          await sb(`member_audit_log`, {
            method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify([{
              client_id: clientId, member_id: memberId,
              action_type: "sorter-promote",
              args: { staging_id: s.id, import_batch_id: batchId, source_row: s.source_row, reused: !!existing },
              performed_by_name: ctx.user && ctx.user.email ? `Pricing Sorter (${ctx.user.email})` : "Pricing Sorter",
            }]),
          });
        } catch (_) { /* non-fatal */ }

        promoted.push({ id: s.id, member_id: memberId, reused: !!existing });
        if (memberId) memberIds.push(memberId);
      }

      return res.status(200).json({ ok: true, promoted, skipped, member_ids: memberIds, counts: { promoted: promoted.length, skipped: skipped.length } });
    }

    // ════════════════════════════ CHECK ════════════════════════════
    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id&limit=1`);
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });

    // Live Stripe linkage by email (skip gracefully if not connected).
    let emailMap = new Map();
    if (client.stripe_connect_account_id) {
      try {
        const subs = await fetchLiveSubs(client.stripe_connect_account_id);
        emailMap = buildEmailMap(subs);
      } catch (_) { emailMap = new Map(); }
    }

    // pricing_catalog for this client → routable price set + offer_price_key set + tier sanity.
    const catalog = await sb(
      `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}` +
      `&select=stripe_price_id,offer_price_key,tier,interval,amount_cents,is_routable`
    ) || [];
    const catalogByPrice = Object.fromEntries(catalog.filter(c => c.stripe_price_id).map(c => [c.stripe_price_id, c]));
    const offerKeys = new Set(catalog.map(c => c.offer_price_key).filter(Boolean));

    // ── (a) member ⇄ Stripe link, both ways ──
    const stagedNoStripe = [];
    const stagedEmails = new Set();
    for (const s of staging) {
      const email = normEmail(s.parent_email);
      if (email) stagedEmails.add(email);
      const link = email ? emailMap.get(email) : null;
      if (!link) {
        stagedNoStripe.push({ id: s.id, source_row: s.source_row, athlete_name: s.athlete_name, parent_email: s.parent_email });
      }
    }
    const stripeNoMember = [];
    for (const [email, link] of emailMap.entries()) {
      if (!stagedEmails.has(email)) {
        stripeNoMember.push({ email, customer_id: link.customer_id, sub_id: link.sub_id, price_id: link.price_id, status: link.status });
      }
    }

    // ── (b) duplicates within the batch (same parent_email OR same athlete_name) ──
    const byEmail = new Map();
    const byAthlete = new Map();
    for (const s of staging) {
      const email = normEmail(s.parent_email);
      const athlete = normName(s.athlete_name);
      if (email) { if (!byEmail.has(email)) byEmail.set(email, []); byEmail.get(email).push(s); }
      if (athlete) { if (!byAthlete.has(athlete)) byAthlete.set(athlete, []); byAthlete.get(athlete).push(s); }
    }
    const dupIds = new Set();
    const duplicates = [];
    for (const [email, rows] of byEmail.entries()) {
      if (rows.length > 1) {
        duplicates.push({ kind: "parent_email", value: email, ids: rows.map(r => r.id), names: rows.map(r => r.athlete_name) });
        rows.forEach(r => dupIds.add(r.id));
      }
    }
    for (const [athlete, rows] of byAthlete.entries()) {
      if (rows.length > 1) {
        duplicates.push({ kind: "athlete_name", value: athlete, ids: rows.map(r => r.id), names: rows.map(r => r.athlete_name) });
        rows.forEach(r => dupIds.add(r.id));
      }
    }

    // ── (c) staged rows whose plan/price maps to NO offer ──
    const noOfferIds = new Set();
    const noOffer = [];
    for (const s of staging) {
      const email = normEmail(s.parent_email);
      const link = email ? emailMap.get(email) : null;
      const priceId = s.stripe_price_id || (link && link.price_id) || null;
      const cat = priceId ? catalogByPrice[priceId] : null;
      const keyFromCat = cat && cat.offer_price_key;
      const keyFromStaging = s.offer_price_key;
      const hasOffer = (keyFromCat && offerKeys.has(keyFromCat)) || (keyFromStaging && offerKeys.has(keyFromStaging));
      if (!hasOffer) {
        noOfferIds.add(s.id);
        noOffer.push({
          id: s.id, source_row: s.source_row, athlete_name: s.athlete_name,
          plan: s.plan, offer_price_key: keyFromStaging || keyFromCat || null,
          stripe_price_id: priceId,
          reason: priceId ? (cat ? "price has no offer_price_key in catalog" : "price not in pricing_catalog") : "no plan/price to resolve",
        });
      }
    }

    // ── (d) Live/Legacy organised: exactly one tier='canonical' per offer_price_key ──
    const canonicalByKey = {};
    for (const c of catalog) {
      if (!c.offer_price_key) continue;
      if (c.tier === "canonical") canonicalByKey[c.offer_price_key] = (canonicalByKey[c.offer_price_key] || 0) + 1;
      else if (!(c.offer_price_key in canonicalByKey)) canonicalByKey[c.offer_price_key] = canonicalByKey[c.offer_price_key] || 0;
    }
    const tierIssues = [];
    for (const key of Object.keys(canonicalByKey)) {
      const n = canonicalByKey[key];
      if (n !== 1) tierIssues.push({ offer_price_key: key, canonical_count: n, issue: n === 0 ? "no canonical price" : "more than one canonical price" });
    }

    // ── Write the verdict back to each staging row ──
    for (const s of staging) {
      const email = normEmail(s.parent_email);
      const link = email ? emailMap.get(email) : null;
      const linked = !!link;
      const isDup = dupIds.has(s.id);
      const noOff = noOfferIds.has(s.id);
      let match_status = "ok";
      if (isDup) match_status = "duplicate";
      else if (noOff) match_status = "no_offer";
      else if (!linked) match_status = "needs_fix";
      const notes = [];
      if (!linked) notes.push("no Stripe match by email");
      if (isDup) notes.push("duplicate within batch");
      if (noOff) notes.push("on a price with no offer");
      const patch = {
        match_status,
        stripe_linked: linked,
        is_duplicate: isDup,
        cleanup_notes: notes.length ? notes.join("; ") : null,
        // resolve the Stripe ids from the live link when the sheet didn't carry them
        stripe_customer_id:     s.stripe_customer_id || (link && link.customer_id) || null,
        stripe_subscription_id: s.stripe_subscription_id || (link && link.sub_id) || null,
        stripe_price_id:        s.stripe_price_id || (link && link.price_id) || null,
        updated_at: nowIso(),
      };
      await sb(`members_staging?id=eq.${s.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    }

    const cleanCount = staging.filter(s => !dupIds.has(s.id) && !noOfferIds.has(s.id) && (s.athlete_name || "").toString().trim() && normEmail(s.parent_email)).length;

    return res.status(200).json({
      ok: true,
      academy: client.business_name,
      counts: {
        staged: staging.length,
        staged_no_stripe: stagedNoStripe.length,
        stripe_no_member: stripeNoMember.length,
        duplicates: duplicates.length,
        no_offer: noOffer.length,
        tier_issues: tierIssues.length,
        clean: cleanCount,
      },
      checks: {
        links: { staged_no_stripe: stagedNoStripe, stripe_no_member: stripeNoMember },
        duplicates,
        no_offer: noOffer,
        tier_issues: tierIssues,
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
