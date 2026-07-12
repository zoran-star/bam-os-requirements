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
import { maybeSendSmsViaProvider, smsProvider } from "./messaging/provider.js";
import { readStoreThreadAgent } from "./messaging/read-thread.js";
import { buildAgentSystem } from "./agent/brain.js";
import { loadMergedOverrides } from "./agent/_sections.js";
import { loadContactMemory } from "./agent/contact-memory.js";
import { nextAppointment, passedTrialContactIds, bookingProviderOf } from "./agent/booking.js";
import {
  scheduledTrialStage, contactInRespondedStage, computeConfirmQueue,
  scheduledTrialContactIdSetCached, peekScheduledTrialIdSet, respondedStage, nurtureStage, toIso,
} from "./agent/_stage.js";
import { enrollContact, isAutomationLive, resolveContactInfo } from "./automations.js";
import { moveStage, setStatus, findOpenOpp as findOpenOppStore } from "./agent/_store.js";
import { routeTransition } from "./agent/_router.js";
import {
  DEFAULT_CONFIRM_AUTOMATIONS, getConfirmAutomations, automationsLive,
  nextDueStep, resolveApptTokens, addressFromOverrides,
} from "./agent/confirm-automations.js";
import { sendOn } from "./_send.js";
import { resolveMergeVars, locFor } from "./email-shells.js";
import { confirmAgentMode, modeIsOn, shouldAutoSend, shouldAutoSendScripted } from "./agent/_mode.js";
import { markUnqualified } from "./agent/_tags.js";
import { mutedContactIdSet, isMuted } from "./agent/_mutes.js";
import { withinQuietHours, nextSendableTime, quietTz } from "./agent/_quiet.js";
import { normalizeReigniteAt, scheduleReignition, cancelReignitions, reigniteContactIdSet, reigniteParkMap, repliedAfterPark, dueReignitions, markReignition } from "./agent/_reignite.js";
import { liveMemberContactIds } from "./agent/_live-members.js";
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
// A3 overdue-trial card: once a booked trial time has PASSED by this grace and no
// post-trial review exists, the lead is stranded in Scheduled-Trial (the proactive
// opener only fires for UPCOMING trials, so the agent otherwise goes silent). We
// queue ONE staff "did they show up?" action card so the lead is never just parked.
const OVERDUE_GRACE_MS = 2 * 3600000;       // wait ~2h past the start before nagging
const OVERDUE_MAX_MS   = 14 * 86400000;     // don't resurrect trials older than 14 days
const OVERDUE_CAP      = 10;                 // max overdue cards queued per academy per run

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
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,address,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,booking_provider,time_zone&limit=1`);
  return Array.isArray(rows) && rows[0];
}

// The confirm agent uses the same per-academy SECTION overrides (agent_prompt_sections,
// keyed by section_key — confirm_* keys apply, booking keys are ignored by the confirm
// assembly) PLUS the confirm agent's OWN lessons (agent='confirm') - never the
// booking agent's lessons/examples (those are booking-flavored and would bleed the
// wrong behavior into a confirmation chat).
async function loadConfig(clientId) {
  const [overrides, lessonRows, exRows] = await Promise.all([
    loadMergedOverrides(clientId),   // global brain (general/goal) + this academy's own (location/offer)
    sb(`agent_lessons?or=(client_id.eq.${clientId},and(client_id.is.null,scope.eq.general))&agent=eq.confirm&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
    sb(`agent_examples?client_id=eq.${clientId}&agent=eq.confirm&select=parent_text,agent_text&order=created_at.asc`).catch(() => []),
  ]);
  return { lessons: Array.isArray(lessonRows) ? lessonRows : [], overrides, examples: Array.isArray(exRows) ? exRows : [] };
}

const CONFIRM_TRAILER =
  `<live_confirm>\n` +
  `You are drafting the next SMS to a REAL lead who has ALREADY booked a free trial and is in the "Scheduled Trial" stage. Your goal is to make sure they SHOW UP — confirm they're still coming and help them get there. You do NOT sell and you do NOT rebook. A human reviews your draft before it sends. ` +
  `Respond ONLY by calling propose_reply: 'reply' = the exact text to send; 'reasoning' = 1-2 sentence why; 'confidence' = 0..1; ` +
  `'escalate' = true (with 'escalate_reason', reply empty) if your guardrails say to hand to a human. ` +
  `If the lead CAN'T make their booked time / needs to reschedule, set 'recommend_handoff' = true with a clear 'handoff_note' capturing the dropped slot + any reason or constraint they gave (this note is what the booking assistant reads to rebook them) — do NOT propose new times yourself; put a warm acknowledgement in 'reply'. ` +
  `If your confirm_lost criteria say the lead no longer wants the trial at all, set 'recommend_lost' = true with a short 'lost_reason' and put your warm closing message in 'reply'. A human confirms handoff/lost before anything changes. ` +
  `REIGNITION: if the lead still WANTS the trial but only at a clearly LATER date ("after summer", "once the season ends", "text us in September") - not just a different time this week or next (that's a handoff to rebook) - set 'reignite_at' (YYYY-MM-DD - resolve a vague timeframe to a concrete date, e.g. "after summer" = Sep 01; a bare "later" = about 30 days out) and 'reignite_message' = the exact re-engagement text to open with ON that date. Make 'reply' the warm acknowledgement to send NOW. A human confirms the date + both messages before anything is scheduled.\n</live_confirm>`;
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
      reignite_at:       { type: "string", description: "YYYY-MM-DD. ONLY when the lead still wants the trial but at a clearly LATER date (a season away, not a rebook): the concrete day to re-engage. A human confirms before anything is scheduled." },
      reignite_message:  { type: "string", description: "If reignite_at: the exact re-engagement text to open with on that date - warm, references what they told us, moves toward getting the trial back on the books." },
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
  })).filter(m => m.text && !(m.direction !== "outbound" && /^Liked\b/.test(m.text.trim())));   // inbound tapbacks never register (Zoran 2026-07-09)
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
  const sts = opts.sts || await scheduledTrialStage(token, locationId, { clientId, sb });
  if (!sts) return { error: "No Scheduled-Trial stage found in the Training Pipeline." };
  if (!opts.skipStageGuard && !(await contactInRespondedStage(token, locationId, contactId, sts, { clientId, sb, role: "scheduled_trial" }))) {
    return { error: "This lead isn't in the Scheduled-Trial stage - the confirm agent only works booked leads." };
  }
  // Twilio academies: read the thread from the own-store (no GHL conversation).
  // conversationId MUST live at function scope: the return below references it,
  // and the Twilio branch never declared it - every AI draft on a Twilio academy
  // crashed with "conversationId is not defined" (same bug as agent-closing).
  let conversationId = opts.conversationId || null;
  let messages;
  if ((await smsProvider(clientId)) === "twilio") {
    messages = await readStoreThreadAgent(clientId, contactId);
  } else {
    if (!conversationId) {
      const convo = await findConversation(token, locationId, contactId);
      if (!convo) return { error: "no conversation for contact" };
      conversationId = convo.id;
    }
    messages = await threadMessages(token, conversationId);
  }
  const nowMs = opts.nowMs || Date.now();
  const appt = await nextAppointment(token, contactId, { nowMs, clientId });

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
    // 🔥 Reignition: "still want it, but later" with a concrete date + pre-written
    // re-engagement message. Invalid/past dates drop out.
    reignite_at: normalizeReigniteAt(out.reignite_at),
    reignite_message: (out.reignite_message && String(out.reignite_message).trim()) || null,
    trial_at: appt ? toIso(appt.startTime) : null,
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    last_message: (() => { const lead = [...messages].reverse().find(m => m.role === "parent"); return lead ? String(lead.text).slice(0, 500) : null; })(),
    last_outbound: (() => { const ours = [...messages].reverse().find(m => m.role === "agent"); return ours ? String(ours.text).slice(0, 500) : null; })(),
    thread_tail: messages.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "lead", text: String(m.text).slice(0, 2000), at: toIso(m.date) })),
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

