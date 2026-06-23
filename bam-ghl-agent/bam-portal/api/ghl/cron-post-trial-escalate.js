import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken, ghl } from "./_core.js";
import { notifyOwners } from "../_notify-owners.js";
// Cron — post-trial escalation.
//
// 15 min after a trial appointment ENDS, if no post_trial_review was submitted
// for that contact, text the staff the academy picked for "post_trial_escalation"
// (clients.notification_prefs). Deduped per appointment via post_trial_escalations.
//
//   GET /api/ghl/cron-post-trial-escalate   (Bearer CRON_SECRET) — runs every 15 min
//
// Only academies that are V1.5/V2, have recipients configured, and have trial
// calendars set (ghl_kpi_config.booking_calendar_ids) are checked.

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function handler(req, res) {
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });

  const now = Date.now();
  const windowStart = now - 180 * 60 * 1000; // look back 3h
  const cutoff = now - 15 * 60 * 1000;        // ended at least 15 min ago

  let clients = [];
  try {
    clients = await sb(`clients?or=(v15_access.eq.true,v2_access.eq.true)&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,notification_prefs`);
  } catch (e) { return res.status(200).json({ error: e.message }); }

  const out = [];
  for (const client of (Array.isArray(clients) ? clients : [])) {
    try {
      const recips = ((client.notification_prefs || {}).post_trial_escalation) || [];
      if (!recips.length) continue;
      const calIds = (client.ghl_kpi_config || {}).booking_calendar_ids || [];
      if (!calIds.length || !client.ghl_location_id) continue;
      const creds = await pickGhlToken(client);
      if (!creds) continue;

      for (const calId of calIds) {
        let evs = [];
        try {
          const r = await ghl("GET", `/calendars/events?locationId=${encodeURIComponent(client.ghl_location_id)}&calendarId=${encodeURIComponent(calId)}&startTime=${windowStart}&endTime=${now}`, { token: creds.token });
          evs = (r.events || []).filter(ev => ev.appointmentStatus !== "cancelled");
        } catch (_) { continue; }

        for (const ev of evs) {
          const endMs = ev.endTime ? new Date(ev.endTime).getTime() : (ev.startTime ? new Date(ev.startTime).getTime() : 0);
          if (!endMs || endMs > cutoff || endMs < windowStart) continue; // ended 15-180 min ago
          const apptId = ev.id || ev.appointmentId;
          if (!apptId) continue;
          const cId = ev.contactId || (ev.contact && ev.contact.id) || null;

          // Already reviewed for this contact? skip.
          if (cId) {
            const rev = await sb(`post_trial_reviews?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(cId)}&select=id&limit=1`).catch(() => []);
            if (Array.isArray(rev) && rev.length) continue;
          }
          // Already escalated for this appointment? skip.
          const esc = await sb(`post_trial_escalations?client_id=eq.${client.id}&appointment_id=eq.${encodeURIComponent(String(apptId))}&select=id&limit=1`).catch(() => []);
          if (Array.isArray(esc) && esc.length) continue;

          // Record the escalation first (dedup), then text.
          try {
            await sb(`post_trial_escalations?on_conflict=client_id,appointment_id`, {
              method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
              body: JSON.stringify([{ client_id: client.id, appointment_id: String(apptId), ghl_contact_id: cId }]),
            });
          } catch (_) { /* dedup is best-effort */ }

          const who = ev.title || (ev.contact && ev.contact.name) || "a trial";
          notifyOwners(client.id, "post_trial_escalation",
            `⏰ Post-trial follow-up needed: ${who}'s trial has ended and there's no review yet. Log it in the portal.`).catch(() => {});
          out.push({ client_id: client.id, appointment_id: apptId });
        }
      }
    } catch (e) { out.push({ client_id: client.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, escalated: out.length, items: out });
}

export default withSentryApiRoute(handler);
