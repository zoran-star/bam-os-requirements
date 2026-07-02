// Shared helpers for the Twilio VOICE spine (cell-forwarding model).
//
// Inbound: the academy's number VoiceUrl → api/twilio/voice-inbound.js →
//   <Dial> the staff cell(s); no answer → voicemail (recorded + transcribed).
// Outbound: api/twilio/call.js creates a call that rings the staff cell, then
//   bridges to the lead (caller ID = the academy number) via voice-outbound.js.
//
// Reuses the SMS spine's per-academy creds in `client_twilio_config` (encrypted
// via MESSAGING_ENC_KEY). Auth to Twilio REST = Basic (apiKeySid|accountSid):
// (apiKeySecret|authToken) — same as api/messaging/provider.js.

import crypto from "node:crypto";
import { decryptSecret } from "../messaging/_crypto.js";
import { maybeSendSmsViaProvider } from "../messaging/provider.js";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

export async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Decrypt + shape an academy's Twilio creds + voice settings from a config row.
function shapeCfg(row) {
  if (!row) return null;
  const dec = (v) => { try { return v ? decryptSecret(v) : null; } catch { return null; } };
  return {
    clientId:          row.client_id,
    accountSid:        row.account_sid || null,
    authToken:         dec(row.auth_token_enc),
    apiKeySid:         row.api_key_sid || null,
    apiKeySecret:      dec(row.api_key_secret_enc),
    from:              row.from_number || null,
    status:            row.status,
    voiceEnabled:      row.voice_enabled === true,
    ringNumbers:       Array.isArray(row.voice_ring_numbers) ? row.voice_ring_numbers.filter(Boolean) : [],
    voiceRecord:       row.voice_record === true,
    voicemailEnabled:  row.voicemail_enabled !== false,
    missedTextEnabled: row.missed_call_text_enabled !== false,
    missedText:        row.missed_call_text || null,
  };
}

const CFG_COLS = "client_id,account_sid,auth_token_enc,api_key_sid,api_key_secret_enc,from_number,status,voice_enabled,voice_ring_numbers,voice_record,voicemail_enabled,missed_call_text_enabled,missed_call_text";

// Look up an academy's voice config by the number that received/owns the call.
export async function loadVoiceConfigByNumber(e164) {
  if (!e164) return null;
  const rows = await sb(`client_twilio_config?from_number=eq.${encodeURIComponent(e164)}&status=eq.active&select=${CFG_COLS}&limit=1`).catch(() => null);
  return shapeCfg(rows && rows[0]);
}

export async function loadVoiceConfig(clientId) {
  if (!clientId) return null;
  const rows = await sb(`client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&select=${CFG_COLS}&limit=1`).catch(() => null);
  return shapeCfg(rows && rows[0]);
}

export function twilioAuthHeader(cfg) {
  const user = cfg.apiKeySid || cfg.accountSid;
  const pass = cfg.apiKeySecret || cfg.authToken;
  if (!user || !pass) return null;
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

// Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted(k+v)…)).
// (Same scheme as api/twilio/inbound-webhook.js.)
export function validSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); } catch { return false; }
}

export function absUrl(req, path) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}${path}`;
}

// Reconstruct the exact URL Twilio signed (host + original path w/ query).
export function requestUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}${req.url}`;
}

export function sendTwiml(res, twiml) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>${twiml}`);
}

export function xmlEscape(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Best-effort contact identity from the SMS store (contacts already imported there).
export async function contactForPhone(clientId, phone) {
  if (!clientId || !phone) return {};
  try {
    const rows = await sb(`sms_threads?client_id=eq.${encodeURIComponent(clientId)}&contact_phone=eq.${encodeURIComponent(phone)}&select=ghl_contact_id,contact_name&limit=1`);
    const r = rows && rows[0];
    return r ? { ghlContactId: r.ghl_contact_id || null, contactName: r.contact_name || null } : {};
  } catch { return {}; }
}

// Insert a call row (idempotent on twilio_call_sid). Returns nothing (best-effort).
export async function logCall(row) {
  try {
    await sb(`calls?on_conflict=twilio_call_sid`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ ...row, updated_at: new Date().toISOString() }]),
    });
  } catch (_) { /* non-fatal */ }
}

const PROD_BASE = "https://portal.byanymeansbusiness.com";

// Click-to-call: ring the staff cell; when they answer, Twilio fetches
// voice-outbound → bridge to the lead (caller ID = academy number). Returns the
// call SID/status. Throws on config/Twilio errors (caller decides how to surface).
export async function startClickToCall(cfg, { leadPhone }) {
  const auth = twilioAuthHeader(cfg);
  if (!auth) throw new Error("twilio auth creds missing");
  if (!cfg.accountSid || !cfg.from) throw new Error("twilio account_sid / from_number missing");
  const staff = cfg.ringNumbers[0];
  if (!staff) throw new Error("no staff ring number configured");
  if (!leadPhone) throw new Error("no lead phone");

  const url = `${PROD_BASE}/api/twilio/voice-outbound?lead=${encodeURIComponent(leadPhone)}&num=${encodeURIComponent(cfg.from)}`;
  const form = new URLSearchParams({
    To: staff, From: cfg.from, Url: url, Method: "POST",
    StatusCallback: `${PROD_BASE}/api/twilio/voice-status`, StatusCallbackMethod: "POST",
  });
  if (cfg.voiceRecord) form.set("Record", "true");

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Calls.json`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${j.message || j.code || "call failed"}`);
  return { sid: j.sid || null, status: j.status || "queued", staff };
}

const DEFAULT_MISSED_TEXT = "Sorry we missed your call! Reply to this text and we'll help you out.";

// Auto-text a caller after a missed inbound call. Routes through the portal SMS
// spine first so it threads in the portal inbox (fully off-GHL) and the lead's
// reply lands there; falls back to a direct Twilio send. Best-effort.
export async function sendMissedCallText(cfg, callerPhone) {
  if (!cfg || !cfg.missedTextEnabled || !callerPhone) return { skipped: true };
  const body = (cfg.missedText && cfg.missedText.trim()) || DEFAULT_MISSED_TEXT;
  try {
    const r = await maybeSendSmsViaProvider(cfg.clientId, { toPhone: callerPhone, body, sentBy: "missed-call-auto" });
    if (r && r.handled) return { ok: true, via: "provider" };
  } catch (_) { /* fall through to direct */ }
  await sendSmsVia(cfg, callerPhone, body);
  return { ok: true, via: "direct" };
}

// Fire a plain SMS via the academy's Twilio (used for voicemail alerts to staff).
// Best-effort; never throws into a call flow.
export async function sendSmsVia(cfg, toPhone, body) {
  try {
    const auth = twilioAuthHeader(cfg);
    if (!auth || !cfg.accountSid || !cfg.from || !toPhone) return;
    const form = new URLSearchParams({ To: toPhone, From: cfg.from, Body: String(body || "").slice(0, 1500) });
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (_) { /* non-fatal */ }
}

// Patch a call row by Twilio Call SID.
export async function updateCallBySid(sid, patch) {
  if (!sid) return;
  try {
    await sb(`calls?twilio_call_sid=eq.${encodeURIComponent(sid)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
  } catch (_) { /* non-fatal */ }
}
