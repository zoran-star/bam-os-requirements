// Email spine (3/n): Resend INBOUND email webhook - the email counterpart of
// api/twilio/inbound-webhook.js. When an academy on email_provider='resend'
// receives a reply, Resend POSTs an `email.received` event here. We store the
// message in the own-store (email_threads/email_messages) and fire the SAME
// side-effects the GHL/Twilio webhooks do (cancel stale drafts, exit automations
// -> Responded, notify owner), keyed by the lead's GHL contact (still in GHL).
//
// Resend inbound webhooks carry METADATA ONLY (from/to/subject/email_id) - the
// body is fetched with a follow-up call to /emails/receiving/{id}.
//
// Point the academy's receiving domain (clients.email_domain) MX at Resend and
// set the inbound webhook to:
//   https://portal.byanymeansbusiness.com/api/resend/inbound-webhook
//
// Env: RESEND_INBOUND_SECRET (Svix signing secret; falls back to
// RESEND_WEBHOOK_SECRET, then accept-unverified so it doesn't hard-fail pre-config).
import crypto from "node:crypto";
import { pickGhlToken } from "../ghl/_core.js";
import { notifyOwners } from "../_notify-owners.js";
import { respondedStage, ghostedStage, nurtureStage } from "../agent/_stage.js";
import { moveStage, pipelineFlags } from "../agent/_store.js";
import { ghl } from "../ghl/_core.js";
import { exitEnrollment } from "../automations.js";

export const config = { api: { bodyParser: false } };

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const WEBHOOK_SECRET = process.env.RESEND_INBOUND_SECRET || process.env.RESEND_WEBHOOK_SECRET;

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Svix signature verification (same scheme as api/resend/webhook.js).
function verifySvix(rawBody, headers, secret) {
  const id = headers["svix-id"], ts = headers["svix-timestamp"], sigHeader = headers["svix-signature"];
  if (!id || !ts || !sigHeader || !secret) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", secretBytes).update(`${id}.${ts}.${rawBody}`).digest("base64");
  const expectedBuf = Buffer.from(expected);
  for (const part of String(sigHeader).split(" ")) {
    const sig = part.split(",")[1];
    if (!sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) return true;
  }
  return false;
}

const norm = (e) => String(e || "").trim().toLowerCase();
// "Name <addr@x.com>" | "addr@x.com" -> "addr@x.com"
function extractAddr(v) {
  const s = String(v || "");
  const m = s.match(/<([^>]+)>/);
  return norm(m ? m[1] : s);
}
function domainOf(addr) { const a = norm(addr); const i = a.lastIndexOf("@"); return i >= 0 ? a.slice(i + 1) : ""; }