// O6 - is this contact ALREADY a live (paying) member? If the won-mark was skipped,
// a paid member's opp can linger in Scheduled-Trial and the confirm agent would keep
// chasing them. Guard on the actual member record, independent of the GHL won-mark:
// match by ghl_contact_id first (cheap), then fall back to parent_email (covers a
// brand-new live member whose contact isn't linked yet). Fails OPEN so a lookup
// hiccup never silences the agent on a genuine lead.
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

// A3 - this contact's non-cancelled trial appointments (used to tell whether the
// booked trial time has PASSED). nextAppointment() only returns UPCOMING slots, so
// it can't see an overdue trial; this returns all of them with their start times.
async function trialAppts(token, contactId) {
  try {
    const json = await ghl("GET", `/contacts/${encodeURIComponent(contactId)}/appointments`, { token });
    const events = json.events || json.appointments || json.data || [];
    return (Array.isArray(events) ? events : [])
      .map(e => {
        const startRaw = e.startTime || e.startAt || e.start_time || null;
        const ms = startRaw ? new Date(startRaw).getTime() : NaN;
        return { startMs: ms, startIso: startRaw, status: (e.appointmentStatus || e.status || "").toLowerCase() };
      })
      .filter(e => e.startMs && !isNaN(e.startMs) && e.status !== "cancelled" && e.status !== "canceled");
  } catch (_) { return []; }
}

