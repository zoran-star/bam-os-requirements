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
// endpoints (api/messaging/import-ghl-history + email-import-ghl-history). Those
// run in ~12s chunks and return a { done, cursor } so the caller LOOPS until
// done - which this cron does, per academy, within a wall-clock budget.
//
//   GET /api/ghl/cron-import-history                 Bearer CRON_SECRET (Vercel cron)
//   GET /api/ghl/cron-import-history?client_id=<id>  force ONE academy now (re-run ok)
//
// Eligibility: V2/V1.5 only (V1 pure-GHL is NEVER touched - hard rule) UNLESS the
// academy is named in IMPORT_PILOT_CLIENT_IDS, which is an explicit per-academy
// authorization to include it (see the ALLOWLIST comment in the handler). GHL
// connected, clients.ghl_history_imported_at IS NULL. The marker is stamped only
// when BOTH the SMS and email imports report done=true (each import is idempotent
// - existing ghl_message_ids are skipped). A very large history that can't finish
// inside one run's budget stays pending and re-runs next cycle (re-scans from the
// start, idempotent); persisting the cursor across runs is a phase-2 nicety.

import { timingSafeEqual } from "node:crypto";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const PROD = "https://portal.byanymeansbusiness.com";
const CANDIDATES = 3;      // academies to consider per run (processed until the deadline)
const MAX_PAGES = 50;      // per import CALL (the endpoint's own ceiling)
const MAX_CALLS = 80;      // per import safety cap on the resume loop
const BUDGET_MS = 250_000; // wall-clock budget (function maxDuration is 300s)

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

// Page one import endpoint to completion: re-submit the { start_after_date,
// start_after } cursor it returns until done, or we run out of budget/calls.
async function runImportToDone(path, clientId, deadline) {
  let cursor = null, done = false, calls = 0, pages = 0, imported = 0, error = null;
  while (!done && calls < MAX_CALLS && Date.now() < deadline) {
    calls++;
    let j;
    try {
      const r = await fetch(`${PROD}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, max_pages: MAX_PAGES, ...(cursor || {}) }),
      });
      j = await r.json().catch(() => ({}));
      if (!r.ok) { error = j.error || `HTTP ${r.status}`; break; }
    } catch (e) { error = e.message; break; }
    done = !!j.done;
    cursor = j.cursor || null;
    pages += Number(j.pages) || 0;
    imported += Number(j.messages_imported) || 0;
    if (!done && !cursor) break; // nothing to advance on - avoid an infinite loop
  }
  return { done, calls, pages, imported, error };
}

// A connected Gmail (2-way sync) IS the academy's email inbox + history, and it
// writes the SAME email_threads/email_messages store as the GHL email import
// (provider 'gmail' vs 'ghl') - running both would double every email thread.
// So: SMS history always imports (texts live only in GHL), but the GHL EMAIL
// import is skipped when a Gmail mailbox is connected. Academies without Gmail
// still import their GHL email history (they'd otherwise lose it at cutover).
//
// THREE OUTCOMES, NOT TWO (repo house rule 10). This question crosses a network
// boundary, so "there is no mailbox" and "we could not ask" are different facts
// and must not share a value. They used to: the catch returned false, which the
// caller read as "no Gmail connected" and so ran the GHL email import on top of
// a live Gmail 2-way sync. One Supabase blip would therefore duplicate an
// academy's entire email history, with nothing downstream able to tell that it
// happened or which threads were the copies.
//
//   "yes"      an active Gmail mailbox row came back
//   "no"       we asked, and there is none
//   "unknown"  we could not ask, or could not read the answer we got
//
// The caller treats "unknown" like "yes" for SKIPPING the email import, and
// unlike "yes" for STAMPING the marker. Skipping is recoverable by re-running;
// duplicating is not recoverable at all.
export const GMAIL_YES = "yes";
export const GMAIL_NO = "no";
export const GMAIL_UNKNOWN = "unknown";

export async function gmailMailboxState(clientId) {
  let rows;
  try {
    rows = await sb(`client_mailboxes?client_id=eq.${encodeURIComponent(clientId)}&provider=eq.gmail&status=eq.active&select=client_id&limit=1`);
  } catch (e) {
    console.warn(`[cron-import-history] client_mailboxes lookup failed for ${clientId}: ${(e && e.message) || e}`);
    return GMAIL_UNKNOWN;
  }
  // sb() returns null for an empty body, and anything that is not an array is
  // an answer we cannot read. Neither is evidence that no mailbox exists.
  if (!Array.isArray(rows)) {
    console.warn(`[cron-import-history] client_mailboxes returned an unreadable answer for ${clientId}`);
    return GMAIL_UNKNOWN;
  }
  return rows.length > 0 ? GMAIL_YES : GMAIL_NO;
}

export async function importForAcademy(client, deadline) {
  const sms = await runImportToDone("/api/messaging/import-ghl-history", client.id, deadline);
  const gmail = await gmailMailboxState(client.id);
  let email;
  if (gmail === GMAIL_YES) {
    email = { done: true, skipped: "gmail-connected" };
  } else if (gmail === GMAIL_UNKNOWN) {
    // Deferred, and deliberately NOT done. done:true here would stamp the
    // marker, and the batch query only ever considers academies whose marker is
    // NULL - so stamping on an unknown would turn one blip into a permanent
    // skip of that academy's email history. Leaving it unstamped costs a re-run.
    email = { done: false, skipped: "gmail-unknown" };
    console.warn(`[cron-import-history] ${client.business_name}: Gmail mailbox state UNKNOWN - GHL email import deferred, marker not stamped, will re-ask next run`);
  } else {
    email = await runImportToDone("/api/messaging/email-import-ghl-history", client.id, deadline);
  }
  const stamped = !!(sms.done && email.done);
  if (stamped) {
    await sb(`clients?id=eq.${encodeURIComponent(client.id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ghl_history_imported_at: nowIso() }),
    }).catch(() => {});
  }
  return { academy: client.business_name, gmail, sms, email, stamped };
}

