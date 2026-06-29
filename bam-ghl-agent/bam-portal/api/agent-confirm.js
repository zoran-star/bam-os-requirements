import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Confirm Agent queue (Scheduled-Trial stage)
//
// The SECOND sales agent. It works leads the booking agent already booked — the
// Training pipeline's "Scheduled Trial" / "Booked Trial" stage. Its job:
//   1. confirm they're still coming to their booked trial,
//   2. help them get there (address, directions, what to bring — from the academy
//      config), and
//   3. if they truly can't make it, HAND OFF to the booking agent to rebook (it
//      does NOT rebook itself): write a context note + bounce the opportunity back
//      to the Responded stage, where the booking agent picks it up with full context.
//
//   POST /api/agent-confirm  { action, ... }  (staff/owner bearer required)
//     "list"            → Scheduled-Trial-stage contacts (the confirm queue)
//     "draft"           { contact_id }         → the agent's proposed next message
//     "send"            { contact_id, reply, ... } → send a human-approved confirm reply
//     "list-ready"      → pending/approved confirm cards for the inbox
//     "skip-ready"      { ready_id }
//     "detect-now"      → run the detector for THIS academy now
//     "confirm-handoff" { ready_id | contact_id, ... } → note + bounce to Responded
//     "confirm-lost"    { ready_id | contact_id, ... } → mark the opportunity Lost
//   GET  ?action=detect  (Bearer CRON_SECRET) → the confirm detector cron
//
// Gated behind clients.ghl_kpi_config.confirm_agent_mode (default 'off') so turning
// on the booking agent never silently starts texting already-booked leads. Every
// send is human-approved in Hawkeye; self-drive auto-sends only high-confidence
// plain confirmations (handoff + lost ALWAYS wait for a human ✓).

import { pickGhlToken, ghl, sendSms } from "./ghl/_core.js";
import { maybeSendSmsViaProvider } from "./messaging/provider.js";
import { buildAgentSystem } from "./agent/brain.js";
import { loadMergedOverrides } from "./agent/_sections.js";
import { loadContactMemory } from "./agent/contact-memory.js";
import { nextAppointment } from "./agent/booking.js";
import {
  scheduledTrialStage, contactInRespondedStage, computeConfirmQueue,
  scheduledTrialContactIdSetCached, peekScheduledTrialIdSet, respondedStage, nurtureStage, toIso,
} from "./agent/_stage.js";
import { enrollContact, isAutomationLive, resolveContactInfo } from "./automations.js";
import {
  DEFAULT_CONFIRM_AUTOMATIONS, getConfirmAutomations, automationsLive,
  nextDueStep, resolveApptTokens, addressFromOverrides,
} from "./agent/confirm-automations.js";
import { sendOn } from "./_send.js";
import { resolveMergeVars, locFor } from "./email-shells.js";
import { confirmAgentMode, modeIsOn, shouldAutoSend } from "./agent/_mode.js";
import { mutedContactIdSet, isMuted } from "./agent/_mutes.js";
import { withinQuietHours, nextSendableTime } from "./agent/_quiet.js";
import { resolveAgentActor } from "./agent/_auth.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";
const DEFAULT_CLIENT_ID    = "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA
const DETECT_CAP           = 10;   // max confirm cards drafted per academy per run
const TZ                   = "America/Toronto";
// Proactive opener window: only reach out first when the booked trial is within
// this many days (and not already passed) — sooner than that is redundant with the
// booking chat that just happened. Reactive replies (they message us) are unbounded.
const PROACTIVE_WINDOW_DAYS = 3;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
  return Array.isArray(rows) && rows[0];
}

