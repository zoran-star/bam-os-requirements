import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 60; // Stripe reads + one Anthropic call

// Vercel Serverless Function — AI assist for the "take over billing" import step.
//
// Per member it gathers the FACTS (their current Stripe sub + what the offer says
// they should pay + card status), computes a DETERMINISTIC verdict, and has Claude
// explain it + chat with staff. The AI is ADVISORY ONLY — it never moves money.
// The actual create/cancel always goes through api/sorter/take-over.js, driven by
// explicit params from the UI. (Same split as fix-payment.js.)
//
// POST mode=verdict  { client_id, member_id }
//   → { verdict:{tag,title,reason}, facts, recommend:{first_charge_iso,
//       grandfather_amount_cents, canonical_price_id?, canonical_amount_cents?},
//       explanation }
//
// POST mode=chat     { client_id, member_id, messages:[{role,content}...] }
//   → { reply, suggest:{price_choice?:'grandfather'|'canonical', first_charge_date?} }
//
// Auth: resolveUser() — staff (any academy) or a client_users member of client_id.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";
const PORTAL_ORIGINS = new Set(["fullcontrol-portal", "fullcontrol-website-enrollment"]);
// Display-only labels for known Connect apps (BAM GTA). Anything else = "external app".
const APP_LABELS = {
  ca_G3zgR3Ix46909q9NDX3KlZjURzBW8TsK: "CoachIQ",
  ca_D5Mpe2emSMW6EZeofhNaydC4Kq5zGxQo: "GoHighLevel",
};

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", ...(init.headers || {}),
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
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

function stripeKey() { return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY; }
async function stripeGet(path, acct) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (acct) headers["Stripe-Account"] = acct;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) { const e = new Error(json?.error?.message || `Stripe ${res.status}`); e.stripeStatus = res.status; throw e; }
  return json;
}
const iso = (u) => (u ? new Date(u * 1000).toISOString().slice(0, 10) : null);
const money = (c) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);

function subOriginLabel(sub) {
  if (sub && sub.metadata && PORTAL_ORIGINS.has(sub.metadata.origin)) return "portal";
  const app = sub && sub.application;
  if (!app) return "manual (Stripe dashboard)";
  return APP_LABELS[app] || "external app";
}

// Deterministic verdict. AI only explains it.
function computeVerdict({ sub, originLabel, needsCard }) {
  if (!sub) return { tag: "no_sub", title: "No subscription", reason: "No live sub — handle in the Cleanup step (set up billing or mark prepaid), then come back." };
  if (originLabel === "portal") return { tag: "fine", title: "Already on the portal", reason: "This sub is portal-owned — member actions already work. Nothing to do." };
  if (needsCard) return { tag: "needs_card", title: "Needs a card", reason: "No reusable card on file, so we can't start a portal sub yet. Send a card link → status becomes 'collecting payment'." };
  return { tag: "move", title: "Move to portal", reason: `Sub was made by ${originLabel} → the portal can't manage it. Make a portal sub (same price), then cancel the old one.` };
}

