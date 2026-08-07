import { withSentryApiRoute } from "./_sentry.js";
import { loadVoiceConfig, startClickToCall, logCall } from "./twilio/_voice.js";
// Vercel Serverless Function — Members (academy roster + billing)
//
// Powers the client-portal "Members" tab. Ported from the BAM GTA
// member-management system (blueprint: /Users/zoransavic/BAM GTA/).
//
//   GET   /api/members?scope=client&client_id=<uuid>   → roster + stripe status
//   GET   /api/members?id=<member_uuid>                → one member + Stripe detail
//   PATCH /api/members?id=<member_uuid>  body: { action, ... }
//         actions: pause · unpause · cancel · refund · change ·
//                  payment-link · referred
//
// Auth uses the MULTI-USER model: a login's academies come from the
// client_users join table. The caller passes ?client_id= to pick an
// academy; staff may target any.
//
// All Stripe writes go through the academy's CONNECTED account via the
// platform key + `Stripe-Account: <clients.stripe_connect_account_id>`
// header. Conventions ported from `BAM GTA/memories/stripe-conventions.md`
// — trial_end pauses (never pause_collection), 720-day indefinite cap,
// canonical plan→price map, audit row per write.

import crypto from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { applyDiscountToCents, normCode, couponFromPromo } from "./_coupon-guardrails.js";
import { syncMemberAccessNonFatal } from "./_runtime/access-sync-portal.js";
import { buildCancellationSnapshot, stripeLifetimeSpend } from "./_runtime/cancellation-snapshot.js";
import { smsProvider } from "./messaging/provider.js";
import { emailProvider } from "./messaging/email-provider.js";
import { readStripeAccount } from "./stripe/_requirements.js";
import { stripeFetch as transportStripeFetch } from "./_stripe-transport.js";
import { announceActionItem } from "./action-items.js";
import {
  todayIso as ocToday, isDateStr as ocIsDate, addDays as ocAddDays,
  periodsDueAsOf, isOverdue, settleCollection, validateMethod, cadenceLabel,
  collectItemTitle, collectItemDescription, money as ocMoney,
  systemKeyForCollection, stopBillingItem, COLLECTION_METHODS,
} from "./_off-card.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

// ─────────────────────────────────────────────────────────
// Canonical GTA plan → Stripe price map
// ─────────────────────────────────────────────────────────
// Source: BAM GTA/memories/plans-and-pricing.md (locked 2026-05-15).
// Only these four 4-week recurring prices are valid `change` routing
// targets in v1. Everything else (one-time prepay, lil-sale, legacy) is
// frozen to its current holder.

// Subs the portal CREATED (so Stripe lets us pause/cancel/change them). Foreign
// subs (CoachIQ/GHL/dashboard) reject every write — the popup greys those actions.
// One standard portal-owned marker = metadata.origin in this set (matches webhook.js).
// setup-monthly subs now also stamp origin=fullcontrol-portal (no more divergent 'source').
// fullcontrol-import = a pre-existing sub ADOPTED at member-import promote time
// (sorter/cleanup.js tryAdoptSub) - the portal manages it from that point on.
const PORTAL_OWNED_ORIGINS = new Set(["fullcontrol-portal", "fullcontrol-website-enrollment", "fullcontrol-import"]);

const PLAN_TO_PRICE = {
  "1/wk":   "plan_ToNwa96lQ5I1Bs",   // Steady       $226 / 4-wk all-in
  "2/wk":   "plan_ThYK86w2Zd8fp3",   // Accelerated  $316 / 4-wk all-in
  "3/wk":   "plan_U3CUUJkzgyTjel",   // Elevate      $378 / 4-wk all-in
  "unlmtd": "plan_U3CFSoR1LdyGlb",   // Dominate     $638 / 4-wk all-in
};
const VALID_PLANS = Object.keys(PLAN_TO_PRICE);

// Stripe's hard trial_end cap is 730 days from now; we use 729 as a 1-day
// buffer for safety. Used by both actionPause and the cron — kept here
// (not inline) so the cap is consistent across the system.
const STRIPE_TRIAL_MAX_SECS = 729 * 86400;

// Stripe API 2025-03-31 moved `current_period_end` from the subscription
// object to the subscription_item. Older API versions kept it at the
// subscription level. We read from both so the code works regardless of
// which API version the platform account is on.
function subCurrentPeriodEnd(sub) {
  if (!sub) return null;
  if (sub.current_period_end) return sub.current_period_end;
  const item = sub.items?.data?.[0];
  return item?.current_period_end || null;
}

