import { withSentryApiRoute } from "../_sentry.js";
import { notifyClientPush } from "../push/_send.js";
// Vercel Serverless Function — Stripe webhook (Connect + direct-key events)
//
// ONE dispatcher, TWO arrival paths:
//   no ?t= query param   the single platform-level Connect endpoint, exactly as
//                        it has always been: events for every OAuth-connected
//                        academy, verified against STRIPE_WEBHOOK_SECRET.
//   ?t=<token>           a DIRECT-KEY academy's own endpoint (registered on ITS
//                        Stripe account by api/stripe/ensure-academy-webhook.js).
//                        The token resolves a stripe_academy_webhooks row and the
//                        event is verified against THAT academy's whsec_ secret.
// There is NO fallback between the two paths: a token request never verifies
// against the platform secret, and a tokenless request never touches the token
// table.
//
// Keeps the portal's `members` table in sync with Stripe even when things
// change OUTSIDE the portal.
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
import { decryptSecret } from "../_stripe-direct-crypto.js";
import { CONNECT_ONLY_EVENTS } from "./ensure-academy-webhook.js";
import { stripeFetch as transportStripeFetch } from "../_stripe-transport.js";
import { fireOnboardingActivations } from "../onboarding/activations.js";
import { ghl } from "../ghl/_core.js";
import { findOpenOpp, setStatus } from "../agent/_store.js";
import { cancelAllSalesOutbound } from "../agent/_cancel-outbound.js";
import { recordKpiEvent } from "../_kpi.js";
import { notifyOwners } from "../_notify-owners.js";
import { enrollContact, exitEnrollment, isAutomationLive } from "../automations.js";
import { getClientGhlToken } from "../website/availability.js";
import { getAccessSyncMode, syncAccessForMember } from "../_runtime/access-sync.js";
import { buildCancellationSnapshot } from "../_runtime/cancellation-snapshot.js";
import { applyInvoiceCreditGrants } from "../_runtime/credit-engine.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import { resolveOrMintPortalContact } from "../_contacts.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

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

// Historical signature (every call site and the receipts module pass
// (path[, body], stripeAccount)) - but the body now routes through THE ONE SEAM,
// api/_stripe-transport.js. A Connect academy's account id resolves to the
// platform key + Stripe-Account header (what the inline fetch here always did);
// a direct-key academy's account id reverse-resolves to its own decrypted key
// with no header. Nothing in this file may ask which transport it got.
async function stripeFetch(path, stripeAccount) {
  return transportStripeFetch(path, { stripeAccount });
}

// ─── Tenant routing (Connect endpoint vs direct-key academy endpoints) ────────
// Runs BEFORE signature verification: the request itself decides which signing
// secret is even eligible. No ?t= token -> the platform Connect path, verified
// against STRIPE_WEBHOOK_SECRET exactly as before (no DB read, no async work on
// the way in). A ?t= token -> the academy whose stripe_academy_webhooks row
// carries that token, verified against ITS endpoint's whsec_ secret. An unknown
// token answers 401 and touches nothing - public endpoints get scanned, so no
// audit rows for strangers (log-only). NEVER a fallback between the two paths,
// in either direction.
function routingToken(req) {
  if (req.query && req.query.t != null && req.query.t !== "") return String(req.query.t);
  const url = String(req.url || "");
  const q = url.indexOf("?");
  if (q < 0) return null;
  return new URLSearchParams(url.slice(q + 1)).get("t") || null;
}

async function resolveTenantContext(req) {
  const token = routingToken(req);
  if (!token) {
    return { kind: "connect", secret: process.env.STRIPE_WEBHOOK_SECRET, clientId: null };
  }
  const rows = await sb(
    `stripe_academy_webhooks?token=eq.${encodeURIComponent(token)}&select=client_id,secret_enc&limit=1`
  );
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row || !row.secret_enc) return null; // caller answers 401 - no cross-path fallback, ever
  return { kind: "direct", secret: decryptSecret(row.secret_enc), clientId: row.client_id };
}

// The per-event tenant every handler receives instead of a bare account string.
//   kind      'connect' | 'direct'
//   clientId  the academy this event belongs to. Null is tolerated on connect
//             events whose account matches no client row - handlers SKIP those,
//             they never fall back to a global lookup.
//   account   event.account for connect; the client's stripe_connect_account_id
//             for direct (the resolver reverse-looks-up direct rows by account
//             id, so passing it through the existing helpers routes every call
//             to the academy's own key).
//   label     'connect:acct_x' | 'direct:<clientId>', for audit trails only.
async function buildTenant(routing, event) {
  let clientId = routing.clientId || null;
  let account = null;
  if (routing.kind === "connect") {
    account = event.account || null;
    if (account) {
      const rows = await sb(
        `clients?stripe_connect_account_id=eq.${encodeURIComponent(account)}&select=id&limit=1`
      );
      clientId = (Array.isArray(rows) && rows[0] && rows[0].id) || null;
    }
  } else {
    const rows = await sb(
      `clients?id=eq.${encodeURIComponent(clientId)}&select=stripe_connect_account_id&limit=1`
    );
    account = (Array.isArray(rows) && rows[0] && rows[0].stripe_connect_account_id) || null;
  }
  return {
    kind: routing.kind,
    clientId,
    account,
    label: routing.kind === "direct" ? `direct:${clientId}` : `connect:${account || "platform"}`,
    stripeFetch: (path) => stripeFetch(path, account),
    stripePost: (path, body) => stripePost(path, body, account),
  };
}