async function gatherFacts({ clientId, acct, member }) {
  const custId = member.stripe_customer_id;
  const subId = member.stripe_subscription_id;
  let sub = null;
  if (subId) { try { sub = await stripeGet(`/subscriptions/${encodeURIComponent(subId)}?expand[]=items.data.price.product`, acct); } catch (_) { sub = null; } }
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const price = item && item.price;
  const curAmount = price ? price.unit_amount : null;
  const interval = price && price.recurring ? `${price.recurring.interval_count > 1 ? price.recurring.interval_count + " " : ""}${price.recurring.interval}` : null;
  const nextCharge = sub ? (sub.status === "trialing" ? sub.trial_end : (item && item.current_period_end) || sub.current_period_end) : null;
  const originLabel = subOriginLabel(sub);

  // Card status.
  let needsCard = true, last4 = null;
  if (custId) {
    try {
      const cust = await stripeGet(`/customers/${encodeURIComponent(custId)}?expand[]=invoice_settings.default_payment_method`, acct);
      let pm = cust.invoice_settings && cust.invoice_settings.default_payment_method;
      if (pm) { needsCard = false; last4 = pm.card && pm.card.last4; }
      else { const pms = await stripeGet(`/payment_methods?customer=${encodeURIComponent(custId)}&type=card&limit=1`, acct); if (pms.data && pms.data[0]) { needsCard = false; last4 = pms.data[0].card && pms.data[0].card.last4; } }
    } catch (_) {}
  }

  // What the OFFER says they should pay (canonical monthly for their plan).
  let canonical = null;
  const planTitle = String(member.plan || "").split("|")[0];
  if (planTitle) {
    const mKey = `${planTitle}|monthly`;
    const rows = await sb(
      `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&offer_price_key=eq.${encodeURIComponent(mKey)}` +
      `&tier=eq.canonical&select=stripe_price_id,amount_cents,currency&limit=1`
    ).catch(() => null);
    if (Array.isArray(rows) && rows[0] && rows[0].stripe_price_id) canonical = rows[0];
  }

  return {
    member: { athlete: member.athlete_name, plan: member.plan, coachiq_linked: !!member.coachiq_member_id },
    current_sub: sub ? { amount: money(curAmount), amount_cents: curAmount, interval, status: sub.status, made_by: originLabel, next_charge: iso(nextCharge) } : null,
    card: { on_file: !needsCard, last4 },
    offer_should_pay: canonical ? { amount: money(canonical.amount_cents), amount_cents: canonical.amount_cents, price_id: canonical.stripe_price_id } : null,
    _internal: { sub, originLabel, needsCard, curAmount, nextCharge, canonical },
  };
}