// ─────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}
function nowUnix() {
  return Math.floor(Date.now() / 1000);
}
function isoToUnix(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}
function unixToDateStr(unix) {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}
function newRowOperationId() {
  return crypto.randomUUID();
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

async function resolveUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };

  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role,email,user_id`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email,user_id`);
  }
  const staffRow = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id,role`
  );
  const clientIds = Array.isArray(memberships)
    ? [...new Set(memberships.map(m => m.client_id).filter(Boolean))]
    : [];
  let clients = [];
  if (clientIds.length) {
    clients = await sb(
      `clients?id=in.(${clientIds.join(",")})&select=id,business_name,stripe_connect_account_id,stripe_connect_status,ghl_location_id,ghl_connect_status`
    ) || [];
  }

  return { user, staff: staffRow, clients, memberships: memberships || [] };
}

// ─────────────────────────────────────────────────────────
// Stripe helper — platform key + connected-account header
// ─────────────────────────────────────────────────────────

async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  // Delegates to THE seam (api/_stripe-transport.js): platform key + Stripe-Account
  // header for Connect academies, the academy's own key when a direct row exists.
  // Pre-encoded STRING bodies pass through as-is (this file builds some by hand),
  // and the thrown error keeps message/stripeStatus/stripeResponse.
  return transportStripeFetch(path, { method, body, stripeAccount, idempotencyKey });
}

// ─────────────────────────────────────────────────────────
// Audit helper
// ─────────────────────────────────────────────────────────

// ─── Parent receipts (api/_member-receipts.js) ────────────────────────────────
// Same shape, and the same reasoning, as the loader in api/stripe/webhook.js:
// DYNAMIC import behind a cache, every failure swallowed. A module-load error here
// must not be able to break `refund` - a staff member issuing a refund and getting
// a 500 after Stripe already moved the money is a far worse outcome than a refund
// confirmation that did not go out. A guard that can throw is not a guard.
let _receipts = null;
let _receiptsLoadFailed = false;
async function receiptsModule() {
  if (_receipts || _receiptsLoadFailed) return _receipts;
  try {
    _receipts = await import("./_member-receipts.js");
  } catch (e) {
    _receiptsLoadFailed = true;
    console.error("[members] receipts module failed to load - receipts are OFF, billing actions are unaffected:", (e && e.message) || e);
  }
  return _receipts;
}
async function receiptsCall(fn, args) {
  try {
    const mod = await receiptsModule();
    if (!mod || typeof mod[fn] !== "function") return { skipped: "receipts module unavailable" };
    const { sendOn } = await import("./_send.js");
    return await mod[fn]({ sb, sendOn, ...args });
  } catch (e) {
    console.error(`[members] receipts.${fn} failed (non-fatal):`, (e && e.message) || e);
    return { error: String((e && e.message) || e).slice(0, 200) };
  }
}

async function writeAudit({ client_id, member_id, action_type, args, performed_by, performed_by_name, stripe_response, db_changes }) {
  try {
    await sb("member_audit_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id,
        member_id: member_id || null,
        action_type,
        args: args || null,
        performed_by: performed_by || null,
        performed_by_name: performed_by_name || null,
        stripe_response: stripe_response || null,
        db_changes: db_changes || null,
      }]),
    });
  } catch (e) {
    console.error("member_audit_log write failed:", e.message);
  }
}

// ─────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────

async function handler(req, res) {
  // ── Cron: scheduled-pause lifecycle (run hourly via vercel.json) ──
  // Uses bearer CRON_SECRET, runs BEFORE the user-auth resolver.
  if (req.query.action === "cron-process-scheduled-pauses") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const expected = process.env.CRON_SECRET;
    if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
    // Constant-time comparison to avoid timing leaks on the bearer secret.
    const gotBuf = Buffer.from(got);
    const expBuf = Buffer.from(expected);
    const ok = gotBuf.length === expBuf.length && timingSafeEqual(gotBuf, expBuf);
    if (!ok) return res.status(401).json({ error: "unauthorized" });
    return await cronProcessScheduledPauses(res);
  }

  // ── Cron: off-card collections - generate, then notify (daily via vercel.json) ──
  // Same shape as the pause cron above, deliberately: bearer CRON_SECRET,
  // constant-time compare, and it runs BEFORE the user-auth resolver because a
  // cron has no user. What it does and why each phase is ordered that way is
  // documented on cronCollectOffCard.
  if (req.query.action === "cron-collect-off-card") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const expected = process.env.CRON_SECRET;
    if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
    const gotBuf = Buffer.from(got);
    const expBuf = Buffer.from(expected);
    const ok = gotBuf.length === expBuf.length && timingSafeEqual(gotBuf, expBuf);
    if (!ok) return res.status(401).json({ error: "unauthorized" });
    try {
      return await cronCollectOffCard(res);
    } catch (e) {
      console.error("cron-collect-off-card error:", e?.message || e);
      return res.status(500).json({ error: e.message });
    }
  }

  let ctx;
  try {
    ctx = await resolveUser(req);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const isStaff = !!ctx.staff;
  const clients = Array.isArray(ctx.clients) ? ctx.clients : [];
  const isClient = clients.length > 0;
  if (!isStaff && !isClient) {
    return res.status(403).json({ error: "not authorized" });
  }

  const id = req.query.id || null;

  // Resolve which academy this request is scoped to.
  function resolveTargetClient() {
    const requested = req.query.client_id || null;
    if (requested) {
      if (isStaff || clients.some(c => c.id === requested)) return requested;
      return null;
    }
    return clients.length ? clients[0].id : null;
  }

  // For PATCH: load the academy's client row (including connect fields) when
  // we have the target client_id. For staff acting on an academy they don't
  // belong to via client_users, we need to fetch the row.
  async function loadClientRow(targetClientId) {
    let row = clients.find(c => c.id === targetClientId);
    if (row) return row;
    if (!isStaff) return null;
    const rows = await sb(`clients?id=eq.${encodeURIComponent(targetClientId)}&select=id,business_name,stripe_connect_account_id,stripe_connect_status,ghl_location_id,ghl_connect_status`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // ════════════════════════════════════════════════════════
  // GET — list or single
  // ════════════════════════════════════════════════════════
  if (req.method === "GET") {
    try {
      // ─── Member activity log: every audited action for this client ───
      if (req.query.action === "audit-log") {
        const cid = (req.query.client_id || "").toString();
        if (!cid) return res.status(400).json({ error: "client_id required" });
        if (!isStaff && !clients.some((c) => c.id === cid)) {
          return res.status(403).json({ error: "not your client" });
        }
        const rows = await sb(`member_audit_log?client_id=eq.${cid}&select=id,member_id,action_type,performed_by_name,created_at,args&order=created_at.desc&limit=500`);
        return res.status(200).json({ ok: true, log: Array.isArray(rows) ? rows : [] });
      }

      // ─── Receipts for one member: powers the drawer's Receipts list ───
      // Degrades to an empty list before the migration (listReceipts swallows the
      // missing-table error), so the drawer section simply does not render rather
      // than showing an error to an academy that has no receipts feature yet.
      if (req.query.action === "receipts") {
        const mid = (req.query.member_id || "").toString();
        if (!mid) return res.status(400).json({ error: "member_id required" });
        const mrows = await sb(`members?id=eq.${encodeURIComponent(mid)}&select=id,client_id&limit=1`);
        const m = Array.isArray(mrows) && mrows[0];
        if (!m) return res.status(404).json({ error: "member not found" });
        if (!isStaff && !clients.some((c) => c.id === m.client_id)) {
          return res.status(403).json({ error: "not your member" });
        }
        const receipts = await receiptsCall("listReceipts", { clientId: m.client_id, memberId: m.id });
        return res.status(200).json({ ok: true, receipts: Array.isArray(receipts) ? receipts : [] });
      }

      // ─── Off-card payments for one member: the arrangement + its collections.
      // Degrades to nulls before the migration (the catch below), so the drawer
      // section simply does not render for a database that has not got the tables
      // yet rather than showing an academy an error it cannot act on.
      if (req.query.action === "off-card") {
        const mid = (req.query.member_id || "").toString();
        if (!mid) return res.status(400).json({ error: "member_id required" });
        const mrows = await sb(`members?id=eq.${encodeURIComponent(mid)}&select=id,client_id&limit=1`);
        const m = Array.isArray(mrows) && mrows[0];
        if (!m) return res.status(404).json({ error: "member not found" });
        if (!isStaff && !clients.some((c) => c.id === m.client_id)) {
          return res.status(403).json({ error: "not your member" });
        }
        try {
          const arr = await sb(
            `member_billing_arrangements?member_id=eq.${encodeURIComponent(mid)}&select=*&order=created_at.desc&limit=1`
          );
          const arrangement = (Array.isArray(arr) && arr[0]) || null;
          // Collections are read by MEMBER, not by arrangement: an off-card ->
          // card -> off-card member has more than one arrangement and the money
          // he paid under the first one is still his payment history.
          const collections = await sb(
            `member_collections?member_id=eq.${encodeURIComponent(mid)}&select=*&order=due_date.desc&limit=100`
          );
          return res.status(200).json({
            ok: true,
            arrangement,
            cadence_label: arrangement ? cadenceLabel(arrangement) : null,
            collections: Array.isArray(collections) ? collections : [],
          });
        } catch (e) {
          if (/PGRST205|does not exist|42P01/i.test(String(e.message || ""))) {
            return res.status(200).json({ ok: true, arrangement: null, collections: [], not_migrated: true });
          }
          throw e;
        }
      }

      // ─── Cancellations feed: powers the members-focus KPI + Actions pages.
      // Cancelled members are DELETED from `members`, so churn/cancellation
      // counts must read this append-only table. Returns cancel + pause rows
      // for the client; the front end windows them by date.
      if (req.query.action === "cancellations") {
        const cid = (req.query.client_id || "").toString();
        if (!cid) return res.status(400).json({ error: "client_id required" });
        if (!isStaff && !clients.some((c) => c.id === cid)) {
          return res.status(403).json({ error: "not your client" });
        }
        const rows = await sb(
          `cancellations?client_id=eq.${cid}` +
          `&select=id,member_id,type,cancel_date,pause_start,pause_end,reason,reason_category,athlete_name,parent_name,stripe_subscription_id,activated_at,completed_at,created_at,joined_date,plan_name,stripe_price_id,offer_id,monthly_amount_cents,total_spent_cents,payments_count,source,involuntary` +
          `&order=created_at.desc&limit=1000`
        );
        return res.status(200).json({ ok: true, cancellations: Array.isArray(rows) ? rows : [] });
      }

      // ─── Spend sync: refresh members.total_spent_cents from Stripe ───
      // Powers the "active" side of the churned-vs-active comparison
      // (avg total spend). One paginated sweep of the connected account's
      // paid invoices, aggregated per customer. Idempotent; call when
      // spend_synced_at is stale.
      if (req.query.action === "spend-sync") {
        const cid = (req.query.client_id || "").toString();
        if (!cid) return res.status(400).json({ error: "client_id required" });
        if (!isStaff && !clients.some((c) => c.id === cid)) {
          return res.status(403).json({ error: "not your client" });
        }
        const client = await loadClientRow(cid);
        if (!client?.stripe_connect_account_id) {
          return res.status(200).json({ ok: false, reason: "no stripe account connected" });
        }
        const acct = client.stripe_connect_account_id;
        const byCustomer = new Map(); // customerId -> { cents, count }
        let startingAfter = null, scanned = 0;
        for (let page = 0; page < 10; page++) {
          const qs = `status=paid&limit=100` + (startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : "");
          const inv = await stripeFetch(`/invoices?${qs}`, { stripeAccount: acct });
          const data = (inv && Array.isArray(inv.data)) ? inv.data : [];
          for (const i of data) {
            scanned++;
            const cust = typeof i.customer === "string" ? i.customer : i.customer?.id;
            const paid = Number(i.amount_paid);
            if (!cust || !Number.isFinite(paid) || paid <= 0) continue;
            const e = byCustomer.get(cust) || { cents: 0, count: 0 };
            e.cents += paid; e.count++;
            byCustomer.set(cust, e);
          }
          if (!inv || !inv.has_more || !data.length) break;
          startingAfter = data[data.length - 1].id;
        }
        const membersRows = await sb(`members?client_id=eq.${cid}&select=id,stripe_customer_id`);
        const now = nowIso();
        let updated = 0;
        for (const m of (Array.isArray(membersRows) ? membersRows : [])) {
          const agg = m.stripe_customer_id ? byCustomer.get(m.stripe_customer_id) : null;
          await sb(`members?id=eq.${m.id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              total_spent_cents: agg ? agg.cents : 0,
              payments_count: agg ? agg.count : 0,
              spend_synced_at: now,
            }),
          }).catch(() => {});
          updated++;
        }
        return res.status(200).json({ ok: true, invoices_scanned: scanned, members_updated: updated });
      }

      // ─── Single member: returns DB row + Stripe detail (for popup) ─
      if (id) {
        const rows = await sb(`members?id=eq.${id}&select=*`);
        const member = Array.isArray(rows) && rows[0] ? rows[0] : null;
        if (!member) return res.status(404).json({ error: "member not found" });
        if (!isStaff && !clients.some(c => c.id === member.client_id)) {
          return res.status(403).json({ error: "not your member" });
        }

        const client = await loadClientRow(member.client_id);
        let stripe = null;
        if (client?.stripe_connect_account_id && member.stripe_subscription_id) {
          try {
            let sub;
            try {
              sub = await stripeFetch(
                `/subscriptions/${member.stripe_subscription_id}?expand[]=items.data.price.product&expand[]=latest_invoice&expand[]=discounts.promotion_code&expand[]=discounts.coupon`,
                { stripeAccount: client.stripe_connect_account_id }
              );
            } catch (_expandErr) {
              // Older API version that can't expand discounts → drop the coupon
              // expand so billing info never breaks (coupon chip just won't show).
              sub = await stripeFetch(
                `/subscriptions/${member.stripe_subscription_id}?expand[]=items.data.price.product&expand[]=latest_invoice`,
                { stripeAccount: client.stripe_connect_account_id }
              );
            }
            const item = sub.items?.data?.[0];
            // Active discount (coupon) on this sub, if any → drives the drawer's
            // "current coupon" chip + whether the Remove-coupon button shows.
            const disc = (Array.isArray(sub.discounts) ? sub.discounts[0] : null) || sub.discount || null;
            const discCp = disc && (typeof disc.coupon === "object" ? disc.coupon : null);
            const discCoupon = discCp ? {
              code: (disc.promotion_code && typeof disc.promotion_code === "object" ? disc.promotion_code.code : null)
                || discCp.name || discCp.id,
              label: discCp.percent_off != null ? `${discCp.percent_off}% off`
                : (discCp.amount_off != null ? `$${(discCp.amount_off / 100).toFixed(2)} off` : "discount"),
              duration: discCp.duration || null,
              duration_months: discCp.duration_in_months || null,
            } : null;
            // Can the portal manage this sub? Only subs IT created (Standard-account
            // rule). Drives which billing buttons are enabled vs greyed in the popup.
            const liveStatus = ["active", "trialing", "past_due", "unpaid", "paused"].includes(sub.status);
            const portalOwned = PORTAL_OWNED_ORIGINS.has(sub.metadata?.origin);
            stripe = {
              status: sub.status,
              trial_end: sub.trial_end,
              current_period_end: subCurrentPeriodEnd(sub),
              cancel_at_period_end: sub.cancel_at_period_end,
              created: sub.created || null,
              price_id: item?.price?.id || null,
              amount_cents: item?.price?.unit_amount || null,
              currency: (item?.price?.currency || "cad").toLowerCase(),
              interval: item?.price?.recurring?.interval || null,
              interval_count: item?.price?.recurring?.interval_count || null,
              latest_invoice_url: sub.latest_invoice?.hosted_invoice_url || null,
              application: sub.application || null,
              origin: sub.metadata?.origin || null,
              portal_owned: portalOwned,
              can_manage: liveStatus && portalOwned, // gate for pause/cancel/change/refund
              coupon: discCoupon, // active discount on the sub, or null
            };

            // Recent payment history - actual money movements (Stripe charges) for
            // this customer, NOT invoices. Invoices on a recreated/trial sub are
            // $0 placeholders; charges are the real payments ("$316.39 Succeeded").
            // Listed by customer so charges across the old + new sub both show.
            // Non-fatal: if it fails, the Billing section just omits the list.
            try {
              if (member.stripe_customer_id) {
                const ch = await stripeFetch(
                  `/charges?customer=${member.stripe_customer_id}&limit=6`,
                  { stripeAccount: client.stripe_connect_account_id }
                );
                stripe.payments = (ch?.data || []).map((c) => ({
                  date: c.created,
                  amount_cents: c.amount,
                  currency: (c.currency || "cad").toLowerCase(),
                  status: c.refunded ? "refunded" : c.status,   // succeeded | pending | failed | refunded
                  url: c.receipt_url || null,
                }));
              } else { stripe.payments = []; }
            } catch (_) { stripe.payments = []; }

            // Lazy backfill: if we just learned the sub's created date and
            // the column is empty, persist it. New signups via webhook get
            // populated up front; this fills in the legacy rows the first
            // time anyone opens their popup. Non-fatal on error.
            if (sub.created && !member.stripe_joined_at) {
              try {
                const iso = new Date(sub.created * 1000).toISOString();
                await sb(`members?id=eq.${id}`, {
                  method: "PATCH",
                  headers: { Prefer: "return=minimal" },
                  body: JSON.stringify({ stripe_joined_at: iso }),
                });
                member.stripe_joined_at = iso;
              } catch (_) { /* non-fatal */ }
            }

            // Lazy backfill the billing-ownership flag so the roster can badge
            // "imported / needs Set up billing" members without a Stripe call
            // per row. Same pattern as stripe_joined_at above. Non-fatal.
            if (member.billing_portal_owned !== portalOwned) {
              try {
                await sb(`members?id=eq.${id}`, {
                  method: "PATCH",
                  headers: { Prefer: "return=minimal" },
                  body: JSON.stringify({ billing_portal_owned: portalOwned }),
                });
                member.billing_portal_owned = portalOwned;
              } catch (_) { /* non-fatal */ }
            }
          } catch (e) {
            stripe = { error: e.message };
          }
        }

        // History — recent audit rows for this member
        const history = await sb(
          `member_audit_log?member_id=eq.${id}&select=action_type,args,performed_by_name,created_at&order=created_at.desc&limit=10`
        ).catch(() => []);

        // Calls — voice history (Twilio spine `calls` table), matched by portal
        // contact id or the parent's phone. Inbound rows store E.164 so we match
        // on the last 10 digits to survive formatting differences.
        let calls = [];
        const callOrs = [];
        if (member.ghl_contact_id) callOrs.push(`ghl_contact_id.eq.${encodeURIComponent(member.ghl_contact_id)}`);
        const phoneDigits = String(member.parent_phone || "").replace(/\D/g, "").slice(-10);
        if (phoneDigits.length === 10) callOrs.push(`contact_phone.like.*${phoneDigits}`);
        if (callOrs.length) {
          calls = await sb(
            `calls?client_id=eq.${member.client_id}&or=(${callOrs.join(",")})` +
            `&select=id,direction,status,duration_seconds,recording_url,voicemail_transcript,occurred_at,answered_by` +
            `&order=occurred_at.desc&limit=15`
          ).catch(() => []);
        }

        return res.status(200).json({ member, stripe, history, calls });
      }

      // ─── List ────────────────────────────────────────────────────
      // Sort options:
      //   ?sort=name              alphabetical by athlete_name (default)
      //   ?sort=joined_newest     newest joiners first (stripe date, fallback joined_date)
      //   ?sort=joined_oldest     oldest joiners first
      const sort = (req.query && req.query.sort) || "name";
      const orderBy = sort === "joined_newest" ? "stripe_joined_at.desc.nullslast"
                    : sort === "joined_oldest" ? "stripe_joined_at.asc.nullslast"
                    : "athlete_name.asc";

      let query;
      let targetClientId = null;
      if (isStaff && !req.query.client_id) {
        query = `members?select=*&order=${orderBy}`;
      } else {
        targetClientId = resolveTargetClient();
        if (!targetClientId) return res.status(403).json({ error: "no academy in scope" });
        query = `members?client_id=eq.${targetClientId}&select=*&order=${orderBy}`;
      }
      const members = await sb(query);
      // Pre-payment signup shells are NOT members: someone who started the enroll
      // form (or a staff pipeline-convert) but never paid stays a LEAD in the
      // pipeline. Hide those rows from every roster. 'collecting' (a real member
      // whose card is being re-collected) and legacy NULL origins stay visible.
      const HIDDEN_SIGNUP_ORIGINS = new Set(["website_enroll", "convert", "wizard"]);
      const memberList = (Array.isArray(members) ? members : []).filter(
        m => !(m.status === "payment_method_required" && HIDDEN_SIGNUP_ORIGINS.has(m.signup_origin))
      );

      // Enrich each member with their pricing_catalog row (for tier badge
      // + display_name on the roster card). Single batched query.
      if (memberList.length) {
        const clientIds = [...new Set(memberList.map(m => m.client_id).filter(Boolean))];
        const priceIds  = [...new Set(memberList.map(m => m.stripe_price_id).filter(Boolean))];
        if (clientIds.length && priceIds.length) {
          const catalogRows = await sb(
            `pricing_catalog?client_id=in.(${clientIds.join(",")})` +
            `&stripe_price_id=in.(${priceIds.map(encodeURIComponent).join(",")})` +
            `&select=client_id,stripe_price_id,tier,canonical_plan,display_name,amount_cents,interval`
          ).catch(() => []);
          const catalog = new Map(
            (Array.isArray(catalogRows) ? catalogRows : []).map(r => [`${r.client_id}|${r.stripe_price_id}`, r])
          );
          for (const m of memberList) {
            if (m.stripe_price_id) {
              const row = catalog.get(`${m.client_id}|${m.stripe_price_id}`);
              m.pricing = row ? {
                tier: row.tier,
                canonical_plan: row.canonical_plan,
                display_name: row.display_name,
                amount_cents: row.amount_cents,
                interval: row.interval,
              } : { tier: "uncatalogued" };
            }
          }
        }

        // Offer scoping (V2): attach each member's offer { id, title } so the
        // roster can show + filter by offer. offer_id is derived at import from
        // the member's Stripe price (pricing_catalog.offer_id).
        const offerIds = [...new Set(memberList.map(m => m.offer_id).filter(Boolean))];
        if (offerIds.length) {
          const offerRows = await sb(
            `offers?id=in.(${offerIds.join(",")})&select=id,title`
          ).catch(() => []);
          const offers = new Map((Array.isArray(offerRows) ? offerRows : []).map(o => [o.id, o.title]));
          for (const m of memberList) {
            if (m.offer_id) m.offer = { id: m.offer_id, title: offers.get(m.offer_id) || null };
          }
        }

        // Consent the family gave in their signed enrollment agreement. Attached
        // to every roster row so any surface that reaches for a member - member
        // card, marketing, content - can honor it without a second lookup.
        //
        // media_allowed is false ONLY when a parent explicitly declined, so a
        // member with no recorded choice is never treated as having opted out.
        // Non-fatal: an environment without the agreements migration just gets
        // no consent block.
        try {
          const consentRows = await sb(
            `member_consents?member_id=in.(${memberList.map(m => m.id).join(",")})` +
            `&select=member_id,consents,media_release,media_allowed,signed_at,version_id`
          );
          const byMember = new Map(
            (Array.isArray(consentRows) ? consentRows : []).map(r => [r.member_id, r])
          );
          for (const m of memberList) {
            const c = byMember.get(m.id);
            m.consents = c ? {
              all: c.consents || {},
              media_release: c.media_release || null,
              media_allowed: c.media_allowed !== false,
              signed_at: c.signed_at || null,
              agreement_version_id: c.version_id || null,
            } : null;
          }
        } catch { /* agreements not migrated here - roster works without it */ }
      }

      const targetClient = targetClientId ? await loadClientRow(targetClientId) : null;

      // Sorter progress for the Price Match dot (BB → Offers) + the Members
      // tab's import strip — non-fatal: a failure just renders not-done.
      // `matched` = FULL coverage: every plan×term in the offers has a LIVE
      // (canonical, confirmed) Stripe price — one partial match isn't green.
      let sorter = null;
      if (targetClientId) {
        const exists = (q) => sb(q).then(r => Array.isArray(r) && r.length > 0).catch(() => false);
        const matchedAll = (async () => {
          try {
            const offers = await sb(`offers?client_id=eq.${targetClientId}&status=neq.archived&select=data`);
            const HST = 1.13;
            const cents = (n) => Math.round(n * 100);
            const keys = []; // { key, base_cents, allin_cents }
            for (const o of (offers || [])) {
              for (const off of ((o.data && o.data.pricing && o.data.pricing.pricing_offerings) || [])) {
                if (off.archived) continue;
                if (String(off.type || "").toLowerCase() !== "membership") continue;
                const title = String(off.title || "").trim();
                if (!title) continue;
                const base = parseFloat(off.price);
                if (!isNaN(base)) keys.push({ key: `${title}|monthly`, base_cents: cents(base), allin_cents: cents(base * HST) });
                for (const c of (off.commitments || [])) {
                  // Mirror of _termFromLength in offers/match-prices.js (opened
                  // additively 2026-08-06: any whole 1-24 month count, weeks in
                  // whole-month multiples, years x12; 3/6 byte-identical).
                  const t = String(c.length || "").toLowerCase();
                  const tm = t.match(/(\d+)\s*month/);
                  const tw = t.match(/(\d+)\s*week/);
                  const ty = t.match(/(\d+)\s*(?:year|yr)/);
                  const months = tm ? +tm[1]
                    : (tw && +tw[1] % 4 === 0) ? +tw[1] / 4
                    : ty ? +ty[1] * 12
                    : /\bannual(?:ly)?\b|\byearly\b/.test(t) ? 12 : null;
                  const term = (months != null && months >= 1 && months <= 24) ? `${months}_months` : null;
                  const cb = parseFloat(c.price);
                  if (term && !isNaN(cb)) keys.push({ key: `${title}|${term}`, base_cents: cents(cb), allin_cents: cents(cb * HST) });
                }
              }
            }
            if (!keys.length) return false;
            const rows = await sb(
              `pricing_catalog?client_id=eq.${targetClientId}&tier=eq.canonical&match_status=eq.confirmed` +
              `&offer_price_key=not.is.null&select=offer_price_key,amount_cents`
            );
            const liveAmt = new Map((rows || []).map(r => [r.offer_price_key, r.amount_cents]));
            // Covered AND not drifted. "Matches" is TOLERANT (within 8% of the
            // pre-tax OR all-in price) — real Stripe prices are rounded to
            // clean dollars and academies use varying tax/fee structures, so
            // exact equality false-flagged everything. 8% still catches a
            // genuine offer-price change (which moves the target well beyond).
            const near = (amt, target) => target > 0 && Math.abs(amt - target) <= target * 0.08;
            return keys.every(k => {
              if (!liveAmt.has(k.key)) return false;
              const amt = liveAmt.get(k.key);
              return amt == null || near(amt, k.base_cents) || near(amt, k.allin_cents);
            });
          } catch (_) { return false; }
        })();
        // CoachIQ step is "done" when there's nothing left to triage: either the
        // academy isn't on CoachIQ, or every imported member has been linked /
        // marked not-applicable / flagged collecting (none left raw "waiting").
        const coachiqDone = (async () => {
          try {
            const cr = await sb(`clients?id=eq.${targetClientId}&select=coachiq_enabled&limit=1`);
            if (!(Array.isArray(cr) && cr[0] && cr[0].coachiq_enabled)) return true;
            const waiting = await sb(
              `members_staging?client_id=eq.${targetClientId}` +
              `&coachiq_member_id=is.null&coachiq_not_applicable=is.false&coachiq_collecting=is.false&select=id&limit=1`
            );
            return !(Array.isArray(waiting) && waiting.length > 0);
          } catch (_) { return false; }
        })();
        const [matched, imported, promoted, unlinked, coachiq_done] = await Promise.all([
          matchedAll,
          exists(`members_staging?client_id=eq.${targetClientId}&select=id&limit=1`),
          exists(`members_staging?client_id=eq.${targetClientId}&promoted=is.true&select=id&limit=1`),
          exists(`members?client_id=eq.${targetClientId}&ghl_contact_id=is.null&select=id&limit=1`),
          coachiqDone,
        ]);
        // ghl_linked = the roster exists and every member has a GHL contact.
        sorter = { matched, imported, promoted, coachiq_done, ghl_linked: memberList.length > 0 && !unlinked };
      }

      // Open "cancel old Stripe sub" action items — the import leaves these when it
      // replaces a foreign sub (portal can't cancel it). Surfaced as a banner so the
      // owner doesn't walk away with old subs still billing. Count drops as they're done.
      let subsToCancel = 0;
      if (targetClientId) {
        try {
          const rows = await sb(`action_items?client_id=eq.${encodeURIComponent(targetClientId)}&completed_at=is.null&title=ilike.*Cancel%20old%20Stripe%20sub*&select=id`);
          subsToCancel = Array.isArray(rows) ? rows.length : 0;
        } catch (_) { /* non-fatal */ }
      }

      // ── What Stripe is actually waiting on ────────────────────────────────
      // The Stripe card used to be able to say "there are still steps to finish
      // inside Stripe (business details, bank account, or ID verification)" and
      // those three were PROSE - a guess printed for every academy, whatever
      // their account actually needed. Stripe returns the real list in
      // requirements.currently_due and we were already throwing it away.
      //
      // Narrow on purpose, the same narrowness as backfillStripeWhenChargeable
      // in api/action-items.js: one Stripe call for an academy mid-setup, none
      // for a connected one and none for an academy that has never connected.
      // Non-fatal - if the call fails the card says so (`reachable:false`)
      // rather than inventing a reason, and the roster still renders.
      let stripeLive = null;
      if (targetClient?.stripe_connect_account_id && targetClient?.stripe_connect_status !== "connected") {
        try {
          const key = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
          const s = await readStripeAccount(targetClient.stripe_connect_account_id, key);
          stripeLive = {
            outcome: s.outcome,                 // ready | not_ready | unreachable
            reachable: s.reachable,
            checked_at: new Date().toISOString(),
            needs: s.needs,
            reviewing: s.reviewing,
            problems: s.problems,
            disabled_reason: s.disabled_reason,
          };
        } catch (_) { stripeLive = { outcome: "unreachable", reachable: false, checked_at: new Date().toISOString(), needs: [], reviewing: [], problems: [], disabled_reason: null }; }
      }

      // CoachIQ config (for the "Set up CoachIQ" member-card invite).
      let coachiq = { enabled: false, signup_url: null };
      if (targetClientId) {
        try {
          const cr = await sb(`clients?id=eq.${encodeURIComponent(targetClientId)}&select=coachiq_enabled,coachiq_signup_url&limit=1`);
          if (Array.isArray(cr) && cr[0]) coachiq = { enabled: !!cr[0].coachiq_enabled, signup_url: cr[0].coachiq_signup_url || null };
        } catch (_) { /* non-fatal */ }
      }

      return res.status(200).json({
        members: memberList,
        sorter,
        subs_to_cancel: subsToCancel,
        coachiq,
        stripe: {
          client_id: targetClientId,
          status: targetClient?.stripe_connect_status || "not_connected",
          account_id: targetClient?.stripe_connect_account_id || null,
          // null when we did not ask (never connected, or already connected).
          live: stripeLive,
        },
        ghl: {
          client_id:   targetClientId,
          status:      targetClient?.ghl_connect_status || (targetClient?.ghl_location_id ? "connected" : "not_connected"),
          location_id: targetClient?.ghl_location_id || null,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ════════════════════════════════════════════════════════
  // PATCH — billing actions
  // ════════════════════════════════════════════════════════
  if (req.method === "PATCH") {
    if (!id) return res.status(400).json({ error: "id required" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const action = body.action;
    if (!action) return res.status(400).json({ error: "action required" });

    // Load member
    const rows = await sb(`members?id=eq.${id}&select=*`);
    const member = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!member) return res.status(404).json({ error: "member not found" });
    if (!isStaff && !clients.some(c => c.id === member.client_id)) {
      return res.status(403).json({ error: "not your member" });
    }

    // Profile updates are pure DB writes — no Stripe needed. Handle them
    // BEFORE the Stripe-connection gate so the user can edit member info
    // (archetype, trainer, engagement, notes) even when Stripe isn't wired.
    if (action === "update-profile") {
      try {
        return await actionUpdateProfile(res, member, ctx, body);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── Off-card payments ────────────────────────────────────────────────────
    // Placed here, ABOVE the Stripe-connection gate, on purpose. An academy that
    // takes cash may have no Stripe account at all (San Jose today), and an
    // academy that has one may still have a member who pays another way. Making
    // "record how this parent pays cash" depend on a Stripe connection would put
    // the feature out of reach of exactly the academies that need it.
    if (action === "set-off-card" || action === "end-off-card" || action === "mark-collected") {
      try {
        if (action === "set-off-card")   return await actionSetOffCard(res, member, ctx, body);
        if (action === "end-off-card")   return await actionEndOffCard(res, member, ctx, body);
        return await actionMarkCollected(res, member, ctx, body);
      } catch (e) {
        // A missing table means the migrations have not been applied yet. Say so
        // in a sentence a human can act on rather than a PostgREST 404 body.
        if (/PGRST205|does not exist|42P01/i.test(String(e.message || ""))) {
          return res.status(503).json({
            error: "Off-card payments are not set up on this database yet - the migration 20260807T140000_off_card_billing.sql has not been applied.",
          });
        }
        return res.status(500).json({ error: e.message });
      }
    }

    // Resend a receipt the academy already issued. Pure DB read + email - it
    // re-renders from the stored row and never talks to Stripe - so it sits with
    // update-profile and call, BEFORE the Stripe-connection gate below. That is
    // deliberate rather than incidental: an academy that has disconnected Stripe
    // must still be able to hand a parent a copy of a receipt for money that was
    // taken while it was connected.
    if (action === "resend-receipt") {
      try {
        return await actionResendReceipt(res, member, ctx, body);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // Click-to-call: ring staff cell → bridge to this member. Uses Twilio voice
    // (not Stripe), so handle it before the Stripe-connection gate.
    if (action === "call") {
      try {
        return await actionCall(res, member, ctx);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // Load the academy's client row → connect account.
    // Three-outcome money gate (house rule 10): a clients read that THREW is
    // "could not ask", never "not connected" - it gets a retryable 503, and the
    // not-connected 400 below stays reserved for a row that actually answered.
    let client;
    try {
      client = await loadClientRow(member.client_id);
    } catch {
      return res.status(503).json({ error: "could not verify billing setup, try again" });
    }
    if (!client) return res.status(404).json({ error: "academy not found" });
    if (!client.stripe_connect_account_id || client.stripe_connect_status !== "connected") {
      return res.status(400).json({
        error: "Stripe not connected for this academy. Click 'Connect Stripe' on the Members tab first.",
      });
    }
    const stripeAccount = client.stripe_connect_account_id;
    // Stash the academy's client row on ctx so actions can read academy-level
    // config (ghl_location_id, business_name, etc) without re-querying.
    ctx.client = client;

    // Dispatch
    try {
      switch (action) {
        case "pause":         return await actionPause(res, member, stripeAccount, ctx, body);
        case "pause-date-fix": return await actionPauseDateFix(res, member, ctx, body);
        case "unpause":       return await actionUnpause(res, member, stripeAccount, ctx, body);
        case "cancel":        return await actionCancel(res, member, stripeAccount, ctx, body);
        case "refund":        return await actionRefund(res, member, stripeAccount, ctx, body);
        case "change":        return await actionChange(res, member, stripeAccount, ctx, body);
        case "apply-coupon":  return await actionApplyCoupon(res, member, stripeAccount, ctx, body);
        case "remove-coupon": return await actionRemoveCoupon(res, member, stripeAccount, ctx, body);
        case "payment-link":  return await actionPaymentLink(res, member, stripeAccount, ctx, body, req);
        case "card-setup-link": return await actionCardSetupLink(res, member, stripeAccount, ctx, body, req);
        case "referred":      return await actionReferred(res, member, stripeAccount, ctx, body);
        default:              return res.status(400).json({ error: `unknown action: ${action}` });
      }
    } catch (e) {
      // Surface Stripe error details to the client so the modal can show them.
      return res.status(e.stripeStatus || 500).json({
        error: e.message,
        details: e.stripeResponse || null,
      });
    }
  }

  return res.status(405).json({ error: "method not allowed" });
}

// ─────────────────────────────────────────────────────────
// Action: PAUSE
// ─────────────────────────────────────────────────────────
// body: { start_date: "YYYY-MM-DD", end_date: "YYYY-MM-DD", reason? }
//
// One mode: explicit start + end date. Pause length = end - start (days).
// Billing pause via Stripe trial_end, computed so the next charge is shifted
// out by exactly the pause length beyond the natural next-charge date:
//   trial_end = max(now, current_period_end) + pause_length_seconds
//
// Future-scheduled pauses (start_date > tomorrow) are queued in the
// `cancellations` table with activated_at=null and picked up by the
// hourly cron (cronProcessScheduledPauses) when start_date hits.
//
// Capped at Stripe's 730-day trial max. Rejects past-due / payment_failed /
// cancelling members. Rejects past end_date.
// ── PAUSE DATE FIX ──
// Record a pause (start/end dates) WITHOUT touching Stripe — for foreign/no-sub
// members, or to correct pause dates. DB-only: inserts a cancellations pause row +
// flips status to paused. No trial_end, no pause_collection.
async function actionPauseDateFix(res, member, ctx, body) {
  const { start_date, end_date } = body;
  if (!start_date || !end_date) return res.status(400).json({ error: "start_date and end_date required (YYYY-MM-DD)" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) return res.status(400).json({ error: "dates must be YYYY-MM-DD" });
  if (isoToUnix(end_date) <= isoToUnix(start_date)) return res.status(400).json({ error: "end_date must be after start_date" });
  const inserted = await sb(`cancellations?select=id`, {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      client_id: member.client_id, member_id: member.id, athlete_name: member.athlete_name,
      archetype: member.archetype, parent_name: member.parent_name, type: "pause",
      pause_start: start_date, pause_end: end_date,
      reason: body.reason || "pause date fix (no Stripe change)",
      stripe_subscription_id: member.stripe_subscription_id, stripe_customer_id: member.stripe_customer_id,
      activated_at: nowIso(),
    }]),
  });
  const newRowId = Array.isArray(inserted) && inserted[0]?.id;
  if (!newRowId) return res.status(500).json({ error: "failed to insert pause row" });
  await sb(`cancellations?member_id=eq.${member.id}&type=eq.pause&completed_at=is.null&id=neq.${newRowId}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ activated_at: nowIso(), completed_at: nowIso(), reason: "superseded by pause date fix" }),
  }).catch(() => {});
  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "paused", pause_scheduled_for: null, updated_at: nowIso() }),
  });
  // Offer tie-in F: mirror the paused state onto membership + entitlements.
  await syncMemberAccessNonFatal({ clientId: member.client_id, memberId: member.id, reason: "portal-action" });
  await writeAudit({ client_id: member.client_id, member_id: member.id, action_type: "pause-date-fix", args: { pause_start: start_date, pause_end: end_date }, performed_by: ctx.user.id, performed_by_name: ctx.staff?.name || null, db_changes: { members: { status: { to: "paused" } }, cancellations: "inserted (date fix)" } });
  return res.status(200).json({ ok: true, action: "pause-date-fix", pause_start: start_date, pause_end: end_date });
}

async function actionPause(res, member, stripeAccount, ctx, body) {
  if (!member.stripe_subscription_id) {
    return res.status(400).json({ error: "member has no Stripe subscription to pause" });
  }

  // Block pauses on members already in a problem state
  if (member.status === "payment_failed") {
    return res.status(400).json({
      error: "Member has a failed payment. Send the Payment Link to fix their card before pausing.",
    });
  }
  if (member.status === "cancelling") {
    return res.status(400).json({
      error: "Member is being cancelled. Pause is not allowed — un-cancel first.",
    });
  }

  // Validate dates
  const { start_date, end_date } = body;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: "start_date and end_date required (YYYY-MM-DD)" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return res.status(400).json({ error: "dates must be YYYY-MM-DD" });
  }
  const startUnix = isoToUnix(start_date);
  const endUnix   = isoToUnix(end_date);
  if (endUnix <= startUnix) {
    return res.status(400).json({ error: "end_date must be after start_date" });
  }
  if (endUnix <= nowUnix()) {
    return res.status(400).json({ error: "end_date is in the past — pick a future date" });
  }

  // Optional: staff manually set the NEXT PAYMENT date (Stripe trial_end) instead
  // of letting it be computed from the pause length. It still requires a pause
  // period (start_date/end_date above), which is always mandatory here.
  const manualNextPayment = body.next_payment_date || null;
  let manualTrialEndUnix = null;
  if (manualNextPayment) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(manualNextPayment)) {
      return res.status(400).json({ error: "next_payment_date must be YYYY-MM-DD" });
    }
    manualTrialEndUnix = isoToUnix(manualNextPayment);
    if (manualTrialEndUnix <= nowUnix()) {
      return res.status(400).json({ error: "next_payment_date is in the past — pick a future date" });
    }
  }

  // Future-scheduled vs immediate. Future = the pause starts more than ~1 day
  // out; we defer the Stripe trial_end + status flip to the cron at that time.
  const isFutureScheduled = startUnix > nowUnix() + 86400;

  // Fetch current sub — need state + period_end (only relevant for immediate)
  const currentSub = await stripeFetch(
    `/subscriptions/${member.stripe_subscription_id}`,
    { stripeAccount }
  );

  // Block pauses on past-due / unpaid subs (parent needs to fix card first)
  if (currentSub.status === "past_due" || currentSub.status === "unpaid") {
    return res.status(400).json({
      error: `Stripe sub is ${currentSub.status} — fix the card via the Payment Link before pausing.`,
    });
  }

  const pauseLengthSeconds = endUnix - startUnix;
  const operationId = body.operation_id || newRowOperationId();
  let trialEndUnix = null;
  let cappedToStripeMax = false;
  let resumeDate = null;

  if (!isFutureScheduled) {
    // Immediate pause — compute trial_end. Stripe call happens AFTER the
    // cancellations insert below so a row exists even if the Stripe call
    // throws (the row can be cleaned up; we never end up with a paused
    // Stripe sub and no corresponding DB record).
    const currentPeriodEnd = subCurrentPeriodEnd(currentSub) || 0;
    const anchor = Math.max(nowUnix(), currentPeriodEnd);
    // Manual next-payment date wins over the computed (anchor + pause length).
    trialEndUnix = manualTrialEndUnix != null ? manualTrialEndUnix : anchor + pauseLengthSeconds;

    const stripeCap = nowUnix() + STRIPE_TRIAL_MAX_SECS;
    if (trialEndUnix > stripeCap) {
      trialEndUnix = stripeCap;
      cappedToStripeMax = true;
    }
    resumeDate = unixToDateStr(trialEndUnix);
  }

  // Atomicity: insert the new pause row FIRST, then supersede any prior rows
  // (excluding the new id). That way a failed insert leaves the prior pause
  // intact; a failed supersede leaves both rows but the older ones are
  // harmless (cron's claim-first pattern handles dupes).
  const insertedRows = await sb(`cancellations?select=id`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      client_id: member.client_id,
      member_id: member.id,
      athlete_name: member.athlete_name,
      archetype: member.archetype,
      parent_name: member.parent_name,
      type: "pause",
      pause_start: start_date,
      pause_end: end_date,
      manual_trial_end: manualNextPayment,   // staff-set next charge date (null = computed)
      reason: body.reason || null,
      stripe_subscription_id: member.stripe_subscription_id,
      stripe_customer_id: member.stripe_customer_id,
      activated_at: isFutureScheduled ? null : nowIso(),
    }]),
  });
  const newRowId = Array.isArray(insertedRows) && insertedRows[0]?.id;
  if (!newRowId) {
    return res.status(500).json({ error: "failed to insert pause row" });
  }

  // Supersede prior pause rows for this member (immediate completes both
  // pending and active priors; pending ones get activated_at filled in so
  // they don't sit in "pending + completed" undefined state).
  await sb(
    `cancellations?member_id=eq.${member.id}&type=eq.pause&completed_at=is.null&id=neq.${newRowId}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        activated_at: nowIso(),  // safe to set unconditionally — already-set values are unchanged-in-spirit
        completed_at: nowIso(),
        reason: (body.reason || "") + " [superseded by pause update]",
      }),
    }
  ).catch(() => { /* harmless — cron will clean up if needed */ });

  // Now apply to Stripe (for immediate pauses only). If this throws we abort
  // and surface the error; the cancellations row stays around but the member
  // status hasn't been flipped yet (still 'live'), so state is recoverable.
  if (!isFutureScheduled) {
    try {
      await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
        method: "POST",
        stripeAccount,
        body: {
          trial_end: String(trialEndUnix),
          proration_behavior: "none",
          "pause_collection": "",
        },
        idempotencyKey: `pause-immediate-${member.id}-${operationId}`.slice(0, 255),
      });
    } catch (e) {
      // Mark the row failed and bail out — member status stays 'live'.
      await sb(`cancellations?id=eq.${newRowId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ completed_at: nowIso(), reason: `stripe failed: ${e.message}` }),
      }).catch(() => {});
      return res.status(502).json({ error: `Stripe call failed: ${e.message}` });
    }
  }

  // Build sub object for return / audit
  const sub = isFutureScheduled
    ? { id: currentSub.id, status: currentSub.status, trial_end: currentSub.trial_end }
    : { ...currentSub, trial_end: trialEndUnix };

  // Member status updates
  const dbChanges = {};
  if (!isFutureScheduled) {
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "paused", pause_scheduled_for: null, updated_at: nowIso() }),
    });
    dbChanges.members = { id: member.id, status: "paused", pause_scheduled_for: null };
    // Offer tie-in F: mirror the paused state onto membership + entitlements.
    await syncMemberAccessNonFatal({ clientId: member.client_id, memberId: member.id, reason: "portal-action" });
  } else {
    // Surface the queued state on the member row so the staff portal can
    // render a "Pause queued" pill without joining cancellations.
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ pause_scheduled_for: start_date, updated_at: nowIso() }),
    });
    dbChanges.members = { id: member.id, status: "live (pause scheduled)", pause_scheduled_for: start_date };
  }
  dbChanges.cancellations = isFutureScheduled ? "inserted (pending)" : "inserted (active)";

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: isFutureScheduled ? "pause-scheduled" : "pause",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: sub.id, status: sub.status, trial_end: sub.trial_end, capped_to_stripe_max: cappedToStripeMax, pause_length_days: Math.round(pauseLengthSeconds / 86400), scheduled: isFutureScheduled },
    db_changes: dbChanges,
  });

  return res.status(200).json({
    ok: true,
    member: { id: member.id, status: isFutureScheduled ? "live" : "paused", pause_scheduled_for: isFutureScheduled ? start_date : null },
    sub: { id: sub.id, status: sub.status, trial_end: sub.trial_end, resume_date: resumeDate, capped_to_stripe_max: cappedToStripeMax, scheduled: isFutureScheduled },
  });
}

// ─────────────────────────────────────────────────────────
// Action: UNPAUSE
// ─────────────────────────────────────────────────────────
// body: {} (resume now) | { new_until: "YYYY-MM-DD" } (shift to new date)
async function actionUnpause(res, member, stripeAccount, ctx, body) {
  if (!member.stripe_subscription_id) {
    return res.status(400).json({ error: "member has no Stripe subscription" });
  }

  const cancellingScheduledPause = member.status !== "paused" && Boolean(member.pause_scheduled_for);
  let resumeNow = !body.new_until;
  let newTrialEnd = null;
  let stripeBody = null;
  if (resumeNow) {
    // A queued pause has not touched Stripe yet, so cancelling it must only
    // clear the pending DB state. Active pauses resume billing immediately.
    if (!cancellingScheduledPause) {
      stripeBody = { "trial_end": "now", proration_behavior: "none" };
    }
  } else {
    newTrialEnd = isoToUnix(body.new_until);
    stripeBody = { trial_end: String(newTrialEnd), proration_behavior: "none" };
  }

  const sub = stripeBody
    ? await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
        method: "POST",
        stripeAccount,
        body: stripeBody,
        idempotencyKey: `unpause-${member.id}-${body.operation_id || newRowOperationId()}`.slice(0, 255),
      })
    : { id: member.stripe_subscription_id, status: "active", trial_end: null };

  const dbChanges = {};
  if (resumeNow) {
    // Flip status to live + clear any scheduled-for marker
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "live", pause_scheduled_for: null, updated_at: nowIso() }),
    });
    dbChanges.members = { id: member.id, status: "live", pause_scheduled_for: null };
    // Offer tie-in F: reactivate membership + entitlements with the member.
    await syncMemberAccessNonFatal({ clientId: member.client_id, memberId: member.id, reason: "portal-action" });

    // Mark any open pause rows (pending or active) completed.
    await sb(
      `cancellations?member_id=eq.${member.id}&type=eq.pause&completed_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ completed_at: nowIso(), activated_at: nowIso() }),
      }
    ).catch(() => {});
    dbChanges.cancellations = "pause(es) closed";
  } else {
    // Shift the end date on the open pause row(s) — keep status as-is.
    await sb(
      `cancellations?member_id=eq.${member.id}&type=eq.pause&completed_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ pause_end: body.new_until.slice(0, 10) }),
      }
    ).catch(() => {});
    dbChanges.cancellations = `pause shifted to ${body.new_until}`;
  }

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: cancellingScheduledPause ? "pause-cancelled" : "unpause",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: sub.id, status: sub.status, trial_end: sub.trial_end },
    db_changes: dbChanges,
  });

  return res.status(200).json({
    ok: true,
    member: { id: member.id, status: resumeNow ? "live" : "paused" },
    sub: { id: sub.id, status: sub.status, trial_end: sub.trial_end },
  });
}

// ─────────────────────────────────────────────────────────
// Action: CANCEL
// ─────────────────────────────────────────────────────────
// body: { reason?, immediate? (default false → at period end) }
// Cancels the Stripe sub and inserts a cancellations row (type='cancel').
// Immediate cancellation deletes the member; period-end cancellation keeps it
// in `cancelling` until Stripe's deletion webhook removes it.
async function actionCancel(res, member, stripeAccount, ctx, body) {
  const operationId = body.operation_id || newRowOperationId();
  let sub = null;
  let stripeManaged = false;
  if (member.stripe_subscription_id) {
    try {
      if (body.immediate) {
        sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
          method: "DELETE",
          stripeAccount,
          idempotencyKey: `cancel-immediate-${member.id}-${operationId}`.slice(0, 255),
        });
      } else {
        sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
          method: "POST",
          stripeAccount,
          body: { "cancel_at_period_end": "true" },
          idempotencyKey: `cancel-period-end-${member.id}-${operationId}`.slice(0, 255),
        });
      }
      stripeManaged = true;
    } catch (e) {
      // The sub may be foreign (CoachIQ/GHL/dashboard-created → not app-created,
      // so we can't manage it) or already gone. Still let the member come OFF the
      // roster - portal-side cancel only; the academy handles the external sub.
      // Re-throw anything that isn't one of those expected "can't manage" cases.
      const em = (e && e.message) || "";
      if (!/not created by your application|No such subscription|resource_missing|can only update its cancellation_details|already canceled|already cancelled/i.test(em)) throw e;
      if (body.source === "parent_app") {
        return res.status(409).json({
          error: "This membership cannot be cancelled in the app. Please contact your academy.",
        });
      }
      console.error("cancel: Stripe sub not manageable, portal-side cancel only:", em);
    }
  }

  // Insert cancellations row (always — captures intent + audit trail).
  // Snapshot the member's economics NOW: the members row gets deleted (here or
  // at period end), and the KPI churned-vs-active comparisons read these.
  // Skip if a cancel row already exists for this sub/member (double-click,
  // retried request) - the partial unique indexes are the DB backstop.
  const dupeQ = member.stripe_subscription_id
    ? `cancellations?stripe_subscription_id=eq.${encodeURIComponent(member.stripe_subscription_id)}&type=eq.cancel&select=id&limit=1`
    : `cancellations?member_id=eq.${member.id}&type=eq.cancel&select=id&limit=1`;
  const existingCancelRows = await sb(dupeQ).catch(() => []);
  if (!(Array.isArray(existingCancelRows) && existingCancelRows.length)) {
    const snapshot = await buildCancellationSnapshot({ member, sb, stripeFetch, stripeAccount });
    // Period-end cancels stamp the date the membership actually ENDS (Stripe's
    // current_period_end), not the day the button was pressed - churn lands in
    // the right month.
    const periodEnd = !body.immediate && sub && Number(sub.current_period_end) > 0 ? Number(sub.current_period_end) : null;
    await sb(`cancellations`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id: member.client_id,
        member_id: member.id,
        athlete_name: member.athlete_name,
        archetype: member.archetype,
        parent_name: member.parent_name,
        type: "cancel",
        cancel_date: unixToDateStr(periodEnd || nowUnix()),
        reason: body.reason || null,
        reason_category: body.reason_category || null,
        stripe_subscription_id: member.stripe_subscription_id,
        stripe_customer_id: member.stripe_customer_id,
        ...snapshot,
        source: body.source === "parent_app" ? "parent_app" : "staff_portal",
        involuntary: false,
      }]),
    }).catch((e) => {
      // 409 = unique-index backstop caught a race; the row exists, move on.
      if (!/409|duplicate|unique/i.test(e.message || "")) throw e;
    });
  }

  // Close any open pause rows (pending or active) — cancellation supersedes them.
  await sb(
    `cancellations?member_id=eq.${member.id}&type=eq.pause&completed_at=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ completed_at: nowIso(), activated_at: nowIso(), reason: "superseded by cancel" }),
    }
  ).catch(() => {});

  // For immediate cancels (or members with no Stripe sub), the subscription is
  // already terminated → safe to delete the members row now.
  // For period-end cancels, the parent is still billing through end of period —
  // leave the row in 'cancelling' so they remain on the roster and don't see
  // ghost charges. The members row will be DELETED later by handleSubDeleted
  // when Stripe fires customer.subscription.deleted at period end.
  // Delete the row now for: immediate cancels, members with no Stripe sub, OR a
  // sub we couldn't manage here (foreign/gone) - there'll be no period-end webhook
  // to clean them up, so don't leave them stuck in 'cancelling'.
  const willDeleteNow = body.immediate || !member.stripe_subscription_id || !stripeManaged;
  if (willDeleteNow) {
    // Offer tie-in F: cancel typed access BEFORE the member row disappears -
    // there is no later Stripe event that can still find this member.
    await syncMemberAccessNonFatal({
      clientId: member.client_id, memberId: member.id,
      reason: "portal-action", overrideMemberStatus: "cancelled",
    });
    await sb(`members?id=eq.${member.id}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } else {
    // Also clear pause_scheduled_for — they're cancelling, no pending pause matters.
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "cancelling", pause_scheduled_for: null, updated_at: nowIso() }),
    });
  }

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "cancel",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: sub ? { id: sub.id, status: sub.status, cancel_at_period_end: sub.cancel_at_period_end } : null,
    db_changes: { cancellations: "inserted", members: willDeleteNow ? "deleted" : "status → cancelling" },
  });

  return res.status(200).json({
    ok: true,
    member: { id: member.id, deleted: willDeleteNow, status: willDeleteNow ? null : "cancelling" },
    sub: sub ? { id: sub.id, status: sub.status, cancel_at_period_end: sub.cancel_at_period_end } : null,
  });
}

// ─────────────────────────────────────────────────────────
// Action: REFUND
// ─────────────────────────────────────────────────────────
// body: { charge_id (ch_...), amount_cents? (default full), reason? }
async function actionRefund(res, member, stripeAccount, ctx, body) {
  const chargeId = body.charge_id || body.stripe_charge_id;
  if (!chargeId) return res.status(400).json({ error: "charge_id (ch_...) required" });

  const stripeBody = { charge: chargeId };
  if (body.amount_cents) stripeBody.amount = String(body.amount_cents);
  if (body.reason && ["duplicate", "fraudulent", "requested_by_customer"].includes(body.reason)) {
    stripeBody.reason = body.reason;
  }

  const refund = await stripeFetch(`/refunds`, {
    method: "POST",
    stripeAccount,
    body: stripeBody,
    idempotencyKey: `refund_${member.id}_${chargeId}_${nowUnix()}`,
  });

  await sb(`refunds`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      client_id: member.client_id,
      member_id: member.id,
      athlete_name: member.athlete_name,
      parent_name: member.parent_name,
      stripe_charge_id: chargeId,
      stripe_refund_id: refund.id,
      amount_cents: refund.amount,
      currency: refund.currency || "cad",
      reason: body.notes || body.reason || null,
      refund_date: unixToDateStr(nowUnix()),
      stripe_customer_id: member.stripe_customer_id,
      stripe_subscription_id: member.stripe_subscription_id,
    }]),
  });

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "refund",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: refund.id, amount: refund.amount, status: refund.status },
    db_changes: { refunds: "inserted" },
  });

  // ── The parent's refund confirmation ──────────────────────────────────────
  // AFTER Stripe accepted the refund and after the audit row, so the record of
  // what staff did exists before we start talking to the parent about it.
  //
  // Gated exactly like a payment receipt (V2 academy + receipt_mode set), and a
  // refund sends under BOTH modes: 'first_only' is a preference about routine
  // billing mail, and money coming back is not routine.
  //
  // Non-fatal, deliberately and loudly: the money has ALREADY moved by this line.
  // If the email fails, the receipt row records that (email_status 'failed') and
  // staff can resend - but the API must still return ok, because telling a staff
  // member their refund failed when it succeeded would have them issue a second one.
  const receipt = await receiptsCall("sendRefundReceipt", {
    member, refund, chargeId,
  });

  return res.status(200).json({
    ok: true,
    refund: { id: refund.id, amount_cents: refund.amount, status: refund.status },
    receipt,
  });
}

// ─────────────────────────────────────────────────────────
// Action: RESEND-RECEIPT
// ─────────────────────────────────────────────────────────
// body: { receipt_id }
//
// Re-sends a receipt the academy already issued. It RE-RENDERS FROM THE STORED
// ROW - it does not go back to Stripe and it does not recompute the tax. A receipt
// is a document that was issued; reproducing it must not depend on nobody having
// edited a price since, or the "copy" a parent gets on request would disagree with
// the one they got at the time.
//
// The row is looked up scoped to this member AND this academy inside the module, so
// a receipt id belonging to somebody else is simply not found.
async function actionResendReceipt(res, member, ctx, body) {
  const receiptId = body.receipt_id || body.id;
  if (!receiptId) return res.status(400).json({ error: "receipt_id required" });

  const out = await receiptsCall("resendReceipt", { member, receiptId });

  // One audit row per resend. A receipt landing in a parent's inbox a second time
  // is a thing a human chose to do, and the history has to say who and when.
  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "resend-receipt",
    args: { receipt_id: receiptId, result: out },
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
  });

  if (out && out.error) return res.status(500).json({ error: out.error });
  // THE CONTRACT, and the spread order is the contract.
  //
  // `...out` FIRST, `ok` LAST, so `ok` is always a real boolean that means "this
  // reached the parent" - and specifically means it for the SKIPPED results too
  // (receipt not found, no email on file), which carry no `ok` of their own and
  // would otherwise leave it undefined. Undefined is falsy, so nothing would have
  // looked broken; a caller reading `if (!j.ok)` would even be right. But a caller
  // asserting `j.ok === false` would not be, and a 200 whose success flag is absent
  // rather than false is exactly the ambiguity that let the command bar say "Done."
  // over a send that never happened.
  //
  // ok === true if and only if email_status === 'sent'. Held and failed are 200s
  // (the row was found and updated) and they are NOT successes.
  return res.status(200).json({ ...out, ok: (out && out.email_status) === "sent" });
}

// Resolve a customer-facing promo code string to its live promotion code on the
// connected account (active only), or null.
async function resolvePromo(code, stripeAccount) {
  const c = normCode(code);
  if (!c) return null;
  const list = await stripeFetch(`/promotion_codes?code=${encodeURIComponent(c)}&limit=1&expand[]=data.promotion.coupon`, { stripeAccount });
  const pc = (list.data || [])[0];
  return pc && pc.active !== false ? pc : null;
}
// Coupon def ({kind,value}) from a Stripe coupon object, for the guardrails.
function couponDefFromStripe(cp = {}) {
  return cp.percent_off != null
    ? { kind: "Percent off", value: cp.percent_off }
    : { kind: "Dollar off", value: (cp.amount_off || 0) / 100 };
}

// ─────────────────────────────────────────────────────────
// Action: CHANGE (plan)
// ─────────────────────────────────────────────────────────
// body: { new_plan: "1/wk"|"2/wk"|"3/wk"|"unlmtd", prorate?: bool }
// Upgrade + prorate=true → create_prorations (immediate prorated charge).
// Upgrade + prorate=false OR downgrade → none (new price takes effect, no proration).
async function actionChange(res, member, stripeAccount, ctx, body) {
  if (!member.stripe_subscription_id) {
    return res.status(400).json({ error: "member has no Stripe subscription" });
  }

  // Live target prices come from pricing_catalog (is_routable = true), not a
  // hardcoded list. Preferred input: body.new_price_id (a stripe_price_id from
  // the catalog). Legacy fallback: body.new_plan ("1/wk".."unlmtd").
  const cleanLabel = (s) => (String(s || "").split(/\s+[·—-]\s+/)[0].trim() || String(s || ""));
  const catalog = (await sb(
    `pricing_catalog?client_id=eq.${member.client_id}` +
    `&select=stripe_price_id,display_name,canonical_plan,tier,interval,amount_cents,is_routable`
  )) || [];
  const byPrice = new Map(catalog.map(r => [r.stripe_price_id, r]));

  let newPriceId, newPlan, targetRow;
  if (body.new_price_id) {
    const catalogPriceId = body.catalog_price_id || body.new_price_id;
    targetRow = byPrice.get(catalogPriceId);
    if (!targetRow) {
      return res.status(400).json({ error: "that price isn't in this academy's catalog" });
    }
    if (targetRow.is_routable !== true) {
      return res.status(400).json({ error: "that price isn't a live (sellable) price" });
    }
    newPriceId = body.stripe_target_price_id || body.new_price_id;
    newPlan = targetRow.canonical_plan || cleanLabel(targetRow.display_name);
  } else {
    newPlan = body.new_plan;
    if (!VALID_PLANS.includes(newPlan)) {
      return res.status(400).json({ error: `new_plan must be one of: ${VALID_PLANS.join(", ")}` });
    }
    newPriceId = PLAN_TO_PRICE[newPlan];
    targetRow = byPrice.get(newPriceId) || null;
  }

  // Already on this exact price?
  const persistedPriceId = body.catalog_price_id || newPriceId;
  if (member.stripe_price_id && member.stripe_price_id === persistedPriceId) {
    return res.status(400).json({ error: `already on ${newPlan}` });
  }

  const currentRow = member.stripe_price_id ? byPrice.get(member.stripe_price_id) : null;

  // Fetch current sub - need item id, period end, the card to carry over, and
  // any active discount (so the recreate path doesn't silently drop it). Falls
  // back to a plain fetch if the API version can't expand discounts.
  let currentSub;
  try {
    currentSub = await stripeFetch(
      `/subscriptions/${member.stripe_subscription_id}?expand[]=discounts.promotion_code&expand[]=discounts.coupon`,
      { stripeAccount }
    );
  } catch (_expandErr) {
    currentSub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, { stripeAccount });
  }
  // Existing discount on the current sub, if any (for carry-over on recreate).
  const curDisc = (Array.isArray(currentSub.discounts) ? currentSub.discounts[0] : null) || currentSub.discount || null;
  const curDiscPromoId = curDisc && curDisc.promotion_code
    && (typeof curDisc.promotion_code === "object" ? curDisc.promotion_code.id : curDisc.promotion_code) || null;
  const curDiscCoupon = curDisc && (typeof curDisc.coupon === "object" ? curDisc.coupon : null);

  // Optional: staff sets when the NEXT payment should land (Stripe trial_end).
  // Pushes the next charge to that date; no charge happens until then.
  let trialEndUnix = null;
  if (body.next_payment_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.next_payment_date)) {
      return res.status(400).json({ error: "next_payment_date must be YYYY-MM-DD" });
    }
    trialEndUnix = isoToUnix(body.next_payment_date);
    if (trialEndUnix <= nowUnix()) {
      return res.status(400).json({ error: "next_payment_date is in the past - pick a future date" });
    }
    const cap = nowUnix() + STRIPE_TRIAL_MAX_SECS;
    if (trialEndUnix > cap) trialEndUnix = cap;
  }

  // Upgrade vs downgrade by price amount (proration only matters on upgrades).
  const curAmt = currentRow ? currentRow.amount_cents : null;
  const newAmt = targetRow ? targetRow.amount_cents : null;
  const isUpgrade = (curAmt != null && newAmt != null) ? (newAmt > curAmt) : false;

  // Same interval -> swap the price on the existing item. Different interval ->
  // Stripe can't swap, so cancel the old sub and create a fresh one on the new price.
  const intervalMismatch = !!(currentRow && targetRow && currentRow.interval && targetRow.interval
    && currentRow.interval !== targetRow.interval);

  const operationId = body.operation_id || newRowOperationId();
  let sub, mode, prorated = false, nextUnix = null;

  if (intervalMismatch) {
    mode = "recreate";
    if (!member.stripe_customer_id) {
      return res.status(400).json({ error: "member has no Stripe customer - can't recreate the subscription" });
    }
    // New sub starts charging at next_payment_date, or the existing period end so
    // the member keeps time they already paid for (no double charge). Card +
    // portal origin carry over so the new sub stays portal-managed.
    // Preserve an active pause when recreating across billing intervals. A
    // pause's trial_end can be later than current_period_end; dropping it here
    // would silently shorten the parent's approved pause.
    const startUnix = trialEndUnix || currentSub.trial_end || subCurrentPeriodEnd(currentSub) || (nowUnix() + 86400);
    const createBody = {
      customer: member.stripe_customer_id,
      "items[0][price]": newPriceId,
      proration_behavior: "none",
      "metadata[origin]": "fullcontrol-portal",
    };
    if (startUnix > nowUnix()) createBody.trial_end = String(startUnix);
    const pm = currentSub.default_payment_method;
    if (pm) createBody.default_payment_method = (typeof pm === "string" ? pm : pm.id);
    sub = await stripeFetch(`/subscriptions`, {
      method: "POST",
      stripeAccount,
      body: createBody,
      idempotencyKey: `member-change-create-${member.id}-${operationId}`.slice(0, 255),
    });
    // Cancel the old sub now. If that fails, roll back the new one so we never double-bill.
    try {
      await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
        method: "DELETE",
        stripeAccount,
        idempotencyKey: `member-change-delete-old-${member.id}-${operationId}`.slice(0, 255),
      });
    } catch (e) {
      try {
        await stripeFetch(`/subscriptions/${sub.id}`, {
          method: "DELETE",
          stripeAccount,
          idempotencyKey: `member-change-rollback-${member.id}-${operationId}`.slice(0, 255),
        });
      } catch (_) {}
      return res.status(502).json({ error: "Couldn't cancel the old subscription - no change made. " + (e.message || "") });
    }
    nextUnix = startUnix > nowUnix() ? startUnix : subCurrentPeriodEnd(sub);
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        stripe_subscription_id: sub.id,
        stripe_price_id: persistedPriceId,
        plan: newPlan,
        updated_at: nowIso(),
      }),
    });
    // Offer tie-in F: move the entitlement to the new plan's template now
    // (the invoice.paid webhook converges on the same source_ref later).
    await syncMemberAccessNonFatal({
      clientId: member.client_id, memberId: member.id,
      reason: "subscription-updated", subscriptionId: sub.id, stripePriceId: persistedPriceId,
    });
  } else {
    mode = "swap";
    const itemId = currentSub.items?.data?.[0]?.id;
    if (!itemId) {
      return res.status(400).json({ error: "Stripe sub has no items - manual fix needed" });
    }
    const proration = (trialEndUnix == null && isUpgrade && body.prorate) ? "create_prorations" : "none";
    prorated = proration === "create_prorations";
    const updateBody = {
      "items[0][id]": itemId,
      "items[0][price]": newPriceId,
      proration_behavior: proration,
    };
    if (trialEndUnix != null) updateBody.trial_end = String(trialEndUnix);
    sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
      method: "POST",
      stripeAccount,
      body: updateBody,
      idempotencyKey: `member-change-swap-${member.id}-${operationId}`.slice(0, 255),
    });
    nextUnix = trialEndUnix != null ? trialEndUnix : subCurrentPeriodEnd(sub);
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      // Persist the new price too - without this the row keeps the old
      // stripe_price_id, so the roster shows the stale amount/Archived tag.
      body: JSON.stringify({ stripe_price_id: persistedPriceId, plan: newPlan, updated_at: nowIso() }),
    });
    // Offer tie-in F: move the entitlement to the new plan's template now.
    await syncMemberAccessNonFatal({
      clientId: member.client_id, memberId: member.id,
      reason: "subscription-updated", subscriptionId: member.stripe_subscription_id, stripePriceId: persistedPriceId,
    });
  }

  // ── Coupon handling on the resulting subscription ──
  // Swap keeps the existing discount automatically. Recreate starts clean, so we
  // carry the old coupon over (this is the silent-discount-loss bug we're closing).
  // Staff can also apply a new coupon or remove it during a change. Everything runs
  // through the $1-floor guardrail against the NEW plan price.
  let coupon = null;
  const targetCents = sub.items?.data?.[0]?.price?.unit_amount || newAmt || null;
  try {
    if (body.remove_coupon) {
      if (mode === "swap") await stripeFetch(`/subscriptions/${sub.id}/discount`, { method: "DELETE", stripeAccount });
      coupon = { removed: true };
    } else if (body.coupon_code) {
      const pc = await resolvePromo(body.coupon_code, stripeAccount);
      if (!pc) coupon = { error: "coupon not found or inactive" };
      else {
        const chk = targetCents ? applyDiscountToCents(couponDefFromStripe(couponFromPromo(pc)), targetCents) : { ok: true };
        if (!chk.ok) coupon = { error: chk.error };
        else {
          await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", stripeAccount, body: { "discounts[0][promotion_code]": pc.id } });
          coupon = { applied: true, code: normCode(body.coupon_code) };
        }
      }
    } else if (mode === "recreate" && (curDiscPromoId || curDiscCoupon)) {
      // Carry the old coupon onto the new sub - but only if it still clears the
      // guardrail on the new plan (a $ coupon can break a cheaper plan).
      const chk = (targetCents && curDiscCoupon) ? applyDiscountToCents(couponDefFromStripe(curDiscCoupon), targetCents) : { ok: true };
      if (chk.ok) {
        const cbody = curDiscPromoId ? { "discounts[0][promotion_code]": curDiscPromoId } : { "discounts[0][coupon]": curDiscCoupon.id };
        await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", stripeAccount, body: cbody });
        coupon = { carried_over: true };
      } else {
        coupon = { dropped: true, reason: chk.error };
      }
    }
  } catch (e) { coupon = { error: e.message }; }

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "change",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: sub.id, status: sub.status, price_id: newPriceId, trial_end: sub.trial_end || null, mode, coupon },
    db_changes: { members: { id: member.id, plan: { from: member.plan, to: newPlan }, mode } },
  });

  return res.status(200).json({
    ok: true,
    mode,
    coupon,
    member: { id: member.id, plan: newPlan },
    sub: { id: sub.id, status: sub.status, new_price_id: newPriceId },
    prorated,
    direction: isUpgrade ? "upgrade" : "downgrade",
    next_payment_set: nextUnix != null,
    next_payment: nextUnix,
  });
}

// Parent member-management routes reuse the same billing operations after
// performing their own student ownership checks and input sanitization.
export { actionCancel, actionChange, actionPause, actionUnpause };

// ─────────────────────────────────────────────────────────
// Action: APPLY-COUPON
// ─────────────────────────────────────────────────────────
// body: { code: "SIBLING10" }  (the customer-facing promotion code string)
// Applies a live coupon to the member's subscription. Replaces any existing
// discount (Stripe allows one). Guardrails run against the sub's CURRENT price
// so a $ coupon can never drop this member below $1.
async function actionApplyCoupon(res, member, stripeAccount, ctx, body) {
  if (!member.stripe_subscription_id) {
    return res.status(400).json({ error: "member has no Stripe subscription" });
  }
  const code = normCode(body.code || body.promotion_code);
  if (!code) return res.status(400).json({ error: "code required" });

  // Current sub → the price cents the coupon will discount.
  const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, { stripeAccount });
  const item = sub.items?.data?.[0];
  const planCents = item?.price?.unit_amount;
  if (!Number.isFinite(planCents) || planCents <= 0) {
    return res.status(400).json({ error: "couldn't read this member's plan price from Stripe" });
  }

  // Live promotion code on the connected account.
  const list = await stripeFetch(`/promotion_codes?code=${encodeURIComponent(code)}&limit=1&expand[]=data.promotion.coupon`, { stripeAccount });
  const pc = (list.data || [])[0];
  if (!pc) return res.status(400).json({ error: `no coupon named ${code} exists in Stripe - create it in the offer's Pricing section first` });
  if (pc.active === false) return res.status(400).json({ error: `${code} is deactivated` });
  if (pc.expires_at && nowUnix() > pc.expires_at) return res.status(400).json({ error: `${code} has expired` });
  if (pc.max_redemptions && (pc.times_redeemed || 0) >= pc.max_redemptions) {
    return res.status(400).json({ error: `${code} is fully redeemed` });
  }

  // Guardrail: never let this coupon zero-out or go negative on THIS plan.
  const cp = couponFromPromo(pc);
  const def = cp.percent_off != null
    ? { kind: "Percent off", value: cp.percent_off }
    : { kind: "Dollar off", value: (cp.amount_off || 0) / 100 };
  const applied = applyDiscountToCents(def, planCents);
  if (!applied.ok) return res.status(400).json({ error: applied.error });

  // Apply to the subscription (replaces any existing discount).
  const updated = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    method: "POST",
    stripeAccount,
    body: { "discounts[0][promotion_code]": pc.id },
  });

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "apply-coupon",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { subscription: updated.id, promotion_code: pc.id, coupon: cp.id, discount_cents: applied.discountCents },
    db_changes: null,
  });

  return res.status(200).json({
    ok: true,
    coupon: {
      code,
      label: applied.label,
      discount_cents: applied.discountCents,
      discounted_cents: applied.discountedCents,
      plan_cents: planCents,
    },
  });
}

