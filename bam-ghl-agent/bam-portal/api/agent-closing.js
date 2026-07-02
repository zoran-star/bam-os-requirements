import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Closing Agent queue (Done-Trial stage)
//
// The THIRD sales agent. It works leads the post-trial form moved into the Training
// pipeline's "Done Trial" / "Attended" stage — athletes who CAME IN for a free
// trial and were marked a good fit. Its job:
//   1. send a warm post-trial follow-up,
//   2. answer last questions + handle price/schedule objections, and
//   3. CONVERT them into a paying member — the close = sending the academy's
//      enrollment (sign-up) link, then marking the opportunity won.
//
//   POST /api/agent-closing  { action, ... }  (staff/owner bearer required)
//     "list"           → Done-Trial-stage contacts (the closing queue)
//     "draft"          { contact_id }            → the agent's proposed next message
//     "send"           { contact_id, reply, ... } → send a human-approved closing reply
//     "list-ready"     → pending/approved closing cards for the inbox
//     "skip-ready"     { ready_id }
//     "detect-now"     → run the detector for THIS academy now
//     "confirm-enroll" { ready_id | contact_id, ... } → send the sign-up link + mark won
//     "confirm-lost"   { ready_id | contact_id, ... } → mark the opportunity Lost
//   GET  ?action=detect  (Bearer CRON_SECRET) → the closing detector cron
//
// Gated behind clients.ghl_kpi_config.closing_agent_mode (default 'off') so turning
// on booking/confirm never silently starts pitching memberships. Every send is
// human-approved in Hawkeye; self-drive auto-sends only high-confidence plain
// follow-ups (enroll + lost ALWAYS wait for a human ✓).

import { pickGhlToken, ghl, sendSms } from "./ghl/_core.js";
import { maybeSendSmsViaProvider, smsProvider } from "./messaging/provider.js";
import { readStoreThreadAgent } from "./messaging/read-thread.js";
import { buildAgentSystem } from "./agent/brain.js";
import { loadMergedOverrides } from "./agent/_sections.js";
import { loadContactMemory } from "./agent/contact-memory.js";
import {
  doneTrialStage, contactInRespondedStage, computeClosingQueue,
  doneTrialContactIdSetCached, peekDoneTrialIdSet, nurtureStage, toIso,
} from "./agent/_stage.js";
import { enrollContact, isAutomationLive, resolveContactInfo } from "./automations.js";
import { moveStage, setStatus, findOpenOpp as findOpenOppStore, resolveStage } from "./agent/_store.js";
import {
  DEFAULT_CLOSING_AUTOMATIONS, getClosingAutomations,
  automationsLive as closingAutomationsLive, nextDueStep as nextDueClosingStep,
} from "./agent/closing-automations.js";
import { resolveMergeVars, locFor } from "./email-shells.js";
import { closingAgentMode, modeIsOn, shouldAutoSend, shouldAutoSendScripted } from "./agent/_mode.js";
import { mutedContactIdSet, isMuted } from "./agent/_mutes.js";
import { withinQuietHours, nextSendableTime } from "./agent/_quiet.js";
import { resolveAgentActor } from "./agent/_auth.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";
const DEFAULT_CLIENT_ID    = "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA
const DETECT_CAP           = 10;   // max closing cards drafted per academy per run

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

