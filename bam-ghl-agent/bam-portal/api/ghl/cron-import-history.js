import { withSentryApiRoute } from "../_sentry.js";
// Cron: backfill each MIGRATING academy's full GHL conversation history into the
// provider-agnostic own-store (sms_threads/sms_messages + email_threads/
// email_messages, provider='ghl') so it lands alongside the contacts sync right
// after GHL connects, and every already-connected academy backfills on its own.
// Without this the history import only fired at Twilio-cutover time
// (api/twilio/migration-watch.js), so a freshly-connected academy had no message
// history in the portal until cutover.
//
// This cron does NOT re-implement the import - it reuses the existing idempotent
// endpoints (api/messaging/import-ghl-history + email-import-ghl-history). It just
// decides WHO needs it and stamps completion.
//
//   GET /api/ghl/cron-import-history                 Bearer CRON_SECRET (Vercel cron)
//   GET /api/ghl/cron-import-history?client_id=<id>  force ONE academy now (re-run ok)
//
// Eligibility: V2/V1.5 only (V1 pure-GHL is NEVER touched - hard rule), GHL
// connected, clients.ghl_history_imported_at IS NULL. Batch-capped per run to
// stay inside the function budget; the marker is stamped only when BOTH the SMS
// and email imports report done=true, so a large history keeps advancing across
// runs (each import is idempotent - existing ghl_message_ids are skipped).

import { timingSafeEqual } from "node:crypto";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const PROD = "https://portal.byanymeansbusiness.com";
const BATCH = 2;       // academies per run (SMS+email import each, sequential)
const MAX_PAGES = 50;  // cap per import call (the endpoint's own ceiling)

export const maxDuration = 300;

const nowIso = () => new Date().toISOString();

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function runImport(path, clientId) {
  try {
    const r = await fetch(`${PROD}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, max_pages: MAX_PAGES }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, done: !!j.done, error: j.error || null };
  } catch (e) { return { ok: false, done: false, error: e.message }; }
}

async function importForAcademy(client) {
  const sms   = await runImport("/api/messaging/import-ghl-history", client.id);
  const email = await runImport("/api/messaging/email-import-ghl-history", client.id);
  const stamped = !!(sms.done && email.done);
  if (stamped) {
    await sb(`clients?id=eq.${encodeURIComponent(client.id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ghl_history_imported_at: nowIso() }),
    }).catch(() => {});
  }
  return { academy: client.business_name, sms, email, stamped };
}

async function handler(req, res) {
  if (!CRON_SECRET) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const gb = Buffer.from(got), eb = Buffer.from(CRON_SECRET);
  if (gb.length !== eb.length || !timingSafeEqual(gb, eb)) return res.status(401).json({ error: "unauthorized" });

  const onlyClient = (req.query.client_id || "").trim();
  // Migrating tier only (V2 or V1.5), GHL connected. The batch path also requires
  // the marker be NULL; the single-client path drops that so staff can force a re-run.
  const tierFilter = "or=(v2_access.eq.true,v15_access.eq.true)";
  const q = onlyClient
    ? `clients?id=eq.${encodeURIComponent(onlyClient)}&ghl_location_id=not.is.null&${tierFilter}&select=id,business_name&limit=1`
    : `clients?ghl_location_id=not.is.null&ghl_history_imported_at=is.null&${tierFilter}&select=id,business_name&order=ghl_connected_at.desc.nullslast&limit=${BATCH}`;

  let list;
  try { list = await sb(q); } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!Array.isArray(list) || list.length === 0) return res.status(200).json({ ok: true, processed: 0, stamped: 0, results: [] });

  const results = [];
  for (const c of list) {
    try { results.push(await importForAcademy(c)); }
    catch (e) { results.push({ academy: c.business_name, error: e.message }); }
  }
  const stamped = results.filter(r => r.stamped).length;
  console.log(`[cron-import-history] processed=${results.length} stamped=${stamped}`);
  return res.status(200).json({ ok: true, processed: results.length, stamped, results });
}

export default withSentryApiRoute(handler);
