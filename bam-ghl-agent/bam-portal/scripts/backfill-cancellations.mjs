#!/usr/bin/env node
// Backfill cancellation snapshots from Stripe.
//
// Fills joined_date / plan_name / stripe_price_id / offer_id /
// monthly_amount_cents / total_spent_cents / payments_count / involuntary on
// historical `cancellations` rows (type=cancel) that predate the snapshot
// capture added 2026-07-16. Safe to re-run: only touches rows with missing
// snapshot fields, and only writes fields it could resolve.
//
// Env (required): SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
//                 + STRIPE_CONNECT_SECRET_KEY (or STRIPE_SECRET_KEY)
// Usage:  node scripts/backfill-cancellations.mjs [--dry]

const DRY = process.argv.includes("--dry");

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const STRIPE_KEY = (process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "").trim();
if (!SB_URL || !SB_KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
if (!STRIPE_KEY) { console.error("Missing STRIPE_CONNECT_SECRET_KEY / STRIPE_SECRET_KEY."); process.exit(1); }

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function stripe(path, account) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, ...(account ? { "Stripe-Account": account } : {}) },
  });
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Exact monthly cents from a raw Stripe price (has real interval_count).
function monthlyCentsFromStripePrice(price) {
  const rec = price && price.recurring;
  const amt = Number(price && price.unit_amount);
  if (!rec || !Number.isFinite(amt)) return null;
  const count = Number(rec.interval_count) || 1;
  const per = rec.interval === "week" ? 4.33 : rec.interval === "day" ? 30.44 : rec.interval === "year" ? 1 / 12 : 1;
  return Math.round((amt / count) * per);
}

async function lifetimeSpend(customerId, account) {
  let total = 0, count = 0, after = null, earliest = null;
  for (let page = 0; page < 5; page++) {
    const qs = `customer=${encodeURIComponent(customerId)}&status=paid&limit=100` + (after ? `&starting_after=${after}` : "");
    const res = await stripe(`/invoices?${qs}`, account);
    for (const inv of res.data || []) {
      const paid = Number(inv.amount_paid);
      if (Number.isFinite(paid) && paid > 0) {
        total += paid; count++;
        if (inv.created && (!earliest || inv.created < earliest)) earliest = inv.created;
      }
    }
    if (!res.has_more || !res.data?.length) break;
    after = res.data[res.data.length - 1].id;
  }
  return { total, count, earliest };
}

const clients = await sb(`clients?select=id,business_name,stripe_connect_account_id`);
const acctByClient = new Map(clients.map(c => [c.id, c.stripe_connect_account_id]));

const rows = await sb(
  `cancellations?type=eq.cancel&or=(joined_date.is.null,monthly_amount_cents.is.null,total_spent_cents.is.null)` +
  `&select=id,client_id,athlete_name,stripe_subscription_id,stripe_customer_id,joined_date,monthly_amount_cents,total_spent_cents&order=created_at.asc`
);
console.log(`${rows.length} cancellation row(s) need backfill${DRY ? " (DRY RUN)" : ""}\n`);

let ok = 0, partial = 0, failed = 0;
for (const row of rows) {
  const acct = acctByClient.get(row.client_id);
  const name = (row.athlete_name || row.id).padEnd(24);
  if (!acct) { console.log(`SKIP  ${name} no connected Stripe account`); failed++; continue; }

  const patch = {};
  let priceId = null;

  // Subscription -> start date + price
  try {
    if (row.stripe_subscription_id) {
      const sub = await stripe(`/subscriptions/${row.stripe_subscription_id}`, acct);
      if (sub.start_date) patch.joined_date = new Date(sub.start_date * 1000).toISOString().slice(0, 10);
      const price = sub.items?.data?.[0]?.price;
      if (price) {
        priceId = price.id;
        patch.stripe_price_id = price.id;
        patch.monthly_amount_cents = monthlyCentsFromStripePrice(price);
        if (price.nickname) patch.plan_name = price.nickname;
      }
      if (sub.cancellation_details?.reason === "payment_failed") patch.involuntary = true;
    }
  } catch (e) { console.log(`      ${name} sub lookup failed: ${e.message.slice(0, 80)}`); }

  // Catalog -> nicer plan name + offer scope
  try {
    if (priceId) {
      const cat = await sb(`pricing_catalog?client_id=eq.${row.client_id}&stripe_price_id=eq.${encodeURIComponent(priceId)}&select=display_name,offer_id&limit=1`);
      if (cat?.[0]) {
        if (cat[0].display_name) patch.plan_name = cat[0].display_name;
        if (cat[0].offer_id) patch.offer_id = cat[0].offer_id;
      }
    }
  } catch (e) { console.log(`      ${name} catalog lookup failed: ${e.message.slice(0, 80)}`); }

  // Invoices -> lifetime spend + truer join date. Subs recreated during the
  // June 2026 Stripe migration carry a fresh start_date; the customer's
  // earliest PAID invoice predates it and reflects when they actually joined.
  try {
    if (row.stripe_customer_id) {
      const spend = await lifetimeSpend(row.stripe_customer_id, acct);
      patch.total_spent_cents = spend.total;
      patch.payments_count = spend.count;
      if (spend.earliest) {
        const invDate = new Date(spend.earliest * 1000).toISOString().slice(0, 10);
        if (!patch.joined_date || invDate < patch.joined_date) patch.joined_date = invDate;
      }
    }
  } catch (e) { console.log(`      ${name} spend lookup failed: ${e.message.slice(0, 80)}`); }

  if (!Object.keys(patch).length) { console.log(`FAIL  ${name} nothing resolvable`); failed++; continue; }

  const full = patch.joined_date && patch.monthly_amount_cents != null && patch.total_spent_cents != null;
  console.log(`${full ? "OK  " : "PART"}  ${name} joined=${patch.joined_date || "-"} mo=$${patch.monthly_amount_cents != null ? (patch.monthly_amount_cents / 100).toFixed(0) : "-"} spent=$${patch.total_spent_cents != null ? (patch.total_spent_cents / 100).toFixed(0) : "-"} (${patch.payments_count ?? "-"} payments)${patch.involuntary ? " INVOLUNTARY" : ""}`);
  full ? ok++ : partial++;

  if (!DRY) {
    await sb(`cancellations?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
  }
}
console.log(`\nDone: ${ok} full, ${partial} partial, ${failed} failed${DRY ? " (nothing written - dry run)" : ""}`);