async function claude({ system, messages, max_tokens = 400 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens, system, messages }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.content?.[0]?.text || null;
  } catch (_) { return null; }
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

    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=stripe_connect_account_id&limit=1`);
    const acct = Array.isArray(clientRows) && clientRows[0] && clientRows[0].stripe_connect_account_id;
    if (!acct) return res.status(409).json({ error: "academy not connected to Stripe" });

    // ── batch: a deterministic verdict per promoted member in an import (no Claude) ──
    // The roster view loads this once; Claude only runs when a member's chat opens.
    if (body.mode === "batch") {
      // batch_id is only known in-session right after an Import. When the modal
      // is reopened on a later step (e.g. resuming on Billing), fall back to the
      // client's most recent import batch — same resolution cleanup.js uses.
      let batchId = body.import_batch_id || body.batch_id;
      if (!batchId) {
        const last = await sb(
          `members_staging?client_id=eq.${encodeURIComponent(clientId)}` +
          `&select=import_batch_id&order=created_at.desc&limit=1`
        );
        batchId = Array.isArray(last) && last[0] ? last[0].import_batch_id : null;
      }
      if (!batchId) return res.status(400).json({ error: "import_batch_id required" });
      const staging = await sb(
        `members_staging?import_batch_id=eq.${encodeURIComponent(batchId)}&client_id=eq.${encodeURIComponent(clientId)}` +
        `&promoted_member_id=not.is.null&select=promoted_member_id,coachiq_member_id`
      );
      const ids = Array.from(new Set((Array.isArray(staging) ? staging : []).map(s => s.promoted_member_id).filter(Boolean)));
      if (!ids.length) return res.status(200).json({ ok: true, mode: "batch", members: [] });
      const memberRows = await sb(`members?id=in.(${ids.map(encodeURIComponent).join(",")})&client_id=eq.${encodeURIComponent(clientId)}&select=id,athlete_name,plan,stripe_customer_id,stripe_subscription_id,coachiq_member_id`);
      const list = Array.isArray(memberRows) ? memberRows : [];
      const out = await Promise.all(list.map(async (m) => {
        try {
          const f = await gatherFacts({ clientId, acct, member: m });
          const { sub, originLabel, needsCard, curAmount, nextCharge } = f._internal;
          const v = computeVerdict({ sub, originLabel, needsCard });
          return {
            member_id: m.id, athlete: m.athlete_name, coachiq_linked: !!m.coachiq_member_id,
            tag: v.tag, title: v.title, made_by: originLabel,
            amount: money(curAmount), amount_cents: curAmount,
            next_charge: iso(nextCharge), card_on_file: !needsCard,
            old_sub_id: m.stripe_subscription_id || null,
          };
        } catch (e) {
          return { member_id: m.id, athlete: m.athlete_name, tag: "error", title: "Couldn't read", error: String(e && e.message || e) };
        }
      }));
      const order = { needs_card: 0, move: 1, no_sub: 2, fine: 3, error: 4 };
      out.sort((a, b) => (order[a.tag] ?? 9) - (order[b.tag] ?? 9));
      return res.status(200).json({ ok: true, mode: "batch", batch_id: batchId, members: out });
    }

    if (!body.member_id) return res.status(400).json({ error: "member_id required" });
    const memberRows = await sb(`members?id=eq.${encodeURIComponent(body.member_id)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,athlete_name,plan,stripe_customer_id,stripe_subscription_id,coachiq_member_id&limit=1`);
    const member = Array.isArray(memberRows) && memberRows[0];
    if (!member) return res.status(404).json({ error: "member not found for this academy" });

    const facts = await gatherFacts({ clientId, acct, member });
    const { sub, originLabel, needsCard, curAmount, nextCharge, canonical } = facts._internal;
    delete facts._internal;
    const verdict = computeVerdict({ sub, originLabel, needsCard });
    const publicFacts = facts; // already display-shaped, no internal sub object

    const recommend = {
      first_charge_iso: iso(nextCharge),
      grandfather_amount_cents: curAmount,
      canonical_price_id: canonical ? canonical.stripe_price_id : null,
      canonical_amount_cents: canonical ? canonical.amount_cents : null,
      price_differs: !!(canonical && curAmount != null && canonical.amount_cents !== curAmount),
    };

    if (body.mode === "chat") {
      const sys = `You are a billing assistant inside a sports-academy CRM, helping staff move an imported member onto a portal-managed subscription. You have the FACTS and the deterministic VERDICT below. Be concise (1-3 sentences), plain-English, and never invent numbers — only use the facts given.
Key rules you must respect:
- Default to GRANDFATHERING the member's current amount (no surprise price change). Only suggest the canonical/offer price if staff ask or if there's no current price.
- The new sub starts on their next-charge date (no gap, no double charge).
- You CANNOT cancel the old sub (Stripe blocks it) — staff cancel it by hand after; just remind them.
- You never execute anything yourself; staff click "Make it". If staff clearly decide, end with a short confirmation of what will happen.
FACTS:\n${JSON.stringify(publicFacts, null, 2)}\nVERDICT: ${JSON.stringify(verdict)}\nRECOMMEND: ${JSON.stringify(recommend)}`;
      const msgs = Array.isArray(body.messages) && body.messages.length
        ? body.messages.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-12)
        : [{ role: "user", content: "What do you recommend for this member?" }];
      const reply = await claude({ system: sys, messages: msgs, max_tokens: 400 })
        || `${verdict.reason} ${recommend.first_charge_iso ? "First charge would be " + recommend.first_charge_iso + "." : ""}`.trim();
      // Light suggestion parse (UI uses it only as a hint; execution stays explicit).
      const lc = reply.toLowerCase();
      const suggest = {};
      if (lc.includes("canonical") || lc.includes("offer price")) suggest.price_choice = "canonical";
      else if (lc.includes("grandfather") || lc.includes("same price") || lc.includes("current price")) suggest.price_choice = "grandfather";
      return res.status(200).json({ ok: true, mode: "chat", reply, suggest });
    }

    // ── verdict (default) ──
    const explanation = await claude({
      system: `You explain a billing verdict to non-technical academy staff in ONE plain sentence. Use only the facts. No JSON, no markdown — just the sentence.`,
      messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(publicFacts)}\nVERDICT:${JSON.stringify(verdict)}\nRECOMMEND:${JSON.stringify(recommend)}` }],
      max_tokens: 160,
    }) || verdict.reason;

    return res.status(200).json({ ok: true, mode: "verdict", member_id: member.id, verdict, facts: publicFacts, recommend, explanation });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