// ─────────────────────────────────────────────────────────
// Action: REMOVE-COUPON
// ─────────────────────────────────────────────────────────
// Pulls any active discount off the member's subscription. Back to full price
// on the next invoice.
async function actionRemoveCoupon(res, member, stripeAccount, ctx, body) {
  if (!member.stripe_subscription_id) {
    return res.status(400).json({ error: "member has no Stripe subscription" });
  }
  // Legacy single-discount delete endpoint - clears the subscription's coupon.
  await stripeFetch(`/subscriptions/${member.stripe_subscription_id}/discount`, {
    method: "DELETE",
    stripeAccount,
  });

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "remove-coupon",
    args: body || null,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { subscription: member.stripe_subscription_id, discount: "removed" },
    db_changes: null,
  });

  return res.status(200).json({ ok: true, removed: true });
}

// Per-academy messaging readiness for the send modal (payment-link / card link).
// SMS is sendable when the academy is on native Twilio OR still has a GHL location;
// email when on native Resend OR GHL. Drives which buttons the modal enables now
// that academies can be fully off GHL. Never throws.
async function messagingReadiness(clientId, client) {
  const [smsProv, emailProv] = await Promise.all([
    smsProvider(clientId).catch(() => "ghl"),
    emailProvider(clientId).catch(() => "ghl"),
  ]);
  const hasGhl = Boolean(client?.ghl_location_id);
  return {
    sms_provider: smsProv,       // "twilio" | "ghl"
    email_provider: emailProv,   // "resend" | "ghl"
    sms_ready: smsProv === "twilio" || hasGhl,
    email_ready: emailProv === "resend" || hasGhl,
  };
}

