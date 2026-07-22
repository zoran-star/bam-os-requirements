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
import { routeTransition } from "./agent/_router.js";
import { closingAgentMode, modeIsOn, shouldAutoSend } from "./agent/_mode.js";
import { markUnqualified } from "./agent/_tags.js";
import { mutedContactIdSet, isMuted } from "./agent/_mutes.js";
import { withinQuietHours, nextSendableTime, quietTz } from "./agent/_quiet.js";
import { normalizeReigniteAt, scheduleReignition, cancelReignitions, reigniteContactIdSet, reigniteParkMap, repliedAfterPark, dueReignitions, markReignition } from "./agent/_reignite.js";
import { reconcileLiveMembers } from "./agent/_reconcile-members.js";
import { liveMemberContactIds } from "./agent/_live-members.js";
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
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,time_zone&limit=1`);
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
    sb(`agent_lessons?or=(client_id.eq.${clientId},and(client_id.is.null,scope.eq.general))&agent=eq.closing&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
    sb(`agent_examples?client_id=eq.${clientId}&agent=eq.closing&select=parent_text,agent_text&order=created_at.asc`).catch(() => []),
  ]);
  return { lessons: Array.isArray(lessonRows) ? lessonRows : [], overrides, examples: Array.isArray(exRows) ? exRows : [] };
}

// ── Follow-up strategy (Zoran 2026-07-10) ───────────────────────────────────
// The academy-configurable cadence for quiet Done-Trial leads. gaps[i] = days
// between message i and the one before it (gaps[0] counts from our last
// message), so the DEFAULT [1, 2] = follow-up #1 the next day ("just checking
// you saw my message"), #2 two days after that ("still interested?"), then the
// Lost suggestion `lost_after` quiet days after the final follow-up. Configured
// per academy at clients.ghl_kpi_config.closing_followups via agent-config
// (the Follow-ups tab in the training flow); the WORDING lives in the trainable
// closing_followup brain section.
const FOLLOWUP_DEFAULT_GAPS = [1, 2];
const FOLLOWUP_DEFAULT_LOST_AFTER = 2;
export function closingFollowupStrategy(client) {
  const raw = ((client && client.ghl_kpi_config) || {}).closing_followups || {};
  let gaps = Array.isArray(raw.gaps) ? raw.gaps : FOLLOWUP_DEFAULT_GAPS;
  gaps = gaps.map(n => Math.max(1, Math.min(14, Math.round(Number(n) || 1)))).slice(0, 5);
  if (!gaps.length) gaps = FOLLOWUP_DEFAULT_GAPS;
  const lostAfter = Math.max(1, Math.min(14, Math.round(Number(raw.lost_after) || FOLLOWUP_DEFAULT_LOST_AFTER)));
  return { gaps, lostAfter };
}

function closingTrailer(strat) {
  const n = (strat && strat.gaps && strat.gaps.length) || FOLLOWUP_DEFAULT_GAPS.length;
  return `<live_closing>\n` +
  `You are drafting the next SMS to a REAL lead whose athlete just ATTENDED a free trial and was marked a GOOD FIT (they're in the "Done Trial" stage). Your goal is to convert them into a PAYING MEMBER — a warm post-trial follow-up, handle price/schedule objections, and guide them to enroll. The close = sending the academy's sign-up link (from your config). You do NOT take payment yourself. A human reviews your draft before it sends. ` +
  `Respond ONLY by calling propose_reply: 'reply' = the exact text to send; 'reasoning' = 1-2 sentence why; 'confidence' = 0..1; ` +
  `'escalate' = true (with 'escalate_reason', reply empty) if your guardrails say to hand to a human. ` +
  `If the lead is READY to enroll, set 'recommend_enroll' = true with a short 'enroll_note' (which plan/frequency they want, if known) and put a warm message in 'reply' — the academy's sign-up link is appended to your message and a human approves before it sends. ` +
  `If your closing_lost criteria say the good-fit attendee won't enroll, set 'recommend_lost' = true with a short 'lost_reason' and put your warm closing message in 'reply'. A human confirms enroll/lost before anything changes. ` +
  `Silence alone is NEVER a lost signal: quiet leads are handled by the follow-up loop, which recommends Lost automatically after ${n} unanswered follow-up${n === 1 ? "" : "s"}. Reserve 'recommend_lost' for an explicit no (too expensive, chose another program, not interested). ` +
  `Follow-up timing: your follow-up schedule is preplanned (see your follow-up timing guidance). But if the lead names a specific date or timeframe for their decision ("we'll decide after the weekend", "after the 15th", "once report cards are out"), set 'followup_on' (YYYY-MM-DD) to the day right after it so we don't nag them before they said they'd know. ` +
  `REIGNITION (different from followup_on): if the lead clearly WANTS to enroll but only at a distinctly LATER date ("we'll start after summer", "once basketball season ends", "sign us up in September") - a start-later, not a decide-soon - set 'reignite_at' (YYYY-MM-DD - resolve a vague timeframe to a concrete date, e.g. "after summer" = Sep 01; a bare "later" = about 30 days out) and 'reignite_message' = the exact re-engagement text to open with ON that date. Make 'reply' the warm acknowledgement to send NOW. A human confirms the date + both messages before anything is scheduled.\n</live_closing>`;
}
function buildSystem({ lessons, overrides, examples, strategy }) {
  return buildAgentSystem({ lessons, overrides, examples, trailer: closingTrailer(strategy), agent: "closing" });
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
      followup_on:      { type: "string", description: "YYYY-MM-DD. ONLY when the lead named a specific date/timeframe for their decision: the day right after it (the earliest day we should proactively follow up). Omit otherwise - the default cadence is next-day." },
      reignite_at:      { type: "string", description: "YYYY-MM-DD. ONLY when the lead wants to enroll but at a distinctly LATER date (start-later, not decide-soon): the concrete day to re-engage. A human confirms before anything is scheduled." },
      reignite_message: { type: "string", description: "If reignite_at: the exact re-engagement text to open with on that date - warm, references what they told us, moves toward enrolling." },
    },
    required: ["reply", "reasoning", "confidence", "escalate"],
  },
};

