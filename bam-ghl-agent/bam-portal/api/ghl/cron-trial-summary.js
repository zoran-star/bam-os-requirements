import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken, ghl, sendSms, lookupContact } from "./_core.js";
import { maybeSendEmailViaResend } from "../messaging/email-provider.js";
// Cron - daily free-trial summary.
//
// Once a day, text an academy a summary of every free trial SCHEDULED for that
// day across their trial calendars. Built for Major Hoops (Jeremy): he has no
// separate personal line for now, so the summary goes to the academy's own
// business number.
//
//   GET /api/ghl/cron-trial-summary   (Bearer CRON_SECRET) - runs 15:00 UTC = 8am PT (PDT)
//
// A client can have MORE THAN ONE summary (added 2026-07-31 for Major Hoops:
// Coach Brandon runs his own calendar and wants his own trials texted straight
// to him, separate from Jeremy's summary of the academy's other calendars).
// Config resolution per client (DB wins, code fallback for the initial rollout):
//   1. clients.ghl_kpi_config.trial_summaries = [ {...}, {...} ]   <- an ARRAY,
//      one entry per person who should get a summary. Each entry:
//        { enabled, to_phone, to_email, timezone, label,
//          calendars:[{id,label}] | calendar_ids:[...], skip_when_empty, send_hour }
//      `label` is optional and only changes the message header, e.g. "Major
//      Hoops - Coach Brandon - Free Trials Today (...)" instead of just the
//      business name. Leave it off for the main/owner summary.
//   2. clients.ghl_kpi_config.trial_summary = {...}   <- legacy SINGLE-object
//      shape, still supported: treated as a one-entry array.
//   3. FALLBACK_CONFIG keyed by ghl_location_id (below), also array-shaped -
//      lets this ship before the portal DB env is reachable; move it to
//      ghl_kpi_config anytime and the DB value takes over automatically.
// If the DB provides EITHER key for a location, it replaces the fallback array
// for that location entirely (no per-entry merge across DB/fallback - each
// entry is self-contained, so "replace the whole list" is unambiguous).
//
// Reuses the proven post-trial-escalate mechanics: pickGhlToken -> GHL
// /calendars/events -> sendSms (which also honors a client's own Twilio).

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

// Initial rollout config (DB-overridable), array-shaped per location so it
// mirrors clients.ghl_kpi_config.trial_summaries exactly. Exported so a verify
// script tests the ACTUAL fallback, not a hand-copied stand-in that can drift.
export const FALLBACK_CONFIG = {
  // Major Hoops (Jeremy + Coach Brandon). Jeremy's summary covers the
  // academy's 4 general calendars; Brandon's is just his own calendar, sent
  // straight to his own number (+16263913259, confirmed against the GHL user
  // record for Brandon Pomroy on this location).
  gXHbLTQzaEYlyLSKJUTU: [
    {
      enabled: true,
      to_phone: "+16264290220",
      to_email: "jeremy@majorhoops.com",
      timezone: "America/Los_Angeles",
      skip_when_empty: true,
      calendars: [
        { id: "0Z7H70gSweantyTQBkIt", label: "St. Francis RG" },
        { id: "MVwAxbbNdHNGcjSLPxer", label: "St. Francis PPG" },
        { id: "W1bcgWyDkAyLDCj3zOLo", label: "Orange Grove RG" },
        { id: "Yin0WBrGXraVTn35yymb", label: "Orange Grove PPG" },
      ],
    },
    {
      enabled: true,
      to_phone: "+16263913259",
      timezone: "America/Los_Angeles",
      skip_when_empty: true,
      label: "Coach Brandon",
      calendars: [{ id: "QTY8Zr8FZ2ZNPNU01ZvO", label: "Coach Brandon RG" }],
    },
  ],
};

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// The hour it should land in the academy's own timezone. Vercel crons are UTC
// only, so this cron is scheduled at BOTH 15:00 and 16:00 UTC and this guard
// picks the one that is 8am locally - 8am all year, either side of DST, with no
// double send. Override per client with ghl_kpi_config.trial_summary.send_hour.
//
// hourCycle: "h23", NOT hour12: false - see the note on todayBoundsMs in
// calendars-v15.js. `hour12: false` is a hint the engine resolves, and Node 20
// resolves it to h24, so local midnight came back as 24 rather than 0. With the
// default send hour of 8 that was invisible (24 and 0 both simply fail to equal
// 8), but `ghl_kpi_config.trial_summary.send_hour = 0` would then never match
// and that academy's summary would silently never send. Verified by execution on
// Node 20: this returned 24 for Europe/London at 2026-12-15T00:00Z.
const DEFAULT_SEND_HOUR = 8;
export function localHour(tz, now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
}

