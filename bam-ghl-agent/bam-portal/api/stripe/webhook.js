// Vercel Serverless Function — Stripe webhook (Connect events)
//
// Single platform-level Stripe webhook receiving events from every
// connected academy account. Keeps the portal's `members` table in
// sync with Stripe even when things change OUTSIDE the portal.
//
// Events handled:
//   customer.subscription.created   →  link pending member ↔ first sub
//                                       (flips status to 'live')
//   customer.subscription.deleted   →  auto-cancel if cancelled in Stripe
//                                       (move members row → cancellations)
//   customer.subscription.updated   →  sync members.plan if price changed
//                                       in Stripe (canonical prices only)
//   invoice.payment_failed          →  auto-flag status='payment_failed'
//
// Connect: each event payload has `account` set to the connected account
// id when it originated there. We use the platform key + Stripe-Account
// header to fetch the customer (needed for the customer email match).
//
// Signature verification: Stripe-Signature header HMAC'd against the raw
// request body with the webhook signing secret.

import crypto from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

// Stripe signature verification needs the RAW body — disable Vercel's
// default JSON body parser for this route.
export const config = { api: { bodyParser: false } };

// Reverse of api/members.js PLAN_TO_PRICE. Only canonical prices map
// back — non-canonical / legacy / lil-sale prices are intentionally
// silent so we don't overwrite a grandfathered tier label.
const PRICE_TO_PLAN = {
  "plan_ToNwa96lQ5I1Bs": "1/wk",     // Steady
  "plan_ThYK86w2Zd8fp3": "2/wk",     // Accelerated
  "plan_U3CUUJkzgyTjel": "3/wk",     // Elevate
  "plan_U3CFSoR1LdyGlb": "unlmtd",   // Dominate
};

function nowIso() { return new Date().toISOString(); }

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map(p => {
      const idx = p.indexOf("=");
      return [p.slice(0, idx), p.slice(idx + 1)];
    })
  );
  if (!parts.t || !parts.v1) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(parts.v1, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch (_) { return false; }
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function stripeFetch(path, stripeAccount) {
  const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = { Authorization: `Bearer ${stripeSecret}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Stripe ${res.status}: ${txt}`);
  }
  return res.json();
}