// The follow-up PLAN for a quiet Done-Trial lead: the remaining messages of the
// academy's cadence drafted in one pass, approved as a batch in Hawkeye, then
// sent on the configured day gaps - each only if the previous got no reply. A
// reply at any point cancels the rest. Built per draft because the message
// count + gaps come from the academy's follow-up strategy.
function buildPlanTool(gapsLeft) {
  const n = Math.max(1, gapsLeft.length);
  const props = {};
  for (let i = 0; i < n; i++) {
    const gap = gapsLeft[i] || 1;
    const when = i === 0
      ? `Sends ${gap} day${gap === 1 ? "" : "s"} after our last message if they stay quiet`
      : `Sends ${gap} day${gap === 1 ? "" : "s"} after message #${i} and ONLY if it got no reply`;
    const what = i === 0 && n > 1
      ? "a light, warm did-you-see-my-message check-in. Never repeats or rephrases earlier messages."
      : i === n - 1
      ? "asks if they're still interested, then leaves the door open - friendly, zero pressure."
      : "a DIFFERENT angle - value, schedule fit, or a light question. Must read naturally after silence.";
    props[`followup_${i + 1}`] = { type: "string", description: `${when}: ${what}` };
  }
  props.summary     = { type: "string", description: "2-3 sentence reviewer summary: who the lead is, their trial, where enrollment stands." };
  props.reasoning   = { type: "string", description: "1-2 sentences on the plan's angle." };
  props.confidence  = { type: "number", description: "0..1" };
  props.followup_on = { type: "string", description: "YYYY-MM-DD. ONLY if the lead named a decision date/timeframe: the day after it - the plan starts sending then." };
  return {
    name: "propose_followup_plan",
    description: "Propose the follow-up plan for a quiet Done-Trial lead. A human approves the whole plan; messages then send on the schedule described per field, each only if the previous got no reply.",
    input_schema: {
      type: "object",
      properties: props,
      required: [...Array.from({ length: n }, (_, i) => `followup_${i + 1}`), "reasoning", "confidence"],
    },
  };
}

async function runClosingPlan(system, messages, { seed, tool }) {
  let convo = messages
    .filter(m => m && typeof m.text === "string" && m.text.trim() !== "")
    .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text }));
  convo.push({ role: "user", content: seed });
  while (convo.length && convo[0].role === "assistant") convo.shift();
  const planTool = tool || buildPlanTool(FOLLOWUP_DEFAULT_GAPS);
  const data = await anthropicCall({
    model: ANTHROPIC_MODEL, max_tokens: 1024, system, tools: [planTool],
    tool_choice: { type: "tool", name: "propose_followup_plan" }, messages: convo,
  });
  const out = (data.content || []).find(b => b.type === "tool_use" && b.name === "propose_followup_plan");
  if (out?.input) return out.input;
  throw new Error("no structured plan from Claude");
}

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
  })).filter(m => m.text && !(m.direction !== "outbound" && /^Liked\b/.test(m.text.trim())));   // inbound tapbacks never register (Zoran 2026-07-09)
  msgs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  return msgs.map(m => ({ role: m.direction === "outbound" ? "agent" : "parent", text: m.text, date: m.date }));
}

// Draft the closing agent's next message for one Done-Trial-stage contact. Returns
// the structured proposal, or { error } / { skip }. `opts`:
//   { dts, conversationId, skipStageGuard, lastDirection, nowMs }
async function draftForContact(token, locationId, clientId, contactId, cfg, opts = {}) {
  const dts = opts.dts || await doneTrialStage(token, locationId, { clientId, sb });
  if (!dts) return { error: "No Done-Trial stage found in the Training Pipeline." };
  if (!opts.skipStageGuard && !(await contactInRespondedStage(token, locationId, contactId, dts, { clientId, sb, role: "done_trial" }))) {
    return { error: "This lead isn't in the Done-Trial stage - the closing agent only works good-fit attendees." };
  }
  // Twilio academies: read the thread from the own-store (no GHL conversation).
  // conversationId MUST live at function scope: the returns below reference it,
  // and the Twilio branch never declared it - every AI draft on a Twilio academy
  // crashed with "conversationId is not defined" (found via detect summaries).
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

  // PLAN MODE (the follow-up loop): draft the whole remaining plan in one pass
  // instead of a single reply. Same system prompt + contact memory + thread.
  // opts.planTool carries the strategy-sized tool (message count + day gaps).
  if (opts.planMode) {
    let planOut;
    const planTool = opts.planTool || buildPlanTool(FOLLOWUP_DEFAULT_GAPS);
    try { planOut = await runClosingPlan(system, messages, { seed, tool: planTool }); }
    catch (e) { return { error: e.message }; }
    const agentMsgs = messages.filter(m => m.role === "agent");
    const planCount = Object.keys(planTool.input_schema.properties).filter(k => /^followup_\d+$/.test(k)).length;
    return {
      conversation_id: conversationId,
      plan: Array.from({ length: planCount }, (_, i) => String(planOut[`followup_${i + 1}`] || "").trim()),
      reasoning: planOut.reasoning || "",
      summary: planOut.summary ? String(planOut.summary).slice(0, 600) : null,
      confidence: typeof planOut.confidence === "number" ? planOut.confidence : null,
      followup_on: (typeof planOut.followup_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(planOut.followup_on)) ? planOut.followup_on : null,
      trial_at: null,
      last_message: (() => { const lead = [...messages].reverse().find(m => m.role === "parent"); return lead ? String(lead.text).slice(0, 500) : null; })(),
      last_outbound: (() => { const ours = [...messages].reverse().find(m => m.role === "agent"); return ours ? String(ours.text).slice(0, 500) : null; })(),
      thread_tail: messages.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "lead", text: String(m.text).slice(0, 2000), at: toIso(m.date) })),
      reply_count: agentMsgs.length,
    };
  }

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
    // Lead named a decision date ("after the 15th") → earliest day to follow up.
    followup_on: (typeof out.followup_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.followup_on)) ? out.followup_on : null,
    // 🔥 Reignition: "we'll enroll, but later" with a concrete date + pre-written
    // re-engagement message. Invalid/past dates drop out.
    reignite_at: normalizeReigniteAt(out.reignite_at),
    reignite_message: (out.reignite_message && String(out.reignite_message).trim()) || null,
    trial_at: null,
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    last_message: (() => { const lead = [...messages].reverse().find(m => m.role === "parent"); return lead ? String(lead.text).slice(0, 500) : null; })(),
    last_outbound: (() => { const ours = [...messages].reverse().find(m => m.role === "agent"); return ours ? String(ours.text).slice(0, 500) : null; })(),
    thread_tail: messages.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "lead", text: String(m.text).slice(0, 2000), at: toIso(m.date) })),
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
// Training-signal enrichment (2026-07-12): a teach-why lesson snapshots the
// conversation + pipeline stage that produced it (see agent-approvals.js for the
// rationale). stage_from is this agent's home stage; stage_to stays the column
// default null on the reignite path (no stage move) - reserved for move+teach.
const LESSON_STAGE_FROM = "Done Trial"; // closing agent works post-trial leads
function threadSnapshot(row) {
  const t = row && (row.thread_tail ?? row.summary);
  if (!t) return null;
  return typeof t === "string" ? t : JSON.stringify(t);
}

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

// NOTE (Zoran 2026-07-08): the scripted "closing initial automations" sequence is
// RETIRED - there are no preplanned automations in Done Trial. The only preplanned
// touch is the post-trial form itself (the trainer's first message + optional
// sign-up link, api/ghl/post-trial.js). Everything after that is the AI closing
// agent: opener (when the form didn't text), replies, and the follow-up plan.
// agent/closing-automations.js is kept only as historical reference.