// ─────────────────────────────────────────────────────────
// Action: PAYMENT-LINK
// ─────────────────────────────────────────────────────────
// Creates a Stripe Customer Portal session so the parent can update card,
// view invoices, manage their sub.
async function actionPaymentLink(res, member, stripeAccount, ctx, body, req) {
  if (!member.stripe_customer_id) {
    return res.status(400).json({ error: "member has no Stripe customer — can't make a portal link" });
  }
  // Pin to canonical client domain unless caller overrides (Stripe customer
  // portal return URL should never be a *.vercel.app preview hostname).
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  const base = isLocal ? origin : "https://portal.byanymeansbusiness.com";
  const returnUrl = body.return_url || `${base}/client-portal.html#members`;

  // Academy-level GHL config — needed by the modal so the UI can show
  // whether SMS / Email send-via-GHL is wired up for this academy.
  const academyGhl = ctx.client?.ghl_location_id || null;

  const session = await stripeFetch(`/billing_portal/sessions`, {
    method: "POST",
    stripeAccount,
    body: {
      customer: member.stripe_customer_id,
      return_url: returnUrl,
    },
  });

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "payment-link",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: session.id, url: session.url },
    db_changes: null,
  });

  // Default text for the SMS/Email modal — staff can edit before sending.
  const academyName = ctx.client?.business_name || "your academy";
  const suggestedSms = `Hi, here's the link to update your card with ${academyName}: ${session.url}`;
  const suggestedEmailSubject = `Update your card on file - ${academyName}`;
  const suggestedEmailHtml =
    `<p>Hi${member.parent_name ? ` ${member.parent_name.split(/\s+/)[0]}` : ""},</p>` +
    `<p>Here's the link to update your card with ${academyName}:</p>` +
    `<p><a href="${session.url}">${session.url}</a></p>` +
    `<p>Thanks!<br>${academyName}</p>`;

  const messaging = await messagingReadiness(member.client_id, ctx.client);

  return res.status(200).json({
    ok: true,
    url: session.url,
    expires_at: session.expires_at || null,
    parent: {
      name:  member.parent_name  || null,
      phone: member.parent_phone || null,
      email: member.parent_email || null,
    },
    ghl: {
      // location_id present → academy is wired to GHL. Kept for back-compat;
      // the modal now gates on `messaging` (Twilio/Resend OR GHL) instead.
      ready:       Boolean(academyGhl),
      location_id: academyGhl,
    },
    // Per-channel send readiness. The send endpoint (/api/ghl/send-message) is
    // provider-aware and routes SMS→Twilio, Email→Resend for off-GHL academies.
    messaging,
    suggested: {
      sms_text:     suggestedSms,
      email_subject: suggestedEmailSubject,
      email_html:   suggestedEmailHtml,
    },
  });
}

