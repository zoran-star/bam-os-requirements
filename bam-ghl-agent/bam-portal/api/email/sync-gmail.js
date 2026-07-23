import { withSentryApiRoute } from "../_sentry.js";
// Email spine (8/n): Gmail INBOUND (and sent-from-Gmail) sync. Poll-based - the
// counterpart of api/resend/inbound-webhook.js for academies whose OWN Google inbox
// is connected (client_mailboxes.provider='gmail'). Runs on a cron; for each active
// mailbox it pulls new messages via the Gmail history cursor, mirrors them into the
// email_threads/email_messages store (both directions, so a reply typed in Gmail
// shows in the portal too), and fires the SAME inbound side-effects the Resend
// webhook does (notify owner, cancel stale agent drafts, exit automation).
//
// NOTE: the inbound side-effects here are DUPLICATED from resend/inbound-webhook.js
// (same deliberate choice as the Twilio spine). Keep them in sync if either changes.
//
// Auth: Bearer CRON_SECRET (the cron) or a staff JWT. Optional ?client_id=<id> to
// sync a single academy (used right after a connect for an instant first pull).
import {
  sb, norm, domainOf, getMailbox, accessTokenForMailbox, flagMailbox,
  gmailGet, gmailProfileHistoryId, parseGmailMessage,
} from "./_mailbox.js";
import { pickGhlToken, ghl } from "../ghl/_core.js";
import { notifyOwners } from "../_notify-owners.js";
import { respondedStage, interestedStage, nurtureStage } from "../agent/_stage.js";
import { markReopened } from "../agent/_reopen.js";
import { moveStage, pipelineFlags } from "../agent/_store.js";
import { exitEnrollment } from "../automations.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const MAX_MSGS_PER_RUN = 40; // cap per mailbox per run so the cron stays inside its time budget

function extractAddr(v) { const m = String(v || "").match(/<([^>]+)>/); return norm(m ? m[1] : v); }

async function verifyStaff(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const u = await r.json();
    if (!u?.id) return false;
    let staff = await sb(`staff?user_id=eq.${u.id}&select=id&limit=1`);
    if ((!staff || !staff[0]) && u.email) staff = await sb(`staff?email=eq.${encodeURIComponent(u.email)}&select=id&limit=1`);
    return !!(staff && staff[0]);
  } catch (_) { return false; }
}

// Resolve the external contact for a message: inbound -> the sender; sent-from-Gmail
// -> the recipient. Returns { contactEmail, ghlContactId, contactName }.
async function resolveContact(clientId, msg) {
  const contactEmail = msg.direction === "inbound" ? extractAddr(msg.from) : extractAddr(msg.to);
  let ghlContactId = null, contactName = null;
  if (contactEmail) {
    try {
      const rows = await sb(`contacts?client_id=eq.${encodeURIComponent(clientId)}&email=eq.${encodeURIComponent(contactEmail)}&select=ghl_contact_id,name,athlete_name&limit=1`);
      if (rows && rows[0]) { ghlContactId = rows[0].ghl_contact_id || null; contactName = rows[0].athlete_name || rows[0].name || null; }
    } catch (_) {}
  }
  return { contactEmail, ghlContactId, contactName };
}

