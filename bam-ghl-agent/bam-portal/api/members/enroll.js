import { withSentryApiRoute } from "../_sentry.js";
import { applyDiscountToCents, normCode, couponFromPromo } from "../_coupon-guardrails.js";
export const maxDuration = 60; // Stripe search + customer + sub writes

// Vercel Serverless Function - Returning Client Enroll (Members V2)
//
// Signs an EXISTING Stripe customer (an old client who has paid this academy
// before) onto a live offer price without the public checkout. Two doors:
//   - saved card  -> portal-owned subscription created directly (charge now,
//                    or trial_end-anchored to a chosen start date)
//   - no card     -> pending member (payment_method_required) + a mode:'setup'
//                    Checkout link to collect a card; staff re-run the flow
//                    once the card is saved and it completes the signup.
//
// POST /api/members/enroll   body: { action, client_id, ... }
//   action=find-customer { q }
//     -> { customers: [{ id, name, email, phone, created_iso, has_default_pm,
//          on_roster, past_member, contact }] }
//   action=targets
//     -> { targets: [{ key, label, amount_cents, currency, interval, offer_id }] }
//   action=preview { customer_id, offer_price_key }
//     -> { price, card_last4, needs_card, duplicates }
//   action=check-coupon { offer_price_key, code }
//     -> { coupon: { code, label, discount_cents, discounted_cents, plan_cents } }
//   action=enroll { customer_id, offer_price_key, athlete_name, parent_name?,
//                   parent_email?, parent_phone?, charge_mode: 'now'|'on_date',
//                   start_date?, coupon_code?, consent_confirmed: true }
//     -> door A: { ok, mode: 'charged'|'scheduled', member_id, subscription_id, ... }
//     -> door B: { ok, mode: 'card_link', member_id, url, parent, suggested }
//
// Consent is a HARD gate (locked decision 2026-07-08): enroll rejects unless
// consent_confirmed === true, and the confirmation is written to the audit row.
//
// Access: BAM staff, the academy OWNER, or a client_users row with
// can_enroll_members=true (owner-managed grant, Team section).
//
// Subs created here carry metadata.origin='fullcontrol-portal' (so every
// existing PATCH action can manage them later) + import_silent='1' (flip live
// via the invoice.paid webhook WITHOUT the new-signup welcome activations -
// this is a returning client, not a fresh funnel signup).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_TRIAL_MAX_SECS = 729 * 86400; // 1-day buffer under Stripe's 730-day cap

function nowIso() { return new Date().toISOString(); }

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
  if (!token) throw Object.assign(new Error("auth required"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  if (!user?.id) throw Object.assign(new Error("invalid token"), { status: 401 });
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,name&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name&limit=1`);
  }
  const staffRow = Array.isArray(staff) && staff[0] ? staff[0] : null;
  // Migration-safe: fall back to role-only if can_enroll_members doesn't exist yet
  // (owners keep working; grantees need the migration).
  let memberships;
  try {
    memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id,role,can_enroll_members`);
  } catch (_) {
    memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id,role`);
  }
  return { user, staff: staffRow, memberships: Array.isArray(memberships) ? memberships : [] };
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

async function writeAudit(row) {
  try {
    await sb("member_audit_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([row]),
    });
  } catch (e) {
    console.error("member_audit_log write failed:", e.message);
  }
}

// LIVE offer prices only - same rule as the sorter's fix-payment buildTargets:
// routable canonical pricing_catalog rows on non-archived offers.
async function liveTargets(clientId) {
  const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&status=neq.archived&select=id`).catch(() => []) || [];
  const liveOfferIds = new Set((offers || []).map(o => o.id));
  const rows = await sb(
    `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&tier=eq.canonical&is_routable=is.true` +
    `&offer_price_key=not.is.null&select=offer_price_key,stripe_price_id,amount_cents,currency,interval,offer_id`
  ).catch(() => []) || [];
  const termLabel = (t) => (t === "monthly" || t === "4_weeks") ? "Monthly"
    : t === "3_months" ? "3 months" : t === "6_months" ? "6 months" : t === "12_months" ? "12 months" : String(t || "").replace("_", " ");
  const seen = new Set();
  const out = [];
  for (const r of (rows || [])) {
    if (!r.offer_price_key || !r.stripe_price_id || seen.has(r.offer_price_key)) continue;
    if (r.offer_id && !liveOfferIds.has(r.offer_id)) continue; // offer archived -> skip
    seen.add(r.offer_price_key);
    const [plan, term] = String(r.offer_price_key).split("|");
    out.push({
      key: r.offer_price_key, label: `${plan} · ${termLabel(term)}`,
      stripe_price_id: r.stripe_price_id, amount_cents: r.amount_cents,
      currency: r.currency || "cad", interval: r.interval || null, offer_id: r.offer_id || null,
    });
  }
  return out;
}