// ─────────────────────────────────────────────────────────
// Action: CARD-SETUP-LINK
// ─────────────────────────────────────────────────────────
// Standalone "save your card" link (Stripe setup-mode Checkout) — collects a card
// and saves it to the customer with NO subscription attached. For members who have
// no card on file ("collecting payment"); the portal uses the saved card later.
// body: { mark_collecting?: bool }  → optionally flips status to payment_method_required.
async function actionCardSetupLink(res, member, stripeAccount, ctx, body, req) {
  if (!member.stripe_customer_id) {
    return res.status(400).json({ error: "member has no Stripe customer — can't collect a card" });
  }
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  const base = isLocal ? origin : "https://portal.byanymeansbusiness.com";

  const session = await stripeFetch(`/checkout/sessions`, {
    method: "POST", stripeAccount,
    body: {
      mode: "setup", currency: "cad", customer: member.stripe_customer_id,
      success_url: `${base}/client-portal.html?card=saved`,
      cancel_url: `${base}/client-portal.html?card=cancelled`,
    },
  });

  if (body.mark_collecting) {
    // signup_origin 'collecting' keeps this REAL member visible on the roster -
    // pre-payment enroll-form shells (origin website_enroll/convert/wizard) are
    // hidden, but a member whose card is being collected must stay in view.
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "payment_method_required", signup_origin: "collecting", updated_at: nowIso() }),
    }).catch(() => {});
    // Offer tie-in F: mirror the collecting state (suspends entitlements).
    await syncMemberAccessNonFatal({ clientId: member.client_id, memberId: member.id, reason: "portal-action" });
  }

  await writeAudit({
    client_id: member.client_id, member_id: member.id,
    action_type: "card-setup-link", args: body,
    performed_by: ctx.user.id, performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: session.id, url: session.url },
    db_changes: body.mark_collecting ? { members: { status: { to: "payment_method_required" } } } : null,
  });

  const academyName = ctx.client?.business_name || "your academy";
  const suggestedSms = `Hi, please add your card on file with ${academyName}: ${session.url}`;
  const messaging = await messagingReadiness(member.client_id, ctx.client);
  return res.status(200).json({
    ok: true, url: session.url, expires_at: session.expires_at || null,
    parent: { name: member.parent_name || null, phone: member.parent_phone || null, email: member.parent_email || null },
    ghl: { ready: Boolean(ctx.client?.ghl_location_id), location_id: ctx.client?.ghl_location_id || null },
    messaging,
    suggested: {
      sms_text: suggestedSms,
      email_subject: `Add your card on file - ${academyName}`,
      email_html: `<p>Hi${member.parent_name ? ` ${member.parent_name.split(/\s+/)[0]}` : ""},</p><p>Please add your card on file with ${academyName}:</p><p><a href="${session.url}">${session.url}</a></p><p>Thanks!<br>${academyName}</p>`,
    },
  });
}