// Store one parsed Gmail message (idempotent on client_id+mailbox_message_id).
// Returns { stored, thread, contact } - stored=false if it was a duplicate/no-contact.
async function storeMessage(clientId, msg) {
  const { contactEmail, ghlContactId, contactName } = await resolveContact(clientId, msg);
  if (!contactEmail) return { stored: false };

  const occurred = msg.internalDate || new Date().toISOString();
  let thread = null;
  try {
    const rows = await sb(`email_threads?on_conflict=client_id,contact_email`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{ client_id: clientId, contact_email: contactEmail, ghl_contact_id: ghlContactId, contact_name: contactName }]),
    });
    thread = Array.isArray(rows) ? rows[0] : null;
  } catch (e) { console.error("gmail sync thread upsert:", e.message); }
  if (!thread) return { stored: false };

  // Idempotent insert: on_conflict does nothing if we've already stored this msg id.
  let inserted = null;
  try {
    inserted = await sb(`email_messages?on_conflict=client_id,mailbox_message_id`, {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify([{
        thread_id: thread.id, client_id: clientId, provider: "gmail", direction: msg.direction,
        channel: "email", subject: msg.subject || null, body: (msg.body || "").slice(0, 20000),
        status: msg.direction === "inbound" ? "received" : "sent",
        mailbox_message_id: msg.id, mailbox_thread_id: msg.threadId || null,
        message_id_header: msg.messageIdHeader, in_reply_to: msg.inReplyTo,
        occurred_at: occurred, raw: null,
      }]),
    });
  } catch (e) { console.error("gmail sync message insert:", e.message); return { stored: false }; }
  const isNew = Array.isArray(inserted) && inserted.length > 0;
  if (!isNew) return { stored: false }; // duplicate - already synced

  // Refresh the thread's last-message summary.
  try {
    const preview = (msg.body || "").slice(0, 160);
    await sb(`email_threads?id=eq.${thread.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        last_message_at: occurred, last_preview: preview, last_subject: msg.subject || null,
        last_direction: msg.direction, unread: msg.direction === "inbound",
        contact_name: thread.contact_name || contactName, updated_at: occurred,
      }),
    });
  } catch (_) {}
  return { stored: true, thread, contact: { contactEmail, ghlContactId, contactName } };
}

// Inbound-only side-effects (mirror of resend/inbound-webhook.js).
async function inboundSideEffects(client, clientId, contact, bodyText) {
  try {
    const snip = (bodyText || "").slice(0, 120);
    notifyOwners(clientId, "inbox_message", `New email in your inbox${snip ? `: "${snip}"` : "."}`).catch(() => {});
  } catch (_) {}
  const ghlContactId = contact.ghlContactId;
  if (!ghlContactId) return;
  const cid = encodeURIComponent(String(ghlContactId));
  const occurred = new Date().toISOString();
  // Lead replied by email -> cancel pending/approved agent drafts.
  try {
    const patch = { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "lead replied (email)", updated_at: occurred }) };
    await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
    await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
    await sb(`agent_confirm_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
    await sb(`agent_closing_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
  } catch (e) { console.error("gmail sync draft-cancel:", e.message); }
  // Replied while in a portal automation -> exit + bounce to Responded (same guard
  // as the SMS/Resend webhooks: only from a ghost/nurture stage).
  try {
    const { exited } = await exitEnrollment({ clientId, contactId: ghlContactId, reason: "replied" });
    if (exited > 0) {
      const creds = await pickGhlToken(client);
      if (creds) {
        const rs = await respondedStage(creds.token, creds.locationId);
        const { provider } = await pipelineFlags(clientId).catch(() => ({ provider: "ghl" }));
        if (rs && provider === "portal") {
          const rows = await sb(`opportunities?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${cid}&status=eq.open&select=id,ghl_opportunity_id,stage_role&limit=1`);
          const opp = Array.isArray(rows) && rows[0];
          if (opp && (opp.stage_role === "ghosted" || opp.stage_role === "interested" || opp.stage_role === "nurture")) {
            await moveStage({ clientId, sb, ghl, token: creds.token, oppRef: { id: opp.id, ghlOpportunityId: opp.ghl_opportunity_id }, stage: rs, role: "responded", contactId: String(ghlContactId) });
            await markReopened({ clientId, sb, oppRef: { id: opp.id, ghlOpportunityId: opp.ghl_opportunity_id } });
          }
        } else if (rs) {
          const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: creds.locationId, contact_id: String(ghlContactId), limit: "20" })}`, { token: creds.token });
          const opps = d.opportunities || d.data || [];
          const opp = opps.find((o) => String(o.status || "").toLowerCase() === "open") || null;
          if (opp) {
            const curStageId = opp.pipelineStageId || opp.stageId || null;
            const [is, ns] = await Promise.all([
              interestedStage(creds.token, creds.locationId).catch(() => null),
              nurtureStage(creds.token, creds.locationId).catch(() => null),
            ]);
            const ghostStageIds = new Set([is && is.stageId, ns && ns.stageId].filter(Boolean));
            if (ghostStageIds.has(curStageId)) {
              await moveStage({ clientId, sb, ghl, token: creds.token, oppRef: { ghlOpportunityId: opp.id }, stage: rs, role: "responded", contactId: String(ghlContactId) });
              await markReopened({ clientId, sb, oppRef: { ghlOpportunityId: opp.id } });
            }
          }
        }
      }
    }
  } catch (e) { console.error("gmail sync automation-exit:", e.message); }
}

