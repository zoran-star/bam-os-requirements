import { withSentryApiRoute } from "./_sentry.js";
import { stripeFetch as transportStripeFetch } from "./_stripe-transport.js";
// Vercel Serverless Function - Commission & BAM Payment Calculator
// (Mike / BAM spec, 2026-07-25 - built off the Scaling System Partner
// Agreement's growth-share clause).
//
// Two payment models on the client record:
//   flat_retainer      -> BAM Payment Due = flat_amount. No growth math, no
//                         SM commission, excluded from reports.
//   growth_percentage  -> per cycle (anchored to the client's OWN
//                         subscription_renewal_date, e.g. Jul 25 -> Aug 25):
//                           growth   = max(0, gross_revenue - baseline)
//                           fee      = growth_share_pct% x growth
//                           total    = base_retainer + fee
//                           sm_comm  = $250 + 25% x fee   (only when growth > 0)
//                         No-growth month -> flat base retainer only.
//
// Cycle close generates a Stripe invoice on the client's own renewal date
// (platform key + clients.stripe_customer_id; due 5 business days per
// Agreement §2; the $50/day late fee after the 3-day grace period is NOT
// automated - referenced on the invoice, handled manually).
//
// Reporting/SM payout is BATCHED, decoupled from invoicing: two windows per
// month - 3 business days before the 1st and before the 15th (Mon-Fri,
// Eastern). Renewal on the 1st-15th -> "fifteenth" batch; 16th-EOM -> "first"
// batch (of the following month). PDF report -> Anna + Cole; SM payout is
// handled manually off the report (the portal only calculates the number).
//
// Revenue (Agreement §4): pulled from the client's revenue integration -
// 'stripe_connect' sums RAW gross charges on the academy's connected Stripe
// account (no refund/chargeback netting, per spec). A failed/empty pull does
// NOT silently skip: the cycle is stored as failed, no invoice is generated,
// and Mike + Cole get an email alert to resolve it manually.
//
//   GET  ?action=overview                     staff (admin: all, SM: own clients)
//   GET  ?action=cycles&client_id=            cycle history
//   POST ?action=save-settings                admin - payment terms (baseline 9-month lock)
//   POST ?action=run-cycle                    admin - manual/preview run { client_id, dry_run }
//   GET  ?action=cron-cycles                  daily cron - close cycles + invoice
//   GET  ?action=cron-reports                 daily cron - batched PDF reports
import { sendEmail } from "./_email.js";
import { renderCommissionReportPdf } from "./_lib/commission-pdf.js";
import { ADMIN_ROLES, hasRole } from "./_roles.js";

export const maxDuration = 60;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

// Report recipients (Growth Percentage clients only): Anna + Cole per spec.
const REPORT_EMAILS = (process.env.COMMISSION_REPORT_EMAILS || "acallon@gmail.com,cole@byanymeansbball.com")
  .split(",").map(s => s.trim()).filter(Boolean);
// Revenue-pull failure alerts go to Mike + Cole per spec (override via env).
const ALERT_EMAILS = (process.env.COMMISSION_ALERT_EMAILS || "mike@byanymeansbusiness.com,cole@byanymeansbball.com")
  .split(",").map(s => s.trim()).filter(Boolean);

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

// ── Auth (staff only - clients never see commission figures) ───────────────
async function resolveStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let rows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role&limit=1`);
  if ((!rows || !rows[0]) && user.email) {
    rows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role&limit=1`);
  }
  const staff = Array.isArray(rows) && rows[0];
  if (!staff) throw Object.assign(new Error("staff only"), { status: 403 });
  return { user, staff, isAdmin: hasRole(staff.role, ADMIN_ROLES), isSM: staff.role === "scaling_manager" };
}