// Fetch the inbound email body (webhook is metadata-only). Best-effort.
async function fetchBody(emailId) {
  if (!emailId || !RESEND_API_KEY) return { text: "", html: "" };
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (!r.ok) return { text: "", html: "" };
    const j = await r.json().catch(() => ({}));
    return { text: j.text || "", html: j.html || "" };
  } catch (_) { return { text: "", html: "" }; }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const rawBody = await readRawBody(req);

  if (WEBHOOK_SECRET) {
    if (!verifySvix(rawBody, req.headers, WEBHOOK_SECRET)) return res.status(401).json({ error: "invalid signature" });
  } else {
    console.warn("[resend/inbound] no signing secret set - accepting UNVERIFIED");
  }

  let event;
  try { event = JSON.parse(rawBody); } catch (_) { return res.status(400).json({ error: "bad JSON" }); }

  const type = event.type || event.event || "";
  if (!/received|inbound/.test(String(type))) return res.status(200).json({ ok: true, ignored: type });

  const data = event.data || event;
  const emailId = data.email_id || data.id || null;
  const fromAddr = extractAddr(data.from);
  const toList = [].concat(data.to || [], data.received_for || []).map(extractAddr).filter(Boolean);
  const subject = data.subject || "";
  const messageId = data.message_id || null;
  if (!fromAddr || !toList.length) return res.status(200).json({ ok: true, skipped: "no from/to" });

  // Resolve the academy by the receiving domain.
  const domains = [...new Set(toList.map(domainOf).filter(Boolean))];
  let client = null;
  try {
    for (const d of domains) {
      const rows = await sb(`clients?email_domain=eq.${encodeURIComponent(d)}&select=id,business_name,v2_access,ghl_kpi_config,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
      if (rows && rows[0]) { client = rows[0]; break; }
    }
  } catch (_) {}
  if (!client) return res.status(200).json({ ok: true, skipped: "no academy for domain" }); // ack so Resend doesn't retry

  const clientId = client.id;
  const { text, html } = await fetchBody(emailId);
  const bodyText = (text || String(html || "").replace(/<[^>]+>/g, " ")).trim();

  // Resolve the lead's GHL contact from the portal contacts (by email) so the
  // side-effects that key on ghl_contact_id work.
  let ghlContactId = null, contactName = null;
  try {
    const rows = await sb(`contacts?client_id=eq.${clientId}&email=eq.${encodeURIComponent(fromAddr)}&select=ghl_contact_id,name,athlete_name&limit=1`);
    if (rows && rows[0]) { ghlContactId = rows[0].ghl_contact_id || null; contactName = rows[0].athlete_name || rows[0].name || null; }
  } catch (_) {}

  // Upsert the thread + record the inbound message.
  const occurred = new Date().toISOString();
  let thread = null;
  try {
    const rows = await sb(`email_threads?on_conflict=client_id,contact_email`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{ client_id: clientId, contact_email: fromAddr, ghl_contact_id: ghlContactId, contact_name: contactName }]),
    });
    thread = Array.isArray(rows) ? rows[0] : null;
  } catch (e) { console.error("resend inbound thread upsert:", e.message); }

  if (thread) {
    try {
      await sb(`email_messages`, { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{ thread_id: thread.id, client_id: clientId, provider: "resend", direction: "inbound", channel: "email", subject: subject || null, body: bodyText.slice(0, 20000), status: "received", resend_id: emailId, ghl_message_id: null, occurred_at: occurred, raw: event }]) });
      await sb(`email_threads?id=eq.${thread.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_message_at: occurred, last_preview: bodyText.slice(0, 160), last_subject: subject || null, last_direction: "inbound", unread: true, contact_name: thread.contact_name || contactName, updated_at: occurred }) });
    } catch (e) { console.error("resend inbound store:", e.message); }
  }

  // ── Same side-effects as the GHL/Twilio inbound webhooks ───────────────────
  try {
    const snip = bodyText.slice(0, 120);
    notifyOwners(clientId, "inbox_message", `✉️ New email in your inbox${snip ? `: "${snip}"` : "."}`).catch(() => {});
  } catch (_) {}

  if (ghlContactId) {
    const cid = encodeURIComponent(String(ghlContactId));
    // Lead replied → cancel pending/approved drafts.
    try {
      const patch = { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "lead replied (email)", updated_at: occurred }) };
      await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
      await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
      await sb(`agent_confirm_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
      await sb(`agent_closing_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
    } catch (e) { console.error("resend inbound draft-cancel:", e.message); }

    // Replied while in a portal automation → exit + bounce to Responded (same
    // guard as the SMS webhook: only when the open opp is in a nudge/ghost stage).
    try {
      const { exited } = await exitEnrollment({ clientId, contactId: ghlContactId, reason: "replied" });
      if (exited > 0) {
        const creds = await pickGhlToken(client);
        if (creds) {
          const rs = await respondedStage(creds.token, creds.locationId);
          const { provider } = await pipelineFlags(clientId).catch(() => ({ provider: "ghl" }));
          if (rs && provider === "portal") {
            // Store: read the open opp + its role; bounce to Responded ONLY from a ghost/
            // nurture stage (same guard, read from the store where the true stage lives).
            const rows = await sb(`opportunities?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(String(ghlContactId))}&status=eq.open&select=id,ghl_opportunity_id,stage_role&limit=1`);
            const opp = Array.isArray(rows) && rows[0];
            if (opp && (opp.stage_role === "ghosted" || opp.stage_role === "nurture")) {
              await moveStage({ clientId, sb, ghl, token: creds.token, oppRef: { id: opp.id, ghlOpportunityId: opp.ghl_opportunity_id }, stage: rs, role: "responded", contactId: String(ghlContactId) });
            }
          } else if (rs) {
            const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: creds.locationId, contact_id: String(ghlContactId), limit: "20" })}`, { token: creds.token });
            const opps = d.opportunities || d.data || [];
            const opp = opps.find((o) => String(o.status || "").toLowerCase() === "open") || null;
            if (opp) {
              const curStageId = opp.pipelineStageId || opp.stageId || null;
              const [is, ns] = await Promise.all([
                ghostedStage(creds.token, creds.locationId).catch(() => null),
                nurtureStage(creds.token, creds.locationId).catch(() => null),
              ]);
              const ghostStageIds = new Set([is && is.stageId, ns && ns.stageId].filter(Boolean));
              if (ghostStageIds.has(curStageId)) {
                await moveStage({ clientId, sb, ghl, token: creds.token, oppRef: { ghlOpportunityId: opp.id }, stage: rs, role: "responded", contactId: String(ghlContactId) });
              }
            }
          }
        }
      }
    } catch (e) { console.error("resend inbound automation-exit:", e.message); }
  }

  return res.status(200).json({ ok: true });
}

export default handler;