// Collect the message ids to process for this mailbox. Uses the history cursor when
// present; on a missing/expired cursor (404) it (re)sets the baseline and backfills
// the most recent messages so we never silently miss a window.
async function collectMessageIds(accessToken, mailbox) {
  const startId = mailbox.history_id;
  if (startId) {
    try {
      const ids = new Set();
      let pageToken = null, newHistoryId = startId, pages = 0;
      do {
        const qs = new URLSearchParams({ startHistoryId: startId, historyTypes: "messageAdded" });
        if (pageToken) qs.set("pageToken", pageToken);
        const h = await gmailGet(accessToken, `/history?${qs}`);
        newHistoryId = h.historyId || newHistoryId;
        for (const rec of h.history || []) for (const m of rec.messagesAdded || []) if (m.message && m.message.id) ids.add(m.message.id);
        pageToken = h.nextPageToken || null;
      } while (pageToken && ++pages < 5 && ids.size < MAX_MSGS_PER_RUN);
      return { ids: [...ids].slice(0, MAX_MSGS_PER_RUN), newHistoryId };
    } catch (e) {
      if (e.status !== 404) throw e; // 404 = cursor expired -> fall through to backfill
    }
  }
  // Baseline / backfill: newest INBOX+SENT messages, and set the cursor to now.
  const list = await gmailGet(accessToken, `/messages?${new URLSearchParams({ q: "in:inbox OR in:sent newer_than:2d", maxResults: String(MAX_MSGS_PER_RUN) })}`);
  const ids = (list.messages || []).map((m) => m.id);
  const newHistoryId = await gmailProfileHistoryId(accessToken).catch(() => null);
  return { ids, newHistoryId };
}

async function syncMailbox(clientId) {
  const mailbox = await getMailbox(clientId);
  if (!mailbox || mailbox.provider !== "gmail" || mailbox.status !== "active") return { clientId, skipped: mailbox ? mailbox.status : "no_mailbox" };

  let accessToken;
  try { accessToken = await accessTokenForMailbox(mailbox); }
  catch (e) { await flagMailbox(clientId, "needs_reconnect", e.message); return { clientId, error: "reconnect", detail: e.message }; }

  const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`).catch(() => null);
  const client = clientRows && clientRows[0];
  const selfAddr = norm(mailbox.email);

  let processed = 0, storedInbound = 0, storedOutbound = 0, newHistoryId = mailbox.history_id;
  try {
    const collected = await collectMessageIds(accessToken, mailbox);
    newHistoryId = collected.newHistoryId || newHistoryId;
    for (const id of collected.ids) {
      let full;
      try { full = await gmailGet(accessToken, `/messages/${encodeURIComponent(id)}?format=full`); }
      catch (_) { continue; }
      const msg = parseGmailMessage(full);
      // Skip mail the academy sent to ITSELF or with no counterparty resolvable.
      const other = msg.direction === "inbound" ? extractAddr(msg.from) : extractAddr(msg.to);
      if (!other || other === selfAddr) continue;
      const r = await storeMessage(clientId, msg);
      processed++;
      if (!r.stored) continue;
      if (msg.direction === "inbound") { storedInbound++; await inboundSideEffects(client, clientId, r.contact, msg.body); }
      else storedOutbound++;
    }
  } catch (e) {
    await flagMailbox(clientId, "error", e.message);
    return { clientId, error: e.message };
  }

  // Advance the cursor + stamp the sync time (keep status active).
  try {
    await sb(`client_mailboxes?client_id=eq.${encodeURIComponent(clientId)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ history_id: newHistoryId, last_synced_at: new Date().toISOString(), status: "active", last_error: null, updated_at: new Date().toISOString() }),
    });
  } catch (_) {}
  return { clientId, processed, storedInbound, storedOutbound };
}

async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const isCron = CRON_SECRET && auth === `Bearer ${CRON_SECRET}`;
  if (!isCron && !(await verifyStaff(req))) return res.status(401).json({ error: "unauthorized" });

  const single = req.query.client_id;
  let targets;
  if (single) targets = [single];
  else {
    const rows = await sb(`client_mailboxes?provider=eq.gmail&status=eq.active&select=client_id`).catch(() => []);
    targets = (rows || []).map((r) => r.client_id);
  }

  const results = [];
  for (const clientId of targets) {
    try { results.push(await syncMailbox(clientId)); }
    catch (e) { results.push({ clientId, error: e.message }); }
  }
  return res.status(200).json({ ok: true, count: results.length, results });
}

export default withSentryApiRoute(handler);