function cronOk(req) {
  if (req.headers["x-vercel-cron"]) return true;
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return !!(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
}

// ── Date helpers (date-only strings; business days = Mon-Fri Eastern) ──────
function todayET() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
function parseYMD(s) { const [y, m, d] = String(s).split("-").map(Number); return { y, m, d }; }
function ymd(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function addMonthsClamped(dateStr, n) {
  const { y, m, d } = parseYMD(dateStr);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
function addDays(dateStr, n) {
  const { y, m, d } = parseYMD(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
function isBusinessDay(dateStr) {
  const { y, m, d } = parseYMD(dateStr);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}
// The date exactly n business days BEFORE target (walking back Mon-Fri).
function businessDaysBefore(targetStr, n) {
  let cur = targetStr, count = 0;
  while (count < n) {
    cur = addDays(cur, -1);
    if (isBusinessDay(cur)) count += 1;
  }
  return cur;
}
// n business days AFTER start (invoice due date: 5 business days, Agreement §2).
function businessDaysAfter(startStr, n) {
  let cur = startStr, count = 0;
  while (count < n) {
    cur = addDays(cur, 1);
    if (isBusinessDay(cur)) count += 1;
  }
  return cur;
}
// Does this client's monthly cycle close today? Anchored to THEIR renewal
// date: a July 25 signup closes Aug 25, Sep 25... (clamped for short months).
// Every cycle is a full month from their own date - no proration needed.
function cycleClosesOn(renewalStr, dayStr) {
  if (!renewalStr || dayStr <= renewalStr) return false;
  const r = parseYMD(renewalStr);
  const t = parseYMD(dayStr);
  return t.d === Math.min(r.d, daysInMonth(t.y, t.m));
}
// Renewal on the 1st-15th -> swept into the "before the 15th" batch;
// 16th-EOM -> the "before the 1st" (of next month) batch.
function payoutBatchFor(cycleDateStr) {
  return parseYMD(cycleDateStr).d <= 15 ? "fifteenth" : "first";
}
function epochSeconds(dateStr) {
  const { y, m, d } = parseYMD(dateStr);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}
// ── CALENDAR months (the Commissions page's revenue column) ────────────────
// Deliberately separate from the cycle windows above: a cycle runs renewal-date
// to renewal-date (e.g. Jul 25 -> Aug 25), which is NOT what "last month's
// revenue" means. The column reports whole calendar months so the number lines
// up with what an academy owner sees in their own Stripe dashboard.
function monthStartOf(dateStr) { const { y, m } = parseYMD(dateStr); return ymd(y, m, 1); }
// First day of the most recent FULLY COMPLETED calendar month.
function lastCompletedMonthStart(todayStr) { return addMonthsClamped(monthStartOf(todayStr), -1); }
// The n completed calendar months ending with `lastStart`, newest first.
function completedMonthsBack(lastStart, n) {
  return Array.from({ length: n }, (_, i) => addMonthsClamped(lastStart, -i));
}
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Stripe (platform key for invoicing; connected account for revenue) ─────
async function stripeForm(path, params, extraHeaders = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 200)}`);
  return json;
}
async function stripeGetAll(path, acct) {
  // ACADEMY-SCOPED revenue read, now through THE seam (api/_stripe-transport.js)
  // so a direct-key academy's gross revenue is readable too. The platform-key
  // stripeForm invoicing half above is deliberately NOT delegated - BAM invoices
  // its clients on BAM's own account, which is not an academy-scoped call.
  // Guard the key the SEAM actually uses, not the one this file's invoicing
  // half uses. This checked STRIPE_SECRET_KEY only, so a prod that had switched
  // to the Connect key alone would have thrown "STRIPE_SECRET_KEY not
  // configured" on every revenue read while every other Stripe feature - all of
  // which go through the transport - kept working. A direct-key academy needs
  // neither: its own key comes out of client_stripe_direct.
  if (!process.env.STRIPE_CONNECT_SECRET_KEY && !process.env.STRIPE_SECRET_KEY) {
    throw new Error("no Stripe platform key configured (STRIPE_CONNECT_SECRET_KEY or STRIPE_SECRET_KEY)");
  }
  const out = [];
  let startingAfter = null;
  for (let i = 0; i < 20; i++) {
    const sep = path.includes("?") ? "&" : "?";
    let json;
    try {
      json = await transportStripeFetch(`${path}${sep}limit=100${startingAfter ? `&starting_after=${startingAfter}` : ""}`, { stripeAccount: acct });
    } catch (e) {
      if (!e.stripeStatus) throw e;
      throw new Error(`Stripe ${e.stripeStatus}: ${(e.stripeResponse && e.stripeResponse.error && e.stripeResponse.error.message) || "error"}`);
    }
    out.push(...(json.data || []));
    if (!json.has_more || !json.data?.length) break;
    startingAfter = json.data[json.data.length - 1].id;
  }
  return out;
}

// RAW gross revenue for the cycle window [start, end) - per spec, do NOT net
// out refunds or chargebacks. Returns dollars.
async function pullGrossRevenue(client, startStr, endStr) {
  const source = client.revenue_integration_connection || (client.stripe_connect_account_id ? "stripe_connect" : null);
  if (source === "stripe_connect") {
    const acct = client.stripe_connect_account_id;
    if (!acct) throw new Error("revenue source is stripe_connect but no connected Stripe account on the client record");
    const charges = await stripeGetAll(
      `/charges?created[gte]=${epochSeconds(startStr)}&created[lt]=${epochSeconds(endStr)}`, acct
    );
    let cents = 0;
    for (const ch of charges) {
      if (ch.status === "succeeded" && ch.paid) cents += ch.amount || 0;
    }
    return round2(cents / 100);
  }
  if (source === "ghl") {
    // Reserved: no GHL payments pull wired yet - fails loudly so Mike + Cole
    // get the alert and can enter the number manually via run-cycle.
    throw new Error("GHL revenue integration is not wired up yet");
  }
  throw new Error("no revenue integration configured on the client record");
}

// ── Calendar-month gross revenue (Commissions page column + drilldown) ─────
// Same RAW gross figure the cycle engine uses (no refund/chargeback netting,
// per Agreement §4) but windowed to a whole calendar month.
//
// Never throws: one academy with a broken/absent Stripe connection must not
// blank the column for the other twelve. Every month comes back with an
// explicit status so the UI can say WHY a number is missing instead of showing
// a dash that reads as "$0".
//   ok             -> gross is a number
//   not_connected  -> no revenue source on the client record (human must connect Stripe)
//   failed         -> the source is configured but Stripe refused (error carries why)
//
// A completed calendar month's raw charge total is immutable once the month is
// over, so results are cached per lambda instance. Cold instances re-pull; that
// is fine, this is a read-only report.
const REVENUE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const monthRevenueCache = new Map(); // `${clientId}:${monthStart}` -> { at, value }

function revenueSourceOf(client) {
  return client.revenue_integration_connection || (client.stripe_connect_account_id ? "stripe_connect" : null);
}

async function grossForMonth(client, monthStart) {
  const key = `${client.id}:${monthStart}`;
  const hit = monthRevenueCache.get(key);
  if (hit && Date.now() - hit.at < REVENUE_CACHE_TTL_MS) return hit.value;

  let value;
  if (!revenueSourceOf(client)) {
    value = { month: monthStart, gross: null, status: "not_connected", error: null };
  } else {
    try {
      const gross = await pullGrossRevenue(client, monthStart, addMonthsClamped(monthStart, 1));
      value = { month: monthStart, gross, status: "ok", error: null };
    } catch (e) {
      value = { month: monthStart, gross: null, status: "failed", error: e?.message || String(e) };
    }
  }
  // Only cache a real answer - a transient Stripe failure should retry on the
  // next page load, not stick around for six hours.
  if (value.status !== "failed") monthRevenueCache.set(key, { at: Date.now(), value });
  return value;
}

// Failure alert (Mike + Cole): a pull failure must never silently skip or
// block - humans resolve it before the invoice/report cycle runs.
async function alertPullFailure(client, cycleDate, errMsg) {
  const subject = `Commission revenue pull FAILED - ${client.business_name}`;
  const html = `<p>The gross-revenue pull failed while closing the ${cycleDate} commission cycle for <b>${client.business_name}</b>.</p>
<p><b>Error:</b> ${String(errMsg || "unknown").replace(/</g, "&lt;")}</p>
<p>No Stripe invoice was generated for this cycle. Fix the integration (or run the cycle manually from the staff portal Commissions page) before the report window.</p>`;
  for (const to of ALERT_EMAILS) {
    try { await sendEmail({ to, subject, html, clientId: client.id, tags: [{ name: "kind", value: "commission-alert" }] }); }
    catch (e) { console.error("commission alert email failed:", e?.message || e); }
  }
}

// ── Calculation engine ─────────────────────────────────────────────────────
function computeCycle(client, gross) {
  if (client.payment_model === "flat_retainer") {
    return {
      payment_model: "flat_retainer",
      gross_revenue: gross == null ? null : round2(gross),
      baseline_revenue: null, growth_amount: null, growth_share_pct: null,
      growth_share_fee: null, base_retainer: null,
      total_bam_payment: round2(client.flat_amount),
      sm_commission: null,
    };
  }
  const baseline = Number(client.baseline_revenue || 0);
  const pct = Number(client.growth_share_pct || 0);
  const base = Number(client.base_retainer || 599);
  const growth = Math.max(0, round2(gross - baseline));
  const fee = round2((pct / 100) * growth);
  return {
    payment_model: "growth_percentage",
    gross_revenue: round2(gross),
    baseline_revenue: round2(baseline),
    growth_amount: growth,
    growth_share_pct: pct,
    growth_share_fee: fee,
    base_retainer: round2(base),
    total_bam_payment: round2(base + fee),
    // Only when there IS growth this cycle - no-growth months pay no SM commission.
    sm_commission: growth > 0 ? round2(250 + 0.25 * fee) : 0,
  };
}

// ── Stripe invoice (platform account bills the client) ─────────────────────
// Due 5 business days from invoice date (Agreement §2). Late fee ($50/day
// after a 3-day grace period) is referenced in the footer, NOT automated.
// auto_advance=false: Anna + Cole handle collection manually, the portal only
// generates the finalized invoice.
async function createStripeInvoice(client, calc, cycleStart, cycleDate) {
  if (!client.stripe_customer_id) throw new Error("client has no stripe_customer_id on the platform account");
  const customer = client.stripe_customer_id;
  const period = `${cycleStart} to ${cycleDate}`;

  const lines = [];
  if (calc.payment_model === "flat_retainer") {
    lines.push({ amount: calc.total_bam_payment, description: `BAM monthly retainer (flat) - ${period}` });
  } else {
    lines.push({ amount: calc.base_retainer, description: `Base monthly retainer - ${period}` });
    if (calc.growth_share_fee > 0) {
      lines.push({
        amount: calc.growth_share_fee,
        description: `Growth share fee - ${calc.growth_share_pct}% of ${money(calc.growth_amount)} growth ` +
          `(gross ${money(calc.gross_revenue)} - baseline ${money(calc.baseline_revenue)}) - ${period}`,
      });
    }
  }

  for (const line of lines) {
    await stripeForm("/invoiceitems", {
      customer,
      amount: String(Math.round(line.amount * 100)),
      currency: "usd",
      description: line.description,
    });
  }

  const footer =
    `Cycle ${period}. Due within 5 business days of the invoice date (Agreement s.2). ` +
    `A $50/day late fee applies after a 3-day grace period (assessed manually).` +
    (calc.payment_model === "growth_percentage"
      ? ` Figures: baseline ${money(calc.baseline_revenue)}, gross revenue ${money(calc.gross_revenue)}, growth ${money(calc.growth_amount)}, ` +
        `growth share ${calc.growth_share_pct}% = ${money(calc.growth_share_fee)}, base retainer ${money(calc.base_retainer)}, total due ${money(calc.total_bam_payment)}.`
      : "");

  const inv = await stripeForm("/invoices", {
    customer,
    collection_method: "send_invoice",
    due_date: String(epochSeconds(businessDaysAfter(cycleDate, 5))),
    auto_advance: "false",
    description: `BAM payment - cycle ${period}`,
    footer: footer.slice(0, 500),
  });
  const finalized = await stripeForm(`/invoices/${inv.id}/finalize`, {});
  return { id: finalized.id, status: finalized.status };
}

// Close one client's cycle: pull revenue, compute, snapshot, invoice.
// Returns the stored row (or the computed preview when dryRun).
async function closeCycle(client, cycleDate, { dryRun = false, force = false, grossOverride = null } = {}) {
  const cycleStart = addMonthsClamped(cycleDate, -1);
  const existing = await sb(`commission_cycles?client_id=eq.${client.id}&cycle_date=eq.${cycleDate}&select=id,invoice_id&limit=1`);
  if (existing?.[0] && !force && !dryRun) {
    return { skipped: "already_closed", id: existing[0].id };
  }

  let gross = null, pullStatus = "success", pullError = null;
  if (grossOverride != null) {
    gross = round2(grossOverride);
  } else if (client.payment_model === "growth_percentage") {
    try { gross = await pullGrossRevenue(client, cycleStart, cycleDate); }
    catch (e) { pullStatus = "failed"; pullError = e?.message || String(e); }
  }

  const calc = pullStatus === "failed"
    ? { payment_model: client.payment_model }
    : computeCycle(client, gross);

  const row = {
    client_id: client.id,
    cycle_date: cycleDate,
    cycle_start: cycleStart,
    ...calc,
    sm_staff_id: client.scaling_manager_id || null,
    payout_batch: payoutBatchFor(cycleDate),
    revenue_pull_status: pullStatus,
    revenue_pull_error: pullError,
  };

  if (dryRun) return { preview: row };

  // Invoice only on a clean calc - a failed pull stores the failed cycle and
  // alerts Mike + Cole instead (they resolve + re-run manually).
  if (pullStatus === "success") {
    try {
      const inv = await createStripeInvoice(client, calc, cycleStart, cycleDate);
      row.invoice_id = inv.id;
      row.invoice_status = inv.status;
    } catch (e) {
      row.invoice_status = "error";
      row.revenue_pull_error = `invoice: ${e?.message || e}`;
      await alertPullFailure(client, cycleDate, row.revenue_pull_error);
    }
  } else {
    await alertPullFailure(client, cycleDate, pullError);
  }

  const saved = await sb(`commission_cycles?on_conflict=client_id,cycle_date`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  return { row: Array.isArray(saved) ? saved[0] : saved };
}

const CLIENT_COLS = "id,business_name,status,archived_at,scaling_manager_id,stripe_customer_id,stripe_connect_account_id," +
  "payment_model,flat_amount,base_retainer,baseline_revenue,baseline_locked_until,growth_share_pct," +
  "subscription_renewal_date,revenue_integration_connection";

// ── Handler ────────────────────────────────────────────────────────────────
async function handler(req, res) {
  const action = (req.query && req.query.action) || "";

  // ── Daily cron: close every cycle whose renewal anniversary is today ─────
  if (action === "cron-cycles") {
    if (!cronOk(req)) return res.status(401).json({ error: "unauthorized" });
    const today = todayET();
    const clients = await sb(`clients?payment_model=not.is.null&archived_at=is.null&select=${CLIENT_COLS}`);
    const results = [];
    for (const c of clients || []) {
      if (!cycleClosesOn(c.subscription_renewal_date, today)) continue;
      try {
        const r = await closeCycle(c, today);
        results.push({ client: c.business_name, ...(r.skipped ? { skipped: r.skipped } : { cycle: r.row?.cycle_date, invoice: r.row?.invoice_id || null, pull: r.row?.revenue_pull_status }) });
      } catch (e) {
        console.error("cron-cycles failed for", c.id, e?.message || e);
        results.push({ client: c.business_name, error: e?.message || String(e) });
      }
    }
    return res.status(200).json({ ok: true, date: today, closed: results });
  }

  // ── Daily cron: batched PDF report to Anna + Cole (growth clients only) ──
  if (action === "cron-reports") {
    if (!cronOk(req)) return res.status(401).json({ error: "unauthorized" });
    const today = todayET();
    const t = parseYMD(today);
    // Report days: 3 business days before the 1st and before the 15th (ET).
    const firstTargets = [ymd(t.y, t.m, 1), addMonthsClamped(ymd(t.y, t.m, 1), 1)];
    const fifteenthTargets = [ymd(t.y, t.m, 15), addMonthsClamped(ymd(t.y, t.m, 15), 1)];
    let batch = null, windowTarget = null;
    if (firstTargets.some(d => businessDaysBefore(d, 3) === today)) {
      batch = "first"; windowTarget = firstTargets.find(d => businessDaysBefore(d, 3) === today);
    } else if (fifteenthTargets.some(d => businessDaysBefore(d, 3) === today)) {
      batch = "fifteenth"; windowTarget = fifteenthTargets.find(d => businessDaysBefore(d, 3) === today);
    }
    if (!batch && req.query.force_batch) { batch = req.query.force_batch; windowTarget = today; }
    if (!batch) return res.status(200).json({ ok: true, date: today, skipped: "not a report day" });

    // Growth Percentage cycles only, not yet reported, in this batch.
    const cycles = await sb(
      `commission_cycles?payout_batch=eq.${batch}&report_sent_at=is.null&payment_model=eq.growth_percentage` +
      `&revenue_pull_status=eq.success&select=*&order=cycle_date.asc`
    );
    if (!cycles?.length) return res.status(200).json({ ok: true, date: today, batch, skipped: "no unreported cycles" });

    const clientIds = [...new Set(cycles.map(c => c.client_id))];
    const crows = await sb(`clients?id=in.(${clientIds.join(",")})&select=id,business_name,scaling_manager_id`);
    const names = Object.fromEntries((crows || []).map(c => [c.id, c.business_name]));
    const smIds = [...new Set((crows || []).map(c => c.scaling_manager_id).filter(Boolean))];
    const srows = smIds.length ? await sb(`staff?id=in.(${smIds.join(",")})&select=id,name`) : [];
    const smNames = Object.fromEntries((srows || []).map(s => [s.id, s.name]));
    const smByClient = Object.fromEntries((crows || []).map(c => [c.id, smNames[c.scaling_manager_id] || null]));

    const rows = cycles.map(c => ({
      client_name: names[c.client_id] || c.client_id,
      baseline_revenue: c.baseline_revenue, gross_revenue: c.gross_revenue,
      growth_amount: c.growth_amount, growth_share_fee: c.growth_share_fee,
      total_bam_payment: c.total_bam_payment,
      sm_name: smNames[c.sm_staff_id] || smByClient[c.client_id] || "-",
      sm_commission: c.sm_commission,
    }));

    const batchLabel = batch === "first" ? "Batch: renewals 16th-EOM (paid before the 1st)" : "Batch: renewals 1st-15th (paid before the 15th)";
    const pdfBytes = await renderCommissionReportPdf({
      batchLabel, windowLabel: `Window: ${windowTarget}`, generatedOn: today, rows,
    });
    const attachment = { filename: `bam-commission-report-${today}.pdf`, content: Buffer.from(pdfBytes).toString("base64") };

    const listHtml = rows.map(r =>
      `<tr><td>${r.client_name}</td><td align="right">${money(r.total_bam_payment)}</td><td>${r.sm_name}</td><td align="right">${money(r.sm_commission)}</td></tr>`
    ).join("");
    const html = `<p>Attached: BAM commission report for the ${windowTarget} window (${rows.length} growth-percentage client${rows.length === 1 ? "" : "s"}).</p>
<table border="0" cellpadding="4"><tr><th align="left">Client</th><th align="right">Total BAM</th><th align="left">SM</th><th align="right">SM commission</th></tr>${listHtml}</table>
<p>SM payout is handled manually - this report is the calculation record.</p>`;

    const sent = [];
    for (const to of REPORT_EMAILS) {
      try {
        await sendEmail({ to, subject: `BAM Commission Report - ${windowTarget} window`, html, attachments: [attachment], tags: [{ name: "kind", value: "commission-report" }] });
        sent.push(to);
      } catch (e) { console.error("commission report email failed for", to, e?.message || e); }
    }
    if (sent.length) {
      const nowIso = new Date().toISOString();
      await sb(`commission_cycles?id=in.(${cycles.map(c => c.id).join(",")})`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ report_sent_at: nowIso }),
      });
    }
    return res.status(200).json({ ok: true, date: today, batch, window: windowTarget, clients: rows.length, sent });
  }

  try {
    const ctx = await resolveStaff(req);
    const smClientIds = async () => {
      const rows = await sb(`clients?scaling_manager_id=eq.${ctx.staff.id}&select=id`);
      return (rows || []).map(r => r.id);
    };

    // ── GET overview: payment terms + latest cycle per visible client ──────
    if (req.method === "GET" && (action === "" || action === "overview")) {
      if (!ctx.isAdmin && !ctx.isSM) return res.status(403).json({ error: "admin or scaling manager only" });
      let clientFilter = "";
      if (!ctx.isAdmin) {
        const ids = await smClientIds();
        if (!ids.length) return res.status(200).json({ clients: [], cycles: [], me: { role: ctx.staff.role } });
        clientFilter = `&id=in.(${ids.join(",")})`;
      }
      const clients = await sb(`clients?archived_at=is.null${clientFilter}&select=${CLIENT_COLS}&order=business_name.asc`);
      const ids = (clients || []).map(c => c.id);
      const cycles = ids.length
        ? await sb(`commission_cycles?client_id=in.(${ids.join(",")})&select=*&order=cycle_date.desc&limit=200`)
        : [];
      const smIds = [...new Set((clients || []).map(c => c.scaling_manager_id).filter(Boolean))];
      const srows = smIds.length ? await sb(`staff?id=in.(${smIds.join(",")})&select=id,name`) : [];
      return res.status(200).json({
        clients: clients || [], cycles: cycles || [], sms: srows || [],
        me: { role: ctx.staff.role, is_admin: ctx.isAdmin },
      });
    }

    // ── GET cycles: full history for one client ────────────────────────────
    if (req.method === "GET" && action === "cycles") {
      const clientId = req.query.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!ctx.isAdmin) {
        const ids = await smClientIds();
        if (!ids.includes(clientId)) return res.status(403).json({ error: "not your client" });
      }
      const cycles = await sb(`commission_cycles?client_id=eq.${clientId}&select=*&order=cycle_date.desc`);
      return res.status(200).json({ cycles: cycles || [] });
    }

    // ── GET monthly-revenue: calendar-month GROSS revenue ──────────────────
    // Two shapes, one action:
    //   no client_id  -> last completed month for every client you can see
    //                    (the Commissions table's "Last month" column)
    //   client_id     -> that client's last `months` completed months, newest
    //                    first (the month-by-month drilldown)
    // Loaded separately from ?action=overview on purpose: the table paints
    // instantly off Supabase while the slower Stripe fan-out fills in behind it.
    if (req.method === "GET" && action === "monthly-revenue") {
      if (!ctx.isAdmin && !ctx.isSM) return res.status(403).json({ error: "admin or scaling manager only" });
      const lastStart = lastCompletedMonthStart(todayET());
      const clientId = req.query.client_id;

      if (clientId) {
        if (!ctx.isAdmin) {
          const ids = await smClientIds();
          if (!ids.includes(clientId)) return res.status(403).json({ error: "not your client" });
        }
        const crows = await sb(`clients?id=eq.${clientId}&select=${CLIENT_COLS}`);
        const client = crows?.[0];
        if (!client) return res.status(404).json({ error: "client not found" });
        const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 24);
        // Sequential: 24 windows against ONE connected account in parallel is a
        // fast way to get rate-limited off that academy's Stripe.
        const rows = [];
        for (const m of completedMonthsBack(lastStart, months)) rows.push(await grossForMonth(client, m));
        return res.status(200).json({ client_id: clientId, months: rows, source: revenueSourceOf(client) });
      }

      let clientFilter = "";
      if (!ctx.isAdmin) {
        const ids = await smClientIds();
        if (!ids.length) return res.status(200).json({ month: lastStart, rows: [] });
        clientFilter = `&id=in.(${ids.join(",")})`;
      }
      const clients = await sb(`clients?archived_at=is.null${clientFilter}&select=${CLIENT_COLS}`);
      // One month per client, fanned out across DIFFERENT accounts - safe in
      // parallel, and it keeps the whole column inside the 60s function budget.
      const rows = await Promise.all(
        (clients || []).map(c => grossForMonth(c, lastStart).then(r => ({ client_id: c.id, ...r })))
      );
      return res.status(200).json({ month: lastStart, rows });
    }

    // ── POST save-settings (admin): the onboarding payment fields ──────────
    if (req.method === "POST" && action === "save-settings") {
      if (!ctx.isAdmin) return res.status(403).json({ error: "admin only" });
      const b = req.body || {};
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      const crows = await sb(`clients?id=eq.${b.client_id}&select=${CLIENT_COLS}`);
      const client = crows?.[0];
      if (!client) return res.status(404).json({ error: "client not found" });

      const patch = {};
      const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
      const num = (v) => (v === "" || v == null ? null : Number(v));

      if (has("payment_model")) {
        if (b.payment_model && !["flat_retainer", "growth_percentage"].includes(b.payment_model)) {
          return res.status(400).json({ error: "payment_model must be flat_retainer or growth_percentage" });
        }
        patch.payment_model = b.payment_model || null;
      }
      if (has("flat_amount")) patch.flat_amount = num(b.flat_amount);
      if (has("base_retainer")) patch.base_retainer = num(b.base_retainer);
      if (has("growth_share_pct")) patch.growth_share_pct = num(b.growth_share_pct);
      if (has("subscription_renewal_date")) patch.subscription_renewal_date = b.subscription_renewal_date || null;
      if (has("revenue_integration_connection")) patch.revenue_integration_connection = b.revenue_integration_connection || null;
      if (has("scaling_manager_id")) patch.scaling_manager_id = b.scaling_manager_id || null;

      // Revenue Baseline: locked for 9 months (Agreement §2 + Mike's 9-month
      // rule). Re-entering it (agreement renewal / changed terms) needs an
      // explicit confirmation, and re-locks for another 9 months.
      if (has("baseline_revenue")) {
        const newBaseline = num(b.baseline_revenue);
        const changed = round2(newBaseline || 0) !== round2(client.baseline_revenue || 0);
        if (changed) {
          const today = todayET();
          const locked = client.baseline_locked_until && today < client.baseline_locked_until && client.baseline_revenue != null;
          if (locked && !b.confirm_baseline_reset) {
            return res.status(400).json({
              error: `The revenue baseline is locked until ${client.baseline_locked_until} (9-month lock). ` +
                `Re-enter it only on agreement renewal - confirm to override and re-lock.`,
              code: "baseline_locked",
              locked_until: client.baseline_locked_until,
            });
          }
          patch.baseline_revenue = newBaseline;
          patch.baseline_locked_until = newBaseline == null ? null : addMonthsClamped(today, 9);
        }
      }

      if (!Object.keys(patch).length) return res.status(400).json({ error: "no fields to update" });
      await sb(`clients?id=eq.${b.client_id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
      });
      const updated = await sb(`clients?id=eq.${b.client_id}&select=${CLIENT_COLS}`);
      return res.status(200).json({ client: updated?.[0] || null });
    }

    // ── POST run-cycle (admin): manual close / preview / failed-pull redo ──
    if (req.method === "POST" && action === "run-cycle") {
      if (!ctx.isAdmin) return res.status(403).json({ error: "admin only" });
      const b = req.body || {};
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      const crows = await sb(`clients?id=eq.${b.client_id}&select=${CLIENT_COLS}`);
      const client = crows?.[0];
      if (!client) return res.status(404).json({ error: "client not found" });
      if (!client.payment_model) return res.status(400).json({ error: "set the client's payment model first" });
      const cycleDate = b.cycle_date || todayET();
      const r = await closeCycle(client, cycleDate, {
        dryRun: !!b.dry_run,
        force: !!b.force,
        grossOverride: b.gross_override != null && b.gross_override !== "" ? Number(b.gross_override) : null,
      });
      return res.status(200).json(r);
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
