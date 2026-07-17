#!/usr/bin/env node
// Fix members.joined_date using the customer's EARLIEST PAID Stripe invoice.
//
// Subs recreated during the June-2026 Stripe migration carry a fresh
// start_date, so most live GTA members show joined=2026-06-20. That
// understates active tenure and inflates the "new members" KPI. The earliest
// paid invoice on the customer is when they actually started paying.
//
// Only moves dates BACKWARD (earliest invoice < current joined_date); never
// forward, so manually-set later dates and true new joiners are untouched.
//
// Env (required): SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
//                 + STRIPE_CONNECT_SECRET_KEY (or STRIPE_SECRET_KEY)
// Usage:  node scripts/fix-member-join-dates.mjs [--dry]

const DRY = process.argv.includes("--dry");

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const STRIPE_KEY = (process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "").trim();
if (!SB_URL || !SB_KEY || !STRIPE_KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STRIPE key."); process.exit(1); }

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
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, "Stripe-Account": account },
  });
  if (!res.ok) throw new Error(`Stripe ${res.status}`);
  return res.json();
}

const clients = await sb(`clients?select=id,business_name,stripe_connect_account_id&stripe_connect_account_id=not.is.null`);
let moved = 0, kept = 0, noInvoices = 0, ambiguous = 0;
for (const c of clients) {
  const members = await sb(`members?client_id=eq.${c.id}&select=id,athlete_name,joined_date,stripe_customer_id,stripe_subscription_id&stripe_customer_id=not.is.null`);
  if (!members.length) continue;
  console.log(`\n${c.business_name}: ${members.length} member(s) with a Stripe customer${DRY ? " (DRY RUN)" : ""}`);
  // Siblings share the parent's Stripe customer. For those, the customer's
  // earliest invoice belongs to whichever kid joined FIRST - so shared
  // customers only accept a date proven by an invoice on the member's OWN
  // subscription; otherwise they're left alone and reported.
  const perCustomer = new Map();
  for (const m of members) perCustomer.set(m.stripe_customer_id, (perCustomer.get(m.stripe_customer_id) || 0) + 1);
  for (const m of members) {
    const shared = perCustomer.get(m.stripe_customer_id) > 1;
    let earliest = null, after = null;
    try {
      for (let page = 0; page < 5; page++) {
        const qs = `customer=${encodeURIComponent(m.stripe_customer_id)}&status=paid&limit=100` + (after ? `&starting_after=${after}` : "");
        const res = await stripe(`/invoices?${qs}`, c.stripe_connect_account_id);
        for (const inv of res.data || []) {
          if (!(Number(inv.amount_paid) > 0) || !inv.created) continue;
          if (shared) {
            const invSub = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
            if (!invSub || invSub !== m.stripe_subscription_id) continue;
          }
          if (!earliest || inv.created < earliest) earliest = inv.created;
        }
        if (!res.has_more || !res.data?.length) break;
        after = res.data[res.data.length - 1].id;
      }
    } catch (e) { console.log(`  SKIP ${m.athlete_name}: ${e.message}`); continue; }
    if (!earliest) {
      if (shared) { console.log(`  AMBIGUOUS ${String(m.athlete_name || m.id).padEnd(20)} shared customer, no invoice on own sub - left as-is`); ambiguous++; }
      else noInvoices++;
      continue;
    }
    const invDate = new Date(earliest * 1000).toISOString().slice(0, 10);
    if (m.joined_date && invDate >= m.joined_date) { kept++; continue; }
    console.log(`  ${String(m.athlete_name || m.id).padEnd(24)} ${m.joined_date || "(none)"} -> ${invDate}${shared ? "  (own-sub invoice)" : ""}`);
    moved++;
    if (!DRY) {
      await sb(`members?id=eq.${m.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ joined_date: invDate }),
      });
    }
  }
}
console.log(`\nDone: ${moved} moved earlier, ${kept} already correct, ${ambiguous} ambiguous (shared customer), ${noInvoices} no paid invoices${DRY ? " (nothing written)" : ""}`);
