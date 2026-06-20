import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 60; // Stripe reads/writes + one Anthropic call

// Vercel Serverless Function — "Fix the next payment" for a staged member.
//
// A member's plan should bill on a schedule, but for some reason the next
// charge won't happen (the sub is set to cancel, is paused, the last payment
// failed, never started, or there's no subscription at all behind a prepaid).
// This endpoint diagnoses WHY (deterministically), proposes the correct fix,
// and has Claude sanity-check the logic + explain it in plain English before
// staff confirm. Writes are explicit (mode=apply, one action at a time).
//
// POST mode=preview  { client_id, staging_id }
//   → { problem, plan, ai }   (no writes; reads sub + charges + catalog)
//
// POST mode=apply    { client_id, staging_id, action }
//   action: "uncancel" → clear cancel_at / cancel_at_period_end
//           "resume"   → clear pause_collection (resume billing)
//           "cancel_old" → cancel the existing sub (blocked-fallback step 2).
//             If Stripe refuses, returns { ok:false, manual:true, stripe_url }
//             so staff can cancel it by hand.
//   (setup_monthly / replace CREATE a sub → handled by /api/sorter/setup-monthly,
//    which already previews + confirms the live card before writing.)
//
// Auth: resolveUser() — staff (any academy) or a client_users member of client_id.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";
const ACTIVEISH = new Set(["active", "trialing", "past_due", "paused", "unpaid"]);

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

function stripeKey() { return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY; }
async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const encoded = body
    ? new URLSearchParams(Object.entries(body).reduce((a, [k, v]) => {
        if (v !== undefined && v !== null) a[k] = String(v);
        return a;
      }, {})).toString()
    : undefined;
  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe ${res.status}`);
    err.stripeStatus = res.status;
    throw err;
  }
  return json;
}

const iso = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);

// Deterministic classifier: given the live sub (or null) + the member's plan,
// return the problem + the recommended fix plan. This is the SOURCE OF TRUTH —
// the AI only explains/sanity-checks it, never decides.
function classify({ sub, offerKey, recurringExpected, lastPrepaidDate }) {
  if (!sub) {
    if (recurringExpected) {
      return {
        problem: { state: "missing", reason: "No subscription behind this member — the plan should bill on a schedule but nothing is set to charge." },
        plan: {
          kind: "setup_monthly", endpoint: "/api/sorter/setup-monthly", action: null,
          title: "Set up monthly billing",
          detail: lastPrepaidDate
            ? `Create a portal-owned monthly subscription anchored to start when the prepaid term ends (counted from ${lastPrepaidDate}). No charge until then.`
            : "Create a portal-owned monthly subscription so they bill automatically.",
          anchor_date: lastPrepaidDate || null,
        },
      };
    }
    return { problem: { state: "none", reason: "No recurring plan — nothing to schedule." }, plan: { kind: "none", title: "Nothing to fix" } };
  }
  if (sub.cancel_at_period_end || sub.cancel_at) {
    return {
      problem: { state: "ending", reason: `This subscription is set to cancel${sub.cancel_at ? " on " + iso(sub.cancel_at) : " at the end of the current period (" + iso(sub.current_period_end) + ")"} — so there's no recurring next payment after that.` },
      plan: { kind: "uncancel", endpoint: "/api/sorter/fix-payment", action: "uncancel", title: "Remove the scheduled cancellation", detail: "Clear the cancel-at date so billing continues on its normal cycle." },
    };
  }
  if (sub.pause_collection) {
    return {
      problem: { state: "paused", reason: "Billing is paused (pause_collection) — Stripe won't charge them until it's resumed." },
      plan: { kind: "resume", endpoint: "/api/sorter/fix-payment", action: "resume", title: "Resume billing", detail: "Clear the pause so the next invoice charges normally." },
    };
  }
  if (sub.status === "past_due" || sub.status === "unpaid") {
    return {
      problem: { state: "at_risk", reason: "The last payment failed — the subscription is past due / unpaid. Usually the card needs updating." },
      plan: { kind: "card_link", endpoint: "/api/sorter/fix-payment", action: "card_link", title: "Send a card-update link", detail: "Generate a secure link the member uses to fix their card; billing retries once it's updated." },
    };
  }
  if (sub.status === "incomplete" || sub.status === "incomplete_expired") {
    return {
      problem: { state: "missing", reason: "The subscription never completed its first payment (incomplete) — no card was successfully charged." },
      plan: { kind: "card_link", endpoint: "/api/sorter/fix-payment", action: "card_link", title: "Send a card link to start billing", detail: "Collect a working card; once paid the subscription activates and bills on schedule." },
    };
  }
  // Fully canceled: the cancel_at_period_end flag clears once Stripe actually
  // cancels, so this falls through the "ending" check above. A canceled sub can't
  // be revived — the fix is a fresh portal sub.
  if (sub.status === "canceled") {
    return {
      problem: { state: "missing", reason: `This subscription was canceled${sub.canceled_at ? " on " + iso(sub.canceled_at) : (sub.current_period_end ? " (ended " + iso(sub.current_period_end) + ")" : "")} — there's no active billing.` },
      plan: {
        kind: "setup_monthly", endpoint: "/api/sorter/setup-monthly", action: null,
        title: "Set up new billing",
        detail: "The old subscription is canceled and can't be revived — create a fresh portal-owned subscription so they bill again.",
        anchor_date: lastPrepaidDate || null,
      },
    };
  }
  // Period end is in the PAST but not flagged canceled/past_due — stale/ended sub.
  // Never report a past date as a "scheduled" next payment.
  const nextUnix = sub.status === "trialing" ? sub.trial_end : sub.current_period_end;
  if (nextUnix && nextUnix * 1000 < Date.now()) {
    return {
      problem: { state: "missing", reason: `The last billing period ended ${iso(nextUnix)} and nothing is scheduled after it.` },
      plan: {
        kind: "setup_monthly", endpoint: "/api/sorter/setup-monthly", action: null,
        title: "Set up new billing",
        detail: "Create a fresh portal-owned subscription so they bill on schedule again.",
        anchor_date: lastPrepaidDate || null,
      },
    };
  }
  // active / trialing with a future charge → already fine
  const next = iso(nextUnix);
  return {
    problem: { state: "scheduled", reason: `Next payment is already scheduled${next ? " for " + next : ""}.` },
    plan: { kind: "none", title: "Already scheduled — no fix needed" },
  };
}