// The closing agent uses the same per-academy SECTION overrides (agent_prompt_sections,
// keyed by section_key — closing_* keys apply, other agents' keys are ignored by the
// closing assembly) PLUS the closing agent's OWN lessons (agent='closing') - never the
// booking agent's lessons/examples (those would bleed the wrong behavior into a
// conversion chat).
async function loadConfig(clientId) {
  const [overrides, lessonRows, exRows] = await Promise.all([
    loadMergedOverrides(clientId),   // global brain (general/goal) + this academy's own (location/offer)
    sb(`agent_lessons?client_id=eq.${clientId}&agent=eq.closing&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
    sb(`agent_examples?client_id=eq.${clientId}&agent=eq.closing&select=parent_text,agent_text&order=created_at.asc`).catch(() => []),
  ]);
  return { lessons: Array.isArray(lessonRows) ? lessonRows : [], overrides, examples: Array.isArray(exRows) ? exRows : [] };
}

const CLOSING_TRAILER =
  `<live_closing>\n` +
  `You are drafting the next SMS to a REAL lead whose athlete just ATTENDED a free trial and was marked a GOOD FIT (they're in the "Done Trial" stage). Your goal is to convert them into a PAYING MEMBER — a warm post-trial follow-up, handle price/schedule objections, and guide them to enroll. The close = sending the academy's sign-up link (from your config). You do NOT take payment yourself. A human reviews your draft before it sends. ` +
  `Respond ONLY by calling propose_reply: 'reply' = the exact text to send; 'reasoning' = 1-2 sentence why; 'confidence' = 0..1; ` +
  `'escalate' = true (with 'escalate_reason', reply empty) if your guardrails say to hand to a human. ` +
  `If the lead is READY to enroll, set 'recommend_enroll' = true with a short 'enroll_note' (which plan/frequency they want, if known) and put a warm message in 'reply' — on approval a human sends the sign-up link. ` +
  `If your closing_lost criteria say the good-fit attendee won't enroll, set 'recommend_lost' = true with a short 'lost_reason' and put your warm closing message in 'reply'. A human confirms enroll/lost before anything changes.\n</live_closing>`;
function buildSystem({ lessons, overrides, examples }) {
  return buildAgentSystem({ lessons, overrides, examples, trailer: CLOSING_TRAILER, agent: "closing" });
}

const REPLY_TOOL = {
  name: "propose_reply",
  description: "Propose the closing agent's next text to the lead (a human approves before it sends).",
  input_schema: {
    type: "object",
    properties: {
      reply:            { type: "string", description: "The exact text to send. Empty if escalating." },
      summary:          { type: "string", description: "A 2-3 sentence plain-English summary for a human reviewer — who the lead is, their trial, and where the enrollment stands." },
      reasoning:        { type: "string", description: "Short (1-2 sentences) why / current state." },
      confidence:       { type: "number", description: "0..1 confidence this is the right message." },
      escalate:         { type: "boolean", description: "True if guardrails say to hand to a human instead of replying." },
      escalate_reason:  { type: "string", description: "If escalate: why." },
      recommend_enroll: { type: "boolean", description: "True if the lead is ready to enroll and should be sent the sign-up link (a human confirms and sends it)." },
      enroll_note:      { type: "string", description: "If recommend_enroll: which plan / frequency they want, if known, and any context for the human approving the enrollment." },
      recommend_lost:   { type: "boolean", description: "True only if the good-fit attendee clearly won't enroll — a human confirms before anything changes." },
      lost_reason:      { type: "string", description: "If recommend_lost: closest taxonomy reason (Too expensive / Not enough time / Started other programs / Not locked in / Bad fit / Invalid lead / Opted out / Other)." },
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

// The closing agent's draft turn. No tools — a single forced propose_reply. `seed`
// (for a PROACTIVE post-trial opener, when the lead hasn't messaged) is appended as
// the final user turn so the model has the full thread for context plus a clear
// instruction to open the follow-up.
async function runClosingAgent(system, messages, { seed = null } = {}) {
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

// ── GHL thread helpers (same shape as the other agents) ──
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

// Draft the closing agent's next message for one Done-Trial-stage contact. Returns
// the structured proposal, or { error } / { skip }. `opts`:
//   { dts, conversationId, skipStageGuard, lastDirection, nowMs }
async function draftForContact(token, locationId, clientId, contactId, cfg, opts = {}) {
  const dts = opts.dts || await doneTrialStage(token, locationId, { clientId, sb });
  if (!dts) return { error: "No Done-Trial stage found in the Training Pipeline." };
  if (!opts.skipStageGuard && !(await contactInRespondedStage(token, locationId, contactId, dts, { clientId, sb }))) {
    return { error: "This lead isn't in the Done-Trial stage — the closing agent only works good-fit attendees." };
  }
  // Twilio academies: read the thread from the own-store (no GHL conversation).
  let messages;
  if ((await smsProvider(clientId)) === "twilio") {
    messages = await readStoreThreadAgent(clientId, contactId);
  } else {
    let conversationId = opts.conversationId;
    if (!conversationId) {
      const convo = await findConversation(token, locationId, contactId);
      if (!convo) return { error: "no conversation for contact" };
      conversationId = convo.id;
    }
    messages = await threadMessages(token, conversationId);
  }

  const lastIsInbound = opts.lastDirection
    ? opts.lastDirection === "inbound"
    : (messages.length > 0 && messages[messages.length - 1].role === "parent");

  // PROACTIVE post-trial opener: if the lead hasn't messaged since the trial, open
  // with a warm follow-up. No appointment window to gate on — the trial already
  // happened; the post-trial form is what moved them into this stage.
  // Callers can hand in their own seed (the proactive follow-up loop does - its
  // instruction carries the follow-up number + freshness rules). The default
  // opener seed + its double-text guard only apply when none was provided.
  let seed = opts.seed || null;
  if (!seed && !lastIsInbound) {
    // A6: don't stack the closing opener on top of the coach's post-trial text. The
    // post-trial form can send the trainer's first message + the academy's sign-up
    // link itself (post_trial_reviews.signup_text_status = 'sent'). When it already
    // did, the lead has been opened - a second proactive "hope you had a great time"
    // would double-text them. Skip the proactive opener in that case; the lead still
    // re-enters via the reactive path the instant they reply.
    try {
      const rev = await sb(`post_trial_reviews?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=signup_text_status&order=created_at.desc&limit=1`);
      if (Array.isArray(rev) && rev[0] && rev[0].signup_text_status === "sent") {
        return { skip: "coach's post-trial form already sent the first message/link" };
      }
    } catch (_) { /* best-effort - never block a draft on a review lookup */ }
    seed = `[No new message from the lead. Their athlete recently attended a free trial and was marked a good fit. Send a short, warm post-trial follow-up: check in on how the session went and gently open the door to enrolling. Do NOT lead with pricing.]`;
  }

  const system = buildSystem(cfg) + await loadContactMemory(sb, clientId, contactId, { ghl, token, locationId });

  let out;
  try { out = await runClosingAgent(system, messages, { seed }); }
  catch (e) { return { error: e.message }; }

  const agentMsgs = messages.filter(m => m.role === "agent");
  return {
    conversation_id: conversationId,
    reply: out.reply || "",
    reasoning: out.reasoning || "",
    confidence: typeof out.confidence === "number" ? out.confidence : null,
    escalate: !!out.escalate,
    escalate_reason: out.escalate_reason || null,
    recommend_enroll: !!out.recommend_enroll,
    enroll_note: out.enroll_note || null,
    recommend_lost: !!out.recommend_lost,
    lost_reason: out.lost_reason || null,
    trial_at: null,
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    last_message: (() => { const lead = [...messages].reverse().find(m => m.role === "parent"); return lead ? String(lead.text).slice(0, 500) : null; })(),
    last_outbound: (() => { const ours = [...messages].reverse().find(m => m.role === "agent"); return ours ? String(ours.text).slice(0, 500) : null; })(),
    thread_tail: messages.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "lead", text: String(m.text).slice(0, 320), at: toIso(m.date) })),
    reply_count: agentMsgs.length,
  };
}

async function sendReplyViaGhl(token, contactId, reply, clientId) {
  if (clientId) {
    const g = await maybeSendSmsViaProvider(clientId, { ghlContactId: contactId, body: String(reply), sentBy: "closing-agent" });
    if (g.handled) { if (!g.ok) throw new Error(g.error); return; }
  }
  await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId, message: String(reply) } });
}

// Append to the shared audit log (agent_approvals). Non-fatal.
async function logApproval(row) {
  try { await sb(`agent_approvals`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) }); } catch (_) {}
}

// O6 - is this contact ALREADY a live (paying) member? If the won-mark was skipped,
// a paid member's opp can linger in Done-Trial and the closing agent would keep
// drafting "come enroll". Guard on the actual member record, independent of the GHL
// won-mark: match by ghl_contact_id first (cheap), then fall back to parent_email
// (covers a brand-new live member whose contact isn't linked yet). Fails OPEN (returns
// false) so a lookup hiccup never silences the agent on a genuine lead.
async function isLiveMember(clientId, contactId, token) {
  try {
    const byId = await sb(`members?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.live&select=id&limit=1`);
    if (Array.isArray(byId) && byId.length) return true;
    if (token) {
      const info = await resolveContactInfo(token, contactId).catch(() => null);
      const email = info && info.email;
      if (email) {
        const byEmail = await sb(`members?client_id=eq.${encodeURIComponent(clientId)}&parent_email=eq.${encodeURIComponent(email)}&status=eq.live&select=id&limit=1`);
        if (Array.isArray(byEmail) && byEmail.length) return true;
      }
    }
  } catch (_) { /* fail open - never block a real lead on a lookup error */ }
  return false;
}

// Persist only the safe, editable slice of a closing-automations override:
// per-step enabled + template (known keys only), sequence enabled, approve flag.
function sanitizeAutomations(incoming, cur = {}) {
  const defByKey = new Map(DEFAULT_CLOSING_AUTOMATIONS.steps.map(s => [s.key, s]));
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
      : (typeof cur.enabled === "boolean" ? cur.enabled : DEFAULT_CLOSING_AUTOMATIONS.enabled),
    approved: incoming.approved === true,
    steps: steps.length ? steps : (Array.isArray(cur.steps) ? cur.steps : []),
  };
}

