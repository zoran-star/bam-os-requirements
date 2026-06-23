// Central owner/staff SMS notifier.
//
// Texts the teammates the academy picked for an event (clients.notification_prefs)
// FROM the academy's own GHL number, via sendSms(). V1.5/V2 only. Best-effort and
// NON-THROWING — safe to `await notifyOwners(...).catch(()=>{})` (or just await) from
// any trigger site (webhooks, ticket actions, crons) without risking the main flow.
//
//   notification_prefs shape: { "<event_key>": ["<client_users.id>", ...] }
import { sendSms } from "./ghl/_core.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Send the owner/staff SMS for `eventKey` on `clientId`. Returns a summary
// { ok, recipients, sent } and never throws.
export async function notifyOwners(clientId, eventKey, message) {
  const result = { ok: false, recipients: 0, sent: 0 };
  try {
    if (!clientId || !eventKey || !message) return result;
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,v2_access,v15_access,notification_prefs`);
    const client = Array.isArray(rows) ? rows[0] : rows;
    if (!client) return result;
    // Owner-SMS is a V1.5/V2 feature.
    if (!client.v15_access && !client.v2_access) { result.ok = true; return result; }
    const prefs = client.notification_prefs || {};
    const ids = Array.isArray(prefs[eventKey]) ? prefs[eventKey].filter(x => typeof x === "string") : [];
    result.recipients = ids.length;
    if (!ids.length) { result.ok = true; return result; }
    const users = await sb(`client_users?id=in.(${ids.join(",")})&status=eq.active&select=id,name,phone`);
    const seen = new Set();
    for (const u of (Array.isArray(users) ? users : [])) {
      const phone = (u.phone || "").trim();
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      const r = await sendSms({ client, toPhone: phone, message, contactName: u.name || "BAM" });
      if (r && r.ok) result.sent++;
    }
    result.ok = true;
    return result;
  } catch (_) {
    return result;
  }
}