// ─────────────────────────────────────────────────────────
// Action: REFERRED
// ─────────────────────────────────────────────────────────
// body: { count: 1-10, reason? }
// Each referral = +4 weeks added to trial_end (= push the next charge).
async function actionReferred(res, member, stripeAccount, ctx, body) {
  if (!member.stripe_subscription_id) {
    return res.status(400).json({ error: "member has no Stripe subscription to credit" });
  }
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    return res.status(400).json({ error: "count must be an integer 1-10" });
  }
  const weeksAdded = count * 4;

  // Read current trial_end (or current_period_end if no trial active)
  const currentSub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    stripeAccount,
  });
  const anchor = currentSub.trial_end || subCurrentPeriodEnd(currentSub) || nowUnix();
  const newTrialEnd = anchor + weeksAdded * 7 * 86400;

  // Stripe cap: 730 days from now
  const cap = nowUnix() + 730 * 86400;
  const safeTrialEnd = Math.min(newTrialEnd, cap);
  const cappedToMax = safeTrialEnd < newTrialEnd;

  const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    method: "POST",
    stripeAccount,
    body: {
      trial_end: String(safeTrialEnd),
      proration_behavior: "none",
    },
  });

  await sb(`referrals`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      client_id: member.client_id,
      referrer_member_id: member.id,
      referrer_athlete_name: member.athlete_name,
      referrer_parent_name: member.parent_name,
      count,
      weeks_added: weeksAdded,
      stripe_subscription_id: member.stripe_subscription_id,
      old_trial_end: currentSub.trial_end ? new Date(currentSub.trial_end * 1000).toISOString() : null,
      new_trial_end: new Date(safeTrialEnd * 1000).toISOString(),
    }]),
  });

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "referred",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: sub.id, status: sub.status, trial_end: sub.trial_end, capped: cappedToMax },
    db_changes: { referrals: "inserted" },
  });

  return res.status(200).json({
    ok: true,
    count,
    weeks_added: weeksAdded,
    new_trial_end: sub.trial_end,
    capped_to_730d: cappedToMax,
  });
}

// ─────────────────────────────────────────────────────────
// Action: UPDATE-PROFILE  (no Stripe involvement)
// ─────────────────────────────────────────────────────────
// body: { fields: { archetype?, trainer?, engagement?, skill_notes?,
//                   parent_email?, parent_phone? } }
// Pure DB write — used for inline edits in the member-detail drawer.

const PROFILE_EDITABLE_FIELDS = new Set([
  "archetype", "trainer", "engagement", "skill_notes",
  "parent_email", "parent_phone", "parent_archetype", "group_num",
  "avatar_url",
  // 'alternate' = pays outside Stripe (cash/e-transfer) — set from the member
  // popup or the Sorter cleanup step; null/'stripe' = normal Stripe billing.
  "billing_mode",
  // Membership start date (display/access label; NOT a billing change). Also mirrored
  // to the Stripe subscription metadata[start_date] after the DB write (best-effort).
  "start_date",
]);

// Click-to-call a member: rings the academy's staff cell, then bridges to the
// member's phone (lead sees the academy number as caller ID). Logs to `calls`.
async function actionCall(res, member, ctx) {
  const lead = (member.parent_phone || "").trim();
  if (!lead) return res.status(400).json({ error: "This member has no phone number on file." });
  const cfg = await loadVoiceConfig(member.client_id);
  if (!cfg || !cfg.voiceEnabled) return res.status(400).json({ error: "Calling isn't set up for this academy yet." });
  if (!cfg.ringNumbers.length) return res.status(400).json({ error: "No staff phone is configured to ring." });

  const call = await startClickToCall(cfg, { leadPhone: lead });
  await logCall({
    client_id: member.client_id, direction: "outbound", status: call.status || "queued",
    twilio_call_sid: call.sid, from_number: cfg.from, to_number: lead, contact_phone: lead,
    ghl_contact_id: member.ghl_contact_id || null, contact_name: member.parent_name || null,
    answered_by: call.staff || null, occurred_at: new Date().toISOString(),
    raw: { sid: call.sid, initiated_by: ctx.user?.id || null },
  });
  await writeAudit({
    client_id: member.client_id, member_id: member.id, action_type: "call",
    args: { to: lead, via: cfg.from, ring: call.staff, call_sid: call.sid },
    performed_by: ctx.user?.id, performed_by_name: ctx.staff?.name || null,
  }).catch(() => {});
  return res.status(200).json({ ok: true, call_sid: call.sid, status: call.status, ringing: call.staff });
}

