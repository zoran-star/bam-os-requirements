import { withSentryApiRoute } from "../_sentry.js";
// Migration watcher (cron): clients keep texting via GHL while their number
// ports into the BAM master and (US) their A2P campaign gets vetted. This
// polls both conditions and performs the cutover the moment they're green:
//
//   for each client_twilio_config row with status='pending' + auto_cutover:
//     PORT   - has from_number appeared in their subaccount yet?
//              (first sighting: wire SMS/voice webhooks - ports arrive bare)
//     A2P    - if a2p_required: is a2p_campaign_sid VERIFIED?
//              (polled with the SUBACCOUNT's own creds - messaging API
//               resources aren't reachable with master auth)
//     BOTH green →
//       1. re-run the GHL history import (idempotent, catches the tail)
//       2. clients.messaging_provider = 'twilio'   ← the actual switch
//       3. config status='active', cutover_at=now
//       4. Slack note (best-effort)
//
//   GET /api/twilio/migration-watch          (Vercel cron, x-vercel-cron)
//   GET /api/twilio/migration-watch?client_id=…  Bearer CRON_SECRET (manual)
//
// Rows it never touches: status='active' (GTA, provisioned new-number
// academies) and anything with auto_cutover=false (white-glove/manual).

import { sb } from "./_voice.js";
import { decryptSecret } from "../messaging/_crypto.js";

const PROD = "https://portal.byanymeansbusiness.com";

function masterAuth() {
  const sid = process.env.TWILIO_MASTER_API_KEY_SID;
  const secret = process.env.TWILIO_MASTER_API_KEY_SECRET;
  if (!sid || !secret) return null;
  return "Basic " + Buffer.from(`${sid}:${secret}`).toString("base64");
}
const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

async function slack(text) {
  try {
    const token = process.env.SLACK_BOT_TOKEN, channel = process.env.FEEDBACK_SLACK_CHANNEL;
    if (!token || !channel) return;
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });
  } catch (_) { /* best-effort */ }
}

// Has the number landed in the subaccount? Returns the IncomingPhoneNumber or null.
async function findNumber(auth, subSid, e164) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(subSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(e164)}`, { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return (j.incoming_phone_numbers || [])[0] || null;
}

async function wireNumber(auth, subSid, pnSid) {
  const form = new URLSearchParams({
    SmsUrl: `${PROD}/api/twilio/inbound-webhook`, SmsMethod: "POST",
    VoiceUrl: `${PROD}/api/twilio/voice-inbound`, VoiceMethod: "POST",
    StatusCallback: `${PROD}/api/twilio/voice-status`, StatusCallbackMethod: "POST",
  });
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(subSid)}/IncomingPhoneNumbers/${encodeURIComponent(pnSid)}.json`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

// A2P campaign status, authenticated AS the subaccount.
async function campaignStatus(row) {
  if (!row.messaging_service_sid || !row.a2p_campaign_sid) return null;
  const token = row.auth_token_enc ? decryptSecret(row.auth_token_enc) : null;
  if (!token) return null;
  const r = await fetch(`https://messaging.twilio.com/v1/Services/${encodeURIComponent(row.messaging_service_sid)}/Compliance/Usa2p/${encodeURIComponent(row.a2p_campaign_sid)}`, {
    headers: { Authorization: basic(row.account_sid, token) },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return String(j.campaign_status || "").toLowerCase() || null; // in_progress | verified | failed
}

async function patchCfg(clientId, patch) {
  await sb(`client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function handler(req, res) {
  const isCron = !!req.headers["x-vercel-cron"];
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!isCron && !(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const auth = masterAuth();
  if (!auth) return res.status(500).json({ error: "master creds not configured" });

  const one = String(req.query.client_id || "").trim();
  const filter = one ? `client_id=eq.${encodeURIComponent(one)}` : `status=eq.pending&auto_cutover=is.true`;
  const rows = await sb(`client_twilio_config?${filter}&select=client_id,account_sid,auth_token_enc,from_number,messaging_service_sid,status,a2p_required,a2p_campaign_sid,a2p_status,port_status`).catch(() => []);
  const results = [];

  for (const row of (rows || [])) {
    const r = { client_id: row.client_id, was: { port: row.port_status, a2p: row.a2p_status } };
    try {
      if (row.status !== "pending" || !row.account_sid || !row.from_number) { r.skip = "not a pending migration row"; results.push(r); continue; }

      // ── PORT: number visible in the subaccount yet? ──
      const pn = await findNumber(auth, row.account_sid, row.from_number);
      if (pn && row.port_status !== "landed") {
        await wireNumber(auth, row.account_sid, pn.sid);   // ports arrive with no webhooks
        await patchCfg(row.client_id, { port_status: "landed" });
        row.port_status = "landed";
        r.event = "port landed + webhooks wired";
      }
      const portReady = row.port_status === "landed" || !!pn;

      // ── A2P: campaign verified (only if required + registered) ──
      let a2pReady = !row.a2p_required;
      if (row.a2p_required) {
        const st = await campaignStatus(row);
        if (st && st !== row.a2p_status) { await patchCfg(row.client_id, { a2p_status: st }); row.a2p_status = st; }
        if (row.a2p_status === "failed") {
          await slack(`⚠️ A2P campaign FAILED for client ${row.client_id} - needs a fix + resubmit before their texting can cut over.`);
        }
        a2pReady = row.a2p_status === "verified";
      }
      r.port_ready = portReady; r.a2p_ready = a2pReady;

      // ── CUTOVER ──
      if (portReady && a2pReady) {
        // 1. catch-up history import (idempotent; ok if it partially fails - staff can re-run)
        let imported = false;
        try {
          const ir = await fetch(`${PROD}/api/messaging/import-ghl-history`, {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: row.client_id }),
          });
          imported = ir.ok;
        } catch (_) {}
        // 2. the switch
        await sb(`clients?id=eq.${encodeURIComponent(row.client_id)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ messaging_provider: "twilio" }),
        });
        await patchCfg(row.client_id, { status: "active", cutover_at: new Date().toISOString() });
        r.cutover = true; r.history_imported = imported;
        const names = await sb(`clients?id=eq.${encodeURIComponent(row.client_id)}&select=business_name&limit=1`).catch(() => []);
        await slack(`🎉 ${names?.[0]?.business_name || row.client_id} cut over to BAM Twilio (${row.from_number}). Calls, texts + voicemail now run on the portal spine.${imported ? "" : " (history import needs a manual re-run)"}`);
      }
    } catch (e) { r.error = e.message; }
    results.push(r);
  }

  return res.status(200).json({ ok: true, checked: results.length, results });
}

export default withSentryApiRoute(handler);
