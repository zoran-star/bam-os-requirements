import { withSentryApiRoute } from "./_sentry.js";
import { getClientGhlToken } from "./website/availability.js";
import { contactsReadTable } from "./_contacts.js";
import { recordKpiEvent } from "./_kpi.js";
// Scans Stripe (charges/subs/payouts) + GHL opportunities per month — well past
// the default ~10s budget.
export const maxDuration = 60;
// Vercel Serverless Function — V1.5 KPIs data (Sales / Revenue / Members).
//
// Powers the three remaining KPI sections. All month-filtered (YYYY-MM, UTC) and
// grouped by offer via kpi_offer_links (the Setup tab). Counts are HUMAN-CLEANED:
// the raw count comes from GHL/Stripe, minus per-metric/offer/contact rows in
// kpi_exclusions; undo just deletes the exclusion row. Source data is untouched.
//
//   GET ?section=sales&month=YYYY-MM     → per-offer entered-pipeline + new-payments
//   GET ?section=revenue&month=YYYY-MM   → gross/net, payouts, failed payments
//   GET ?section=members&month=YYYY-MM   → month payments, cancelled subs, manual cancels
//   GET ?action=customer-search&q=       → GHL mirror contacts + Stripe customers
//   POST ?action=exclude   { month, metric, offer_id?, ref_id, label?, reason? }
//   POST ?action=unexclude { month, metric, offer_id?, ref_id }
//   POST ?action=manual-cancel { month, contact_name, ghl_contact_id?, stripe_customer_id?, reason?, cancelled_on? }
//   POST ?action=delete-manual-cancel { id }
//   POST ?action=billing-portal { customer }   → Stripe card-update link to copy
//
// Auth: Supabase JWT — staff (any academy) or client_users member of client_id.

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";
const STRIPE_API = "https://api.stripe.com/v1";
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

// ── Stripe ──
function stripeKey() { return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY; }
async function stripeReq(method, path, stripeAccount, form) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: form ? new URLSearchParams(form).toString() : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}
const stripeGet = (path, acct) => stripeReq("GET", path, acct);
async function stripeGetAll(path, acct, cap = 12) {
  const out = []; let after = null;
  for (let i = 0; i < cap; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await stripeGet(`${path}${sep}limit=100${after ? `&starting_after=${after}` : ""}`, acct);
    const data = r.data || []; out.push(...data);
    if (!r.has_more || !data.length) break;
    after = data[data.length - 1].id;
  }
  return out;
}