async function actionUpdateProfile(res, member, ctx, body) {
  const fields = (body.fields && typeof body.fields === "object") ? body.fields : {};
  const updates = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!PROFILE_EDITABLE_FIELDS.has(k)) continue;
    if (k === "start_date") {
      // Blank clears it (starts immediately); otherwise must be YYYY-MM-DD.
      if (v === "" || v === null || v === undefined) { updates.start_date = null; continue; }
      const s = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
      updates.start_date = s;
      continue;
    }
    // Empty string → null (so "pick — " clears the field).
    //
    // LOAD-BEARING for billing_mode since 2026-08-07. The drawer's "Switch to
    // Stripe billing" button sends the empty string, and members.billing_mode now
    // carries CHECK (billing_mode IS NULL OR billing_mode IN ('alternate','card')).
    // A literal '' would be rejected by Postgres and the button would just fail.
    // This line is what keeps it working, and api/_off-card.test.mjs pins it so
    // it cannot be tidied away by someone who does not know that.
    updates[k] = (v === "" || v === undefined) ? null : v;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "no editable fields provided" });
  }

  // THE DOUBLE-BILLING GUARD, on the raw-field door.
  //
  // set-off-card is the front door and it guards itself. This is the side door:
  // billing_mode is in PROFILE_EDITABLE_FIELDS, so a client can still flip a
  // member to 'alternate' with a plain field write and get no arrangement, no
  // due date and no check on whether Stripe is still charging them. Until every
  // caller is moved over, the guard has to live on BOTH doors, because the whole
  // point is that it cannot be walked past. There is one member in production
  // flagged 'alternate' with a live subscription id right now.
  //
  // It RAISES and PROCEEDS rather than refusing. The flag is not the error - the
  // live subscription is - and an owner who cannot record that a parent pays cash
  // will simply stop telling the portal anything.
  let guardItem = null;
  if (updates.billing_mode === "alternate" && member.billing_mode !== "alternate") {
    guardItem = await raiseStopBillingIfSubscribed(member);
  }
  updates.updated_at = nowIso();

  const rows = await sb(`members?id=eq.${member.id}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  const updated = Array.isArray(rows) && rows[0] ? rows[0] : null;

  // Mirror a start-date edit onto the Stripe subscription metadata so Stripe stays in
  // sync with the member card. Best-effort + non-fatal: the members row is the source
  // of truth for this display label. Empty string removes the Stripe metadata key.
  if (Object.prototype.hasOwnProperty.call(updates, "start_date") && updated && updated.stripe_subscription_id) {
    try {
      const crows = await sb(`clients?id=eq.${encodeURIComponent(member.client_id)}&select=stripe_connect_account_id&limit=1`);
      const acct = Array.isArray(crows) && crows[0] && crows[0].stripe_connect_account_id;
      if (acct) {
        await stripeFetch(`/subscriptions/${encodeURIComponent(updated.stripe_subscription_id)}`, {
          method: "POST", stripeAccount: acct,
          body: { "metadata[start_date]": updates.start_date || "" },
        });
      }
    } catch (_) { /* non-fatal — DB write already succeeded */ }
  }

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "update-profile",
    args: { fields: updates },
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: null,
    db_changes: { members: { id: member.id, updated_keys: Object.keys(updates) } },
  });

  return res.status(200).json({
    ok: true,
    member: updated,
    stop_billing_item: guardItem ? { id: guardItem.id, title: guardItem.title } : null,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// OFF-STRIPE PAYMENTS: arrangements, collections, and the reminder that makes
// members.billing_mode='alternate' mean something.
//
// Design + rulings: docs/plans/off-stripe-payments-design.md (Zoran, 2026-08-07).
// Pure logic (dates, cadence, partial-payment rules, copy) lives in
// api/_off-card.js and is tested without a database by api/_off-card.test.mjs.
// What lives HERE is everything that touches rows.
// ═════════════════════════════════════════════════════════════════════════════

// The default assignee of every collect reminder (ruling D2: the OWNER by
// default, reassignable to a staff member - and reassignment is the action_items
// PATCH that already exists, so there is nothing new to learn).
async function loadOwnerAssignee(clientId) {
  try {
    const rows = await sb(
      `client_users?client_id=eq.${encodeURIComponent(clientId)}&role=eq.owner&status=eq.active&select=id,name&limit=1`
    );
    const o = Array.isArray(rows) && rows[0];
    return o ? { id: o.id, name: o.name || "Owner" } : { id: null, name: null };
  } catch (_) {
    // Non-fatal: an unassigned item still reaches the owner, because notifyOwners
    // always includes them regardless of assignee_id.
    return { id: null, name: null };
  }
}

const isDuplicateErr = (e) => /23505|duplicate key/i.test(String((e && e.message) || e || ""));

// Create an action item that NO HUMAN asked for.
//
// Idempotency is the unique index on (client_id, system_key), not a check here.
// Two overlapping cron runs both insert; Postgres rejects the second with 23505;
// this returns { created:false } and the caller does not announce it twice. There
// is no read-then-write window to lose.
//
// created_by is left NULL (a cron has no auth.users id) and created_by_role is
// 'system', which the widened CHECK admits.
async function createSystemActionItem({ client_id, system_key, title, description, due_date, assignee_id, assignee_name }) {
  try {
    const rows = await sb(`action_items`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        client_id, system_key, title,
        description: description || null,
        due_date: due_date || null,
        assignee_id: assignee_id || null,
        assignee_name: assignee_name || null,
        created_by: null,
        created_by_name: "FullControl",
        created_by_role: "system",
      }),
    });
    const item = Array.isArray(rows) ? rows[0] : rows;
    return { created: true, item };
  } catch (e) {
    if (!isDuplicateErr(e)) throw e;
    const existing = await sb(
      `action_items?client_id=eq.${encodeURIComponent(client_id)}&system_key=eq.${encodeURIComponent(system_key)}&select=*&limit=1`
    ).catch(() => null);
    return { created: false, item: (Array.isArray(existing) && existing[0]) || null };
  }
}

// THE DOUBLE-BILLING GUARD.
//
// Raising this is not optional politeness. There is one member in production
// right now flagged 'alternate' with a live subscription id, which is a parent
// who could be handing over cash while Stripe keeps charging the card. It RAISES
// rather than REFUSES for the reason stated in api/_off-card.js: the flag is not
// the error, the live subscription is.
//
// Returns the item when one was raised (so the caller can tell the human on the
// spot rather than leaving it to be discovered), or null when there is no sub.
async function raiseStopBillingIfSubscribed(member) {
  const spec = stopBillingItem(member);
  if (!spec) return null;
  try {
    const owner = await loadOwnerAssignee(member.client_id);
    const { created, item } = await createSystemActionItem({
      client_id: member.client_id,
      system_key: spec.system_key,
      title: spec.title,
      description: spec.description,
      due_date: ocToday(),
      assignee_id: owner.id,
      assignee_name: owner.name,
    });
    if (created && item) await announceActionItem(member.client_id, item, { who: owner.name ? ` for ${owner.name}` : "" });
    return item || null;
  } catch (e) {
    // Non-fatal on purpose: failing to RAISE a warning must not also block the
    // owner from recording how a member pays. It is logged loudly instead.
    console.error("[off-card] stop-billing item failed:", e.message);
    return null;
  }
}

async function loadLiveArrangement(memberId) {
  const rows = await sb(
    `member_billing_arrangements?member_id=eq.${encodeURIComponent(memberId)}&status=in.(active,paused)&select=*&limit=1`
  );
  return (Array.isArray(rows) && rows[0]) || null;
}

// ── Action: SET-OFF-CARD ─────────────────────────────────────────────────────
// body: { method, method_note?, anchor_date, amount_cents? | offer_price_id?,
//         grace_days?, lead_days?, collector_client_user_id?, commitment_end_date?,
//         cadence?, term?, note? }
//
// This is the endpoint the drawer toggle must route through, because the flag on
// its own is a CLAIM and the arrangement is the OBLIGATION. A raw field write
// (which is what the toggle did, and what update-profile still allows) sets the
// claim and creates nothing to collect.
//
// The anchor is the one fact the owner supplies that nothing else knows: two
// members on the same "every 4 weeks" plan pay in different weeks and no plan can
// say which. Amount comes from the PLAN when a price row is named, which is what
// keeps the workbook honest about never rendering a dollar box.
async function actionSetOffCard(res, member, ctx, body) {
  const b = body || {};
  const mv = validateMethod(b.method, b.method_note);
  if (!mv.ok) return res.status(400).json({ error: mv.error });
  if (!ocIsDate(b.anchor_date)) {
    return res.status(400).json({ error: "anchor_date must be YYYY-MM-DD - it is the date their next payment is due." });
  }
  if (b.commitment_end_date && !ocIsDate(b.commitment_end_date)) {
    return res.status(400).json({ error: "commitment_end_date must be YYYY-MM-DD" });
  }
  if (await loadLiveArrangement(member.id)) {
    return res.status(400).json({ error: "This member already has a live payment arrangement. End it before starting another." });
  }

  // The plan's own numbers, when a price row is named. select=* on purpose: it
  // cannot 400 over a column this deployment does not have yet, which a named
  // billing_cadence select can (see sbWithCadence in api/website/checkout.js).
  let amount_cents = null, currency = "cad", cadence = null, term = null, offer_price_key = null, cadence_source = "plan";
  if (b.offer_price_id) {
    const prows = await sb(
      `offer_prices?id=eq.${encodeURIComponent(b.offer_price_id)}&tenant_id=eq.${encodeURIComponent(member.client_id)}&select=*&limit=1`
    );
    const p = Array.isArray(prows) && prows[0];
    if (!p) return res.status(400).json({ error: "that price is not on this academy" });
    amount_cents = p.amount_cents;
    currency = p.currency || "cad";
    cadence = p.billing_cadence ?? null;
    offer_price_key = p.source_offer_price_key || null;
    // The term is the half of the price key AFTER the pipe ('Steady|9_months').
    // No list of accepted lengths here, deliberately - ruling D5. intervalFor
    // parses whatever the academy priced.
    term = offer_price_key && offer_price_key.includes("|") ? offer_price_key.split("|").slice(-1)[0] : null;
  }
  if (b.amount_cents != null) amount_cents = Math.round(Number(b.amount_cents));
  if (!Number.isFinite(amount_cents) || amount_cents < 0) {
    return res.status(400).json({ error: "amount_cents required (or name an offer_price_id to take it from the plan)" });
  }
  // A human saying the real rhythm differs from what was sold. Never reconciled
  // silently: it is recorded as an override so it can surface as drift.
  if (b.term != null || b.cadence != null) {
    if (b.term != null) term = String(b.term).trim() || null;
    if (b.cadence != null) cadence = String(b.cadence).trim() || null;
    cadence_source = "override";
  }

  const row = {
    client_id: member.client_id,
    member_id: member.id,
    athlete_name: member.athlete_name || null,
    parent_name: member.parent_name || null,
    method: b.method,
    method_note: b.method_note ? String(b.method_note).trim() : null,
    amount_cents,
    currency,
    offer_id: member.offer_id || null,
    offer_price_key,
    term,
    cadence,
    cadence_source,
    anchor_date: String(b.anchor_date).slice(0, 10),
    grace_days: Number.isFinite(+b.grace_days) ? Math.max(0, Math.min(90, +b.grace_days)) : 3,
    lead_days: Number.isFinite(+b.lead_days) ? Math.max(0, Math.min(60, +b.lead_days)) : 3,
    collector_client_user_id: b.collector_client_user_id || null,
    commitment_end_date: b.commitment_end_date ? String(b.commitment_end_date).slice(0, 10) : null,
    status: "active",
    source: b.source === "workbook" ? "workbook" : "staff",
    note: b.note ? String(b.note).trim() : null,
    created_by: ctx.user?.id || null,
    created_by_name: ctx.staff?.name || ctx.displayName || null,
  };

  const created = await sb(`member_billing_arrangements`, {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row),
  });
  const arrangement = Array.isArray(created) ? created[0] : created;

  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ billing_mode: "alternate", updated_at: nowIso() }),
  });

  // THE GUARD, on the write path that sets the flag deliberately.
  const stopItem = await raiseStopBillingIfSubscribed(member);

  // Activation is what generates the first collection (the staff-confirms rule:
  // nothing generates straight from the workbook).
  const gen = await generateForArrangement(arrangement);

  await writeAudit({
    client_id: member.client_id, member_id: member.id,
    action_type: "off-card-start",
    args: { arrangement_id: arrangement.id, method: row.method, anchor_date: row.anchor_date, amount_cents, term, cadence, cadence_source },
    performed_by: ctx.user?.id || null,
    performed_by_name: ctx.staff?.name || null,
    db_changes: { members: { billing_mode: "-> alternate" }, member_collections: { generated: gen.generated } },
  });

  return res.status(200).json({
    ok: true, arrangement, generated: gen.generated,
    stop_billing_item: stopItem ? { id: stopItem.id, title: stopItem.title } : null,
  });
}

// ── Action: END-OFF-CARD ─────────────────────────────────────────────────────
// Off-card back to card. Future 'due' collections are VOIDED; past ones are
// never touched, because they are the record of money that actually moved.
async function actionEndOffCard(res, member, ctx, body) {
  const arrangement = await loadLiveArrangement(member.id);
  if (arrangement) {
    await sb(`member_billing_arrangements?id=eq.${arrangement.id}&status=in.(active,paused)`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "ended", ended_at: nowIso(),
        ended_reason: (body && body.reason) ? String(body.reason).trim() : "switched back to card billing",
      }),
    });
    // Only what is still OPEN and still in the FUTURE. A due date that has passed
    // stays on the books unpaid: switching payment method does not forgive a debt.
    const openFuture = await sb(
      `member_collections?arrangement_id=eq.${arrangement.id}&status=in.(due,overdue)&due_date=gt.${ocToday()}&select=id,action_item_id`
    ).catch(() => []);
    for (const c of (openFuture || [])) {
      await sb(`member_collections?id=eq.${c.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "void", note: "voided: member moved back to card billing" }),
      }).catch(() => {});
      if (c.action_item_id) {
        await sb(`action_items?id=eq.${c.action_item_id}&completed_at=is.null`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ completed_at: nowIso(), completed_by_name: "FullControl" }),
        }).catch(() => {});
      }
    }
  }
  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ billing_mode: null, updated_at: nowIso() }),
  });
  await writeAudit({
    client_id: member.client_id, member_id: member.id,
    action_type: "off-card-end",
    args: { arrangement_id: arrangement ? arrangement.id : null },
    performed_by: ctx.user?.id || null,
    performed_by_name: ctx.staff?.name || null,
    db_changes: { members: { billing_mode: "alternate -> null" } },
  });
  return res.status(200).json({ ok: true, ended: !!arrangement });
}

// ── Action: MARK-COLLECTED ───────────────────────────────────────────────────
// body: { collection_id, amount_collected_cents, collected_on?, method?,
//         reference?, note?, waive? }
//
// THIS is the step that makes the flag real. Without it the portal is a nag with
// no end state.
//
// collected_on defaults to today and is EDITABLE, because cash arrives late and a
// ledger that records when somebody got round to typing it in is a ledger of
// typing. A PARTIAL never auto-closes: the collection stays open, the action item
// stays open, and the remainder goes in its title.
async function actionMarkCollected(res, member, ctx, body) {
  const b = body || {};
  const cid = String(b.collection_id || "");
  if (!cid) return res.status(400).json({ error: "collection_id required" });

  const rows = await sb(`member_collections?id=eq.${encodeURIComponent(cid)}&select=*&limit=1`);
  const collection = Array.isArray(rows) && rows[0];
  if (!collection) return res.status(404).json({ error: "collection not found" });
  // Scope it to the member being acted on. The row carries no FK to members (by
  // design, so it outlives them), which means this check is the only thing
  // standing between a collection id and somebody else's ledger.
  if (collection.client_id !== member.client_id || collection.member_id !== member.id) {
    return res.status(403).json({ error: "not this member's collection" });
  }
  if (["paid", "waived", "void"].includes(collection.status)) {
    return res.status(400).json({ error: `This one is already ${collection.status}. Correct it with a new entry rather than editing it away.` });
  }

  const settled = settleCollection({
    expected_cents: collection.amount_expected_cents,
    collected_cents: b.amount_collected_cents,
    waive: b.waive === true,
  });
  if (!settled.ok) return res.status(400).json({ error: settled.error });

  const collectedOn = ocIsDate(b.collected_on) ? String(b.collected_on).slice(0, 10) : ocToday();
  if (collectedOn > ocToday()) {
    return res.status(400).json({ error: "collected_on cannot be in the future - record it when it actually arrives." });
  }
  if (b.method != null && !COLLECTION_METHODS.includes(b.method)) {
    return res.status(400).json({ error: `method must be one of: ${COLLECTION_METHODS.join(", ")}` });
  }

  const arrRows = await sb(`member_billing_arrangements?id=eq.${collection.arrangement_id}&select=*&limit=1`);
  const arrangement = (Array.isArray(arrRows) && arrRows[0]) || null;

  const collectedCents = settled.status === "waived" ? 0 : Math.round(Number(b.amount_collected_cents));
  const patch = {
    status: settled.status,
    amount_collected_cents: collectedCents,
    collected_on: settled.status === "waived" ? null : collectedOn,
    method: b.method || (arrangement && arrangement.method) || null,
    marked_by: ctx.user?.id || null,
    marked_by_name: ctx.staff?.name || ctx.displayName || null,
    marked_at: nowIso(),
    reference: b.reference ? String(b.reference).trim() : collection.reference || null,
    note: b.note ? String(b.note).trim() : collection.note || null,
  };
  const updated = await sb(`member_collections?id=eq.${collection.id}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch),
  });
  const after = (Array.isArray(updated) && updated[0]) || null;

  // MIRROR IT ONTO THE ACTION ITEM. The collection row is the truth; the item is
  // a copy. A partial re-titles the OPEN item with what is still owed rather than
  // ticking it, which is the difference between a queue and a queue that quietly
  // empties itself.
  if (collection.action_item_id) {
    if (settled.closes_item) {
      await sb(`action_items?id=eq.${collection.action_item_id}&completed_at=is.null`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          completed_at: nowIso(),
          completed_by_name: patch.marked_by_name || "FullControl",
        }),
      }).catch(() => {});
    } else {
      await sb(`action_items?id=eq.${collection.action_item_id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          title: collectItemTitle({
            amount_cents: collection.amount_expected_cents,
            currency: collection.currency,
            athlete_name: collection.athlete_name,
            parent_name: collection.parent_name,
            due_date: collection.due_date,
            remainder_cents: settled.remainder_cents,
          }),
        }),
      }).catch(() => {});
    }
  }

  // Roll forward: generate whatever the next period is, if its reminder is now
  // within reach. There is deliberately NO next_due_date column to move - the
  // anchor plus the period index answers that question, and one answerer for one
  // question is the rule this whole design was written under.
  let generated = 0;
  if (arrangement && arrangement.status === "active") {
    generated = (await generateForArrangement(arrangement)).generated;
  }

  await writeAudit({
    client_id: member.client_id, member_id: member.id,
    action_type: "off-card-collected",
    args: {
      collection_id: collection.id, period_index: collection.period_index, due_date: collection.due_date,
      amount_expected_cents: collection.amount_expected_cents, amount_collected_cents: collectedCents,
      status: settled.status, remainder_cents: settled.remainder_cents,
      collected_on: patch.collected_on, method: patch.method, reference: patch.reference,
    },
    performed_by: ctx.user?.id || null,
    performed_by_name: patch.marked_by_name,
    db_changes: { member_collections: { id: collection.id, status: `${collection.status} -> ${settled.status}` } },
  });

  return res.status(200).json({ ok: true, collection: after, remainder_cents: settled.remainder_cents, generated });
}