// Fire (or queue) the next due SCRIPTED post-trial step for one proactive Done-Trial
// lead. Timing is relative to the sequence start (first step's created_at). SMS-only;
// the only token is {{contact.first_name}}, resolved here so the stored card is final
// text. The instant the lead replies, the AI closing agent owns the thread.
async function fireScriptedStep({ client, token, mode, autos, item, contactId }) {
  const nowMs = Date.now();
  let rows = [];
  try {
    rows = await sb(`agent_closing_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=kind,status,step_key,created_at&order=created_at.asc&limit=50`);
  } catch (_) { rows = []; }
  rows = Array.isArray(rows) ? rows : [];
  if (rows.some(r => ["pending", "approved"].includes(r.status))) return "already has an active card";
  if (rows.some(r => ["closing", "closing_enroll", "closing_lost"].includes(r.kind))) return "lead already in conversation";
  const autoRows = rows.filter(r => r.kind === "closing_auto" && ["pending", "approved", "sent", "skipped"].includes(r.status));
  const sentKeys = new Set(autoRows.map(r => r.step_key));
  const startedMs = autoRows.length ? Math.min(...autoRows.map(r => new Date(r.created_at).getTime())) : null;

  const step = nextDueClosingStep(autos, { nowMs, startedMs, sentKeys });
  if (!step) return "no scripted step due";

  const info = await resolveContactInfo(token, contactId).catch(() => ({ email: null, firstName: null, fullName: null }));
  const message = resolveMergeVars(step.template, locFor(client.id), { first_name: info.firstName, full_name: info.fullName });
  if (!message || !message.trim()) return "rendered template empty";

  const baseRow = {
    client_id: client.id, ghl_contact_id: String(contactId), contact_name: item.name || null,
    kind: "closing_auto", step_key: step.key, draft_message: message, confidence: 1,
    last_lead_at: item.last_at || null, reasoning: `Scripted initial automation: ${step.label}`,
  };

  // Scripted + pre-approved (automationsLive gated this run): auto-send whenever the agent
  // is on, bypassing the global self-drive kill-switch (that net is for AI freeform replies).
  const auto = shouldAutoSendScripted(mode);
  if (auto && !withinQuietHours()) {
    await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      ...baseRow, status: "approved", send_after: nextSendableTime().toISOString(), created_by: "self-drive",
    }]) });
    return "deferred";
  }
  if (auto) {
    await sendReplyViaGhl(token, contactId, message, client.id);
    await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      ...baseRow, status: "sent", auto_sent: true, sent_at: new Date().toISOString(), created_by: "self-drive",
    }]) });
    await logApproval({ client_id: client.id, ghl_contact_id: contactId, contact_name: item.name || null, final_reply: message, reasoning: baseRow.reasoning, confidence: 1, adjusted: false, status: "sent", created_by: "closing-auto" });
    return "sent";
  }
  await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
    ...baseRow, status: "pending", created_by: "detector",
  }]) });
  return "queued";
}

