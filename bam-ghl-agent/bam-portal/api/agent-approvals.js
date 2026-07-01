import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Bot Approval Queue (responded-stage booking agent)
//
//   POST /api/agent-approvals  { action, ... }   (staff bearer required)
//     "list"  { client_id? }                 → contacts in the "responded" stage
//                                               whose last message is inbound (need a reply)
//     "draft" { client_id?, contact_id }      → the agent's proposed next reply +
//                                               reasoning / confidence / counts
//     "send"  { client_id?, contact_id, reply, suggested_reply?, reasoning?,
//               confidence?, adjusted?, lesson?, conversation_id? }
//                                             → sends the (human-approved) reply via GHL,
//                                               logs it, and optionally saves a learning
//
// The agent's ONLY job here is to book a free trial for a lead in the Responded
// stage. Every send is human-approved (no autonomy). Learnings default to
// scope 'academy' (stay with this academy).

import { pickGhlToken, ghl, sendSms } from "./ghl/_core.js";
import { maybeSendSmsViaProvider, smsProvider } from "./messaging/provider.js";
import { readStoreThreadAgent } from "./messaging/read-thread.js";
import { assemblePrompt } from "./agent/prompt-structure.js";
import { buildAgentSystem } from "./agent/brain.js";
import { loadMergedOverrides } from "./agent/_sections.js";
import { loadContactMemory } from "./agent/contact-memory.js";
import { loadCalendars, calendarForGroup, freeSlots, summarizeSlots } from "./agent/booking.js";
import { respondedStage, contactInRespondedStage, computeQueue, respondedContactIdSetCached, peekRespondedIdSet, interestedStage, nurtureStage, scheduledTrialStage, toIso } from "./agent/_stage.js";
import { markUnqualified, unmarkUnqualified } from "./agent/_tags.js";
import { enrollContact, isAutomationLive } from "./automations.js";
import { moveStage, setStatus } from "./agent/_store.js";
import { agentMode, modeIsOn, shouldAutoSend } from "./agent/_mode.js";
import { mutedContactIdSet, isMuted } from "./agent/_mutes.js";
import { withinQuietHours, nextSendableTime } from "./agent/_quiet.js";
import { resolveAgentActor } from "./agent/_auth.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";
const DEFAULT_CLIENT_ID    = "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA
const DETECT_CAP           = 10;   // max ready replies drafted per academy per run
const OPENER_CAP           = 5;    // max cold openers drafted per academy per run

const BOOK_ASK = /(would you like to|want to|wanna|do you want to|happy to have you|can you make it|are you free).*(come|book|try|drop by|stop by|swing by|check|visit|session)|come (by|in|on (in|by)|and (see|try|check)|check (it|us) out)|check (it|us) out|book(ing)? (a|the|your|in)?\s*(free\s*)?(trial|session|spot)|(grab|reserve|save) (a|the|your)?\s*spot|see if it'?s a (good )?fit|pop (by|in)|see you (there|then)/i;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function requireStaff(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` } });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id) return null;
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  return Array.isArray(staff) && staff[0] ? (user.email || "staff") : null;
}

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
  return Array.isArray(rows) && rows[0];
}