// ── GENERATION ───────────────────────────────────────────────────────────────
// Rows for every period whose REMINDER is now within reach (due_date - lead_days
// <= today). Shared by activation, mark-collected roll-forward, and the cron, so
// there is exactly one implementation of "which periods should exist".
async function generateForArrangement(arrangement) {
  if (!arrangement || arrangement.status !== "active") return { generated: 0 };
  const existing = await sb(
    `member_collections?arrangement_id=eq.${arrangement.id}&select=period_index&order=period_index.desc&limit=1`
  ).catch(() => []);
  const highest = (Array.isArray(existing) && existing[0] && existing[0].period_index) || 0;
  const wanted = periodsDueAsOf(arrangement, { today: ocToday(), highestExisting: highest });
  let generated = 0;
  for (const p of wanted) {
    try {
      await sb(`member_collections`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          client_id: arrangement.client_id,
          arrangement_id: arrangement.id,
          member_id: arrangement.member_id,
          athlete_name: arrangement.athlete_name,
          parent_name: arrangement.parent_name,
          period_index: p.period_index,
          due_date: p.due_date,
          amount_expected_cents: arrangement.amount_cents,
          currency: arrangement.currency || "cad",
          status: "due",
        }),
      });
      generated++;
    } catch (e) {
      // The unique index on (arrangement_id, period_index) is the idempotency,
      // not a check before the insert. A concurrent run losing the race is the
      // expected case, not an error.
      if (!isDuplicateErr(e)) throw e;
    }
  }
  return { generated };
}

// ── CRON: generate + notify ──────────────────────────────────────────────────
// vercel.json: /api/members?action=cron-collect-off-card, daily.
//
// Three phases, in this order and for this reason:
//   A. GENERATE the rows whose reminders are within reach.
//   B. NOTIFY - create the action item at due_date - lead_days, NOT when the row
//      was generated. An item that lands four weeks early is an item the owner
//      learns to ignore, and an ignored reminder is the whole failure this build
//      exists to prevent.
//   C. OVERDUE - flip 'due' to 'overdue' past due_date + grace_days and re-ping
//      once. action_items.due_soon_notified_at is a ONE-SHOT stamp, so the
//      collection carries its own overdue_notified_at or the second ping never
//      fires.
//
// RULING D4 IS AN ABSENCE, and absences are invisible unless named: two missed
// periods does NOTHING here. No auto-cancel, no decision item, no pause of
// generation. The debt keeps accumulating in the open, which is the point.
async function cronCollectOffCard(res) {
  const today = ocToday();
  let generated = 0, notified = 0, overdue = 0;
  const errors = [];

  const arrangements = await sb(
    `member_billing_arrangements?status=eq.active&select=*&order=created_at.asc&limit=500`
  );

  // ── Phase A ──
  for (const a of (arrangements || [])) {
    try { generated += (await generateForArrangement(a)).generated; }
    catch (e) { errors.push({ arrangement_id: a.id, phase: "generate", message: e.message }); }
  }

  const byId = new Map((arrangements || []).map((a) => [a.id, a]));

  // ── Phase B ──
  const pending = await sb(
    `member_collections?status=in.(due,overdue,partial)&notified_at=is.null&select=*&order=due_date.asc&limit=500`
  );
  for (const c of (pending || [])) {
    const a = byId.get(c.arrangement_id);
    if (!a) continue;                              // paused or ended: no new pings
    const lead = Number.isFinite(+a.lead_days) ? +a.lead_days : 3;
    if (ocAddDays(c.due_date, -lead) > today) continue;   // not yet its turn
    try {
      const collector = a.collector_client_user_id
        ? (await sb(`client_users?id=eq.${a.collector_client_user_id}&select=id,name&limit=1`).catch(() => []))
        : [];
      const named = (Array.isArray(collector) && collector[0]) || null;
      // Owner by default (ruling D2); a named collector is the delegation. Either
      // way notifyOwners still texts the owner, so nobody is silently cut out.
      const assignee = named || (await loadOwnerAssignee(a.client_id));
      const { created, item } = await createSystemActionItem({
        client_id: c.client_id,
        system_key: systemKeyForCollection(c.id),
        title: collectItemTitle({
          amount_cents: c.amount_expected_cents, currency: c.currency,
          athlete_name: c.athlete_name, parent_name: c.parent_name, due_date: c.due_date,
          remainder_cents: c.status === "partial" ? Math.max(0, c.amount_expected_cents - c.amount_collected_cents) : 0,
        }),
        description: collectItemDescription({
          method: a.method, method_note: a.method_note,
          collector_name: assignee && assignee.name, cadence_label: cadenceLabel(a),
        }),
        due_date: c.due_date,
        assignee_id: assignee && assignee.id,
        assignee_name: assignee && assignee.name,
      });
      await sb(`member_collections?id=eq.${c.id}&notified_at=is.null`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ notified_at: nowIso(), action_item_id: item ? item.id : null }),
      });
      if (created && item) {
        await announceActionItem(c.client_id, item, { who: assignee && assignee.name ? ` for ${assignee.name}` : "" });
        notified++;
      }
    } catch (e) {
      errors.push({ collection_id: c.id, phase: "notify", message: e.message });
    }
  }

  // ── Phase C ──
  const stillDue = await sb(
    `member_collections?status=eq.due&due_date=lt.${today}&overdue_notified_at=is.null&select=*&limit=500`
  );
  for (const c of (stillDue || [])) {
    const a = byId.get(c.arrangement_id);
    if (!a || !isOverdue(c, a, today)) continue;
    try {
      await sb(`member_collections?id=eq.${c.id}&status=eq.due`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "overdue", overdue_notified_at: nowIso() }),
      });
      const label = `${ocMoney(c.amount_expected_cents, c.currency)} from ${c.parent_name || c.athlete_name || "a member"}`;
      await postOffCardSlack(c.client_id, `Overdue: ${label} was due ${c.due_date} and has not been marked collected. This member pays outside Stripe, so nothing was charged.`);
      overdue++;
    } catch (e) {
      errors.push({ collection_id: c.id, phase: "overdue", message: e.message });
    }
  }

  return res.status(200).json({ ok: true, generated, notified, overdue, errors: errors.slice(0, 20) });
}

// The overdue re-ping. Slack only: the action item already exists and already
// pinged on create, so this is a nudge on the same channel rather than a second
// item nobody asked for. Best-effort, non-throwing.
async function postOffCardSlack(clientId, text) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token || !clientId || !text) return;
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=slack_channel_id`);
    const chan = rows?.[0]?.slack_channel_id;
    if (!chan) return;
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: chan, text, unfurl_links: false }),
    });
  } catch (e) {
    console.error("[off-card] slack notify failed:", e.message);
  }
}

// ─────────────────────────────────────────────────────────
// Cron: process scheduled pauses (runs hourly via vercel.json)
// ─────────────────────────────────────────────────────────
// Two phases:
//   Phase A — Activate: cancellations rows with type='pause' AND
//             activated_at IS NULL AND pause_start <= today.
//             → fetch the sub, compute trial_end per the standard rule,
//               PATCH Stripe, flip members.status='paused', set activated_at.
//   Phase B — Complete: cancellations rows with type='pause' AND
//             activated_at IS NOT NULL AND completed_at IS NULL AND
//             pause_end <= today, AND linked member is currently 'paused'.
//             → flip members.status='live', set completed_at.
//
// Phase B catches ALL pauses (immediate and future-scheduled) that should
// auto-recover when the user's chosen end_date passes — closing the gap
// where members.status='paused' lingered until Stripe's invoice fired.
async function cronProcessScheduledPauses(res) {
  const today = new Date().toISOString().slice(0, 10);
  let activated = 0, completed = 0, activationErrors = 0, completionErrors = 0;
  const errors = [];

  // ── Phase A: activate due pauses ──
  // Idempotency: every Stripe call uses Idempotency-Key=pause-activate-<row.id>
  // so concurrent cron invocations are safe. DB writes use conditional PATCH
  // (PostgREST filter on activated_at=is.null) so only one run "wins" the row.
  const pendingPauses = await sb(
    `cancellations?type=eq.pause&activated_at=is.null&completed_at=is.null&pause_start=lte.${today}&select=id,client_id,member_id,pause_start,pause_end,manual_trial_end,stripe_subscription_id&limit=100`
  );
  for (const row of (pendingPauses || [])) {
    try {
      // Load member to get connected account + current state
      const memberRows = await sb(`members?id=eq.${row.member_id}&select=*`);
      const member = Array.isArray(memberRows) && memberRows[0];
      if (!member || !member.stripe_subscription_id) {
        // Member gone (cancelled) — close the pause row, conditional on still-pending
        await sb(`cancellations?id=eq.${row.id}&activated_at=is.null`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ activated_at: nowIso(), completed_at: nowIso(), reason: "skipped — no member or sub" }),
        });
        continue;
      }
      const clientRows = await sb(`clients?id=eq.${member.client_id}&select=stripe_connect_account_id`);
      const stripeAccount = clientRows?.[0]?.stripe_connect_account_id || null;
      if (!stripeAccount) {
        errors.push({ row_id: row.id, phase: "activate", message: "no stripe_connect_account_id on client" });
        activationErrors++;
        continue;
      }

      const currentSub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, { stripeAccount });

      // Compute trial_end using the standard rule. Use nowUnix() (not todayUnix)
      // so we don't shrink the pause length by up to 24h when running mid-day.
      // Manual next-payment date (staff-set) wins over the computed trial_end.
      const pauseLengthSeconds = isoToUnix(row.pause_end) - isoToUnix(row.pause_start);
      const anchor = Math.max(nowUnix(), subCurrentPeriodEnd(currentSub) || 0);
      let trialEndUnix = row.manual_trial_end ? isoToUnix(row.manual_trial_end) : anchor + pauseLengthSeconds;
      const stripeCap = nowUnix() + STRIPE_TRIAL_MAX_SECS;
      const capped = trialEndUnix > stripeCap;
      if (capped) trialEndUnix = stripeCap;

      // Stripe call with idempotency key — concurrent runs collapse to one effect.
      await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
        method: "POST",
        stripeAccount,
        body: { trial_end: String(trialEndUnix), proration_behavior: "none", "pause_collection": "" },
        idempotencyKey: `pause-activate-${row.id}`,
      });

      // Claim the row atomically. If another run already claimed it, the PATCH
      // returns no rows — skip the member status update + audit.
      const claimRows = await sb(`cancellations?id=eq.${row.id}&activated_at=is.null`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ activated_at: nowIso() }),
      });
      if (!Array.isArray(claimRows) || claimRows.length === 0) {
        // Another concurrent cron run claimed this row first — skip the rest.
        continue;
      }

      // Flip member status + clear scheduled_for (idempotent: re-running is fine)
      await sb(`members?id=eq.${member.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "paused", pause_scheduled_for: null, updated_at: nowIso() }),
      });

      // Offer tie-in F: mirror the paused state onto membership + entitlements.
      await syncMemberAccessNonFatal({ clientId: member.client_id, memberId: member.id, reason: "portal-action" });

      await writeAudit({
        client_id: member.client_id,
        member_id: member.id,
        action_type: "cron-pause-activated",
        args: { cancellations_id: row.id, pause_start: row.pause_start, pause_end: row.pause_end },
        stripe_response: { id: currentSub.id, trial_end: trialEndUnix, capped_to_stripe_max: capped },
        db_changes: { members: { status: "live → paused", pause_scheduled_for: "cleared" } },
      });

      activated++;
    } catch (e) {
      activationErrors++;
      errors.push({ row_id: row.id, phase: "activate", message: e.message });
    }
  }

  // ── Phase B: complete ended pauses ──
  // Same pattern: conditional PATCH on completed_at=is.null. Member status
  // flip is idempotent (only writes if currently 'paused').
  const dueToComplete = await sb(
    `cancellations?type=eq.pause&activated_at=not.is.null&completed_at=is.null&pause_end=lte.${today}&select=id,client_id,member_id,pause_end&limit=200`
  );
  for (const row of (dueToComplete || [])) {
    try {
      // Claim the row atomically.
      const claimRows = await sb(`cancellations?id=eq.${row.id}&completed_at=is.null`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ completed_at: nowIso() }),
      });
      if (!Array.isArray(claimRows) || claimRows.length === 0) continue;

      const memberRows = await sb(`members?id=eq.${row.member_id}&select=id,client_id,status,stripe_subscription_id`);
      const member = Array.isArray(memberRows) && memberRows[0];

      // Member row gone — pause already cleaned up implicitly.
      if (!member) {
        await writeAudit({
          client_id: row.client_id,
          member_id: row.member_id,
          action_type: "cron-pause-completed",
          args: { cancellations_id: row.id, pause_end: row.pause_end },
          stripe_response: null,
          db_changes: { members: "row gone (cancelled)" },
        });
        completed++;
        continue;
      }

      // Only flip to 'live' if still 'paused' AND there's a real subscription to
      // resume. A no-sub paused member (e.g. pause-date-fix, no Stripe) has nothing
      // to bill — flipping them 'live' would falsely show an active member paying $0.
      // Leave them paused; the pause row is still completed so it stops re-triggering.
      let flipped = false;
      if (member.status === "paused" && member.stripe_subscription_id) {
        await sb(`members?id=eq.${member.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "live", updated_at: nowIso() }),
        });
        flipped = true;
        // Offer tie-in F: reactivate membership + entitlements with the member.
        await syncMemberAccessNonFatal({ clientId: member.client_id, memberId: member.id, reason: "portal-action" });
      }

      await writeAudit({
        client_id: member.client_id,
        member_id: member.id,
        action_type: "cron-pause-completed",
        args: { cancellations_id: row.id, pause_end: row.pause_end },
        stripe_response: null,
        db_changes: { members: flipped ? { status: "paused → live" } : { status: `unchanged (${member.status})` } },
      });

      completed++;
    } catch (e) {
      completionErrors++;
      errors.push({ row_id: row.id, phase: "complete", message: e.message });
    }
  }

  console.log(`[cron-process-scheduled-pauses] activated=${activated} completed=${completed} errors=${activationErrors + completionErrors}`);
  const anyErrors = activationErrors + completionErrors > 0;
  return res.status(anyErrors ? 500 : 200).json({
    ok: !anyErrors,
    activated, completed, activationErrors, completionErrors, errors,
  });
}

export default withSentryApiRoute(handler);