// ─── Parent receipts (api/_member-receipts.js) ────────────────────────────────
// DYNAMICALLY imported, behind a cache, and every failure is swallowed. That is
// not defensive habit - it is the difference between two outcomes:
//
//   a static `import { maybeSendPaymentReceipt } from "../_member-receipts.js"`
//   that throws at MODULE LOAD (a syntax error, a bad import inside it, a missing
//   export in something it pulls in) takes this whole file down. Every Stripe event
//   for every academy then 500s: no activations, no plan syncs, no cancellations
//   mirrored, no failed-payment flags. A receipt feature is not worth that risk.
//
//   this shape instead disables RECEIPTS and leaves the webhook exactly as it was.
//
// The same reasoning is why receiptsFor() never rethrows and why every exported
// function in the receipts module catches its own errors: a guard that can throw is
// not a guard, it is one more thing that can break the thing it was meant to protect.
let _receipts = null;
let _receiptsLoadFailed = false;
async function receiptsModule() {
  if (_receipts || _receiptsLoadFailed) return _receipts;
  try {
    _receipts = await import("../_member-receipts.js");
  } catch (e) {
    _receiptsLoadFailed = true;
    console.error("[webhook] receipts module failed to load - receipts are OFF, everything else is unaffected:", (e && e.message) || e);
  }
  return _receipts;
}

// Fire the parent's payment receipt. Non-fatal by construction: the module's own
// entry point never throws, and this wrapper catches anyway.
async function sendPaymentReceipt(member, inv, connectedAccount) {
  try {
    const mod = await receiptsModule();
    if (!mod || typeof mod.maybeSendPaymentReceipt !== "function") return { skipped: "receipts module unavailable" };
    const { sendOn } = await import("../_send.js");
    return await mod.maybeSendPaymentReceipt({ sb, sendOn, member, invoice: inv, stripeFetch, connectedAccount });
  } catch (e) {
    console.error("[webhook] receipt attempt failed (non-fatal):", (e && e.message) || e);
    return { error: String((e && e.message) || e).slice(0, 200) };
  }
}

