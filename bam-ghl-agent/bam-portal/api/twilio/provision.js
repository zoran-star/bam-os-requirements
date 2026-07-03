import { withSentryApiRoute } from "../_sentry.js";
// Provision an academy onto the BAM MASTER Twilio account (agency model).
//
//   POST /api/twilio/provision
//   body: {
//     client_id,                 required - the academy
//     country: "US"|"CA",        default US
//     area_code: "416",          optional - preferred area code
//     ring_number: "+1…",        optional - staff cell for inbound calls
//     dry_run: true,             optional - search only, create/buy NOTHING
//     flip_provider: true,       optional - also set clients.messaging_provider
//                                to 'twilio' (leave off for GHL clients that
//                                haven't cut messaging over yet)
//   }
//
// What it does (skipping anything that already exists - safe to re-run):
//   1. find-or-create a SUBACCOUNT named after the academy
//   2. search + BUY a local number (sms+voice capable), webhooks wired at
//      purchase time (SMS inbound + voice inbound + voice status)
//   3. store subaccount creds encrypted in client_twilio_config (status=active)
//      with voice defaults: ring the given cell, voicemail on, missed-call
//      text on
//
// Auth: Bearer CRON_SECRET, or a BAM staff Supabase JWT.
// A2P registration is NOT here - it needs the approved TrustHub profile and
// lands in a separate step (a US number can't text US recipients until then;
// calls + voicemail work immediately).

import { sb } from "./_voice.js";
import { encryptSecret } from "../messaging/_crypto.js";

const PROD = "https://portal.byanymeansbusiness.com";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function masterAuth() {
  const sid = process.env.TWILIO_MASTER_API_KEY_SID;
  const secret = process.env.TWILIO_MASTER_API_KEY_SECRET;
  if (!sid || !secret) return null;
  return "Basic " + Buffer.from(`${sid}:${secret}`).toString("base64");
}

