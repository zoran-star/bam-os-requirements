import { withSentryApiRoute } from "../_sentry.js";
import { runMakeSellable } from "./make-sellable.js";
export const maxDuration = 60;

// Cron backstop for the make-sellable bridge (make-sellable.js, PR #1270).
// _msFire() only runs when someone renders the Blueprint pricing strip - if
// nobody visits the page, a price-matched offer never becomes sellable (DETAIL
// Miami sat at 0 typed prices for a day waiting on that page visit). This cron
// removes the human from the loop: every 10 minutes, every V2 client whose
// offers have confirmed canonical pricing gets the bridge run. Idempotent -
// runMakeSellable skips any offer whose typed offer_prices already exist, so
// steady state is a couple of cheap reads per client and no writes.
// V2-only by construction (v2_access filter): V1/V1.5 academies are untouched.
//
//   GET /api/offers/cron-make-sellable               (Vercel cron, x-vercel-cron)
//   GET /api/offers/cron-make-sellable?client_id=…   (manual, Bearer CRON_SECRET)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Data heal: typed billing_interval must speak the checkout term vocabulary
// (4_weeks / 3_months / 6_months / one_time). Early Stripe-Matcher applies
// stored Stripe's raw recurring unit in pricing_catalog ("week" for a
// billed-every-4-weeks price) and offers-sync copied it into offer_prices -
// which silently disables checkout's commitment-revert logic and drops the
// term noun off the signed agreement PDF. The source_offer_price_key's term
// is the academy-confirmed truth, so converge on it. Surgical on purpose:
// touches ONLY billing_interval (never entitlements/options/rules), no-ops
// once everything speaks the vocabulary. offers-sync derives the same value
// now (billingIntervalOf), so the heal is stable, not tug-of-war.
const TERM_TO_INTERVAL = { monthly: "4_weeks", "4_weeks": "4_weeks", "3_months": "3_months", "6_months": "6_months", one_time: "one_time" };

async function healBillingIntervals(clientId) {
  const rows = await sb(
    `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&source_offer_price_key=not.is.null&select=id,billing_interval,source_offer_price_key`
  );
  const healed = [];
  for (const r of rows || []) {
    const term = String(r.source_offer_price_key).split("|")[1];
    const want = term ? TERM_TO_INTERVAL[term.trim().toLowerCase()] : null;
    if (!want || r.billing_interval === want) continue;
    await sb(`offer_prices?id=eq.${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ billing_interval: want, updated_at: new Date().toISOString() }),
    });
    healed.push({ id: r.id, key: r.source_offer_price_key, from: r.billing_interval, to: want });
  }
  return healed;
}

async function handler(req, res) {
  const isCron = !!req.headers["x-vercel-cron"];
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!isCron && !(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const one = String(req.query.client_id || "").trim();
    const filter = one ? `id=eq.${encodeURIComponent(one)}&` : "";
    const clients = await sb(`clients?${filter}v2_access=is.true&select=id,business_name`);
    const results = [];
    for (const c of clients || []) {
      try {
        const { synced, note } = await runMakeSellable(c.id);
        const healed = await healBillingIntervals(c.id);
        results.push({ client_id: c.id, business: c.business_name, synced, ...(healed.length ? { healed } : {}), ...(note ? { note } : {}) });
      } catch (e) {
        results.push({ client_id: c.id, business: c.business_name, error: e.message });
      }
    }
    return res.status(200).json({ ok: true, clients: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
