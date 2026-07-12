/* global Buffer, process */
import { withSentryApiRoute } from "../_sentry.js";
import { notifyClientPush } from "../push/_send.js";
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
import { ghl } from "../ghl/_core.js";
import { findOpenOpp, setStatus } from "../agent/_store.js";
import { cancelAllSalesOutbound } from "../agent/_cancel-outbound.js";
import { recordKpiEvent } from "../_kpi.js";
import { notifyOwners } from "../_notify-owners.js";
import { enrollContact, exitEnrollment, isAutomationLive } from "../automations.js";
import { getClientGhlToken } from "../website/availability.js";
import { getAccessSyncMode, syncAccessForMember } from "../_runtime/access-sync.js";
import { applyInvoiceCreditGrants } from "../_runtime/credit-engine.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import { resolveOrMintPortalContact } from "../_contacts.js";

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

// Subscriptions WE create + own (the parent funnels): the portal /funnel/
// (fullcontrol-portal), the academy-site enrollment (fullcontrol-website-
// enrollment), and the parent app's in-app checkout (fullcontrol-parent-app,
// api/parent/checkout.ts). All are created `incomplete` and activated on first
// paid invoice. Keep external subs (CoachIQ/GHL/manual) out of the onboarding path.
const PORTAL_OWNED_ORIGINS = new Set(["fullcontrol-portal", "fullcontrol-website-enrollment", "fullcontrol-parent-app"]);
export function isPortalOwnedOrigin(origin) { return PORTAL_OWNED_ORIGINS.has(origin); }

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
  } catch { return false; }
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