async function writeAudit({ client_id, member_id, action_type, args, stripe_response, db_changes }) {
  try {
    await sb(`member_audit_log`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id:         client_id || null,
        member_id:         member_id || null,
        action_type,
        args:              args || null,
        performed_by_name: "Stripe webhook",
        stripe_response:   stripe_response || null,
        db_changes:        db_changes || null,
      }]),
    });
  } catch (_) { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await readRawBody(req);
  const sig     = req.headers["stripe-signature"];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  if (!verifyStripeSignature(rawBody, sig, secret)) {
    return res.status(400).json({ error: "invalid signature" });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch (_) { return res.status(400).json({ error: "invalid JSON" }); }

  const connectedAccount = event.account || null;

  try {
    switch (event.type) {
      case "customer.subscription.created": return await handleSubCreated(event, connectedAccount, res);
      case "customer.subscription.deleted": return await handleSubDeleted(event, connectedAccount, res);
      case "customer.subscription.updated": return await handleSubUpdated(event, connectedAccount, res);
      case "invoice.payment_failed":        return await handleInvoiceFailed(event, connectedAccount, res);
      default:                              return res.status(200).json({ skipped: event.type });
    }
  } catch (e) {
    // Return 200 so Stripe doesn't retry endlessly. Log for inspection.
    console.error("stripe webhook error:", event.type, e.message);
    return res.status(200).json({ error: e.message, event_type: event.type });
  }
}

// ─────────────────────────────────────────────────────────
// customer.subscription.created
// ─────────────────────────────────────────────────────────
// First payment / first sub. Match a pending member by parent email and
// link the Stripe IDs + flip to 'live'. Siblings (one parent → many
// athletes) handled FIFO: oldest pending member matches first sub.
async function handleSubCreated(event, connectedAccount, res) {
  const sub = event.data && event.data.object;
  if (!sub) return res.status(200).json({ skipped: "no sub object" });
  const customerId = sub.customer;
  const customer = await stripeFetch(`/customers/${customerId}`, connectedAccount);
  const email = ((customer && customer.email) || "").toLowerCase().trim();
  if (!email) return res.status(200).json({ skipped: "no customer email" });

  const candidates = await sb(
    `members?status=eq.payment_method_required` +
    `&parent_email=eq.${encodeURIComponent(email)}` +
    `&stripe_subscription_id=is.null` +
    `&select=id,client_id,athlete_name,parent_email` +
    `&order=created_at.asc&limit=1`
  );
  const target = Array.isArray(candidates) && candidates[0];

  if (!target) {
    await writeAudit({
      action_type: "stripe-intake-orphan",
      args:        { event_id: event.id, customer_email: email, sub_id: sub.id, connected_account: connectedAccount },
    });
    return res.status(200).json({ skipped: "no pending member for email", email });
  }

  // Derive plan from the price the sub was created against (when the price
  // is in our canonical PRICE_TO_PLAN map). Lets us auto-populate plan
  // from what the parent actually bought on the funnel, so staff don't
  // have to set it manually.
  const priceId = sub.items && sub.items.data && sub.items.data[0]
    && sub.items.data[0].price && sub.items.data[0].price.id;
  const planFromPrice = priceId ? PRICE_TO_PLAN[priceId] : null;

  const patch = {
    status:                 "live",
    stripe_customer_id:     customerId,
    stripe_subscription_id: sub.id,
    updated_at:             nowIso(),
  };
  if (planFromPrice) patch.plan = planFromPrice;

  await sb(`members?id=eq.${target.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });

  await writeAudit({
    client_id:       target.client_id,
    member_id:       target.id,
    action_type:     "intake-stripe-link",
    args:            { event_id: event.id, sub_id: sub.id, customer_id: customerId, price_id: priceId, plan_from_price: planFromPrice },
    stripe_response: { id: sub.id, status: sub.status },
    db_changes:      { members: { status: "payment_method_required → live", linked: true, plan: planFromPrice || "(unchanged — non-canonical price)" } },
  });

  return res.status(200).json({ ok: true, linked_member_id: target.id });
}

// ─────────────────────────────────────────────────────────
// customer.subscription.deleted
// ─────────────────────────────────────────────────────────
// Sub cancelled in Stripe (outside the portal). Mirror what /cancel
// does: insert a cancellations row, delete the members row.
async function handleSubDeleted(event, connectedAccount, res) {
  const sub = event.data && event.data.object;
  if (!sub) return res.status(200).json({ skipped: "no sub object" });

  const rows = await sb(
    `members?stripe_subscription_id=eq.${encodeURIComponent(sub.id)}&select=*&limit=1`
  );
  const member = Array.isArray(rows) && rows[0];
  if (!member) return res.status(200).json({ skipped: "no member with that sub_id" });

  await sb(`cancellations`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      client_id:              member.client_id,
      member_id:              member.id,
      athlete_name:           member.athlete_name,
      archetype:              member.archetype,
      parent_name:            member.parent_name,
      type:                   "cancel",
      cancel_date:            new Date().toISOString().slice(0, 10),
      reason:                 "cancelled in Stripe (outside portal)",
      stripe_subscription_id: member.stripe_subscription_id,
      stripe_customer_id:     member.stripe_customer_id,
    }]),
  });

  await sb(`members?id=eq.${member.id}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  await writeAudit({
    client_id:       member.client_id,
    member_id:       member.id,
    action_type:     "stripe-auto-cancel",
    args:            { event_id: event.id, sub_id: sub.id },
    stripe_response: { id: sub.id, status: sub.status },
    db_changes:      { cancellations: "inserted", members: "deleted" },
  });

  return res.status(200).json({ ok: true, action: "auto-cancelled", member_id: member.id });
}

// ─────────────────────────────────────────────────────────
// customer.subscription.updated
// ─────────────────────────────────────────────────────────
// If the sub's price changed AND the new price is in the canonical map,
// sync members.plan. Non-canonical / grandfathered prices are left
// alone (we don't want to silently overwrite a special-case label).
async function handleSubUpdated(event, connectedAccount, res) {
  const sub = event.data && event.data.object;
  if (!sub) return res.status(200).json({ skipped: "no sub object" });
  const newPriceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
  if (!newPriceId) return res.status(200).json({ skipped: "no price on sub" });
  const newPlan = PRICE_TO_PLAN[newPriceId];
  if (!newPlan) return res.status(200).json({ skipped: "price not in canonical map", price: newPriceId });

  const rows = await sb(
    `members?stripe_subscription_id=eq.${encodeURIComponent(sub.id)}&select=id,plan,client_id,athlete_name&limit=1`
  );
  const member = Array.isArray(rows) && rows[0];
  if (!member) return res.status(200).json({ skipped: "no member with that sub_id" });
  if (member.plan === newPlan) return res.status(200).json({ skipped: "plan already in sync" });

  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ plan: newPlan, updated_at: nowIso() }),
  });

  await writeAudit({
    client_id:   member.client_id,
    member_id:   member.id,
    action_type: "stripe-auto-plan-sync",
    args:        { event_id: event.id, sub_id: sub.id, from: member.plan, to: newPlan, price_id: newPriceId },
    db_changes:  { members: { plan: { from: member.plan, to: newPlan } } },
  });

  return res.status(200).json({ ok: true, action: "plan-synced", from: member.plan, to: newPlan });
}

// ─────────────────────────────────────────────────────────
// invoice.payment_failed
// ─────────────────────────────────────────────────────────
// Card declined / past due. Flag the member with status='payment_failed'
// so staff sees them surfaced under the "Issues" filter.
async function handleInvoiceFailed(event, connectedAccount, res) {
  const inv = event.data && event.data.object;
  if (!inv) return res.status(200).json({ skipped: "no invoice" });
  const subId  = inv.subscription;
  const custId = inv.customer;

  let member = null;
  if (subId) {
    const r = await sb(`members?stripe_subscription_id=eq.${encodeURIComponent(subId)}&select=*&limit=1`);
    if (Array.isArray(r) && r[0]) member = r[0];
  }
  if (!member && custId) {
    const r = await sb(`members?stripe_customer_id=eq.${encodeURIComponent(custId)}&select=*&limit=1`);
    if (Array.isArray(r) && r[0]) member = r[0];
  }
  if (!member) return res.status(200).json({ skipped: "no member match for invoice" });
  if (member.status === "payment_failed") return res.status(200).json({ skipped: "already flagged" });

  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "payment_failed", updated_at: nowIso() }),
  });

  await writeAudit({
    client_id:       member.client_id,
    member_id:       member.id,
    action_type:     "stripe-auto-payment-failed",
    args:            { event_id: event.id, invoice_id: inv.id, sub_id: subId, customer_id: custId, attempt_count: inv.attempt_count, amount_due: inv.amount_due },
    db_changes:      { members: { status: { from: member.status, to: "payment_failed" } } },
  });

  return res.status(200).json({ ok: true, action: "flagged-payment-failed", member_id: member.id });
}