// Start/end epoch-ms of "today" in an IANA timezone (DST-safe).
//
// This one ALSO asks for hourCycle "h23" now. It previously kept `hour12: false`
// and repaired the value with `g("hour") === 24 ? 0`, on the reasoning that the
// repair was complete so the hint did not need converting. That reasoning was
// sound about this function and wrong about the codebase: leaving the hint in
// place kept the pattern alive to be copied, and it was copied. The rule is now
// the same everywhere, display included - there is no site where `hour12` is fine.
//
// The `g("hour") === 24 ? 0` guard is KEPT, but it is now BELT AND BRACES rather
// than the fix. Under h23 the hour is always 00-23, so the branch is never taken
// (proven by execution over a year-long sweep of every zone in clients.time_zone).
// It stays because it costs nothing and still produces the right answer if the
// cycle is ever wrong again - case 10 of api/_local-day.test.mjs proves that by
// forcing h24 here and requiring the correct window anyway, and MUTATE=daywindow
// proves the guard is not decorative.
export function dayWindow(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const wallAsUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") === 24 ? 0 : g("hour"), g("minute"), g("second"));
  const offset = wallAsUtc - now.getTime(); // how far tz wall-clock is ahead of real UTC
  const startWall = Date.UTC(g("year"), g("month") - 1, g("day"), 0, 0, 0);
  const start = startWall - offset;
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

// hourCycle: "h12", NOT hour12: true. Same rule, other direction: `hour12: true`
// is the same unresolved hint and en-US happens to resolve it to h12, but h11 is
// the other legal answer and h11 renders NOON as "0:00 PM". So the 12-hour form
// carries a midday version of the same bug that h24 carries at midnight. Pinning
// h12 is byte-identical to what this rendered before on every zone and instant
// swept, and it removes the hint. The rule is: never `hour12`, either value.
function fmtTime(iso, tz) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hourCycle: "h12" }).format(new Date(iso));
  } catch (_) { return ""; }
}

function fmtDay(tz) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date());
  } catch (_) { return ""; }
}

// Normalize one summary-entry shape (defaults + calendar_ids expansion).
// Returns null if the entry cannot actually send anything (disabled, no
// calendars, or no destination) - so a bad entry drops out silently instead of
// crashing the whole cron for every other entry/client.
export function normalizeEntry(cfg) {
  if (!cfg || cfg.enabled === false) return null;
  let calendars = cfg.calendars;
  if (!calendars && Array.isArray(cfg.calendar_ids)) calendars = cfg.calendar_ids.map((id) => ({ id, label: "" }));
  if (!Array.isArray(calendars) || !calendars.length) return null;
  if (!cfg.to_phone && !cfg.to_email) return null; // need at least one destination
  return {
    send_hour: Number.isFinite(Number(cfg.send_hour)) ? Number(cfg.send_hour) : DEFAULT_SEND_HOUR,
    to_phone: cfg.to_phone || null,
    to_email: cfg.to_email || null,
    timezone: cfg.timezone || "America/Los_Angeles",
    calendars,
    // skip_when_empty: only send on days that actually have a trial booked, so
    // an academy/coach is never pinged on days they don't run.
    skip_when_empty: cfg.skip_when_empty === true,
    label: cfg.label || null,
  };
}

// Resolve ALL summary entries for a client -> an array (possibly empty) of
// normalized entries. DB (trial_summaries array, or legacy trial_summary
// single object) replaces the fallback array wholesale when present.
// Exported (alongside normalizeEntry/FALLBACK_CONFIG) so a verify script can
// exercise the real resolution logic against fixture clients, same pattern as
// the other verify-*.mjs scripts in bam-portal/scripts/.
export function resolveConfigs(client) {
  const kpi = client.ghl_kpi_config || {};
  const dbList = Array.isArray(kpi.trial_summaries)
    ? kpi.trial_summaries
    : (kpi.trial_summary ? [kpi.trial_summary] : null);
  const list = dbList || FALLBACK_CONFIG[client.ghl_location_id] || [];
  return list.map(normalizeEntry).filter(Boolean);
}

