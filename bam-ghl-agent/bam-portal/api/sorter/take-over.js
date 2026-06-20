import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 60; // Stripe reads + sub write

// Vercel Serverless Function — "Take over billing" for an imported member.
//
// Moves an EXISTING member onto a PORTAL-OWNED Stripe subscription so the portal
// can manage + automate it (the 6 member actions reject on foreign CoachIQ/GHL/
// dashboard subs — "not created by your application"). We CREATE the new sub here
// (the portal can); the OLD foreign sub must be cancelled by hand afterward
// (Stripe blocks the portal from cancelling another app's sub — see
// memories/project_stripe_app_created_subs.md). The UI surfaces a deep link for
// that and reads Stripe to confirm it's gone.
//
// Safety:
//   • GRANDFATHER by default — the new sub bills the member's CURRENT amount +
//     interval (a portal-owned inline price), so nobody's price changes silently.
//     Pass body.price_id to bill a specific catalog price instead (e.g. canonical).
//   • Anchored to their NEXT-PAYMENT date (trial_end) → no gap, no double charge.
//   • metadata.import_silent=1 → the webhook flips them live but suppresses the
//     whole welcome side (no GHL workflow / welcome emails / "new signup" SMS,
//     no CoachIQ re-grant). They're existing members, not new signups.
//
// POST mode=preview { client_id, member_id }
//   → { current_amount_cents, currency, interval, first_charge_iso,
//       card_last4 | needs_card, payment_link?, old_sub_id }   (no writes)
//
// POST mode=create  { client_id, member_id, first_charge_date?, price_id? }
//   → creates the portal sub (reuse default card; refuses if no card). Patches the
//     member's stripe_subscription_id → the new sub. Returns { new_sub_id, old_sub_id }.
//
// Auth: resolveUser() — staff (any academy) or a client_users member of client_id.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

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