// Resolve the academy's sign-up link with tracking params (client/contact/opp) so a
// payment ties back to THIS opportunity. Returns empty strings when no link is set.
async function buildEnrollUrl(clientId, token, locationId, contactId) {
  let signupUrl = "";
  try {
    const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
    signupUrl = ((offers && offers[0] && offers[0].data && offers[0].data.signup_url) || "").trim();
  } catch (_) {}
  if (!signupUrl) return { signupUrl: "", enrollUrl: "", oppId: null };
  let oppId = null;
  try { const _r = await findOpenOpp(clientId, token, locationId, contactId); oppId = _r && (_r.ghlOpportunityId || _r.id) || null; } catch (_) {}
  let enrollUrl = signupUrl;
  try {
    const u = new URL(enrollUrl);
    u.searchParams.set("client_id", clientId);
    if (contactId) u.searchParams.set("contact_id", String(contactId));
    if (oppId) u.searchParams.set("opp_id", String(oppId));
    enrollUrl = u.toString();
  } catch (_) { /* not a valid absolute URL - use as-is */ }
  return { signupUrl, enrollUrl, oppId };
}

// ── Proactive follow-up loop (Zoran, 2026-07-02; always-scheduled 2026-07-10) ─
// The moment we're waiting on a quiet Done-Trial lead (our message is the last
// one and no card is live), the agent drafts the WHOLE remaining follow-up plan
// as a Hawkeye card - so a Done-Trial lead ALWAYS has its next follow-up either
// scheduled or awaiting approval (Zoran's rule; the old 24h silence gate left
// cards action-less for a day). Every message is AI-written and queues for a
// human ✓ - approving schedules the sends on the academy's configured day gaps
// (default: next day, then +2 days), each sending only if the previous got no
// reply. After the final follow-up sits unanswered `lostAfter` days, the lead
// gets a Lost suggestion (approve = Nurture routing, the long game). A reply at
// any point cancels the rest and resets the count.
const DAY_MS = 86400000;

