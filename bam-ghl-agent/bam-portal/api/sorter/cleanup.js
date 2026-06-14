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
async function stripePost(path, body, stripeAccount) {
  const headers = { Authorization: `Bearer ${stripeKey()}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const encoded = new URLSearchParams(Object.entries(body || {}).reduce((a, [k, v]) => {
    if (v !== undefined && v !== null) a[k] = String(v);
    return a;
  }, {})).toString();
  const res = await fetch(`${STRIPE_API}${path}`, { method: "POST", headers, body: encoded });
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
      name: (cust && cust.name) || null,
    };
    const prev = map.get(email);
    // keep the first active-ish sub; otherwise keep whatever we already have.
    if (!prev || (!ACTIVEISH.has(prev.status) && ACTIVEISH.has(sub.status))) map.set(email, entry);
  }
  return map;
}

// Small bounded Levenshtein for typo'd-email suggestions ("mguirges" vs
// "mguirgrs"). Bails early when the distance clearly exceeds `max`.
function editDistance(a, b, max = 2) {
  a = String(a); b = String(b);
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// Offer-price targets (plan × term) from the academy's Offers — mirrors
// buildOfferTargets() in offers/match-prices.js (kept lite: label + price only).
function _termFromLength(len) {
  const s = String(len || "").toLowerCase();
  if (s.includes("3")) return "3_months";
  if (s.includes("6")) return "6_months";
  if (s.includes("12") || s.includes("year")) return "12_months";
  return null;
}
async function buildTargetsLite(clientId) {
  const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&status=neq.archived&select=id,title,type,data`) || [];
  const HST = 1.13;
  const cents = n => Math.round(n * 100);
  const targets = [];
  for (const o of offers) {
    const offerings = (o.data && o.data.pricing && o.data.pricing.pricing_offerings) || [];
    for (const off of offerings) {
      if (String(off.type || "").toLowerCase() !== "membership") continue;
      const title = String(off.title || "").trim();
      if (!title) continue;
      const base = parseFloat(off.price);
      if (!isNaN(base)) targets.push({ key: `${title}|monthly`, offer_id: o.id, label: `${title} · Monthly`, base_cents: cents(base), allin_cents: cents(base * HST) });
      for (const c of (off.commitments || [])) {
        const term = _termFromLength(c.length);
        const cb = parseFloat(c.price);
        if (term && !isNaN(cb)) targets.push({ key: `${title}|${term}`, offer_id: o.id, label: `${title} · ${term.replace("_", " ")}`, base_cents: cents(cb), allin_cents: cents(cb * HST) });
      }
    }
  }
  return targets;
}

