import { withSentryApiRoute } from "../_sentry.js";
// Phone/migration status for one academy - powers the staff portal's Phone tab.
//
//   GET /api/twilio/migration-status?client_id=<uuid>   (staff JWT or CRON_SECRET)
//     → { phase: none|pending|live, config?, month_spend_usd? }

import { sb } from "./_voice.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function isStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`).catch(() => null);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`).catch(() => null);
  }
  return Array.isArray(staff) && !!staff[0];
}

async function handler(req, res) {
  if (!(await isStaff(req))) return res.status(401).json({ error: "unauthorized" });
  const clientId = String(req.query.client_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: "client_id must be a uuid" });

  const rows = await sb(
    `client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}` +
    `&select=status,from_number,port_status,a2p_required,a2p_status,a2p_campaign_sid,voice_ring_numbers,voice_enabled,voicemail_enabled,missed_call_text_enabled,cutover_at,auto_cutover,notes,account_sid`
  ).catch(() => []);
  const cfg = rows && rows[0];

  const month = new Date().toISOString().slice(0, 7);
  const usage = await sb(
    `twilio_usage?client_id=eq.${encodeURIComponent(clientId)}&usage_date=gte.${month}-01&select=usage_usd`
  ).catch(() => []);
  const spend = (usage || []).reduce((s, u) => s + Number(u.usage_usd || 0), 0);

  if (!cfg) return res.status(200).json({ phase: "none", month, month_spend_usd: 0 });
  return res.status(200).json({
    phase: cfg.status === "active" ? "live" : cfg.status === "pending" ? "pending" : "none",
    config: cfg,
    month,
    month_spend_usd: Math.round(spend * 100) / 100,
  });
}

export default withSentryApiRoute(handler);