// ── agent config (same brain as the sandbox) ──
async function loadConfig(clientId) {
  const [lessons, overrides, exRows] = await Promise.all([
    sb(`agent_lessons?client_id=eq.${clientId}&agent=eq.booking&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
    loadMergedOverrides(clientId),   // global brain (general/goal) + this academy's own (location/offer)
    sb(`agent_examples?client_id=eq.${clientId}&agent=eq.booking&select=parent_text,agent_text&order=created_at.asc`).catch(() => []),
  ]);
  return { lessons: Array.isArray(lessons) ? lessons : [], overrides, examples: Array.isArray(exRows) ? exRows : [] };
}

const LIVE_BOOKING_TRAILER =
  `<live_booking>\n` +
  `You are drafting the next SMS to a REAL lead who just replied and is in the "Responded" stage. Your single goal is to book them into a free trial. A human reviews your draft before it sends. ` +
  `CONFIRM BEFORE BOOKING: when the lead offers or agrees to a day/time, do NOT book it yet - first ASK them to confirm you should book it (for example "Want me to lock that in and book it for you?"). Only set book=true AFTER they clearly say yes to you booking it (e.g. "yes please", "go ahead"). If they have only named a time but not yet okayed you booking it, your reply IS that confirmation question, with book=false. ` +
  `Respond ONLY by calling propose_reply: 'reply' = the exact text to send; 'reasoning' = 1-2 sentence why; 'confidence' = 0..1; ` +
  `'asked_to_book' = true if your reply invites them to book/come in; 'escalate' = true (with 'escalate_reason', reply empty) if your guardrails say to hand to a human instead of replying. ` +
  `If your lost_criteria say this lead should be closed out, set 'recommend_lost' = true with a short 'lost_reason' from the taxonomy, and put your warm closing message in 'reply' (a human confirms the Lost before anything changes).\n</live_booking>`;
function buildSystem({ lessons, overrides, examples }) {
  return buildAgentSystem({ lessons, overrides, examples, trailer: LIVE_BOOKING_TRAILER });
}

// Cold opener: the lead entered with context (see <contact_memory>) but has NOT
// messaged yet (e.g. filled the free-trial form, never picked a time). The Booking
// agent opens the conversation. Same propose_reply contract as a live reply.
const OPENER_TRAILER =
  `<live_booking>\n` +
  `You are writing the FIRST outbound SMS to a REAL lead who entered with context (see <contact_memory>) but has NOT messaged yet - for example they filled out the free-trial form but never picked a time. Open the conversation warmly and like a real coach texting (short, human, no corporate tone), reference what they did so it doesn't feel automated, and your single goal is to get them booked into a free trial. A human reviews your draft before it sends. ` +
  `Respond ONLY by calling propose_reply: 'reply' = the exact opening text to send; 'reasoning' = 1-2 sentence why; 'confidence' = 0..1; 'asked_to_book' = true if your message invites them to book or come in; 'escalate' = true (reply empty) only if you genuinely cannot draft an opener from the context.\n</live_booking>`;
function buildOpenerSystem({ lessons, overrides, examples }) {
  return buildAgentSystem({ lessons, overrides, examples, trailer: OPENER_TRAILER });
}

const REPLY_TOOL = {
  name: "propose_reply",
  description: "Propose the agent's next text to the lead (a human approves before it sends).",
  input_schema: {
    type: "object",
    properties: {
      reply:           { type: "string", description: "The exact text to send. Empty if escalating." },
      summary:         { type: "string", description: "A 2-3 sentence plain-English summary of the conversation so far for a human reviewer — who the lead is, what they want, and where things stand. Not your reasoning; the story of the chat." },
      reasoning:       { type: "string", description: "Short (1-2 sentences) why / current stage." },
      confidence:      { type: "number", description: "0..1 confidence this is the right reply." },
      asked_to_book:   { type: "boolean", description: "True if this reply invites the lead to book or come in." },
      escalate:        { type: "boolean", description: "True if guardrails say to hand to a human instead of replying." },
      escalate_reason: { type: "string", description: "If escalate: why." },
      recommend_lost:  { type: "boolean", description: "True if your lost_criteria say this lead should be marked Lost (a human confirms it)." },
      lost_reason:     { type: "string", description: "If recommend_lost: the closest taxonomy reason (Too expensive / Not enough time / Started other programs / Not locked in / Bad fit / Invalid lead / Opted out / Other)." },
      book:            { type: "boolean", description: "True if you are BOOKING the lead into a free trial — ONLY after ALL of: (1) they confirmed a specific day/time, (2) you verified that exact slot is open via check_availability, AND (3) they explicitly said yes to YOU booking it for them (you asked 'want me to book it for you?' and they agreed). If you have a time but have NOT yet gotten that yes, set book=false and make your reply the confirmation question instead. A human approves before it's created. Your 'reply' is the confirmation you'd send." },
      book_group:      { type: "string", description: "If book: the group by athlete age — 'Group 1' (elementary, 9-13) or 'Group 2' (high school, 14+)." },
      book_slot_at:    { type: "string", description: "If book: the EXACT ISO datetime of the open slot the lead confirmed (must be one of the open_slots from check_availability)." },
    },
    required: ["reply", "reasoning", "confidence", "escalate"],
  },
};

// Read-only availability tool the agent can call mid-draft before proposing a booking.
const CHECK_AVAILABILITY = {
  name: "check_availability",
  description: "Check open free-trial slots for a group's calendar before you book. Pick the group by the athlete's age. Returns upcoming open ISO datetimes.",
  input_schema: {
    type: "object",
    properties: {
      group:       { type: "string", description: "'Group 1' (elementary, ages 9-13) or 'Group 2' (high school, 14+)." },
      within_days: { type: "number", description: "How many days ahead to look (default 14)." },
    },
    required: ["group"],
  },
};

async function runCheckAvailability(input, bookingCtx) {
  try {
    const cal = calendarForGroup(bookingCtx.calendars, input.group);
    if (!cal) return { error: `No calendar found for ${input.group}.` };
    const { days } = await freeSlots(bookingCtx.token, cal.key, { days: input.within_days || 14, timezone: bookingCtx.timezone });
    return { group: input.group, calendar_id: cal.key, open_slots: summarizeSlots(days) };
  } catch (e) { return { error: `availability check failed: ${e.message}` }; }
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

// The agent's draft turn. When the academy has trial calendars (bookingCtx), the
// agent can call check_availability (a live read) before proposing — a tool-use
// loop. propose_reply is always terminal. With no calendars it behaves exactly
// as before (single forced propose_reply call).
async function runAgent(system, messages, bookingCtx = null) {
  const convo = messages
    .filter(m => m && typeof m.text === "string" && m.text.trim() !== "")
    .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text }));
  while (convo.length && convo[convo.length - 1].role === "assistant") convo.pop();
  if (!convo.length) throw new Error("no inbound message to reply to");

  const canBook = !!(bookingCtx && Array.isArray(bookingCtx.calendars) && bookingCtx.calendars.length);
  const tools = canBook ? [REPLY_TOOL, CHECK_AVAILABILITY] : [REPLY_TOOL];

  for (let i = 0; i < 4; i++) {
    const forceReply = !canBook || i === 3;
    const data = await anthropicCall({
      model: ANTHROPIC_MODEL, max_tokens: 1024, system, tools,
      tool_choice: forceReply ? { type: "tool", name: "propose_reply" } : { type: "auto" },
      messages: convo,
    });
    const content = data.content || [];
    const reply = content.find(b => b.type === "tool_use" && b.name === "propose_reply");
    if (reply?.input) return reply.input;
    const avail = content.find(b => b.type === "tool_use" && b.name === "check_availability");
    if (avail) {
      convo.push({ role: "assistant", content });
      const result = await runCheckAvailability(avail.input, bookingCtx);
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: avail.id, content: JSON.stringify(result).slice(0, 3000) }] });
      continue;
    }
    // Text-only (no tool) — nudge it to use propose_reply next round.
    convo.push({ role: "assistant", content: content.length ? content : "…" });
    convo.push({ role: "user", content: "Call propose_reply now with your message." });
  }
  throw new Error("no structured reply from Claude (tool loop)");
}

// The opener turn: no inbound thread - seed a single instruction so the agent
// drafts a FIRST outbound from <contact_memory>. Same check_availability loop +
// forced propose_reply as runAgent.
async function runOpener(system, bookingCtx = null) {
  const canBook = !!(bookingCtx && Array.isArray(bookingCtx.calendars) && bookingCtx.calendars.length);
  const tools = canBook ? [REPLY_TOOL, CHECK_AVAILABILITY] : [REPLY_TOOL];
  const convo = [{ role: "user", content: "Write your FIRST outbound text to this lead now, using what you know from the context above. They have not messaged yet, so open the conversation and move toward booking a free trial." }];
  for (let i = 0; i < 4; i++) {
    const forceReply = !canBook || i === 3;
    const data = await anthropicCall({
      model: ANTHROPIC_MODEL, max_tokens: 1024, system, tools,
      tool_choice: forceReply ? { type: "tool", name: "propose_reply" } : { type: "auto" },
      messages: convo,
    });
    const content = data.content || [];
    const reply = content.find(b => b.type === "tool_use" && b.name === "propose_reply");
    if (reply?.input) return reply.input;
    const avail = content.find(b => b.type === "tool_use" && b.name === "check_availability");
    if (avail) {
      convo.push({ role: "assistant", content });
      const result = await runCheckAvailability(avail.input, bookingCtx);
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: avail.id, content: JSON.stringify(result).slice(0, 3000) }] });
      continue;
    }
    convo.push({ role: "assistant", content: content.length ? content : "…" });
    convo.push({ role: "user", content: "Call propose_reply now with your opening message." });
  }
  throw new Error("no structured opener from Claude (tool loop)");
}

// ── GHL thread helpers ──
async function findConversation(token, locationId, contactId) {
  const params = new URLSearchParams({ locationId, contactId });
  const search = await ghl("GET", `/conversations/search?${params}`, { token });
  return (search.conversations || search.data || [])[0] || null;
}
async function threadMessages(token, conversationId) {
  const data = await ghl("GET", `/conversations/${encodeURIComponent(conversationId)}/messages`, { token });
  const raw = data.messages?.messages || data.messages || data.data || [];
  // GHL returns newest-first sometimes — sort ascending by date.
  const msgs = raw.map(m => ({
    text: m.body || m.message || "",
    direction: (m.direction || "").toLowerCase(),
    date: m.dateAdded || m.createdAt || m.timestamp || null,
  })).filter(m => m.text);
  msgs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  return msgs.map(m => ({ role: m.direction === "outbound" ? "agent" : "parent", text: m.text, date: m.date }));
}