async function resolveTarget(clientId, offerPriceKey) {
  const targets = await liveTargets(clientId);
  return targets.find(t => t.key === offerPriceKey) || null;
}

// Reusable card: prefer the customer's default PM, else any attached card.
async function findCard(customerId, acct) {
  const cust = await stripeFetch(`/customers/${encodeURIComponent(customerId)}?expand[]=invoice_settings.default_payment_method`, { stripeAccount: acct });
  let pm = cust.invoice_settings && cust.invoice_settings.default_payment_method;
  let last4 = pm && pm.card && pm.card.last4;
  let brand = pm && pm.card && pm.card.brand;
  if (pm) pm = pm.id || pm;
  if (!pm) {
    const pms = await stripeFetch(`/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=1`, { stripeAccount: acct });
    const first = pms.data && pms.data[0];
    if (first) { pm = first.id; last4 = first.card && first.card.last4; brand = first.card && first.card.brand; }
  }
  return { customer: cust, pm: pm || null, last4: last4 || null, brand: brand || null };
}

// Existing roster rows that could collide with this enroll. "Blocking" = the
// person is already a paying/paused member; "resumable" = a pending row from an
// earlier no-card run of this same flow (we reuse it instead of duplicating).
async function findExisting(clientId, { customerId, parentEmail, athleteName }) {
  const cid = encodeURIComponent(clientId);
  const byCustomer = customerId
    ? await sb(`members?client_id=eq.${cid}&stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id,athlete_name,status,stripe_subscription_id`).catch(() => []) || []
    : [];
  let byIdentity = [];
  if (parentEmail && athleteName) {
    byIdentity = await sb(
      `members?client_id=eq.${cid}&parent_email=eq.${encodeURIComponent(parentEmail)}` +
      `&athlete_name=eq.${encodeURIComponent(athleteName)}&select=id,athlete_name,status,stripe_subscription_id`
    ).catch(() => []) || [];
  }
  const all = [...byCustomer];
  for (const r of byIdentity) if (!all.some(a => a.id === r.id)) all.push(r);
  const sameAthlete = (r) => !athleteName || String(r.athlete_name || "").trim().toLowerCase() === String(athleteName).trim().toLowerCase();
  const blocking = all.filter(r => sameAthlete(r) && (r.stripe_subscription_id || !["payment_method_required"].includes(r.status)));
  const resumable = all.find(r => sameAthlete(r) && r.status === "payment_method_required" && !r.stripe_subscription_id) || null;
  return { all, blocking, resumable };
}

function planFromKey(offerPriceKey) {
  return String(offerPriceKey || "").split("|")[0] || null;
}

// Resolve + validate a promotion code on the connected account against a plan
// price. Same rules as members.js actionApplyCoupon: live code, not expired /
// fully redeemed, and the guardrails (never $0 / negative). Throws a clean
// message on any failure; returns { pc, label, discount_cents, discounted_cents }.
async function resolvePromo(codeRaw, acct, planCents) {
  const code = normCode(codeRaw);
  if (!code) throw Object.assign(new Error("coupon code required"), { status: 400 });
  const list = await stripeFetch(`/promotion_codes?code=${encodeURIComponent(code)}&limit=1&expand[]=data.promotion.coupon`, { stripeAccount: acct });
  const pc = (list.data || [])[0];
  const fail = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  if (!pc) fail(`no coupon named ${code} exists in Stripe - create it in the offer's Pricing section first`);
  if (pc.active === false) fail(`${code} is deactivated`);
  if (pc.expires_at && Math.floor(Date.now() / 1000) > pc.expires_at) fail(`${code} has expired`);
  if (pc.max_redemptions && (pc.times_redeemed || 0) >= pc.max_redemptions) fail(`${code} is fully redeemed`);
  const cp = couponFromPromo(pc);
  const def = cp.percent_off != null
    ? { kind: "Percent off", value: cp.percent_off }
    : { kind: "Dollar off", value: (cp.amount_off || 0) / 100 };
  const applied = applyDiscountToCents(def, planCents);
  if (!applied.ok) fail(applied.error);
  return { pc, code, label: applied.label, discount_cents: applied.discountCents, discounted_cents: applied.discountedCents };
}