async function tw(auth, method, path, form) {
  const r = await fetch(`https://api.twilio.com/2010-04-01${path}`, {
    method,
    headers: { Authorization: auth, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Twilio ${r.status} ${path}: ${j.message || j.code || "error"}`);
  return j;
}

async function isStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
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
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const cronOk = process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;
  if (!cronOk && !(await isStaff(req))) return res.status(401).json({ error: "unauthorized" });

  const auth = masterAuth();
  if (!auth) return res.status(500).json({ error: "TWILIO_MASTER_API_KEY_SID/SECRET not configured" });
  const MASTER = process.env.TWILIO_MASTER_ACCOUNT_SID;
  if (!MASTER) return res.status(500).json({ error: "TWILIO_MASTER_ACCOUNT_SID not configured" });

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = String(body.client_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: "client_id must be a uuid" });
  const country = String(body.country || "US").toUpperCase();
  if (!["US", "CA"].includes(country)) return res.status(400).json({ error: "country must be US or CA" });
  const areaCode = String(body.area_code || "").replace(/\D/g, "");
  const ring = String(body.ring_number || "").trim();
  const dryRun = body.dry_run === true;

  const clients = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name&limit=1`);
  const client = clients && clients[0];
  if (!client) return res.status(404).json({ error: "unknown client_id" });

  // Idempotency: an academy with an active number never gets a second one.
  const existing = await sb(
    `client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}&select=account_sid,from_number,status&limit=1`
  ).catch(() => []);
  if (existing && existing[0] && existing[0].status === "active" && existing[0].from_number) {
    return res.status(200).json({ ok: true, already_provisioned: true, number: existing[0].from_number, subaccount_sid: existing[0].account_sid });
  }

  // 1. Find-or-create the subaccount (named after the academy).
  const subName = `academy: ${client.business_name}`.slice(0, 64);
  const found = await tw(auth, "GET", `/Accounts.json?FriendlyName=${encodeURIComponent(subName)}&Status=active&PageSize=1`);
  let sub = (found.accounts || [])[0] || null;
  if (sub && sub.sid === MASTER) sub = null; // never treat the master itself as a target

  // 2. Search candidate numbers (read-only - happens in dry runs too).
  //    Search from the master; the buy happens inside the subaccount.
  const searchBase = `/Accounts/${encodeURIComponent(MASTER)}/AvailablePhoneNumbers/${country}/Local.json?SmsEnabled=true&VoiceEnabled=true&PageSize=5`;
  let avail = await tw(auth, "GET", areaCode ? `${searchBase}&AreaCode=${areaCode}` : searchBase);
  let areaCodeFallback = false;
  if (!(avail.available_phone_numbers || []).length && areaCode) {
    avail = await tw(auth, "GET", searchBase);
    areaCodeFallback = true;
  }
  const candidates = (avail.available_phone_numbers || []).map((n) => n.phone_number);
  if (!candidates.length) return res.status(502).json({ error: `no ${country} numbers available${areaCode ? ` (tried area code ${areaCode} + fallback)` : ""}` });

  if (dryRun) {
    return res.status(200).json({
      ok: true, dry_run: true, client: client.business_name,
      would_reuse_subaccount: sub ? sub.sid : null,
      would_create_subaccount: sub ? null : subName,
      candidate_numbers: candidates, area_code_fallback: areaCodeFallback,
      ring_number: ring || null,
    });
  }

  // ── Live run ────────────────────────────────────────────────────────────
  if (!sub) {
    sub = await tw(auth, "POST", `/Accounts.json`, { FriendlyName: subName });
  }
  const subSid = sub.sid;
  const subToken = sub.auth_token; // present on both create and list responses

  // 3. Buy the number inside the subaccount, webhooks wired in the same call.
  const bought = await tw(auth, "POST", `/Accounts/${encodeURIComponent(subSid)}/IncomingPhoneNumbers.json`, {
    PhoneNumber: candidates[0],
    FriendlyName: client.business_name,
    SmsUrl: `${PROD}/api/twilio/inbound-webhook`, SmsMethod: "POST",
    VoiceUrl: `${PROD}/api/twilio/voice-inbound`, VoiceMethod: "POST",
    StatusCallback: `${PROD}/api/twilio/voice-status`, StatusCallbackMethod: "POST",
  });

  // 4. Store creds + voice defaults. Upsert on client_id (PK).
  await sb(`client_twilio_config?on_conflict=client_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      client_id: clientId,
      account_sid: subSid,
      auth_token_enc: subToken ? encryptSecret(subToken) : null,
      from_number: bought.phone_number,
      status: "active",
      voice_enabled: true,
      voice_ring_numbers: ring ? [ring] : [],
      voice_record: false,
      voicemail_enabled: true,
      missed_call_text_enabled: true,
      notes: `provisioned ${new Date().toISOString().slice(0, 10)} via master (${dryRun ? "dry" : "live"})`,
      updated_at: new Date().toISOString(),
    }]),
  });

  // 5. Optionally flip the academy's messaging transport to the new number.
  //    Off by default so GHL academies mid-migration keep texting via GHL.
  if (body.flip_provider === true) {
    await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ messaging_provider: "twilio" }),
    }).catch(() => {});
  }

  return res.status(200).json({
    ok: true,
    client: client.business_name,
    subaccount_sid: subSid,
    number: bought.phone_number,
    area_code_fallback: areaCodeFallback,
    voice: { ring_numbers: ring ? [ring] : [], voicemail: true, missed_call_text: true },
    provider_flipped: body.flip_provider === true,
    a2p: country === "US" ? "NOT registered yet - US texting blocked until the A2P step runs" : "n/a (CA)",
  });
}

async function safeHandler(req, res) {
  try { return await handler(req, res); }
  catch (e) { return res.status(502).json({ error: e.message || String(e) }); }
}

export default withSentryApiRoute(safeHandler);