// ── Proactive follow-up loop (Zoran, 2026-07-02) ────────────────────────────
// When the scripted sequence has nothing (more) due and a Done-Trial lead has
// gone quiet, the agent writes the NEXT follow-up fresh - ONE at a time, each
// re-reading the thread + the coach's post-trial notes (contact_memory). Every
// follow-up is AI-written, so it ALWAYS queues in Hawkeye for a human ✓ (never
// auto-sends). After FOLLOWUP_MAX follow-ups sit unanswered, the lead graduates
// to the Nurture stage + the Lead Nurture automation (the long game) - the same
// routing "Mark as lost" uses. A reply at any point resets the strike count
// (strikes are counted from the lead's most recent known reply).
const FOLLOWUP_GAP_DAYS = 2;  // days of silence after OUR last message before the next nudge
const FOLLOWUP_MAX = 3;       // unanswered follow-ups before the move to Nurture

async function maybeFollowUpOrNurture({ client, token, locationId, dts, cfg, item, contactId }) {
  const clientId = client.id;
  if (!item.last_at) return "no thread to follow up on";
  const silenceDays = (Date.now() - new Date(item.last_at).getTime()) / 86400000;
  if (silenceDays < FOLLOWUP_GAP_DAYS) return "waiting on the lead (follow-up gap not reached)";

  let rows = [];
  try {
    rows = await sb(`agent_closing_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=id,kind,step_key,status,sent_at,created_at,last_lead_at&order=created_at.desc&limit=50`);
  } catch (_) { rows = []; }
  rows = Array.isArray(rows) ? rows : [];
  if (rows.some(r => ["pending", "approved"].includes(r.status))) return "already has an active card";

  // Strikes = follow-ups SENT since the lead's last known reply (rows stamp
  // last_lead_at at draft time, so a reply in between restarts the count).
  const lastInboundMs = rows.reduce((m, r) => Math.max(m, r.last_lead_at ? new Date(r.last_lead_at).getTime() : 0), 0);
  const fuSent = rows.filter(r => (r.step_key || "").startsWith("followup_") && r.status === "sent"
    && new Date(r.sent_at || r.created_at).getTime() > lastInboundMs);

  if (fuSent.length >= FOLLOWUP_MAX) {
    // Three strikes: hand them to the long game.
    const oppRef = await findOpenOpp(clientId, token, locationId, contactId);
    if (!oppRef) return `${FOLLOWUP_MAX} follow-ups unanswered but no open opportunity found`;
    const stage = await resolveStage(sb, ghl, { clientId, token, locationId, role: "nurture" });
    if (!stage) return `${FOLLOWUP_MAX} follow-ups unanswered but no Nurture stage resolved`;
    await moveStage({ clientId, sb, ghl, token, oppRef, stage, role: "nurture", contactId });
    try { await enrollContact({ clientId, automationKey: "nurture", contactId }); } catch (_) {}
    return "nurtured";
  }

  const k = fuSent.length + 1;
  const seed = `[No reply from the lead since our last message ~${Math.max(1, Math.floor(silenceDays))} day(s) ago. This is proactive follow-up #${k} of ${FOLLOWUP_MAX}. Re-read the conversation and the coach's post-trial notes in contact_memory, then write ONE short, warm, fresh nudge toward getting the athlete signed up - do NOT repeat or rephrase earlier messages.${k >= FOLLOWUP_MAX ? " This is the FINAL follow-up: a friendly, no-pressure close-out that leaves the door open." : ""}]`;
  const d = await draftForContact(token, locationId, clientId, contactId, cfg, {
    dts, conversationId: item.conversation_id, skipStageGuard: true, lastDirection: item.last_direction, seed,
  });
  if (d.skip) return d.skip;
  if (d.error) return d.error;
  if (!d.reply || !String(d.reply).trim()) return "agent returned an empty follow-up";
  await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
    client_id: clientId, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
    contact_name: item.name || null, kind: "closing", step_key: `followup_${k}`,
    draft_message: d.reply, reasoning: d.reasoning || `Proactive follow-up ${k} of ${FOLLOWUP_MAX}`,
    confidence: d.confidence, trial_at: d.trial_at || null, last_message: d.last_message || null,
    last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
    reply_count: d.reply_count, status: "pending", created_by: "followup-loop",
  }]) });
  return "drafted";
}