// The confirm agent uses the same per-academy SECTION overrides (agent_prompt_sections,
// keyed by section_key — confirm_* keys apply, booking keys are ignored by the confirm
// assembly) PLUS the confirm agent's OWN lessons (agent='confirm') - never the
// booking agent's lessons/examples (those are booking-flavored and would bleed the
// wrong behavior into a confirmation chat).
async function loadConfig(clientId) {
  const [overrides, lessonRows] = await Promise.all([
    loadMergedOverrides(clientId),   // global brain (general/goal) + this academy's own (location/offer)
    sb(`agent_lessons?client_id=eq.${clientId}&agent=eq.confirm&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
  ]);
  return { lessons: Array.isArray(lessonRows) ? lessonRows : [], overrides, examples: [] };
}

const CONFIRM_TRAILER =
  `<live_confirm>\n` +
  `You are drafting the next SMS to a REAL lead who has ALREADY booked a free trial and is in the "Scheduled Trial" stage. Your goal is to make sure they SHOW UP — confirm they're still coming and help them get there. You do NOT sell and you do NOT rebook. A human reviews your draft before it sends. ` +
  `Respond ONLY by calling propose_reply: 'reply' = the exact text to send; 'reasoning' = 1-2 sentence why; 'confidence' = 0..1; ` +
  `'escalate' = true (with 'escalate_reason', reply empty) if your guardrails say to hand to a human. ` +
  `If the lead CAN'T make their booked time / needs to reschedule, set 'recommend_handoff' = true with a clear 'handoff_note' capturing the dropped slot + any reason or constraint they gave (this note is what the booking assistant reads to rebook them) — do NOT propose new times yourself; put a warm acknowledgement in 'reply'. ` +
  `If your confirm_lost criteria say the lead no longer wants the trial at all, set 'recommend_lost' = true with a short 'lost_reason' and put your warm closing message in 'reply'. A human confirms handoff/lost before anything changes.\n</live_confirm>`;
function buildSystem({ lessons, overrides, examples }) {
  return buildAgentSystem({ lessons, overrides, examples, trailer: CONFIRM_TRAILER, agent: "confirm" });
}

const REPLY_TOOL = {
  name: "propose_reply",
  description: "Propose the confirm agent's next text to the lead (a human approves before it sends).",
  input_schema: {
    type: "object",
    properties: {
      reply:             { type: "string", description: "The exact text to send. Empty if escalating." },
      summary:           { type: "string", description: "A 2-3 sentence plain-English summary for a human reviewer — who the lead is, their booked trial, and where things stand." },
      reasoning:         { type: "string", description: "Short (1-2 sentences) why / current state." },
      confidence:        { type: "number", description: "0..1 confidence this is the right message." },
      escalate:          { type: "boolean", description: "True if guardrails say to hand to a human instead of replying." },
      escalate_reason:   { type: "string", description: "If escalate: why." },
      recommend_handoff: { type: "boolean", description: "True if the lead can't make their booked time and should be handed BACK to the booking assistant to rebook (do NOT rebook yourself)." },
      handoff_note:      { type: "string", description: "If recommend_handoff: the context the booking assistant needs — which slot they're dropping (day/time) and any reason/constraint they gave. If they gave no reason, say so." },
      recommend_lost:    { type: "boolean", description: "True only if the lead no longer wants the trial AT ALL (not just this time) — a human confirms before anything changes." },
      lost_reason:       { type: "string", description: "If recommend_lost: closest taxonomy reason (Too expensive / Not enough time / Started other programs / Not locked in / Bad fit / Invalid lead / Opted out / Other)." },
    },
    required: ["reply", "reasoning", "confidence", "escalate"],
  },
};

async function anthropicCall(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

// The confirm agent's draft turn. No booking tools — a single forced propose_reply.
// `seed` (for a PROACTIVE opener, when the lead hasn't messaged) is appended as the
// final user turn so the model has the full booking thread for context plus a clear
// instruction to open the confirmation.
async function runConfirmAgent(system, messages, { seed = null } = {}) {
  let convo = messages
    .filter(m => m && typeof m.text === "string" && m.text.trim() !== "")
    .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text }));
  if (seed) {
    convo.push({ role: "user", content: seed });
  } else {
    while (convo.length && convo[convo.length - 1].role === "assistant") convo.pop();
    if (!convo.length) throw new Error("no inbound message to reply to");
  }
  while (convo.length && convo[0].role === "assistant") convo.shift();  // first turn must be user
  if (!convo.length) throw new Error("empty conversation");

  const data = await anthropicCall({
    model: ANTHROPIC_MODEL, max_tokens: 768, system, tools: [REPLY_TOOL],
    tool_choice: { type: "tool", name: "propose_reply" }, messages: convo,
  });
  const reply = (data.content || []).find(b => b.type === "tool_use" && b.name === "propose_reply");
  if (reply?.input) return reply.input;
  throw new Error("no structured reply from Claude");
}

// ── GHL thread helpers (same shape as the booking agent) ──
async function findConversation(token, locationId, contactId) {
  const params = new URLSearchParams({ locationId, contactId });
  const search = await ghl("GET", `/conversations/search?${params}`, { token });
  return (search.conversations || search.data || [])[0] || null;
}
async function threadMessages(token, conversationId) {
  const data = await ghl("GET", `/conversations/${encodeURIComponent(conversationId)}/messages`, { token });
  const raw = data.messages?.messages || data.messages || data.data || [];
  const msgs = raw.map(m => ({
    text: m.body || m.message || "",
    direction: (m.direction || "").toLowerCase(),
    date: m.dateAdded || m.createdAt || m.timestamp || null,
  })).filter(m => m.text);
  msgs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  return msgs.map(m => ({ role: m.direction === "outbound" ? "agent" : "parent", text: m.text, date: m.date }));
}

// "Sat, Jun 28 at 11:30 AM" in the academy timezone.
function fmtTrial(iso) {
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (_) { return iso; }
}

// Draft the confirm agent's next message for one Scheduled-Trial-stage contact.
// Returns the structured proposal, or { error } / { skip } (skip = nothing to do
// right now, e.g. a proactive opener whose trial isn't near yet). `opts`:
//   { sts, conversationId, skipStageGuard, lastDirection, nowMs }
async function draftForContact(token, locationId, clientId, contactId, cfg, opts = {}) {
  const sts = opts.sts || await scheduledTrialStage(token, locationId);
  if (!sts) return { error: "No Scheduled-Trial stage found in the Training Pipeline." };
  if (!opts.skipStageGuard && !(await contactInRespondedStage(token, locationId, contactId, sts))) {
    return { error: "This lead isn't in the Scheduled-Trial stage — the confirm agent only works booked leads." };
  }
  let conversationId = opts.conversationId;
  if (!conversationId) {
    const convo = await findConversation(token, locationId, contactId);
    if (!convo) return { error: "no conversation for contact" };
    conversationId = convo.id;
  }
  const messages = await threadMessages(token, conversationId);
  const nowMs = opts.nowMs || Date.now();
  const appt = await nextAppointment(token, contactId, { nowMs });

  const lastIsInbound = opts.lastDirection
    ? opts.lastDirection === "inbound"
    : (messages.length > 0 && messages[messages.length - 1].role === "parent");

  // PROACTIVE opener gating: if the lead hasn't messaged, only open when the booked
  // trial is real and within the window (else there's nothing useful to send yet).
  let seed = null;
  if (!lastIsInbound) {
    if (!appt) return { skip: "no upcoming appointment to confirm" };
    const dMs = new Date(appt.startTime).getTime() - nowMs;
    if (!(dMs > 0 && dMs <= PROACTIVE_WINDOW_DAYS * 86400000)) return { skip: "trial not in proactive window yet" };
    seed = `[No new message from the lead. Their free trial is booked for ${fmtTrial(appt.startTime)}. Send a short, friendly opening text to confirm they're still planning to come.]`;
  }

  const apptBlock = appt
    ? `\n\n<booked_trial>\nThis lead's booked trial (confirm THIS slot — never invent one): ${fmtTrial(appt.startTime)}. If they ask to change it, that's a handoff, not a reschedule you make yourself.\n</booked_trial>`
    : `\n\n<booked_trial>\nWe don't have the exact booked time on hand. Refer to "your booked trial" and, if you need the specifics, ask them to confirm the day and time.\n</booked_trial>`;

  const system = buildSystem(cfg) + await loadContactMemory(sb, clientId, contactId, { ghl, token, locationId }) + apptBlock;

  let out;
  try { out = await runConfirmAgent(system, messages, { seed }); }
  catch (e) { return { error: e.message }; }

  const agentMsgs = messages.filter(m => m.role === "agent");
  return {
    conversation_id: conversationId,
    reply: out.reply || "",
    reasoning: out.reasoning || "",
    confidence: typeof out.confidence === "number" ? out.confidence : null,
    escalate: !!out.escalate,
    escalate_reason: out.escalate_reason || null,
    recommend_handoff: !!out.recommend_handoff,
    handoff_note: out.handoff_note || null,
    recommend_lost: !!out.recommend_lost,
    lost_reason: out.lost_reason || null,
    trial_at: appt ? toIso(appt.startTime) : null,
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    last_message: (() => { const lead = [...messages].reverse().find(m => m.role === "parent"); return lead ? String(lead.text).slice(0, 500) : null; })(),
    last_outbound: (() => { const ours = [...messages].reverse().find(m => m.role === "agent"); return ours ? String(ours.text).slice(0, 500) : null; })(),
    thread_tail: messages.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "lead", text: String(m.text).slice(0, 320), at: toIso(m.date) })),
    reply_count: agentMsgs.length,
  };
}