async function stripePost(path, body, stripeAccount) {
  const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = { Authorization: `Bearer ${stripeSecret}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const encoded = new URLSearchParams(
    Object.entries(body || {}).reduce((a, [k, v]) => { if (v != null) a[k] = String(v); return a; }, {})
  ).toString();
  const res = await fetch(`${STRIPE_API}${path}`, { method: "POST", headers, body: encoded });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

// ─── Pipeline exit on payment: mark the member's GHL opportunity WON ───────────
// When a member goes live via a portal payment, mark their GHL sales-board
// opportunity WON and record a pipeline_outcomes row — so the card leaves the
// board WITHOUT depending on any GHL onboarding workflow (the old marking-won
// step lived inside a GHL workflow that is skipped the moment the academy turns
// the portal "onboarding" automation on). Best-effort + idempotent: it never
// blocks member activation, and it won't double-mark on webhook retries or after
// the manual _plMarkWon button.
//
// Opportunity-id resolution order:
//   1. explicit hint (Stripe sub metadata.ghl_opportunity_id, threaded from the
//      website enroll funnel's ?opp_id), then
//   2. members.ghl_opportunity_id (persisted at checkout), then
//   3. (only when allowContactSearch) the member's open opp by ghl_contact_id.
//
// V1 SAFETY: the contact search is gated OFF for the external-sub path
// (handleSubCreated) so V1 / GHL-managed members are never touched — it runs only
// on the V2 portal-owned invoice path (handleInvoiceSucceeded).
//
// TODO: once the portal-native opportunity store (effort E) lands, this GHL PUT
// becomes a no-op (or is replaced by a local status write). Until then, if an
// academy turns GHL off the PUT simply fails silently — acceptable for now.
async function markOpportunityWon({ member, oppIdHint, allowContactSearch }) {
  try {
    if (!member || !member.client_id) return { skipped: "no member/client" };
    const cRows = await sb(`clients?id=eq.${encodeURIComponent(member.client_id)}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
    const client = Array.isArray(cRows) && cRows[0];
    if (!client) return { skipped: "no client row" };
    if (!client.ghl_access_token && !client.ghl_location_id) return { skipped: "academy not connected to GHL" };

    let oppId = (oppIdHint && String(oppIdHint).trim()) || member.ghl_opportunity_id || null;
    let oppRef = null;   // provider-aware handle for the WON write (portal-native safe)

    let token = null;
    try { token = await getClientGhlToken(client); }
    catch (e) { return { skipped: `no GHL token: ${String((e && e.message) || e)}` }; }

    if (!oppId && allowContactSearch && member.ghl_contact_id && client.ghl_location_id) {
      try {
        // Off-GHL store: findOpenOpp's GHL branch is byte-identical to the old
        // search here (prefer the open opp, else the first). Wrapped so a search
        // error falls through to skip exactly as the inline try/catch did before.
        const ref = await findOpenOpp({
          clientId: member.client_id, sb, ghl, token,
          locationId: client.ghl_location_id, contactId: member.ghl_contact_id,
        });
        if (ref) { oppRef = ref; oppId = ref.ghlOpportunityId || ref.id || null; }
      } catch { /* non-fatal — fall through to skip */ }
    }
    if (!oppId) return { skipped: "no opportunity to mark" };

    // Backfill the resolved opp id onto the member so retries + later code reuse it.
    if (!member.ghl_opportunity_id) {
      try {
        await sb(`members?id=eq.${member.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_opportunity_id: oppId, updated_at: nowIso() }) });
        member.ghl_opportunity_id = oppId;
      } catch { /* non-fatal */ }
    }

    // Idempotency: if a WON outcome already exists for this opp (retry, or the
    // manual mark-won button already fired), don't re-PUT or re-insert.
    try {
      const prior = await sb(`pipeline_outcomes?client_id=eq.${encodeURIComponent(member.client_id)}&opportunity_id=eq.${encodeURIComponent(oppId)}&status=eq.won&select=id&limit=1`);
      if (Array.isArray(prior) && prior.length > 0) return { ok: true, opportunity_id: oppId, already_won: true };
    } catch { /* if the check fails, fall through — re-PUT to WON is itself idempotent in GHL */ }

    // Mark the opportunity WON through the provider-aware store. On provider='ghl'
    // this is the identical PUT { status: 'won' }; on 'portal' it updates the store
    // row. Resolve a proper oppRef (a portal-native row matches on `id`, not a GHL id):
    // if we didn't already get one from findOpenOpp, look it up by contact.
    if (!oppRef && member.ghl_contact_id && client.ghl_location_id) {
      try { oppRef = await findOpenOpp({ clientId: member.client_id, sb, ghl, token, locationId: client.ghl_location_id, contactId: member.ghl_contact_id }); } catch { /* non-fatal */ }
    }
    if (!oppRef) oppRef = { ghlOpportunityId: oppId };
    await setStatus({
      clientId: member.client_id, sb, ghl, token,
      oppRef, status: "won",
      contactId: member.ghl_contact_id || null,
    });

    // Record the outcome (mirrors the manual mark-won + agent flows).
    try {
      await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: member.client_id, opportunity_id: oppId, status: "won", reason: "auto: paid via portal" }]) });
    } catch { /* non-fatal */ }

    return { ok: true, opportunity_id: oppId, marked_won: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Commitment → revert-to-monthly. The website funnel sub was created on a 3/6-month
// committed price (paid upfront, just now). When the offer says "Goes back to
// monthly", checkout.js stamped metadata.revert_to_price = the plan's monthly price.
// Here — AFTER the first invoice is paid — we attach a Stripe subscription_schedule:
//   phase0 = committed price ×1 iteration  →  phase1 = monthly price, then release.
// from_subscription adopts the existing (paid) sub as phase0 → no re-charge. Idempotent
// (skips if the sub already has a schedule). Non-fatal: must never break webhook handling.
async function maybeAttachCommitmentSchedule({ subId, onbSub, connectedAccount }) {
  const meta = onbSub.metadata || {};
  if (meta.commitment_reverts !== "monthly" || !meta.revert_to_price) return null;
  if (onbSub.schedule) return { skipped: "already scheduled" };
  // Carry any active coupon on the paid sub into BOTH schedule phases. Rebuilding
  // the phases below is declarative - a field not restated on a phase is dropped -
  // so without this a "forever"/repeating coupon would be lost the moment the plan
  // reverts to monthly. phase0's invoice is already paid, so restating it there is
  // a no-op; phase1 (monthly) is the one that actually needs it. Non-fatal: if we
  // can't read the coupon, we just proceed without carrying it (today's behavior).
  let couponId = null;
  try {
    const full = await stripeFetch(`/subscriptions/${subId}?expand[]=discounts.coupon`, connectedAccount);
    const d = (Array.isArray(full.discounts) ? full.discounts[0] : null) || full.discount || null;
    const cp = d && (typeof d.coupon === "object" ? d.coupon : null);
    couponId = cp && cp.id ? cp.id : null;
  } catch { couponId = null; }

  const sched = await stripePost("/subscription_schedules", { from_subscription: subId }, connectedAccount);
  const p0 = sched.phases && sched.phases[0];
  const item0 = p0 && p0.items && p0.items[0];
  const committedPrice = item0 && (typeof item0.price === "string" ? item0.price : item0.price && item0.price.id);
  if (!p0 || !committedPrice) throw new Error("schedule phase0 missing committed price");
  const updated = await stripePost(`/subscription_schedules/${sched.id}`, {
    end_behavior: "release",
    proration_behavior: "none",
    "phases[0][start_date]": p0.start_date,
    "phases[0][items][0][price]": committedPrice,
    "phases[0][iterations]": 1,
    "phases[1][items][0][price]": meta.revert_to_price,
    "phases[1][iterations]": 1,
    ...(couponId ? {
      "phases[0][discounts][0][coupon]": couponId,
      "phases[1][discounts][0][coupon]": couponId,
    } : {}),
  }, connectedAccount);
  return { schedule_id: updated.id, committed_price: committedPrice, revert_to_price: meta.revert_to_price, coupon_carried: couponId || null };
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
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────
// Phase 5 access sync (typed entitlements) — see
// api/_runtime/access-sync.ts + docs/parent-runtime-cutover-guardrails.md.
// Gated per academy by clients.access_sync_mode:
//   off (default) → no-op, webhook behavior byte-identical to before.
//   shadow        → full read path, writes nothing, audits what it WOULD do.
//   on            → writes typed access; a failure returns 5xx so Stripe
//                   RETRIES (the sync is a multi-write sequence — a partial
//                   failure swallowed as 200 loses the entitlement forever;
//                   DB uniqueness guards make the retry converge, not dup).
// Returns null to continue the normal 200 path, or a response the caller
// must return (the ON-mode 500).
// ─────────────────────────────────────────────────────────
// Stripe moved the invoice-line price field across API versions:
// legacy shape `line.price.id`, 2025+ shape `line.pricing.price_details.price`.
// Events arrive in whichever version the webhook endpoint is pinned to, so
// support both.
function linePriceId(line) {
  if (!line) return null;
  if (line.price && line.price.id) return line.price.id;
  if (line.pricing && line.pricing.price_details && line.pricing.price_details.price) {
    return line.pricing.price_details.price;
  }
  return null;
}

function invoiceLinePriceId(inv) {
  const line = inv && inv.lines && inv.lines.data && inv.lines.data[0];
  return linePriceId(line);
}

function invoiceSubMetadata(inv) {
  if (inv && inv.subscription_details && inv.subscription_details.metadata) return inv.subscription_details.metadata;
  if (inv && inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.metadata) return inv.parent.subscription_details.metadata;
  return {};
}

// Stripe moved the invoice's subscription id the same way it moved the sub
// metadata: classic API = top-level `invoice.subscription`; new API
// (billing_mode: flexible, seen 2026-07 on returning-enroll subs) = only
// `invoice.parent.subscription_details.subscription`. Without this fallback,
// handleInvoiceSucceeded got subId=undefined and skipped the flip-live
// activation (member stuck at "Signup in progress" until the reconcile cron).
function invoiceSubId(inv) {
  if (!inv) return null;
  if (inv.subscription) return inv.subscription;
  if (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription) {
    return inv.parent.subscription_details.subscription;
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// Credit engine (offer tie-in step D) — grant weekly credits from the paid
// invoice's real lines. Gated per academy by clients.credit_engine_enabled.
// Runs AFTER accessSync (the entitlement must exist before it can be topped
// up). Idempotent: grants key on source_ref invoice_line:<id> in the DB.
// A failure while enabled returns 5xx so Stripe retries (same rationale as
// the access sync). Returns null to continue, or the 500 response.
// ─────────────────────────────────────────────────────────
async function creditSync(res, { clientId, memberId, inv, subId, memberPriceId }) {
  let enabled = false;
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=credit_engine_enabled&limit=1`);
    enabled = !!(Array.isArray(rows) && rows[0] && rows[0].credit_engine_enabled);
    if (!enabled || !subId) return null;
    let lines = ((inv && inv.lines && inv.lines.data) || [])
      .filter((line) => line && line.id && linePriceId(line))
      .map((line) => ({
        lineId: line.id,
        stripePriceId: linePriceId(line),
        periodStart: new Date(((line.period && line.period.start) || 0) * 1000).toISOString(),
        periodEnd: new Date(((line.period && line.period.end) || 0) * 1000).toISOString(),
      }));
    if (!lines.length) return null;
    // GHL-era subs bill with DYNAMIC per-invoice prices that are never in the
    // typed catalog. For single-line invoices, fall back to the member's
    // stable subscription price (the same price the entitlement resolves
    // through). Multi-line invoices (prorations) keep their real prices so an
    // adjustment line can never double-grant.
    if (lines.length === 1 && memberPriceId && lines[0].stripePriceId !== memberPriceId) {
      const typed = await sb(
        `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&stripe_price_id=eq.${encodeURIComponent(lines[0].stripePriceId)}&select=id&limit=1`
      );
      if (!(Array.isArray(typed) && typed[0])) lines = [{ ...lines[0], stripePriceId: memberPriceId }];
    }
    const supabase = createRuntimeSupabaseClient();
    const result = await applyInvoiceCreditGrants(supabase, {
      tenantId: clientId, subscriptionId: subId, invoiceId: inv.id, lines,
    });
    await writeAudit({
      client_id: clientId, member_id: memberId,
      action_type: "credit-grant",
      args: { invoice_id: inv.id, sub_id: subId, granted: result.granted, skipped: result.skipped },
    }).catch(() => {});
    return null;
  } catch (e) {
    console.error(`[webhook] credit grant failed for member ${memberId}:`, e.message);
    await writeAudit({
      client_id: clientId, member_id: memberId,
      action_type: "credit-grant-error",
      args: { invoice_id: inv && inv.id, sub_id: subId, error: String((e && e.message) || e) },
    }).catch(() => {});
    if (enabled) {
      return res.status(500).json({ error: "credit grant failed" });
    }
    return null;
  }
}

async function accessSync(res, args) {
  let mode = "off";
  try {
    const supabase = createRuntimeSupabaseClient();
    mode = await getAccessSyncMode(supabase, args.clientId);
    if (mode === "off") return null;
    const outcome = await syncAccessForMember(supabase, args, { dryRun: mode === "shadow" });
    await writeAudit({
      client_id: args.clientId, member_id: args.memberId,
      action_type: `access-sync-${mode}`,
      args: outcome,
    }).catch(() => {});
    return null;
  } catch (e) {
    console.error(`[webhook] access sync (${mode}) failed for member ${args.memberId}:`, e.message);
    await writeAudit({
      client_id: args.clientId, member_id: args.memberId,
      action_type: "access-sync-error",
      args: { reason: args.reason, mode, error: String((e && e.message) || e) },
    }).catch(() => {});
    if (mode === "on") {
      return res.status(500).json({ error: "access sync failed", reason: args.reason });
    }
    return null; // off/shadow can never change webhook behavior
  }
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
  catch { return res.status(400).json({ error: "invalid JSON" }); }

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
      case "customer.created":              return await handleCustomerCreated(event, connectedAccount, res);
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
  if (sub.metadata && isPortalOwnedOrigin(sub.metadata.origin)) {
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
    `&select=id,client_id,athlete_name,parent_email,ghl_contact_id,ghl_opportunity_id` +
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

  // KPI event log (Track A): a paying member going live = the "joined" funnel
  // moment. Idempotent per member. Best-effort, never blocks the webhook.
  await recordKpiEvent({
    clientId: target.client_id, step: "joined",
    ghlContactId: target.ghl_contact_id || null,
    contactName: target.parent_name || target.athlete_name || null,
    occurredAt: sub.created ? new Date(sub.created * 1000).toISOString() : undefined,
    ref: `joined:${target.id}`,
    meta: { member_id: target.id, sub_id: sub.id, plan: planFromPrice || null },
  });

  // Pipeline exit (explicit-opp-only): if this member is already linked to a GHL
  // opportunity, mark it WON now that they're live. Contact-search is intentionally
  // OFF here so V1 / GHL-managed external subs are never touched (HARD RULE: don't
  // change V1). The website enroll funnel that sets members.ghl_opportunity_id is
  // portal-owned and returns earlier in this handler, so in practice this only fires
  // for an explicitly-linked opp. Best-effort — never blocks the link.
  try {
    await markOpportunityWon({
      member: target,
      oppIdHint: sub.metadata && sub.metadata.ghl_opportunity_id,
      allowContactSearch: false,
    });
  } catch { /* non-fatal */ }

  // C3 fix — exit active SALES sequences on conversion. The member just went live,
  // so any active portal sales drip (nurture / ghosted) must be exited or they keep
  // getting "we miss you" texts and can later be marked LOST. No automationKey =
  // exit ALL active sales enrollments for this contact. Idempotent (no-op if not
  // enrolled) and best-effort: never blocks the link. Only touches the portal's own
  // automation_enrollments table — it never reads or writes GHL, so V1 is untouched.
  const conversionContactId = target.ghl_contact_id || (sub.metadata && sub.metadata.ghl_contact_id) || null;
  try {
    if (conversionContactId) await exitEnrollment({ clientId: target.client_id, contactId: conversionContactId, reason: "converted" });
  } catch { /* non-fatal */ }

  // Signup sweep: cancel EVERY pending/approved agent-scheduled message (booking,
  // confirm, closing follow-up plan) + any parked reignition for this contact. The
  // member just went live - they must never get another sales text. Mirrors the
  // reply-cancel sweep (shared helper); portal-native tables only, so V1 is
  // untouched. Its own try block so a drip-exit error can't skip it. Best-effort.
  try {
    if (conversionContactId) await cancelAllSalesOutbound({ clientId: target.client_id, contactId: conversionContactId, sendError: "lead signed up" });
  } catch { /* non-fatal */ }

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

  // KPI event log (Track A): the "cancelled" funnel moment. Idempotent per
  // member row (a re-join later creates a fresh member id, so a future cancel
  // still counts). Best-effort.
  await recordKpiEvent({
    clientId: member.client_id, step: "cancelled",
    ghlContactId: member.ghl_contact_id || null,
    contactName: member.parent_name || member.athlete_name || null,
    ref: `cancelled:${member.id}`,
    meta: { member_id: member.id, sub_id: sub.id, reason: cancellationAlreadyLogged ? "portal cancel finalized" : "cancelled in Stripe" },
  });

  // Phase 5 access sync: cancel typed access BEFORE the member row disappears
  // (entitlement cancel must run first per the wiring plan).
  const accessFail = await accessSync(res, {
    clientId: member.client_id, memberId: member.id,
    reason: "subscription-deleted", subscriptionId: sub.id,
    overrideMemberStatus: "cancelled",
  });
  if (accessFail) return accessFail;

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

  // Phase 5 access sync: the plan changed → move the entitlement to the new
  // price's template (source_ref carries the new price id; the old grant gets
  // superseded/expired). Non-canonical price changes skip above and converge
  // on the next paid invoice instead.
  const accessFail = await accessSync(res, {
    clientId: member.client_id, memberId: member.id,
    reason: "subscription-updated", subscriptionId: sub.id,
    offerPriceId: (sub.metadata && sub.metadata.offer_price_id) || null,
    stripePriceId: newPriceId,
  });
  if (accessFail) return accessFail;

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
  const subId  = invoiceSubId(inv);
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
  if (member.status === "payment_failed") {
    // Already flagged - but this can be a Stripe RETRY after an ON-mode
    // access-sync failure (we 5xx'd, the member flip had already landed).
    // The access sync still needs its second chance here or it never runs.
    const accessRetryFail = await accessSync(res, {
      clientId: member.client_id, memberId: member.id,
      reason: "payment-failed", subscriptionId: subId, invoiceId: inv.id,
    });
    if (accessRetryFail) return accessRetryFail;
    return res.status(200).json({ skipped: "already flagged" });
  }

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

  // Owner/staff SMS (V1.5/V2, per notification_prefs). Non-fatal.
  notifyOwners(member.client_id, "payment_failure",
    `⚠️ Payment failed: ${member.athlete_name || member.parent_name || "a member"}. They're flagged in your portal.`).catch(() => {});

  // Native push to the owner's phone (silent no-op until APNs env exists).
  notifyClientPush(member.client_id, "payment-failed", {
    name: member.athlete_name || member.parent_name || "A member",
  }).catch(() => {});

  // Phase 5 access sync: mirror the failed state onto membership +
  // entitlements (suspend, never delete). Mirrors the member ROW so member
  // status and booking eligibility always agree.
  const accessFail = await accessSync(res, {
    clientId: member.client_id, memberId: member.id,
    reason: "payment-failed", subscriptionId: subId, invoiceId: inv.id,
  });
  if (accessFail) return accessFail;

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
// Activate a portal-owned onboarding member whose first invoice just paid.
// Extracted from handleInvoiceSucceeded so the reconcile safety-net cron
// (api/stripe/reconcile-activations.js) can run the EXACT same activation path
// for members whose invoice.paid webhook never arrived or failed inline. The
// caller guards on member.status === 'payment_method_required', so this is
// idempotent (a second run for an already-live member simply won't be invoked).
// Returns the same result object the webhook responds with.
export async function activatePortalOnboardingMember({ member, onbSub, inv, connectedAccount }) {
  const subId  = onbSub.id;
  const silent = onbSub.metadata.import_silent === "1";
  inv = inv || {};

  // ── Atomic activation claim (idempotency guard) ──────────────────────────
  // Stripe fires BOTH invoice.payment_succeeded AND invoice.paid for a single
  // payment, ~ms apart, and the reconcile cron can fire for the same member
  // too. Every caller guards on status === 'payment_method_required' BEFORE
  // reaching here, so without a lock two of them both read
  // 'payment_method_required' and both run the full activation → duplicate
  // staff SMS + duplicate GHL/pipeline side effects. (This is exactly what
  // double-texted Kartik Natarajan's signup on 2026-07-12: two
  // 'onboarding-activated' audit rows 75ms apart, each sending an SMS.)
  //
  // Make the flip a compare-and-swap: PATCH only the row that is STILL
  // 'payment_method_required' and ask for the updated row back
  // (return=representation). Exactly one concurrent caller matches and wins;
  // any other gets an empty array and bails before a single side effect fires.
  // Safe for the reconcile cron too — if the webhook already won, the cron's
  // claim matches nothing and no-ops.
  const claimed = await sb(
    `members?id=eq.${member.id}&status=eq.payment_method_required`,
    {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "live", updated_at: nowIso() }),
    }
  );
  if (!Array.isArray(claimed) || claimed.length === 0) {
    // Another Stripe event (or the cron) already claimed this activation.
    // Do NOT re-fire notifications/activations — report the no-op and stop.
    return {
      ok: true, action: "already-activated", member_id: member.id,
      skipped: "activation already claimed by a concurrent event",
    };
  }

  let pipelineWon = silent ? { skipped: "import_silent" } : null;
  if (!silent) {
    pipelineWon = await markOpportunityWon({
      member, oppIdHint: onbSub.metadata.ghl_opportunity_id, allowContactSearch: true,
    });
  }

  let activations = null;
  if (silent) {
    activations = { skipped: "import_silent" };
  } else {
    try {
      activations = await fireOnboardingActivations(member, {
        plan: onbSub.metadata.plan, term: onbSub.metadata.term, sb, writeAudit,
      });
    } catch (e) {
      activations = { error: String((e && e.message) || e) };
    }
  }

  let onboardingEnroll = silent ? { skipped: "import_silent" } : null;
  if (!silent) {
    try {
      const cId = (activations && activations.ghl && activations.ghl.contact_id) || member.ghl_contact_id || null;
      if (cId && await isAutomationLive(member.client_id, "onboarding")) {
        onboardingEnroll = await enrollContact({ clientId: member.client_id, automationKey: "onboarding", contactId: cId });
      } else {
        onboardingEnroll = { skipped: cId ? "onboarding automation not live" : "no ghl contact id" };
      }
    } catch (e) {
      onboardingEnroll = { ok: false, error: String((e && e.message) || e) };
    }
  }

  const conversionContactId =
    (activations && activations.ghl && activations.ghl.contact_id) ||
    member.ghl_contact_id ||
    (onbSub.metadata && onbSub.metadata.ghl_contact_id) ||
    null;
  let salesExit = null;
  try {
    salesExit = conversionContactId
      ? await exitEnrollment({ clientId: member.client_id, contactId: conversionContactId, reason: "converted" })
      : { skipped: "no ghl contact id" };
  } catch (e) {
    salesExit = { ok: false, error: String((e && e.message) || e) };
  }

  // Signup sweep: cancel every pending/approved agent-scheduled message (booking,
  // confirm, closing follow-up plan) + any parked reignition for this contact. THIS
  // is the fix for the returning-enroll "silent" path too: it skips the won-mark
  // (markOpportunityWon is guarded by !silent), so the detector's left-stage prune
  // never fires and the closing cards previously lingered until a cron or a reply
  // cleared them. Its own try block, independent of the drip-exit. Portal-native; V1 safe.
  let salesSweep = null;
  try {
    salesSweep = conversionContactId
      ? await cancelAllSalesOutbound({ clientId: member.client_id, contactId: conversionContactId, sendError: "lead signed up" })
      : { skipped: "no ghl contact id" };
  } catch (e) {
    salesSweep = { ok: false, error: String((e && e.message) || e) };
  }

  let commitmentSchedule = null;
  try {
    commitmentSchedule = await maybeAttachCommitmentSchedule({ subId, onbSub, connectedAccount });
  } catch (e) {
    commitmentSchedule = { error: String((e && e.message) || e) };
  }

  let staffNotify = silent ? { skipped: "import_silent" } : null;
  if (!silent) {
    try {
      const cRows = await sb(`clients?id=eq.${member.client_id}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
      const client = Array.isArray(cRows) && cRows[0];
      const amt = inv.amount_paid != null ? `$${(inv.amount_paid / 100).toFixed(2)}` : "-";
      if (client) {
        const signupMsg = `🎉 New signup - ${client.business_name || "academy"}\n`
          + `Athlete: ${member.athlete_name || "-"}\n`
          + `Parent: ${member.parent_name || "-"}${member.parent_email ? " · " + member.parent_email : ""}${member.parent_phone ? " · " + member.parent_phone : ""}\n`
          + `Plan: ${onbSub.metadata.plan || "-"} · ${onbSub.metadata.term || "-"}\n`
          + `Paid: ${amt} · status LIVE`;
        // Owner/staff SMS is the V2 notification_prefs system ONLY. Each academy
        // picks who receives each event (new_signup, stripe_payment) and the text
        // is sent FROM their own GHL number, via notifyOwners().
        //
        // The legacy single-number path was REMOVED 2026-07-12. It sent to a
        // per-client staff_notify_phone, else fell back to a central
        // STAFF_NOTIFY_PHONE env catch-all — which (a) double-fired alongside V2
        // for any academy set up on both (this double-texted BAM GTA), and
        // (b) blasted EVERY academy's enrollments to one central BAM number that
        // nobody wanted. notifyOwners() is non-throwing, so awaiting new_signup
        // gives us a real audit record; stripe_payment stays fire-and-forget.
        staffNotify = await notifyOwners(member.client_id, "new_signup", signupMsg);
        notifyOwners(member.client_id, "stripe_payment",
          `💳 New payment: ${member.athlete_name || member.parent_name || "a member"} - ${amt}`).catch(() => {});
      } else {
        staffNotify = { ok: false, error: "client row not found" };
      }
    } catch (e) {
      staffNotify = { ok: false, error: String((e && e.message) || e) };
    }
  }

  await writeAudit({
    client_id: member.client_id, member_id: member.id,
    action_type: silent ? "import-activated-silent" : "onboarding-activated",
    args: { invoice_id: inv.id, sub_id: subId, plan: onbSub.metadata.plan, term: onbSub.metadata.term, silent, activations, onboarding_enroll: onboardingEnroll, sales_exit: salesExit, sales_sweep: salesSweep, staff_notify: staffNotify, commitment_schedule: commitmentSchedule, pipeline_won: pipelineWon },
    db_changes: { members: { status: { from: "payment_method_required", to: "live" } } },
  });

  return { ok: true, action: silent ? "import-activated-silent" : "onboarding-activated", member_id: member.id, activations, onboarding_enroll: onboardingEnroll, sales_exit: salesExit, sales_sweep: salesSweep, staff_notify: staffNotify, commitment_schedule: commitmentSchedule, pipeline_won: pipelineWon };
}

async function handleInvoiceSucceeded(event, connectedAccount, res) {
  const inv = event.data && event.data.object;
  if (!inv) return res.status(200).json({ skipped: "no invoice" });
  const subId  = invoiceSubId(inv);
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
    let onbSub = null, subFetchErr = null;
    try { onbSub = await stripeFetch(`/subscriptions/${subId}`, connectedAccount); }
    catch (e) { onbSub = null; subFetchErr = String((e && e.message) || e); }
    if (onbSub && onbSub.metadata && isPortalOwnedOrigin(onbSub.metadata.origin)) {
      // The parent just paid on the funnel → flip to live + fire all downstream
      // activations. Shared with the reconcile cron so both paths are identical.
      const out = await activatePortalOnboardingMember({ member, onbSub, inv, connectedAccount });
      // Phase 5 access sync: first paid invoice → identity spine + entitlement.
      const accessFail = await accessSync(res, {
        clientId: member.client_id, memberId: member.id,
        reason: "invoice-paid", subscriptionId: subId, invoiceId: inv.id,
        offerPriceId: (onbSub.metadata && onbSub.metadata.offer_price_id) || null,
        stripePriceId:
          (onbSub.items && onbSub.items.data && onbSub.items.data[0] &&
           onbSub.items.data[0].price && onbSub.items.data[0].price.id) ||
          invoiceLinePriceId(inv),
      });
      if (accessFail) return accessFail;
      const creditFail = await creditSync(res, { clientId: member.client_id, memberId: member.id, inv, subId, memberPriceId: member.stripe_price_id || null });
      if (creditFail) return creditFail;
      return res.status(200).json(out);
    }
    // A paid member we could NOT activate inline (the subscription fetch failed, e.g.
    // a Stripe key-scope regression). Record it LOUDLY instead of silently returning —
    // this is exactly how signups fell into a black hole before. The reconcile cron
    // (api/stripe/reconcile-activations.js) picks these up and completes activation.
    if (subFetchErr) {
      await writeAudit({
        client_id: member.client_id, member_id: member.id,
        action_type: "onboarding-activation-deferred",
        args: { sub_id: subId, invoice_id: inv.id, error: subFetchErr,
                note: "invoice.paid received but subscription fetch failed; reconcile cron will retry" },
      }).catch(() => {});
      console.warn(`[webhook] onboarding activation DEFERRED for member ${member.id}: sub fetch failed (${subFetchErr}). Reconcile cron will retry.`);
    }
  }

  const RECOVERABLE = new Set(["payment_failed", "paused"]);
  if (!RECOVERABLE.has(member.status)) {
    // Renewal invoice for an already-live member: nothing to recover, but the
    // typed-access layer (re)converges on EVERY paid invoice — access is
    // granted only after money moves, and renewals keep it current.
    if (member.status === "live") {
      const accessFail = await accessSync(res, {
        clientId: member.client_id, memberId: member.id,
        reason: "invoice-paid", subscriptionId: subId, invoiceId: inv.id,
        offerPriceId: invoiceSubMetadata(inv).offer_price_id || null,
        stripePriceId: invoiceLinePriceId(inv),
      });
      if (accessFail) return accessFail;
      const creditFail = await creditSync(res, { clientId: member.client_id, memberId: member.id, inv, subId, memberPriceId: member.stripe_price_id || null });
      if (creditFail) return creditFail;
    }
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

  // Phase 5 access sync: payment recovered → reactivate membership +
  // entitlement (the member row is live again; the sync mirrors it).
  const accessFail = await accessSync(res, {
    clientId: member.client_id, memberId: member.id,
    reason: "invoice-paid", subscriptionId: subId, invoiceId: inv.id,
    offerPriceId: invoiceSubMetadata(inv).offer_price_id || null,
    stripePriceId: invoiceLinePriceId(inv),
  });
  if (accessFail) return accessFail;
  const creditFail = await creditSync(res, { clientId: member.client_id, memberId: member.id, inv, subId, memberPriceId: member.stripe_price_id || null });
  if (creditFail) return creditFail;

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
// ── customer.created: keep the Stripe-contact link clean going forward ──────
// The staff-side Stripe Link-Up sweep handles history; this keeps NEW Stripe
// customers linked as they appear: a single exact-email contact match gets
// contacts.stripe_customer_id stamped, no match mints a contact
// (source='stripe-import'). Ambiguous cases are left for the next sweep -
// no review row is written from webhook context. Best-effort, always 200.
async function handleCustomerCreated(event, connectedAccount, res) {
  const cust = event.data && event.data.object;
  if (!cust || !cust.id) return res.status(200).json({ skipped: "no customer" });
  try {
    if (!connectedAccount) return res.status(200).json({ skipped: "platform-level customer" });
    const cRows = await sb(`clients?stripe_connect_account_id=eq.${encodeURIComponent(connectedAccount)}&select=id&limit=1`);
    const client = Array.isArray(cRows) && cRows[0];
    if (!client) return res.status(200).json({ skipped: "no client for connected account" });

    const email = String(cust.email || "").trim().toLowerCase();
    if (email) {
      const matches = await sb(
        `contacts?client_id=eq.${client.id}&email=eq.${encodeURIComponent(email)}&select=id,stripe_customer_id&limit=2`
      ) || [];
      if (matches.length === 1 && (!matches[0].stripe_customer_id || matches[0].stripe_customer_id === cust.id)) {
        await sb(`contacts?id=eq.${encodeURIComponent(matches[0].id)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ stripe_customer_id: cust.id, updated_at: nowIso() }),
        });
        return res.status(200).json({ ok: true, linked: matches[0].id });
      }
      if (matches.length > 1) return res.status(200).json({ skipped: "ambiguous email - next sweep reviews it" });
      if (matches.length === 1) return res.status(200).json({ skipped: "contact linked to another customer - next sweep reviews it" });
    }

    // No contact -> mint one so the person exists portal-side (needs email or phone).
    if (email || cust.phone) {
      const parts = String(cust.name || "").trim().split(/\s+/).filter(Boolean);
      const key = await resolveOrMintPortalContact(client.id, {
        name: cust.name || null,
        first_name: parts[0] || null,
        last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
        email: email || null,
        phone: cust.phone || null,
        stripe_customer_id: cust.id,
        source: "stripe-import",
      });
      return res.status(200).json({ ok: true, minted: key || null });
    }
    return res.status(200).json({ skipped: "no email/phone to link or mint" });
  } catch (e) {
    console.error("[webhook] customer.created link failed:", e && e.message);
    return res.status(200).json({ skipped: "link error (logged)" });
  }
}

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
