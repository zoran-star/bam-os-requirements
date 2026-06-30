import { withSentryApiRoute } from "./_sentry.js";
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
const PORTAL_OWNED_ORIGINS = new Set(["fullcontrol-portal", "fullcontrol-website-enrollment"]);

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
            };

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
      const memberList = Array.isArray(members) ? members : [];

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
                  const t = String(c.length || "").toLowerCase();
                  const term = (/3\s*month/.test(t) || /\b12\s*week/.test(t)) ? "3_months"
                    : ((/6\s*month/.test(t) || /\b24\s*week/.test(t)) ? "6_months" : null);
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

    // Load the academy's client row → connect account
    const client = await loadClientRow(member.client_id);
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
        idempotencyKey: `pause-immediate-${newRowId}`,
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
    // Flip status to live + clear any scheduled-for marker
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "live", pause_scheduled_for: null, updated_at: nowIso() }),
    });
    dbChanges.members = { id: member.id, status: "live", pause_scheduled_for: null };

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
  let stripeManaged = false;
  if (member.stripe_subscription_id) {
    try {
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
      stripeManaged = true;
    } catch (e) {
      // The sub may be foreign (CoachIQ/GHL/dashboard-created → not app-created,
      // so we can't manage it) or already gone. Still let the member come OFF the
      // roster - portal-side cancel only; the academy handles the external sub.
      // Re-throw anything that isn't one of those expected "can't manage" cases.
      const em = (e && e.message) || "";
      if (!/not created by your application|No such subscription|resource_missing/i.test(em)) throw e;
      console.error("cancel: Stripe sub not manageable, portal-side cancel only:", em);
    }
  }

  // Insert cancellations row (always — captures intent + audit trail)
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
    targetRow = byPrice.get(body.new_price_id);
    if (!targetRow) {
      return res.status(400).json({ error: "that price isn't in this academy's catalog" });
    }
    if (targetRow.is_routable !== true) {
      return res.status(400).json({ error: "that price isn't a live (sellable) price" });
    }
    newPriceId = body.new_price_id;
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
  if (member.stripe_price_id && member.stripe_price_id === newPriceId) {
    return res.status(400).json({ error: `already on ${newPlan}` });
  }

  // Stripe can't swap a subscription item across billing intervals (e.g. a
  // 3-month sub onto a 4-week price). Block it with a clear message instead of
  // letting the raw Stripe error bubble up.
  const currentRow = member.stripe_price_id ? byPrice.get(member.stripe_price_id) : null;
  if (currentRow && targetRow && currentRow.interval && targetRow.interval
      && currentRow.interval !== targetRow.interval) {
    return res.status(400).json({
      error: `Can't swap across billing intervals (current ${currentRow.interval}, new ${targetRow.interval}). Cancel and recreate the subscription instead.`,
    });
  }

  // Fetch current sub to get the item id
  const currentSub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    stripeAccount,
  });
  const itemId = currentSub.items?.data?.[0]?.id;
  if (!itemId) {
    return res.status(400).json({ error: "Stripe sub has no items - manual fix needed" });
  }

  // Optional: staff sets when the NEXT payment should land (Stripe trial_end).
  // Pushes the next charge to that date; no charge happens until then. When set,
  // proration is forced off (trial + prorations don't combine cleanly).
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
  const proration = (trialEndUnix == null && isUpgrade && body.prorate) ? "create_prorations" : "none";

  const updateBody = {
    "items[0][id]": itemId,
    "items[0][price]": newPriceId,
    proration_behavior: proration,
  };
  if (trialEndUnix != null) updateBody.trial_end = String(trialEndUnix);

  const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
    method: "POST",
    stripeAccount,
    body: updateBody,
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
    stripe_response: { id: sub.id, status: sub.status, price_id: newPriceId, trial_end: sub.trial_end || null },
    db_changes: { members: { id: member.id, plan: { from: member.plan, to: newPlan } } },
  });

  return res.status(200).json({
    ok: true,
    member: { id: member.id, plan: newPlan },
    sub: { id: sub.id, status: sub.status, new_price_id: newPriceId },
    prorated: proration === "create_prorations",
    direction: isUpgrade ? "upgrade" : "downgrade",
    next_payment_set: trialEndUnix != null,
    next_payment: trialEndUnix != null ? trialEndUnix : subCurrentPeriodEnd(sub),
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
  const suggestedEmailSubject = `Update your card on file — ${academyName}`;
  const suggestedEmailHtml =
    `<p>Hi${member.parent_name ? ` ${member.parent_name.split(/\s+/)[0]}` : ""},</p>` +
    `<p>Here's the link to update your card with ${academyName}:</p>` +
    `<p><a href="${session.url}">${session.url}</a></p>` +
    `<p>Thanks!<br>${academyName}</p>`;

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
      // location_id present → academy is wired to GHL → SMS/Email send is possible.
      // Front-end still has to call /api/ghl/send-message which does the contact
      // lookup + actual send.
      ready:       Boolean(academyGhl),
      location_id: academyGhl,
    },
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
    await sb(`members?id=eq.${member.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "payment_method_required", updated_at: nowIso() }),
    }).catch(() => {});
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
  return res.status(200).json({
    ok: true, url: session.url, expires_at: session.expires_at || null,
    parent: { name: member.parent_name || null, phone: member.parent_phone || null, email: member.parent_email || null },
    ghl: { ready: Boolean(ctx.client?.ghl_location_id), location_id: ctx.client?.ghl_location_id || null },
    suggested: {
      sms_text: suggestedSms,
      email_subject: `Add your card on file — ${academyName}`,
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
