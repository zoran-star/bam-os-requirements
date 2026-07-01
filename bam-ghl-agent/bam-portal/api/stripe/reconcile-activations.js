import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — safety-net reconciliation for stuck signups.
//
// WHY THIS EXISTS
// A portal funnel signup is created as an `incomplete` Stripe sub + a members row
// at status 'payment_method_required'. It only flips to 'live' (welcome sequence,
// GHL contact, pipeline WON, staff SMS) when the Stripe `invoice.paid` webhook is
// received and processed by api/stripe/webhook.js. If that webhook is ever missed
// (Connect events not delivered, a transient error, a Stripe key-scope regression),
// the parent PAYS but stays stuck forever — silent, with no welcome and no staff
// alert. This happened to real paying families (e.g. 2026-06-25 + 2026-07-01).
//
// WHAT IT DOES (every 10 min via vercel.json cron)
//   1. Find members still 'payment_method_required' with a Stripe sub, created
//      within the lookback window.
//   2. For each, fetch the subscription from the academy's CONNECTED account.
//   3. If the sub is actually active/trialing, its first invoice is PAID, and it
//      is a portal-owned onboarding sub → run the EXACT same activation the webhook
//      would have (shared activatePortalOnboardingMember).
//   Abandoned carts (incomplete / incomplete_expired subs) are naturally skipped:
//   they never reach an active+paid state.
//
// Idempotent: only ever acts while status === 'payment_method_required'; activation
// flips it to 'live', so a re-run is a no-op. Auth: Bearer CRON_SECRET (same as the
// other crons). Manual single-member rescue: GET ?member_id=<uuid> (still gated by
// the same active+paid+portal-owned checks).

import { activatePortalOnboardingMember, isPortalOwnedOrigin } from "./webhook.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

// How far back to look for stuck signups. Comfortably covers any realistic
// webhook-delivery gap without scanning ancient abandoned rows.
const LOOKBACK_DAYS = 60;

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

async function stripeFetch(path, stripeAccount) {
  const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = { Authorization: `Bearer ${stripeSecret}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`);
  return res.json();
}

// A subscription counts as genuinely paid + activatable when it is active/trialing
// and its first invoice has actually been paid.
const ACTIVATABLE_SUB_STATES = new Set(["active", "trialing"]);

async function reconcileOne(member, accountCache) {
  const subId = member.stripe_subscription_id;
  if (!subId) return { member_id: member.id, skipped: "no stripe_subscription_id" };

  // Resolve the academy's connected Stripe account (cached per client).
  let account = accountCache.get(member.client_id);
  if (account === undefined) {
    const rows = await sb(`clients?id=eq.${member.client_id}&select=stripe_connect_account_id&limit=1`).catch(() => null);
    account = (Array.isArray(rows) && rows[0] && rows[0].stripe_connect_account_id) || null;
    accountCache.set(member.client_id, account);
  }
  if (!account) return { member_id: member.id, skipped: "academy has no stripe_connect_account_id" };

  let sub;
  try {
    sub = await stripeFetch(`/subscriptions/${encodeURIComponent(subId)}?expand[]=latest_invoice`, account);
  } catch (e) {
    return { member_id: member.id, error: `sub fetch: ${String((e && e.message) || e)}` };
  }

  if (!ACTIVATABLE_SUB_STATES.has(sub.status)) {
    return { member_id: member.id, skipped: `sub not active (${sub.status})` };
  }
  const inv = sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  const invoicePaid = inv ? (inv.status === "paid" || inv.paid === true || (inv.amount_paid || 0) > 0) : false;
  if (!invoicePaid) return { member_id: member.id, skipped: "latest invoice not paid" };
  if (!sub.metadata || !isPortalOwnedOrigin(sub.metadata.origin)) {
    return { member_id: member.id, skipped: `not a portal-owned sub (origin=${sub.metadata && sub.metadata.origin})` };
  }

  // Run the identical activation the invoice.paid webhook would have.
  try {
    const out = await activatePortalOnboardingMember({ member, onbSub: sub, inv, connectedAccount: account });
    return { member_id: member.id, rescued: true, action: out.action, athlete: member.athlete_name || null };
  } catch (e) {
    return { member_id: member.id, error: `activate: ${String((e && e.message) || e)}` };
  }
}

async function handler(req, res) {
  // Auth — Bearer CRON_SECRET (Vercel cron adds this header automatically when the
  // env var is set). Mirrors api/members.js cron guards.
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
  if (got !== expected) return res.status(401).json({ error: "unauthorized" });

  const singleId = req.query && req.query.member_id ? String(req.query.member_id) : null;

  let members;
  try {
    if (singleId) {
      members = await sb(`members?id=eq.${encodeURIComponent(singleId)}&status=eq.payment_method_required&stripe_subscription_id=not.is.null&select=*`);
    } else {
      const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
      members = await sb(`members?status=eq.payment_method_required&stripe_subscription_id=not.is.null&created_at=gte.${sinceIso}&select=*&order=created_at.asc`);
    }
  } catch (e) {
    return res.status(500).json({ error: `member query: ${String((e && e.message) || e)}` });
  }

  members = Array.isArray(members) ? members : [];
  const accountCache = new Map();
  const results = [];
  // Sequential on purpose: activation sends SMS/email + hits GHL/Stripe; keep it
  // gentle and easy to reason about. These batches are tiny (stuck signups are rare).
  for (const m of members) {
    results.push(await reconcileOne(m, accountCache));
  }

  const rescued = results.filter(r => r.rescued);
  const errors = results.filter(r => r.error);
  console.log(`[reconcile-activations] scanned=${members.length} rescued=${rescued.length} errors=${errors.length}${singleId ? ` (single ${singleId})` : ""}`);

  return res.status(200).json({
    ok: true,
    scanned: members.length,
    rescued: rescued.length,
    errors: errors.length,
    results,
  });
}

export default withSentryApiRoute(handler);
