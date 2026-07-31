import { withSentryApiRoute } from "../_sentry.js";
import { withTempStaff } from "./_temp-staff.js";
import {
  planExtensionWindows, validateWindow, daysOut,
  MIN_COVERAGE_DAYS, TARGET_COVERAGE_DAYS, ALERT_BELOW_DAYS,
} from "./_extend-windows.js";
export const maxDuration = 300; // weekly sweep: every portal academy x a couple of generate-slots calls

// Native slot auto-extend. Academies on booking_provider='portal' get their
// bookable slots generated once (sync-offer / extend-gta-slots) and coverage
// then just runs out - when it does, the booking calendar silently returns no
// slots (no error, parents simply see no times; BAM GTA would hit this
// 2026-09-01). This cron replaces the paused GTA-only cloud Routine with a
// tenant-generic weekly top-up.
//
//   GET /api/schedule/cron-extend-slots               (Vercel cron, x-vercel-cron)
//   GET /api/schedule/cron-extend-slots?client_id=…   (manual, Bearer CRON_SECRET)
//
// Per academy: read current coverage (max schedule_slots.start_time - a
// read-only service-role query), and if it ends less than MIN_COVERAGE_DAYS
// (60) out, extend to TARGET_COVERAGE_DAYS (90) out. schedule_slots is
// Luka-owned with deny-all RLS (docs/parent-app-db-boundary.md), so extension
// happens ONLY through his sanctioned POST /api/runtime/schedule/generate-slots
// - never direct writes. generate-slots upserts and reports skipped_existing,
// so re-runs are idempotent; window math lives in _extend-windows.js (pure,
// tested by scripts/extend-windows.test.mjs).
//
// Visibility: an academy still under ALERT_BELOW_DAYS (30) of coverage AFTER
// the attempt (e.g. no active slot templates, so nothing could be generated)
// triggers a Slack alert - coverage running out must never be silent.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const PORTAL = "https://portal.byanymeansbusiness.com";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Best-effort alert, same shape as testimonial-drift.js. Never throws: a Slack
// outage must not make the extension run look failed - the response body still
// carries the per-academy verdicts.
async function alertSlack(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ALERTS_CHANNEL || process.env.SLACK_STAFF_CHANNEL;
  if (!token || !channel) return { posted: false, reason: "slack not configured" };
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text }),
    });
    const j = await r.json().catch(() => ({}));
    return { posted: !!j.ok, reason: j.ok ? null : j.error || "unknown" };
  } catch (e) {
    return { posted: false, reason: String((e && e.message) || e) };
  }
}

// Coverage end for a tenant: date of the last non-cancelled slot (same read as
// scripts/extend-gta-slots.mjs' verify step), or null when there are no slots.
async function coverageEndOf(tenantId) {
  const rows = await sb(`schedule_slots?tenant_id=eq.${encodeURIComponent(tenantId)}&is_cancelled=eq.false&select=start_time&order=start_time.desc&limit=1`);
  const lastStart = Array.isArray(rows) && rows[0]?.start_time;
  return lastStart ? String(lastStart).slice(0, 10) : null;
}

async function extendClient(client, today, staffToken) {
  const report = { tenant: client.id, business: client.business_name };
  const before = await coverageEndOf(client.id);
  const { days_before, windows } = planExtensionWindows({ today, coverageEnd: before });
  report.days_before = days_before;
  report.windows_generated = 0;
  report.created = 0;
  report.skipped_existing = 0;

  for (const w of windows) {
    // Belt and braces: the planner already validated, but a bad window here
    // would 4xx against Luka's endpoint anyway - refuse it with a clear reason.
    const bad = validateWindow(w);
    if (bad) throw new Error(bad);
    const r = await fetch(`${PORTAL}/api/runtime/schedule/generate-slots`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: client.id, date_from: w.date_from, date_to: w.date_to }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.created == null) throw new Error(`generate-slots ${w.date_from} -> ${w.date_to} failed: ${JSON.stringify(j.errors || j.error || j).slice(0, 200)}`);
    report.windows_generated += 1;
    report.created += Number(j.created || 0);
    report.skipped_existing += Number(j.skipped_existing || 0);
  }

  // Re-read coverage so days_after reflects what actually landed, not what the
  // windows asked for (no templates -> nothing lands -> the alert below fires).
  const after = windows.length ? await coverageEndOf(client.id) : before;
  report.days_after = daysOut(today, after);
  return report;
}

async function handler(req, res) {
  const isCron = !!req.headers["x-vercel-cron"];
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!isCron && !(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const one = String(req.query.client_id || "").trim();
    const today = new Date().toISOString().slice(0, 10);
    // Every portal-native academy - no per-academy hardcoding.
    let clients = await sb(`clients?booking_provider=eq.portal&select=id,business_name&order=business_name.asc`) || [];
    if (one) clients = clients.filter(c => c.id === one);
    if (!clients.length) return res.status(200).json({ ok: true, today, clients: 0, results: [] });

    // One temp staff session drives every academy's generate-slots calls.
    const results = await withTempStaff({
      email: `slot-extend+cron-${Date.now()}@bam.local`,
      password: `${crypto.randomUUID()}A1!`,
      name: "Slot Extend (temp)",
    }, async (staffToken) => {
      const out = [];
      for (const client of clients) {
        let report;
        try {
          report = await extendClient(client, today, staffToken);
        } catch (e) {
          report = { tenant: client.id, business: client.business_name, error: e.message };
        }
        // Coverage running out must never be silent: alert whenever we could
        // not leave the academy with at least ALERT_BELOW_DAYS of runway.
        const daysLeft = report.days_after ?? report.days_before ?? null;
        report.alerted = false;
        if (report.error || daysLeft == null || daysLeft < ALERT_BELOW_DAYS) {
          const label = report.business || client.id;
          const left = daysLeft == null ? "NO future slots" : `${daysLeft} days of slots left`;
          const why = report.error ? ` (extend error: ${report.error})` : " - likely no active slot templates, so generate-slots had nothing to create";
          const slack = await alertSlack(`⚠️ ${label}: ${left} after auto-extend${why}. Booking calendar goes empty when coverage ends - check templates/recurrence for tenant ${client.id}.`);
          report.alerted = slack.posted;
          report.alert = slack;
        }
        out.push(report);
      }
      return out;
    });

    return res.status(200).json({ ok: true, today, min_days: MIN_COVERAGE_DAYS, target_days: TARGET_COVERAGE_DAYS, clients: clients.length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
