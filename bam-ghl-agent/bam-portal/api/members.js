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

const PLAN_TO_PRICE = {
  "1/wk":   "plan_ToNwa96lQ5I1Bs",   // Steady       $226 / 4-wk all-in
  "2/wk":   "plan_ThYK86w2Zd8fp3",   // Accelerated  $316 / 4-wk all-in
  "3/wk":   "plan_U3CUUJkzgyTjel",   // Elevate      $378 / 4-wk all-in
  "unlmtd": "plan_U3CFSoR1LdyGlb",   // Dominate     $638 / 4-wk all-in
};
const PLAN_TIER = { "1/wk": 1, "2/wk": 2, "3/wk": 3, "unlmtd": 4 };
const VALID_PLANS = Object.keys(PLAN_TO_PRICE);

// 720 days = "essentially forever, but recoverable". Just under Stripe's
// 730-day (2yr) cap — gives a buffer + Stripe pings via
// customer.subscription.trial_will_end 3 days before expiry.
const PAUSE_INDEFINITE_DAYS = 720;

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
      `clients?id=in.(${clientIds.join(",")})&select=id,business_name,stripe_connect_account_id,stripe_connect_status`
    ) || [];
  }

  return { user, staff: staffRow, clients, memberships: memberships || [] };
}

// ─────────────────────────────────────────────────────────
// Stripe helper — platform key + connected-account header
// ─────────────────────────────────────────────────────────