function setupLinkBase(req) {
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  return /localhost|127\.0\.0\.1/.test(origin) ? origin : "https://portal.byanymeansbusiness.com";
}

// ── action: find-customer ──────────────────────────────────
async function actionFindCustomer(res, { clientId, acct, body }) {
  const q = String(body.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "type at least 2 characters to search" });

  // Build the Stripe customer-search query from the shape of the input.
  const esc = q.replace(/["\\]/g, "");
  let query;
  const digits = q.replace(/\D/g, "");
  if (q.includes("@")) query = `email~"${esc}"`;
  else if (digits.length >= 7 && digits.length >= q.replace(/[\s()+-]/g, "").length) query = `phone~"${digits}"`;
  else query = `name~"${esc}" OR email~"${esc}"`;

  const found = await stripeFetch(`/customers/search?query=${encodeURIComponent(query)}&limit=10`, { stripeAccount: acct });
  const customers = Array.isArray(found.data) ? found.data : [];
  if (!customers.length) return res.status(200).json({ customers: [] });

  // Enrich from our own tables in 3 batched queries: roster, past members, contacts.
  const cid = encodeURIComponent(clientId);
  const ids = customers.map(c => c.id);
  const emails = [...new Set(customers.map(c => (c.email || "").toLowerCase().trim()).filter(Boolean))];
  const idList = ids.map(encodeURIComponent).join(",");
  const emailList = emails.map(e => `"${encodeURIComponent(e)}"`).join(",");

  const rosterRows = await sb(
    `members?client_id=eq.${cid}&or=(stripe_customer_id.in.(${idList})${emails.length ? `,parent_email.in.(${emailList})` : ""})` +
    `&select=id,athlete_name,status,parent_email,stripe_customer_id,stripe_subscription_id`
  ).catch(() => []) || [];
  // cancellations has NO parent_email column - match on stripe_customer_id only.
  const pastRows = await sb(
    `cancellations?client_id=eq.${cid}&stripe_customer_id=in.(${idList})` +
    `&select=athlete_name,cancel_date,type,stripe_customer_id&order=cancel_date.desc.nullslast&limit=100`
  ).catch(() => []) || [];
  const contactRows = await sb(
    `contacts?client_id=eq.${cid}&or=(stripe_customer_id.in.(${idList})${emails.length ? `,email.in.(${emailList})` : ""})` +
    `&select=id,athlete_name,name,email,phone,stripe_customer_id`
  ).catch(() => []) || [];

  const out = customers.map(c => {
    const email = (c.email || "").toLowerCase().trim();
    const matches = (r, custKey, emailKey) =>
      (r[custKey] && r[custKey] === c.id) || (email && (r[emailKey] || "").toLowerCase().trim() === email);
    const roster = rosterRows.filter(r => matches(r, "stripe_customer_id", "parent_email"));
    const past = pastRows.find(r => matches(r, "stripe_customer_id", "parent_email")) || null;
    const contact = contactRows.find(r => matches(r, "stripe_customer_id", "email")) || null;
    return {
      id: c.id,
      name: c.name || null,
      email: c.email || null,
      phone: c.phone || null,
      created_iso: c.created ? new Date(c.created * 1000).toISOString().slice(0, 10) : null,
      has_default_pm: Boolean(c.invoice_settings && c.invoice_settings.default_payment_method),
      on_roster: roster.length
        ? roster.map(r => ({ member_id: r.id, athlete_name: r.athlete_name, status: r.status }))
        : null,
      past_member: past ? { athlete_name: past.athlete_name || null, cancel_date: past.cancel_date || null, type: past.type || null } : null,
      contact: contact ? { athlete_name: contact.athlete_name || null, name: contact.name || null, phone: contact.phone || null } : null,
    };
  });
  return res.status(200).json({ customers: out });
}

// ── action: preview ────────────────────────────────────────
async function actionPreview(res, { clientId, acct, body }) {
  const customerId = body.customer_id;
  if (!customerId) return res.status(400).json({ error: "customer_id required" });
  const target = await resolveTarget(clientId, body.offer_price_key);
  if (!target) return res.status(409).json({ error: "That price isn't live for this academy. Pick a live offer price (Blueprint > Offers > Pricing)." });

  const { customer, pm, last4, brand } = await findCard(customerId, acct);
  const parentEmail = (customer.email || "").toLowerCase().trim() || null;
  const { blocking } = await findExisting(clientId, {
    customerId, parentEmail, athleteName: body.athlete_name || null,
  });

  return res.status(200).json({
    ok: true,
    price: target,
    parent: { name: customer.name || null, email: customer.email || null, phone: customer.phone || null },
    needs_card: !pm,
    card_last4: last4,
    card_brand: brand,
    duplicates: blocking.map(b => ({ member_id: b.id, athlete_name: b.athlete_name, status: b.status })),
  });
}

// ── action: check-coupon ───────────────────────────────────
async function actionCheckCoupon(res, { clientId, acct, body }) {
  const target = await resolveTarget(clientId, body.offer_price_key);
  if (!target) return res.status(409).json({ error: "pick an offer price first" });
  const promo = await resolvePromo(body.code, acct, target.amount_cents);
  return res.status(200).json({
    ok: true,
    coupon: {
      code: promo.code, label: promo.label,
      discount_cents: promo.discount_cents, discounted_cents: promo.discounted_cents,
      plan_cents: target.amount_cents,
    },
  });
}

// ── action: enroll ─────────────────────────────────────────
async function actionEnroll(res, req, { clientId, acct, ctx, body }) {
  // Consent gate - locked decision: the staff user must confirm the parent
  // agreed to this signup and charge. No consent, no enroll.
  if (body.consent_confirmed !== true) {
    return res.status(400).json({ error: "consent confirmation required - tick the consent box before enrolling" });
  }
  const customerId = body.customer_id;
  if (!customerId) return res.status(400).json({ error: "customer_id required" });
  const athleteName = String(body.athlete_name || "").trim();
  if (!athleteName) return res.status(400).json({ error: "athlete_name required" });
  const chargeMode = body.charge_mode === "on_date" ? "on_date" : "now";
  let startDate = null;
  if (chargeMode === "on_date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date || ""))) {
      return res.status(400).json({ error: "start_date (YYYY-MM-DD) required when charge_mode is on_date" });
    }
    startDate = body.start_date;
  }
  const target = await resolveTarget(clientId, body.offer_price_key);
  if (!target) return res.status(409).json({ error: "That price isn't live for this academy anymore - re-pick the offer price." });

  // Optional coupon - re-validated server-side at enroll time (never trust a
  // stale client-side check; the code could expire between Review and Confirm).
  let promo = null;
  if (body.coupon_code) {
    promo = await resolvePromo(body.coupon_code, acct, target.amount_cents);
  }

  const { customer, pm, last4 } = await findCard(customerId, acct);
  const parentEmail = String(body.parent_email || customer.email || "").toLowerCase().trim() || null;
  const parentName = String(body.parent_name || customer.name || "").trim() || null;
  const parentPhone = String(body.parent_phone || customer.phone || "").trim() || null;

  const { blocking, resumable } = await findExisting(clientId, { customerId, parentEmail, athleteName });
  if (blocking.length) {
    return res.status(409).json({
      error: `${blocking[0].athlete_name || "This athlete"} is already on the roster (${blocking[0].status}). Use Change plan on their member card instead.`,
      duplicates: blocking.map(b => ({ member_id: b.id, athlete_name: b.athlete_name, status: b.status })),
    });
  }

  const plan = planFromKey(target.key);
  const today = new Date().toISOString().slice(0, 10);
  const baseRow = {
    athlete_name: athleteName,
    parent_name: parentName,
    parent_email: parentEmail,
    parent_phone: parentPhone,
    plan,
    stripe_customer_id: customerId,
    updated_at: nowIso(),
  };

  // Upsert the member row FIRST (pending state) so the Stripe webhook always
  // finds it. Reuse an earlier no-card pending row instead of duplicating.
  let memberId = resumable ? resumable.id : null;
  if (memberId) {
    await sb(`members?id=eq.${memberId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(baseRow),
    });
  } else {
    const inserted = await sb(`members?select=id`, {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify([{
        ...baseRow,
        client_id: clientId,
        status: "payment_method_required",
        joined_date: today,
        created_at: nowIso(),
      }]),
    });
    memberId = Array.isArray(inserted) && inserted[0] && inserted[0].id;
    if (!memberId) return res.status(500).json({ error: "couldn't create the member row" });
  }

  const auditBase = {
    client_id: clientId, member_id: memberId,
    performed_by: ctx.user.id, performed_by_name: ctx.staff?.name || null,
  };

  // ── Door B: no usable card -> pending member + setup Checkout link ──
  if (!pm) {
    const base = setupLinkBase(req);
    const session = await stripeFetch(`/checkout/sessions`, {
      method: "POST", stripeAccount: acct,
      body: {
        mode: "setup", currency: target.currency || "cad", customer: customerId,
        success_url: `${base}/client-portal.html?card=saved`,
        cancel_url: `${base}/client-portal.html?card=cancelled`,
      },
    });
    await writeAudit({
      ...auditBase, action_type: "enroll-returning",
      args: {
        door: "card_link", offer_price_key: target.key, charge_mode: chargeMode, start_date: startDate,
        consent_confirmed: true, customer_id: customerId,
        coupon_code: promo ? promo.code : null,
      },
      stripe_response: { checkout_session: session.id },
      db_changes: { members: { status: "payment_method_required", created: !resumable } },
    });
    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_name&limit=1`).catch(() => []);
    const academyName = (clientRows && clientRows[0] && clientRows[0].business_name) || "your academy";
    return res.status(200).json({
      ok: true, mode: "card_link", member_id: memberId, url: session.url,
      parent: { name: parentName, email: parentEmail, phone: parentPhone },
      suggested: {
        sms_text: `Hi, here's the secure link to add your card and finish ${athleteName}'s signup with ${academyName}: ${session.url}`,
        email_subject: `Finish ${athleteName}'s signup - ${academyName}`,
      },
      note: promo
        ? `No usable card on file. Send the link; once the card is saved, run this signup again WITH coupon ${promo.code} and it will complete at the discounted price.`
        : "No usable card on file. Send the link; once the card is saved, run this signup again and it will complete.",
    });
  }

  // ── Door A: saved card -> create the portal-owned subscription ──
  let trialEnd = null;
  if (chargeMode === "on_date") {
    const t = Math.floor(new Date(`${startDate}T12:00:00Z`).getTime() / 1000);
    const floor = Math.floor(Date.now() / 1000) + 60;
    trialEnd = Math.min(Math.max(t, floor), Math.floor(Date.now() / 1000) + STRIPE_TRIAL_MAX_SECS);
  }
  const subBody = {
    customer: customerId,
    "items[0][price]": target.stripe_price_id,
    default_payment_method: pm,
    // origin=fullcontrol-portal = the standard portal-owned marker (webhook +
    // members.js read it); import_silent=1 flips live WITHOUT the new-signup
    // welcome activations - this is a returning client, not a funnel signup.
    "metadata[origin]": "fullcontrol-portal",
    "metadata[import_silent]": "1",
    "metadata[source]": "fullcontrol-returning-enroll",
    "metadata[offer_price_key]": target.key,
    "metadata[member_email]": parentEmail || undefined,
    "metadata[enroll_consent]": "1",
  };
  if (trialEnd) subBody.trial_end = trialEnd;
  if (promo) subBody["discounts[0][promotion_code]"] = promo.pc.id;

  let sub;
  try {
    sub = await stripeFetch(`/subscriptions`, {
      method: "POST", stripeAccount: acct,
      idempotencyKey: `enroll-${clientId}-${customerId}-${target.stripe_price_id}-${trialEnd || "now"}`.slice(0, 200),
      body: subBody,
    });
  } catch (e) {
    await writeAudit({
      ...auditBase, action_type: "enroll-returning-failed",
      args: { door: "subscription", offer_price_key: target.key, consent_confirmed: true, error: e.message },
    });
    throw e;
  }

  // Stamp the sub onto the member row. Status stays payment_method_required -
  // the invoice.paid webhook (activatePortalOnboardingMember, import_silent
  // branch) flips it live + runs access/credit sync, same as every other
  // portal-owned signup. Charge-now pays within seconds; a scheduled start
  // pays its $0 trial invoice immediately, so both doors flip fast.
  await sb(`members?id=eq.${memberId}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      stripe_subscription_id: sub.id,
      stripe_price_id: target.stripe_price_id,
      stripe_joined_at: sub.created ? new Date(sub.created * 1000).toISOString() : nowIso(),
      billing_portal_owned: true,
      updated_at: nowIso(),
    }),
  });

  await writeAudit({
    ...auditBase, action_type: "enroll-returning",
    args: {
      door: "subscription", offer_price_key: target.key, charge_mode: chargeMode,
      start_date: startDate, consent_confirmed: true, customer_id: customerId,
      amount_cents: target.amount_cents,
      coupon_code: promo ? promo.code : null,
      discount_cents: promo ? promo.discount_cents : null,
    },
    stripe_response: { id: sub.id, status: sub.status, promotion_code: promo ? promo.pc.id : null },
    db_changes: { members: { created: !resumable, stripe_subscription_id: sub.id } },
  });

  const firstChargeIso = trialEnd ? new Date(trialEnd * 1000).toISOString().slice(0, 10) : today;
  return res.status(200).json({
    ok: true,
    mode: chargeMode === "on_date" ? "scheduled" : "charged",
    member_id: memberId, subscription_id: sub.id, subscription_status: sub.status,
    amount_cents: promo ? promo.discounted_cents : target.amount_cents, currency: target.currency,
    coupon: promo ? { code: promo.code, label: promo.label, discount_cents: promo.discount_cents } : null,
    first_charge_iso: firstChargeIso, card_last4: last4,
    warning: (sub.status === "incomplete" || sub.status === "incomplete_expired")
      ? "The first charge did not go through - the card on file was declined. Send a card link from the member card."
      : null,
  });
}

// ── handler ────────────────────────────────────────────────
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    if (!stripeKey()) throw new Error("Stripe secret key not configured");
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });

    // Access: BAM staff, the academy owner, or a can_enroll_members grantee.
    const membership = ctx.memberships.find(m => m.client_id === clientId) || null;
    const allowed = Boolean(ctx.staff) || (membership && (membership.role === "owner" || membership.can_enroll_members === true));
    if (!allowed) return res.status(403).json({ error: "you don't have access to sign up returning clients - ask the account owner" });

    const clientRows = await sb(
      `clients?id=eq.${encodeURIComponent(clientId)}&select=id,stripe_connect_account_id,stripe_connect_status&limit=1`
    );
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    if (!client.stripe_connect_account_id || client.stripe_connect_status !== "connected") {
      return res.status(409).json({ error: "Stripe isn't connected for this academy - connect it on the Members tab first" });
    }
    const acct = client.stripe_connect_account_id;

    switch (body.action) {
      case "find-customer": return await actionFindCustomer(res, { clientId, acct, body });
      case "targets":       return res.status(200).json({ targets: await liveTargets(clientId) });
      case "preview":       return await actionPreview(res, { clientId, acct, body });
      case "check-coupon":  return await actionCheckCoupon(res, { clientId, acct, body });
      case "enroll":        return await actionEnroll(res, req, { clientId, acct, ctx, body });
      default:              return res.status(400).json({ error: `unknown action: ${body.action || "(none)"}` });
    }
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