// ── GHL ──
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function ghl(token, method, path) {
  // Retry on GHL rate-limit (429) with backoff — the contacts-sync cron can
  // briefly saturate the location's GHL quota, which otherwise made KPI
  // pipeline/booking counts silently fall to 0.
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await fetch(`${GHL_V2}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/json" } });
    if (r.status !== 429) break;
    const ra = Number(r.headers.get("retry-after"));
    await _sleep(ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(400 * 2 ** attempt, 4000));
  }
  const txt = await r.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  if (!r.ok) { const e = new Error(json?.message || json?.error || `GHL ${r.status}`); e.status = r.status; throw e; }
  return json;
}

function monthRange(m) {
  const mm = /^(\d{4})-(\d{2})$/.exec(String(m || ""));
  if (!mm) { const now = new Date(); return monthRange(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`); }
  const y = +mm[1], mo = +mm[2];
  return { start: Math.floor(Date.UTC(y, mo - 1, 1) / 1000), end: Math.floor(Date.UTC(y, mo, 1) / 1000) };
}
const money = c => (c == null ? 0 : c / 100);
const custName = c => (c && typeof c === "object") ? (c.name || c.email || c.id) : (c || "—");
const custEmail = c => (c && typeof c === "object") ? (c.email || null) : null;
const custId = c => (c && typeof c === "object") ? c.id : (typeof c === "string" ? c : null);

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,time_zone,stripe_connect_account_id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
  return rows?.[0] || null;
}
async function loadLinks(clientId) {
  const links = await sb(`kpi_offer_links?client_id=eq.${encodeURIComponent(clientId)}&select=kind,ref_id,offer_id,label`) || [];
  const offerIds = [...new Set(links.map(l => l.offer_id).filter(Boolean))];
  let offers = [];
  if (offerIds.length) offers = await sb(`offers?id=in.(${offerIds.join(",")})&select=id,title`) || [];
  const titleOf = Object.fromEntries(offers.map(o => [o.id, o.title]));
  const byOffer = {};
  for (const l of links) {
    if (!l.offer_id) continue;
    (byOffer[l.offer_id] = byOffer[l.offer_id] || { offer_id: l.offer_id, title: titleOf[l.offer_id] || "(untitled offer)", products: [], pipelines: [], calendars: [] });
    if (l.kind === "stripe_product") byOffer[l.offer_id].products.push(l.ref_id);
    else if (l.kind === "ghl_pipeline") byOffer[l.offer_id].pipelines.push({ id: l.ref_id, name: l.label });
    else if (l.kind === "ghl_calendar") byOffer[l.offer_id].calendars.push({ id: l.ref_id, name: l.label });
  }
  return Object.values(byOffer);
}
async function loadExclusions(clientId, month) {
  const rows = await sb(`kpi_exclusions?client_id=eq.${encodeURIComponent(clientId)}&month=eq.${encodeURIComponent(month)}&select=metric,offer_id,ref_id`) || [];
  const set = new Set(rows.map(r => `${r.metric}|${r.offer_id || ZERO_UUID}|${r.ref_id}`));
  return set;
}
const isExcluded = (set, metric, offerId, ref) => set.has(`${metric}|${offerId || ZERO_UUID}|${ref}`);

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
    const ctx = await resolveUser(req);
    const clientId = (req.query && req.query.client_id) || (req.body && req.body.client_id) || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });
    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: "academy not found" });
    const acct = client.stripe_connect_account_id || null;
    const action = (req.query && req.query.action) || (req.body && req.body.action) || "";

    // ─────────── POST (cleaning + manual cancels + portal) ───────────
    if (req.method === "POST") {
      const b = (req.body && typeof req.body === "object") ? req.body : {};
      if (action === "exclude") {
        if (!b.month || !b.metric || !b.ref_id) return res.status(400).json({ error: "month, metric, ref_id required" });
        // upsert-ignore: delete any dup first, then insert
        await sb(`kpi_exclusions?client_id=eq.${encodeURIComponent(clientId)}&month=eq.${encodeURIComponent(b.month)}&metric=eq.${encodeURIComponent(b.metric)}&ref_id=eq.${encodeURIComponent(b.ref_id)}&offer_id=${b.offer_id ? 'eq.' + encodeURIComponent(b.offer_id) : 'is.null'}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
        await sb(`kpi_exclusions`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ client_id: clientId, month: b.month, metric: b.metric, offer_id: b.offer_id || null, ref_id: b.ref_id, label: b.label || null, reason: b.reason || null }) });
        return res.status(200).json({ ok: true });
      }
      if (action === "unexclude") {
        if (!b.month || !b.metric || !b.ref_id) return res.status(400).json({ error: "month, metric, ref_id required" });
        await sb(`kpi_exclusions?client_id=eq.${encodeURIComponent(clientId)}&month=eq.${encodeURIComponent(b.month)}&metric=eq.${encodeURIComponent(b.metric)}&ref_id=eq.${encodeURIComponent(b.ref_id)}&offer_id=${b.offer_id ? 'eq.' + encodeURIComponent(b.offer_id) : 'is.null'}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return res.status(200).json({ ok: true });
      }
      if (action === "manual-cancel") {
        if (!b.month) return res.status(400).json({ error: "month required" });
        const rows = await sb(`kpi_manual_cancellations`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ client_id: clientId, month: b.month, contact_name: b.contact_name || null, ghl_contact_id: b.ghl_contact_id || null, stripe_customer_id: b.stripe_customer_id || null, reason: b.reason || null, cancelled_on: b.cancelled_on || null }) });
        const row = Array.isArray(rows) ? rows[0] : rows;
        // KPI event log (Track A): a staff-entered cancellation is a funnel moment too.
        if (row && row.id) {
          await recordKpiEvent({
            clientId, step: "cancelled", source: "manual",
            ghlContactId: b.ghl_contact_id || null, contactName: b.contact_name || null,
            occurredAt: b.cancelled_on ? `${b.cancelled_on}T12:00:00Z` : undefined,
            ref: `manualcancel:${row.id}`,
            meta: { reason: b.reason || null, month: b.month },
          });
        }
        return res.status(200).json({ ok: true, row });
      }
      if (action === "delete-manual-cancel") {
        if (!b.id) return res.status(400).json({ error: "id required" });
        await sb(`kpi_manual_cancellations?id=eq.${encodeURIComponent(b.id)}&client_id=eq.${encodeURIComponent(clientId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return res.status(200).json({ ok: true });
      }
      if (action === "billing-portal") {
        if (!acct) return res.status(409).json({ error: "academy not connected to Stripe" });
        if (!b.customer) return res.status(400).json({ error: "customer required" });
        const session = await stripeReq("POST", "/billing_portal/sessions", acct, { customer: b.customer });
        return res.status(200).json({ ok: true, url: session.url });
      }
      return res.status(400).json({ error: "unknown action" });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "GET or POST" });

    // ─────────── GET customer-search (manual cancellation picker) ───────────
    // ─────────── Website funnel analytics (funnel_events beacons) ───────────
    // GET ?action=funnel&days=30[&funnel=free-trial] → per-funnel step counts,
    // unique sessions per step, step-to-step conversion, and top UTM sources.
    if (action === "funnel") {
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const funnelFilter = (req.query.funnel || "").trim();
      let path = `funnel_events?client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${encodeURIComponent(since)}` +
        `&select=funnel,step,session_id,utm,offer_id&limit=20000`;
      if (funnelFilter) path += `&funnel=eq.${encodeURIComponent(funnelFilter)}`;
      const rows = await sb(path) || [];
      const funnels = {};
      const utmCounts = {};
      for (const r of rows) {
        const f = funnels[r.funnel] || (funnels[r.funnel] = { steps: {}, sessions: {} });
        f.steps[r.step] = (f.steps[r.step] || 0) + 1;
        if (r.session_id) {
          (f.sessions[r.step] || (f.sessions[r.step] = new Set())).add(r.session_id);
        }
        const src = r.utm && (r.utm.source || r.utm.fbclid ? (r.utm.source || "facebook") : null);
        if (src && r.step === "page_view") utmCounts[src] = (utmCounts[src] || 0) + 1;
      }
      const STEP_ORDER = ["page_view", "form_started", "form_completed", "calendar_viewed", "slot_picked", "confirmed",
                          "plan_viewed", "plan_picked", "payment_started", "paid"];
      const out = {};
      for (const [name, f] of Object.entries(funnels)) {
        const steps = STEP_ORDER
          .filter(s => f.steps[s])
          .map(s => ({ step: s, events: f.steps[s], sessions: (f.sessions[s] && f.sessions[s].size) || 0 }));
        for (let i = 0; i < steps.length; i++) {
          const prev = i > 0 ? steps[i - 1].sessions || steps[i - 1].events : null;
          const cur = steps[i].sessions || steps[i].events;
          steps[i].pct_of_prev = prev ? Math.round((cur / prev) * 100) : 100;
        }
        // Calendar abandonment: saw times but never confirmed.
        const calSeen = (f.sessions.calendar_viewed && f.sessions.calendar_viewed.size) || 0;
        const confirmed = (f.sessions.confirmed && f.sessions.confirmed.size) || 0;
        out[name] = {
          steps,
          calendar_abandon_pct: calSeen ? Math.round(((calSeen - confirmed) / calSeen) * 100) : null,
        };
      }
      return res.status(200).json({ ok: true, days, funnels: out, top_sources: utmCounts });
    }

    if (action === "customer-search") {
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.status(200).json({ ghl: [], stripe: [] });
      const ghlMirror = await sb(`${await contactsReadTable(clientId)}?client_id=eq.${encodeURIComponent(clientId)}&select=ghl_contact_id,name,email,phone&or=(name.ilike.*${encodeURIComponent(q)}*,email.ilike.*${encodeURIComponent(q)}*,phone.ilike.*${encodeURIComponent(q)}*)&limit=8`).catch(() => []);
      let stripeCusts = [];
      if (acct) {
        try {
          const r = await stripeGet(`/customers/search?query=${encodeURIComponent(`email~"${q}" OR name~"${q}"`)}&limit=8`, acct);
          stripeCusts = (r.data || []).map(c => ({ id: c.id, name: c.name, email: c.email }));
        } catch (_) { stripeCusts = []; }
      }
      return res.status(200).json({ ghl: (ghlMirror || []).map(c => ({ id: c.ghl_contact_id, name: c.name, email: c.email, phone: c.phone })), stripe: stripeCusts });
    }

    const section = req.query && req.query.section;
    // Accept either ?month=YYYY-MM (legacy) or ?since=&until= (YYYY-MM-DD range,
    // inclusive). Range end is the next-day midnight (exclusive) so a single-day
    // range still captures that whole day.
    const since = req.query && req.query.since;
    const until = req.query && req.query.until;
    let start, end, months;
    if (since && until) {
      const ymdSec = (ymd, next) => {
        const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
        if (!mm) return null;
        const t = Date.UTC(+mm[1], +mm[2] - 1, +mm[3]);
        return Math.floor((next ? t + 86400000 : t) / 1000);
      };
      start = ymdSec(since, false);
      end = ymdSec(until, true);
      if (start == null || end == null || end <= start) {
        return res.status(400).json({ error: "since/until must be YYYY-MM-DD and until >= since" });
      }
      months = [];
      let d = new Date(start * 1000), last = new Date((end - 1) * 1000);
      let yy = d.getUTCFullYear(), mo = d.getUTCMonth();
      while (yy < last.getUTCFullYear() || (yy === last.getUTCFullYear() && mo <= last.getUTCMonth())) {
        months.push(`${yy}-${String(mo + 1).padStart(2, "0")}`);
        if (++mo > 11) { mo = 0; yy++; }
      }
    } else {
      const month = (req.query && req.query.month) || "";
      ({ start, end } = monthRange(month));
      const now = new Date();
      months = [/^\d{4}-\d{2}$/.test(month) ? month : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`];
    }
    // Exclusions + manual cancels are stored per YYYY-MM; union across the range's months.
    const monthInList = months.map(m => encodeURIComponent(m)).join(",");
    const exRows = await sb(`kpi_exclusions?client_id=eq.${encodeURIComponent(clientId)}&month=in.(${monthInList})&select=metric,offer_id,ref_id`) || [];
    const excl = new Set(exRows.map(r => `${r.metric}|${r.offer_id || ZERO_UUID}|${r.ref_id}`));

    // ─────────── MARKETING ───────────
    // Funnel counts for the range from the kpi_events log (Track A). The UI
    // pairs these with Meta ad spend (meta-report) to compute cost per lead /
    // trial / member (true CAC = spend ÷ new members, not Meta's self-reported
    // "results"). History fills in via the KPI sandbox import.
    if (section === "marketing") {
      const isoStart = new Date(start * 1000).toISOString();
      const isoEnd = new Date(end * 1000).toISOString();
      const countStep = async (step) => {
        try {
          const rows = await sb(`kpi_events?client_id=eq.${encodeURIComponent(clientId)}&step=eq.${step}&occurred_at=gte.${encodeURIComponent(isoStart)}&occurred_at=lt.${encodeURIComponent(isoEnd)}&select=id&limit=5000`);
          return Array.isArray(rows) ? rows.length : 0;
        } catch (_) { return null; }
      };
      const [leads, trialsBooked, joined, cancelled] = await Promise.all([
        countStep("lead"), countStep("trial_booked"), countStep("joined"), countStep("cancelled"),
      ]);
      return res.status(200).json({ ok: true, leads, trials_booked: trialsBooked, joined, cancelled });
    }

    // ─────────── SALES ───────────
    if (section === "sales") {
      const offers = await loadLinks(clientId);

      // ── Merch store sales ──
      // Academy merch stores (e.g. Elevate) charge through the SAME connected
      // Stripe account, via one-off Checkout Sessions stamped metadata.client.
      // They never create a Stripe product or invoice (inline price_data), so
      // the per-offer "new payments" logic below can't see them. Scan the paid
      // Checkout Sessions directly and surface them as their own line. Cleaning
      // uses metric "sales_store" (offer_id null), same exclusion plumbing.
      let store = null;
      if (acct) {
        try {
          const sessions = await stripeGetAll(`/checkout/sessions?created[gte]=${start}&created[lt]=${end}`, acct);
          const paid = sessions.filter(s => s.status === "complete" && s.payment_status === "paid" && s.metadata && s.metadata.client);
          if (paid.length) {
            const items = paid
              .sort((a, b) => (b.created || 0) - (a.created || 0))
              .map(s => ({
                ref_id: s.id,
                label: (s.customer_details && (s.customer_details.name || s.customer_details.email)) || "Order",
                email: (s.customer_details && s.customer_details.email) || null,
                amount: money(s.amount_total),
                created: s.created,
                excluded: isExcluded(excl, "sales_store", null, s.id),
              }));
            const kept = items.filter(i => !i.excluded);
            store = { count: kept.length, revenue: kept.reduce((a, i) => a + i.amount, 0), items };
          }
        } catch (_) {}
      }

      if (!offers.length && !store) return res.status(200).json({ ok: true, offers: [], store: null, note: "Tie Stripe products and GHL pipelines to offers in Setup first." });
      // New payments this month, grouped by product:
      //  • subscriptions created in the month, AND
      //  • one-time (non-subscription) PAID invoices in the month → covers
      //    one-time products/packages, not just subs.
      let payByProduct = {};
      if (acct) {
        try {
          const subs = await stripeGetAll(`/subscriptions?status=all&created[gte]=${start}&created[lt]=${end}&expand[]=data.items.data.price&expand[]=data.customer`, acct);
          for (const s of subs) {
            const price = s.items?.data?.[0]?.price;
            const pid = price && (typeof price.product === "string" ? price.product : price.product?.id);
            if (!pid) continue;
            (payByProduct[pid] = payByProduct[pid] || []).push({ ref_id: s.id, label: custName(s.customer), email: custEmail(s.customer) });
          }
        } catch (_) {}
        try {
          const invs = await stripeGetAll(`/invoices?status=paid&created[gte]=${start}&created[lt]=${end}&expand[]=data.lines.data.price&expand[]=data.customer`, acct);
          for (const inv of invs) {
            if (inv.subscription) continue; // sub invoices already counted via the sub itself
            const seen = new Set();
            for (const line of (inv.lines && inv.lines.data) || []) {
              const price = line.price || line.plan;
              const pid = price && (typeof price.product === "string" ? price.product : price.product?.id);
              if (!pid || seen.has(pid)) continue;
              seen.add(pid);
              (payByProduct[pid] = payByProduct[pid] || []).push({ ref_id: inv.id, label: custName(inv.customer), email: custEmail(inv.customer), one_time: true });
            }
          }
        } catch (_) {}
      }
      const subsByProduct = payByProduct;
      // GHL token (for pipeline opportunity counts)
      let ghlToken = null;
      try { ghlToken = await getClientGhlToken(client); } catch (_) {}
      // contactId → name from the synced mirror — calendar events return only a
      // title (the calendar name) + contactId, so bookings need this to show the
      // person's name instead of "By Any Means Free Trial".
      const nameById = {};
      try {
        const rows = await sb(`${await contactsReadTable(clientId)}?client_id=eq.${encodeURIComponent(clientId)}&select=ghl_contact_id,name,athlete_name&limit=5000`);
        for (const r of (rows || [])) if (r.ghl_contact_id) nameById[r.ghl_contact_id] = r.name || r.athlete_name || null;
      } catch (_) {}
      let ghlError = false;   // a GHL call failed (rate-limit/token) → counts may be understated
      // Pre-fetch each UNIQUE tied pipeline + calendar ONCE, in parallel. (Was a
      // sequential GHL call per offer×pipeline — slow + redundant on academies
      // with many ties, and could blow past the function timeout.)
      const uniqPipes = [...new Map(offers.flatMap(o => o.pipelines).map(p => [p.id, p])).values()];
      const uniqCals = [...new Map(offers.flatMap(o => o.calendars || []).map(c => [c.id, c])).values()];
      const pipeById = {}, bookById = {};
      // Pipeline provider: 'portal' academies count from THEIR OWN data (the
      // portal opportunities store + the kpi_events log) - GHL is not consulted.
      let pipelineProv = "ghl";
      try {
        const pr = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=pipeline_provider&limit=1`);
        if (pr?.[0]?.pipeline_provider === "portal") pipelineProv = "portal";
      } catch (_) {}
      let portalBookItems = null;
      if (pipelineProv === "portal") {
        const isoStart = new Date(start * 1000).toISOString();
        const isoEnd = new Date(end * 1000).toISOString();
        // sales_pipeline ← portal opportunities created in range, per tied pipeline id.
        await Promise.all(uniqPipes.map(async (p) => {
          try {
            const rows = await sb(`opportunities?client_id=eq.${encodeURIComponent(clientId)}&ghl_pipeline_id=eq.${encodeURIComponent(p.id)}&created_at=gte.${encodeURIComponent(isoStart)}&created_at=lt.${encodeURIComponent(isoEnd)}&select=id,ghl_opportunity_id,contact_name,ghl_contact_id&limit=1000`);
            pipeById[p.id] = (rows || []).map((r) => ({ ref_id: r.ghl_opportunity_id || r.id, label: r.contact_name || nameById[r.ghl_contact_id] || "Lead", contactId: r.ghl_contact_id || null }));
          } catch (_) { pipeById[p.id] = []; }
        }));
        // sales_bookings ← the KPI event log (trial_booked, written at the moment
        // any card moves to Scheduled Trial). Only accumulates from Track A launch;
        // history arrives later via the KPI sandbox import.
        try {
          const evs = await sb(`kpi_events?client_id=eq.${encodeURIComponent(clientId)}&step=eq.trial_booked&occurred_at=gte.${encodeURIComponent(isoStart)}&occurred_at=lt.${encodeURIComponent(isoEnd)}&select=id,ref,ghl_contact_id,contact_name&order=occurred_at.asc&limit=1000`);
          portalBookItems = (evs || []).map((ev) => ({ ref_id: ev.ref || ev.id, label: ev.contact_name || nameById[ev.ghl_contact_id] || "Trial booking", contactId: ev.ghl_contact_id || null }));
        } catch (_) { portalBookItems = []; }
      }
      if (ghlToken && pipelineProv !== "portal") {
        await Promise.all([
          ...uniqPipes.map(async (p) => {
            try {
              const r = await ghl(ghlToken, "GET", `/opportunities/search?location_id=${encodeURIComponent(client.ghl_location_id)}&pipeline_id=${encodeURIComponent(p.id)}&limit=100`);
              pipeById[p.id] = (r.opportunities || r.data || []).filter((op) => {
                const c = op.createdAt ? Math.floor(new Date(op.createdAt).getTime() / 1000) : null;
                return c != null && c >= start && c < end;
              }).map((op) => ({ ref_id: op.id, label: op.contact?.name || op.contactName || op.name || "Lead", contactId: op.contactId || op.contact?.id || null }));
            } catch (_) { ghlError = true; pipeById[p.id] = []; }
          }),
          ...uniqCals.map(async (cal) => {
            try {
              const r = await ghl(ghlToken, "GET", `/calendars/events?locationId=${encodeURIComponent(client.ghl_location_id)}&calendarId=${encodeURIComponent(cal.id)}&startTime=${start * 1000}&endTime=${end * 1000}`);
              const evs = (r.events || []).filter((ev) => ev.appointmentStatus !== "cancelled");
              // Calendar events carry only the calendar TITLE (e.g. "By Any Means
              // Free Trial") + a contactId — never the person's name. Resolve any
              // contactIds the mirror didn't cover straight from GHL so a booking
              // shows the booker, not the calendar name.
              const missing = [...new Set(evs.map((ev) => ev.contactId || (ev.contact && ev.contact.id)).filter((cid) => cid && !nameById[cid]))].slice(0, 30);
              await Promise.all(missing.map(async (cid) => {
                try {
                  const cr = await ghl(ghlToken, "GET", `/contacts/${encodeURIComponent(cid)}`);
                  const c = cr.contact || cr;
                  nameById[cid] = c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || nameById[cid] || null;
                } catch (_) {}
              }));
              bookById[cal.id] = evs.map((ev) => {
                const cid = ev.contactId || (ev.contact && ev.contact.id) || null;
                const nm = (cid && nameById[cid]) || (ev.contact && ev.contact.name) || ev.contactName || null;
                return { ref_id: ev.id || ev._id, label: nm || "Trial booking", contactId: cid };
              });
            } catch (_) { ghlError = true; bookById[cal.id] = []; }
          }),
        ]);
      }
      // Portal bookings aren't calendar-keyed; attach them to the offer that has
      // calendars tied (else the first with pipelines - GTA's Training offer).
      const bookOffer = offers.find((o) => (o.calendars || []).length) || offers.find((o) => o.pipelines.length) || offers[0];
      const out = [];
      for (const o of offers) {
        const pipeItems = o.pipelines.flatMap((p) => pipeById[p.id] || []);
        // new payments: subs/one-time created in month for tied products
        const payItems = [];
        for (const pid of o.products) for (const it of (subsByProduct[pid] || [])) payItems.push(it);
        const bookItems = pipelineProv === "portal"
          ? (o === bookOffer ? (portalBookItems || []) : [])
          : (o.calendars || []).flatMap((c) => bookById[c.id] || []);

        const decorate = (items, metric) => items.map(it => ({ ...it, excluded: isExcluded(excl, metric, o.offer_id, it.ref_id) }));
        const pipe = decorate(pipeItems, "sales_pipeline");
        const pay = decorate(payItems, "sales_payments");
        const book = decorate(bookItems, "sales_bookings");
        out.push({
          offer_id: o.offer_id, title: o.title,
          pipeline: { count: pipe.filter(i => !i.excluded).length, items: pipe },
          payments: { count: pay.filter(i => !i.excluded).length, items: pay },
          bookings: { count: book.filter(i => !i.excluded).length, items: book },
          has_pipelines: o.pipelines.length > 0, has_products: o.products.length > 0, has_calendars: (o.calendars || []).length > 0,
        });
      }
      return res.status(200).json({ ok: true, offers: out, store, ghl_ok: pipelineProv === "portal" ? true : !!ghlToken, ghl_error: pipelineProv === "portal" ? false : (ghlError || !ghlToken), stripe_ok: !!acct });
    }

    // ─────────── REVENUE ───────────
    if (section === "revenue") {
      if (!acct) return res.status(200).json({ ok: true, stripe_ok: false });
      const charges = await stripeGetAll(`/charges?created[gte]=${start}&created[lt]=${end}&expand[]=data.balance_transaction&expand[]=data.customer`, acct);
      let gross = 0, refunds = 0, fees = 0;
      const failed = [];
      for (const ch of charges) {
        if (ch.status === "succeeded" && ch.paid) {
          gross += ch.amount || 0;
          refunds += ch.amount_refunded || 0;
          const bt = ch.balance_transaction;
          if (bt && typeof bt === "object") fees += bt.fee || 0;
        } else if (ch.status === "failed") {
          failed.push({ id: ch.id, amount: money(ch.amount), created: ch.created, customer: custId(ch.customer), name: custName(ch.customer), email: custEmail(ch.customer) || ch.billing_details?.email || null, reason: ch.failure_message || ch.outcome?.seller_message || null });
        }
      }
      const payoutsArr = await stripeGetAll(`/payouts?created[gte]=${start}&created[lt]=${end}`, acct).catch(() => []);
      const payouts = payoutsArr.reduce((s, p) => s + (p.amount || 0), 0);
      return res.status(200).json({
        ok: true, stripe_ok: true,
        gross: money(gross), refunds: money(refunds), fees: money(fees),
        net: money(gross - refunds - fees),
        payouts: money(payouts), payouts_count: payoutsArr.length,
        failed,
      });
    }

    // ─────────── MEMBERS ───────────
    if (section === "members") {
      const manual = await sb(`kpi_manual_cancellations?client_id=eq.${encodeURIComponent(clientId)}&month=in.(${monthInList})&select=id,contact_name,reason,cancelled_on,stripe_customer_id,ghl_contact_id&order=created_at.desc`) || [];
      if (!acct) return res.status(200).json({ ok: true, stripe_ok: false, payments: [], cancelled: { count: 0, items: [] }, manual });
      // payments this month (succeeded charges)
      const charges = await stripeGetAll(`/charges?created[gte]=${start}&created[lt]=${end}&expand[]=data.customer`, acct);
      const payments = charges.filter(c => c.status === "succeeded" && c.paid).map(c => ({
        id: c.id, amount: money(c.amount), created: c.created, customer: custId(c.customer),
        name: custName(c.customer), email: custEmail(c.customer) || c.billing_details?.email || null,
        description: c.description || null, receipt_url: c.receipt_url || null,
        last4: c.payment_method_details?.card?.last4 || null,
      })).sort((a, b) => b.created - a.created);
      // cancelled subs this month (canceled_at within range)
      const canceledSubs = await stripeGetAll(`/subscriptions?status=canceled&expand[]=data.customer`, acct).catch(() => []);
      const cancelledItems = canceledSubs
        .filter(s => s.canceled_at && s.canceled_at >= start && s.canceled_at < end)
        .map(s => ({ ref_id: s.id, label: custName(s.customer), email: custEmail(s.customer), canceled_at: s.canceled_at, excluded: isExcluded(excl, "members_cancelled", null, s.id) }));
      // Current roster snapshot: live + paused member counts.
      const memberRows = await sb(`members?client_id=eq.${encodeURIComponent(clientId)}&select=status`).catch(() => []) || [];
      const liveCount = memberRows.filter(m => m.status === "live" || m.status === "cancelling").length;
      const pausedCount = memberRows.filter(m => m.status === "paused").length;
      return res.status(200).json({
        ok: true, stripe_ok: true,
        payments,
        cancelled: { count: cancelledItems.filter(i => !i.excluded).length, items: cancelledItems },
        manual,
        roster: { live: liveCount, paused: pausedCount },
      });
    }

    // ─────────── STORE (merch order management) ───────────
    // Recent merch orders (paid + comp Checkout Sessions tagged metadata.client)
    // on the connected account, newest first, with fulfillment detail. `enabled`
    // drives whether the client portal reveals the Store tab.
    if (section === "store") {
      const enabled = !!(client.ghl_kpi_config && client.ghl_kpi_config.store_order_workflow_id);
      if (!acct) return res.status(200).json({ ok: true, enabled, stripe_ok: false, orders: [] });
      let orders = [];
      try {
        const sessions = await stripeGetAll(`/checkout/sessions`, acct, 3); // up to ~300 recent
        orders = sessions
          .filter(s => s.status === "complete" && s.payment_status && s.metadata && s.metadata.client)
          .map(s => {
            const cd = s.customer_details || {};
            const ad = (s.shipping_details && s.shipping_details.address) || cd.address || {};
            const ship = [ad.line1, ad.line2, [ad.city, ad.state].filter(Boolean).join(", "), ad.postal_code, ad.country].filter(Boolean).join(", ");
            return {
              id: s.id,
              order_no: `ORD-${String(s.id).replace(/^cs_(test_|live_)?/, "").slice(0, 8).toUpperCase()}`,
              created: s.created,
              name: cd.name || null,
              email: cd.email || null,
              phone: cd.phone || null,
              amount: money(s.amount_total),
              status: s.payment_status === "paid" ? "Paid" : (s.payment_status === "no_payment_required" ? "Comp" : s.payment_status),
              shipping: ship || null,
            };
          })
          .sort((a, b) => (b.created || 0) - (a.created || 0));
      } catch (_) {}
      return res.status(200).json({ ok: true, enabled, stripe_ok: true, orders });
    }

    return res.status(400).json({ error: "unknown section" });
  } catch (e) {
    let msg = e && e.message; if (!msg) { try { msg = JSON.stringify(e); } catch (_) { msg = String(e); } }
    console.error("kpis-v15 error:", msg, e && e.stack);
    return res.status((e && e.status) || 500).json({ error: msg || "unknown error" });
  }
}

export default withSentryApiRoute(handler);