// The old sub's next charge → anchor for the new sub's first charge (no gap/double-bill).
function nextChargeUnix(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  if (sub && sub.status === "trialing" && sub.trial_end) return sub.trial_end;
  return (item && item.current_period_end) || sub.current_period_end || null;
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
    if (!body.member_id) return res.status(400).json({ error: "member_id required" });

    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=stripe_connect_account_id&limit=1`);
    const acct = Array.isArray(clientRows) && clientRows[0] && clientRows[0].stripe_connect_account_id;
    if (!acct) return res.status(409).json({ error: "academy not connected to Stripe" });

    // verify-cancel: did staff actually cancel the old foreign sub yet? The portal
    // can READ it (only writes are blocked) → poll this to auto-green the row.
    if (body.mode === "verify-cancel") {
      const target = body.old_sub_id;
      if (!target) return res.status(400).json({ error: "old_sub_id required" });
      let s = null;
      try { s = await stripeFetch(`/subscriptions/${encodeURIComponent(target)}`, { stripeAccount: acct }); }
      catch (e) { if (e.stripeStatus === 404) return res.status(200).json({ ok: true, cancelled: true, status: "deleted" }); throw e; }
      const cancelled = s.status === "canceled" || (!!s.canceled_at && s.status !== "active" && s.status !== "trialing");
      return res.status(200).json({ ok: true, cancelled, status: s.status, cancel_at_period_end: !!s.cancel_at_period_end });
    }

    const memberRows = await sb(
      `members?id=eq.${encodeURIComponent(body.member_id)}&client_id=eq.${encodeURIComponent(clientId)}` +
      `&select=id,athlete_name,plan,stripe_customer_id,stripe_subscription_id,stripe_price_id,coachiq_member_id&limit=1`
    );
    const member = Array.isArray(memberRows) && memberRows[0];
    if (!member) return res.status(404).json({ error: "member not found for this academy" });
    const customerId = body.customer_id || member.stripe_customer_id;
    if (!customerId) return res.status(409).json({ error: "member has no Stripe customer" });
    const oldSubId = body.old_sub_id || member.stripe_subscription_id || null;

    // The member's CURRENT sub — grandfather amount + interval + next-charge anchor.
    let oldSub = null;
    if (oldSubId) {
      try { oldSub = await stripeFetch(`/subscriptions/${encodeURIComponent(oldSubId)}?expand[]=items.data.price.product`, { stripeAccount: acct }); }
      catch (_) { oldSub = null; }
    }
    const oldItem = oldSub && oldSub.items && oldSub.items.data && oldSub.items.data[0];
    const oldPrice = oldItem && oldItem.price;
    const curAmount = oldPrice ? oldPrice.unit_amount : null;
    const curCurrency = (oldPrice && oldPrice.currency) || "cad";
    const curInterval = oldPrice && oldPrice.recurring ? oldPrice.recurring.interval : "week";
    const curIntervalCount = (oldPrice && oldPrice.recurring && oldPrice.recurring.interval_count) || (curInterval === "week" ? 4 : 1);
    const oldProductName = (oldPrice && oldPrice.product && typeof oldPrice.product === "object" && oldPrice.product.name) || member.plan || "Membership";

    // Anchor: explicit override → else the old sub's next charge → else now+60s.
    let anchor = Math.floor(Date.now() / 1000) + 60;
    const nat = nextChargeUnix(oldSub);
    if (nat) anchor = Math.max(nat, anchor);
    if (body.first_charge_date) {
      const fd = new Date(body.first_charge_date);
      if (!isNaN(fd.getTime())) anchor = Math.max(Math.floor(fd.getTime() / 1000), Math.floor(Date.now() / 1000) + 60);
    }
    const anchorIso = new Date(anchor * 1000).toISOString().slice(0, 10);

    // Reusable card? prefer the customer's default PM, else any attached card.
    const cust = await stripeFetch(`/customers/${encodeURIComponent(customerId)}?expand[]=invoice_settings.default_payment_method`, { stripeAccount: acct });
    let defaultPm = cust.invoice_settings && cust.invoice_settings.default_payment_method;
    let last4 = defaultPm && defaultPm.card && defaultPm.card.last4;
    if (!defaultPm) {
      const pms = await stripeFetch(`/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=1`, { stripeAccount: acct });
      const pm = pms.data && pms.data[0];
      if (pm) { defaultPm = pm.id; last4 = pm.card && pm.card.last4; }
    } else {
      defaultPm = defaultPm.id || defaultPm;
    }

    if (body.mode === "preview" || !body.mode) {
      let payment_link = null;
      if (!defaultPm) {
        // No card → mark "collecting payment" + a setup Checkout link staff can send.
        try {
          await sb(`members?id=eq.${encodeURIComponent(member.id)}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ status: "payment_method_required", updated_at: new Date().toISOString() }),
          }).catch(() => {});
          const origin = (req.headers.origin || "https://portal.byanymeansbusiness.com").replace(/\/+$/, "");
          const sess = await stripeFetch(`/checkout/sessions`, {
            method: "POST", stripeAccount: acct,
            body: { mode: "setup", customer: customerId, success_url: `${origin}/client-portal.html?card=saved`, cancel_url: `${origin}/client-portal.html?card=cancelled` },
          });
          payment_link = sess.url || null;
        } catch (_) {}
      }
      return res.status(200).json({
        ok: true, mode: "preview", member_id: member.id, old_sub_id: oldSubId,
        old_sub_origin: (oldSub && oldSub.application) || null,
        current_amount_cents: curAmount, currency: curCurrency,
        interval: curIntervalCount > 1 ? `${curIntervalCount} ${curInterval}` : curInterval,
        first_charge: anchor, first_charge_iso: anchorIso,
        card_last4: last4 || null, needs_card: !defaultPm, payment_link,
      });
    }

    // ── create ──
    if (!defaultPm) {
      return res.status(409).json({ error: "No card on file — collect one with the card link first (member is 'collecting payment')." });
    }
    if (curAmount == null && !body.price_id) {
      return res.status(409).json({ error: "Couldn't read the member's current price to grandfather. Pass price_id to bill a specific price." });
    }

    // Bill price: explicit catalog price_id, else a portal-owned inline price at the
    // member's CURRENT amount + interval (grandfather — no silent price change).
    const subBody = {
      customer: customerId,
      trial_end: anchor,
      default_payment_method: defaultPm,
      "payment_settings[save_default_payment_method]": "on_subscription",
      "metadata[origin]": "fullcontrol-portal",
      "metadata[import_silent]": "1",
      "metadata[plan]": member.plan || undefined,
      "metadata[client_id]": clientId,
      "metadata[member_id]": member.id,
      "metadata[prior_sub_id]": oldSubId || undefined,
    };
    let billedPriceId = null;
    if (body.price_id) {
      subBody["items[0][price]"] = body.price_id;
      billedPriceId = body.price_id;
    } else {
      subBody["items[0][price_data][currency]"] = curCurrency;
      subBody["items[0][price_data][unit_amount]"] = curAmount;
      subBody["items[0][price_data][recurring][interval]"] = curInterval;
      subBody["items[0][price_data][recurring][interval_count]"] = curIntervalCount;
      subBody["items[0][price_data][product_data][name]"] = oldProductName;
    }

    const sub = await stripeFetch(`/subscriptions`, {
      method: "POST", stripeAccount: acct,
      idempotencyKey: `takeover-${clientId}-${member.id}-${oldSubId || "none"}-${anchor}`.slice(0, 200),
      body: subBody,
    });

    // Point the member at the new portal sub (the old one gets cancelled by hand).
    const patch = { stripe_subscription_id: sub.id, updated_at: new Date().toISOString() };
    if (billedPriceId) patch.stripe_price_id = billedPriceId;
    await sb(`members?id=eq.${encodeURIComponent(member.id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
    }).catch(() => {});

    // Audit (non-fatal).
    try {
      await sb(`member_audit_log`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id: clientId, member_id: member.id,
          action_type: "billing-taken-over",
          args: { new_sub_id: sub.id, old_sub_id: oldSubId, billed_price_id: billedPriceId, grandfathered_amount_cents: billedPriceId ? null : curAmount, first_charge: anchorIso, status: sub.status },
          performed_by_name: "Member import — take over billing",
        }]),
      });
    } catch (_) {}

    return res.status(200).json({
      ok: true, mode: "create", member_id: member.id,
      new_sub_id: sub.id, old_sub_id: oldSubId, status: sub.status,
      first_charge: anchor, first_charge_iso: anchorIso,
      amount_cents: curAmount, card_last4: last4 || null,
      // The old sub can't be cancelled via API (foreign app) — staff cancels by hand.
      cancel_old_url: oldSubId ? `https://dashboard.stripe.com/${acct}/subscriptions/${oldSubId}` : null,
    });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