async function sendReplyViaGhl(token, contactId, reply, clientId) {
  if (clientId) {
    const g = await maybeSendSmsViaProvider(clientId, { ghlContactId: contactId, body: String(reply), sentBy: "confirm-agent" });
    if (g.handled) { if (!g.ok) throw new Error(g.error); return; }
  }
  await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId, message: String(reply) } });
}

// Append to the shared audit log (agent_approvals). Non-fatal.
async function logApproval(row) {
  try { await sb(`agent_approvals`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) }); } catch (_) {}
}

// Persist only the safe, editable slice of a confirm-automations override:
// per-step enabled + template (known step keys only), sequence enabled, and the
// approve flag. Timing ('when') is fixed to the shipped steps and never client-set.
function sanitizeAutomations(incoming, cur = {}) {
  const defByKey = new Map(DEFAULT_CONFIRM_AUTOMATIONS.steps.map(s => [s.key, s]));
  const inSteps = Array.isArray(incoming.steps) ? incoming.steps : [];
  const steps = [];
  for (const s of inSteps) {
    if (!s || !defByKey.has(s.key)) continue;
    const def = defByKey.get(s.key);
    steps.push({
      key: s.key,
      enabled: typeof s.enabled === "boolean" ? s.enabled : def.enabled,
      template: typeof s.template === "string" ? s.template.slice(0, 800) : def.template,
    });
  }
  return {
    enabled: typeof incoming.enabled === "boolean" ? incoming.enabled
      : (typeof cur.enabled === "boolean" ? cur.enabled : DEFAULT_CONFIRM_AUTOMATIONS.enabled),
    approved: incoming.approved === true,
    steps: steps.length ? steps : (Array.isArray(cur.steps) ? cur.steps : []),
  };
}