// Email the summary. Honors a client's own Resend domain, else sends via GHL
// Email (upserts a contact for the address). Never throws.
async function sendEmailSummary({ client, toEmail, subject, html, text, contactName }) {
  try {
    if (!toEmail) return { ok: false, error: "no destination email" };
    const viaResend = await maybeSendEmailViaResend(client.id, { toEmail, subject, html, text, sentBy: "system", contactName });
    if (viaResend.handled) return viaResend.ok ? { ok: true, via: "resend", id: viaResend.id } : { ok: false, error: viaResend.error };
    const creds = await pickGhlToken(client);
    if (!creds) return { ok: false, error: "no GHL token for academy" };
    const { token, locationId } = creds;
    let contactId = await lookupContact({ token, locationId, email: toEmail });
    if (!contactId) {
      try {
        const resp = await ghl("POST", `/contacts/upsert`, { token, body: { locationId, email: toEmail, ...(contactName ? { name: contactName } : {}) } });
        contactId = resp?.contact?.id || resp?.id || null;
      } catch (_) { /* fall through */ }
    }
    if (!contactId) return { ok: false, error: "could not find/create a GHL contact for the email" };
    const resp = await ghl("POST", `/conversations/messages`, { token, body: { type: "Email", contactId, subject, html } });
    return { ok: true, via: "ghl", message_id: resp?.messageId || null };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Build + send ONE summary entry for a client (its own destinations, its own
// calendars, its own send_hour check). Returns the result object for the
// cron's response payload.
async function runOneSummary({ client, cfg, creds, force }) {
  const hourNow = localHour(cfg.timezone);
  if (!force && hourNow !== cfg.send_hour) {
    return { skipped: `not ${cfg.send_hour}:00 in ${cfg.timezone} (local hour ${hourNow})` };
  }

  const { start, end } = dayWindow(cfg.timezone);
  const appts = [];
  for (const cal of cfg.calendars) {
    try {
      const r = await ghl("GET", `/calendars/events?locationId=${encodeURIComponent(client.ghl_location_id)}&calendarId=${encodeURIComponent(cal.id)}&startTime=${start}&endTime=${end}`, { token: creds.token });
      for (const ev of (r.events || [])) {
        if (ev.appointmentStatus === "cancelled") continue;
        const s = ev.startTime ? new Date(ev.startTime).getTime() : 0;
        if (!s || s < start || s >= end) continue; // GHL leaks events past the window
        appts.push({
          startMs: s,
          time: fmtTime(ev.startTime, cfg.timezone),
          who: (ev.contact && ev.contact.name) || ev.title || "Trial",
          where: cal.label || "",
        });
      }
    } catch (_) { /* one calendar failing shouldn't kill the summary */ }
  }
  appts.sort((a, b) => a.startMs - b.startMs);

  const name = client.business_name || "Your academy";
  const title = cfg.label ? `${name} - ${cfg.label}` : name;
  const day = fmtDay(cfg.timezone);
  const header = `${title} - Free Trials Today (${day})`;
  const subject = `Free Trials Today - ${title} (${day})`;
  const noun = appts.length === 1 ? "trial" : "trials";

  let smsText, htmlBody;
  if (!appts.length) {
    smsText = `${header}\n\nNo free trials scheduled for today.`;
    htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111"><h2 style="margin:0 0 12px">${escapeHtml(header)}</h2><p>No free trials scheduled for today.</p></div>`;
  } else {
    const lines = appts.map((a) => `- ${a.time}  ${a.who}${a.where ? `  (${a.where})` : ""}`);
    smsText = `${header}\n\n${appts.length} ${noun} scheduled:\n${lines.join("\n")}`;
    const rows = appts
      .map((a) => `<li style="margin:0 0 6px"><strong>${escapeHtml(a.time)}</strong> &nbsp;${escapeHtml(a.who)}${a.where ? ` <span style="color:#666">(${escapeHtml(a.where)})</span>` : ""}</li>`)
      .join("");
    htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111"><h2 style="margin:0 0 12px">${escapeHtml(header)}</h2><p style="margin:0 0 8px">${appts.length} ${noun} scheduled:</p><ul style="margin:0;padding-left:20px">${rows}</ul></div>`;
  }

  const result = { label: cfg.label || null, to_phone: cfg.to_phone || null, to_email: cfg.to_email || null, count: appts.length };
  // Opt-in: on a zero-trial day, stay silent instead of texting "none".
  if (cfg.skip_when_empty && !appts.length) {
    result.skipped = "no trials today (skip_when_empty)";
    return result;
  }
  if (cfg.to_phone) {
    const r = await sendSms({ client, toPhone: cfg.to_phone, message: smsText, contactName: title });
    result.sms = r.ok ? "sent" : `failed: ${r.error}`;
  }
  if (cfg.to_email) {
    const e = await sendEmailSummary({ client, toEmail: cfg.to_email, subject, html: htmlBody, text: smsText, contactName: title });
    result.email = e.ok ? `sent (${e.via})` : `failed: ${e.error}`;
  }
  return result;
}

async function handler(req, res) {
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });

  let clients = [];
  try {
    clients = await sb(`clients?select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config`);
  } catch (e) { return res.status(200).json({ error: e.message }); }

  const force = req.query.force === "1";
  // ?only=label filters to a single summary entry by its `label`, for testing
  // one person's summary without also firing everyone else's on that client.
  const onlyLabel = typeof req.query.only === "string" ? req.query.only : null;

  const out = [];
  for (const client of (Array.isArray(clients) ? clients : [])) {
    const cfgs = resolveConfigs(client).filter((c) => !onlyLabel || c.label === onlyLabel);
    if (!cfgs.length) continue;
    if (!client.ghl_location_id) { out.push({ client_id: client.id, skipped: "no location" }); continue; }
    const creds = await pickGhlToken(client);
    if (!creds) { out.push({ client_id: client.id, skipped: "no ghl token" }); continue; }

    for (const cfg of cfgs) {
      try {
        const result = await runOneSummary({ client, cfg, creds, force });
        out.push({ client_id: client.id, business: client.business_name, ...result });
      } catch (e) {
        out.push({ client_id: client.id, business: client.business_name, label: cfg.label || null, error: e.message });
      }
    }
  }
  return res.status(200).json({ ok: true, processed: out.length, items: out });
}

export default withSentryApiRoute(handler);