async function maybeFollowUpOrNurture({ client, token, locationId, dts, cfg, item, contactId, strat }) {
  const clientId = client.id;
  strat = strat || closingFollowupStrategy(client);
  if (!item.last_at) return "no thread to follow up on";

  let rows = [];
  try {
    rows = await sb(`agent_closing_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=id,kind,step_key,status,sent_at,created_at,last_lead_at,followup_not_before,created_by&order=created_at.desc&limit=50`);
  } catch (_) { rows = []; }
  rows = Array.isArray(rows) ? rows : [];
  if (rows.some(r => ["pending", "approved"].includes(r.status))) return "already has an active card";

  // The lead named a decision date ("we'll know after the 15th") - the plan
  // still cards NOW, but its schedule anchors at that date, not the cadence.
  const holdUntil = rows.reduce((m, r) => Math.max(m, r.followup_not_before ? new Date(r.followup_not_before).getTime() : 0), 0);

  // Strikes = follow-ups SENT since the lead's last known reply (rows stamp
  // last_lead_at at draft time, so a reply in between restarts the count).
  const lastInboundMs = rows.reduce((m, r) => Math.max(m, r.last_lead_at ? new Date(r.last_lead_at).getTime() : 0), 0);
  const fuSent = rows.filter(r => (r.step_key || "").startsWith("followup_") && r.status === "sent"
    && new Date(r.sent_at || r.created_at).getTime() > lastInboundMs);

  if (fuSent.length >= strat.gaps.length) {
    // Cadence exhausted. Give the final follow-up `lostAfter` quiet days to land
    // a reply, then RECOMMEND Lost in Hawkeye (never move anyone silently).
    // Approving the Lost card marks the opp lost and auto-routes them to the
    // Nurture stage + Lead Nurture automation (existing confirm-lost path).
    // One skip from a human = permanent snooze for this lead (they own it now).
    const lastFuMs = fuSent.reduce((m, r) => Math.max(m, new Date(r.sent_at || r.created_at).getTime()), 0);
    const lostDueMs = Math.max(lastFuMs, holdUntil) + strat.lostAfter * DAY_MS;
    if (Date.now() < lostDueMs) return `all follow-ups sent - Lost suggestion on ${new Date(lostDueMs).toISOString().slice(0, 10)} if still quiet`;
    if (rows.some(r => r.kind === "closing_lost" && r.created_by === "followup-loop" && r.status === "skipped")) {
      return "lost recommendation was skipped by a human - leaving this lead alone";
    }
    const n = strat.gaps.length;
    await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      client_id: clientId, ghl_contact_id: String(contactId), contact_name: item.name || null,
      kind: "closing_lost", lost_reason: "Not locked in", draft_message: "",
      reasoning: `${n} follow-up${n === 1 ? "" : "s"} sent with no reply. Recommend marking Lost - on approve they auto-route to the Nurture stage + Lead Nurture texts (the long game).`,
      summary: `No response to ${n} personalized follow-up${n === 1 ? "" : "s"} after their trial.`,
      confidence: 1, last_lead_at: null, status: "pending", created_by: "followup-loop",
    }]) });
    return "lost-recommended";
  }

  // Draft the WHOLE remaining plan in one pass (Zoran: approve all follow-ups at
  // once). Strikes already sent this silence-streak shrink the plan: e.g. 1 sent
  // of a 2-message cadence -> a 1-message plan (followup_2 only).
  const gapsLeft = strat.gaps.slice(fuSent.length);
  const remaining = gapsLeft.length;
  const startK = fuSent.length + 1;
  const silenceDays = Math.max(0, Math.floor((Date.now() - new Date(item.last_at).getTime()) / DAY_MS));
  const schedDesc = gapsLeft.map((g, i) => i === 0
    ? `message 1 goes ${g} day${g === 1 ? "" : "s"} after our last message`
    : `message ${i + 1} goes ${g} day${g === 1 ? "" : "s"} after message ${i}`).join("; ");
  const seed = `[The lead has not replied to our last message${silenceDays ? ` (~${silenceDays} day(s) quiet)` : " yet"}. Draft the follow-up PLAN now so it's scheduled: ${remaining} short, warm message(s) that will send IF they stay quiet - ${schedDesc}; a reply at any point cancels the rest. Follow your follow-up timing guidance for what each message should say${remaining > 1 ? " (the first is a light did-you-see-my-message check-in; the final one asks if they're still interested and leaves the door open, no pressure)" : ""}. Re-read the conversation and the coach's post-trial notes in contact_memory. Every message must feel fresh (no repeats, different angles). A human approves the whole plan before anything sends.]`;
  const d = await draftForContact(token, locationId, clientId, contactId, cfg, {
    dts, conversationId: item.conversation_id, skipStageGuard: true, lastDirection: item.last_direction, seed,
    planMode: true, planTool: buildPlanTool(gapsLeft),
  });
  if (d.skip) return d.skip;
  if (d.error) return d.error;
  const texts = (d.plan || []).filter(t => t && t.trim()).slice(0, remaining);
  if (!texts.length) return "agent returned an empty plan";
  const nb = d.followup_on ? `${d.followup_on}T14:00:00Z` : null;
  // Planned send times, stamped at draft: cumulative day gaps from the last
  // message, with the first slot pushed to any decision date (the agent's
  // followup_on or a prior card's hold). The deck shows these dates; approve
  // keeps the spacing and just slides the plan forward if approved late.
  const anchorMs = new Date(item.last_at).getTime();
  const holdMs = Math.max(holdUntil || 0, nb ? new Date(nb).getTime() : 0);
  let plannedMs = 0;
  const planRows = texts.map((t, i) => {
    plannedMs = i === 0 ? Math.max(anchorMs + gapsLeft[0] * DAY_MS, holdMs) : plannedMs + gapsLeft[i] * DAY_MS;
    return {
      client_id: clientId, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
      contact_name: item.name || null, kind: "closing", step_key: `followup_${startK + i}`,
      draft_message: t,
      reasoning: i === 0 ? (d.reasoning || `Follow-up plan: ${texts.length} message(s) on the configured schedule.`) : `Plan message ${startK + i} of ${strat.gaps.length} - sends ${gapsLeft[i]} day${gapsLeft[i] === 1 ? "" : "s"} after the previous one if no reply.`,
      summary: i === 0 ? d.summary : null,
      confidence: d.confidence, trial_at: null,
      last_message: d.last_message || null, last_outbound: d.last_outbound || null,
      thread_tail: i === 0 ? d.thread_tail : null, reply_count: d.reply_count,
      followup_not_before: nb, send_after: new Date(plannedMs).toISOString(),
      status: "pending", created_by: "followup-plan",
    };
  });
  await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(planRows) });
  return "plan-drafted";
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
  // SAFETY NET (once per academy per cron, BEFORE the mode gate so it runs for every
  // V2 academy even with closing mode off): close any open agent-stage opp that
  // already belongs to a LIVE member + cancel its outbound. Catches the dup-contact
  // split and any opp whose signup won-mark missed the portal-native store - cases
  // the one-shot signup event can't reach. Portal-only + fail-soft; V1 untouched
  // (the cron only visits v2_access academies, and reconcile itself is portal-gated).
  // See api/agent/_reconcile-members.js.
  try {
    const rec = await reconcileLiveMembers(client.id);
    if (rec && Array.isArray(rec.closed) && rec.closed.length) {
      console.log(`[closing] reconcile closed ${rec.closed.length} paid-member opp(s) for ${client.id}:`, rec.closed.map(c => `${c.opp_id}(${c.via})`).join(", "));
    }
  } catch (_) { /* never block the detector on the safety net */ }

  const mode = closingAgentMode(client);
  if (!modeIsOn(mode)) return { client_id: client.id, skipped: "closing mode off" };
  const creds = await pickGhlToken(client);
  if (!creds) return { client_id: client.id, skipped: "no GHL token" };
  const { token, locationId } = creds;

  let dts, queue, doneIds, idsTrusted;
  try { ({ dts, queue, doneIds, idsTrusted } = await computeClosingQueue(token, locationId, { clientId: client.id, sb })); }
  catch (e) { return { client_id: client.id, error: `queue: ${e.message}` }; }
  if (!dts) return { client_id: client.id, skipped: "no Done-Trial stage" };
  // Trust "left the stage" to CANCEL a park only when the fetch succeeded and the
  // set is non-empty - an empty/blipped set must never permanently kill a park.
  const stageSetTrusted = idsTrusted !== false && doneIds.size > 0;

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
  // Approved follow-up PLAN steps ride this too: they sit 'approved' with
  // send_after staggered 1 day apart, and the flush delivers each when due.
  let flushed = 0;
  // Loaded before the flush so a held send at a MUTED lead is canceled, not sent.
  const mutedSet = await mutedContactIdSet(client.id, "closing");
  const _inboundLast = new Set(queue.filter(q => (q.last_direction || "") === "inbound").map(q => q.contact_id));
  if (withinQuietHours(new Date(), quietTz(client))) {
    try {
      const held = await sb(`agent_closing_replies?client_id=eq.${client.id}&status=eq.approved&send_after=lte.${new Date().toISOString()}&select=id,ghl_contact_id,draft_message,step_key&order=send_after.asc&limit=40`);
      for (const row of (Array.isArray(held) ? held : [])) {
        if (row.ghl_contact_id && mutedSet.has(String(row.ghl_contact_id))) {
          await sb(`agent_closing_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "bot muted on this lead", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (row.ghl_contact_id && !doneIds.has(row.ghl_contact_id)) {
          await sb(`agent_closing_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Done-Trial stage", updated_at: new Date().toISOString() }) });
          continue;
        }
        // A reply kills the rest of the plan - never send a scheduled follow-up on
        // top of a fresh inbound. The reactive path answers, then re-plans later.
        if ((row.step_key || "").startsWith("followup_") && _inboundLast.has(row.ghl_contact_id)) {
          await sb(`agent_closing_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "lead replied - plan canceled", updated_at: new Date().toISOString() }) });
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
  const strat = closingFollowupStrategy(client);
  cfg.strategy = strat;   // buildSystem reads it (trailer states the real cadence)

  // NEVER STARVE THE BACKLOG (Zoran 2026-07-09): DETECT_CAP used to slice a
  // newest-first queue, so once the top DETECT_CAP Done-Trial cards were carded,
  // every quiet lead past that position NEVER got a follow-up drafted - they sat
  // in Done Trial with us as the last message and nothing queued. Fix: pull every
  // LIVE closing card once, drop leads whose live card ALREADY covers their
  // current state (proactive carded = already queued; reactive whose pending card
  // already answers THIS inbound), and order the rest LONGEST-SILENT first so the
  // per-run cap always lands on cards that actually need one. Reactive leads with
  // a NEW inbound (newer than their card) stay in - a fresh reply must be answered.
  // (2026-07-09b: also drop reactive-already-answered leads - they were sorting to
  // the front every run and eating all 10 cap slots, re-starving the quiet tail.)
  let _cardByContact = new Map();
  try {
    const _live = await sb(`agent_closing_replies?client_id=eq.${client.id}&status=in.(pending,approved)&select=ghl_contact_id,last_lead_at,created_at&order=created_at.desc`);
    for (const r of (Array.isArray(_live) ? _live : [])) { const cid = String(r.ghl_contact_id || ""); if (cid && !_cardByContact.has(cid)) _cardByContact.set(cid, r); }
  } catch (_) {}
  queue = queue
    .filter(q => {
      const card = _cardByContact.get(String(q.contact_id || ""));
      if (!card) return true;                                                  // no live card -> needs one
      if ((q.last_direction || "") !== "inbound") return false;                // proactive + carded -> already queued
      const answered = card.last_lead_at && q.last_at && new Date(card.last_lead_at).getTime() === new Date(q.last_at).getTime();
      return !answered;                                                        // reactive: keep only a NEW inbound
    })
    .sort((a, b) => {
      const ar = (a.last_direction || "") === "inbound" ? 0 : 1;
      const br = (b.last_direction || "") === "inbound" ? 0 : 1;
      if (ar !== br) return ar - br;                                            // replies first
      if (ar === 0) return new Date(b.last_at || 0) - new Date(a.last_at || 0); // newest inbound first
      return new Date(a.last_at || 0) - new Date(b.last_at || 0);               // then oldest silence first
    });

  let drafted = 0, autoSent = 0, skipped = 0, escalated = 0, enrollsProposed = 0, lostProposed = 0, deferred = 0, reigniteProposed = 0, reignited = 0;
  const reasons = [];

  // 🔥 Reignition: the parked "we'll enroll later" set (the proactive opener +
  // follow-up loop below skip them) + fire due parks into a kind='reignite_due'
  // card on this deck. Fire-time guards: muted / left-Done-Trial parks cancel.
  const reignMap = await reigniteParkMap(client.id);
  const reignSet = new Set(reignMap.keys());
  for (const r of await dueReignitions(client.id, "closing")) {
    const cid = String(r.ghl_contact_id);
    if (mutedSet.has(cid)) { await markReignition(r.id, "canceled", { cancel_reason: "bot muted on this lead" }); reignSet.delete(cid); continue; }
    // Only cancel "left the stage" against a TRUSTED, non-empty set - a GHL blip
    // returning empty must not permanently kill a due park (no card, no retry).
    if (stageSetTrusted && !doneIds.has(cid)) { await markReignition(r.id, "canceled", { cancel_reason: "left Done-Trial stage" }); reignSet.delete(cid); continue; }
    try {
      await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
        client_id: client.id, ghl_contact_id: cid, contact_name: r.contact_name || null,
        kind: "reignite_due", draft_message: r.message, reignite_at: r.reignite_at,
        reasoning: r.reason ? `Reignition day - ${r.reason}` : "Reignition day - the lead asked us to circle back today.",
        confidence: 1, status: "pending", created_by: "reignition",
      }]) });
      await markReignition(r.id, "carded");
      reignSet.delete(cid); reignited++;
    } catch (e) { reasons.push(`reignite ${cid}: ${e.message}`); }   // active card in the way -> retry next run
  }

  let _first = true;
  for (const item of queue.slice(0, DETECT_CAP)) {
    if (!_first) await new Promise(r => setTimeout(r, 300));
    _first = false;
    const contactId = item.contact_id;
    if (!contactId) { skipped++; reasons.push(`${item.name || "?"}: no contactId`); continue; }
    if (mutedSet.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: bot muted on this lead`); continue; }
    // O6: never keep selling to a paid member. If the won-mark was skipped, a live
    // member can sit open in Done-Trial - skip them outright (independent of GHL won).
    if (await isLiveMember(client.id, contactId, token)) {
      // A paying member has no business sitting in Done Trial (Zoran, 2026-07-02):
      // close the loop - mark the opp WON (takes the card off the board) and
      // cancel any open closing cards for them.
      try {
        const oppRef = await findOpenOpp(client.id, token, locationId, contactId);
        if (oppRef) {
          await setStatus({ clientId: client.id, ghl, token, oppRef, status: "won", contactId, reason: "auto: already a paying member" });
          // Record the win like every other terminal path so it's counted in the
          // funnel (this auto-won branch previously wrote nothing - wins were
          // undercounted vs enroll/lost/abandoned which all log an outcome).
          const oppId = oppRef.ghlOpportunityId || oppRef.id || null;
          if (oppId) { try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: client.id, opportunity_id: oppId, status: "won", reason: "auto: already a paying member" }]) }); } catch (_) {} }
        }
        await clearClosingCards(client.id, contactId, "auto-won: already a paying member");
        await cancelReignitions(client.id, contactId, "already a paying member");
        skipped++; reasons.push(`${item.name || contactId}: paying member - auto-marked won`);
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: member auto-won failed - ${e.message}`); }
      continue;
    }

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

    if (reactive) {
      // A reply cancels whatever plan was scheduled AND any stale reply/enroll/
      // lost card drafted for an OLDER inbound: those made the dedup below skip
      // this lead every run, so the fresh message never got an answer and the
      // DETECT_CAP slot was burned for nothing. The card already drafted for
      // THIS inbound (same last_lead_at) survives, so re-runs don't churn it.
      try {
        const live = await sb(`agent_closing_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)&select=id,step_key,last_lead_at`);
        const inbMs = item.last_at ? new Date(item.last_at).getTime() : null;
        for (const row of (Array.isArray(live) ? live : [])) {
          const isPlan = String(row.step_key || "").startsWith("followup");
          const sameInbound = row.last_lead_at && inbMs != null && new Date(row.last_lead_at).getTime() === inbMs;
          if (!isPlan && sameInbound) continue;   // already drafted for THIS message
          await sb(`agent_closing_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: isPlan ? "lead replied - plan canceled" : "lead replied - re-drafting", updated_at: new Date().toISOString() }) });
        }
      } catch (_) {}
    }

    // PROACTIVE path (Zoran 2026-07-08: NO scripted automations in Done Trial - the
    // post-trial form's trainer text + optional sign-up link is the only preplanned
    // touch). Once the lead has been opened - by any closing card OR by the
    // post-trial form's first message - the quiet cadence belongs to the follow-up
    // loop: one AI-drafted plan at a time, and after FOLLOWUP_MAX unanswered
    // follow-ups it recommends Lost. A lead nobody has opened yet falls through to
    // the AI opener below (whose A6 guard skips it if the form already texted).
    if (!reactive) {
      let engaged = false;
      try {
        const ex = await sb(`agent_closing_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=id&limit=1`);
        engaged = Array.isArray(ex) && ex.length > 0;
      } catch (_) {}
      if (!engaged) {
        try {
          const rev = await sb(`post_trial_reviews?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=signup_text_status&order=created_at.desc&limit=1`);
          engaged = !!(Array.isArray(rev) && rev[0] && rev[0].signup_text_status === "sent");
        } catch (_) {}
      }
      if (engaged) {
        try {
          const fu = await maybeFollowUpOrNurture({ client, token, locationId, dts, cfg, item, contactId, strat });
          if (fu === "plan-drafted" || fu === "drafted") drafted++;
          else if (fu === "lost-recommended") { lostProposed++; reasons.push(`${item.name || contactId}: ${strat.gaps.length} follow-ups unanswered - Lost recommended in Hawkeye`); }
          else { skipped++; reasons.push(`${item.name || contactId}: ${fu}`); }
        } catch (e) { skipped++; reasons.push(`${item.name || contactId}: follow-up - ${e.message}`); }
        continue;
      }
    }

    try {
      // Dedupe. Reactive: skip if an active card exists or we already answered this
      // inbound. Proactive: skip if ANY closing card already exists (we've engaged).
      const existing = await sb(`agent_closing_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&order=created_at.desc&select=id,status,last_lead_at&limit=1`);
      const last = Array.isArray(existing) && existing[0];
      if (last && ["pending", "approved"].includes(last.status)) { skipped++; reasons.push(`${item.name || contactId}: already has a ${last.status} card`); continue; }
      // Skip = snooze (Zoran 2026-07-10): a skipped card re-drafts next run.
      if (reactive && last && last.status !== "skipped" && last.last_lead_at && item.last_at && new Date(last.last_lead_at).getTime() === new Date(item.last_at).getTime()) { skipped++; reasons.push(`${item.name || contactId}: already answered this inbound`); continue; }
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
      // Lead named a decision date → the follow-up loop won't nudge before ~10am
      // Toronto on that day (14:00 UTC). Null = default next-day cadence.
      followup_not_before: d.followup_on ? `${d.followup_on}T14:00:00Z` : null,
    };

    // Enroll: lead is ready → ALWAYS queue for a human. The card is just a REPLY
    // with the sign-up link (Zoran 2026-07-08): the link (with tracking params) is
    // embedded in the editable draft so the reviewer sees exactly what goes out.
    // The win still lands on payment via the enroll flow, not here.
    if (d.recommend_enroll) {
      try {
        let draft = (d.reply && String(d.reply).trim()) ? String(d.reply).trim() : "";
        try {
          const { signupUrl, enrollUrl } = await buildEnrollUrl(client.id, token, locationId, contactId);
          const base = signupUrl ? signupUrl.split("?")[0] : "";
          if (enrollUrl && !(base && draft.includes(base))) draft = [draft, enrollUrl].filter(Boolean).join("\n\n");
        } catch (_) {}
        await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "closing_enroll", enroll_note: d.enroll_note || null,
          draft_message: draft, status: "pending", created_by: "detector",
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

    // 🔥 Reignition proposal: "we'll enroll, but later" with a timeframe. ALWAYS
    // queue for a human - the card carries the editable ack (sends on ✓), the
    // pre-written future message, and the date. Nothing schedules until
    // confirm-reignite.
    if (d.reignite_at && d.reignite_message) {
      try {
        await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "reignite", reignite_at: d.reignite_at, reignite_message: d.reignite_message,
          draft_message: (d.reply && String(d.reply).trim()) ? d.reply : "", status: "pending", created_by: "detector",
        }]) });
        reigniteProposed++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: reignite-insert failed — ${e.message}`); }
      continue;
    }

    // Escalation: no message to send, but a human should see it.
    if (d.error || !d.reply || !String(d.reply).trim()) {
      if (d.escalate) {
        escalated++;
        try {
          // draft_message stays EMPTY: the card explains itself via
          // escalate_reason, and an empty draft can't be one-tap texted.
          await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            ...baseRow, kind: "closing", draft_message: "",
            escalate: true, escalate_reason: d.escalate_reason || null, status: "pending", created_by: "detector",
          }]) });
        } catch (_) {}
      } else { skipped++; reasons.push(`${item.name || contactId}: ${d.error || "empty reply"}`); }
      continue;
    }

    // A plain closing/nurture reply. Self-drive may auto-send high-confidence ones;
    // quiet hours hold until morning. Everything else queues for approval.
    const auto = shouldAutoSend(mode, { confidence: d.confidence, escalate: d.escalate });
    if (auto && !withinQuietHours(new Date(), quietTz(client))) {
      try {
        await sb(`agent_closing_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          ...baseRow, kind: "closing", draft_message: d.reply, status: "approved", send_after: nextSendableTime(new Date(), quietTz(client)).toISOString(), created_by: "self-drive",
        }]) });
        deferred++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: defer-insert failed — ${e.message}`); }
    } else if (auto) {
      try {
        await sendReplyViaGhl(token, contactId, d.reply, client.id);
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
  const summary = { client_id: client.id, business: client.business_name, mode, queued: queue.length, drafted, enrolls_proposed: enrollsProposed, lost_proposed: lostProposed, reignite_proposed: reigniteProposed, reignited, auto_sent: autoSent, deferred, flushed, escalated, skipped, pruned, reasons };
  // Persist the run summary - cron responses vanish, so per-lead skip reasons
  // were invisible. Read the latest via:
  //   select payload from automation_events where type='closing_detect_summary'
  //   order by created_at desc limit 1;
  try {
    await sb(`automation_events`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      client_id: client.id, contact_id: "detector", automation_id: null,
      type: "closing_detect_summary", payload: summary,
    }]) });
  } catch (_) { /* observability only - never block the run */ }
  return summary;
}

async function runDetect(res, onlyClientId) {
  let clients = [];
  try {
    clients = onlyClientId
      ? [await loadClient(onlyClientId)].filter(Boolean)
      : await sb(`clients?select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,time_zone&v2_access=eq.true`);
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
      // Read-time paying-member gate: a signed-up lead (live member) must never sit
      // in the Closing deck - not even with the won-mark skipped (the returning-enroll
      // silent path). Hide instantly at read time; the signup sweep + detector clear
      // the rows. Match on ghl_contact_id. Fail open.
      try {
        const liveIds = await liveMemberContactIds(clientId);
        if (liveIds.size) list = list.filter(r => !r.ghl_contact_id || !liveIds.has(String(r.ghl_contact_id)));
      } catch (_) { /* fail open */ }
      return res.status(200).json({ ready: list, count: list.length });
    }
    if (b.action === "skip-ready") {
      if (!b.ready_id) return res.status(400).json({ error: "ready_id required" });
      await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped", updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }

    // NOTE: the "automations-get"/"automations-set" editor actions are gone with the
    // scripted sequence (Zoran 2026-07-08) - Done Trial has no preplanned automations.
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
      cfg.strategy = closingFollowupStrategy(client);
      const d = await draftForContact(token, locationId, clientId, b.contact_id, cfg);
      if (d.error) return res.status(200).json({ error: d.error });
      if (d.skip) return res.status(200).json({ skip: d.skip });
      return res.status(200).json(d);
    }

    // Approve the whole follow-up PLAN in one tap: each pending followup_N row
    // gets the (possibly edited) text and its send_after locked in. The rows
    // carry planned times stamped at draft (cadence gaps from the last message);
    // approval KEEPS that spacing and just slides the whole plan forward if the
    // first slot already passed (late approval never collapses the gaps). The
    // detector's flush delivers each when due; a reply cancels the rest.
    if (b.action === "approve-plan") {
      if (!b.contact_id || !Array.isArray(b.edits) || !b.edits.length) return res.status(400).json({ error: "contact_id and edits required" });
      const dtsP = await doneTrialStage(token, locationId, { clientId, sb });
      if (!dtsP || !(await contactInRespondedStage(token, locationId, b.contact_id, dtsP, { clientId, sb, role: "done_trial" }))) {
        return res.status(409).json({ error: "This lead is no longer in the Done-Trial stage - not scheduling." });
      }
      let planRows = await sb(`agent_closing_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(b.contact_id)}&status=eq.pending&select=id,step_key,followup_not_before,send_after&order=created_at.asc`);
      planRows = (Array.isArray(planRows) ? planRows : []).filter(r => (r.step_key || "").startsWith("followup_"));
      if (!planRows.length) return res.status(404).json({ error: "no pending follow-up plan for this lead" });
      const editById = new Map(b.edits.map(e => [String(e.id), String(e.reply || "").trim()]));
      // Staff can move any single step's send day right in the deck (YYYY-MM-DD).
      // Stamped at 14:00 UTC to match the cadence/decision-date convention; the
      // quiet-hours guard below still slides it to the next sendable morning if
      // needed. A row with no override keeps its cadence spacing + late slide.
      const whenById = new Map(b.edits
        .filter(e => e && typeof e.send_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.send_at))
        .map(e => [String(e.id), `${e.send_at}T14:00:00Z`]));
      // The lead's decision date (if the agent extracted one) pushes the whole plan.
      const holdMs = planRows.reduce((m, r) => Math.max(m, r.followup_not_before ? new Date(r.followup_not_before).getTime() : 0), 0);
      const kept = planRows.filter(r => editById.get(String(r.id)));
      // Slide = how far past the first KEPT slot we are (0 when approved on time).
      // Rows drafted before planned times existed fall back to day-apart spacing.
      const firstPlanned = kept.length && kept[0].send_after ? new Date(kept[0].send_after).getTime() : 0;
      const slide = Math.max(0, Date.now() - (firstPlanned || Date.now()), holdMs - (firstPlanned || Date.now()));
      let scheduled = 0, dropped = 0, dayIdx = 0;
      for (const row of planRows) {
        const text = editById.get(String(row.id));
        if (!text) {
          // An emptied box = drop that step from the plan.
          try { await sb(`agent_closing_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped", updated_at: new Date().toISOString() }) }); } catch (_) {}
          dropped++;
          continue;
        }
        const override = whenById.get(String(row.id));
        const plannedMs = override
          ? new Date(override).getTime()   // staff picked this day - use it as-is (no slide)
          : row.send_after
            ? new Date(row.send_after).getTime() + slide
            : Math.max(Date.now(), holdMs || 0) + dayIdx * 86400000;
        const sendAfter = nextSendableTime(new Date(plannedMs), quietTz(client)).toISOString();
        await sb(`agent_closing_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
          status: "approved", draft_message: text, send_after: sendAfter,
          approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }) });
        scheduled++; dayIdx++;
      }
      return res.status(200).json({ ok: true, scheduled, dropped });
    }

    if (b.action === "send") {
      if (!b.contact_id || !b.reply || !String(b.reply).trim()) return res.status(400).json({ error: "contact_id and reply required" });
      // Never text an internal note at a parent (legacy escalation rows seeded a
      // sendable "(agent escalated ...)" placeholder as the draft).
      if (/^\((agent escalated|post-trial review needed)/i.test(String(b.reply).trim())) {
        return res.status(400).json({ error: "That's an internal note, not a message - write the reply you want to send." });
      }
      // HARD GUARD: only send to a lead still in the Done-Trial stage.
      const dts = await doneTrialStage(token, locationId, { clientId, sb });
      if (!dts || !(await contactInRespondedStage(token, locationId, b.contact_id, dts, { clientId, sb, role: "done_trial" }))) {
        return res.status(409).json({ error: "This lead is no longer in the Done-Trial stage - not sending." });
      }
      // Quiet hours: hold an after-hours approval until morning.
      if (!withinQuietHours(new Date(), quietTz(client))) {
        const sendAfter = nextSendableTime(new Date(), quietTz(client)).toISOString();
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

    // Fire an already-drafted/approved follow-up RIGHT NOW instead of waiting for
    // its scheduled send_after. Same guards as the flush + send paths: the lead
    // must still be in Done-Trial, the bot mustn't be muted on them, and an
    // after-hours "send now" defers to the morning window (never texts a parent at
    // night). Works on a pending OR approved followup_N plan row.
    if (b.action === "send-now") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      const [row] = await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.id)}&client_id=eq.${clientId}&select=*`);
      if (!row) return res.status(404).json({ error: "not found" });
      if (!["pending", "approved"].includes(row.status)) return res.status(409).json({ error: `already ${row.status}` });
      // Staff may tweak the text in the box before firing; fall back to the draft.
      const text = (b.reply && String(b.reply).trim()) ? String(b.reply).trim() : String(row.draft_message || "").trim();
      if (!text) return res.status(400).json({ error: "nothing to send - this card has no drafted message" });
      if (/^\((agent escalated|post-trial review needed)/i.test(text)) {
        return res.status(400).json({ error: "That's an internal note, not a message - write the reply you want to send." });
      }
      // HARD GUARD: only send to a lead still in the Done-Trial stage.
      const dts = await doneTrialStage(token, locationId, { clientId, sb });
      if (!dts || !(await contactInRespondedStage(token, locationId, row.ghl_contact_id, dts, { clientId, sb, role: "done_trial" }))) {
        return res.status(409).json({ error: "This lead is no longer in the Done-Trial stage - not sending." });
      }
      if (row.ghl_contact_id && await isMuted(clientId, row.ghl_contact_id, "closing")) {
        return res.status(409).json({ error: "bot is muted on this lead - not sending." });
      }
      // Quiet hours: a human hit "send now" after hours. Don't text now - approve it
      // and reschedule to the morning so the flush delivers it in-window (keeps any edit).
      if (!withinQuietHours(new Date(), quietTz(client))) {
        const sendAfter = nextSendableTime(new Date(), quietTz(client)).toISOString();
        await sb(`agent_closing_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", draft_message: text, send_after: sendAfter, approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
        return res.status(200).json({ ok: true, sent: false, deferred: true, send_after: sendAfter });
      }
      try { await sendReplyViaGhl(token, row.ghl_contact_id, text, clientId); }
      catch (e) { return res.status(e.status || 502).json({ error: `GHL send: ${e.message}` }); }
      await sb(`agent_closing_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", draft_message: text, approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      try { await logApproval({ client_id: clientId, ghl_contact_id: row.ghl_contact_id, contact_name: row.contact_name || null, final_reply: text, reasoning: row.reasoning || null, confidence: typeof row.confidence === "number" ? row.confidence : null, status: "sent", created_by: staffEmail }); } catch (_) {}
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
      // HARD GUARD (mirrors "send"): only enroll a lead still in the Done-Trial
      // stage, and never re-pitch a paying member (the won-mark can be skipped -
      // same case as the detector's O6 guard). A stale enroll card must not text
      // a sign-up link at someone who already left the stage or already pays.
      const dtsE = await doneTrialStage(token, locationId, { clientId, sb });
      if (!dtsE || !(await contactInRespondedStage(token, locationId, contactId, dtsE, { clientId, sb, role: "done_trial" }))) {
        return res.status(409).json({ error: "This lead is no longer in the Done-Trial stage - not sending the link." });
      }
      if (await isLiveMember(clientId, contactId, token)) {
        return res.status(409).json({ error: "This lead is already a paying member - no sign-up link needed." });
      }
      // Resolve the sign-up link (with tracking params). The opp status does NOT
      // change here - the enroll flow's webhook owns the win on real payment.
      const { signupUrl, enrollUrl, oppId } = await buildEnrollUrl(clientId, token, locationId, contactId);
      const draft = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      // The detector now embeds the link in the draft ("just a reply with the link",
      // Zoran 2026-07-08) - only append when the (possibly edited) draft lost it.
      const base = signupUrl ? signupUrl.split("?")[0] : "";
      const parts = [];
      if (draft.trim()) parts.push(draft.trim());
      if (enrollUrl && !(base && draft.includes(base))) parts.push(enrollUrl);
      const msg = parts.join("\n\n");
      if (msg.trim()) { try { await sendReplyViaGhl(token, contactId, msg, clientId); } catch (e) { return res.status(e.status || 502).json({ error: `send failed: ${e.message}` }); } }
      // Note for the team + the agent's own memory (so it won't re-pitch): the link
      // went out; the win lands when they pay, via the enroll flow.
      const note = (b.enroll_note || (row && row.enroll_note) || "").toString().slice(0, 300);
      try {
        await sb(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: clientId, ghl_contact_id: String(contactId), active: true,
          note: `Enrollment link sent (closing agent)${note ? ` - ${note}` : ""}. Awaiting payment: the enroll flow creates the member + marks this won when they pay.`,
          created_by: staffEmail || "closing-agent",
        }]) });
      } catch (_) {}
      try { if (oppId) await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "enroll_link_sent", reason: note || null }]) }); } catch (_) {}
      try { await logApproval({ client_id: clientId, ghl_contact_id: contactId, ghl_conversation_id: b.conversation_id || (row && row.ghl_conversation_id) || null, contact_name: b.contact_name || (row && row.contact_name) || null, final_reply: msg || "[enroll link sent]", status: "sent", created_by: staffEmail }); } catch (_) {}
      if (b.ready_id) {
        try { await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      await clearClosingCards(clientId, contactId, "enroll link sent");
      await cancelReignitions(clientId, contactId, "enroll link sent");
      return res.status(200).json({ ok: true, enrolled: true, link_sent: !!signupUrl, opportunity_id: oppId, won_on: "payment" });
    }

    // 🔥 Confirm a Reignition: send the (editable) ack now, then park the lead in
    // place (agent_reignitions) with the date + the pre-written re-engagement
    // message. The lead STAYS in Done-Trial; the detect cron fires the message as
    // a reignite_due card on this deck when the date arrives.
    if (b.action === "confirm-reignite") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
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
          agent: "closing", reigniteAt, message,
          reason: (typeof b.reason === "string" && b.reason.trim()) || (row && row.reasoning) || null,
          source: row && row.kind === "reignite" ? "agent" : "manual", createdBy: staffEmail,
        });
      } catch (e) { return res.status(500).json({ error: `couldn't schedule: ${e.message}` }); }
      // Optional teach-why lesson (an edited date/message trains the agent).
      let lessonId = null;
      if (b.lesson && String(b.lesson).trim()) {
        try {
          const [lrow] = await sb(`agent_lessons`, { method: "POST", headers: { Prefer: "return=representation" },
            body: JSON.stringify([{ client_id: clientId, agent: "closing", kind: "fix", scope: "academy", lesson: String(b.lesson).trim(), created_by: staffEmail, stage_from: LESSON_STAGE_FROM, thread_snapshot: threadSnapshot(row), context: { contact_id: contactId, reignite_at: reigniteAt, sent: ack || null } }]) });
          lessonId = lrow?.id || null;
        } catch (_) {}
      }
      // Truthful bookkeeping: acted-on row 'sent' only when the ack went out.
      if (b.ready_id) {
        const done = ackSent
          ? { status: "sent", reignite_at: reigniteAt, reignite_message: message, approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : { status: "canceled", send_error: "parked for reignition", reignite_at: reigniteAt, reignite_message: message, approved_by: staffEmail, updated_at: new Date().toISOString() };
        try { await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(done) }); } catch (_) {}
      }
      await clearClosingCards(clientId, contactId, "parked for reignition");
      try { await logApproval({ client_id: clientId, ghl_contact_id: contactId, contact_name: (row && row.contact_name) || null, final_reply: `[reignite ${reigniteAt.slice(0, 10)}]${ackSent ? " + ack sent" : ""}`, reasoning: (row && row.reasoning) || null, status: "sent", created_by: staffEmail }); } catch (_) {}
      return res.status(200).json({ ok: true, scheduled_for: reigniteAt, ack_sent: ackSent, lesson_id: lessonId, reignition_id: (parkRow && parkRow.id) || null });
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
          // Route per the academy's authored flow. TWO distinct triggers land here
          // (2026-07-21): a followup-loop card means the lead GHOSTED every closing
          // follow-up -> the done_trial ghosted_ran_out edge; everything else is an
          // explicit decline -> the says_no edge. Both seed to nurture, so GTA is
          // behavior-identical - but academies can now re-point them separately.
          // Paused-aware: a paused edge returns matched but not moved, so we
          // respect the pause and fall through to LOST. No edge -> original
          // hardcoded move to nurture (GTA-identical).
          const trigger = (row && row.created_by === "followup-loop") ? "ghosted_ran_out" : "says_no";
          const routed = await routeTransition({ clientId, sb, ghl, token, locationId, fromRole: "done_trial", trigger, contactId, oppRef, reason });
          if (routed.matched) {
            if (routed.moved) { await enrollContact({ clientId, automationKey: "nurture", contactId }); routedToNurture = true; }
          } else {
            const ns = await nurtureStage(token, locationId, { clientId, sb });
            if (ns) {
              await moveStage({ clientId, ghl, token, oppRef, stage: ns, role: "nurture", contactId, reason });
              await enrollContact({ clientId, automationKey: "nurture", contactId });
              routedToNurture = true;
            }
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
        try { await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(done) }); } catch (_) {}
      }
      await clearClosingCards(clientId, contactId, "marked lost");
      await cancelReignitions(clientId, contactId, routedToNurture ? "moved to nurture" : "marked lost");
      return res.status(200).json({ ok: true, marked_lost: !routedToNurture, routed_to_nurture: routedToNurture, opportunity_id: oppId, reason, goodbye_requested: goodbyeRequested, goodbye_sent: goodbyeSent, goodbye_error: goodbyeError });
    }

    // Mark Unqualified (Zoran 2026-07-08: every agent can mark unqualified). The
    // dead end: close the opp (abandoned + role unqualified), stamp the GHL
    // `unqualified` tag, log the outcome, drop the closing cards. No nurture, no
    // message. Mirrors agent-approvals' confirm-abandoned.
    if (b.action === "confirm-abandoned") {
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
        try { await sb(`agent_closing_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(done) }); } catch (_) {}
      }
      await clearClosingCards(clientId, contactId, "marked unqualified");
      await cancelReignitions(clientId, contactId, "marked unqualified");
      return res.status(200).json({ ok: true, marked_abandoned: true, unqualified: true, opportunity_id: oppId, reason, goodbye_requested: goodbyeRequested, goodbye_sent: goodbyeSent, goodbye_error: goodbyeError });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-closing]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
