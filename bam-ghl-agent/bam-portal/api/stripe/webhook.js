import { withSentryApiRoute } from "../_sentry.js";
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
//   invoice.payment_succeeded       →  if member was 'payment_failed',
//                                       recover to 'live' (Stripe retry hit
//                                       after the parent updated their card
//                                       via the Billing Portal)
//   payment_method.attached         →  audit-log a "card updated" entry so
//                                       staff sees it in member history
//   charge.refunded                 →  mirror Stripe-Dashboard refunds into
//                                       the `refunds` table (idempotent on
//                                       stripe_refund_id — so portal-initiated
//                                       refunds don't get duplicated)
//   price.created / price.updated   →  upsert into pricing_catalog
//                                       (auto-classify legacy_match if amount
//                                        equals a canonical, else legacy_unknown)
//
// Connect: each event payload has `account` set to the connected account
// id when it originated there. We use the platform key + Stripe-Account
// header to fetch the customer (needed for the customer email match).
//
// Signature verification: Stripe-Signature header HMAC'd against the raw
// request body with the webhook signing secret.

import crypto from "node:crypto";
import { fireOnboardingActivations } from "../onboarding/activations.js";
import { sendSms } from "../ghl/_core.js";

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

async function handler(req, res) {
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
      case "invoice.payment_succeeded":     return await handleInvoiceSucceeded(event, connectedAccount, res);
      case "invoice.paid":                  return await handleInvoiceSucceeded(event, connectedAccount, res);
      case "payment_method.attached":       return await handlePaymentMethodAttached(event, connectedAccount, res);
      case "charge.refunded":               return await handleChargeRefunded(event, connectedAccount, res);
      case "price.created":                 return await handlePriceUpserted(event, connectedAccount, res);
      case "price.updated":                 return await handlePriceUpserted(event, connectedAccount, res);
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
  // PORTAL-OWNED onboarding subs are created by api/onboarding/checkout.js as
  // `incomplete` and already carry their member's stripe_subscription_id. Do NOT
  // flip them to live here (payment isn't confirmed yet) — handleInvoiceSucceeded
  // activates them on the first paid invoice.
  if (sub.metadata && sub.metadata.origin === "fullcontrol-portal") {
    return res.status(200).json({ skipped: "portal-owned sub — activated on first paid invoice" });
  }
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

  // Stripe sub.created → stripe_joined_at (this is the actual paying-member
  // start date, more accurate than the GHL form's joined_date which captures
  // intake-form submit time).
  if (sub.created) patch.stripe_joined_at = new Date(sub.created * 1000).toISOString();

  // Persist current price id (members.stripe_price_id powers the legacy pill
  // + Pricing view counts).
  if (priceId) patch.stripe_price_id = priceId;

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

  // Funnel KPI: record the conversion (lead went live on Stripe), tied to the
  // lead by email. Best-effort — never blocks member linking. ref=sub.id keeps
  // it idempotent on webhook retries.
  try {
    const amount = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price
      && sub.items.data[0].price.unit_amount || 0) / 100;
    await sb(`ghl_funnel_events`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id: target.client_id,
        event_type: "conversion",
        contact_email: email,
        ref: sub.id,
        value: amount || null,
        occurred_at: sub.created ? new Date(sub.created * 1000).toISOString() : nowIso(),
        raw: { sub_id: sub.id, event_id: event.id, customer_id: customerId },
      }]),
    });
  } catch { /* non-fatal — funnel telemetry only */ }

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

  // If a cancellations row was already created by the portal (e.g. period-end
  // cancel from actionCancel — member is currently 'cancelling'), don't insert
  // a duplicate. Otherwise insert one now (covers cancellations done directly
  // in the Stripe Dashboard, outside the portal).
  const existingCancel = await sb(
    `cancellations?member_id=eq.${member.id}&type=eq.cancel&select=id&limit=1`
  );
  const cancellationAlreadyLogged = Array.isArray(existingCancel) && existingCancel.length > 0;
  if (!cancellationAlreadyLogged) {
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
  }

  await sb(`members?id=eq.${member.id}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  await writeAudit({
    client_id:       member.client_id,
    member_id:       member.id,
    action_type:     cancellationAlreadyLogged ? "stripe-period-end-cancel-finalized" : "stripe-auto-cancel",
    args:            { event_id: event.id, sub_id: sub.id, prior_status: member.status },
    stripe_response: { id: sub.id, status: sub.status },
    db_changes:      { cancellations: cancellationAlreadyLogged ? "(already present)" : "inserted", members: "deleted" },
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

// ─────────────────────────────────────────────────────────
// invoice.payment_succeeded / invoice.paid
// ─────────────────────────────────────────────────────────
// Parent paid successfully. Three recoverable cases:
//   - 'payment_failed' → 'live'  (parent updated card via Billing Portal,
//                                  Stripe retry succeeded)
//   - 'paused'         → 'live'  (pause trial_end elapsed naturally and
//                                  Stripe auto-resumed billing)
//   - anything else    → no-op   (every successful invoice fires this
//                                  event — only act on a real recovery)
async function handleInvoiceSucceeded(event, connectedAccount, res) {
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

  // ── Portal-native onboarding: first paid invoice on a PORTAL-OWNED sub ──
  // The parent just paid on the funnel → flip to live and fire the downstream
  // activations (GHL webhook + CoachIQ). Gated to portal-owned onboarding subs so
  // it never touches CoachIQ/GHL/manual subs. Non-fatal: an activation failure
  // must never break Stripe webhook handling.
  if (member.status === "payment_method_required" && subId) {
    let onbSub = null;
    try { onbSub = await stripeFetch(`/subscriptions/${subId}`, connectedAccount); } catch (_) { onbSub = null; }
    if (onbSub && onbSub.metadata && onbSub.metadata.origin === "fullcontrol-portal") {
      await sb(`members?id=eq.${member.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "live", updated_at: nowIso() }),
      });
      let activations = null;
      try {
        activations = await fireOnboardingActivations(member, {
          plan: onbSub.metadata.plan, term: onbSub.metadata.term, sb, writeAudit,
        });
      } catch (e) {
        activations = { error: String((e && e.message) || e) };
      }
      // Text staff that a new parent just signed up + paid. Non-fatal: an SMS
      // failure must never break webhook handling. Destination = the academy's
      // configured staff phone (clients.staff_notify_phone), else env fallback.
      let staffNotify = null;
      try {
        const cRows = await sb(`clients?id=eq.${member.client_id}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,staff_notify_phone&limit=1`);
        const client = Array.isArray(cRows) && cRows[0];
        const toPhone = (client && client.staff_notify_phone) || process.env.STAFF_NOTIFY_PHONE || null;
        if (client && toPhone) {
          const amt = inv.amount_paid != null ? `$${(inv.amount_paid / 100).toFixed(2)}` : "—";
          const msg = `🎉 New signup — ${client.business_name || "academy"}\n`
            + `Athlete: ${member.athlete_name || "—"}\n`
            + `Parent: ${member.parent_name || "—"}${member.parent_email ? " · " + member.parent_email : ""}${member.parent_phone ? " · " + member.parent_phone : ""}\n`
            + `Plan: ${onbSub.metadata.plan || "—"} · ${onbSub.metadata.term || "—"}\n`
            + `Paid: ${amt} · status LIVE`;
          staffNotify = await sendSms({ client, toPhone, message: msg, contactName: "BAM Staff" });
        } else {
          staffNotify = { ok: false, error: "no staff_notify_phone configured" };
        }
      } catch (e) {
        staffNotify = { ok: false, error: String((e && e.message) || e) };
      }
      await writeAudit({
        client_id: member.client_id, member_id: member.id,
        action_type: "onboarding-activated",
        args: { invoice_id: inv.id, sub_id: subId, plan: onbSub.metadata.plan, term: onbSub.metadata.term, activations, staff_notify: staffNotify },
        db_changes: { members: { status: { from: "payment_method_required", to: "live" } } },
      });
      return res.status(200).json({ ok: true, action: "onboarding-activated", member_id: member.id, activations, staff_notify: staffNotify });
    }
  }

  const RECOVERABLE = new Set(["payment_failed", "paused"]);
  if (!RECOVERABLE.has(member.status)) {
    return res.status(200).json({ skipped: "member not in recoverable state", current_status: member.status });
  }
  const prevStatus = member.status;

  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "live", updated_at: nowIso() }),
  });

  // If recovering from pause, mark any active cancellations row completed
  // (idempotent via conditional filter — completed_at IS NULL). The cron also
  // runs this same logic in Phase B; whichever fires first wins.
  if (prevStatus === "paused") {
    await sb(
      `cancellations?member_id=eq.${member.id}&type=eq.pause&completed_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ completed_at: nowIso(), activated_at: nowIso() }),
      }
    ).catch(() => {});
  }

  await writeAudit({
    client_id:       member.client_id,
    member_id:       member.id,
    action_type:     prevStatus === "paused" ? "stripe-auto-pause-resumed" : "stripe-auto-payment-recovered",
    args:            { event_id: event.id, event_type: event.type, invoice_id: inv.id, sub_id: subId, customer_id: custId, amount_paid: inv.amount_paid },
    db_changes:      { members: { status: { from: prevStatus, to: "live" } } },
  });

  return res.status(200).json({ ok: true, action: "recovered-to-live", from: prevStatus, member_id: member.id });
}

// ─────────────────────────────────────────────────────────
// payment_method.attached
// ─────────────────────────────────────────────────────────
// Parent attached a new card (almost always via the Billing Portal).
// Audit-only — no status change here; the recovery flips at the next
// successful invoice (handleInvoiceSucceeded). Lets staff see "card
// updated at 10:23am" when scrolling a member's history without
// digging into Stripe.
async function handlePaymentMethodAttached(event, connectedAccount, res) {
  const pm = event.data && event.data.object;
  if (!pm) return res.status(200).json({ skipped: "no payment_method" });
  const custId = pm.customer;
  if (!custId) return res.status(200).json({ skipped: "no customer on payment_method" });

  const rows = await sb(
    `members?stripe_customer_id=eq.${encodeURIComponent(custId)}&select=id,client_id&limit=1`
  );
  const member = Array.isArray(rows) && rows[0];
  if (!member) return res.status(200).json({ skipped: "no member with that customer_id" });

  await writeAudit({
    client_id:   member.client_id,
    member_id:   member.id,
    action_type: "stripe-auto-card-updated",
    args:        {
      event_id:        event.id,
      payment_method:  pm.id,
      type:            pm.type,                  // 'card' | 'us_bank_account' | etc.
      card_brand:      pm.card?.brand || null,   // 'visa' / 'mastercard' / ...
      card_last4:      pm.card?.last4 || null,
      card_exp_month:  pm.card?.exp_month || null,
      card_exp_year:   pm.card?.exp_year || null,
    },
    db_changes:  null,
  });

  return res.status(200).json({ ok: true, action: "audit-logged", member_id: member.id });
}

// ─────────────────────────────────────────────────────────
// charge.refunded
// ─────────────────────────────────────────────────────────
// Stripe fires this when a charge is fully or partially refunded — including
// when the refund was created in the Stripe Dashboard (outside our portal).
// Mirror any refund rows that aren't already in `refunds` (idempotent on
// stripe_refund_id) so the portal's refund history stays complete.
async function handleChargeRefunded(event, connectedAccount, res) {
  const charge = event.data && event.data.object;
  if (!charge) return res.status(200).json({ skipped: "no charge object" });
  const custId = charge.customer;
  if (!custId) return res.status(200).json({ skipped: "no customer on charge" });

  const memberRows = await sb(
    `members?stripe_customer_id=eq.${encodeURIComponent(custId)}&select=*&limit=1`
  );
  let member = Array.isArray(memberRows) && memberRows[0];

  // Member may have been cancelled/deleted already. Try cancellations as
  // fallback so we still log a refund row for the historical relationship.
  if (!member) {
    const cancelRows = await sb(
      `cancellations?stripe_customer_id=eq.${encodeURIComponent(custId)}&select=client_id,member_id,athlete_name,parent_name,stripe_subscription_id&order=created_at.desc&limit=1`
    );
    const c = Array.isArray(cancelRows) && cancelRows[0];
    if (c) {
      member = {
        id:                     c.member_id,
        client_id:              c.client_id,
        athlete_name:           c.athlete_name,
        parent_name:            c.parent_name,
        stripe_subscription_id: c.stripe_subscription_id,
        stripe_customer_id:     custId,
      };
    }
  }
  if (!member) return res.status(200).json({ skipped: "no member or cancellation record for customer" });

  const refundsOnCharge = (charge.refunds && charge.refunds.data) || [];
  if (refundsOnCharge.length === 0) return res.status(200).json({ skipped: "no refunds in payload" });

  let inserted = 0;
  let skipped = 0;
  for (const refund of refundsOnCharge) {
    // Idempotency: if a row with this stripe_refund_id already exists, skip.
    const existing = await sb(
      `refunds?stripe_refund_id=eq.${encodeURIComponent(refund.id)}&select=id&limit=1`
    );
    if (Array.isArray(existing) && existing.length > 0) {
      skipped++;
      continue;
    }
    await sb(`refunds`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id:              member.client_id,
        member_id:              member.id,
        athlete_name:           member.athlete_name,
        parent_name:            member.parent_name,
        stripe_charge_id:       charge.id,
        stripe_refund_id:       refund.id,
        amount_cents:           refund.amount,
        currency:               refund.currency || "cad",
        reason:                 refund.reason || "refunded in Stripe (outside portal)",
        refund_date:            new Date((refund.created || Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10),
        stripe_customer_id:     member.stripe_customer_id,
        stripe_subscription_id: member.stripe_subscription_id,
      }]),
    });
    inserted++;
  }

  await writeAudit({
    client_id:       member.client_id,
    member_id:       member.id,
    action_type:     "stripe-auto-refund-mirrored",
    args:            { event_id: event.id, charge_id: charge.id, refunds_inserted: inserted, refunds_skipped_idempotent: skipped },
    stripe_response: { charge_id: charge.id, amount_refunded: charge.amount_refunded },
    db_changes:      { refunds: `${inserted} inserted, ${skipped} already present` },
  });

  return res.status(200).json({ ok: true, action: "refunds-mirrored", inserted, skipped, member_id: member.id });
}

// ─────────────────────────────────────────────────────────
// price.created / price.updated
// ─────────────────────────────────────────────────────────
// Mirror every Stripe price for a connected academy into pricing_catalog
// so /change, mismatch detector, and Offers UI all stay in sync.
//
// Auto-classification rule:
//   - new row + amount matches an existing canonical for the same client
//     → tier='legacy_match', canonical_plan inherited, is_routable=false
//   - new row + no canonical match
//     → tier='legacy_unknown', is_routable=false
//   - existing row: tier/canonical_plan/is_routable are PRESERVED
//     (owner classifications never silently overwritten by Stripe edits)
async function handlePriceUpserted(event, connectedAccount, res) {
  const price = event.data && event.data.object;
  if (!price) return res.status(200).json({ skipped: "no price object" });
  if (!connectedAccount) return res.status(200).json({ skipped: "no connected account on event" });

  // Resolve client_id from the connected account
  const clientRows = await sb(
    `clients?stripe_connect_account_id=eq.${encodeURIComponent(connectedAccount)}&select=id&limit=1`
  );
  const client = Array.isArray(clientRows) && clientRows[0];
  if (!client) {
    await writeAudit({
      action_type: "stripe-price-upsert-orphan",
      args:        { event_id: event.id, connected_account: connectedAccount, price_id: price.id },
    });
    return res.status(200).json({ skipped: "no client for connected account" });
  }

  // Existing row? Preserve owner-set classification.
  const existingRows = await sb(
    `pricing_catalog?client_id=eq.${client.id}` +
    `&stripe_price_id=eq.${encodeURIComponent(price.id)}` +
    `&select=tier,canonical_plan,is_routable&limit=1`
  );
  const existing = Array.isArray(existingRows) && existingRows[0];

  let tier, canonical_plan, is_routable;
  if (existing) {
    tier           = existing.tier;
    canonical_plan = existing.canonical_plan;
    is_routable    = existing.is_routable;
  } else {
    // Auto-classify: amount match against this academy's canonical rows
    const canonicalRows = await sb(
      `pricing_catalog?client_id=eq.${client.id}` +
      `&tier=eq.canonical&amount_cents=eq.${price.unit_amount || 0}` +
      `&select=canonical_plan&limit=1`
    );
    const matchingCanonical = Array.isArray(canonicalRows) && canonicalRows[0];
    tier           = matchingCanonical ? "legacy_match" : "legacy_unknown";
    canonical_plan = matchingCanonical ? matchingCanonical.canonical_plan : null;
    is_routable    = false;
  }

  // Derive interval label from price.recurring
  let interval = null;
  if (price.recurring && price.recurring.interval && price.recurring.interval_count != null) {
    const c = price.recurring.interval_count, u = price.recurring.interval;
    if (u === "week" && c === 4)  interval = "4_weeks";
    else if (u === "week" && c === 12) interval = "3_months";
    else if (u === "week" && c === 24) interval = "6_months";
    else if (u === "month" && c === 1) interval = "4_weeks";
    else if (u === "month" && c === 3) interval = "3_months";
    else if (u === "month" && c === 6) interval = "6_months";
    else interval = `${c}_${u}`;
  } else if (price.type === "one_time") {
    interval = "one_time";
  }

  const hst_mode = price.tax_behavior === "inclusive" ? "all_in" : null;

  const row = {
    client_id:         client.id,
    stripe_price_id:   price.id,
    stripe_product_id: price.product,
    stripe_account_id: connectedAccount,
    display_name:      price.nickname || null,
    canonical_plan,
    tier,
    is_routable,
    amount_cents:      price.unit_amount || 0,
    currency:          price.currency || "cad",
    interval,
    hst_mode,
    last_synced_at:    nowIso(),
  };

  await sb(`pricing_catalog?on_conflict=client_id,stripe_price_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });

  await writeAudit({
    client_id:   client.id,
    action_type: existing ? "stripe-price-updated" : "stripe-price-created",
    args:        { event_id: event.id, price_id: price.id, product_id: price.product, amount_cents: price.unit_amount, auto_tier: tier, canonical_plan },
  });

  return res.status(200).json({ ok: true, action: event.type, price_id: price.id, tier });
}

export default withSentryApiRoute(handler);