// Fire (or queue) the next due SCRIPTED initial-automation step for one proactive
// Scheduled-Trial lead. Returns a short status string for the run summary. The
// moment a lead replies they become "reactive" and the AI confirm agent owns the
// thread, so scripted touches stop. Mirrors the AI path's mode/quiet-hours handling.
async function fireScriptedStep({ client, token, locationId, mode, autos, cfg, item, contactId }) {
  const nowMs = Date.now();

  // What's already happened with this contact?
  let rows = [];
  try {
    rows = await sb(`agent_confirm_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=kind,status,step_key&order=created_at.desc&limit=50`);
  } catch (_) { rows = []; }
  rows = Array.isArray(rows) ? rows : [];
  if (rows.some(r => ["pending", "approved"].includes(r.status))) return "already has an active card";
  // Any AI confirm/handoff/lost card means they've been in a live exchange - let the
  // AI agent own it; don't cold-script on top of a conversation.
  if (rows.some(r => ["confirm", "confirm_handoff", "confirm_lost"].includes(r.kind))) return "lead already in conversation";
  const sentKeys = new Set(rows.filter(r => r.kind === "confirm_auto" && ["pending", "approved", "sent", "skipped"].includes(r.status)).map(r => r.step_key));

  const appt = await nextAppointment(token, contactId, { nowMs });
  const trialMs = appt && appt.startTime ? new Date(appt.startTime).getTime() : null;
  const step = nextDueStep(autos, { nowMs, trialMs, sentKeys });
  if (!step) return "no scripted step due";

  // Resolve EVERYTHING ourselves now (portal-native): appointment tokens here, then
  // the contact/location tokens via the send engine's resolver — so the stored card
  // is final text (clean in the approval inbox, and quiet-hours flush can send it raw).
  const info = await resolveContactInfo(token, contactId).catch(() => ({ email: null, phone: null, firstName: null, fullName: null }));
  const vars = { first_name: info.firstName, full_name: info.fullName };
  const apptCtx = {
    startMs: trialMs,
    endMs: appt && appt.endTime ? new Date(appt.endTime).getTime() : null,
    location: (appt && appt.address) || addressFromOverrides(cfg && cfg.overrides) || "",
    title: (appt && appt.title) || "Free Trial",
  };
  const resolve = (tpl) => resolveMergeVars(resolveApptTokens(tpl, apptCtx), locFor(client.id), vars);
  const message = resolve(step.template);
  if (!message || !message.trim()) return "rendered template empty";

  const wantsEmail = !!step.email && !!info.email;
  const emailBody = wantsEmail ? message : null;
  const emailSubject = wantsEmail ? resolveMergeVars(step.email_subject || "Your free trial is booked!", locFor(client.id), vars) : null;
  // Fire the confirmation email (rides the same touch). Tokens already resolved, so
  // vars is empty here. Non-fatal: a failed email never blocks the SMS.
  const sendScriptedEmail = async () => {
    if (!wantsEmail) return;
    try { await sendOn({ channel: "email", clientId: client.id, toEmail: info.email, subject: emailSubject, body: emailBody, vars: {} }); } catch (_) {}
  };

  const baseRow = {
    client_id: client.id, ghl_contact_id: String(contactId), contact_name: item.name || null,
    kind: "confirm_auto", step_key: step.key, draft_message: message, confidence: 1,
    email_subject: emailSubject, email_body: emailBody,
    trial_at: trialMs ? toIso(appt.startTime) : null, last_lead_at: item.last_at || null,
    reasoning: `Scripted initial automation: ${step.label}`,
  };

  const auto = shouldAutoSend(mode, { confidence: 1, escalate: false });
  if (auto && !withinQuietHours()) {
    // After-hours: hold the SMS until morning; the email isn't quiet-gated, send it now.
    await sendScriptedEmail();
    await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      ...baseRow, status: "approved", send_after: nextSendableTime().toISOString(), created_by: "self-drive",
    }]) });
    return "deferred";
  }
  if (auto) {
    await sendReplyViaGhl(token, contactId, message, client.id);
    await sendScriptedEmail();
    await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      ...baseRow, status: "sent", auto_sent: true, sent_at: new Date().toISOString(), created_by: "self-drive",
    }]) });
    await logApproval({ client_id: client.id, ghl_contact_id: contactId, contact_name: item.name || null, final_reply: message, reasoning: baseRow.reasoning, confidence: 1, adjusted: false, status: "sent", created_by: "confirm-auto" });
    return "sent";
  }
  // Hawkeye: queue the SMS for a one-tap ✓; the email goes out WITH it on approval.
  await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
    ...baseRow, status: "pending", created_by: "detector",
  }]) });
  return "queued";
}