// Find a contact's open opportunity (provider-aware). Returns an oppRef
// { id?, ghlOpportunityId? } | null. On provider='portal' it reads the store (so
// portal-native opps with no GHL id are found); on 'ghl' it searches GHL as before.
async function findOpenOpp(clientId, token, locationId, contactId) {
  return await findOpenOppStore({ clientId, ghl, token, locationId, contactId });
}

// Cancel a contact's open closing cards (after enroll / lost / leaving the stage).
async function clearClosingCards(clientId, contactId, reason) {
  try {
    await sb(`agent_closing_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: reason, updated_at: new Date().toISOString() }) });
  } catch (_) {}
}

// ── Detector: draft post-trial conversions for Done-Trial leads ──
async function detectForClient(client) {
  const mode = closingAgentMode(client);
  if (!modeIsOn(mode)) return { client_id: client.id, skipped: "closing mode off" };
  const creds = await pickGhlToken(client);
  if (!creds) return { client_id: client.id, skipped: "no GHL token" };
  const { token, locationId } = creds;

  let dts, queue, doneIds;
  try { ({ dts, queue, doneIds } = await computeClosingQueue(token, locationId, { clientId: client.id, sb })); }
  catch (e) { return { client_id: client.id, error: `queue: ${e.message}` }; }
  if (!dts) return { client_id: client.id, skipped: "no Done-Trial stage" };

  // Prune: cancel pending closing cards whose lead has LEFT the Done-Trial stage
  // (enrolled, lost…). Scoped to THIS agent's table only.
  let pruned = 0;
  try {
    const pend = await sb(`agent_closing_replies?client_id=eq.${client.id}&status=eq.pending&select=id,ghl_contact_id`);
    for (const row of (Array.isArray(pend) ? pend : [])) {
      if (row.ghl_contact_id && !doneIds.has(row.ghl_contact_id)) {
        await sb(`agent_closing_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Done-Trial stage", updated_at: new Date().toISOString() }) });
        pruned++;
      }
    }
  } catch (_) {}

  // Flush quiet-hours holds (approved closing cards whose send time arrived).
  let flushed = 0;
  if (withinQuietHours()) {
    try {
      const held = await sb(`agent_closing_replies?client_id=eq.${client.id}&status=eq.approved&send_after=lte.${new Date().toISOString()}&select=id,ghl_contact_id,draft_message&order=send_after.asc&limit=40`);
      for (const row of (Array.isArray(held) ? held : [])) {
        if (row.ghl_contact_id && !doneIds.has(row.ghl_contact_id)) {
          await sb(`agent_closing_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Done-Trial stage", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (!row.draft_message || !String(row.draft_message).trim()) continue;
        try {
          await sendReplyViaGhl(token, row.ghl_contact_id, row.draft_message, client.id);
          await sb(`agent_closing_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", auto_sent: true, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
          flushed++;
        } catch (_) {}
      }
    } catch (_) {}
  }

  const cfg = await loadConfig(client.id);
  const autos = getClosingAutomations(client);
  const scriptedLive = closingAutomationsLive(autos);
  const mutedSet = await mutedContactIdSet(client.id, "closing");
  let drafted = 0, autoSent = 0, skipped = 0, escalated = 0, enrollsProposed = 0, lostProposed = 0, deferred = 0;
  const reasons = [];
  let _first = true;
  for (const item of queue.slice(0, DETECT_CAP)) {
    if (!_first) await new Promise(r => setTimeout(r, 300));
    _first = false;
    const contactId = item.contact_id;
    if (!contactId) { skipped++; reasons.push(`${item.name || "?"}: no contactId`); continue; }
    if (mutedSet.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: bot muted on this lead`); continue; }
    // O6: never keep selling to a paid member. If the won-mark was skipped, a live
    // member can sit open in Done-Trial - skip them outright (independent of GHL won).
    if (await isLiveMember(client.id, contactId, token)) { skipped++; reasons.push(`${item.name || contactId}: already a live member`); continue; }

    const reactive = item.last_direction === "inbound";

    // SCRIPTED INITIAL AUTOMATIONS (proactive only). When the academy's sequence is
    // live + approved, the timed scripted touches OWN the proactive path (they replace
    // the AI opener). The instant the lead replies, the AI closing agent takes over.
    if (!reactive && scriptedLive) {
      let r = null;
      try { r = await fireScriptedStep({ client, token, mode, autos, item, contactId }); }
      catch (e) { skipped++; reasons.push(`${item.name || contactId}: scripted - ${e.message}`); continue; }
      if (r === "sent") { autoSent++; continue; }
      if (r === "deferred") { deferred++; continue; }
      if (r === "queued") { drafted++; continue; }
      if (r !== "no scripted step due" && r !== "lead already in conversation") {
        skipped++; reasons.push(`${item.name || contactId}: ${r}`); continue;
      }
      // Scripted has nothing (more) to send OR the AI already owns this thread and
      // the lead went quiet - the proactive follow-up loop takes over: ONE fresh,
      // Hawkeye-approved nudge at a time; after FOLLOWUP_MAX unanswered → Nurture.
      try {
        const fu = await maybeFollowUpOrNurture({ client, token, locationId, dts, cfg, item, contactId });
        if (fu === "drafted") drafted++;
        else if (fu === "nurtured") { skipped++; reasons.push(`${item.name || contactId}: ${FOLLOWUP_MAX} follow-ups unanswered - moved to Nurture + enrolled`); }
        else { skipped++; reasons.push(`${item.name || contactId}: ${fu}`); }
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: follow-up - ${e.message}`); }
      continue;
    }

    try {
      // Dedupe. Reactive: skip if an active card exists or we already answered this
      // inbound. Proactive: skip if ANY closing card already exists (we've engaged).
      const existing = await sb(`agent_closing_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&order=created_at.desc&select=id,status,last_lead_at&limit=1`);
      const last = Array.isArray(existing) && existing[0];
      if (last && ["pending", "approved"].includes(last.status)) { skipped++; reasons.push(`${item.name || contactId}: already has a ${last.status} card`); continue; }
      if (reactive && last && last.last_lead_at && item.last_at && new Date(last.last_lead_at).getTime() === new Date(item.last_at).getTime()) { skipped++; reasons.push(`${item.name || contactId}: already answered this inbound`); continue; }
      if (!reactive && last) { skipped++; reasons.push(`${item.name || contactId}: already opened a follow-up`); continue; }
    } catch (e) { reasons.push(`${item.name || contactId}: dedup error — ${e.message}`); }

    let d;
    try { d = await draftForContact(token, locationId, client.id, contactId, cfg, { dts, conversationId: item.conversation_id, skipStageGuard: true, lastDirection: item.last_direction }); }
    catch (e) { skipped++; reasons.push(`${item.name || contactId}: draft threw — ${e.message}`); continue; }
    if (d.skip) { skipped++; reasons.push(`${item.name || contactId}: ${d.skip}`); continue; }

    const baseRow = {
      client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
      contact_name: item.name || null, reasoning: d.reasoning || null, confidence: d.confidence,
      trial_at: d.trial_at || null, last_message: d.last_message || null, last_outbound: d.last_outbound || null,
      summary: d.summary || null, thread_tail: d.thread_tail || null, reply_count: d.reply_count,
      last_lead_at: item.last_at || null,
    };

    // Enroll: lead is ready → ALWAYS queue for a human (send link + mark won on ✓).
    if (d.recommend_enroll) {
      try {
        await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "closing_enroll", enroll_note: d.enroll_note || null,
          draft_message: (d.reply && String(d.reply).trim()) ? d.reply : "", status: "pending", created_by: "detector",
        }]) });
        enrollsProposed++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: enroll-insert failed — ${e.message}`); }
      continue;
    }

    // Lost: good-fit attendee won't enroll → ALWAYS queue for a human.
    if (d.recommend_lost) {
      try {
        await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "closing_lost", lost_reason: d.lost_reason || "Other",
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
          await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            ...baseRow, kind: "closing", draft_message: "(agent escalated — needs a human)",
            escalate: true, escalate_reason: d.escalate_reason || null, status: "pending", created_by: "detector",
          }]) });
        } catch (_) {}
      } else { skipped++; reasons.push(`${item.name || contactId}: ${d.error || "empty reply"}`); }
      continue;
    }

    // A plain closing/nurture reply. Self-drive may auto-send high-confidence ones;
    // quiet hours hold until morning. Everything else queues for approval.
    const auto = shouldAutoSend(mode, { confidence: d.confidence, escalate: d.escalate });
    if (auto && !withinQuietHours()) {
      try {
        await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "closing", draft_message: d.reply, status: "approved", send_after: nextSendableTime().toISOString(), created_by: "self-drive",
        }]) });
        deferred++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: defer-insert failed — ${e.message}`); }
    } else if (auto) {
      try {
        await sendReplyViaGhl(token, contactId, d.reply);
        await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "closing", draft_message: d.reply, status: "sent", auto_sent: true, sent_at: new Date().toISOString(), created_by: "self-drive",
        }]) });
        await logApproval({ client_id: client.id, ghl_contact_id: contactId, ghl_conversation_id: d.conversation_id || null, contact_name: item.name || null, final_reply: d.reply, reasoning: d.reasoning || null, confidence: d.confidence, adjusted: false, status: "sent", created_by: "closing-self-drive" });
        autoSent++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: auto-send failed — ${e.message}`); }
    } else {
      try {
        await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "closing", draft_message: d.reply, status: "pending", created_by: "detector",
        }]) });
        drafted++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: pending-insert failed — ${e.message}`); }
    }
  }
  return { client_id: client.id, business: client.business_name, mode, queued: queue.length, drafted, enrolls_proposed: enrollsProposed, lost_proposed: lostProposed, auto_sent: autoSent, deferred, flushed, escalated, skipped, pruned, reasons };
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
  // Cron: the closing detector (drafts post-trial conversions for Done-Trial leads).
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
      const rows = await sb(`agent_closing_replies?client_id=eq.${clientId}&status=in.(pending,approved)&select=*&order=created_at.desc&limit=100`);
      let list = Array.isArray(rows) ? rows : [];
      // Read-time stage gate: hide cards whose contact left Done-Trial. Fail OPEN if
      // GHL is unreachable or there's no such stage.
      try {
        const client = await loadClient(clientId);
        const loc = client && client.ghl_location_id;
        let ids = loc ? peekDoneTrialIdSet(loc) : undefined;
        if (ids === undefined && loc) {
          const creds = await pickGhlToken(client);
          if (creds) ids = await doneTrialContactIdSetCached(creds.token, loc, 60000, { clientId, sb });
        }
        if (ids) list = list.filter(r => !r.ghl_contact_id || ids.has(r.ghl_contact_id));
      } catch (_) { /* fail open */ }
      return res.status(200).json({ ready: list, count: list.length });
    }
    if (b.action === "skip-ready") {
      if (!b.ready_id) return res.status(400).json({ error: "ready_id required" });
      await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped", updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }

    // Initial-automations editor (the scripted post-trial sequence) — read.
    if (b.action === "automations-get") {
      const client = await loadClient(clientId);
      if (!client) return res.status(404).json({ error: "academy not found" });
      return res.status(200).json({ automations: getClosingAutomations(client), mode: closingAgentMode(client) });
    }
    // Initial-automations editor — save (per-step enabled + copy, sequence enable,
    // approve toggle). Timing is fixed; copy never contains an em dash.
    if (b.action === "automations-set") {
      const client = await loadClient(clientId);
      if (!client) return res.status(404).json({ error: "academy not found" });
      const cur = (client.ghl_kpi_config && client.ghl_kpi_config.closing_initial_automations) || {};
      const merged = sanitizeAutomations(b.automations && typeof b.automations === "object" ? b.automations : {}, cur);
      const cfg = { ...(client.ghl_kpi_config || {}), closing_initial_automations: merged };
      try {
        await sb(`clients?id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: cfg }) });
      } catch (e) { return res.status(500).json({ error: `couldn't save: ${e.message}` }); }
      return res.status(200).json({ ok: true, automations: getClosingAutomations({ ghl_kpi_config: cfg }) });
    }
  } catch (e) {
    console.error("[agent-closing]", e);
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
      const { queue } = await computeClosingQueue(token, locationId, { clientId, sb });
      return res.status(200).json({ queue, count: queue.length });
    }

    if (b.action === "draft") {
      if (!b.contact_id) return res.status(400).json({ error: "contact_id required" });
      if (await isMuted(clientId, b.contact_id, "closing")) return res.status(200).json({ error: "muted", muted: true });
      const cfg = await loadConfig(clientId);
      const d = await draftForContact(token, locationId, clientId, b.contact_id, cfg);
      if (d.error) return res.status(200).json({ error: d.error });
      if (d.skip) return res.status(200).json({ skip: d.skip });
      return res.status(200).json(d);
    }

    if (b.action === "send") {
      if (!b.contact_id || !b.reply || !String(b.reply).trim()) return res.status(400).json({ error: "contact_id and reply required" });
      // HARD GUARD: only send to a lead still in the Done-Trial stage.
      const dts = await doneTrialStage(token, locationId, { clientId, sb });
      if (!dts || !(await contactInRespondedStage(token, locationId, b.contact_id, dts, { clientId, sb }))) {
        return res.status(409).json({ error: "This lead is no longer in the Done-Trial stage — not sending." });
      }
      // Quiet hours: hold an after-hours approval until morning.
      if (!withinQuietHours()) {
        const sendAfter = nextSendableTime().toISOString();
        const held = {
          client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null,
          contact_name: b.contact_name || null, kind: "closing", draft_message: String(b.reply), reasoning: b.reasoning || null,
          confidence: typeof b.confidence === "number" ? b.confidence : null,
          status: "approved", send_after: sendAfter, approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        try {
          if (b.ready_id) await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(held) });
          else await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ ...held, created_by: staffEmail }]) });
        } catch (e) { return res.status(500).json({ error: `couldn't schedule: ${e.message}` }); }
        return res.status(200).json({ ok: true, sent: false, deferred: true, send_after: sendAfter });
      }
      try { await sendReplyViaGhl(token, b.contact_id, String(b.reply), clientId); }
      catch (e) { return res.status(e.status || 502).json({ error: `GHL send: ${e.message}` }); }
      try { await logApproval({ client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null, contact_name: b.contact_name || null, final_reply: b.reply, reasoning: b.reasoning || null, confidence: typeof b.confidence === "number" ? b.confidence : null, adjusted: !!b.adjusted, status: "sent", created_by: staffEmail }); } catch (_) {}
      if (b.ready_id) {
        try { await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      return res.status(200).json({ ok: true, sent: true });
    }

    // Confirm an ENROLL: the good-fit attendee is ready. Send the academy's enroll
    // link (offers.data.signup_url) preceded by any warm drafted reply.
    //
    // P2b — connect to the EXISTING enroll flow (do NOT fake a win here): the enroll
    // page already calls the portal checkout (api/website/checkout.js → member row),
    // and on real payment the Stripe webhook (invoice.paid → fireOnboardingActivations)
    // flips the member live AND marks the opportunity WON + welcomes them. So this
    // action's job is ONLY to send the link and step back — marking the opp won here
    // would inflate wins with people who never pay. We append client_id/contact_id/
    // opp_id to the URL (forward-compat: when the enroll page + checkout read them,
    // the member ↔ contact ↔ opportunity link at creation and the EXACT opp is the
    // one the webhook marks won, instead of an email match). We drop a contact note
    // so the agent + staff know the link went out and we're awaiting payment.
    if (b.action === "confirm-enroll") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      let signupUrl = "";
      try {
        const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
        signupUrl = ((offers && offers[0] && offers[0].data && offers[0].data.signup_url) || "").trim();
      } catch (_) {}
      // Resolve the opp (for the link param + the note) but DON'T change its status —
      // the enroll flow's webhook owns the win on real payment.
      let oppId = null;
      try { const _r = await findOpenOpp(clientId, token, locationId, contactId); oppId = _r && (_r.ghlOpportunityId || _r.id) || null; } catch (_) {}
      // Append identifiers so payment ties back to THIS opportunity (harmless extra
      // query params until the enroll page/checkout read them — P2b-plus, cross-repo).
      let enrollUrl = signupUrl;
      if (enrollUrl) {
        try {
          const u = new URL(enrollUrl);
          u.searchParams.set("client_id", clientId);
          if (contactId) u.searchParams.set("contact_id", String(contactId));
          if (oppId) u.searchParams.set("opp_id", String(oppId));
          enrollUrl = u.toString();
        } catch (_) { /* not a valid absolute URL — send as-is */ }
      }
      const draft = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      const parts = [];
      if (draft.trim()) parts.push(draft.trim());
      if (enrollUrl) parts.push(enrollUrl);
      const msg = parts.join("\n\n");
      if (msg.trim()) { try { await sendReplyViaGhl(token, contactId, msg, clientId); } catch (e) { return res.status(e.status || 502).json({ error: `send failed: ${e.message}` }); } }
      // Note for the team + the agent's own memory (so it won't re-pitch): the link
      // went out; the win lands when they pay, via the enroll flow.
      const note = (b.enroll_note || (row && row.enroll_note) || "").toString().slice(0, 300);
      try {
        await sb(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: clientId, ghl_contact_id: String(contactId), active: true,
          note: `Enrollment link sent (closing agent)${note ? ` — ${note}` : ""}. Awaiting payment: the enroll flow creates the member + marks this won when they pay.`,
          created_by: staffEmail || "closing-agent",
        }]) });
      } catch (_) {}
      try { if (oppId) await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "enroll_link_sent", reason: note || null }]) }); } catch (_) {}
      try { await logApproval({ client_id: clientId, ghl_contact_id: contactId, ghl_conversation_id: b.conversation_id || (row && row.ghl_conversation_id) || null, contact_name: b.contact_name || (row && row.contact_name) || null, final_reply: msg || "[enroll link sent]", status: "sent", created_by: staffEmail }); } catch (_) {}
      if (b.ready_id) {
        try { await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      await clearClosingCards(clientId, contactId, "enroll link sent");
      return res.status(200).json({ ok: true, enrolled: true, link_sent: !!signupUrl, opportunity_id: oppId, won_on: "payment" });
    }

    // Confirm a Lost suggestion: optional warm closing, then mark the opp Lost.
    if (b.action === "confirm-lost") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      let oppId = null, oppRef = null;
      try { oppRef = await findOpenOpp(clientId, token, locationId, contactId); oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null; }
      catch (e) { return res.status(e.status || 502).json({ error: `find opp: ${e.message}` }); }
      if (!oppRef) return res.status(200).json({ error: "No opportunity found for this contact — nothing to mark lost." });
      const closing = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      if (closing.trim()) { try { await sendReplyViaGhl(token, contactId, closing.trim(), clientId); } catch (_) {} }
      const reason = (b.lost_reason || (row && row.lost_reason) || "").toString().trim() || null;
      // Model: a non-Unqualified Lost lead flows into 💔 Lead Nurture. If the portal
      // nurture sequence is LIVE + a Lead Nurture stage exists, route them there (opp
      // stays OPEN); else keep the GHL-native status=lost behavior. Auto-switches per academy.
      let routedToNurture = false;
      try {
        if (await isAutomationLive(clientId, "nurture")) {
          const ns = await nurtureStage(token, locationId, { clientId, sb });
          if (ns) {
            await moveStage({ clientId, ghl, token, oppRef, stage: ns, role: "nurture", contactId, reason });
            await enrollContact({ clientId, automationKey: "nurture", contactId });
            routedToNurture = true;
          }
        }
      } catch (_) { /* fall through to status=lost */ }
      if (!routedToNurture) {
        try { await setStatus({ clientId, ghl, token, oppRef, status: "lost", contactId, reason }); }
        catch (e) { return res.status(e.status || 502).json({ error: `mark lost: ${e.message}` }); }
      }
      try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: routedToNurture ? "nurture" : "lost", reason }]) }); } catch (_) {}
      if (b.ready_id) {
        try { await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      await clearClosingCards(clientId, contactId, "marked lost");
      return res.status(200).json({ ok: true, marked_lost: !routedToNurture, routed_to_nurture: routedToNurture, opportunity_id: oppId, reason });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-closing]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