// Claude sanity-check: confirm the deterministic plan makes sense for the facts,
// flag anything off, and explain in plain English. Advisory only. Returns
// { explanation, caution, warnings[] } — always (falls back if the API is down).
async function aiSanityCheck({ facts, problem, plan }) {
  const fallback = {
    explanation: `${problem.reason} ${plan.detail || ""}`.trim(),
    caution: false, warnings: [],
  };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: "You verify subscription-billing fixes for a sports-academy CRM. You are given (a) the FACTS about a member's Stripe subscription and payments, (b) the PROBLEM a deterministic checker found, and (c) the PLAN it proposes. Your job: sanity-check that the plan correctly fixes the problem for these facts, and explain it in 1-2 plain-English sentences a non-technical staffer understands. If the plan looks wrong or risky (e.g. it would double-charge, charge immediately when it shouldn't, or the dates don't add up), set caution=true and say why in warnings. Reply with ONLY a JSON object: {\"explanation\": string, \"caution\": boolean, \"warnings\": string[]}. No prose outside the JSON.",
        messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 2)}\n\nPROBLEM:\n${JSON.stringify(problem)}\n\nPLAN:\n${JSON.stringify(plan)}` }],
      }),
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    const raw = data.content?.[0]?.text || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]);
    return {
      explanation: typeof parsed.explanation === "string" && parsed.explanation.trim() ? parsed.explanation.trim() : fallback.explanation,
      caution: !!parsed.caution,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter(w => typeof w === "string") : [],
    };
  } catch (_) { return fallback; }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    if (!stripeKey()) throw new Error("Stripe secret key not configured");
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const stagingId = body.staging_id;
    if (!stagingId) return res.status(400).json({ error: "staging_id required" });
    const rows = await sb(`members_staging?id=eq.${encodeURIComponent(stagingId)}&client_id=eq.${encodeURIComponent(clientId)}&select=*&limit=1`);
    const s = Array.isArray(rows) && rows[0];
    if (!s) return res.status(404).json({ error: "staging row not found" });

    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=stripe_connect_account_id&limit=1`);
    const acct = Array.isArray(clientRows) && clientRows[0] && clientRows[0].stripe_connect_account_id;
    if (!acct) return res.status(409).json({ error: "academy not connected to Stripe" });

    const subId = s.stripe_subscription_id || null;
    const custId = s.stripe_customer_id || null;
    const offerKey = s.offer_price_key || null;
    const stripeUrlBase = `https://dashboard.stripe.com/${acct}`;

    // ── apply: a single, explicit write ──
    if (body.mode === "apply") {
      const action = body.action;
      if (action === "uncancel") {
        if (!subId) return res.status(409).json({ error: "no subscription to un-cancel" });
        const sub = await stripeFetch(`/subscriptions/${encodeURIComponent(subId)}`, {
          method: "POST", stripeAccount: acct, body: { cancel_at_period_end: "false", cancel_at: "" },
        });
        return res.status(200).json({ ok: true, action, status: sub.status, next: iso(sub.current_period_end) });
      }
      if (action === "resume") {
        if (!subId) return res.status(409).json({ error: "no subscription to resume" });
        const sub = await stripeFetch(`/subscriptions/${encodeURIComponent(subId)}`, {
          method: "POST", stripeAccount: acct, body: { pause_collection: "" },
        });
        return res.status(200).json({ ok: true, action, status: sub.status, next: iso(sub.current_period_end) });
      }
      if (action === "card_link") {
        if (!custId) return res.status(409).json({ error: "no Stripe customer for a card link" });
        const origin = (req.headers.origin || "https://portal.byanymeansbusiness.com").replace(/\/+$/, "");
        const sess = await stripeFetch(`/checkout/sessions`, {
          method: "POST", stripeAccount: acct,
          body: { mode: "setup", customer: custId, success_url: `${origin}/client-portal.html?card=saved`, cancel_url: `${origin}/client-portal.html?card=cancelled` },
        });
        return res.status(200).json({ ok: true, action, url: sess.url || null });
      }
      if (action === "cancel_old") {
        // Blocked-fallback step 2: cancel the OLD sub after a replacement is made.
        // If Stripe refuses, hand back a manual instruction + deep link.
        const target = body.cancel_sub_id || subId;
        if (!target) return res.status(409).json({ error: "no subscription id to cancel" });
        try {
          const sub = await stripeFetch(`/subscriptions/${encodeURIComponent(target)}`, { method: "DELETE", stripeAccount: acct });
          return res.status(200).json({ ok: true, action, canceled: true, status: sub.status });
        } catch (e) {
          return res.status(200).json({ ok: false, action, manual: true, error: e.message, stripe_url: `${stripeUrlBase}/subscriptions/${target}` });
        }
      }
      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    // ── preview (default): diagnose + propose + AI sanity-check ──
    let sub = null;
    if (subId) {
      try { sub = await stripeFetch(`/subscriptions/${encodeURIComponent(subId)}?expand[]=items.data.price.product`, { stripeAccount: acct }); }
      catch (_) { sub = null; }
    }
    // current_period_end moved onto the items in recent Stripe API versions —
    // backfill the sub-level field so classify()/facts read it consistently.
    if (sub && sub.items && sub.items.data && sub.items.data[0] && !sub.current_period_end) {
      sub.current_period_end = sub.items.data[0].current_period_end || null;
    }
    // The latest one-time (prepaid) charge → anchor for setup_monthly.
    let lastPrepaidDate = null, charges = [];
    if (custId) {
      try {
        const ch = await stripeFetch(`/charges?customer=${encodeURIComponent(custId)}&limit=15`, { stripeAccount: acct });
        charges = (ch.data || []).map(c => ({ amount_cents: c.amount, one_time: !c.invoice, refunded: !!c.refunded, status: c.status, date: iso(c.created) }));
        const prepaid = charges.find(c => c.one_time && !c.refunded && c.status === "succeeded");
        lastPrepaidDate = prepaid ? prepaid.date : null;
      } catch (_) {}
    }
    const recurringExpected = /month|week|3_month|6_month|12_month|year/i.test(offerKey || "");
    const { problem, plan } = classify({ sub, offerKey, recurringExpected, lastPrepaidDate });

    const subItem = sub && sub.items && sub.items.data && sub.items.data[0];
    const subPrice = subItem && subItem.price;
    const facts = {
      member: { athlete: s.athlete_name, plan_from_sheet: s.plan, offer_price_key: offerKey, status_from_sheet: s.status },
      subscription: sub ? {
        status: sub.status,
        amount: subPrice ? `$${((subPrice.unit_amount || 0) / 100).toFixed(2)}` : null,
        interval: subPrice && subPrice.recurring ? subPrice.recurring.interval : null,
        current_period_end: iso(sub.current_period_end),
        trial_end: iso(sub.trial_end),
        cancel_at_period_end: !!sub.cancel_at_period_end,
        cancel_at: iso(sub.cancel_at),
        paused: !!sub.pause_collection,
      } : null,
      recent_charges: charges.slice(0, 6),
      last_prepaid_charge: lastPrepaidDate,
    };

    const ai = plan.kind === "none" ? { explanation: problem.reason, caution: false, warnings: [] } : await aiSanityCheck({ facts, problem, plan });

    return res.status(200).json({
      ok: true,
      member: { id: s.id, athlete_name: s.athlete_name, parent_email: s.parent_email, customer_id: custId, subscription_id: subId, offer_price_key: offerKey },
      problem, plan, ai, facts,
      stripe_account_id: acct,
      stripe_sub_url: subId ? `${stripeUrlBase}/subscriptions/${subId}` : null,
    });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