async function handler(req, res) {
  if (!CRON_SECRET) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const gb = Buffer.from(got), eb = Buffer.from(CRON_SECRET);
  if (gb.length !== eb.length || !timingSafeEqual(gb, eb)) return res.status(401).json({ error: "unauthorized" });

  const deadline = Date.now() + BUDGET_MS;
  const onlyClient = (req.query.client_id || "").trim();
  // Migrating tier only (V2 or V1.5), GHL connected. The batch path also requires
  // the marker be NULL; the single-client path drops that so staff can force a re-run.
  const tierFilter = "or=(v2_access.eq.true,v15_access.eq.true)";

  // ALLOWLIST. IMPORT_PILOT_CLIENT_IDS is a comma-separated list of client uuids.
  // When set:
  //   - the BATCH path considers ONLY those academies (nobody else is touched)
  //   - a listed academy BYPASSES the V2/V1.5 tier filter
  //
  // The tier bypass is deliberate and narrow. The repo hard rule is that V1
  // academies are never touched unless Zoran says so per task; naming an academy
  // in this env var IS that explicit, auditable per-academy authorization
  // (Zoran, 2026-07-28: apply to HMS, Game Winner, Sage and Pro Precision, the
  // last of which is V1). Importing an academy's own GHL history into our store
  // is read-only against GHL and changes nothing the academy sees.
  //
  // Unset = original behaviour: whole eligible queue, tier filter enforced.
  const pilotIds = (process.env.IMPORT_PILOT_CLIENT_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const allowlisted = pilotIds.includes(onlyClient);

  const q = onlyClient
    ? `clients?id=eq.${encodeURIComponent(onlyClient)}&ghl_location_id=not.is.null${allowlisted ? "" : `&${tierFilter}`}&select=id,business_name&limit=1`
    : pilotIds.length
      ? `clients?ghl_location_id=not.is.null&ghl_history_imported_at=is.null&id=in.(${pilotIds.join(",")})&select=id,business_name&order=ghl_connected_at.desc.nullslast&limit=${CANDIDATES}`
      : `clients?ghl_location_id=not.is.null&ghl_history_imported_at=is.null&${tierFilter}&select=id,business_name&order=ghl_connected_at.desc.nullslast&limit=${CANDIDATES}`;

  let list;
  try { list = await sb(q); } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!Array.isArray(list) || list.length === 0) return res.status(200).json({ ok: true, processed: 0, stamped: 0, results: [] });

  const results = [];
  for (const c of list) {
    if (Date.now() >= deadline) break; // out of budget - the rest come next run
    try { results.push(await importForAcademy(c, deadline)); }
    catch (e) { results.push({ academy: c.business_name, error: e.message }); }
  }
  const stamped = results.filter(r => r.stamped).length;
  // An academy skipped because we could not READ its mailbox state is a
  // different fact from one skipped because Gmail is genuinely connected, and an
  // operator has to be able to tell them apart: the first means an import is
  // still owed and will be re-asked, the second means there is nothing to import.
  const deferred = results.filter(r => r.email && r.email.skipped === "gmail-unknown").length;
  console.log(`[cron-import-history] processed=${results.length} stamped=${stamped} gmail_unknown_deferred=${deferred}`);
  return res.status(200).json({ ok: true, processed: results.length, stamped, gmail_unknown_deferred: deferred, results });
}

export default withSentryApiRoute(handler);