// The gym address for a contact's trial, from the OFFER tied to their pipeline
// card: offers.data.general_info.location holds a Business Blueprint locations id
// (set in the offer wizard's "Primary location" picker). This is the owner-managed
// source of truth for where sessions happen - clients.address is the business's
// registered address and sent families to the wrong building (2026-07-04).
async function offerLocationAddress(clientId, contactId) {
  try {
    const opps = await sb(`opportunities?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.open&select=offer_id&limit=1`);
    const offerId = opps && opps[0] && opps[0].offer_id;
    if (!offerId) return null;
    const offs = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&select=data&limit=1`);
    const locId = offs && offs[0] && offs[0].data && offs[0].data.general_info && offs[0].data.general_info.location;
    if (!locId) return null;
    const locs = await sb(`locations?id=eq.${encodeURIComponent(locId)}&select=address&limit=1`);
    return (locs && locs[0] && String(locs[0].address || "").trim()) || null;
  } catch (_) { return null; }
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
  const appt = await nextAppointment(token, contactId, { nowMs, clientId: client.id });
  const trialMs = appt && appt.startTime ? new Date(appt.startTime).getTime() : null;

  // What's already happened with this contact - FOR THIS TRIAL? A rebooked lead
  // (no-show, rebook, second slot) carries the whole first trial's history, and
  // scoping the gates to the CURRENT appointment is what lets trial #2 get its
  // own confirmation + reminders (rows from trial #1 previously suppressed every
  // scripted touch forever). Rows with no trial_at (legacy) conservatively count
  // as this trial so we never double-send on old data. Compare EPOCH MS, never
  // ISO strings (timestamptz "+00:00" vs toIso "Z" suffixes differ in form).
  let rows = [];
  try {
    rows = await sb(`agent_confirm_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=kind,status,step_key,trial_at&order=created_at.desc&limit=50`);
  } catch (_) { rows = []; }
  rows = Array.isArray(rows) ? rows : [];
  if (rows.some(r => ["pending", "approved"].includes(r.status))) return "already has an active card";
  const sameTrial = r => r.trial_at == null || (trialMs != null && new Date(r.trial_at).getTime() === trialMs);
  // An AI confirm/handoff/lost card ABOUT THIS TRIAL means they're in a live
  // exchange - let the AI agent own it; don't cold-script on top of it.
  if (rows.some(r => ["confirm", "confirm_handoff", "confirm_lost"].includes(r.kind) && sameTrial(r))) return "lead already in conversation";
  const sentKeys = new Set(rows.filter(r => r.kind === "confirm_auto" && ["pending", "approved", "sent", "skipped"].includes(r.status) && sameTrial(r)).map(r => r.step_key));

  const step = nextDueStep(autos, { nowMs, trialMs, sentKeys });
  if (!step) return "no scripted step due";

  // Resolve EVERYTHING ourselves now (portal-native): appointment tokens here, then
  // the contact/location tokens via the send engine's resolver — so the stored card
  // is final text (clean in the approval inbox, and quiet-hours flush can send it raw).
  const info = await resolveContactInfo(token, contactId).catch(() => ({ email: null, phone: null, firstName: null, fullName: null }));
  // Greet the PARENT by first name (they booked the trial and receive this SMS).
  // The parent name lives in the portal booking (trial_bookings.parent_name), off
  // GHL; fall back to the queue item name, then the GHL contact first name.
  let parentFirst = null;
  try {
    const tb = await sb(`trial_bookings?tenant_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=parent_name&order=created_at.desc&limit=1`);
    const pn = (tb && tb[0] && tb[0].parent_name) || item.name || null;
    if (pn) parentFirst = String(pn).trim().split(/\s+/)[0];
  } catch (_) { if (item && item.name) parentFirst = String(item.name).trim().split(/\s+/)[0]; }
  const vars = { first_name: parentFirst || info.firstName, full_name: info.fullName };
  const apptCtx = {
    startMs: trialMs,
    endMs: appt && appt.endTime ? new Date(appt.endTime).getTime() : null,
    // Address chain: the booked slot's own address (portal slots often have no
    // location_label) -> the OFFER's Blueprint primary location (owner-managed,
    // where sessions actually happen) -> the Brain's business_info "Location:"
    // line -> the academy's required BB General address (clients.address).
    location: (appt && appt.address) || (await offerLocationAddress(client.id, contactId)) || addressFromOverrides(cfg && cfg.overrides) || String(client.address || "").trim(),
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

  // Scripted + already approved (automationsLive gated this run): auto-send whenever the
  // agent is on, bypassing the global self-drive kill-switch (that net is for AI freeform
  // replies, not fixed pre-approved copy). AI replies below still use shouldAutoSend.
  const auto = shouldAutoSendScripted(mode);
  if (auto && !withinQuietHours(new Date(), quietTz(client))) {
    // After-hours: hold the SMS until morning; the email isn't quiet-gated, send it now.
    await sendScriptedEmail();
    await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      ...baseRow, status: "approved", send_after: nextSendableTime(new Date(), quietTz(client)).toISOString(), created_by: "self-drive",
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

// Find a contact's open opportunity (provider-aware). Returns an oppRef
// { id?, ghlOpportunityId? } | null. On provider='portal' it reads the store (so
// portal-native opps with no GHL id are found); on 'ghl' it searches GHL as before.
async function findOpenOpp(clientId, token, locationId, contactId) {
  return await findOpenOppStore({ clientId, ghl, token, locationId, contactId });
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

  let sts, queue, scheduledIds, idsTrusted;
  try { ({ sts, queue, scheduledIds, idsTrusted } = await computeConfirmQueue(token, locationId, { clientId: client.id, sb })); }
  catch (e) { return { client_id: client.id, error: `queue: ${e.message}` }; }
  if (!sts) return { client_id: client.id, skipped: "no Scheduled-Trial stage" };
  // Only trust "this lead LEFT the stage" when the membership fetch actually
  // succeeded AND returned someone. A transient GHL blip used to hand back an
  // empty set here, and the prune/flush below then mass-canceled EVERY pending
  // and held confirm card for the academy in one run.
  const stageSetTrusted = idsTrusted !== false && scheduledIds.size > 0;

  // Leads whose booked trial already RAN with no review yet (portal spine, no
  // expiry, rebooked leads excluded): they belong to the post-trial form card
  // on this tab now - no more confirm replies/openers/reminders (Zoran
  // 2026-07-09, mirrors the Booking handoff). Empty set for non-portal
  // academies, so V1/V1.5 behavior is unchanged.
  const passedTrial = await passedTrialContactIds(client.id);

  // Prune: cancel pending confirm cards whose lead has LEFT the Scheduled-Trial
  // stage (showed up, handed off, lost…) or whose trial has already run (the
  // post-trial form owns them now). Scoped to THIS agent's table only.
  let pruned = 0;
  try {
    const pend = await sb(`agent_confirm_replies?client_id=eq.${client.id}&status=eq.pending&select=id,ghl_contact_id,kind`);
    for (const row of (Array.isArray(pend) ? pend : [])) {
      // A fired reignite_due card is a deliberate scheduled re-engagement - the
      // passed-trial handoff must not cancel it (#10). It has its own cancel
      // triggers (real reply, terminal actions, left-stage below).
      if (row.kind === "reignite_due") continue;
      if (row.ghl_contact_id && passedTrial.has(String(row.ghl_contact_id))) {
        await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "trial ran - handed to post-trial form", updated_at: new Date().toISOString() }) });
        pruned++;
      } else if (row.ghl_contact_id && stageSetTrusted && !scheduledIds.has(row.ghl_contact_id)) {
        await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Scheduled-Trial stage", updated_at: new Date().toISOString() }) });
        pruned++;
      }
    }
  } catch (_) {}

  // Loaded before the flush so a held send at a MUTED lead is canceled, not sent.
  const mutedSet = await mutedContactIdSet(client.id, "confirm");

  // 🔥 Reignition: the parked "still want it, but later" set (proactive touches
  // below skip them) + fire due parks into a kind='reignite_due' card on this
  // deck. NO passedTrial cancel here: a park in this stage voided the dropped
  // slot at confirm-reignite time, and a lingering passed slot must not kill the
  // plan. Left-stage cancels only when the membership fetch is trusted.
  let reignited = 0;
  const reignMap = await reigniteParkMap(client.id);
  const reignSet = new Set(reignMap.keys());
  for (const r of await dueReignitions(client.id, "confirm")) {
    const cid = String(r.ghl_contact_id);
    if (mutedSet.has(cid)) { await markReignition(r.id, "canceled", { cancel_reason: "bot muted on this lead" }); reignSet.delete(cid); continue; }
    if (stageSetTrusted && !scheduledIds.has(cid)) { await markReignition(r.id, "canceled", { cancel_reason: "left Scheduled-Trial stage" }); reignSet.delete(cid); continue; }
    try {
      await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
        client_id: client.id, ghl_contact_id: cid, contact_name: r.contact_name || null,
        kind: "reignite_due", draft_message: r.message, reignite_at: r.reignite_at,
        reasoning: r.reason ? `Reignition day - ${r.reason}` : "Reignition day - the lead asked us to circle back today.",
        confidence: 1, status: "pending", created_by: "reignition",
      }]) });
      await markReignition(r.id, "carded");
      reignSet.delete(cid); reignited++;
    } catch (e) { console.error("[agent-confirm] reignite fire:", cid, e.message); }   // active card in the way -> retry next run
  }

  // Flush quiet-hours holds (approved confirm cards whose send time arrived).
  let flushed = 0;
  if (withinQuietHours(new Date(), quietTz(client))) {
    try {
      const held = await sb(`agent_confirm_replies?client_id=eq.${client.id}&status=eq.approved&send_after=lte.${new Date().toISOString()}&select=id,ghl_contact_id,draft_message,kind&order=send_after.asc&limit=40`);
      for (const row of (Array.isArray(held) ? held : [])) {
        // A held HANDOFF acknowledgement (approved after 9:30pm) is exempt from
        // both gates below: the handoff already bounced this lead out of
        // Scheduled-Trial on purpose - that's the plan, not staleness.
        const handoffAck = row.kind === "confirm_handoff";
        // Bot muted on this lead after the send was approved: cancel, don't send.
        if (row.ghl_contact_id && mutedSet.has(String(row.ghl_contact_id))) {
          await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "bot muted on this lead", updated_at: new Date().toISOString() }) });
          continue;
        }
        // Never flush a held confirm at a lead whose trial already ran - "see
        // you Tuesday!" landing on Wednesday. The post-trial form owns them.
        if (!handoffAck && row.ghl_contact_id && passedTrial.has(String(row.ghl_contact_id))) {
          await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "trial ran - handed to post-trial form", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (!handoffAck && row.ghl_contact_id && !scheduledIds.has(row.ghl_contact_id)) {
          // Untrusted stage set: don't cancel, just hold this round (skip the
          // send too - we can't verify the lead is still in the stage).
          if (!stageSetTrusted) continue;
          await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Scheduled-Trial stage", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (!row.draft_message || !String(row.draft_message).trim()) continue;
        try {
          await sendReplyViaGhl(token, row.ghl_contact_id, row.draft_message, client.id);
          await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", auto_sent: true, sent_at: new Date().toISOString(), send_error: null, updated_at: new Date().toISOString() }) });
          flushed++;
        } catch (e) {
          // Keep the row approved so it retries, but make the failure visible -
          // a swallowed error here starved first-touch confirm sends for days.
          try { await sb(`agent_confirm_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ send_error: String((e && e.message) || e).slice(0, 300), updated_at: new Date().toISOString() }) }); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  const cfg = await loadConfig(client.id);
  const autos = getConfirmAutomations(client);
  const scriptedLive = automationsLive(autos);

  // ANTI-STARVATION (Zoran 2026-07-09, same root cause as closing): DETECT_CAP
  // sliced a newest-first queue, so once the top DETECT_CAP Scheduled-Trial cards
  // were carded, quiet leads past that position never got a confirm/reminder card.
  // Drop proactive leads that already have a live (pending/approved) card so the
  // cap is spent only on leads that still need one; the rest drain over runs.
  // Order is left as-is - confirm is appointment-time driven, not silence driven.
  let _confActiveCarded = new Set();
  try {
    const _live = await sb(`agent_confirm_replies?client_id=eq.${client.id}&status=in.(pending,approved)&select=ghl_contact_id`);
    for (const r of (Array.isArray(_live) ? _live : [])) if (r.ghl_contact_id) _confActiveCarded.add(String(r.ghl_contact_id));
  } catch (_) {}
  queue = queue.filter(q => (q.last_direction || "") === "inbound" || !_confActiveCarded.has(String(q.contact_id)));

  let drafted = 0, autoSent = 0, skipped = 0, escalated = 0, handoffs = 0, lostProposed = 0, deferred = 0, reigniteProposed = 0;
  const reasons = [];
  let _first = true;
  for (const item of queue.slice(0, DETECT_CAP)) {
    if (!_first) await new Promise(r => setTimeout(r, 300));
    _first = false;
    const contactId = item.contact_id;
    if (!contactId) { skipped++; reasons.push(`${item.name || "?"}: no contactId`); continue; }
    if (mutedSet.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: bot muted on this lead`); continue; }
    // Trial already ran: reactive replies included - answering "are we still
    // good?" two days after the session reads wrong. The post-trial form card
    // (list-ready synthesis) is the ONE action for this lead now.
    if (passedTrial.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: trial already ran - post-trial form`); continue; }
    // O6: never keep chasing a paid member. If the won-mark was skipped, a live
    // member can sit open in Scheduled-Trial - skip them outright (independent of GHL won).
    if (await isLiveMember(client.id, contactId, token)) { skipped++; reasons.push(`${item.name || contactId}: already a live member`); continue; }

    const reactive = item.last_direction === "inbound";

    // 🔥 Parked "later" leads: no proactive touches (silence is the plan). A lead
    // who texted back re-engaged early - clear the park (belt + suspenders with
    // the inbound webhook's cancel) and work them normally.
    // reactive (inbound-last) alone is NOT proof of a new reply: a silently-parked
    // lead stays inbound-last on their original "later" text. Only cancel when a
    // fresh inbound landed AFTER the park (else keep it - silence is the plan).
    if (reignSet.has(String(contactId))) {
      if (!reactive || !repliedAfterPark(reignMap.get(String(contactId)), item.last_at)) { skipped++; reasons.push(`${item.name || contactId}: parked for reignition`); continue; }
      await cancelReignitions(client.id, contactId, "lead replied before the reignition date");
      reignSet.delete(String(contactId));
    }

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
      // Skip = snooze (Zoran 2026-07-10): a skipped card re-drafts next run.
      if (reactive && last && last.status !== "skipped" && last.last_lead_at && item.last_at && new Date(last.last_lead_at).getTime() === new Date(item.last_at).getTime()) { skipped++; reasons.push(`${item.name || contactId}: already answered this inbound`); continue; }
      if (!reactive && last) { skipped++; reasons.push(`${item.name || contactId}: already opened a confirmation`); continue; }
    } catch (e) { reasons.push(`${item.name || contactId}: dedup error — ${e.message}`); }

    let d;
    try { d = await draftForContact(token, locationId, client.id, contactId, cfg, { sts, conversationId: item.conversation_id, skipStageGuard: true, lastDirection: item.last_direction }); }
    catch (e) { skipped++; reasons.push(`${item.name || contactId}: draft threw — ${e.message}`); continue; }
    // d.error (e.g. "no conversation for contact" on a bare queue item) must skip
    // like d.skip - otherwise a half-empty card row gets built from undefineds.
    if (d.skip || d.error) { skipped++; reasons.push(`${item.name || contactId}: ${d.skip || d.error}`); continue; }

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

    // 🔥 Reignition proposal: "still want it, but later" with a timeframe. ALWAYS
    // queue for a human - the card carries the editable ack (sends on ✓), the
    // pre-written future message, and the date. Nothing schedules until
    // confirm-reignite.
    if (d.reignite_at && d.reignite_message) {
      try {
        await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "reignite", reignite_at: d.reignite_at, reignite_message: d.reignite_message,
          draft_message: (d.reply && String(d.reply).trim()) ? d.reply : "", status: "pending", created_by: "detector",
        }]) });
        reigniteProposed++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: reignite-insert failed — ${e.message}`); }
      continue;
    }

    // Escalation: no message to send, but a human should see it. draft_message
    // stays EMPTY - the card explains itself via escalate_reason, and an empty
    // draft can't be one-tap texted to the parent (the old "(agent escalated ...)"
    // placeholder was a sendable message).
    if (d.error || !d.reply || !String(d.reply).trim()) {
      if (d.escalate) {
        escalated++;
        try {
          await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            ...baseRow, kind: "confirm", draft_message: "",
            escalate: true, escalate_reason: d.escalate_reason || null, status: "pending", created_by: "detector",
          }]) });
        } catch (_) {}
      } else { skipped++; reasons.push(`${item.name || contactId}: ${d.error || "empty reply"}`); }
      continue;
    }

    // A plain confirmation reply. Self-drive may auto-send high-confidence ones;
    // quiet hours hold until morning. Everything else queues for approval.
    const auto = shouldAutoSend(mode, { confidence: d.confidence, escalate: d.escalate });
    if (auto && !withinQuietHours(new Date(), quietTz(client))) {
      try {
        await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "confirm", draft_message: d.reply, status: "approved", send_after: nextSendableTime(new Date(), quietTz(client)).toISOString(), created_by: "self-drive",
        }]) });
        deferred++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: defer-insert failed — ${e.message}`); }
    } else if (auto) {
      try {
        await sendReplyViaGhl(token, contactId, d.reply, client.id);
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

  // ── A3 OVERDUE-TRIAL pass: a Scheduled-Trial lead whose booked time has PASSED
  // with no post-trial review is stranded. The proactive opener only fires for an
  // UPCOMING trial (dMs > 0), so once the slot passes the agent goes silent and only
  // the staff cron nags - the lead sits in Scheduled-Trial forever. Queue ONE staff
  // "did they show up?" action card that carries the opportunity id + an explicit
  // instruction to log the result via the post-trial form (showed up / no-show / good
  // fit), so the lead is never just parked. Idempotent: one card per stranded lead
  // (created_by 'overdue-detector'); it clears itself the moment the review lands (the
  // lead leaves Scheduled-Trial and the prune at the top of this run cancels the card).
  let overdue = 0;
  try {
    const nowMs = Date.now();
    for (const item of queue.slice(0, OVERDUE_CAP)) {
      const contactId = item.contact_id;
      if (!contactId) continue;
      if (mutedSet.has(String(contactId))) continue;
      // Parked for reignition: leaving them alone IS the plan - never nag.
      if (reignSet.has(String(contactId))) continue;
      // Portal academies: these leads already get the REAL post-trial form card
      // in list-ready - an overdue "did they show up?" nag would be a duplicate.
      if (passedTrial.has(String(contactId))) continue;
      // Already carded? (a) any active confirm card -> leave it (the unique index
      // allows only one). (b) we already raised an overdue card -> never nag twice.
      let cards = [];
      try { cards = await sb(`agent_confirm_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=status,created_by&order=created_at.desc&limit=10`); } catch (_) { cards = []; }
      cards = Array.isArray(cards) ? cards : [];
      if (cards.some(c => ["pending", "approved"].includes(c.status))) continue;
      if (cards.some(c => c.created_by === "overdue-detector")) continue;
      // Already reviewed? Then it is not stranded.
      let rev = [];
      try { rev = await sb(`post_trial_reviews?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=id&limit=1`); } catch (_) { rev = []; }
      if (Array.isArray(rev) && rev.length) continue;
      // Is the booked trial actually PAST (+ grace) with nothing upcoming?
      const appts = await trialAppts(token, contactId);
      if (!appts.length) continue;
      if (appts.some(a => a.startMs > nowMs)) continue;            // a future trial exists -> not stranded
      const lastPast = appts.filter(a => a.startMs <= nowMs).sort((a, b) => b.startMs - a.startMs)[0];
      if (!lastPast) continue;
      const age = nowMs - lastPast.startMs;
      if (age < OVERDUE_GRACE_MS || age > OVERDUE_MAX_MS) continue; // too soon, or too old to resurrect
      // Do not card a paid member (O6 reuse).
      if (await isLiveMember(client.id, contactId, token)) continue;
      // Resolve the opportunity so the card can deep-link the post-trial form (which is
      // keyed by opportunity_id). Best-effort: a missing opp still queues the nag.
      let oppId = null;
      try { const _r = await findOpenOpp(client.id, token, locationId, contactId); oppId = _r && (_r.ghlOpportunityId || _r.id) || null; } catch (_) {}
      const trialWhen = fmtTrial(lastPast.startIso);
      const instruction = `Trial on ${trialWhen} has passed with no review logged. Did they show up? Log the result (showed up / no-show / good fit) using the post-trial form for this lead${oppId ? ` (opportunity ${oppId})` : ""}.`;
      try {
        await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: item.conversation_id || null,
          contact_name: item.name || null, kind: "confirm",
          draft_message: "",
          escalate: true, escalate_reason: instruction, summary: instruction,
          handoff_note: oppId ? `post_trial_form opportunity_id=${oppId}` : null,
          trial_at: toIso(lastPast.startIso), last_lead_at: item.last_at || null,
          reasoning: "Overdue trial, no post-trial review: staff action card.",
          confidence: null, status: "pending", created_by: "overdue-detector",
        }]) });
        overdue++;
      } catch (e) { reasons.push(`${item.name || contactId}: overdue-insert failed - ${e.message}`); }
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (e) { reasons.push(`overdue pass: ${e.message}`); }

  return { client_id: client.id, business: client.business_name, mode, queued: queue.length, drafted, handoffs, lost_proposed: lostProposed, reignite_proposed: reigniteProposed, reignited, auto_sent: autoSent, deferred, flushed, escalated, overdue, skipped, pruned, reasons };
}

