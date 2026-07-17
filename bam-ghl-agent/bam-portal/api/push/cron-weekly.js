import { withSentryApiRoute } from "../_sentry.js";
// ─────────────────────────────────────────────────────────────────────────
// api/push/cron-weekly.js — #7 weekly performance digest push (cron)
// ─────────────────────────────────────────────────────────────────────────
// Scheduled in vercel.json (Mondays). Sends ONE weekly-digest push to each
// client that has an iOS device token (i.e. opted into the app), deep-linking
// to the Marketing tab. Auth: CRON_SECRET (same pattern as the other crons).
//
// Metrics: v1 sends a value-oriented nudge ("your week is ready"). Pulling the
// real per-client Meta numbers (leads / spend / CPL) into the body is a
// follow-up — it means a Meta call per client in the cron (rate-limited), so
// it's intentionally deferred. The deep-link lands them on the live numbers.
// ─────────────────────────────────────────────────────────────────────────

import { notifyClientPush, apnsConfigured } from "./_send.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
  if ((req.headers.authorization || "") !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!apnsConfigured()) {
    return res.status(200).json({ ok: true, skipped: "APNs not configured", sent: 0 });
  }
  try {
    // Distinct clients that have at least one iOS device token.
    const rows = await sb(
      "device_tokens?platform=eq.ios" +
        "&client_id=not.is.null&app_scope=eq.CLIENT_PORTAL" +
        "&token_provider=eq.APNS&disabled_at=is.null&select=client_id",
    );
    const clientIds = [...new Set((rows || []).map((r) => r.client_id).filter(Boolean))];
    let sent = 0;
    for (const clientId of clientIds) {
      const r = await notifyClientPush(clientId, "weekly-digest", {
        summary: "Your weekly performance summary is ready — open Marketing for this week's numbers.",
        view: "marketing",
      });
      if (r?.sent) sent += r.sent;
    }
    return res.status(200).json({ ok: true, clients: clientIds.length, sent });
  } catch (e) {
    console.error("cron-weekly error:", e?.message || e);
    return res.status(500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