// Flag-derived counts (no Stripe call) — used by the 1-tap fix actions so the
// Promote button stays honest without re-running the full check.
async function flagCounts(clientId, batchId) {
  const rows = await sb(
    `members_staging?client_id=eq.${encodeURIComponent(clientId)}` +
    `&import_batch_id=eq.${encodeURIComponent(batchId)}` +
    `&select=id,is_duplicate,match_status,athlete_name,parent_email`
  ) || [];
  const clean = rows.filter(r =>
    !r.is_duplicate && r.match_status !== "no_offer" &&
    (r.athlete_name || "").toString().trim() && normEmail(r.parent_email)
  ).length;
  return { staged: rows.length, clean };
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

    // batch_id is only known in-session right after an Import — when the modal
    // is opened straight at Cleanup (from the Pricing strip or Member
    // Onboarding), fall back to the client's LATEST imported batch.
    let batchId = body.batch_id || body.import_batch_id;
    if (!batchId) {
      const last = await sb(
        `members_staging?client_id=eq.${encodeURIComponent(clientId)}` +
        `&select=import_batch_id&order=created_at.desc&limit=1`
      );
      batchId = Array.isArray(last) && last[0] ? last[0].import_batch_id : null;
    }
    if (!batchId) return res.status(400).json({ error: "no imported members found — run the Import step first" });

    const action = (req.query && req.query.action) || (body.apply === true ? "promote" : "check");

    // Staged rows for this batch (scoped to the client_id).
    const staging = await sb(
      `members_staging?client_id=eq.${encodeURIComponent(clientId)}` +
      `&import_batch_id=eq.${encodeURIComponent(batchId)}` +
      `&select=*&order=source_row.asc`
    ) || [];

    // Client row (Stripe account + persisted dismissals) — used by most actions.
    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id,sorter_dismissals&limit=1`);
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    const dismissed = new Set(Array.isArray(client.sorter_dismissals) ? client.sorter_dismissals : []);

    // dismiss: "this finding is wrong / not relevant" — persists per client so
    // it never resurfaces on future checks.
    if (action === "dismiss") {
      const key = (body.key || "").toString().slice(0, 300);
      if (!key) return res.status(400).json({ error: "key required" });
      if (!dismissed.has(key)) {
        dismissed.add(key);
        await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ sorter_dismissals: [...dismissed] }),
        });
      }
      return res.status(200).json({ ok: true, counts: await flagCounts(clientId, batchId) });
    }

    // alt-payment: member pays outside Stripe (cash / e-transfer / other).
    // Clears the no-Stripe and no-offer concerns; promote carries the flag.
    if (action === "alt-payment") {
      const s = staging.find(x => String(x.id) === String(body.staging_id));
      if (!s) return res.status(404).json({ error: "staging row not found" });
      await sb(`members_staging?id=eq.${s.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          billing_mode: "alternate",
          match_status: s.is_duplicate ? "duplicate" : "ok",
          cleanup_notes: "alternate payment method (not billed via Stripe)",
          updated_at: nowIso(),
        }),
      });
      return res.status(200).json({ ok: true, counts: await flagCounts(clientId, batchId) });
    }

    // card-link: generate a Stripe card-collection link for a member who pays
    // by card but has none on file. Find-or-creates a Stripe customer (by
    // email), stores the id on the staging row, returns a Checkout setup URL
    // to copy + send. (The sub itself is created later once a card exists.)
    if (action === "card-link") {
      const s = staging.find(x => String(x.id) === String(body.staging_id));
      if (!s) return res.status(404).json({ error: "staging row not found" });
      const acct = client.stripe_connect_account_id;
      if (!acct) return res.status(409).json({ error: "academy not connected to Stripe" });
      const email = normEmail(s.parent_email);
      let customerId = s.stripe_customer_id;
      if (!customerId && email) {
        const found = await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=1`, acct);
        customerId = found.data && found.data[0] && found.data[0].id;
      }
      if (!customerId) {
        const cust = await stripePost(`/customers`, {
          email: email || undefined,
          name: s.parent_name || s.athlete_name || undefined,
          "metadata[source]": "fullcontrol-sorter",
        }, acct);
        customerId = cust.id;
      }
      if (customerId && customerId !== s.stripe_customer_id) {
        await sb(`members_staging?id=eq.${s.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ stripe_customer_id: customerId, billing_mode: "card", updated_at: nowIso() }),
        }).catch(() => {});
      }
      const origin = (req.headers.origin || "https://portal.byanymeansbusiness.com").replace(/\/+$/, "");
      const sess = await stripePost(`/checkout/sessions`, {
        mode: "setup", customer: customerId,
        success_url: `${origin}/client-portal.html?card=saved`,
        cancel_url: `${origin}/client-portal.html?card=cancelled`,
      }, acct);
      return res.status(200).json({ ok: true, url: sess.url || null, customer_id: customerId });
    }

    // stripe-detail: read-only "everything Stripe knows about this person" —
    // for the click-the-email inspector modal in Cleanup.
    if (action === "stripe-detail") {
      const custId = (body.customer_id || "").toString();
      if (!custId) return res.status(400).json({ error: "customer_id required" });
      if (!client.stripe_connect_account_id) return res.status(409).json({ error: "academy not connected to Stripe" });
      let customer = null, subsOut = [], chargesOut = [];
      try {
        const cust = await stripeGet(`/customers/${encodeURIComponent(custId)}`, client.stripe_connect_account_id);
        customer = {
          id: cust.id, email: cust.email || null, name: cust.name || null, phone: cust.phone || null,
          created: cust.created ? new Date(cust.created * 1000).toISOString().slice(0, 10) : null,
        };
      } catch (e2) { return res.status(404).json({ error: `Stripe customer not found — ${e2.message}` }); }
      try {
        const subsR = await stripeGet(`/subscriptions?customer=${encodeURIComponent(custId)}&status=all&limit=10&expand[]=data.items.data.price.product`, client.stripe_connect_account_id);
        subsOut = (subsR.data || []).map(sub => {
          const item = sub.items && sub.items.data && sub.items.data[0];
          const price = item && item.price;
          return {
            sub_id: sub.id, status: sub.status,
            product_name: (price && price.product && price.product.name) || null,
            amount_cents: price ? price.unit_amount : null,
            interval: price && price.recurring ? `${price.recurring.interval_count > 1 ? price.recurring.interval_count + " " : ""}${price.recurring.interval}` : null,
            started: sub.created ? new Date(sub.created * 1000).toISOString().slice(0, 10) : null,
            canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString().slice(0, 10) : null,
          };
        });
      } catch (_) {}
      try {
        const ch = await stripeGet(`/charges?customer=${encodeURIComponent(custId)}&limit=15`, client.stripe_connect_account_id);
        chargesOut = (ch.data || []).map(c2 => ({
          amount_cents: c2.amount, status: c2.status, refunded: !!c2.refunded, one_time: !c2.invoice,
          date: c2.created ? new Date(c2.created * 1000).toISOString().slice(0, 10) : null,
          description: c2.description || null,
        }));
      } catch (_) {}
      return res.status(200).json({ ok: true, customer, subs: subsOut, charges: chargesOut, stripe_account_id: client.stripe_connect_account_id });
    }

    // member-detail: everything the "connect to an offer" popup needs — the
    // staged member, their Stripe sub + recent payments, the offer-price
    // targets, and a closest-by-amount recommendation.
    if (action === "member-detail") {
      const s = staging.find(x => String(x.id) === String(body.staging_id));
      if (!s) return res.status(404).json({ error: "staging row not found" });
      const targets = await buildTargetsLite(clientId);
      let stripe = null;
      let charges = [];
      if (client.stripe_connect_account_id) {
        if (s.stripe_subscription_id) {
          try {
            const sub = await stripeGet(`/subscriptions/${s.stripe_subscription_id}?expand[]=items.data.price.product`, client.stripe_connect_account_id);
            const item = sub.items && sub.items.data && sub.items.data[0];
            const price = item && item.price;
            stripe = {
              sub_id: sub.id,
              status: sub.status,
              price_id: price ? price.id : null,
              product_name: price && price.product && price.product.name || null,
              amount_cents: price ? price.unit_amount : null,
              interval: price && price.recurring ? `${price.recurring.interval_count > 1 ? price.recurring.interval_count + " " : ""}${price.recurring.interval}` : null,
              started: sub.created ? new Date(sub.created * 1000).toISOString().slice(0, 10) : null,
            };
          } catch (_) {}
        }
        const cust = s.stripe_customer_id;
        if (cust) {
          try {
            const ch = await stripeGet(`/charges?customer=${encodeURIComponent(cust)}&limit=10`, client.stripe_connect_account_id);
            charges = (ch.data || []).map(c2 => ({
              amount_cents: c2.amount, currency: c2.currency, status: c2.status,
              refunded: !!c2.refunded, one_time: !c2.invoice,
              date: c2.created ? new Date(c2.created * 1000).toISOString().slice(0, 10) : null,
              description: c2.description || null,
            }));
          } catch (_) {}
        }
      }
      // Recommend the target closest to what they actually pay.
      const amt = (stripe && stripe.amount_cents) || (charges[0] && charges[0].amount_cents) || null;
      let recommendation = null;
      if (amt && targets.length) {
        let best = null, bestD = Infinity;
        for (const t of targets) {
          const d = Math.min(Math.abs((t.base_cents || 0) - amt), Math.abs((t.allin_cents || 0) - amt));
          if (d < bestD) { bestD = d; best = t; }
        }
        if (best) recommendation = { key: best.key, label: best.label, diff_cents: bestD };
      }
      return res.status(200).json({
        ok: true,
        member: {
          id: s.id, athlete_name: s.athlete_name, parent_name: s.parent_name,
          parent_email: s.parent_email, parent_phone: s.parent_phone,
          plan: s.plan, status: s.status, joined_date: s.joined_date,
          stripe_customer_id: s.stripe_customer_id, stripe_subscription_id: s.stripe_subscription_id,
          stripe_price_id: s.stripe_price_id, billing_mode: s.billing_mode || null,
        },
        stripe, charges, targets, recommendation,
      });
    }

    // connect-offer: tie a staged member's price to an offer-price slot. With a
    // price id this also writes the pricing_catalog mapping (Match-step apply
    // semantics, legacy unless the slot has no Live price yet).
    if (action === "connect-offer") {
      const s = staging.find(x => String(x.id) === String(body.staging_id));
      if (!s) return res.status(404).json({ error: "staging row not found" });
      const key = (body.offer_price_key || "").toString();
      if (!key) return res.status(400).json({ error: "offer_price_key required" });
      const offerId = body.offer_id || null;
      const priceId = s.stripe_price_id || null;
      if (priceId) {
        const slotCanon = await sb(
          `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}` +
          `&offer_price_key=eq.${encodeURIComponent(key)}&tier=eq.canonical` +
          `&stripe_price_id=neq.${encodeURIComponent(priceId)}&select=stripe_price_id&limit=1`
        );
        const tier = (Array.isArray(slotCanon) && slotCanon[0]) ? "legacy_match" : "canonical";
        const patch = {
          offer_id: offerId, offer_price_key: key, tier,
          is_routable: tier === "canonical",
          match_status: "confirmed", match_source: "cleanup-connect",
          matched_at: nowIso(), updated_at: nowIso(),
        };
        const r = await sb(
          `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&stripe_price_id=eq.${encodeURIComponent(priceId)}`,
          { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) }
        );
        if (!Array.isArray(r) || !r.length) {
          // No catalog row yet — pull the price facts from Stripe and insert.
          try {
            const price = await stripeGet(`/prices/${encodeURIComponent(priceId)}`, client.stripe_connect_account_id);
            await sb(`pricing_catalog`, {
              method: "POST", headers: { Prefer: "return=minimal" },
              body: JSON.stringify([{
                client_id: clientId,
                stripe_price_id: priceId,
                stripe_product_id: typeof price.product === "string" ? price.product : (price.product && price.product.id),
                display_name: price.nickname || null,
                amount_cents: price.unit_amount,
                currency: price.currency || "cad",
                interval: price.recurring ? price.recurring.interval : null,
                ...patch,
              }]),
            });
          } catch (e2) {
            return res.status(502).json({ error: `couldn't read the Stripe price to catalog it — ${e2.message}` });
          }
        }
      }
      await sb(`members_staging?id=eq.${s.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          offer_price_key: key,
          match_status: s.is_duplicate ? "duplicate" : (s.stripe_linked || priceId ? "ok" : "needs_fix"),
          cleanup_notes: `connected to ${key}`,
          updated_at: nowIso(),
        }),
      });
      return res.status(200).json({ ok: true, counts: await flagCounts(clientId, batchId) });
    }

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
          billing_mode:           s.billing_mode || null,
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

    // ═══════════════════ 1-TAP FIX ACTIONS (Phase B) ═══════════════════
    // Each mutates staging flags directly + returns flag-derived counts, so
    // the UI updates without re-running the (slow) full Stripe check.

    // Resolve a price id → no_offer verdict via the catalog (shared by fixes).
    async function priceVerdict(priceId) {
      if (!priceId) return "needs_fix";
      const rows = await sb(
        `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}` +
        `&stripe_price_id=eq.${encodeURIComponent(priceId)}&select=offer_price_key&limit=1`
      );
      const key = Array.isArray(rows) && rows[0] && rows[0].offer_price_key;
      return key ? "ok" : "no_offer";
    }

    // fix-link: accept a suggested Stripe match for a staged row (typo'd email).
    if (action === "fix-link") {
      const s = staging.find(x => String(x.id) === String(body.staging_id));
      if (!s) return res.status(404).json({ error: "staging row not found" });
      const status = s.is_duplicate ? "duplicate" : await priceVerdict(body.price_id || s.stripe_price_id);
      await sb(`members_staging?id=eq.${s.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          stripe_customer_id: body.customer_id || s.stripe_customer_id || null,
          stripe_subscription_id: body.sub_id || s.stripe_subscription_id || null,
          stripe_price_id: body.price_id || s.stripe_price_id || null,
          stripe_linked: true,
          match_status: status,
          cleanup_notes: `linked to Stripe ${body.matched_email || ""} (email typo fix)`.trim(),
          updated_at: nowIso(),
        }),
      });
      return res.status(200).json({ ok: true, match_status: status, counts: await flagCounts(clientId, batchId) });
    }

    // add-from-stripe: create a staged member from a live sub the sheet missed.
    if (action === "add-from-stripe") {
      const email = normEmail(body.email);
      if (!email) return res.status(400).json({ error: "email required" });
      const status = await priceVerdict(body.price_id);
      // plan from the catalog row when it knows one
      let plan = null;
      if (body.price_id) {
        const rows = await sb(`pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&stripe_price_id=eq.${encodeURIComponent(body.price_id)}&select=canonical_plan&limit=1`);
        plan = (Array.isArray(rows) && rows[0] && rows[0].canonical_plan) || null;
      }
      const inserted = await sb(`members_staging?select=id`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          client_id: clientId,
          import_batch_id: batchId,
          athlete_name: body.name || email.split("@")[0],
          parent_name: body.name || null,
          parent_email: email,
          plan,
          status: "live",
          stripe_customer_id: body.customer_id || null,
          stripe_subscription_id: body.sub_id || null,
          stripe_price_id: body.price_id || null,
          stripe_linked: true,
          is_duplicate: false,
          match_status: status,
          cleanup_notes: "added from Stripe sub (was missing from the sheet) — check the athlete name",
          created_at: nowIso(), updated_at: nowIso(),
        }]),
      });
      const id = Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
      return res.status(200).json({ ok: true, staging_id: id, match_status: status, counts: await flagCounts(clientId, batchId) });
    }

    // remove-staged: delete a duplicate row; un-flag the survivor(s).
    if (action === "remove-staged") {
      const s = staging.find(x => String(x.id) === String(body.staging_id));
      if (!s) return res.status(404).json({ error: "staging row not found" });
      await sb(`members_staging?id=eq.${s.id}&client_id=eq.${encodeURIComponent(clientId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      // If the dup group is down to one row, clear its duplicate flag and
      // recompute its verdict from the notes it already carries.
      const email = normEmail(s.parent_email);
      const athlete = normName(s.athlete_name);
      const rest = staging.filter(x => String(x.id) !== String(s.id) &&
        normEmail(x.parent_email) === email && normName(x.athlete_name) === athlete);
      if (rest.length === 1) {
        const r = rest[0];
        const notes = (r.cleanup_notes || "");
        const status = notes.includes("no offer") ? "no_offer" : (r.stripe_linked ? "ok" : "needs_fix");
        await sb(`members_staging?id=eq.${r.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ is_duplicate: false, match_status: status, updated_at: nowIso() }),
        });
      }
      return res.status(200).json({ ok: true, counts: await flagCounts(clientId, batchId) });
    }

    // ════════════════════════════ CHECK ════════════════════════════
    // Live Stripe linkage (skip gracefully if not connected). Three lookups:
    // by email, by customer id, by sub id — the sheet's OWN Stripe ids beat
    // email matching (emails drift between the sheet and Stripe; ids don't).
    let emailMap = new Map();
    const byCustomerId = new Map();
    const bySubId = new Map();
    if (client.stripe_connect_account_id) {
      try {
        const subs = await fetchLiveSubs(client.stripe_connect_account_id);
        emailMap = buildEmailMap(subs);
        for (const sub of subs) {
          const cust = sub.customer && typeof sub.customer === "object" ? sub.customer : null;
          const item = sub.items && sub.items.data && sub.items.data[0];
          const price = item && item.price;
          const entry = {
            customer_id: typeof sub.customer === "string" ? sub.customer : (cust && cust.id) || null,
            sub_id: sub.id,
            price_id: (price && price.id) || null,
            status: sub.status,
            amount_cents: price ? price.unit_amount : null,
            name: (cust && cust.name) || null,
            email: normEmail(cust && cust.email) || null,
          };
          bySubId.set(sub.id, entry);
          if (entry.customer_id) {
            const prev = byCustomerId.get(entry.customer_id);
            if (!prev || (!ACTIVEISH.has(prev.status) && ACTIVEISH.has(sub.status))) byCustomerId.set(entry.customer_id, entry);
          }
        }
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
    // Sheet ids FIRST (a sheet that carries stripe_customer_id/sub_id is the
    // strongest signal — emails drift, e.g. Alain pays under a different
    // address), then email. Only ACTIVE-ish subs mean "paying but not on your
    // sheet"; canceled subs are churned families → a collapsed FYI list.
    const stagedEmails = new Set();
    const claimedEmails = new Set();
    for (const s of staging) {
      const email = normEmail(s.parent_email);
      if (email) stagedEmails.add(email);
      const link = (s.stripe_subscription_id && bySubId.get(s.stripe_subscription_id))
        || (s.stripe_customer_id && byCustomerId.get(s.stripe_customer_id))
        || (email ? emailMap.get(email) : null) || null;
      s.__link = link;
      if (link && link.email) claimedEmails.add(link.email);
    }
    const unstagedEmails = [...emailMap.keys()].filter(e => !stagedEmails.has(e) && !claimedEmails.has(e));
    const stagedNoStripe = [];
    for (const s of staging) {
      if (s.__link) continue;
      const email = normEmail(s.parent_email);
      // EXPECTED no-Stripe cases — label, don't alarm: sheet says billing isn't
      // set up yet, or the member is marked as paying outside Stripe.
      const rawStatus = (s.status || "").toString().trim().toLowerCase();
      const altPay = s.billing_mode === "alternate";
      const expected = altPay || rawStatus.includes("payment_method_required") || rawStatus.includes("pending");
      // Typo radar: a near-miss email among the unstaged Stripe subs (≤2 edits).
      // Deniable — a dismissed suggestion never comes back.
      let suggestion = null;
      if (email && !expected && !dismissed.has(`suggestion:${s.id}`)) {
        let best = null, bestD = 3;
        for (const cand of unstagedEmails) {
          const d = editDistance(email, cand, 2);
          if (d < bestD) { bestD = d; best = cand; }
        }
        if (best) {
          const l = emailMap.get(best);
          suggestion = { email: best, customer_id: l.customer_id, sub_id: l.sub_id, price_id: l.price_id, status: l.status, name: l.name };
        }
      }
      stagedNoStripe.push({ id: s.id, source_row: s.source_row, athlete_name: s.athlete_name, parent_email: s.parent_email, expected, alt_payment: altPay, suggestion });
    }
    // Customer ids a staged member already owns (sheet id or resolved link) —
    // so a sub on that customer isn't reported as "not in your portal".
    const claimedCustomerIds = new Set();
    for (const s of staging) {
      if (s.stripe_customer_id) claimedCustomerIds.add(s.stripe_customer_id);
      if (s.__link && s.__link.customer_id) claimedCustomerIds.add(s.__link.customer_id);
    }
    // In Stripe (subscription) but NOT on the sheet — reconcile per CUSTOMER
    // (catches subs whose customer has no email, which an email-only pass
    // would miss). Active-ish → "paying not in portal"; else churned.
    const stripeNoMember = [];
    const churned = [];
    for (const [custId, link] of byCustomerId.entries()) {
      if (claimedCustomerIds.has(custId)) continue;
      if (link.email && (stagedEmails.has(link.email) || claimedEmails.has(link.email))) continue;
      if (link.email && dismissed.has(`stripe:${link.email}`)) continue;
      if (dismissed.has(`stripe:cust:${custId}`) || dismissed.has(`stripe:${custId}`)) continue;
      const item = { email: link.email || null, name: link.name, customer_id: custId, sub_id: link.sub_id, price_id: link.price_id, status: link.status, amount_cents: link.amount_cents };
      if (ACTIVEISH.has(link.status)) stripeNoMember.push(item);
      else churned.push(item);
    }

    // ── (a2) possible PREPAID members — a one-time (non-subscription) charge
    // from someone who isn't on the sheet (e.g. paid 3/6/12 months up front).
    // Thoroughness: scan a FULL YEAR of charges, floor $100 (skips drop-in /
    // single-session noise), resolve the payer email from billing OR the
    // customer, dedup per customer, skip anyone already on the sheet or with
    // an active sub. NOT a prepay: invoiced charges (those ARE subscriptions)
    // or "Subscription …" descriptions (CoachIQ/GHL invoice-less sub charges).
    const stagedCustomerIds = claimedCustomerIds; // reuse the same claimed set
    const stagedNames = staging.map(s => ({
      id: s.id, athlete_name: s.athlete_name,
      norms: [normName(s.parent_name), normName(s.athlete_name)].filter(Boolean),
    }));
    const prepaid = [];
    if (client.stripe_connect_account_id) {
      try {
        const NOW = Math.floor(Date.now() / 1000);
        const since = NOW - 365 * 86400;        // a full year back
        const byCust = new Map();               // dedup per customer (or per email if no customer)
        let startingAfter = null;
        for (let page = 0; page < 12; page++) { // up to 1200 charges
          const qs = new URLSearchParams({ limit: "100" });
          qs.set("created[gte]", String(since));
          qs.append("expand[]", "data.customer");
          if (startingAfter) qs.set("starting_after", startingAfter);
          const r = await stripeGet(`/charges?${qs.toString()}`, client.stripe_connect_account_id);
          const data = r.data || [];
          for (const ch of data) {
            if (ch.status !== "succeeded" || ch.refunded || ch.invoice) continue; // one-time only
            if (ch.amount < 10000) continue; // < $100 → drop-in / single session, not a prepay
            if (/^subscription\b/i.test(ch.description || "")) continue; // a sub payment, not a prepay
            const cust = ch.customer && typeof ch.customer === "object" ? ch.customer : null;
            const custId = cust ? cust.id : (typeof ch.customer === "string" ? ch.customer : null);
            if (custId && stagedCustomerIds.has(custId)) continue; // already a sheet member's customer
            if (custId && claimedCustomerIds.has(custId)) continue;
            const email = normEmail((ch.billing_details && ch.billing_details.email) || ch.receipt_email || (cust && cust.email));
            if (email && (stagedEmails.has(email) || claimedEmails.has(email))) continue;
            if (email && dismissed.has(`prepaid:${email}`)) continue;
            if (custId && (dismissed.has(`prepaid:cust:${custId}`) || dismissed.has(`prepaid:${custId}`))) continue;
            if (!email && !custId) continue; // nothing to identify them by
            // Same person under a different email? Fuzzy-match the payer name.
            const payerName = normName((ch.billing_details && ch.billing_details.name) || (cust && cust.name) || "");
            let maybeStaged = null;
            if (payerName) {
              for (const sn of stagedNames) {
                if (sn.norms.some(n => n === payerName || editDistance(n, payerName, 2) <= 2)) { maybeStaged = { id: sn.id, athlete_name: sn.athlete_name }; break; }
              }
            }
            const dedupKey = custId || email;
            const prev = byCust.get(dedupKey);
            if (!prev || ch.amount > prev.amount_cents) byCust.set(dedupKey, {
              email: email || null,
              name: (ch.billing_details && ch.billing_details.name) || (cust && cust.name) || null,
              customer_id: custId,
              amount_cents: ch.amount,
              date: ch.created ? new Date(ch.created * 1000).toISOString().slice(0, 10) : null,
              description: ch.description || null,
              maybe_staged: maybeStaged,
            });
          }
          if (!r.has_more || data.length === 0) break;
          startingAfter = data[data.length - 1].id;
        }
        prepaid.push(...byCust.values());
      } catch (_) { /* non-fatal */ }
    }

    // ── (b) duplicates within the batch — SIBLING-AWARE: only the same
    // parent_email AND the same athlete name is a duplicate. Same email with
    // different kids = a family, not a problem. ──
    const byKidKey = new Map();
    for (const s of staging) {
      const email = normEmail(s.parent_email);
      const athlete = normName(s.athlete_name);
      if (!email || !athlete) continue;
      const k = email + "|" + athlete;
      if (!byKidKey.has(k)) byKidKey.set(k, []);
      byKidKey.get(k).push(s);
    }
    const dupIds = new Set();
    const duplicates = [];
    for (const [k, rows] of byKidKey.entries()) {
      if (rows.length > 1) {
        if (dismissed.has(`dup:${k}`)) continue; // owner said "not duplicates"
        duplicates.push({ kind: "same athlete + email", key: k, value: k.split("|")[1], email: k.split("|")[0], ids: rows.map(r => r.id), names: rows.map(r => r.athlete_name) });
        rows.forEach(r => dupIds.add(r.id));
      }
    }

    // ── (c) staged rows whose plan/price maps to NO offer ──
    const noOfferIds = new Set();
    const noOffer = [];
    for (const s of staging) {
      if (s.billing_mode === "alternate") continue; // not billed via Stripe — no offer needed
      const link = s.__link;
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
      const link = s.__link;
      const linked = !!link;
      const isDup = dupIds.has(s.id);
      const noOff = noOfferIds.has(s.id);
      const altPay = s.billing_mode === "alternate";
      let match_status = "ok";
      if (isDup) match_status = "duplicate";
      else if (noOff) match_status = "no_offer";
      else if (!linked && !altPay) match_status = "needs_fix";
      const notes = [];
      if (altPay) notes.push("alternate payment method (not billed via Stripe)");
      else if (!linked) notes.push("no Stripe match");
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

    // ── Full roster: every staged member + price + EVERYTHING needed to act
    // on them inline (suggestion, dup-copy, no-offer, no-payment). One list. ──
    const suggById = {}; for (const x of stagedNoStripe) if (x.suggestion) suggById[x.id] = x.suggestion;
    const dupCopyIds = new Set(); const dupKeyById = {};
    for (const g of duplicates) { g.ids.forEach(id => dupKeyById[id] = g.key); g.ids.slice(1).forEach(id => dupCopyIds.add(id)); }
    const members = staging.map(s => {
      const link = s.__link;
      const altPay = s.billing_mode === "alternate";
      const priceId = s.stripe_price_id || (link && link.price_id) || null;
      const cat = priceId ? catalogByPrice[priceId] : null;
      const key = s.offer_price_key || (cat && cat.offer_price_key) || null;
      const amount = cat && cat.amount_cents != null ? cat.amount_cents : (link && link.amount_cents) || null;
      const issues = [];
      if (dupIds.has(s.id)) issues.push("duplicate");
      if (noOfferIds.has(s.id)) issues.push("no offer");
      if (!link && !altPay) issues.push("no payment set up");
      if (!(s.athlete_name || "").toString().trim()) issues.push("missing name");
      return {
        id: s.id,
        athlete_name: s.athlete_name || "",
        parent_email: s.parent_email || "",
        price_label: key || (cat && cat.display_name) || null,
        amount_cents: amount,
        interval: cat && cat.interval || null,
        alt_payment: altPay,
        on_stripe: !!link,
        needs_work: issues.length > 0,
        issues,
        // inline-action data
        no_offer: noOfferIds.has(s.id),
        no_payment: !link && !altPay,
        is_dup_copy: dupCopyIds.has(s.id),
        dup_key: dupKeyById[s.id] || null,
        suggestion: suggById[s.id] || null,
      };
    }).sort((a, b) =>
      (b.needs_work - a.needs_work) ||
      (a.athlete_name || "").localeCompare(b.athlete_name || "")
    );

    return res.status(200).json({
      ok: true,
      academy: client.business_name,
      batch_id: batchId,
      counts: {
        staged: staging.length,
        staged_no_stripe: stagedNoStripe.length,
        stripe_no_member: stripeNoMember.length,
        churned: churned.length,
        prepaid: prepaid.length,
        duplicates: duplicates.length,
        no_offer: noOffer.length,
        tier_issues: tierIssues.length,
        clean: cleanCount,
        needs_work: members.filter(m => m.needs_work).length,
      },
      checks: {
        links: { staged_no_stripe: stagedNoStripe, stripe_no_member: stripeNoMember, churned },
        prepaid,
        duplicates,
        no_offer: noOffer,
        tier_issues: tierIssues,
      },
      members,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