// Same routing as stripeFetch above; the transport encodes the flat body the
// same way this helper always did.
async function stripePost(path, body, stripeAccount) {
  return transportStripeFetch(path, { method: "POST", body, stripeAccount });
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

// ─── Tenant-scoped row resolution ────────────────────────────────────────────
// Stripe ids (customer, subscription) are only unique PER Stripe account, and
// the object-keyed handlers below used to resolve members across every academy
// at once - a global lookup that stayed safe only while no two academies could
// ever share an id. With academy-owned accounts (direct keys) that assumption is
// dead, so every members/cancellations resolution is scoped to the event's
// tenant. MISS-PATH DISCIPLINE: when the scoped lookup finds nothing, the OLD
// unscoped query runs once as a PROBE (id + client_id only). A probe hit on
// another tenant means the old code would have written to that tenant's member -
// that is recorded loudly and processing SKIPS. Never a silent write to another
// tenant's member.
async function findTenantRow(tenant, event, table, filter, select = "*", extra = "") {
  const rows = await sb(
    `${table}?${filter}&client_id=eq.${encodeURIComponent(tenant.clientId)}&select=${select}${extra}&limit=1`
  );
  if (Array.isArray(rows) && rows[0]) return rows[0];
  const probe = await sb(`${table}?${filter}&select=id,client_id${extra}&limit=1`);
  const hit = Array.isArray(probe) && probe[0] ? probe[0] : null;
  if (hit && hit.client_id !== tenant.clientId) {
    await writeAudit({
      client_id:   tenant.clientId,
      action_type: "stripe-cross-tenant-member-mismatch",
      args: {
        member_id: hit.id, member_client_id: hit.client_id,
        tenant_client_id: tenant.clientId, event_id: event && event.id, table,
      },
    });
    return { crossTenant: true };
  }
  return null;
}

// A connect event whose account matches no client row: we cannot say whose data
// this is, so nothing may be resolved globally "to be helpful". Skip, on the
// record.
async function auditUnknownTenantSkip(tenant, event) {
  await writeAudit({
    action_type: "stripe-unknown-tenant-skip",
    args: {
      event_id: event && event.id, event_type: event && event.type,
      account: (tenant && tenant.account) || null,
    },
  });
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

  // Which tenant - and therefore which signing secret - BEFORE verification.
  const routing = await resolveTenantContext(req);
  if (!routing) {
    console.error("stripe webhook: unknown routing token");
    return res.status(401).json({ error: "unknown token" });
  }

  if (!verifyStripeSignature(rawBody, sig, routing.secret)) {
    return res.status(400).json({ error: "invalid signature" });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return res.status(400).json({ error: "invalid JSON" }); }

  const connectedAccount = event.account || null;

  let tenant = null;
  try {
    // An academy endpoint is never subscribed to Connect plumbing (see
    // CONNECT_ONLY_EVENTS in api/stripe/ensure-academy-webhook.js), so one
    // arriving WITH a token is forged or misrouted. Refused on the ROUTING,
    // before any tenant lookup: an academy's own signing secret must never be
    // able to reach the Connect-status writer.
    if (routing.kind === "direct" && CONNECT_ONLY_EVENTS.includes(event.type)) {
      return res.status(200).json({ skipped: "connect-only event on an academy endpoint" });
    }

    // The academy revoked our access in their own Stripe dashboard. THE ONLY
    // route to handleAccountDeauthorized, which is THE ONLY writer of
    // stripe_connect_status='disabled' - and it dispatches BEFORE buildTenant,
    // deliberately: the handler never uses the tenant, and buildTenant's clients
    // read would otherwise be a third database read on this path whose failure
    // rides into the catch below, which acks 200 and makes Stripe drop a REAL
    // revocation forever. On the revocation path every database read either
    // answers or becomes a 500 retry (deauthGuardedRead) - deferred, never
    // dropped. account.updated is deliberately not routed here - see the block
    // above the handler for why the two are not the same change.
    if (event.type === DEAUTHORIZED_EVENT) {
      return await handleAccountDeauthorized(event, connectedAccount, res);
    }

    tenant = await buildTenant(routing, event);

    switch (event.type) {
      case "customer.subscription.created": return await handleSubCreated(event, tenant, res);
      case "customer.subscription.deleted": return await handleSubDeleted(event, tenant, res);
      case "customer.subscription.updated": return await handleSubUpdated(event, tenant, res);
      case "invoice.payment_failed":        return await handleInvoiceFailed(event, tenant, res);
      case "invoice.payment_succeeded":     return await handleInvoiceSucceeded(event, tenant, res);
      case "invoice.paid":                  return await handleInvoiceSucceeded(event, tenant, res);
      case "payment_method.attached":       return await handlePaymentMethodAttached(event, tenant, res);
      case "charge.refunded":               return await handleChargeRefunded(event, tenant, res);
      case "customer.created":              return await handleCustomerCreated(event, tenant, res);
      case "price.created":                 return await handlePriceUpserted(event, tenant, res);
      case "price.updated":                 return await handlePriceUpserted(event, tenant, res);
      case "checkout.session.completed":    return await handleStoreOrder(event, tenant, res);
      default:                              return res.status(200).json({ skipped: event.type });
    }
  } catch (e) {
    // Return 200 so Stripe doesn't retry endlessly. Log for inspection, and leave
    // a best-effort audit trace naming the transport - a direct academy's failed
    // event would otherwise be invisible (nothing 4xxs, and nobody watches one
    // academy's endpoint logs).
    console.error("stripe webhook error:", event.type, e.message);
    await writeAudit({
      client_id:   (tenant && tenant.clientId) || null,
      action_type: "stripe-webhook-error",
      args: {
        event_id: event.id, event_type: event.type,
        transport: (tenant && tenant.label) || null,
        error: String((e && e.message) || e).slice(0, 300),
      },
    }).catch(() => {});
    return res.status(200).json({ error: e.message, event_type: event.type });
  }
}

// ─────────────────────────────────────────────────────────
// customer.subscription.created
// ─────────────────────────────────────────────────────────
// First payment / first sub. Match a pending member by parent email and
// link the Stripe IDs + flip to 'live'. Siblings (one parent → many
// athletes) handled FIFO: oldest pending member matches first sub.
async function handleSubCreated(event, tenant, res) {
  const sub = event.data && event.data.object;
  if (!sub) return res.status(200).json({ skipped: "no sub object" });
  // PORTAL-OWNED onboarding subs are created by api/onboarding/checkout.js as
  // `incomplete` and already carry their member's stripe_subscription_id. Do NOT
  // flip them to live here (payment isn't confirmed yet) — handleInvoiceSucceeded
  // activates them on the first paid invoice.
  if (sub.metadata && isPortalOwnedOrigin(sub.metadata.origin)) {
    return res.status(200).json({ skipped: "portal-owned sub — activated on first paid invoice" });
  }
  if (!tenant.clientId) {
    await auditUnknownTenantSkip(tenant, event);
    return res.status(200).json({ skipped: "no client for event account" });
  }
  const connectedAccount = tenant.account;
  const customerId = sub.customer;
  const customer = await stripeFetch(`/customers/${customerId}`, connectedAccount);
  const email = ((customer && customer.email) || "").toLowerCase().trim();
  if (!email) return res.status(200).json({ skipped: "no customer email" });

  const candidates = await sb(
    `members?status=eq.payment_method_required` +
    `&client_id=eq.${encodeURIComponent(tenant.clientId)}` +
    `&parent_email=eq.${encodeURIComponent(email)}` +
    `&stripe_subscription_id=is.null` +
    `&select=id,client_id,athlete_name,parent_email,ghl_contact_id,ghl_opportunity_id` +
    `&order=created_at.asc&limit=1`
  );
  const target = Array.isArray(candidates) && candidates[0];

  if (!target) {
    // Miss-path discipline: probe the OLD unscoped query once. A hit on another
    // academy is exactly the cross-tenant link the unscoped code would have
    // made - record it loudly and skip instead of linking.
    const probe = await sb(
      `members?status=eq.payment_method_required` +
      `&parent_email=eq.${encodeURIComponent(email)}` +
      `&stripe_subscription_id=is.null` +
      `&select=id,client_id&order=created_at.asc&limit=1`
    );
    const hit = Array.isArray(probe) && probe[0] ? probe[0] : null;
    if (hit && hit.client_id !== tenant.clientId) {
      await writeAudit({
        client_id:   tenant.clientId,
        action_type: "stripe-cross-tenant-member-mismatch",
        args: { member_id: hit.id, member_client_id: hit.client_id, tenant_client_id: tenant.clientId, event_id: event.id, table: "members" },
      });
      return res.status(200).json({ skipped: "cross-tenant member mismatch" });
    }
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
//
// ⛔ DELIBERATELY NO GOODBYE EMAIL HERE. Zoran ruled 2026-07-30: staff handles the
// conversation when somebody leaves. Do not add one.
//
// Same reasoning as the failed-payment note above, and the same reason it is
// written at the handler rather than in a doc: this is where an automated
// "sorry to see you go" would go, and it is the last message an academy would ever
// want a machine to write. The cancellation is recorded, the owner is notified, and
// a person picks it up from there.
async function handleSubDeleted(event, tenant, res) {
  const sub = event.data && event.data.object;
  if (!sub) return res.status(200).json({ skipped: "no sub object" });
  if (!tenant.clientId) {
    await auditUnknownTenantSkip(tenant, event);
    return res.status(200).json({ skipped: "no client for event account" });
  }
  const connectedAccount = tenant.account;

  const member = await findTenantRow(tenant, event, "members", `stripe_subscription_id=eq.${encodeURIComponent(sub.id)}`);
  if (member && member.crossTenant) return res.status(200).json({ skipped: "cross-tenant member mismatch" });
  if (!member) return res.status(200).json({ skipped: "no member with that sub_id" });

  // If a cancellations row was already created by the portal (e.g. period-end
  // cancel from actionCancel — member is currently 'cancelling'), don't insert
  // a duplicate. Otherwise insert one now (covers cancellations done directly
  // in the Stripe Dashboard, outside the portal).
  const existingCancel = await sb(
    `cancellations?member_id=eq.${member.id}&client_id=eq.${encodeURIComponent(tenant.clientId)}&type=eq.cancel&select=id&limit=1`
  );
  const cancellationAlreadyLogged = Array.isArray(existingCancel) && existingCancel.length > 0;
  if (!cancellationAlreadyLogged) {
    // Snapshot economics before the members row is deleted below. Stripe's
    // cancellation_details.reason distinguishes dunning auto-cancels
    // ("payment_failed") from requested ones - that's involuntary churn.
    const snapshot = await buildCancellationSnapshot({
      member, sb,
      stripeFetch: (path, opts) => stripeFetch(path, opts && opts.stripeAccount),
      stripeAccount: connectedAccount,
    });
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
        ...snapshot,
        source:                 "stripe",
        involuntary:            sub?.cancellation_details?.reason === "payment_failed",
      }]),
    }).catch((e) => {
      // 409 = the partial unique index caught a race with the portal insert.
      if (!/409|duplicate|unique/i.test(e.message || "")) throw e;
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
async function handleSubUpdated(event, tenant, res) {
  const sub = event.data && event.data.object;
  if (!sub) return res.status(200).json({ skipped: "no sub object" });
  const newPriceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
  if (!newPriceId) return res.status(200).json({ skipped: "no price on sub" });
  const newPlan = PRICE_TO_PLAN[newPriceId];
  if (!newPlan) return res.status(200).json({ skipped: "price not in canonical map", price: newPriceId });

  if (!tenant.clientId) {
    await auditUnknownTenantSkip(tenant, event);
    return res.status(200).json({ skipped: "no client for event account" });
  }
  const member = await findTenantRow(tenant, event, "members", `stripe_subscription_id=eq.${encodeURIComponent(sub.id)}`, "id,plan,client_id,athlete_name");
  if (member && member.crossTenant) return res.status(200).json({ skipped: "cross-tenant member mismatch" });
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
//
// ⛔ DELIBERATELY NO PARENT-FACING EMAIL HERE. Zoran ruled 2026-07-30: staff chase
// a failed payment personally, with the payment link. Do not add one.
//
// This is a decision, not an oversight, and it is written here because this is
// exactly where somebody building out the receipt system would reach for the
// obvious next email ("your payment didn't go through"). The academy already gets
// told - notifyOwners('payment_failure') and the owner's push, both below - and a
// human then decides how to have that conversation. An automated dunning email
// would arrive before the human does and set the wrong tone for the exact moment
// the relationship is most fragile.
async function handleInvoiceFailed(event, tenant, res) {
  const inv = event.data && event.data.object;
  if (!inv) return res.status(200).json({ skipped: "no invoice" });
  const subId  = invoiceSubId(inv);
  const custId = inv.customer;

  let member = null, mismatch = false;
  if (!tenant.clientId) {
    await auditUnknownTenantSkip(tenant, event);
  } else {
    if (subId) {
      const f = await findTenantRow(tenant, event, "members", `stripe_subscription_id=eq.${encodeURIComponent(subId)}`);
      if (f && f.crossTenant) mismatch = true; else member = f;
    }
    if (!member && !mismatch && custId) {
      const f = await findTenantRow(tenant, event, "members", `stripe_customer_id=eq.${encodeURIComponent(custId)}`);
      if (f && f.crossTenant) mismatch = true; else member = f;
    }
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

async function handleInvoiceSucceeded(event, tenant, res) {
  const inv = event.data && event.data.object;
  if (!inv) return res.status(200).json({ skipped: "no invoice" });
  const connectedAccount = tenant.account;
  const subId  = invoiceSubId(inv);
  const custId = inv.customer;

  let member = null, mismatch = false;
  if (!tenant.clientId) {
    await auditUnknownTenantSkip(tenant, event);
  } else {
    if (subId) {
      const f = await findTenantRow(tenant, event, "members", `stripe_subscription_id=eq.${encodeURIComponent(subId)}`);
      if (f && f.crossTenant) mismatch = true; else member = f;
    }
    if (!member && !mismatch && custId) {
      const f = await findTenantRow(tenant, event, "members", `stripe_customer_id=eq.${encodeURIComponent(custId)}`);
      if (f && f.crossTenant) mismatch = true; else member = f;
    }
  }
  if (!member) return res.status(200).json({ skipped: "no member match for invoice" });

  // ══ THE PARENT'S RECEIPT ══════════════════════════════════════════════════
  // Money moved and we know whose it was. Everything below this line is about
  // what STATE the member should now be in (activate / recover from a failed
  // payment / re-converge access); none of it changes what the receipt says, so
  // the receipt is issued here.
  //
  // WHY HERE AND NOT AFTER THE LAST `return`. handleInvoiceSucceeded has six
  // terminal paths and every one of them ENDS by writing the HTTP response. On
  // Vercel the invocation can be frozen once the response is sent, so work
  // awaited after a `res.json()` is work that may simply not happen - a receipt
  // system that silently drops receipts under load is worse than none. This is
  // the single point every completing path passes through while the response is
  // still ahead of us, which buys the same coverage with none of that risk. The
  // one path it does not cover is "no member matched", which has nobody to send
  // a receipt to.
  //
  // THE DOUBLE-FIRE. Stripe sends BOTH invoice.payment_succeeded AND
  // invoice.paid for one payment (see the dispatch above - both map here), so
  // this line runs TWICE, milliseconds apart, for every single payment. That is
  // fine and it is designed for: the receipt row's unique partial index on
  // (client_id, stripe_invoice_id) WHERE kind='payment' rejects the second
  // insert, the module reads the 23505 and returns "already receipted" without
  // sending. The guard is in Postgres, not in a read up here that would lose the
  // race about half the time.
  //
  // Awaited (so a slow Resend cannot outlive the invocation) but never fatal:
  // maybeSendPaymentReceipt catches everything and sendPaymentReceipt catches
  // again. An academy with receipt_mode NULL - which is every academy until the
  // data migration runs - does nothing at all, and a V1 academy is refused
  // before any read.
  await sendPaymentReceipt(member, inv, connectedAccount);

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
async function handlePaymentMethodAttached(event, tenant, res) {
  const pm = event.data && event.data.object;
  if (!pm) return res.status(200).json({ skipped: "no payment_method" });
  const custId = pm.customer;
  if (!custId) return res.status(200).json({ skipped: "no customer on payment_method" });
  if (!tenant.clientId) {
    await auditUnknownTenantSkip(tenant, event);
    return res.status(200).json({ skipped: "no client for event account" });
  }

  const member = await findTenantRow(tenant, event, "members", `stripe_customer_id=eq.${encodeURIComponent(custId)}`, "id,client_id");
  if (member && member.crossTenant) return res.status(200).json({ skipped: "cross-tenant member mismatch" });
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
async function handleChargeRefunded(event, tenant, res) {
  const charge = event.data && event.data.object;
  if (!charge) return res.status(200).json({ skipped: "no charge object" });
  const custId = charge.customer;
  if (!custId) return res.status(200).json({ skipped: "no customer on charge" });
  if (!tenant.clientId) {
    await auditUnknownTenantSkip(tenant, event);
    return res.status(200).json({ skipped: "no client for event account" });
  }

  let member = await findTenantRow(tenant, event, "members", `stripe_customer_id=eq.${encodeURIComponent(custId)}`);
  if (member && member.crossTenant) return res.status(200).json({ skipped: "cross-tenant member mismatch" });

  // Member may have been cancelled/deleted already. Try cancellations as
  // fallback so we still log a refund row for the historical relationship.
  if (!member) {
    const cRow = await findTenantRow(
      tenant, event, "cancellations",
      `stripe_customer_id=eq.${encodeURIComponent(custId)}`,
      "client_id,member_id,athlete_name,parent_name,stripe_subscription_id",
      "&order=created_at.desc"
    );
    if (cRow && cRow.crossTenant) return res.status(200).json({ skipped: "cross-tenant member mismatch" });
    const c = cRow;
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

// Every database read on the DEAUTHORIZED path goes through this. Returns
// { rows } on an answer or { failed: true } when the database could not be
// asked - and the caller then answers 500 so Stripe RETRIES. The query string
// is built at the call site, so this helper knows nothing about columns.
async function deauthGuardedRead(path) {
  try {
    return { rows: await sb(path) };
  } catch (e) {
    console.error("[webhook] deauthorized: lookup failed, asking Stripe to retry:", (e && e.message) || e);
    return { failed: true };
  }
}

// ─────────────────────────────────────────────────────────
// account.application.deauthorized
// ─────────────────────────────────────────────────────────
// An academy revoked BAM's access to its Stripe account (Settings > Connected
// applications > Disconnect, in their own dashboard). Every billing action the
// portal offers - pause, cancel, refund, change plan, payment link - stops working
// at that instant, because every one of them calls Stripe with a Stripe-Account
// header that is no longer authorised.
//
// WHAT THIS FIXES. The portal has always rendered a complete UI branch for
// clients.stripe_connect_status = 'disabled' ("Stripe access was revoked. Reconnect
// to resume billing actions.", public/client-portal.html), and NOTHING in the system
// could produce that state: no code wrote it and this webhook handled no account.*
// events, so a revoked academy stayed 'connected' forever and the first person to
// find out was a staff member watching a refund fail on a parent phone call.
//
// ⛔ THE FAIL DIRECTION IS THE WHOLE DESIGN, so read this before changing anything.
//
// Marking a WORKING academy disconnected is worse than the bug this fixes: it hides
// every billing action behind a "reconnect" wall and sends staff to re-do an OAuth
// flow that was never broken. A transient failure - a Supabase blip, a Stripe
// timeout, a webhook delivery Stripe gave up on - must therefore be incapable of
// producing this state.
//
// It is incapable BY CONSTRUCTION, in four ways that are all mechanically checkable
// and are checked by api/_stripe-deauthorization.test.mjs:
//
//   1. REVOKED_STATUS is the only occurrence of the string in this file, and it is
//      read in exactly one place - the PATCH below.
//   2. That PATCH lives in this function and nowhere else. This function is called
//      from exactly one place: the single guarded dispatch in handler() for this
//      one event type, which runs BEFORE any tenant lookup so no other read's
//      failure can sit between verification and this handler.
//   3. No catch block in this file writes stripe_connect_status. The top-level catch
//      in handler() logs and returns 200; it does not touch the database. So an
//      error on ANY path, including inside this function, leaves the status alone.
//   4. The function re-checks event.type itself, so even a mis-wired switch case
//      cannot route a different event into the write.
//
// A webhook Stripe never delivered runs no code at all, which is the fourth case and
// the one that needs no defending.
//
// ⛔ account.updated IS DELIBERATELY ABSENT, and this is not an oversight to tidy up.
// It fails in the OPPOSITE direction: it is the event you would use to auto-tick
// "your Stripe is ready", and getting that wrong marks an unfinished account as live
// rather than a live account as broken. The two need different evidence and
// different caution, and bundling them makes both harder to reason about. Whoever
// picks up account.updated should do it as its own change, with its own test.
//
// ROUTING. This arrives at the PLATFORM endpoint (one Connect endpoint receives
// events for every connected academy - see api/stripe/ensure-webhook-events.js), and
// the academy is identified by the top-level `event.account`, NOT by
// event.data.object: for this event data.object is the platform's APPLICATION object
// (ca_...), which is the same value for every academy. Using it would resolve every
// revocation to the same wrong row, or to none.
const DEAUTHORIZED_EVENT = "account.application.deauthorized";
// The ONLY place this status value is written in the portal. See point 1 above.
const REVOKED_STATUS = "disabled";

async function handleAccountDeauthorized(event, connectedAccount, res) {
  // Point 4: the write is gated on the event type here, not only at the switch.
  if (!event || event.type !== DEAUTHORIZED_EVENT) {
    return res.status(200).json({ skipped: `not ${DEAUTHORIZED_EVENT}` });
  }
  // `event.account`, threaded in by the dispatcher. Never data.object - see ROUTING.
  const acct = connectedAccount || null;
  if (!acct) return res.status(200).json({ skipped: "no connected account on the event" });

  // ⛔ THE ONE DELIBERATE EXCEPTION to this file's swallow-to-200 pattern, applied
  // to BOTH reads on this path (this lookup and the direct-key guard below). A
  // failed read here cannot tell "unknown academy" from "database down", and a
  // 200 ack makes Stripe mark the revocation delivered and never retry. 500 =
  // retry: the handler is idempotent (a replay that finds the flip already done
  // skips without a second write), and the fail direction is preserved - a blip
  // still never flips anybody, it only defers the decision until the database
  // answers.
  const looked = await deauthGuardedRead(
    `clients?stripe_connect_account_id=eq.${encodeURIComponent(acct)}` +
    `&select=id,business_name,stripe_connect_status&limit=1`
  );
  if (looked.failed) {
    return res.status(500).json({ error: "academy lookup failed - retry" });
  }
  const rows = looked.rows;
  const client = Array.isArray(rows) && rows[0];
  // An account we do not know: another integration on the same platform, an academy
  // that was already re-pointed at a different Stripe account, or a replay of an old
  // event. Nothing to do, and nothing to raise about it.
  if (!client) return res.status(200).json({ skipped: "no academy with that connected account" });

  // DIRECT-KEY ACADEMIES ARE NOT DISCONNECTED BY A CONNECT REVOCATION. An academy
  // running on its own restricted key (client_stripe_direct, status active) may
  // still have a stale Connect OAuth link from before the key entry; the owner
  // revoking THAT tears down nothing the portal now uses - the key routes every
  // call. Flipping the status here would hide every billing action from an academy
  // whose transport is working perfectly. Skip, and leave a trace.
  // Same exception as the lookup above: a guard failure cannot tell a direct-key
  // academy (must NOT be flipped) from a Connect academy (MUST be flipped), so
  // it defers via 500 rather than guessing - or dropping.
  const guard = await deauthGuardedRead(
    `client_stripe_direct?client_id=eq.${client.id}&status=eq.active&select=client_id,status&limit=1`
  );
  if (guard.failed) {
    return res.status(500).json({ error: "direct-key guard lookup failed - retry" });
  }
  const directRows = guard.rows;
  if (Array.isArray(directRows) && directRows[0]) {
    await writeAudit({
      client_id:   client.id,
      member_id:   null,
      action_type: "stripe-access-revoked-skipped",
      args:        {
        event_id: event.id, event_type: event.type, connected_account: acct,
        note: "direct-key academy, stale OAuth revocation ignored",
      },
    });
    return res.status(200).json({ skipped: "direct-key academy, stale OAuth revocation ignored", client_id: client.id });
  }

  const prev = client.stripe_connect_status || null;
  if (prev === REVOKED_STATUS) {
    return res.status(200).json({ skipped: "already disabled", client_id: client.id });
  }

  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ stripe_connect_status: REVOKED_STATUS, updated_at: nowIso() }),
  });

  // TRACEABILITY. A status flip that hides every billing action must be explicable
  // afterwards - which event, which account, what it was before. The audit row is
  // academy-level (member_id null) because a revocation is not about one member, and
  // the console line is there because this is rare enough that nobody will be
  // watching an audit table when it happens.
  await writeAudit({
    client_id:   client.id,
    member_id:   null,
    action_type: "stripe-access-revoked",
    args:        {
      event_id: event.id, event_type: event.type, connected_account: acct,
      // The platform application the academy disconnected FROM (ca_...). Recorded
      // because a future second Connect app would make this the only way to tell
      // which integration was revoked.
      application_id: (event.data && event.data.object && event.data.object.id) || null,
    },
    db_changes:  { clients: { stripe_connect_status: { from: prev, to: REVOKED_STATUS } } },
  });
  console.warn(`[webhook] Stripe access REVOKED by ${client.business_name || client.id} (${acct}) - status ${prev} -> ${REVOKED_STATUS}. Billing actions are now blocked until they reconnect.`);

  return res.status(200).json({ ok: true, action: "stripe-access-revoked", client_id: client.id, from: prev, to: REVOKED_STATUS });
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
async function handleCustomerCreated(event, tenant, res) {
  const cust = event.data && event.data.object;
  if (!cust || !cust.id) return res.status(200).json({ skipped: "no customer" });
  try {
    if (!tenant.clientId) return res.status(200).json({ skipped: "no client for event - platform-level or unknown-account customer" });
    const cRows = await sb(`clients?id=eq.${encodeURIComponent(tenant.clientId)}&select=id&limit=1`);
    const client = Array.isArray(cRows) && cRows[0];
    if (!client) return res.status(200).json({ skipped: "no client row" });

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

async function handlePriceUpserted(event, tenant, res) {
  const price = event.data && event.data.object;
  if (!price) return res.status(200).json({ skipped: "no price object" });
  if (!tenant.clientId) {
    // An account-keyed event we cannot place. Keep the orphan trace when there
    // WAS an account (mirrors the old "no client for connected account" audit);
    // a platform-level price event stays a silent skip, as before.
    if (tenant.account) {
      await writeAudit({
        action_type: "stripe-price-upsert-orphan",
        args:        { event_id: event.id, connected_account: tenant.account, price_id: price.id },
      });
    }
    return res.status(200).json({ skipped: "no client for event account" });
  }

  const clientRows = await sb(
    `clients?id=eq.${encodeURIComponent(tenant.clientId)}&select=id&limit=1`
  );
  const client = Array.isArray(clientRows) && clientRows[0];
  if (!client) return res.status(200).json({ skipped: "no client row" });

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
    stripe_account_id: tenant.account,
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

// ─── Merch store order → GHL order workflow ───────────────────────────────────
// Academy merch stores (bam-client-sites) charge through the connected account via
// one-off Checkout Sessions stamped `metadata.client`. On completion we upsert the
// buyer as a GHL contact (order-detail custom fields + phone) and enroll them into
// the academy's configured order workflow (its steps run in GHL). No store-side
// webhook needed - this rides the existing Connect endpoint.
//
// Gated HARD so it can never touch subscription/member flows: only fires when the
// session carries `metadata.client` AND the matched client has
// `ghl_kpi_config.store_order_workflow_id`. Everything else returns skip. Always
// 200 + best-effort (a GHL hiccup never makes Stripe retry-storm).
async function handleStoreOrder(event, tenant, res) {
  const session = event.data && event.data.object;
  if (!session || !session.metadata || !session.metadata.client) return res.status(200).json({ skipped: "not a store order" });
  if (session.status && session.status !== "complete") return res.status(200).json({ skipped: `session ${session.status}` });
  if (!tenant.clientId) return res.status(200).json({ skipped: "no client for event" });
  const connectedAccount = tenant.account;

  const cRows = await sb(`clients?id=eq.${encodeURIComponent(tenant.clientId)}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
  const client = Array.isArray(cRows) && cRows[0];
  if (!client) return res.status(200).json({ skipped: "no client for account" });
  // Per-checkout workflow override (metadata.workflow_id) lets one client route
  // different products to different GHL workflows (e.g. Pro Precision: main
  // enrolments vs the online shooting program); else the client default.
  const workflowId = (session.metadata && session.metadata.workflow_id)
    || (client.ghl_kpi_config && client.ghl_kpi_config.store_order_workflow_id);
  if (!workflowId) return res.status(200).json({ skipped: "store order workflow not configured" });
  if (!client.ghl_location_id) return res.status(200).json({ skipped: "client not GHL-connected" });

  // The event payload omits line items + shipping rate name; re-fetch expanded.
  let full = session;
  try { full = await stripeFetch(`/checkout/sessions/${encodeURIComponent(session.id)}?expand[]=line_items&expand[]=shipping_cost.shipping_rate`, connectedAccount); } catch (_) {}
  const cd = full.customer_details || {};
  const email = cd.email ? String(cd.email).toLowerCase() : null;
  if (!email) return res.status(200).json({ skipped: "no buyer email" });
  const fullName = cd.name || "";
  const nameParts = fullName.split(" ").filter(Boolean);
  const firstName = nameParts[0] || fullName || "Customer";
  const lastName = nameParts.slice(1).join(" ");
  const phone = cd.phone || null;
  const addr = (full.shipping_details && full.shipping_details.address) || cd.address || {};
  const shipAddr = [addr.line1, addr.line2, [addr.city, addr.state].filter(Boolean).join(", "), addr.postal_code, addr.country].filter(Boolean).join(", ");
  const items = ((full.line_items && full.line_items.data) || []).map(li => `${li.quantity}x ${li.description}`).join("; ");
  const orderNo = `ELV-${String(session.id).replace(/^cs_(test_|live_)?/, "").slice(0, 8).toUpperCase()}`;
  const total = `$${((full.amount_total || 0) / 100).toFixed(2)}`;
  const orderDate = new Date((full.created || 0) * 1000).toISOString().slice(0, 10);
  const shipMethod = (full.shipping_cost && full.shipping_cost.shipping_rate && full.shipping_cost.shipping_rate.display_name)
    || (full.shipping_cost && full.shipping_cost.amount_total === 0 ? "Free shipping" : "Standard");
  const orderStatus = full.payment_status === "paid" ? "Paid" : (full.payment_status === "no_payment_required" ? "Comp" : (full.payment_status || "Unknown"));

  let token;
  try { token = await getClientGhlToken(client); }
  catch (e) { return res.status(200).json({ error: `no GHL token: ${(e && e.message) || e}` }); }
  const ghlHeaders = { Authorization: `Bearer ${token}`, Version: V2_VERSION, "Content-Type": "application/json", Accept: "application/json" };

  // GHL upsert takes custom fields by id → map fieldKey→id for this location.
  const cfIdByKey = {};
  try {
    const r = await fetch(`${GHL_V2}/locations/${client.ghl_location_id}/customFields`, { headers: ghlHeaders });
    if (r.ok) { const d = await r.json(); for (const f of (d.customFields || [])) cfIdByKey[f.fieldKey] = f.id; }
  } catch (_) {}
  // Same values under two naming schemes; only fields that EXIST on the location
  // are written (order_* for merch stores like Elevate, payment_* for
  // program/payment funnels like Pro Precision).
  const valueByKey = {
    "contact.order_number": orderNo,
    "contact.order_items": items,
    "contact.order_total": total,
    "contact.order_date": orderDate,
    "contact.order_shipping_method": shipMethod,
    "contact.order_shipping_address": shipAddr,
    "contact.order_status": orderStatus,
    "contact.payment_reference": orderNo,
    "contact.payment_program": items,
    "contact.payment_amount": total,
    "contact.payment_date": orderDate,
    "contact.payment_status": orderStatus,
  };
  const customFields = Object.entries(valueByKey)
    .filter(([k, v]) => cfIdByKey[k] && v)
    .map(([k, v]) => ({ id: cfIdByKey[k], field_value: String(v) }));

  const payload = {
    locationId: client.ghl_location_id,
    firstName,
    ...(lastName ? { lastName } : {}),
    email,
    ...(phone ? { phone } : {}),
    source: "merch-store",
    tags: ["merch-order"],
    ...(customFields.length ? { customFields } : {}),
  };
  const up = await fetch(`${GHL_V2}/contacts/upsert`, { method: "POST", headers: ghlHeaders, body: JSON.stringify(payload) });
  if (!up.ok) return res.status(200).json({ error: `ghl upsert ${up.status}: ${(await up.text()).slice(0, 150)}` });
  const contactId = ((await up.json()).contact || {}).id || null;
  if (!contactId) return res.status(200).json({ error: "no contactId from upsert" });

  // Enroll into the order workflow (idempotent enough - GHL de-dupes active runs).
  let enrolled = false;
  try {
    const wr = await fetch(`${GHL_V2}/contacts/${contactId}/workflow/${workflowId}`, {
      method: "POST", headers: ghlHeaders,
      body: JSON.stringify({ eventStartTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00") }),
    });
    enrolled = wr.ok;
    if (!wr.ok) console.error("store-order workflow enroll failed:", wr.status, (await wr.text()).slice(0, 150));
  } catch (e) { console.error("store-order workflow enroll error:", e.message); }

  return res.status(200).json({ ok: true, order: orderNo, contact_id: contactId, enrolled, workflow_id: workflowId });
}

export default withSentryApiRoute(handler);