// Find a contact's open opportunity (for stage moves + outcome logging).
async function findOpenOpp(token, locationId, contactId) {
  const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: locationId, contact_id: contactId, limit: "20" })}`, { token });
  const opps = d.opportunities || d.data || [];
  return (opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0] || null)?.id || null;
}

// Cancel a contact's open confirm cards (after handoff / lost / leaving the stage).
async function clearConfirmCards(clientId, contactId, reason) {
  try {
    await sb(`agent_confirm_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: reason, updated_at: new Date().toISOString() }) });
  } catch (_) {}
}

// ── Detector: draft confirmations for Scheduled-Trial leads ──
async function detectForClient(client) {
  const mode = confirmAgentMode(client);
  if (!modeIsOn(mode)) return { client_id: client.id, skipped: "confirm mode off" };
  const creds = await pickGhlToken(client);
  if (!creds) return { client_id: client.id, skipped: "no GHL token" };
  const { token, locationId } = creds;

  let sts, queue, scheduledIds;
  try { ({ sts, queue, scheduledIds } = await computeConfirmQueue(token, locationId)); }
  catch (e) { return { client_id: client.id, error: `queue: ${e.message}` }; }
  if (!sts) return { client_id: client.id, skipped: "no Scheduled-Trial stage" };

  // Prune: cancel pending confirm cards whose lead has LEFT the Scheduled-Trial
  // stage (showed up, handed off, lost…). Scoped to THIS agent's table only.
  let pruned = 0;
  try {
    const pend = await sb(`agent_confirm_replies?client_id=eq.${client.id}&status=eq.pending&select=id,ghl_contact_id`);
    for (const row of (Array.isArray(pend) ? pend : [])) {
      if (row.ghl_contact_id && !scheduledIds.has(row.ghl_contact_id)) {
        await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Scheduled-Trial stage", updated_at: new Date().toISOString() }) });
        pruned++;
      }
    }
  } catch (_) {}

  // Flush quiet-hours holds (approved confirm cards whose send time arrived).
  let flushed = 0;
  if (withinQuietHours()) {
    try {
      const held = await sb(`agent_confirm_replies?client_id=eq.${client.id}&status=eq.approved&send_after=lte.${new Date().toISOString()}&select=id,ghl_contact_id,draft_message&order=send_after.asc&limit=40`);
      for (const row of (Array.isArray(held) ? held : [])) {
        if (row.ghl_contact_id && !scheduledIds.has(row.ghl_contact_id)) {
          await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Scheduled-Trial stage", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (!row.draft_message || !String(row.draft_message).trim()) continue;
        try {
          await sendReplyViaGhl(token, row.ghl_contact_id, row.draft_message, client.id);
          await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", auto_sent: true, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
          flushed++;
        } catch (_) {}
      }
    } catch (_) {}
  }

  const cfg = await loadConfig(client.id);
  const autos = getConfirmAutomations(client);
  const scriptedLive = automationsLive(autos);
  const mutedSet = await mutedContactIdSet(client.id, "confirm");
  let drafted = 0, autoSent = 0, skipped = 0, escalated = 0, handoffs = 0, lostProposed = 0, deferred = 0;
  const reasons = [];
  let _first = true;
  for (const item of queue.slice(0, DETECT_CAP)) {
    if (!_first) await new Promise(r => setTimeout(r, 300));
    _first = false;
    const contactId = item.contact_id;
    if (!contactId) { skipped++; reasons.push(`${item.name || "?"}: no contactId`); continue; }
    if (mutedSet.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: bot muted on this lead`); continue; }

    const reactive = item.last_direction === "inbound";

    // SCRIPTED INITIAL AUTOMATIONS (proactive only). When the academy's sequence is
    // live + approved, the timed scripted touches OWN the proactive path (they
    // replace the AI opener). The instant the lead replies (reactive) the AI confirm
    // agent takes over below.
    if (!reactive && scriptedLive) {
      try {
        const r = await fireScriptedStep({ client, token, locationId, mode, autos, cfg, item, contactId });
        if (r === "sent") autoSent++;
        else if (r === "deferred") deferred++;
        else if (r === "queued") drafted++;
        else { skipped++; reasons.push(`${item.name || contactId}: ${r}`); }
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: scripted - ${e.message}`); }
      continue;
    }

    try {
      // Dedupe. Reactive: skip if an active card exists or we already answered this
      // inbound. Proactive: skip if ANY confirm card already exists (we've engaged).
      const existing = await sb(`agent_confirm_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&order=created_at.desc&select=id,status,last_lead_at&limit=1`);
      const last = Array.isArray(existing) && existing[0];
      if (last && ["pending", "approved"].includes(last.status)) { skipped++; reasons.push(`${item.name || contactId}: already has a ${last.status} card`); continue; }
      if (reactive && last && last.last_lead_at && item.last_at && new Date(last.last_lead_at).getTime() === new Date(item.last_at).getTime()) { skipped++; reasons.push(`${item.name || contactId}: already answered this inbound`); continue; }
      if (!reactive && last) { skipped++; reasons.push(`${item.name || contactId}: already opened a confirmation`); continue; }
    } catch (e) { reasons.push(`${item.name || contactId}: dedup error — ${e.message}`); }

    let d;
    try { d = await draftForContact(token, locationId, client.id, contactId, cfg, { sts, conversationId: item.conversation_id, skipStageGuard: true, lastDirection: item.last_direction }); }
    catch (e) { skipped++; reasons.push(`${item.name || contactId}: draft threw — ${e.message}`); continue; }
    if (d.skip) { skipped++; reasons.push(`${item.name || contactId}: ${d.skip}`); continue; }

    const baseRow = {
      client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
      contact_name: item.name || null, reasoning: d.reasoning || null, confidence: d.confidence,
      trial_at: d.trial_at || null, last_message: d.last_message || null, last_outbound: d.last_outbound || null,
      summary: d.summary || null, thread_tail: d.thread_tail || null, reply_count: d.reply_count,
      last_lead_at: item.last_at || null,
    };

    // Handoff: lead can't make it → ALWAYS queue for a human (note + bounce on ✓).
    if (d.recommend_handoff) {
      try {
        await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "confirm_handoff", handoff_note: d.handoff_note || null,
          draft_message: (d.reply && String(d.reply).trim()) ? d.reply : "", status: "pending", created_by: "detector",
        }]) });
        handoffs++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: handoff-insert failed — ${e.message}`); }
      continue;
    }

    // Lost: lead no longer wants the trial at all → ALWAYS queue for a human.
    if (d.recommend_lost) {
      try {
        await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "confirm_lost", lost_reason: d.lost_reason || "Other",
          draft_message: (d.reply && String(d.reply).trim()) ? d.reply : "", status: "pending", created_by: "detector",
        }]) });
        lostProposed++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: lost-insert failed — ${e.message}`); }
      continue;
    }

    // Escalation: no message to send, but a human should see it.
    if (d.error || !d.reply || !String(d.reply).trim()) {
      if (d.escalate) {
        escalated++;
        try {
          await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            ...baseRow, kind: "confirm", draft_message: "(agent escalated — needs a human)",
            escalate: true, escalate_reason: d.escalate_reason || null, status: "pending", created_by: "detector",
          }]) });
        } catch (_) {}
      } else { skipped++; reasons.push(`${item.name || contactId}: ${d.error || "empty reply"}`); }
      continue;
    }

    // A plain confirmation reply. Self-drive may auto-send high-confidence ones;
    // quiet hours hold until morning. Everything else queues for approval.
    const auto = shouldAutoSend(mode, { confidence: d.confidence, escalate: d.escalate });
    if (auto && !withinQuietHours()) {
      try {
        await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "confirm", draft_message: d.reply, status: "approved", send_after: nextSendableTime().toISOString(), created_by: "self-drive",
        }]) });
        deferred++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: defer-insert failed — ${e.message}`); }
    } else if (auto) {
      try {
        await sendReplyViaGhl(token, contactId, d.reply);
        await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "confirm", draft_message: d.reply, status: "sent", auto_sent: true, sent_at: new Date().toISOString(), created_by: "self-drive",
        }]) });
        await logApproval({ client_id: client.id, ghl_contact_id: contactId, ghl_conversation_id: d.conversation_id || null, contact_name: item.name || null, final_reply: d.reply, reasoning: d.reasoning || null, confidence: d.confidence, adjusted: false, status: "sent", created_by: "confirm-self-drive" });
        autoSent++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: auto-send failed — ${e.message}`); }
    } else {
      try {
        await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "confirm", draft_message: d.reply, status: "pending", created_by: "detector",
        }]) });
        drafted++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: pending-insert failed — ${e.message}`); }
    }
  }
  return { client_id: client.id, business: client.business_name, mode, queued: queue.length, drafted, handoffs, lost_proposed: lostProposed, auto_sent: autoSent, deferred, flushed, escalated, skipped, pruned, reasons };
}

async function runDetect(res, onlyClientId) {
  let clients = [];
  try {
    clients = onlyClientId
      ? [await loadClient(onlyClientId)].filter(Boolean)
      : await sb(`clients?select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&v2_access=eq.true`);
  } catch (_) {}
  const out = [];
  for (const client of (Array.isArray(clients) ? clients : [])) {
    try { out.push(await detectForClient(client)); }
    catch (e) { out.push({ client_id: client.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, academies: out });
}

async function handler(req, res) {
  // Cron: the confirm detector (drafts confirmations for Scheduled-Trial leads).
  if (req.method === "GET" && req.query.action === "detect") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return await runDetect(res, null);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const actor = await resolveAgentActor(req);
  if (!actor) return res.status(401).json({ error: "sign in required" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const clientId = b.client_id || DEFAULT_CLIENT_ID;
  if (!actor.canActOn(clientId)) return res.status(403).json({ error: "not your academy" });
  const staffEmail = actor.email;

  // Supabase-only reads first (cheap — no GHL token fetch).
  try {
    if (b.action === "list-ready") {
      const rows = await sb(`agent_confirm_replies?client_id=eq.${clientId}&status=in.(pending,approved)&select=*&order=created_at.desc&limit=100`);
      let list = Array.isArray(rows) ? rows : [];
      // Read-time stage gate: hide cards whose contact left Scheduled-Trial. Fail
      // OPEN if GHL is unreachable or there's no such stage.
      try {
        const client = await loadClient(clientId);
        const loc = client && client.ghl_location_id;
        let ids = loc ? peekScheduledTrialIdSet(loc) : undefined;
        if (ids === undefined && loc) {
          const creds = await pickGhlToken(client);
          if (creds) ids = await scheduledTrialContactIdSetCached(creds.token, loc);
        }
        if (ids) list = list.filter(r => !r.ghl_contact_id || ids.has(r.ghl_contact_id));
      } catch (_) { /* fail open */ }
      return res.status(200).json({ ready: list, count: list.length });
    }
    if (b.action === "skip-ready") {
      if (!b.ready_id) return res.status(400).json({ error: "ready_id required" });
      await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped", updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }

    // Initial-automations editor (the scripted first-touch sequence) — read.
    if (b.action === "automations-get") {
      const client = await loadClient(clientId);
      if (!client) return res.status(404).json({ error: "academy not found" });
      return res.status(200).json({ automations: getConfirmAutomations(client), mode: confirmAgentMode(client) });
    }
    // Initial-automations editor — save (per-step enabled + copy, sequence enable,
    // approve toggle). Timing is fixed; copy never contains an em dash.
    if (b.action === "automations-set") {
      const client = await loadClient(clientId);
      if (!client) return res.status(404).json({ error: "academy not found" });
      const cur = (client.ghl_kpi_config && client.ghl_kpi_config.confirm_initial_automations) || {};
      const merged = sanitizeAutomations(b.automations && typeof b.automations === "object" ? b.automations : {}, cur);
      const cfg = { ...(client.ghl_kpi_config || {}), confirm_initial_automations: merged };
      try {
        await sb(`clients?id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: cfg }) });
      } catch (e) { return res.status(500).json({ error: `couldn't save: ${e.message}` }); }
      return res.status(200).json({ ok: true, automations: getConfirmAutomations({ ghl_kpi_config: cfg }) });
    }
  } catch (e) {
    console.error("[agent-confirm]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }

  if (b.action === "detect-now") {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return await runDetect(res, clientId);
  }

  if (!ANTHROPIC_KEY && b.action === "draft") return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const client = await loadClient(clientId);
  if (!client) return res.status(404).json({ error: "academy not found" });
  const creds = await pickGhlToken(client);
  if (!creds) return res.status(400).json({ error: "academy not connected to GHL" });
  const { token, locationId } = creds;

  try {
    if (b.action === "list") {
      const { queue } = await computeConfirmQueue(token, locationId);
      return res.status(200).json({ queue, count: queue.length });
    }

    if (b.action === "draft") {
      if (!b.contact_id) return res.status(400).json({ error: "contact_id required" });
      if (await isMuted(clientId, b.contact_id, "confirm")) return res.status(200).json({ error: "muted", muted: true });
      const cfg = await loadConfig(clientId);
      const d = await draftForContact(token, locationId, clientId, b.contact_id, cfg);
      if (d.error) return res.status(200).json({ error: d.error });
      if (d.skip) return res.status(200).json({ skip: d.skip });
      return res.status(200).json(d);
    }

    if (b.action === "send") {
      if (!b.contact_id || !b.reply || !String(b.reply).trim()) return res.status(400).json({ error: "contact_id and reply required" });
      // HARD GUARD: only send to a lead still in the Scheduled-Trial stage.
      const sts = await scheduledTrialStage(token, locationId);
      if (!sts || !(await contactInRespondedStage(token, locationId, b.contact_id, sts))) {
        return res.status(409).json({ error: "This lead is no longer in the Scheduled-Trial stage — not sending." });
      }
      // For a scripted initial-automation card, the booking-confirmation step also
      // emails (same copy). Pull that payload so approving the touch sends both.
      let card = null;
      if (b.ready_id) { try { [card] = await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`); } catch (_) {} }
      const fireCardEmail = async () => {
        if (!card || !card.email_body) return;
        try {
          const info = await resolveContactInfo(token, b.contact_id);
          if (info && info.email) await sendOn({ channel: "email", clientId, toEmail: info.email, subject: card.email_subject || "Your free trial is booked!", body: card.email_body, vars: {} });
        } catch (_) {}
      };
      // Quiet hours: hold an after-hours approval until morning (email isn't quiet-gated, send it now).
      if (!withinQuietHours()) {
        await fireCardEmail();
        const sendAfter = nextSendableTime().toISOString();
        const held = {
          client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null,
          contact_name: b.contact_name || null, kind: (card && card.kind) || "confirm", draft_message: String(b.reply), reasoning: b.reasoning || null,
          confidence: typeof b.confidence === "number" ? b.confidence : null,
          status: "approved", send_after: sendAfter, approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        try {
          if (b.ready_id) await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(held) });
          else await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ ...held, created_by: staffEmail }]) });
        } catch (e) { return res.status(500).json({ error: `couldn't schedule: ${e.message}` }); }
        return res.status(200).json({ ok: true, sent: false, deferred: true, send_after: sendAfter });
      }
      try { await sendReplyViaGhl(token, b.contact_id, String(b.reply), clientId); }
      catch (e) { return res.status(e.status || 502).json({ error: `GHL send: ${e.message}` }); }
      await fireCardEmail();
      try { await logApproval({ client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null, contact_name: b.contact_name || null, final_reply: b.reply, reasoning: b.reasoning || null, confidence: typeof b.confidence === "number" ? b.confidence : null, adjusted: !!b.adjusted, status: "sent", created_by: staffEmail }); } catch (_) {}
      if (b.ready_id) {
        try { await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      return res.status(200).json({ ok: true, sent: true });
    }

    // Confirm a HANDOFF: the lead can't make it. Send the warm acknowledgement (if
    // any), write the context note the booking agent will read, then bounce the
    // opportunity Scheduled-Trial → Responded so the booking agent rebooks them.
    if (b.action === "confirm-handoff") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      // Send the warm acknowledgement only if one was provided / drafted.
      const closing = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      if (closing.trim()) { try { await sendReplyViaGhl(token, contactId, closing.trim(), clientId); } catch (_) {} }
      // Write the context note (this is how the booking agent gets full context —
      // contact-memory.js injects agent_contact_notes into the booking prompt).
      const note = (b.handoff_note || (row && row.handoff_note) || "Couldn't make their booked trial — needs to rebook.").toString().trim();
      try {
        await sb(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: clientId, ghl_contact_id: String(contactId), active: true,
          note: `Rebook needed (from confirm agent): ${note}`, created_by: staffEmail || "confirm-agent",
        }]) });
      } catch (e) { return res.status(500).json({ error: `couldn't save handoff note: ${e.message}` }); }
      // Bounce the opportunity back to Responded (best-effort — the note is the part
      // that must land; the booking agent works the Responded stage).
      let oppId = null, moved = false;
      try {
        oppId = await findOpenOpp(token, locationId, contactId);
        const rs = await respondedStage(token, locationId);
        if (rs && oppId) { await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, { token, body: { pipelineId: rs.pipelineId, pipelineStageId: rs.stageId } }); moved = true; }
      } catch (_) {}
      try { if (oppId) await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "rebook", reason: note.slice(0, 300) }]) }); } catch (_) {}
      if (b.ready_id) {
        try { await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      await clearConfirmCards(clientId, contactId, "handed off to booking");
      return res.status(200).json({ ok: true, handed_off: true, moved_to_responded: moved, opportunity_id: oppId });
    }

    // Confirm a Lost suggestion: optional warm closing, then mark the opp Lost.
    if (b.action === "confirm-lost") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      let oppId = null;
      try { oppId = await findOpenOpp(token, locationId, contactId); }
      catch (e) { return res.status(e.status || 502).json({ error: `GHL find opp: ${e.message}` }); }
      if (!oppId) return res.status(200).json({ error: "No opportunity found for this contact — nothing to mark lost." });
      const closing = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      if (closing.trim()) { try { await sendReplyViaGhl(token, contactId, closing.trim(), clientId); } catch (_) {} }
      const reason = (b.lost_reason || (row && row.lost_reason) || "").toString().trim() || null;
      // Model: a non-Unqualified Lost lead flows into 💔 Lead Nurture. If the portal
      // nurture sequence is LIVE + a Lead Nurture stage exists, route them there (opp
      // stays OPEN); else keep the GHL-native status=lost behavior. Auto-switches per academy.
      let routedToNurture = false;
      try {
        if (await isAutomationLive(clientId, "nurture")) {
          const ns = await nurtureStage(token, locationId);
          if (ns) {
            await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, { token, body: { pipelineId: ns.pipelineId, pipelineStageId: ns.stageId } });
            await enrollContact({ clientId, automationKey: "nurture", contactId });
            routedToNurture = true;
          }
        }
      } catch (_) { /* fall through to status=lost */ }
      if (!routedToNurture) {
        try { await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, { token, body: { status: "lost" } }); }
        catch (e) { return res.status(e.status || 502).json({ error: `GHL mark lost: ${e.message}` }); }
      }
      try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: routedToNurture ? "nurture" : "lost", reason }]) }); } catch (_) {}
      if (b.ready_id) {
        try { await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      await clearConfirmCards(clientId, contactId, "marked lost");
      return res.status(200).json({ ok: true, marked_lost: !routedToNurture, routed_to_nurture: routedToNurture, opportunity_id: oppId, reason });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-confirm]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