async function runDetect(res, onlyClientId) {
  let clients = [];
  try {
    clients = onlyClientId
      ? [await loadClient(onlyClientId)].filter(Boolean)
      : await sb(`clients?select=id,business_name,address,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,time_zone&v2_access=eq.true`);
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
          if (creds) ids = await scheduledTrialContactIdSetCached(creds.token, loc, 60000, { clientId, sb });
        }
        if (ids) list = list.filter(r => !r.ghl_contact_id || ids.has(r.ghl_contact_id));
      } catch (_) { /* fail open */ }
      // Post-trial form cards (Zoran 2026-07-09): a trial that already ran with
      // NO post_trial_reviews row = a Hawkeye action on the Confirm tab. The
      // deck renders the form (showed up / good fit / first message / link /
      // notes) and submits it through /api/ghl/post-trial. Portal-booking
      // academies only - their trial spine lives in trial_bookings.
      // NO expiry (Zoran 2026-07-10): the card stays in the deck until the form
      // is filled or the opp closes (open-opp check below) - it never silently
      // ages out. A contact who REBOOKED (has an upcoming slot) is skipped:
      // the new trial owns them and makes its own form card when it runs.
      // Must mirror passedTrialContactIds (agent/booking.js) - same rules drive
      // the card-hiding gates on both agents.
      try {
        const client = await loadClient(clientId);
        if (client && client.booking_provider === "portal") {
          const nowIso = new Date().toISOString();
          const bks = await sb(`trial_bookings?tenant_id=eq.${clientId}&status=eq.BOOKED&select=id,ghl_contact_id,parent_name,athlete_name,schedule_slots(start_time,name)`) || [];
          const rows = (Array.isArray(bks) ? bks : []).filter(t => t.schedule_slots && t.schedule_slots.start_time);
          const upcoming = new Set(rows.filter(t => t.schedule_slots.start_time > nowIso).map(t => String(t.ghl_contact_id || "")));
          let due = rows.filter(t => t.schedule_slots.start_time <= nowIso && !upcoming.has(String(t.ghl_contact_id || "")));
          // ONE form card per lead: a contact with several passed BOOKED rows
          // (data quirks, repeat no-shows) keeps only the LATEST slot. Epoch
          // compare - timestamptz offsets make ISO string compare unreliable.
          const latestByCid = new Map();
          for (const t of due) {
            const cid = String(t.ghl_contact_id || "");
            if (!cid) continue;
            const prev = latestByCid.get(cid);
            if (!prev || new Date(t.schedule_slots.start_time).getTime() > new Date(prev.schedule_slots.start_time).getTime()) latestByCid.set(cid, t);
          }
          due = [...latestByCid.values()];
          if (due.length) {
            // Key the card on the TRIAL, not the CONTACT (Zoran 2026-07-10):
            // reviews carry trial_booking_id, so a lead who no-showed one trial
            // and rebooked isn't suppressed by the old review - the new booking
            // is a different id. The per-opp review upsert makes trial_booking_id
            // follow the latest reviewed trial, so filling the form still hides it.
            const revs = await sb(`post_trial_reviews?client_id=eq.${clientId}&select=trial_booking_id,opportunity_id,created_at`) || [];
            const reviewedBookings = new Set((Array.isArray(revs) ? revs : []).map(r => String(r.trial_booking_id || "")).filter(Boolean));
            // Safety net for reviews that saved with a NULL trial_booking_id (the
            // resolve query threw on submit): they are dropped from reviewedBookings
            // above, so their trial would resurrect. Key such reviews on the OPP +
            // when they were filed - a card is suppressed only when a null-trial
            // review for that opp was filed at/after the trial ran (so a genuine
            // rebook on the same opp, whose newer trial post-dates the old review,
            // still gets its own card). Belt-and-suspenders behind the non-null
            // trial_booking_id guarantee in api/ghl/post-trial.js.
            const reviewedNullOppAt = new Map();
            for (const r of (Array.isArray(revs) ? revs : [])) {
              if (r.trial_booking_id || !r.opportunity_id) continue;
              const oid = String(r.opportunity_id), ms = new Date(r.created_at || 0).getTime() || 0;
              if (ms > (reviewedNullOppAt.get(oid) || 0)) reviewedNullOppAt.set(oid, ms);
            }
            // 🔥 Parked for reignition: leaving them alone IS the plan - no
            // post-trial form card while a reignition is scheduled (their dropped
            // slot was voided at park time; this guards the stragglers).
            const reignSet = await reigniteContactIdSet(clientId);
            // A lead with a fired reignite_due card (kind flips scheduled->carded, so
            // reignSet no longer covers them) must ALSO be left alone: no form card
            // synthesized over their re-engagement card (#10).
            const reignDueSet = new Set((list || []).filter(r => r.kind === "reignite_due" && r.ghl_contact_id).map(r => String(r.ghl_contact_id)));
            const unreviewed = due.filter(t => !reviewedBookings.has(String(t.id)) && !reignSet.has(String(t.ghl_contact_id || "")) && !reignDueSet.has(String(t.ghl_contact_id || "")));
            // Read-time gate (Zoran 2026-07-09, mirrors Booking's): once the
            // trial has run, this agent's own reply/handoff/reminder cards for
            // that lead are stale - a pre-trial "see you Tuesday!" draft must
            // not sit in the deck on Thursday. Hide them so the form card
            // pushed below is THE card; the detector cron cancels them for real.
            const passed = new Set(unreviewed.map(t => String(t.ghl_contact_id || "")).filter(Boolean));
            // Keep reignite/reignite_due cards even for a passed-trial lead - they
            // are the deliberate scheduled re-engagement, not a stale pre-trial card (#10).
            if (passed.size) list = list.filter(r => !r.ghl_contact_id || !passed.has(String(r.ghl_contact_id)) || ["reignite", "reignite_due"].includes(r.kind));
            for (const t of unreviewed) {
              const cid = String(t.ghl_contact_id || "");
              if (!cid) continue;
              let oppId = null;
              try { const o = await findOpenOpp(clientId, null, client.ghl_location_id, cid); oppId = o && (o.ghlOpportunityId || o.id) || null; } catch (_) {}
              if (!oppId) continue;
              // Null-trial review already covers this trial (see reviewedNullOppAt).
              const nullRevAt = reviewedNullOppAt.get(String(oppId)) || 0;
              if (nullRevAt && nullRevAt >= new Date(t.schedule_slots.start_time).getTime()) continue;
              let when = "";
              try { when = new Date(t.schedule_slots.start_time).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: client.time_zone || "America/Toronto" }); } catch (_) {}
              list.push({
                id: "ptf:" + t.id, kind: "post_trial", status: "pending",
                ghl_contact_id: cid, contact_name: t.parent_name || t.athlete_name || "Lead",
                athlete_name: t.athlete_name || null, opportunity_id: oppId,
                trial_at: t.schedule_slots.start_time,
                reasoning: `${t.athlete_name || "The athlete"}'s trial ran${when ? " " + when : ""}. The post-trial form routes them: good fit moves to Done Trial, no-show goes back to Booking for a rebook, not a fit closes as unqualified.`,
                created_at: t.schedule_slots.start_time,
              });
            }
          }
        }
      } catch (_) { /* form cards are additive - never block the queue */ }
      // Read-time paying-member gate: a signed-up lead (live member) never belongs
      // in the Confirm deck - including the synthesized post-trial form cards above
      // (they carry ghl_contact_id). Hide instantly at read time; the signup sweep +
      // detector clear the rows. Fail open.
      try {
        const liveIds = await liveMemberContactIds(clientId);
        if (liveIds.size) list = list.filter(r => !r.ghl_contact_id || !liveIds.has(String(r.ghl_contact_id)));
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
      const { queue } = await computeConfirmQueue(token, locationId, { clientId, sb });
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
      const sts = await scheduledTrialStage(token, locationId, { clientId, sb });
      if (!sts || !(await contactInRespondedStage(token, locationId, b.contact_id, sts, { clientId, sb, role: "scheduled_trial" }))) {
        return res.status(409).json({ error: "This lead is no longer in the Scheduled-Trial stage - not sending." });
      }
      // A reignite_due card is a DELIBERATE scheduled re-engagement - it must fire
      // on its date even though the old booked trial (the reason they were parked)
      // ran. Exempt it from the passed-trial -> form-card handoff guard (#10).
      let isReigniteDue = false;
      if (b.ready_id) {
        try { const rk = await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=kind`); isReigniteDue = Array.isArray(rk) && rk[0] && rk[0].kind === "reignite_due"; } catch (_) {}
      }
      // Post-trial gate (mirrors the detector skip, prune, flush, and list-ready):
      // once the booked trial has RUN, the form card owns this lead - a stale
      // pre-trial card in an old browser tab must not text "see you Tuesday!"
      // after it. Empty set for non-portal academies; fails open by design.
      if (!isReigniteDue && (await passedTrialContactIds(clientId)).has(String(b.contact_id))) {
        return res.status(409).json({ error: "This lead's trial already ran - use their post-trial form card instead." });
      }
      // Never text an internal note at a parent (legacy escalation/overdue rows
      // seeded a sendable "(agent escalated ...)" placeholder as the draft).
      if (/^\((agent escalated|post-trial review needed)/i.test(String(b.reply).trim())) {
        return res.status(400).json({ error: "That's an internal note, not a message - write the reply you want to send." });
      }
      // For a scripted initial-automation card, the booking-confirmation step also
      // emails (same copy) - the payload rides on the row the claim returns below.
      const fireCardEmail = async (card) => {
        if (!card || !card.email_body) return;
        try {
          const info = await resolveContactInfo(token, b.contact_id);
          if (info && info.email) await sendOn({ channel: "email", clientId, toEmail: info.email, subject: card.email_subject || "Your free trial is booked!", body: card.email_body, vars: {} });
        } catch (_) {}
      };
      // Quiet hours: hold an after-hours approval until morning (email isn't
      // quiet-gated, it goes now). The PATCH claims the row with a status
      // precondition so a double-tap or a stale deck can't re-park a sent card.
      if (!withinQuietHours(new Date(), quietTz(client))) {
        const sendAfter = nextSendableTime(new Date(), quietTz(client)).toISOString();
        const held = {
          ghl_conversation_id: b.conversation_id || null,
          contact_name: b.contact_name || null, draft_message: String(b.reply), reasoning: b.reasoning || null,
          confidence: typeof b.confidence === "number" ? b.confidence : null,
          status: "approved", send_after: sendAfter, approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        try {
          if (b.ready_id) {
            const rows = await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(held) });
            const rowNow = Array.isArray(rows) && rows[0];
            if (!rowNow) return res.status(409).json({ error: "This card was already handled." });
            await fireCardEmail(rowNow);
          } else {
            await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ ...held, client_id: clientId, ghl_contact_id: b.contact_id, kind: "confirm", created_by: staffEmail }]) });
          }
        } catch (e) { return res.status(500).json({ error: `couldn't schedule: ${e.message}` }); }
        return res.status(200).json({ ok: true, sent: false, deferred: true, send_after: sendAfter });
      }
      // CLAIM the row first (atomic: only one caller can flip pending/approved ->
      // sent), then send. On a send failure the claim is reverted so the card
      // comes back instead of silently reading as sent.
      let claimed = null;
      if (b.ready_id) {
        try {
          const rows = await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
          claimed = (Array.isArray(rows) && rows[0]) || null;
        } catch (e) { return res.status(500).json({ error: `claim failed: ${e.message}` }); }
        if (!claimed) return res.status(409).json({ error: "This card was already handled." });
      }
      try { await sendReplyViaGhl(token, b.contact_id, String(b.reply), clientId); }
      catch (e) {
        if (claimed) { try { await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "pending", sent_at: null, send_error: String((e && e.message) || e).slice(0, 300), updated_at: new Date().toISOString() }) }); } catch (_) {} }
        return res.status(e.status || 502).json({ error: `GHL send: ${e.message}` });
      }
      await fireCardEmail(claimed);
      try { await logApproval({ client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null, contact_name: b.contact_name || null, final_reply: b.reply, reasoning: b.reasoning || null, confidence: typeof b.confidence === "number" ? b.confidence : null, adjusted: !!b.adjusted, status: "sent", created_by: staffEmail }); } catch (_) {}
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
      // QUIET HOURS (Zoran 2026-07-10): an after-hours ✓ still hands off NOW
      // (notes + stage bounce below run immediately), but the parent-facing text
      // PARKS until morning - the detect cron's flush sends it at 8am
      // (confirm_handoff rows are exempt from the flush's stage gates, since
      // this lead just left Scheduled-Trial on purpose).
      const closing = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      const holdAck = !!closing.trim() && !withinQuietHours(new Date(), quietTz(client));
      if (closing.trim() && !holdAck) { try { await sendReplyViaGhl(token, contactId, closing.trim(), clientId); } catch (_) {} }
      // Write the context note (this is how the booking agent gets full context —
      // contact-memory.js injects agent_contact_notes into the booking prompt).
      const note = (b.handoff_note || (row && row.handoff_note) || "Couldn't make their booked trial — needs to rebook.").toString().trim();
      try {
        await sb(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: clientId, ghl_contact_id: String(contactId), active: true,
          note: `Rebook needed (from confirm agent): ${note}`, created_by: staffEmail || "confirm-agent",
        }]) });
      } catch (e) { return res.status(500).json({ error: `couldn't save handoff note: ${e.message}` }); }
      // A5: don't just park them in Responded waiting for the lead to text first - have
      // the BOOKING agent proactively open a rebook conversation. Write a SECOND note
      // prefixed "Entry:" so the booking detector's opener pass picks it up (it keys off
      // an Entry note + the Responded stage) and drafts the first rebook text. The memory
      // note above stays active so the opener has full rebook context; this trigger note
      // is consumed (deactivated) by the opener once it drafts, so it fires exactly once.
      try {
        await sb(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: clientId, ghl_contact_id: String(contactId), active: true,
          note: `Entry: Rebook needed - ${note}`, created_by: "confirm-agent-rebook",
        }]) });
      } catch (_) { /* best-effort - the handoff + bounce already landed */ }
      // Bounce the opportunity back to Responded (best-effort — the note is the part
      // that must land; the booking agent works the Responded stage).
      let oppId = null, moved = false;
      try {
        const oppRef = await findOpenOpp(clientId, token, locationId, contactId);
        oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null;
        // Bounce back per the academy's authored flow (the cant_make_it edge; GTA
        // seed = -> Responded so the booking agent rebooks). Router reads the edge;
        // on no edge (unseeded / paused / lookup blip) it returns matched:false and
        // we run the original hardcoded move - behavior-identical for GTA.
        const routed = await routeTransition({ clientId, sb, ghl, token, locationId, fromRole: "scheduled_trial", trigger: "cant_make_it", contactId, oppRef, reason: note.slice(0, 300) });
        if (routed.matched) { moved = routed.moved; }
        else {
          const rs = await respondedStage(token, locationId, { clientId, sb });
          if (rs && oppRef) { await moveStage({ clientId, ghl, token, oppRef, stage: rs, role: "responded", contactId, reason: note.slice(0, 300) }); moved = true; }
        }
      } catch (_) {}
      // Cancel the DROPPED trial booking (portal spine). Without this the slot
      // stays BOOKED, and once its start time passes passedTrialContactIds counts
      // it as a passed-with-no-review trial and spawns a bogus post-trial form
      // card for a session the lead already told us they'd miss. Best-effort +
      // portal-only (GHL academies have no trial_bookings row). The rebook creates
      // a fresh booking; this only voids the one they can't make.
      try {
        if ((await bookingProviderOf(clientId)) === "portal") {
          const nowIso = new Date().toISOString();
          const bks = await sb(`trial_bookings?tenant_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.BOOKED&select=id,schedule_slots(start_time)&order=created_at.desc`);
          // Void only the UPCOMING dropped slot(s); never a trial that already ran.
          for (const t of (Array.isArray(bks) ? bks : [])) {
            const st = t.schedule_slots && t.schedule_slots.start_time;
            if (st && st <= nowIso) continue;
            await sb(`rpc/cancel_trial_booking`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ p_tenant_id: clientId, p_trial_booking_id: t.id }) });
          }
        }
      } catch (_) { /* best-effort - the bounce + notes are the parts that must land */ }
      try { if (oppId) await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "rebook", reason: note.slice(0, 300) }]) }); } catch (_) {}
      if (b.ready_id && !holdAck) {
        try { await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      await clearConfirmCards(clientId, contactId, "handed off to booking");
      await cancelReignitions(clientId, contactId, "handed off to booking to rebook");
      // Park the held acknowledgement AFTER the card sweep above, so it's the
      // contact's one active row (partial unique index: one pending/approved
      // per contact). PATCH revives the just-cleared ready row; contact-direct
      // handoffs insert a fresh row. Best-effort: the handoff itself landed.
      let ackAfter = null;
      if (holdAck) {
        ackAfter = nextSendableTime(new Date(), quietTz(client)).toISOString();
        const parked = {
          kind: "confirm_handoff", draft_message: closing.trim(), status: "approved", send_after: ackAfter,
          approved_by: staffEmail, approved_at: new Date().toISOString(), send_error: null, updated_at: new Date().toISOString(),
        };
        try {
          if (b.ready_id) {
            await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(parked) });
          } else {
            await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
              ...parked, client_id: clientId, ghl_contact_id: String(contactId), contact_name: b.contact_name || null,
              handoff_note: note, reasoning: "After-hours handoff: warm acknowledgement held to morning.", created_by: staffEmail,
            }]) });
          }
        } catch (_) {}
      }
      return res.status(200).json({ ok: true, handed_off: true, moved_to_responded: moved, opportunity_id: oppId, ack_deferred: holdAck, ack_send_after: ackAfter });
    }

    // 🔥 Confirm a Reignition: send the (editable) ack now, park the lead in place
    // (agent_reignitions), and VOID any upcoming portal trial slot they're
    // dropping (same cancel as confirm-handoff - otherwise the passed slot spawns
    // a bogus post-trial form card while they're parked). The lead STAYS in
    // Scheduled-Trial; the detect cron fires the pre-written message as a
    // reignite_due card on this deck when the date arrives.
    if (b.action === "confirm-reignite") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      const reigniteAt = normalizeReigniteAt((typeof b.reignite_at === "string" && b.reignite_at) || (row && row.reignite_at) || "");
      if (!reigniteAt) return res.status(400).json({ error: "A future reignite date is required (up to ~18 months out)." });
      const message = String((typeof b.message === "string" && b.message.trim()) ? b.message : ((row && row.reignite_message) || "")).trim();
      if (!message) return res.status(400).json({ error: "The re-engagement message for that date is required." });
      const ack = ((typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "").trim();
      let ackSent = false;
      if (ack) { try { await sendReplyViaGhl(token, contactId, ack, clientId); ackSent = true; } catch (_) {} }
      let parkRow = null;
      try {
        parkRow = await scheduleReignition({
          clientId, contactId, contactName: (row && row.contact_name) || b.contact_name || null,
          agent: "confirm", reigniteAt, message,
          reason: (typeof b.reason === "string" && b.reason.trim()) || (row && row.reasoning) || null,
          source: row && row.kind === "reignite" ? "agent" : "manual", createdBy: staffEmail,
        });
      } catch (e) { return res.status(500).json({ error: `couldn't schedule: ${e.message}` }); }
      // Void the upcoming slot(s) they're dropping (portal spine, best-effort).
      try {
        if ((await bookingProviderOf(clientId)) === "portal") {
          const nowIso = new Date().toISOString();
          const bks = await sb(`trial_bookings?tenant_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.BOOKED&select=id,schedule_slots(start_time)&order=created_at.desc`);
          for (const t of (Array.isArray(bks) ? bks : [])) {
            const st = t.schedule_slots && t.schedule_slots.start_time;
            if (st && st <= nowIso) continue;
            await sb(`rpc/cancel_trial_booking`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ p_tenant_id: clientId, p_trial_booking_id: t.id }) });
          }
        }
      } catch (_) { /* best-effort - the park already landed */ }
      // Optional teach-why lesson (an edited date/message trains the agent).
      let lessonId = null;
      if (b.lesson && String(b.lesson).trim()) {
        try {
          const [lrow] = await sb(`agent_lessons`, { method: "POST", headers: { Prefer: "return=representation" },
            body: JSON.stringify([{ client_id: clientId, agent: "confirm", kind: "fix", scope: "academy", lesson: String(b.lesson).trim(), created_by: staffEmail, context: { contact_id: contactId, reignite_at: reigniteAt, sent: ack || null } }]) });
          lessonId = lrow?.id || null;
        } catch (_) {}
      }
      // Truthful bookkeeping: acted-on row 'sent' only when the ack went out.
      if (b.ready_id) {
        const done = ackSent
          ? { status: "sent", reignite_at: reigniteAt, reignite_message: message, approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : { status: "canceled", send_error: "parked for reignition", reignite_at: reigniteAt, reignite_message: message, approved_by: staffEmail, updated_at: new Date().toISOString() };
        try { await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(done) }); } catch (_) {}
      }
      await clearConfirmCards(clientId, contactId, "parked for reignition");
      try { await logApproval({ client_id: clientId, ghl_contact_id: contactId, contact_name: (row && row.contact_name) || null, final_reply: `[reignite ${reigniteAt.slice(0, 10)}]${ackSent ? " + ack sent" : ""}`, reasoning: (row && row.reasoning) || null, status: "sent", created_by: staffEmail }); } catch (_) {}
      return res.status(200).json({ ok: true, scheduled_for: reigniteAt, ack_sent: ackSent, lesson_id: lessonId, reignition_id: (parkRow && parkRow.id) || null });
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
      let oppId = null, oppRef = null;
      try { oppRef = await findOpenOpp(clientId, token, locationId, contactId); oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null; }
      catch (e) { return res.status(e.status || 502).json({ error: `find opp: ${e.message}` }); }
      if (!oppRef) return res.status(200).json({ error: "No opportunity found for this contact - nothing to mark lost." });
      const closing = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      const goodbyeRequested = !!closing.trim();
      let goodbyeSent = false, goodbyeError = null;
      if (goodbyeRequested) { try { await sendReplyViaGhl(token, contactId, closing.trim(), clientId); goodbyeSent = true; } catch (e) { goodbyeError = e.message || String(e); } }
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
        // 'sent' only when the goodbye actually went out; a bare move is 'canceled'
        // (fake sent_at rows poisoned the draft-vs-sent training data). A REQUESTED
        // goodbye that failed records the error so it never looks like a silent close.
        const done = goodbyeSent
          ? { status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : (goodbyeRequested
            ? { status: "canceled", send_error: `goodbye send failed: ${(goodbyeError || "unknown").slice(0, 160)}`, approved_by: staffEmail, updated_at: new Date().toISOString() }
            : { status: "canceled", send_error: "marked lost", approved_by: staffEmail, updated_at: new Date().toISOString() });
        try { await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(done) }); } catch (_) {}
      }
      await clearConfirmCards(clientId, contactId, "marked lost");
      await cancelReignitions(clientId, contactId, routedToNurture ? "moved to nurture" : "marked lost");
      return res.status(200).json({ ok: true, marked_lost: !routedToNurture, routed_to_nurture: routedToNurture, opportunity_id: oppId, reason, goodbye_requested: goodbyeRequested, goodbye_sent: goodbyeSent, goodbye_error: goodbyeError });
    }

    // Mark Unqualified (Zoran 2026-07-08: every agent can mark unqualified). The
    // dead end: close the opp (abandoned + role unqualified), stamp the GHL
    // `unqualified` tag, log the outcome, drop the confirm cards. No nurture, no
    // message. Mirrors agent-approvals' confirm-abandoned.
    if (b.action === "confirm-abandoned") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      let oppId = null, oppRef = null;
      try { oppRef = await findOpenOpp(clientId, token, locationId, contactId); oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null; }
      catch (e) { return res.status(e.status || 502).json({ error: `find opp: ${e.message}` }); }
      if (!oppRef) return res.status(200).json({ error: "No opportunity found for this contact - nothing to close." });
      // Optional goodbye: write a message + mark unqualified in ONE action (Zoran
      // 2026-07-10). Sends only when explicitly provided; sent BEFORE the close,
      // like confirm-lost, so send guards still see an open opp.
      const closing = (typeof b.reply === "string" ? b.reply : "").trim();
      const goodbyeRequested = !!closing;
      let goodbyeSent = false, goodbyeError = null;
      if (goodbyeRequested) { try { await sendReplyViaGhl(token, contactId, closing, clientId); goodbyeSent = true; } catch (e) { goodbyeError = e.message || String(e); } }
      const reason = (b.reason || (row && row.lost_reason) || "").toString().trim() || null;
      try {
        await setStatus({ clientId, ghl, token, oppRef, status: "abandoned", role: "unqualified", contactId, reason });
      } catch (e) { return res.status(e.status || 502).json({ error: `mark unqualified: ${e.message}` }); }
      try { await markUnqualified(token, contactId, clientId); } catch (_) {}
      try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "abandoned", reason }]) }); } catch (_) {}
      if (b.ready_id) {
        // 'sent' only when the goodbye actually went out; a silent close is 'canceled';
        // a REQUESTED goodbye that failed records the error (never looks silent).
        const done = goodbyeSent
          ? { status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : (goodbyeRequested
            ? { status: "canceled", send_error: `goodbye send failed: ${(goodbyeError || "unknown").slice(0, 160)}`, approved_by: staffEmail, updated_at: new Date().toISOString() }
            : { status: "canceled", send_error: "marked unqualified", approved_by: staffEmail, updated_at: new Date().toISOString() });
        try { await sb(`agent_confirm_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(done) }); } catch (_) {}
      }
      await clearConfirmCards(clientId, contactId, "marked unqualified");
      await cancelReignitions(clientId, contactId, "marked unqualified");
      return res.status(200).json({ ok: true, marked_abandoned: true, unqualified: true, opportunity_id: oppId, reason, goodbye_requested: goodbyeRequested, goodbye_sent: goodbyeSent, goodbye_error: goodbyeError });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-confirm]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
