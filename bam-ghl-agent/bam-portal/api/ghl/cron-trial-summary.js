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
// Config resolution per client (DB wins, code fallback for the initial rollout):
//   1. clients.ghl_kpi_config.trial_summary = {
//        enabled, to_phone, to_email, timezone,
//        calendars:[{id,label}] | calendar_ids:[...]
//      }
//      (to_phone and/or to_email - sends to whichever are set)
//   2. FALLBACK_CONFIG keyed by ghl_location_id (below) - lets this ship before
//      the portal DB env is reachable; move it to ghl_kpi_config anytime and the
//      DB value takes over automatically.
//
// Reuses the proven post-trial-escalate mechanics: pickGhlToken -> GHL
// /calendars/events -> sendSms (which also honors a client's own Twilio).

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

// Initial rollout config (DB-overridable). Keyed by ghl_location_id.
const FALLBACK_CONFIG = {
  // Major Hoops (Jeremy). Send the daily trial list to the academy's own
  // business number until he has a personal line to receive it.
  gXHbLTQzaEYlyLSKJUTU: {
    enabled: true,
    to_phone: "+16267673748",
    to_email: "jeremy@majorhoops.com",
    timezone: "America/Los_Angeles",
    calendars: [
      { id: "0Z7H70gSweantyTQBkIt", label: "St. Francis HS" },
      { id: "W1bcgWyDkAyLDCj3zOLo", label: "2540 E. Orange" },
    ],
  },
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

// Start/end epoch-ms of "today" in an IANA timezone (DST-safe).
function dayWindow(tz) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const wallAsUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") === 24 ? 0 : g("hour"), g("minute"), g("second"));
  const offset = wallAsUtc - now.getTime(); // how far tz wall-clock is ahead of real UTC
  const startWall = Date.UTC(g("year"), g("month") - 1, g("day"), 0, 0, 0);
  const start = startWall - offset;
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function fmtTime(iso, tz) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  } catch (_) { return ""; }
}

function fmtDay(tz) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date());
  } catch (_) { return ""; }
}

// Merge DB config with the code fallback; normalize the calendars shape.
function resolveConfig(client) {
  const db = (client.ghl_kpi_config || {}).trial_summary || null;
  const fb = FALLBACK_CONFIG[client.ghl_location_id] || null;
  if (!db && !fb) return null;
  const cfg = { ...(fb || {}), ...(db || {}) };
  if (cfg.enabled === false) return null;
  let calendars = cfg.calendars;
  if (!calendars && Array.isArray(cfg.calendar_ids)) calendars = cfg.calendar_ids.map((id) => ({ id, label: "" }));
  if (!Array.isArray(calendars) || !calendars.length) return null;
  if (!cfg.to_phone && !cfg.to_email) return null; // need at least one destination
  // skip_when_empty: only send on days that actually have a trial booked, so an
  // academy is never pinged on days it does not run (its schedule drives it).
  return { to_phone: cfg.to_phone || null, to_email: cfg.to_email || null, timezone: cfg.timezone || "America/Los_Angeles", calendars, skip_when_empty: cfg.skip_when_empty === true };
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

async function handler(req, res) {
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });

  let clients = [];
  try {
    clients = await sb(`clients?select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config`);
  } catch (e) { return res.status(200).json({ error: e.message }); }

  const out = [];
  for (const client of (Array.isArray(clients) ? clients : [])) {
    const cfg = resolveConfig(client);
    if (!cfg) continue;
    try {
      if (!client.ghl_location_id) { out.push({ client_id: client.id, skipped: "no location" }); continue; }
      const creds = await pickGhlToken(client);
      if (!creds) { out.push({ client_id: client.id, skipped: "no ghl token" }); continue; }

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
      const day = fmtDay(cfg.timezone);
      const header = `${name} - Free Trials Today (${day})`;
      const subject = `Free Trials Today - ${name} (${day})`;
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

      const result = { client_id: client.id, business: name, count: appts.length };
      // Opt-in: on a zero-trial day, stay silent instead of texting "none".
      if (cfg.skip_when_empty && !appts.length) {
        result.skipped = "no trials today (skip_when_empty)";
        out.push(result);
        continue;
      }
      if (cfg.to_phone) {
        const r = await sendSms({ client, toPhone: cfg.to_phone, message: smsText, contactName: name });
        result.sms = r.ok ? "sent" : `failed: ${r.error}`;
      }
      if (cfg.to_email) {
        const e = await sendEmailSummary({ client, toEmail: cfg.to_email, subject, html: htmlBody, text: smsText, contactName: name });
        result.email = e.ok ? `sent (${e.via})` : `failed: ${e.error}`;
      }
      out.push(result);
    } catch (e) { out.push({ client_id: client.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, processed: out.length, items: out });
}

export default withSentryApiRoute(handler);