// Draft the agent's next reply for one Responded-stage contact. Returns the
// structured proposal (reply/reasoning/confidence/escalate/…) or { error }.
// Shared by the on-demand `draft` action and the `detect` cron. opts lets the
// detector skip GHL calls it already made via computeQueue (stage check +
// conversation lookup) to stay well under GHL's rate limit:
//   { rs, conversationId, skipStageGuard }
async function draftForContact(token, locationId, clientId, contactId, cfg, opts = {}) {
  const rs = opts.rs || await respondedStage(token, locationId, { clientId, sb });
  if (!rs) return { error: "No Responded stage found in the Training Pipeline." };
  if (!opts.skipStageGuard && !(await contactInRespondedStage(token, locationId, contactId, rs, { clientId, sb }))) {
    return { error: "This lead isn't in the Responded stage — the bot only replies to Responded-stage leads." };
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
  const system = buildSystem(cfg) + await loadContactMemory(sb, clientId, contactId, { ghl, token, locationId });
  const calendars = await loadCalendars(sb, clientId);
  const out = await runAgent(system, messages, { calendars, token, timezone: "America/Toronto" });
  const agentMsgs = messages.filter(m => m.role === "agent");
  // A booking proposal: the agent set book=true with a concrete slot it verified.
  const bookCal = (out.book && out.book_slot_at && out.book_group) ? calendarForGroup(calendars, out.book_group) : null;
  const book = !!(out.book && out.book_slot_at && bookCal);
  return {
    conversation_id: conversationId,
    reply: out.reply || "",
    reasoning: out.reasoning || "",
    confidence: typeof out.confidence === "number" ? out.confidence : null,
    escalate: !!out.escalate,
    escalate_reason: out.escalate_reason || null,
    asked_to_book: !!out.asked_to_book || BOOK_ASK.test(out.reply || ""),
    recommend_lost: !!out.recommend_lost,
    lost_reason: out.lost_reason || null,
    book,
    book_group: book ? out.book_group : null,
    book_slot_at: book ? out.book_slot_at : null,
    book_calendar_id: book ? bookCal.key : null,
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    last_message: (() => { const lead = [...messages].reverse().find(m => m.role === "parent"); return lead ? String(lead.text).slice(0, 500) : null; })(),
    last_outbound: (() => { const ours = [...messages].reverse().find(m => m.role === "agent"); return ours ? String(ours.text).slice(0, 500) : null; })(),
    thread_tail: messages.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "lead", text: String(m.text).slice(0, 320), at: toIso(m.date) })),
    reply_count: agentMsgs.length,
    booking_asks: agentMsgs.filter(m => BOOK_ASK.test(m.text)).length,
  };
}

// Draft a cold OPENER for a Responded lead that entered with context but hasn't
// messaged (no thread). Returns the structured proposal or throws.
async function draftOpener(token, locationId, clientId, contactId, cfg, calendars) {
  const system = buildOpenerSystem(cfg) + await loadContactMemory(sb, clientId, contactId, { ghl, token, locationId });
  const out = await runOpener(system, { calendars: calendars || [], token, timezone: "America/Toronto" });
  const bookCal = (out.book && out.book_slot_at && out.book_group) ? calendarForGroup(calendars || [], out.book_group) : null;
  const book = !!(out.book && out.book_slot_at && bookCal);
  return {
    reply: out.reply || "",
    reasoning: out.reasoning || "",
    confidence: typeof out.confidence === "number" ? out.confidence : null,
    escalate: !!out.escalate,
    asked_to_book: !!out.asked_to_book || BOOK_ASK.test(out.reply || ""),
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    book, book_group: book ? out.book_group : null, book_slot_at: book ? out.book_slot_at : null,
    book_calendar_id: book ? bookCal.key : null,
  };
}

// Fire a reply (used by manual approve + self-drive auto-send). Pass clientId to
// route Twilio academies through their own number + own-store; without it (or for
// GHL academies) it sends via GHL exactly as before.
async function sendReplyViaGhl(token, contactId, reply, clientId) {
  if (clientId) {
    const g = await maybeSendSmsViaProvider(clientId, { ghlContactId: contactId, body: String(reply), sentBy: "agent" });
    if (g.handled) { if (!g.ok) throw new Error(g.error); return; }
  }
  await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId, message: String(reply) } });
}

