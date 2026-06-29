// Messaging spine (3/5): outbound provider resolver + Twilio sender + a SAFE gate
// that every SMS send site funnels through. DORMANT: returns "not handled" for any
// academy not on messaging_provider='twilio' with an active client_twilio_config,
// so the existing GHL send path runs unchanged. Never throws to the caller.
//
// The gate keeps the lead tied to its GHL contact (sms_threads.ghl_contact_id) so
// the pipeline + agents keep working after cutover.
import { decryptSecret } from "./_crypto.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// short-lived cache so a burst of sends doesn't re-hit the config table
const _cfgCache = new Map(); // clientId -> { at, cfg }
const CFG_TTL = 30_000;

async function loadTwilioConfig(clientId) {
  const hit = _cfgCache.get(clientId);
  if (hit && Date.now() - hit.at < CFG_TTL) return hit.cfg;
  let cfg = null;
  try {
    const rows = await sb(`client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}&limit=1`);
    cfg = (rows && rows[0]) || null;
  } catch (_) { cfg = null; }
  _cfgCache.set(clientId, { at: Date.now(), cfg });
  return cfg;
}

// cached per-client provider resolution by clientId, so a send site that loaded a
// partial client row (without messaging_provider) still resolves correctly. 'twilio'
// only when the academy is flipped AND its creds are active; else 'ghl'.
const _provCache = new Map(); // clientId -> { at, provider }
async function resolveProvider(clientId) {
  if (!clientId) return "ghl";
  const hit = _provCache.get(clientId);
  if (hit && Date.now() - hit.at < CFG_TTL) return hit.provider;
  let provider = "ghl";
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=messaging_provider&limit=1`);
    if (rows && rows[0] && rows[0].messaging_provider === "twilio") {
      const cfg = await loadTwilioConfig(clientId);
      if (cfg && cfg.status === "active") provider = "twilio";
    }
  } catch (_) { provider = "ghl"; }
  _provCache.set(clientId, { at: Date.now(), provider });
  return provider;
}
// Accepts a client object or a bare clientId.
export async function smsProvider(clientOrId) {
  const id = typeof clientOrId === "string" ? clientOrId : (clientOrId && clientOrId.id);
  return resolveProvider(id);
}

function twilioCreds(cfg) {
  const accountSid = cfg.account_sid;
  const authToken = cfg.auth_token_enc ? decryptSecret(cfg.auth_token_enc) : null;
  const apiKeySid = cfg.api_key_sid || null;
  const apiKeySecret = cfg.api_key_secret_enc ? decryptSecret(cfg.api_key_secret_enc) : null;
  return { accountSid, authToken, apiKeySid, apiKeySecret, from: cfg.from_number, messagingServiceSid: cfg.messaging_service_sid };
}

async function upsertThread(clientId, phone, ghlContactId, name) {
  const rows = await sb(`sms_threads?on_conflict=client_id,contact_phone`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ client_id: clientId, contact_phone: phone, ghl_contact_id: ghlContactId || null, contact_name: name || null }]),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

// If only a GHL contactId is known, recover the phone from the imported store.
async function phoneForContact(clientId, ghlContactId) {
  if (!ghlContactId) return null;
  try {
    const rows = await sb(`sms_threads?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&select=contact_phone&limit=1`);
    const p = rows && rows[0] && rows[0].contact_phone;
    return p && !p.startsWith("ghl:") && !p.startsWith("ghl-conv:") ? p : null;
  } catch (_) { return null; }
}

// Send one SMS via the academy's own Twilio + record it in the own-store.
async function sendViaTwilio(clientId, { toPhone, body, ghlContactId, sentBy, contactName }) {
  const cfg = await loadTwilioConfig(clientId);
  if (!cfg) throw new Error("no twilio config");
  const c = twilioCreds(cfg);
  if (!c.accountSid) throw new Error("twilio account_sid missing");
  if (!c.from && !c.messagingServiceSid) throw new Error("twilio from_number / messaging_service_sid missing");

  const authUser = c.apiKeySid || c.accountSid;
  const authPass = c.apiKeySecret || c.authToken;
  if (!authPass) throw new Error("twilio auth secret missing");

  const form = new URLSearchParams();
  form.set("To", toPhone);
  if (c.messagingServiceSid) form.set("MessagingServiceSid", c.messagingServiceSid);
  else form.set("From", c.from);
  form.set("Body", body || "");
  const base = process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL ? `https://${(process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL || "").replace(/^https?:\/\//, "")}` : "";
  if (base) form.set("StatusCallback", `${base}/api/twilio/status`);

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${authUser}:${authPass}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Twilio ${resp.status}: ${json.message || json.code || "send failed"}`);

  const thread = await upsertThread(clientId, toPhone, ghlContactId, contactName);
  if (thread) {
    const occurred = new Date().toISOString();
    await sb(`sms_messages`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        thread_id: thread.id, client_id: clientId, provider: "twilio", direction: "outbound",
        channel: "sms", body: body || "", status: json.status || "queued", twilio_sid: json.sid || null,
        sent_by: sentBy || null, occurred_at: occurred, raw: json,
      }]),
    }).catch(() => {});
    await sb(`sms_threads?id=eq.${thread.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_message_at: occurred, last_preview: (body || "").slice(0, 160), last_direction: "outbound", updated_at: occurred }),
    }).catch(() => {});
  }
  return { ok: true, sid: json.sid || null, status: json.status || "queued" };
}

// The gate every send site calls FIRST.
//   { handled:false }                  -> caller runs its existing GHL send
//   { handled:true, ok:true, sid }     -> sent via Twilio + stored
//   { handled:true, ok:false, error }  -> academy is twilio but send failed
//                                         (do NOT fall back to GHL - wrong number)
// Never throws.
export async function maybeSendSmsViaProvider(clientOrId, { toPhone, ghlContactId, body, sentBy, contactName } = {}) {
  try {
    const clientId = typeof clientOrId === "string" ? clientOrId : (clientOrId && clientOrId.id);
    if (!clientId) return { handled: false };
    if ((await resolveProvider(clientId)) !== "twilio") return { handled: false };
    const phone = toPhone || (await phoneForContact(clientId, ghlContactId));
    if (!phone) return { handled: true, ok: false, error: "no phone for twilio send" };
    const r = await sendViaTwilio(clientId, { toPhone: phone, body, ghlContactId, sentBy, contactName });
    return { handled: true, ...r };
  } catch (e) {
    return { handled: true, ok: false, error: e.message || String(e) };
  }
}