async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  // Platform key — required for connected-account writes (Stripe-Account header).
  // Falls back to STRIPE_SECRET_KEY if STRIPE_CONNECT_SECRET_KEY isn't set.
  const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = {
    Authorization: `Bearer ${stripeSecret}`,
  };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let encoded;
  if (body) {
    encoded = typeof body === "string"
      ? body
      : new URLSearchParams(
          // Allow nested params Stripe expects like items[0][price]
          Object.entries(body).reduce((acc, [k, v]) => {
            if (v !== undefined && v !== null) acc[k] = String(v);
            return acc;
          }, {})
        ).toString();
  }

  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe ${res.status}`);
    err.stripeResponse = json;
    err.stripeStatus = res.status;
    throw err;
  }
  return json;
}

// ─────────────────────────────────────────────────────────
// Audit helper
// ─────────────────────────────────────────────────────────

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

export default async function handler(req, res) {
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
    const rows = await sb(`clients?id=eq.${encodeURIComponent(targetClientId)}&select=id,business_name,stripe_connect_account_id,stripe_connect_status`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // ════════════════════════════════════════════════════════
  // GET — list or single
  // ════════════════════════════════════════════════════════
  if (req.method === "GET") {
    try {
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
            const sub = await stripeFetch(
              `/subscriptions/${member.stripe_subscription_id}?expand[]=items.data.price.product&expand[]=latest_invoice`,
              { stripeAccount: client.stripe_connect_account_id }
            );
            const item = sub.items?.data?.[0];
            stripe = {
              status: sub.status,
              trial_end: sub.trial_end,
              current_period_end: sub.current_period_end,
              cancel_at_period_end: sub.cancel_at_period_end,
              price_id: item?.price?.id || null,
              amount_cents: item?.price?.unit_amount || null,
              currency: (item?.price?.currency || "cad").toLowerCase(),
              interval: item?.price?.recurring?.interval || null,
              interval_count: item?.price?.recurring?.interval_count || null,
              latest_invoice_url: sub.latest_invoice?.hosted_invoice_url || null,
            };
          } catch (e) {
            stripe = { error: e.message };
          }
        }

        // History — recent audit rows for this member
        const history = await sb(
          `member_audit_log?member_id=eq.${id}&select=action_type,args,performed_by_name,created_at&order=created_at.desc&limit=10`
        ).catch(() => []);

        return res.status(200).json({ member, stripe, history });
      }

      // ─── List ────────────────────────────────────────────────────
      let query;
      let targetClientId = null;
      if (isStaff && !req.query.client_id) {
        query = `members?select=*&order=athlete_name.asc`;
      } else {
        targetClientId = resolveTargetClient();
        if (!targetClientId) return res.status(403).json({ error: "no academy in scope" });
        query = `members?client_id=eq.${targetClientId}&select=*&order=athlete_name.asc`;
      }
      const members = await sb(query);

      const targetClient = targetClientId ? await loadClientRow(targetClientId) : null;
      return res.status(200).json({
        members: Array.isArray(members) ? members : [],
        stripe: {
          client_id: targetClientId,
          status: targetClient?.stripe_connect_status || "not_connected",
          account_id: targetClient?.stripe_connect_account_id || null,
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

    // Load the academy's client row → connect account
    const client = await loadClientRow(member.client_id);
    if (!client) return res.status(404).json({ error: "academy not found" });
    if (!client.stripe_connect_account_id || client.stripe_connect_status !== "connected") {
      return res.status(400).json({
        error: "Stripe not connected for this academy. Click 'Connect Stripe' on the Members tab first.",
      });
    }
    const stripeAccount = client.stripe_connect_account_id;

    // Dispatch
    try {
      switch (action) {
        case "pause":         return await actionPause(res, member, stripeAccount, ctx, body);
        case "unpause":       return await actionUnpause(res, member, stripeAccount, ctx, body);
        case "cancel":        return await actionCancel(res, member, stripeAccount, ctx, body);
        case "refund":        return await actionRefund(res, member, stripeAccount, ctx, body);
        case "change":        return await actionChange(res, member, stripeAccount, ctx, body);
        case "payment-link":  return await actionPaymentLink(res, member, stripeAccount, ctx, body, req);
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
// body: { duration: "indefinite" } | { until: "YYYY-MM-DD" } | { weeks: N } | reason?
// Sets Stripe sub trial_end (never pause_collection). Indefinite = 720 days.
// Writes a cancellations row (type='pause'), flips members.status='paused'.
async function actionPause(res, member, stripeAccount, ctx, body) {
  if (!member.stripe_subscription_id) {
    return res.status(400).json({ error: "member has no Stripe subscription to pause" });
  }

  let trialEndUnix;
  let resumeDate = null;
  if (body.until) {
    trialEndUnix = isoToUnix(body.until);
    resumeDate = String(body.until).slice(0, 10);
  } else if (body.weeks) {
    const weeks = Number(body.weeks);
    if (!Number.isFinite(weeks) || weeks < 1) {
      return res.status(400).json({ error: "weeks must be a positive number" });
    }
    trialEndUnix = nowUnix() + weeks * 7 * 86400;
    resumeDate = unixToDateStr(trialEndUnix);
  } else {
    // indefinite (default)
    trialEndUnix = nowUnix() + PAUSE_INDEFINITE_DAYS * 86400;
  }

  // Stripe: set trial_end + clear pause_collection if it was set
  const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    method: "POST",
    stripeAccount,
    body: {
      trial_end: String(trialEndUnix),
      proration_behavior: "none",
      "pause_collection": "",
    },
  });

  // DB writes
  const dbChanges = {};
  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "paused", updated_at: nowIso() }),
  });
  dbChanges.members = { id: member.id, status: "paused" };

  await sb(`cancellations`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      client_id: member.client_id,
      member_id: member.id,
      athlete_name: member.athlete_name,
      archetype: member.archetype,
      parent_name: member.parent_name,
      type: "pause",
      pause_start: unixToDateStr(nowUnix()),
      pause_end: resumeDate,
      reason: body.reason || null,
      stripe_subscription_id: member.stripe_subscription_id,
      stripe_customer_id: member.stripe_customer_id,
    }]),
  });
  dbChanges.cancellations = "inserted";

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "pause",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: sub.id, status: sub.status, trial_end: sub.trial_end },
    db_changes: dbChanges,
  });

  return res.status(200).json({
    ok: true,
    member: { id: member.id, status: "paused" },
    sub: { id: sub.id, status: sub.status, trial_end: sub.trial_end, resume_date: resumeDate },
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

  let resumeNow = !body.new_until;
  let newTrialEnd = null;
  let stripeBody;
  if (resumeNow) {
    // Clear trial_end → sub resumes now, next charge happens immediately per Stripe behavior.
    stripeBody = { "trial_end": "now", proration_behavior: "none" };
  } else {
    newTrialEnd = isoToUnix(body.new_until);
    stripeBody = { trial_end: String(newTrialEnd), proration_behavior: "none" };
  }

  const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    method: "POST",
    stripeAccount,
    body: stripeBody,
  });

  const dbChanges = {};
  if (resumeNow) {
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "live", updated_at: nowIso() }),
    });
    dbChanges.members = { id: member.id, status: "live" };

    // Close any open pause row (pause_end = today) for this member
    await sb(
      `cancellations?member_id=eq.${member.id}&type=eq.pause&pause_end=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ pause_end: unixToDateStr(nowUnix()) }),
      }
    ).catch(() => {});
    dbChanges.cancellations = "pause closed";
  } else {
    // Update the pause_end on the open pause row
    await sb(
      `cancellations?member_id=eq.${member.id}&type=eq.pause&pause_end=is.null`,
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
    action_type: "unpause",
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
// Cancels the Stripe sub, inserts a cancellations row (type='cancel'),
// DELETES the row from members. The cancellations row preserves the
// athlete/parent info (denormalized).
async function actionCancel(res, member, stripeAccount, ctx, body) {
  let sub = null;
  if (member.stripe_subscription_id) {
    if (body.immediate) {
      sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
        method: "DELETE",
        stripeAccount,
      });
    } else {
      sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
        method: "POST",
        stripeAccount,
        body: { "cancel_at_period_end": "true" },
      });
    }
  }

  // Insert cancellations row
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
      cancel_date: unixToDateStr(nowUnix()),
      reason: body.reason || null,
      stripe_subscription_id: member.stripe_subscription_id,
      stripe_customer_id: member.stripe_customer_id,
    }]),
  });

  // Delete the members row (cancellations holds the historical record).
  await sb(`members?id=eq.${member.id}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "cancel",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: sub ? { id: sub.id, status: sub.status, cancel_at_period_end: sub.cancel_at_period_end } : null,
    db_changes: { cancellations: "inserted", members: "deleted" },
  });

  return res.status(200).json({
    ok: true,
    member: { id: member.id, deleted: true },
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

  return res.status(200).json({
    ok: true,
    refund: { id: refund.id, amount_cents: refund.amount, status: refund.status },
  });
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
  const newPlan = body.new_plan;
  if (!VALID_PLANS.includes(newPlan)) {
    return res.status(400).json({ error: `new_plan must be one of: ${VALID_PLANS.join(", ")}` });
  }
  if (newPlan === member.plan) {
    return res.status(400).json({ error: `already on ${newPlan}` });
  }
  const newPriceId = PLAN_TO_PRICE[newPlan];

  // Fetch current sub to get the item id
  const currentSub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    stripeAccount,
  });
  const itemId = currentSub.items?.data?.[0]?.id;
  if (!itemId) {
    return res.status(400).json({ error: "Stripe sub has no items — manual fix needed" });
  }

  const isUpgrade = (PLAN_TIER[newPlan] || 0) > (PLAN_TIER[member.plan] || 0);
  const proration = isUpgrade && body.prorate ? "create_prorations" : "none";

  const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    method: "POST",
    stripeAccount,
    body: {
      "items[0][id]": itemId,
      "items[0][price]": newPriceId,
      proration_behavior: proration,
    },
  });

  // Update members.plan
  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ plan: newPlan, updated_at: nowIso() }),
  });

  await writeAudit({
    client_id: member.client_id,
    member_id: member.id,
    action_type: "change",
    args: body,
    performed_by: ctx.user.id,
    performed_by_name: ctx.staff?.name || null,
    stripe_response: { id: sub.id, status: sub.status, price_id: newPriceId },
    db_changes: { members: { id: member.id, plan: { from: member.plan, to: newPlan } } },
  });

  return res.status(200).json({
    ok: true,
    member: { id: member.id, plan: newPlan },
    sub: { id: sub.id, status: sub.status, new_price_id: newPriceId },
    prorated: proration === "create_prorations",
    direction: isUpgrade ? "upgrade" : "downgrade",
  });
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

  return res.status(200).json({
    ok: true,
    url: session.url,
    expires_at: session.expires_at || null,
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
  const anchor = currentSub.trial_end || currentSub.current_period_end || nowUnix();
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
]);

async function actionUpdateProfile(res, member, ctx, body) {
  const fields = (body.fields && typeof body.fields === "object") ? body.fields : {};
  const updates = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!PROFILE_EDITABLE_FIELDS.has(k)) continue;
    // Empty string → null (so "pick — " clears the field).
    updates[k] = (v === "" || v === undefined) ? null : v;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "no editable fields provided" });
  }
  updates.updated_at = nowIso();

  const rows = await sb(`members?id=eq.${member.id}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  const updated = Array.isArray(rows) && rows[0] ? rows[0] : null;

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

  return res.status(200).json({ ok: true, member: updated });
}