// Enroll a contact in the academy's Ghosted automation (the multi-touch text/email
// sequence configured on the training offer's Sales step → offers.data.ghosted_workflow,
// same place the manual 👻 Ghosted button reads). Throws if none is configured.
async function enrollGhosted(client, token, contactId) {
  let workflowId = "";
  try {
    const offers = await sb(`offers?client_id=eq.${encodeURIComponent(client.id)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
    workflowId = ((offers && offers[0] && offers[0].data && offers[0].data.ghosted_workflow) || "").trim();
  } catch (_) {}
  if (!workflowId) { const e = new Error("No Ghosted automation set up yet. Pick one on the training offer's Sales step."); e.status = 400; throw e; }
  // GHL rejects a trailing 'Z' on eventStartTime — send an explicit +00:00 offset.
  const eventStartTime = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  await ghl("POST", `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`, { token, body: { eventStartTime } });
  return workflowId;
}

// Append to the audit log (agent_approvals). Non-fatal.
async function logApproval(row) {
  try {
    await sb(`agent_approvals`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) });
  } catch (_) {}
}

// ── Detector: pre-draft replies for Responded leads who just messaged ──
// Hawkeye → queue as pending (a human approves in the inbox).
// Self-drive → high-confidence drafts send themselves; unsure ones still queue.
async function detectForClient(client) {
  const mode = agentMode(client);
  if (!modeIsOn(mode)) return { client_id: client.id, skipped: "mode off" };
  const creds = await pickGhlToken(client);
  if (!creds) return { client_id: client.id, skipped: "no GHL token" };
  const { token, locationId } = creds;

  let rs, queue, respondedIds;
  try { ({ rs, queue, respondedIds } = await computeQueue(token, locationId, { clientId: client.id, sb })); }
  catch (e) { return { client_id: client.id, error: `queue: ${e.message}` }; }
  if (!rs) return { client_id: client.id, skipped: "no Responded stage" };

  // Prune stale cards: cancel pending drafts whose lead has LEFT the Responded
  // stage (booked, moved, lost…) so Hawkeye only ever shows current Responded leads.
  let pruned = 0;
  try {
    const pend = await sb(`agent_ready_replies?client_id=eq.${client.id}&status=eq.pending&select=id,ghl_contact_id`);
    for (const row of (Array.isArray(pend) ? pend : [])) {
      if (row.ghl_contact_id && !respondedIds.has(row.ghl_contact_id)) {
        await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Responded stage", updated_at: new Date().toISOString() }) });
        pruned++;
      }
    }
  } catch (_) {}

  const cfg = await loadConfig(client.id);
  let drafted = 0, autoSent = 0, skipped = 0, escalated = 0, lostProposed = 0, deferred = 0, flushed = 0;
  const reasons = [];   // diagnostic: why each contact was skipped

  // Flush held replies: drafts parked during quiet hours (8:00am-9:30pm) whose
  // send time has now arrived. Only inside the window; only if the lead is STILL in
  // Responded (else cancel — they booked/moved/lost while we waited).
  if (withinQuietHours()) {
    try {
      const held = await sb(`agent_ready_replies?client_id=eq.${client.id}&status=eq.approved&send_after=lte.${new Date().toISOString()}&select=id,ghl_contact_id,draft_message&order=send_after.asc&limit=40`);
      for (const row of (Array.isArray(held) ? held : [])) {
        if (row.ghl_contact_id && !respondedIds.has(row.ghl_contact_id)) {
          await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Responded stage", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (!row.draft_message || !String(row.draft_message).trim()) continue;
        try {
          await sendReplyViaGhl(token, row.ghl_contact_id, row.draft_message, client.id);
          await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", auto_sent: true, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
          flushed++;
        } catch (e) { reasons.push(`flush ${row.ghl_contact_id}: send failed — ${e.message}`); }
      }
    } catch (_) {}
  }

  // Cap how many contacts we draft per run so a big Responded queue can't burst
  // GHL's rate limit (each draft hits GHL for the thread + Claude).
  const mutedSet = await mutedContactIdSet(client.id, "booking");
  let _first = true;
  for (const item of queue.slice(0, DETECT_CAP)) {
    if (!_first) await new Promise(r => setTimeout(r, 300));  // smooth GHL bursts
    _first = false;
    const contactId = item.contact_id;
    if (!contactId) { skipped++; reasons.push(`${item.name || "?"}: no contactId in queue item`); continue; }
    if (mutedSet.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: bot muted on this lead`); continue; }
    // Fresh inbound only: if the lead's last message is ≥24h old, we dropped the
    // ball — hand them to the ghost engine (Send to Ghosted) instead of a late
    // reply. Keeps the two engines from fighting and stops stale leads falling
    // through the cracks. (last_at = the lead's last inbound time.)
    if (item.last_at && (Date.now() - new Date(item.last_at).getTime()) >= 24 * 3600000) {
      skipped++; reasons.push(`${item.name || contactId}: inbound ≥24h old → ghost engine`); continue;
    }
    // Dedupe: skip if an active draft exists, or we already answered THIS inbound.
    try {
      const existing = await sb(`agent_ready_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&order=created_at.desc&select=id,status,last_lead_at&limit=1`);
      const last = Array.isArray(existing) && existing[0];
      if (last && ["pending", "approved"].includes(last.status)) { skipped++; reasons.push(`${item.name || contactId}: already has a ${last.status} draft`); continue; }
      if (last && last.last_lead_at && item.last_at && new Date(last.last_lead_at).getTime() === new Date(item.last_at).getTime()) { skipped++; reasons.push(`${item.name || contactId}: already answered this inbound (timestamp match)`); continue; }
    } catch (e) { reasons.push(`${item.name || contactId}: dedup-check error — ${e.message}`); }

    let d;
    // The queue already proved the stage + found the conversation — reuse both
    // so the detector makes ONE GHL call (the thread) per contact, not four.
    try { d = await draftForContact(token, locationId, client.id, contactId, cfg, { rs, conversationId: item.conversation_id, skipStageGuard: true }); }
    catch (e) { skipped++; reasons.push(`${item.name || contactId}: draft threw — ${e.message}`); continue; }

    // Lost proposal: the agent thinks this lead is dead. ALWAYS queue it for a
    // human in Hawkeye — never auto-mark, even in self-drive. The warm closing
    // message (if any) rides along in draft_message and sends on confirm.
    if (d.recommend_lost) {
      try {
        await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, kind: "mark_lost", lost_reason: d.lost_reason || "Other",
          draft_message: (d.reply && String(d.reply).trim()) ? d.reply : "", reasoning: d.reasoning || null,
          last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
          confidence: d.confidence, last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
        }]) });
        lostProposed++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: lost-insert failed — ${e.message}`); }
      continue;
    }

    // Booking proposal: the lead confirmed a specific open slot. ALWAYS queue for
    // a human in Hawkeye — never auto-create the appointment. The confirmation
    // message rides in draft_message and sends after the booking on confirm.
    if (d.book && d.book_slot_at && d.book_calendar_id) {
      try {
        await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, kind: "book",
          book_calendar_id: d.book_calendar_id, book_slot_at: d.book_slot_at, book_group: d.book_group || null,
          draft_message: (d.reply && String(d.reply).trim()) ? d.reply : "", reasoning: d.reasoning || null,
          last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
          confidence: d.confidence, last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
        }]) });
        drafted++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: book-insert failed — ${e.message}`); }
      continue;
    }

    if (d.error || !d.reply || !String(d.reply).trim()) {
      if (d.escalate) escalated++; else { skipped++; reasons.push(`${item.name || contactId}: ${d.error || "agent returned empty reply"}`); }
      // Still queue an escalation so a human sees it (no message to auto-send).
      if (d.escalate) {
        try {
          await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
            contact_name: item.name || null, draft_message: "(agent escalated — needs a human)", reasoning: d.reasoning || null,
            confidence: d.confidence, escalate: true, escalate_reason: d.escalate_reason || null,
            last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
            last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
          }]) });
        } catch (_) {}
      }
      continue;
    }

    const auto = shouldAutoSend(mode, { confidence: d.confidence, escalate: d.escalate });
    if (auto && !withinQuietHours()) {
      // Quiet hours: don't text a parent after 9:30pm / before 8am. Hold the
      // approved draft and let the flush step send it in the morning.
      try {
        await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, draft_message: d.reply, reasoning: d.reasoning || null, confidence: d.confidence,
          asked_to_book: d.asked_to_book, reply_count: d.reply_count, booking_asks: d.booking_asks, last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
          last_lead_at: item.last_at || null, status: "approved", send_after: nextSendableTime().toISOString(), created_by: "self-drive",
        }]) });
        deferred++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: defer-insert failed — ${e.message}`); }
    } else if (auto) {
      try {
        await sendReplyViaGhl(token, contactId, d.reply, client.id);
        await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, draft_message: d.reply, reasoning: d.reasoning || null, confidence: d.confidence,
          asked_to_book: d.asked_to_book, reply_count: d.reply_count, booking_asks: d.booking_asks, last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
          last_lead_at: item.last_at || null, status: "sent", auto_sent: true, sent_at: new Date().toISOString(), created_by: "self-drive",
        }]) });
        await logApproval({ client_id: client.id, ghl_contact_id: contactId, ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, final_reply: d.reply, reasoning: d.reasoning || null, confidence: d.confidence,
          reply_count: d.reply_count, booking_asks: d.booking_asks, adjusted: false, status: "sent", created_by: "self-drive" });
        autoSent++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: auto-send failed — ${e.message}`); }
    } else {
      try {
        await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, draft_message: d.reply, reasoning: d.reasoning || null, confidence: d.confidence,
          asked_to_book: d.asked_to_book, reply_count: d.reply_count, booking_asks: d.booking_asks, last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
          last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
        }]) });
        drafted++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: pending-insert failed — ${e.message}`); }
    }
  }

  // ── Opener pass: cold-open Responded leads that ENTERED with context (an
  // "Entry:" note from portal routing - e.g. trial form, no booking) but have not
  // messaged yet. The Booking agent opens the conversation. Only for leads we have
  // NEVER drafted for AND who have no GHL thread yet, so it never double-texts and
  // never re-opens. Hawkeye-only (queued pending). Naturally dormant: no Entry notes
  // exist until portal entry-routing is turned on for the academy.
  let openers = 0, rebookOpeners = 0;
  let rebookIds = new Set();
  try {
    const entryNotes = await sb(`agent_contact_notes?client_id=eq.${client.id}&active=eq.true&note=ilike.Entry:*&select=ghl_contact_id,note&order=created_at.desc`);
    const entryRows = Array.isArray(entryNotes) ? entryNotes : [];
    // A5: "Entry: Rebook ..." notes are confirm-agent handoffs (the lead couldn't make
    // their booked trial). They get a dedicated re-open pass below; keep them OUT of the
    // cold-opener candidates here (a rebook lead has prior history + a GHL conversation,
    // so the cold-opener guards would skip them anyway).
    rebookIds = new Set(entryRows.filter(n => /^Entry:\s*Rebook/i.test(String(n.note || ""))).map(n => String(n.ghl_contact_id)).filter(Boolean));
    let candidates = [...new Set(entryRows.map(n => String(n.ghl_contact_id)).filter(Boolean))]
      .filter(id => respondedIds.has(id) && !mutedSet.has(id) && !rebookIds.has(id));
    if (candidates.length) {
      // HANDOFF GUARD: when an academy has the form INTRO automation on
      // (contact_form / trial_form), that timed first-touch IS the cold open - the
      // agent must NOT also open, or the lead gets double-texted. The agent takes
      // over only when the lead REPLIES (reply engine, above) or after the intro
      // goes quiet (the ghost engine at >=24h). Skip anyone with an intro enrollment
      // that's active (scheduled, mid-delay) or completed (sent). This closes the
      // 2-20 min delay window before the intro send creates a GHL thread that the
      // findConversation guard below would otherwise catch. 'exited' = they replied,
      // already handled by the reply engine. Dormant when no intros exist.
      try {
        const introAutos = await sb(`automations?client_id=eq.${client.id}&automation_key=in.(contact_form,trial_form)&select=id`);
        const introIds = (Array.isArray(introAutos) ? introAutos : []).map(a => a.id);
        if (introIds.length) {
          const enr = await sb(`automation_enrollments?client_id=eq.${client.id}&automation_id=in.(${introIds.join(",")})&status=in.(active,completed)&select=contact_id`);
          const introSet = new Set((Array.isArray(enr) ? enr : []).map(e => String(e.contact_id)));
          if (introSet.size) candidates = candidates.filter(id => !introSet.has(id));
        }
      } catch (e) { reasons.push(`opener intro-guard: ${e.message}`); }
    }
    if (candidates.length) {
      const calendars = await loadCalendars(sb, client.id);
      for (const contactId of candidates) {
        if (openers >= OPENER_CAP) break;
        // Never cold-open someone we've already engaged (any prior queue row).
        let prior;
        try { prior = await sb(`agent_ready_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=id&limit=1`); }
        catch (e) { reasons.push(`opener ${contactId}: dedup error — ${e.message}`); continue; }
        if (Array.isArray(prior) && prior.length) continue;
        // Skip if a GHL conversation already exists (they wrote, or were texted).
        try { if (await findConversation(token, locationId, contactId)) continue; } catch (_) {}
        let d;
        try { d = await draftOpener(token, locationId, client.id, contactId, cfg, calendars); }
        catch (e) { reasons.push(`opener ${contactId}: draft threw — ${e.message}`); continue; }
        if (!d.reply || !String(d.reply).trim()) { if (d.escalate) escalated++; continue; }
        let nm = null;
        try { const c = await sb(`ghl_contacts?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=name&limit=1`); nm = (Array.isArray(c) && c[0] && c[0].name) || null; } catch (_) {}
        const isBook = !!(d.book && d.book_slot_at && d.book_calendar_id);
        try {
          await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: null,
            contact_name: nm, kind: isBook ? "book" : "reply",
            book_calendar_id: isBook ? d.book_calendar_id : null, book_slot_at: isBook ? d.book_slot_at : null, book_group: isBook ? d.book_group : null,
            draft_message: d.reply, reasoning: d.reasoning || "First touch (cold opener from entry context).",
            confidence: d.confidence, asked_to_book: d.asked_to_book, summary: d.summary || null,
            status: "pending", created_by: "opener",
          }]) });
          openers++;
        } catch (e) { reasons.push(`opener ${contactId}: insert failed — ${e.message}`); }
        await new Promise(r => setTimeout(r, 300));
      }
    }
  } catch (e) { reasons.push(`opener pass: ${e.message}`); }

  // ── A5 REBOOK pass: the confirm agent handed a "can't make it" lead back to the
  // Responded stage with an "Entry: Rebook" trigger note. The booking agent must now
  // PROACTIVELY text them to rebook rather than waiting for the lead to message first.
  // A rebook lead has prior booking history + an existing GHL conversation, so the cold
  // -opener guards above deliberately skip them - this pass re-opens them on purpose:
  // draft a first rebook text via the booking opener brain (the persistent "Rebook
  // needed" memory note gives it context), queue it for Hawkeye, then CONSUME the
  // trigger note (active=false) so a lead is opened exactly once.
  try {
    const rebookCandidates = [...rebookIds].filter(id => respondedIds.has(id) && !mutedSet.has(id));
    if (rebookCandidates.length) {
      const calendars = await loadCalendars(sb, client.id);
      for (const contactId of rebookCandidates) {
        if (rebookOpeners >= OPENER_CAP) break;
        // Dedupe: if a card is already waiting (pending/approved), leave it be.
        let active;
        try { active = await sb(`agent_ready_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)&select=id&limit=1`); }
        catch (e) { reasons.push(`rebook ${contactId}: dedup error - ${e.message}`); continue; }
        if (Array.isArray(active) && active.length) continue;
        let d;
        try { d = await draftOpener(token, locationId, client.id, contactId, cfg, calendars); }
        catch (e) { reasons.push(`rebook ${contactId}: draft threw - ${e.message}`); continue; }
        if (!d.reply || !String(d.reply).trim()) { if (d.escalate) escalated++; continue; }
        let nm = null;
        try { const c = await sb(`ghl_contacts?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=name&limit=1`); nm = (Array.isArray(c) && c[0] && c[0].name) || null; } catch (_) {}
        const isBook = !!(d.book && d.book_slot_at && d.book_calendar_id);
        let queued = false;
        try {
          await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: null,
            contact_name: nm, kind: isBook ? "book" : "reply",
            book_calendar_id: isBook ? d.book_calendar_id : null, book_slot_at: isBook ? d.book_slot_at : null, book_group: isBook ? d.book_group : null,
            draft_message: d.reply, reasoning: d.reasoning || "First rebook touch (confirm agent handed this lead back to rebook).",
            confidence: d.confidence, asked_to_book: d.asked_to_book, summary: d.summary || null,
            status: "pending", created_by: "rebook-opener",
          }]) });
          queued = true;
          rebookOpeners++;
        } catch (e) { reasons.push(`rebook ${contactId}: insert failed - ${e.message}`); }
        // Consume the trigger note so we open exactly once. The persistent "Rebook needed"
        // memory note (no "Entry:" prefix) stays active for ongoing conversation context.
        if (queued) {
          try { await sb(`agent_contact_notes?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&active=eq.true&note=ilike.${encodeURIComponent("Entry: Rebook")}*`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }) }); } catch (_) {}
        }
        await new Promise(r => setTimeout(r, 300));
      }
    }
  } catch (e) { reasons.push(`rebook pass: ${e.message}`); }

  return { client_id: client.id, business: client.business_name, mode, queued: queue.length, drafted, openers, rebook_openers: rebookOpeners, auto_sent: autoSent, deferred, flushed, escalated, lost_proposed: lostProposed, skipped, pruned, reasons };
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

// 2-hourly approval digest: text each enabled academy's configured number the
// count of chats waiting for approval (only when > 0).
async function runDigest(res) {
  const out = [];
  let clients = [];
  try {
    clients = await sb(`clients?select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&v2_access=eq.true`);
  } catch (_) {}
  for (const client of (Array.isArray(clients) ? clients : [])) {
    const cfg = client.ghl_kpi_config || {};
    if (!cfg.agent_approvals_enabled || !cfg.agent_notify_phone) continue;
    try {
      const creds = await pickGhlToken(client);
      if (!creds) continue;
      const { queue } = await computeQueue(creds.token, creds.locationId, { clientId: client.id, sb });
      if (queue.length > 0) {
        const msg = `🤖 ${queue.length} chat${queue.length === 1 ? "" : "s"} waiting for your approval (${client.business_name || "academy"}). Open the portal → Inbox → 👁 Hawkeye.`;
        const r = await sendSms({ client, toPhone: cfg.agent_notify_phone, message: msg, contactName: "BAM Agent" });
        out.push({ client_id: client.id, count: queue.length, sent: !!r.ok });
      } else {
        out.push({ client_id: client.id, count: 0 });
      }
    } catch (e) { out.push({ client_id: client.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, academies: out });
}

async function handler(req, res) {
  // Crons (Vercel sends Bearer CRON_SECRET): 2-hourly approval digest + the
  // ready-reply detector (drafts replies for Responded leads; self-drive sends).
  if (req.method === "GET" && (req.query.action === "cron-digest" || req.query.action === "detect")) {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    if (req.query.action === "detect") {
      if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
      return await runDetect(res, null);
    }
    return await runDigest(res);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // BAM staff OR the academy's own owner / can_train_agent member.
  const actor = await resolveAgentActor(req);
  if (!actor) return res.status(401).json({ error: "sign in required" });

  const b = req.body && typeof req.body === "object" ? req.body : {};
  const clientId = b.client_id || DEFAULT_CLIENT_ID;
  if (!actor.canActOn(clientId)) return res.status(403).json({ error: "not your academy" });
  const staffEmail = actor.email;

  // Supabase-only actions — handle BEFORE touching GHL so the inbox's frequent
  // count refresh (list-ready) never costs a GHL token fetch / rate-limit hit.
  try {
    // Ready-reply queue (the inbox's "💬 Ready messages" section): pending +
    // approved drafts for this academy, newest first.
    if (b.action === "list-ready") {
      const rows = await sb(`agent_ready_replies?client_id=eq.${clientId}&status=in.(pending,approved)&select=*&order=created_at.desc&limit=100`);
      let list = Array.isArray(rows) ? rows : [];
      // Read-time Responded gate: the detector cron prunes drafts when a lead
      // leaves Responded, but until it runs the stale card lingers. Hide any row
      // whose contact is no longer in the Responded stage. Fail OPEN (show the
      // unfiltered list) if GHL is unreachable or the academy has no Responded
      // stage — a possibly-stale card beats an empty inbox.
      try {
        const client = await loadClient(clientId);
        const loc = client && client.ghl_location_id;
        // Hot path: a warm cache lets us skip the GHL token fetch entirely (the
        // count refresh hits this often — keep it cheap, per the note above).
        let ids = loc ? peekRespondedIdSet(loc) : undefined;
        if (ids === undefined && loc) {
          const creds = await pickGhlToken(client);
          if (creds) ids = await respondedContactIdSetCached(creds.token, loc, 60000, { clientId, sb });
        }
        if (ids) list = list.filter(r => !r.ghl_contact_id || ids.has(r.ghl_contact_id));
      } catch (_) { /* fail open */ }
      return res.status(200).json({ ready: list, count: list.length });
    }
    if (b.action === "skip-ready") {
      if (!b.ready_id) return res.status(400).json({ error: "ready_id required" });
      // Scope the patch to this academy so an actor can't skip another's row.
      await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped", updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    console.error("[agent-approvals]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }

  // Manually run the ready-reply detector for THIS academy (drafts replies for
  // every Responded-stage lead now, instead of waiting for the */5 cron).
  if (b.action === "detect-now") {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return await runDetect(res, clientId);
  }

  // The remaining actions hit GHL/Claude.
  if (!ANTHROPIC_KEY && b.action === "draft") return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const client = await loadClient(clientId);
  if (!client) return res.status(404).json({ error: "academy not found" });
  const creds = await pickGhlToken(client);
  if (!creds) return res.status(400).json({ error: "academy not connected to GHL" });
  const { token, locationId } = creds;

  try {
    if (b.action === "list") {
      const { queue } = await computeQueue(token, locationId, { clientId, sb });
      return res.status(200).json({ queue, count: queue.length });
    }

    if (b.action === "draft") {
      if (!b.contact_id) return res.status(400).json({ error: "contact_id required" });
      if (await isMuted(clientId, b.contact_id, "booking")) return res.status(200).json({ error: "muted", muted: true });
      const cfg = await loadConfig(clientId);
      const d = await draftForContact(token, locationId, clientId, b.contact_id, cfg);
      if (d.error) return res.status(200).json({ error: d.error });
      return res.status(200).json(d);
    }

    if (b.action === "send") {
      if (!b.contact_id || !b.reply || !String(b.reply).trim()) return res.status(400).json({ error: "contact_id and reply required" });
      // HARD GUARD: refuse to send unless the lead is still in the Responded stage.
      const rsSend = await respondedStage(token, locationId, { clientId, sb });
      if (!rsSend || !(await contactInRespondedStage(token, locationId, b.contact_id, rsSend, { clientId, sb }))) {
        return res.status(409).json({ error: "This lead is no longer in the Responded stage — not sending." });
      }
      // QUIET HOURS: a human approved this after 9:30pm / before 8am. Don't text the
      // parent now — hold the approved reply and let the detect cron flush it at 8am.
      if (!withinQuietHours()) {
        const sendAfter = nextSendableTime().toISOString();
        const held = {
          client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null,
          contact_name: b.contact_name || null, draft_message: String(b.reply), reasoning: b.reasoning || null,
          confidence: typeof b.confidence === "number" ? b.confidence : null, reply_count: typeof b.reply_count === "number" ? b.reply_count : null,
          booking_asks: typeof b.booking_asks === "number" ? b.booking_asks : null,
          status: "approved", send_after: sendAfter, approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        try {
          if (b.ready_id) await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(held) });
          else await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ ...held, created_by: staffEmail }]) });
        } catch (e) { return res.status(500).json({ error: `couldn't schedule: ${e.message}` }); }
        return res.status(200).json({ ok: true, sent: false, deferred: true, send_after: sendAfter });
      }
      // Send (human-approved) - Twilio academy via own number, else GHL.
      try {
        const g = await maybeSendSmsViaProvider(clientId, { ghlContactId: b.contact_id, body: String(b.reply), sentBy: staffEmail || "agent" });
        if (g.handled) { if (!g.ok) throw new Error(g.error); }
        else await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId: b.contact_id, message: String(b.reply) } });
      } catch (e) {
        return res.status(e.status || 502).json({ error: `send failed: ${e.message}` });
      }
      // Optional learning (stays with this academy by default).
      let lessonId = null;
      if (b.lesson && String(b.lesson).trim()) {
        try {
          const [row] = await sb(`agent_lessons`, {
            method: "POST", headers: { Prefer: "return=representation" },
            body: JSON.stringify([{ client_id: clientId, kind: "fix", scope: "academy", lesson: String(b.lesson).trim(), created_by: staffEmail, context: { contact_id: b.contact_id, suggested: b.suggested_reply || null, sent: b.reply } }]),
          });
          lessonId = row?.id || null;
        } catch (_) {}
      }
      // Audit log.
      try {
        await sb(`agent_approvals`, {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{
            client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null,
            contact_name: b.contact_name || null, suggested_reply: b.suggested_reply || null, final_reply: b.reply,
            reasoning: b.reasoning || null, confidence: typeof b.confidence === "number" ? b.confidence : null,
            reply_count: typeof b.reply_count === "number" ? b.reply_count : null,
            booking_asks: typeof b.booking_asks === "number" ? b.booking_asks : null,
            adjusted: !!b.adjusted, status: "sent", lesson_id: lessonId, created_by: staffEmail,
          }]),
        });
      } catch (_) {}
      // If this approval came from a queued ready reply, close out that row.
      if (b.ready_id) {
        try { await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      }
      return res.status(200).json({ ok: true, sent: true, lesson_id: lessonId });
    }

    // Confirm a Lost suggestion: optionally send the warm closing message, then
    // mark the lead's opportunity Lost in GHL with the reason, and close the row.
    if (b.action === "confirm-lost") {
      // Works from a ready-row (ready_id) OR straight from a contact (contact_id),
      // so you can mark Lost from a reply OR a follow-up card.
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      // Find this contact's opportunity so we can set its status.
      let oppId = null;
      try {
        const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: locationId, contact_id: contactId, limit: "20" })}`, { token });
        const opps = d.opportunities || d.data || [];
        const pick = opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0];
        oppId = pick && pick.id;
      } catch (e) { return res.status(e.status || 502).json({ error: `GHL find opp: ${e.message}` }); }
      if (!oppId) return res.status(200).json({ error: "No opportunity found for this contact — nothing to mark lost." });
      // Send a closing message only if one was explicitly provided.
      const closing = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      if (closing.trim()) { try { await sendReplyViaGhl(token, contactId, closing.trim(), clientId); } catch (_) {} }
      const reason = (b.lost_reason || (row && row.lost_reason) || "").toString().trim() || null;
      // Model: "Lost" is no longer terminal - a non-Unqualified lost lead flows into
      // 💔 Lead Nurture. If this academy has the portal nurture sequence LIVE and a
      // Lead Nurture stage exists, route them there (the opp stays OPEN so the nurture
      // sequence can work it). Otherwise keep the existing GHL-native Lost behavior:
      // status=lost fires the academy's "Opportunity -> Lost" workflow. Auto-switches
      // per academy the moment they approve the portal nurture sequence.
      let routedToNurture = false;
      try {
        if (await isAutomationLive(clientId, "nurture")) {
          const ns = await nurtureStage(token, locationId, { clientId, sb });
          if (ns) {
            // Provider-aware: on provider='ghl' this is the identical PUT (+ shadow
            // mirror); on 'portal' it updates the store row and writes NO GHL.
            await moveStage({ clientId, ghl, token, oppRef: { ghlOpportunityId: oppId }, stage: ns, role: "nurture", contactId, reason });
            await enrollContact({ clientId, automationKey: "nurture", contactId });
            routedToNurture = true;
          }
        }
      } catch (_) { /* fall through to the GHL-native lost path below */ }
      if (!routedToNurture) {
        try { await setStatus({ clientId, ghl, token, oppRef: { ghlOpportunityId: oppId }, status: "lost", contactId, reason }); }
        catch (e) { return res.status(e.status || 502).json({ error: `mark lost: ${e.message}` }); }
      }
      try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: routedToNurture ? "nurture" : "lost", reason }]) }); } catch (_) {}
      // Clear ALL of this lead's queued cards (replies + follow-ups) - they're done in Responded now.
      try { await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      try { await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "marked lost", updated_at: new Date().toISOString() }) }); } catch (_) {}
      return res.status(200).json({ ok: true, marked_lost: !routedToNurture, routed_to_nurture: routedToNurture, opportunity_id: oppId, reason });
    }

    // 🚫 Unqualified (formerly "Abandon"): the ONE true dead end. The lead is
    // REMOVED from the pipeline (status 'abandoned') — NO nurture, NO message —
    // AND stamped with the GHL `unqualified` tag so the state mirrors the portal
    // switch and stays segmentable in GHL. Everyone else who's "Lost" but still a
    // fit flows into 💔 Lead Nurture instead (handled elsewhere). "Get them out."
    if (b.action === "confirm-abandoned") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      let oppId = null;
      try {
        const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: locationId, contact_id: contactId, limit: "20" })}`, { token });
        const opps = d.opportunities || d.data || [];
        const pick = opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0];
        oppId = pick && pick.id;
      } catch (e) { return res.status(e.status || 502).json({ error: `GHL find opp: ${e.message}` }); }
      if (!oppId) return res.status(200).json({ error: "No opportunity found for this contact — nothing to abandon." });
      const reason = (b.reason || (row && row.lost_reason) || "").toString().trim() || null;
      try {
        await setStatus({ clientId, ghl, token, oppRef: { ghlOpportunityId: oppId }, status: "abandoned", role: "unqualified", contactId, reason });
      } catch (e) { return res.status(e.status || 502).json({ error: `abandon: ${e.message}` }); }
      // Stamp the unqualified tag (best-effort — the abandon already succeeded, so
      // a tag failure must not 500 the action).
      try { await markUnqualified(token, contactId); } catch (_) {}
      try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "abandoned", reason }]) }); } catch (_) {}
      try { await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      try { await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "abandoned", updated_at: new Date().toISOString() }) }); } catch (_) {}
      return res.status(200).json({ ok: true, marked_abandoned: true, unqualified: true, opportunity_id: oppId, reason });
    }

    // The Unqualified switch (portal ⟷ GHL `unqualified` tag), without changing the
    // opportunity. On → stamp the tag; off → remove it. Bidirectional mirror so a
    // staff toggle and a GHL-side tag stay in sync. (To ALSO drop the lead from the
    // pipeline, the UI calls confirm-abandoned, which stamps the tag itself.)
    if (b.action === "set-qualification") {
      const contactId = b.contact_id;
      if (!contactId) return res.status(400).json({ error: "contact_id required" });
      const unq = !!b.unqualified;
      try {
        if (unq) await markUnqualified(token, contactId);
        else await unmarkUnqualified(token, contactId);
      } catch (e) { return res.status(e.status || 502).json({ error: `GHL tag: ${e.message}` }); }
      return res.status(200).json({ ok: true, contact_id: contactId, unqualified: unq });
    }

    // Human ✓ on a booking proposal → create the real GHL appointment. GHL's
    // booked-trial automation sends the confirmation + logistics, so we do NOT
    // double-text the lead. Staff may override the calendar / slot.
    if (b.action === "confirm-book") {
      if (!b.ready_id) return res.status(400).json({ error: "ready_id required" });
      const [row] = await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
      if (!row) return res.status(404).json({ error: "not found" });
      const calendarId = (b.calendar_id || row.book_calendar_id || "").toString().trim();
      const slotAt     = (b.slot_at || row.book_slot_at || "").toString().trim();
      const contactId  = row.ghl_contact_id;
      if (!calendarId || !slotAt) return res.status(400).json({ error: "missing calendar or slot for this booking" });
      let startIso;
      try { startIso = new Date(slotAt).toISOString(); } catch (_) { return res.status(400).json({ error: "invalid slot time" }); }
      let appt;
      try {
        appt = await ghl("POST", `/calendars/events/appointments`, { token, body: {
          calendarId, locationId, contactId, startTime: startIso,
          appointmentStatus: "confirmed", ignoreDateRange: true, toNotify: true,
          title: `Free Trial${row.contact_name ? " - " + row.contact_name : ""}`,
        } });
      } catch (e) { return res.status(e.status || 502).json({ error: `GHL book: ${e.message}` }); }
      // Move the opp to Scheduled-Trial so it leaves Responded and lands in the
      // Confirm agent's queue. Off-GHL this PUT is the ONLY thing that advances the
      // card: historically a GHL "appointment booked" trigger owned this transition,
      // so an agent-booked lead would otherwise sit in Responded forever (the
      // website-calendar flow already advances portal-side in api/website/leads.js).
      // Best-effort + idempotent (a PUT to a stage it's already in is a no-op, so a
      // double-fire with the GHL trigger is harmless): a stage-move failure must
      // NEVER break a successful booking. Mirrors confirm-ghost / confirm-lost.
      // V2-only: this whole endpoint loads clients with v2_access=eq.true, so V1
      // (GHL-owned) behavior is untouched.
      // TODO(effort E — portal opportunity store): once the portal owns opportunities
      // natively, replace this GHL find-opp + PUT with a local stage write, and unify
      // with the website-calendar advance in api/website/leads.js behind one helper.
      try {
        const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: locationId, contact_id: contactId, limit: "20" })}`, { token });
        const opps = d.opportunities || d.data || [];
        const pick = opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0];
        const oppId = pick && pick.id;
        const sts = await scheduledTrialStage(token, locationId, { clientId, sb });
        if (sts && oppId) await moveStage({ clientId, ghl, token, oppRef: { ghlOpportunityId: oppId }, stage: sts, role: "scheduled_trial", contactId });
      } catch (_) {}
      try { await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      try { await logApproval({ client_id: clientId, ghl_contact_id: contactId, contact_name: row.contact_name || null, final_reply: `[booked ${row.book_group || "trial"} @ ${startIso}]`, status: "sent", created_by: staffEmail }); } catch (_) {}
      return res.status(200).json({ ok: true, booked: true, appointment_id: appt?.id || appt?.appointment?.id || null, slot_at: startIso });
    }

    // Human ✓ on a Ghost card → enroll the lead in the academy's Ghosted automation
    // and move them to Interested (out of Responded). The GHL workflow then does the
    // multi-touch follow-up: reply → back to Responded, no reply → marked Lost.
    // This REPLACES drafting one-off follow-up nudges. Works from a ghost ready-row
    // (ready_id) OR straight from a contact_id (the board "Needs action" badge).
    if (b.action === "confirm-ghost") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      // Find this contact's open opportunity (for the stage move + outcome log).
      let oppId = null;
      try {
        const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: locationId, contact_id: contactId, limit: "20" })}`, { token });
        const opps = d.opportunities || d.data || [];
        const pick = opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0];
        oppId = pick && pick.id;
      } catch (e) { return res.status(e.status || 502).json({ error: `GHL find opp: ${e.message}` }); }
      // Enroll in the Ghosted sequence (the only step that MUST succeed). Use the
      // portal-native automation if this academy has it LIVE (enabled+approved+steps);
      // otherwise keep the GHL ghosted workflow exactly as before. Auto-switches the
      // moment the academy approves the portal sequence (and turns the GHL one off).
      let workflowId = null, portalGhosted = false;
      try {
        if (await isAutomationLive(clientId, "ghosted")) {
          await enrollContact({ clientId, automationKey: "ghosted", contactId });
          portalGhosted = true;
        } else {
          workflowId = await enrollGhosted(client, token, contactId);
        }
      } catch (e) { return res.status(e.status || 502).json({ error: e.message }); }
      // Move the opp to Interested so it leaves Responded (best-effort — the enroll
      // already happened; the GHL workflow will move them too).
      try {
        const is = await interestedStage(token, locationId, { clientId, sb });
        if (is && oppId) await moveStage({ clientId, ghl, token, oppRef: { ghlOpportunityId: oppId }, stage: is, role: "interested", contactId });
      } catch (_) {}
      try { if (oppId) await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "ghosted", reason: "sent to ghosted automation" }]) }); } catch (_) {}
      // Clear ALL of this lead's queued cards (replies + follow-ups) — they've left Responded.
      try { await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      try { await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "sent to ghosted", updated_at: new Date().toISOString() }) }); } catch (_) {}
      return res.status(200).json({ ok: true, ghosted: true, portal: portalGhosted, workflow_id: workflowId, opportunity_id: oppId });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-approvals]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
