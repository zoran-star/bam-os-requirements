import { withSentryApiRoute } from "./_sentry.js";
import { notifyClientPush } from "./push/_send.js";
import { contactsReadTable } from "./_contacts.js";
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
import { loadCalendars, calendarForGroup, freeSlots, summarizeSlots, bookingProviderOf, bookPortalTrial, passedTrialContactIds, upcomingBookedContactIds } from "./agent/booking.js";
import { respondedStage, contactInRespondedStage, computeQueue, respondedContactIdSetCached, peekRespondedIdSet, interestedStage, nurtureStage, scheduledTrialStage, toIso } from "./agent/_stage.js";
import { markUnqualified, unmarkUnqualified } from "./agent/_tags.js";
import { enrollContact, isAutomationLive, resolveContactInfo } from "./automations.js";
import { sendOn } from "./_send.js";
import { moveStage, setStatus, findOpenOpp } from "./agent/_store.js";
import { routeTransition } from "./agent/_router.js";
import { DEFAULT_BOOKING_AUTOMATIONS, getBookingAutomations, automationsLive as bookingAutosLive, nextDueStep as bookingNextStep } from "./agent/booking-automations.js";
import { agentMode, modeIsOn, shouldAutoSend } from "./agent/_mode.js";
import { buildGoogleCalUrl, buildIcalUrl } from "./agent/confirm-automations.js";
import { mutedContactIdSet, isMuted } from "./agent/_mutes.js";
import { withinQuietHours, nextSendableTime, quietTz } from "./agent/_quiet.js";
import { normalizeReigniteAt, scheduleReignition, cancelReignitions, reigniteContactIdSet, reigniteParkMap, repliedAfterPark, dueReignitions, markReignition, listReignitions } from "./agent/_reignite.js";
import { liveMemberContactIds } from "./agent/_live-members.js";
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
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,time_zone&limit=1`);
  return Array.isArray(rows) && rows[0];
}

// ── agent config (same brain as the sandbox) ──
async function loadConfig(clientId) {
  const [lessons, overrides, exRows] = await Promise.all([
    sb(`agent_lessons?or=(client_id.eq.${clientId},and(client_id.is.null,scope.eq.general))&agent=eq.booking&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
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
  `If your lost_criteria say this lead should be closed out, set 'recommend_lost' = true with a short 'lost_reason' from the taxonomy, and put your warm closing message in 'reply' (a human confirms the Lost before anything changes). ` +
  `REIGNITION: if the lead clearly WANTS to proceed but only at a LATER date ("after summer", "once school starts", "text me in September"), do NOT mark them lost and do NOT keep pushing. Set 'reignite_at' (YYYY-MM-DD - resolve a vague timeframe to a concrete date, e.g. "after summer" = Sep 01; a bare "later" with no timeframe = about 30 days out) and 'reignite_message' = the exact re-engagement text we should open with ON that date (warm, references what they told us, moves toward booking). Make 'reply' the acknowledgement to send NOW ("No problem, I'll check back in September!"). A human confirms the date + both messages before anything is scheduled.\n</live_booking>`;
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
      propose_group:   { type: "string", description: "If your reply OFFERS or SUGGESTS a specific session day/time to the lead WITHOUT booking yet: 'Group 1' (elementary, 9-13) or 'Group 2' (high school, 14+)." },
      propose_slot_at: { type: "string", description: "If your reply names a specific day/time to the lead (book=false): the EXACT ISO datetime of that open slot - it MUST come from check_availability. NEVER name a time in a reply that you have not verified as an open slot. Empty when your reply names no specific time." },
      reignite_at:      { type: "string", description: "YYYY-MM-DD. ONLY when the lead wants to proceed but at a LATER date: the concrete day to re-engage (resolve vague timeframes; bare 'later' = ~30 days out). A human confirms before anything is scheduled." },
      reignite_message: { type: "string", description: "If reignite_at: the exact re-engagement text to open with on that date - warm, references what they told us, moves toward booking." },
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
    const { days } = await freeSlots(bookingCtx.token, cal.key, { days: input.within_days || 14, timezone: bookingCtx.timezone, clientId: bookingCtx.clientId, calLabel: cal.label });
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
  })).filter(m => m.text && !(m.direction !== "outbound" && /^Liked\b/.test(m.text.trim())));   // inbound tapbacks never register (Zoran 2026-07-09)
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
    return { error: "This lead isn't in the Responded stage - the bot only replies to Responded-stage leads." };
  }
  // Twilio academies: read the thread from the own-store (no GHL conversation).
  // conversationId MUST live at function scope: the return below references it,
  // and the Twilio branch never declared it - every AI draft on a Twilio academy
  // crashed with "conversationId is not defined" (same bug as agent-confirm and
  // agent-closing, fixed there in #1074 but missed here).
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
  const system = buildSystem(cfg) + await loadContactMemory(sb, clientId, contactId, { ghl, token, locationId });
  const calendars = await loadCalendars(sb, clientId);
  const out = await runAgent(system, messages, { calendars, token, timezone: "America/Toronto", clientId });
  const agentMsgs = messages.filter(m => m.role === "agent");
  // A booking proposal: the agent set book=true with a concrete slot it verified.
  const bookCal = (out.book && out.book_slot_at && out.book_group) ? calendarForGroup(calendars, out.book_group) : null;
  const book = !!(out.book && out.book_slot_at && bookCal);
  // A time PROPOSAL: the reply names a specific slot without booking yet. Zoran
  // approves every proposed time as a structured Hawkeye field (2026-07-10), so
  // the slot rides the card instead of living only in prose. Future + verified-open only.
  const prop = await normalizeProposal(out, book, calendars, { token, clientId });
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
    book_group: book ? out.book_group : prop.group,
    book_slot_at: book ? out.book_slot_at : prop.slotAt,
    book_calendar_id: book ? bookCal.key : prop.calendarId,
    // 🔥 Reignition: "yes, but later" with a concrete re-engagement date + the
    // pre-written message to open with on that date. Invalid/past dates drop out.
    reignite_at: normalizeReigniteAt(out.reignite_at),
    reignite_message: (out.reignite_message && String(out.reignite_message).trim()) || null,
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    last_message: (() => { const lead = [...messages].reverse().find(m => m.role === "parent"); return lead ? String(lead.text).slice(0, 500) : null; })(),
    last_outbound: (() => { const ours = [...messages].reverse().find(m => m.role === "agent"); return ours ? String(ours.text).slice(0, 500) : null; })(),
    thread_tail: messages.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "lead", text: String(m.text).slice(0, 2000), at: toIso(m.date) })),
    reply_count: agentMsgs.length,
    booking_asks: agentMsgs.filter(m => BOOK_ASK.test(m.text)).length,
  };
}

// A time PROPOSAL in a non-booking reply: validate + map it onto the card's
// book_* fields (same columns the Book-it card uses; kind stays 'reply', so
// nothing books until the lead says yes and a real Book-it card is approved).
// Guards: never on a booking card, must parse, must be in the future, the group
// must resolve to a real calendar, AND the time must be a genuinely open slot -
// the deck labels it "a verified open slot", but nothing enforced that the model
// actually pulled it from check_availability, so a hallucinated time got stamped
// + shown as verified (#12). Confirm against a live freeSlots read; any miss or
// read error drops the STRUCTURED proposal (the reply text still sends, but the
// card won't claim verification or stamp a bogus Book-it slot). async now.
async function normalizeProposal(out, book, calendars, verifyCtx) {
  const none = { group: null, slotAt: null, calendarId: null };
  if (book || !out || !out.propose_slot_at || !out.propose_group) return none;
  const cal = calendarForGroup(calendars || [], out.propose_group);
  if (!cal) return none;
  const t = new Date(out.propose_slot_at).getTime();
  if (!Number.isFinite(t) || t <= Date.now()) return none;
  if (verifyCtx && verifyCtx.token) {
    try {
      const { days } = await freeSlots(verifyCtx.token, cal.key, { days: 21, clientId: verifyCtx.clientId, calLabel: cal.label });
      const open = [];
      for (const arr of Object.values(days || {})) for (const iso of (arr || [])) { const ms = new Date(iso).getTime(); if (Number.isFinite(ms)) open.push(ms); }
      if (!open.includes(t)) return none;
    } catch (_) { return none; }
  }
  return { group: out.propose_group, slotAt: new Date(t).toISOString(), calendarId: cal.key };
}

// Draft a cold OPENER for a Responded lead that entered with context but hasn't
// messaged (no thread). Returns the structured proposal or throws.
async function draftOpener(token, locationId, clientId, contactId, cfg, calendars) {
  const system = buildOpenerSystem(cfg) + await loadContactMemory(sb, clientId, contactId, { ghl, token, locationId });
  const out = await runOpener(system, { calendars: calendars || [], token, timezone: "America/Toronto", clientId });
  const bookCal = (out.book && out.book_slot_at && out.book_group) ? calendarForGroup(calendars || [], out.book_group) : null;
  const book = !!(out.book && out.book_slot_at && bookCal);
  const prop = await normalizeProposal(out, book, calendars, { token, clientId });
  return {
    reply: out.reply || "",
    reasoning: out.reasoning || "",
    confidence: typeof out.confidence === "number" ? out.confidence : null,
    escalate: !!out.escalate,
    asked_to_book: !!out.asked_to_book || BOOK_ASK.test(out.reply || ""),
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    book, book_group: book ? out.book_group : prop.group, book_slot_at: book ? out.book_slot_at : prop.slotAt,
    book_calendar_id: book ? bookCal.key : prop.calendarId,
  };
}

// Scripted BOOKING initial-automation opener (Phase C). When the academy has its
// booking initial automations LIVE + APPROVED for this entry point, use the
// scripted template as the opener instead of the AI draft - the agent still takes
// over the moment the lead replies. Returns a draft-shaped object or null to fall
// back to draftOpener (so an unapproved academy is byte-identical to before).
// {{contact.first_name}} is resolved HERE (this text goes straight to the Hawkeye
// queue, not through the send engine's token pass, so an unresolved token would
// reach the lead). One immediate step per entry today: startedMs=null + empty
// sentKeys means that immediate opener is what's due.
function scriptedBookingOpener(client, entryKey, firstName) {
  const autos = getBookingAutomations(client);
  if (!bookingAutosLive(autos, entryKey)) return null;
  const step = bookingNextStep(autos, entryKey, { nowMs: Date.now(), startedMs: null, sentKeys: [] });
  if (!step || !step.template) return null;
  const text = String(step.template).replace(/\{\{\s*contact\.first_name\s*\}\}/g, firstName || "there");
  if (!text.trim()) return null;
  return {
    reply: text,
    reasoning: `Scripted booking opener (${entryKey}).`,
    confidence: 1, escalate: false, asked_to_book: BOOK_ASK.test(text),
    summary: null, book: false, book_group: null, book_slot_at: null, book_calendar_id: null,
  };
}

// Sanitize an incoming booking-automations edit against the shipped defaults
// (per-entry, per-step). Only enabled/approved (top) + per-step enabled + template
// (capped) are writable; entry set, step keys, timing/channel come from defaults.
// Mirrors sanitizeAutomations in agent-confirm.js, extended for the entries shape.
function sanitizeBookingAutomations(incoming, cur = {}) {
  const inEntries = (incoming && incoming.entries && typeof incoming.entries === "object") ? incoming.entries : {};
  const entries = {};
  for (const [ekey, edef] of Object.entries(DEFAULT_BOOKING_AUTOMATIONS.entries)) {
    const ie = inEntries[ekey] || {};
    const seen = new Map((Array.isArray(ie.steps) ? ie.steps : []).map(s => [s && s.key, s]));
    entries[ekey] = {
      steps: edef.steps.map(def => {
        const s = seen.get(def.key) || {};
        return {
          key: def.key,
          enabled: typeof s.enabled === "boolean" ? s.enabled : def.enabled,
          template: typeof s.template === "string" ? s.template.slice(0, 800) : def.template,
        };
      }),
    };
  }
  return {
    enabled: typeof incoming.enabled === "boolean" ? incoming.enabled
      : (typeof cur.enabled === "boolean" ? cur.enabled : DEFAULT_BOOKING_AUTOMATIONS.enabled),
    approved: incoming.approved === true,
    entries,
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
// Training-signal enrichment (2026-07-12): a teach-why lesson snapshots the
// conversation + pipeline stage that produced it, not just the proposed/edited
// message pair, so /consolidate-lessons (and future agent retraining) get the
// full context. stage_from is this agent's home stage; stage_to is set only when
// a stage move rides with the teach (the send/reignite paths don't move a lead,
// so it stays the column default null - reserved for a future move+teach flow).
const LESSON_STAGE_FROM = "Responded"; // booking agent works the Responded stage
function threadSnapshot(row) {
  const t = row && (row.thread_tail ?? row.summary);
  if (!t) return null;
  return typeof t === "string" ? t : JSON.stringify(t);
}
// Pull the deck card's stored thread tail for a lesson (best-effort, low-freq -
// only runs when staff attach a teach-why). Null when there's no card/thread.
async function readyThread(readyId, clientId) {
  if (!readyId) return null;
  try {
    const [r] = await sb(`agent_ready_replies?id=eq.${encodeURIComponent(readyId)}&client_id=eq.${clientId}&select=thread_tail,summary`);
    return threadSnapshot(r);
  } catch (_) { return null; }
}

async function logApproval(row) {
  try {
    await sb(`agent_approvals`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) });
  } catch (_) {}
}

// Passed-trial handoff set (Zoran 2026-07-09): shared with the Confirm agent -
// see passedTrialContactIds in ./agent/booking.js. Booking skips drafting these
// leads and hides any lingering Booking card; the post-trial form owns them.

// ── Detector: pre-draft replies for Responded leads who just messaged ──
// Hawkeye → queue as pending (a human approves in the inbox).
// Self-drive → high-confidence drafts send themselves; unsure ones still queue.
async function detectForClient(client) {
  const mode = agentMode(client);
  if (!modeIsOn(mode)) return { client_id: client.id, skipped: "mode off" };
  const creds = await pickGhlToken(client);
  if (!creds) return { client_id: client.id, skipped: "no GHL token" };
  const { token, locationId } = creds;

  let rs, queue, respondedIds, idsTrusted;
  try { ({ rs, queue, respondedIds, idsTrusted } = await computeQueue(token, locationId, { clientId: client.id, sb })); }
  catch (e) { return { client_id: client.id, error: `queue: ${e.message}` }; }
  if (!rs) return { client_id: client.id, skipped: "no Responded stage" };
  // Only trust "left the stage" to CANCEL a park when the fetch succeeded and
  // returned a non-empty set - an empty/blipped set must never mass-cancel parks.
  const stageSetTrusted = idsTrusted !== false && respondedIds.size > 0;

  // Leads whose booked trial has already run: Booking hands them to the post-trial
  // form (Confirm tab) instead of drafting another reply.
  const passedTrial = await passedTrialContactIds(client.id);
  // Leads with an UPCOMING booked trial: already locked into a slot, so never
  // draft a second Book-it/reply. Guards the double-booking a stage-move hiccup
  // would otherwise cause (Yaz/Tara, GTA 2026-07-11).
  const upcomingBooked = await upcomingBookedContactIds(client.id);

  // Prune stale cards: cancel pending drafts whose lead has LEFT the Responded
  // stage (booked, moved, lost…) so Hawkeye only ever shows current Responded leads.
  let pruned = 0;
  try {
    const pend = await sb(`agent_ready_replies?client_id=eq.${client.id}&status=eq.pending&select=id,ghl_contact_id`);
    for (const row of (Array.isArray(pend) ? pend : [])) {
      if (row.ghl_contact_id && passedTrial.has(String(row.ghl_contact_id))) {
        await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "trial ran - handed to post-trial form", updated_at: new Date().toISOString() }) });
        pruned++;
      } else if (row.ghl_contact_id && upcomingBooked.has(String(row.ghl_contact_id))) {
        await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "already booked - has an upcoming trial", updated_at: new Date().toISOString() }) });
        pruned++;
      } else if (row.ghl_contact_id && !respondedIds.has(row.ghl_contact_id)) {
        await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Responded stage", updated_at: new Date().toISOString() }) });
        pruned++;
      }
    }
  } catch (_) {}

  const cfg = await loadConfig(client.id);
  let drafted = 0, autoSent = 0, skipped = 0, escalated = 0, lostProposed = 0, deferred = 0, flushed = 0, escalationCards = 0, reignited = 0, reigniteProposed = 0;
  const reasons = [];   // diagnostic: why each contact was skipped
  const mutedSet = await mutedContactIdSet(client.id, "booking");

  // 🔥 Reignition: (a) the parked-lead set (proactive passes below skip them -
  // they said "later", silence is the plan); (b) fire due parks into a
  // kind='reignite_due' card in this deck. Fire-time guards mirror the prune:
  // muted / trial-ran / left-Responded parks are canceled, not fired.
  const reignMap = await reigniteParkMap(client.id);
  const reignSet = new Set(reignMap.keys());
  for (const r of await dueReignitions(client.id, "booking")) {
    const cid = String(r.ghl_contact_id);
    if (mutedSet.has(cid)) { await markReignition(r.id, "canceled", { cancel_reason: "bot muted on this lead" }); reignSet.delete(cid); continue; }
    if (passedTrial.has(cid)) { await markReignition(r.id, "canceled", { cancel_reason: "trial ran - handed to post-trial form" }); reignSet.delete(cid); continue; }
    // Only cancel "left the stage" against a TRUSTED, non-empty set - a GHL blip
    // returning empty must not permanently kill a due park (no card, no retry).
    if (stageSetTrusted && !respondedIds.has(cid)) { await markReignition(r.id, "canceled", { cancel_reason: "left Responded stage" }); reignSet.delete(cid); continue; }
    try {
      await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
        client_id: client.id, ghl_contact_id: cid, contact_name: r.contact_name || null,
        kind: "reignite_due", draft_message: r.message, reignite_at: r.reignite_at,
        reasoning: r.reason ? `Reignition day - ${r.reason}` : "Reignition day - the lead asked us to circle back today.",
        confidence: 1, status: "pending", created_by: "reignition",
      }]) });
      await markReignition(r.id, "carded");
      reignSet.delete(cid); reignited++;
    } catch (e) { reasons.push(`reignite ${cid}: ${e.message}`); }   // active card in the way -> retry next run
  }

  // Flush held replies: drafts parked during quiet hours (8:00am-9:30pm) whose
  // send time has now arrived. Only inside the window; only if the lead is STILL in
  // Responded (else cancel — they booked/moved/lost while we waited), not muted,
  // and their trial hasn't run in the meantime (post-trial form owns them then).
  if (withinQuietHours(new Date(), quietTz(client))) {
    try {
      const held = await sb(`agent_ready_replies?client_id=eq.${client.id}&status=eq.approved&send_after=lte.${new Date().toISOString()}&select=id,ghl_contact_id,draft_message,approved_by,book_slot_at&order=send_after.asc&limit=40`);
      for (const row of (Array.isArray(held) ? held : [])) {
        // #20: a held reply proposing a specific slot can go stale overnight (the
        // 8am flush would text a time that already passed). Cancel instead of send.
        if (row.book_slot_at && new Date(row.book_slot_at).getTime() <= Date.now()) {
          await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "proposed time passed before it could send", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (row.ghl_contact_id && passedTrial.has(String(row.ghl_contact_id))) {
          await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "trial ran - handed to post-trial form", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (row.ghl_contact_id && mutedSet.has(String(row.ghl_contact_id))) {
          await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "bot muted on this lead", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (row.ghl_contact_id && !respondedIds.has(row.ghl_contact_id)) {
          await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Responded stage", updated_at: new Date().toISOString() }) });
          continue;
        }
        if (!row.draft_message || !String(row.draft_message).trim()) continue;
        try {
          await sendReplyViaGhl(token, row.ghl_contact_id, row.draft_message, client.id);
          // auto_sent marks SELF-DRIVE sends; a human-approved row parked after
          // hours (approved_by set) keeps its human attribution when it flushes.
          await sb(`agent_ready_replies?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", auto_sent: !row.approved_by, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
          flushed++;
        } catch (e) { reasons.push(`flush ${row.ghl_contact_id}: send failed — ${e.message}`); }
      }
    } catch (_) {}
  }

  // Cap how many contacts we draft per run so a big Responded queue can't burst
  // GHL's rate limit (each draft hits GHL for the thread + Claude).
  let _first = true;
  for (const item of queue.slice(0, DETECT_CAP)) {
    if (!_first) await new Promise(r => setTimeout(r, 300));  // smooth GHL bursts
    _first = false;
    const contactId = item.contact_id;
    if (!contactId) { skipped++; reasons.push(`${item.name || "?"}: no contactId in queue item`); continue; }
    if (mutedSet.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: bot muted on this lead`); continue; }
    if (passedTrial.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: trial already ran → post-trial form`); continue; }
    if (upcomingBooked.has(String(contactId))) { skipped++; reasons.push(`${item.name || contactId}: already booked → has an upcoming trial`); continue; }
    // A parked lead who texted back re-engaged early: clear the park (belt +
    // suspenders with the inbound webhook's cancel) and reply normally. But only
    // when a NEW inbound landed AFTER the park - a silently-parked lead (no ack)
    // stays inbound-last on their ORIGINAL "later" text, and cancelling on mere
    // queue membership killed the park every cron (Zoran 2026-07-10). No fresh
    // inbound => keep the park and skip drafting (silence is the plan).
    if (reignSet.has(String(contactId))) {
      if (!repliedAfterPark(reignMap.get(String(contactId)), item.last_at)) { skipped++; reasons.push(`${item.name || contactId}: parked for reignition`); continue; }
      await cancelReignitions(client.id, contactId, "lead replied before the reignition date");
      reignSet.delete(String(contactId));
    }
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
      // A SKIPPED card no longer suppresses forever (Zoran 2026-07-10): skip = snooze,
      // so the detector re-drafts this message on its next run (the new pending card
      // then waits for approval). Only a still-active or already-sent answer blocks.
      if (last && last.status !== "skipped" && last.last_lead_at && item.last_at && new Date(last.last_lead_at).getTime() === new Date(item.last_at).getTime()) { skipped++; reasons.push(`${item.name || contactId}: already answered this inbound (timestamp match)`); continue; }
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

    // 🔥 Reignition proposal: the lead said "yes, but later" with a timeframe.
    // ALWAYS queue for a human - the card carries the editable ack (draft_message,
    // sends on ✓), the pre-written future message, and the date. Nothing is
    // scheduled until confirm-reignite.
    if (d.reignite_at && d.reignite_message) {
      try {
        await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, kind: "reignite",
          reignite_at: d.reignite_at, reignite_message: d.reignite_message,
          draft_message: (d.reply && String(d.reply).trim()) ? d.reply : "", reasoning: d.reasoning || null,
          last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
          confidence: d.confidence, last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
        }]) });
        reigniteProposed++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: reignite-insert failed — ${e.message}`); }
      continue;
    }

    if (d.error || !d.reply || !String(d.reply).trim()) {
      if (d.escalate) escalated++; else { skipped++; reasons.push(`${item.name || contactId}: ${d.error || "agent returned empty reply"}`); }
      // Still queue an escalation so a human sees it. draft_message stays EMPTY:
      // the card explains itself via escalate_reason, and an empty draft can't be
      // one-tap texted to the parent (a "(agent escalated ...)" placeholder was).
      if (d.escalate) {
        try {
          await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
            contact_name: item.name || null, draft_message: "", reasoning: d.reasoning || null,
            confidence: d.confidence, escalate: true, escalate_reason: d.escalate_reason || null,
            last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
            last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
          }]) });
          escalationCards++;
        } catch (_) {}
      }
      continue;
    }

    const auto = shouldAutoSend(mode, { confidence: d.confidence, escalate: d.escalate });
    if (auto && !withinQuietHours(new Date(), quietTz(client))) {
      // Quiet hours: don't text a parent after 9:30pm / before 8am. Hold the
      // approved draft and let the flush step send it in the morning.
      try {
        await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, draft_message: d.reply, reasoning: d.reasoning || null, confidence: d.confidence,
          asked_to_book: d.asked_to_book, reply_count: d.reply_count, booking_asks: d.booking_asks, last_message: d.last_message || null, last_outbound: d.last_outbound || null, summary: d.summary || null, thread_tail: d.thread_tail || null,
          last_lead_at: item.last_at || null, status: "approved", send_after: nextSendableTime(new Date(), quietTz(client)).toISOString(), created_by: "self-drive",
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
          // A PROPOSED time (reply names a verified open slot without booking):
          // rides the same book_* columns so the deck shows it structured.
          book_calendar_id: d.book_calendar_id || null, book_slot_at: d.book_slot_at || null, book_group: d.book_group || null,
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
      .filter(id => respondedIds.has(id) && !mutedSet.has(id) && !rebookIds.has(id) && !reignSet.has(id));
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
        // Name first (the scripted opener resolves {{contact.first_name}} from it).
        let nm = null;
        try { const c = await sb(`${await contactsReadTable(client.id)}?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=name&limit=1`); nm = (Array.isArray(c) && c[0] && c[0].name) || null; } catch (_) {}
        const firstName = nm ? String(nm).trim().split(/\s+/)[0] : null;
        let d;
        // Phase C: a fresh cold-open lead = the "new_lead" booking entry point. Use
        // the academy's scripted opener when it's live+approved; else the AI opener.
        try { d = scriptedBookingOpener(client, "new_lead", firstName) || await draftOpener(token, locationId, client.id, contactId, cfg, calendars); }
        catch (e) { reasons.push(`opener ${contactId}: draft threw - ${e.message}`); continue; }
        if (!d.reply || !String(d.reply).trim()) { if (d.escalate) escalated++; continue; }
        const isBook = !!(d.book && d.book_slot_at && d.book_calendar_id);
        try {
          await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: null,
            contact_name: nm, kind: isBook ? "book" : "reply",
            book_calendar_id: d.book_calendar_id || null, book_slot_at: d.book_slot_at || null, book_group: d.book_group || null,
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
    const rebookCandidates = [...rebookIds].filter(id => respondedIds.has(id) && !mutedSet.has(id) && !reignSet.has(id));
    if (rebookCandidates.length) {
      const calendars = await loadCalendars(sb, client.id);
      for (const contactId of rebookCandidates) {
        if (rebookOpeners >= OPENER_CAP) break;
        // Dedupe: if a card is already waiting (pending/approved), leave it be.
        let active;
        try { active = await sb(`agent_ready_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)&select=id&limit=1`); }
        catch (e) { reasons.push(`rebook ${contactId}: dedup error - ${e.message}`); continue; }
        if (Array.isArray(active) && active.length) continue;
        let nm = null;
        try { const c = await sb(`${await contactsReadTable(client.id)}?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=name&limit=1`); nm = (Array.isArray(c) && c[0] && c[0].name) || null; } catch (_) {}
        const firstName = nm ? String(nm).trim().split(/\s+/)[0] : null;
        let d;
        // Phase C: a bounced-back lead = the "rebook" booking entry point. Scripted
        // opener when live+approved; else the AI rebook opener (uses the memory note).
        try { d = scriptedBookingOpener(client, "rebook", firstName) || await draftOpener(token, locationId, client.id, contactId, cfg, calendars); }
        catch (e) { reasons.push(`rebook ${contactId}: draft threw - ${e.message}`); continue; }
        if (!d.reply || !String(d.reply).trim()) { if (d.escalate) escalated++; continue; }
        const isBook = !!(d.book && d.book_slot_at && d.book_calendar_id);
        let queued = false;
        try {
          await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
            client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: null,
            contact_name: nm, kind: isBook ? "book" : "reply",
            book_calendar_id: d.book_calendar_id || null, book_slot_at: d.book_slot_at || null, book_group: d.book_group || null,
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

  return { client_id: client.id, business: client.business_name, mode, queued: queue.length, drafted, openers, rebook_openers: rebookOpeners, auto_sent: autoSent, deferred, flushed, escalated, escalation_cards: escalationCards, lost_proposed: lostProposed, reignite_proposed: reigniteProposed, reignited, skipped, pruned, reasons };
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
    try {
      const r = await detectForClient(client);
      out.push(r);
      // New cards landed in Hawkeye this run -> one push per client per run.
      // Count EVERY card kind the detector can queue: replies/books, lost
      // proposals, escalations, and the opener/rebook-opener passes (these
      // queued silently before, so staff got no push for them).
      const fresh = (r.drafted || 0) + (r.lost_proposed || 0) + (r.escalation_cards || 0) + (r.openers || 0) + (r.rebook_openers || 0) + (r.reignite_proposed || 0) + (r.reignited || 0);
      if (fresh > 0) notifyClientPush(client.id, "hawkeye-ready", { count: fresh }).catch(() => {});
    }
    catch (e) { out.push({ client_id: client.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, academies: out });
}

// NOTE (Zoran 2026-07-08): the 2-hourly "chats waiting for your approval" digest
// SMS is RETIRED - it only counted the Booking queue and the deck/pill counts in
// the portal replace it. The instant "just replied" SMS (inbound webhooks) stays.

async function handler(req, res) {
  // Cron (Vercel sends Bearer CRON_SECRET): the ready-reply detector (drafts
  // replies for Responded leads; self-drive sends). cron-digest is retired but
  // answered harmlessly until the vercel.json cron change deploys.
  if (req.method === "GET" && (req.query.action === "cron-digest" || req.query.action === "detect")) {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    if (req.query.action === "detect") {
      if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
      return await runDetect(res, null);
    }
    return res.status(200).json({ ok: true, retired: "digest SMS removed 2026-07-08" });
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
      let client = null;
      try { client = await loadClient(clientId); } catch (_) {}
      // Quiet-hours state rides along so the deck can warn AT THE POINT OF ACTION
      // that an approve right now parks the message until morning (the late
      // deferred-toast alone was missed - the Tara case, Zoran 2026-07-10).
      let quiet = null;
      try {
        if (client) {
          const tz = quietTz(client), now = new Date();
          if (!withinQuietHours(now, tz)) quiet = { until: nextSendableTime(now, tz).toISOString() };
        }
      } catch (_) {}
      // Read-time Responded gate: the detector cron prunes drafts when a lead
      // leaves Responded, but until it runs the stale card lingers. Hide any row
      // whose contact is no longer in the Responded stage. Fail OPEN (show the
      // unfiltered list) if GHL is unreachable or the academy has no Responded
      // stage — a possibly-stale card beats an empty inbox.
      try {
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
      // Read-time post-trial gate: a lead whose booked trial has run belongs to
      // the post-trial form (Confirm tab), not a Booking reply. Hide their card
      // until the detector cron cancels it. Fail open on any lookup error.
      try {
        const passed = await passedTrialContactIds(clientId);
        if (passed.size) list = list.filter(r => !r.ghl_contact_id || !passed.has(String(r.ghl_contact_id)));
      } catch (_) { /* fail open */ }
      // Read-time already-booked gate: a lead with an upcoming booked trial is
      // locked in - hide any lingering Book-it/reply card until the detector cron
      // cancels it, so a booked lead can't get a second Book-it. Fail open.
      try {
        const booked = await upcomingBookedContactIds(clientId);
        if (booked.size) list = list.filter(r => !r.ghl_contact_id || !booked.has(String(r.ghl_contact_id)));
      } catch (_) { /* fail open */ }
      // Read-time paying-member gate: a lead who already signed up (live member)
      // must NEVER sit in the Booking deck or the ghost tab. The signup sweep +
      // detector cancel their cards, but hide instantly at read time too so a
      // just-converted lead can't linger for a cron cycle. Match on ghl_contact_id
      // (same semantics as the isLiveMember guard). Fail open.
      try {
        const liveIds = await liveMemberContactIds(clientId);
        if (liveIds.size) list = list.filter(r => !r.ghl_contact_id || !liveIds.has(String(r.ghl_contact_id)));
      } catch (_) { /* fail open */ }
      // Booking provider drives the Book-it card copy: only portal academies send
      // the confirmation text from the deck; GHL academies let GHL's booked-trial
      // automation send it (#3). Fail to 'ghl' (the no-double-text branch).
      let booking_provider = "ghl";
      try { booking_provider = await bookingProviderOf(clientId); } catch (_) {}
      return res.status(200).json({ ready: list, count: list.length, quiet, booking_provider });
    }
    // Deck header names (Zoran 2026-07-09): the Hawkeye card shows the ATHLETE on
    // top + the PARENT underneath. trial_bookings carries both for any lead with a
    // trial; the contacts read table backfills athlete_name/name for the rest.
    // Returns { names: { [ghl_contact_id]: { parent, athlete } } }.
    if (b.action === "deck-names") {
      const ids = Array.isArray(b.contact_ids) ? [...new Set(b.contact_ids.map(String).map(s => s.trim()).filter(Boolean))].slice(0, 200) : [];
      const names = {};
      if (ids.length) {
        const inList = `(${ids.map(encodeURIComponent).join(",")})`;
        // Authoritative source: the portal trial spine (parent + athlete typed at booking).
        try {
          const bks = await sb(`trial_bookings?tenant_id=eq.${clientId}&ghl_contact_id=in.${inList}&select=ghl_contact_id,parent_name,athlete_name,created_at&order=created_at.desc`);
          for (const t of (Array.isArray(bks) ? bks : [])) {
            const cid = String(t.ghl_contact_id || ""); if (!cid || names[cid]) continue;
            names[cid] = { parent: t.parent_name || null, athlete: t.athlete_name || null };
          }
        } catch (_) {}
        // Backfill anyone without a trial from the contacts read table.
        try {
          const missing = ids.filter(cid => { const e = names[cid]; return !e || (!e.athlete && !e.parent); });
          if (missing.length) {
            const tbl = await contactsReadTable(clientId);
            const rows = await sb(`${tbl}?client_id=eq.${clientId}&ghl_contact_id=in.(${missing.map(encodeURIComponent).join(",")})&select=ghl_contact_id,name,athlete_name`);
            for (const c of (Array.isArray(rows) ? rows : [])) {
              const cid = String(c.ghl_contact_id || ""); if (!cid) continue;
              const cur = names[cid] || { parent: null, athlete: null };
              if (!cur.athlete && c.athlete_name) cur.athlete = c.athlete_name;
              if (!cur.parent && c.name) cur.parent = c.name;
              names[cid] = cur;
            }
          }
        } catch (_) {}
      }
      return res.status(200).json({ names });
    }
    if (b.action === "skip-ready") {
      if (!b.ready_id) return res.status(400).json({ error: "ready_id required" });
      // Scope the patch to this academy so an actor can't skip another's row.
      await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped", updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
    // 🔥 Scheduled reignitions (all 3 agents' parks): feeds the deck badge chips,
    // the lead drawer, and the stuck-list exemption. Read-only.
    if (b.action === "list-reignitions") {
      return res.status(200).json({ reignitions: await listReignitions(clientId) });
    }
    // Cancel a park by hand (drawer / badge chip).
    if (b.action === "cancel-reignition") {
      if (!b.reignition_id) return res.status(400).json({ error: "reignition_id required" });
      await sb(`agent_reignitions?id=eq.${encodeURIComponent(b.reignition_id)}&client_id=eq.${clientId}&status=eq.scheduled`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", cancel_reason: `canceled in the portal by ${staffEmail || "staff"}`, updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
    // Booking initial-automations editor (per-entry scripted openers) - read.
    if (b.action === "booking-automations-get") {
      const client = await loadClient(clientId);
      if (!client) return res.status(404).json({ error: "academy not found" });
      return res.status(200).json({ automations: getBookingAutomations(client) });
    }
    // Booking initial-automations editor - save (per-entry, per-step enabled + copy,
    // sequence enable, approve toggle). Entry set + timing are fixed.
    if (b.action === "booking-automations-set") {
      const client = await loadClient(clientId);
      if (!client) return res.status(404).json({ error: "academy not found" });
      const cur = (client.ghl_kpi_config && client.ghl_kpi_config.booking_initial_automations) || {};
      const merged = sanitizeBookingAutomations(b.automations && typeof b.automations === "object" ? b.automations : {}, cur);
      const cfg = { ...(client.ghl_kpi_config || {}), booking_initial_automations: merged };
      try {
        await sb(`clients?id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: cfg }) });
      } catch (e) { return res.status(500).json({ error: `couldn't save: ${e.message}` }); }
      return res.status(200).json({ ok: true, automations: getBookingAutomations({ ghl_kpi_config: cfg }) });
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
      // Never text an internal note at a parent (legacy escalation rows seeded a
      // sendable "(agent escalated ...)" placeholder as the draft).
      if (/^\((agent escalated|post-trial review needed)/i.test(String(b.reply).trim())) {
        return res.status(400).json({ error: "That's an internal note, not a message - write the reply you want to send." });
      }
      // HARD GUARD: refuse to send unless the lead is still in the Responded stage.
      const rsSend = await respondedStage(token, locationId, { clientId, sb });
      if (!rsSend || !(await contactInRespondedStage(token, locationId, b.contact_id, rsSend, { clientId, sb }))) {
        return res.status(409).json({ error: "This lead is no longer in the Responded stage - not sending." });
      }
      // Proposal cards: the deck passes the FINAL picked slot so a picker change
      // is recorded on the row - the structured proposed time stays truthful.
      const propPatch = {};
      if (typeof b.proposed_slot_at === "string" && b.proposed_slot_at) { const _pt = new Date(b.proposed_slot_at).getTime(); if (Number.isFinite(_pt)) propPatch.book_slot_at = new Date(_pt).toISOString(); }
      if (typeof b.proposed_calendar_id === "string" && b.proposed_calendar_id) propPatch.book_calendar_id = b.proposed_calendar_id;
      // #20: a proposal card's stamped time can go stale while the card sits pending
      // a day+. If the picked slot has already passed, refuse - don't text "does
      // Tuesday at 5 work?" on Wednesday. Reopen + repick is one tap.
      if (propPatch.book_slot_at && new Date(propPatch.book_slot_at).getTime() <= Date.now()) {
        return res.status(409).json({ error: "That proposed time has already passed - reopen the card and pick a new slot." });
      }
      // QUIET HOURS: a human approved this after 9:30pm / before 8am. Don't text the
      // parent now — hold the approved reply and let the detect cron flush it at 8am.
      if (!withinQuietHours(new Date(), quietTz(client))) {
        const sendAfter = nextSendableTime(new Date(), quietTz(client)).toISOString();
        const held = {
          client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null,
          contact_name: b.contact_name || null, draft_message: String(b.reply), reasoning: b.reasoning || null,
          confidence: typeof b.confidence === "number" ? b.confidence : null, reply_count: typeof b.reply_count === "number" ? b.reply_count : null,
          booking_asks: typeof b.booking_asks === "number" ? b.booking_asks : null,
          status: "approved", send_after: sendAfter, approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          ...propPatch,
        };
        try {
          if (b.ready_id) await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(held) });
          else await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ ...held, created_by: staffEmail }]) });
        } catch (e) { return res.status(500).json({ error: `couldn't schedule: ${e.message}` }); }
        // A parked approval is still a human decision: save the lesson and log it
        // (status 'scheduled') so after-hours approvals don't vanish from the
        // audit trail and the teach-why isn't lost with them.
        let heldLessonId = null;
        if (b.lesson && String(b.lesson).trim()) {
          try {
            const snap = await readyThread(b.ready_id, clientId);
            const [lrow] = await sb(`agent_lessons`, {
              method: "POST", headers: { Prefer: "return=representation" },
              body: JSON.stringify([{ client_id: clientId, agent: "booking", kind: "fix", scope: "academy", lesson: String(b.lesson).trim(), created_by: staffEmail, stage_from: LESSON_STAGE_FROM, thread_snapshot: snap, context: { contact_id: b.contact_id, suggested: b.suggested_reply || null, sent: b.reply } }]),
            });
            heldLessonId = lrow?.id || null;
          } catch (_) {}
        }
        try {
          await sb(`agent_approvals`, {
            method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify([{
              client_id: clientId, ghl_contact_id: b.contact_id, ghl_conversation_id: b.conversation_id || null,
              contact_name: b.contact_name || null, suggested_reply: b.suggested_reply || null, final_reply: b.reply,
              reasoning: b.reasoning || null, confidence: typeof b.confidence === "number" ? b.confidence : null,
              reply_count: typeof b.reply_count === "number" ? b.reply_count : null,
              booking_asks: typeof b.booking_asks === "number" ? b.booking_asks : null,
              adjusted: !!b.adjusted, status: "scheduled", lesson_id: heldLessonId, created_by: staffEmail,
            }]),
          });
        } catch (_) {}
        return res.status(200).json({ ok: true, sent: false, deferred: true, send_after: sendAfter, lesson_id: heldLessonId });
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
          const snap = await readyThread(b.ready_id, clientId);
          const [row] = await sb(`agent_lessons`, {
            method: "POST", headers: { Prefer: "return=representation" },
            body: JSON.stringify([{ client_id: clientId, agent: "booking", kind: "fix", scope: "academy", lesson: String(b.lesson).trim(), created_by: staffEmail, stage_from: LESSON_STAGE_FROM, thread_snapshot: snap, context: { contact_id: b.contact_id, suggested: b.suggested_reply || null, sent: b.reply } }]),
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
        try { await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...propPatch }) }); } catch (_) {}
      }
      return res.status(200).json({ ok: true, sent: true, lesson_id: lessonId });
    }

    // 🔥 Confirm a Reignition: send the (editable) ack now, then park the lead in
    // place - write the agent_reignitions row with the date + the pre-written
    // re-engagement message. The lead STAYS in their stage; the detect cron fires
    // the message as a reignite_due card when the date arrives. Works from a
    // reignite card (ready_id) OR any deck card via the "Reignite later" move
    // (contact_id + explicit date/message).
    if (b.action === "confirm-reignite") {
      let row = null, contactId = b.contact_id || null;
      if (b.ready_id) {
        [row] = await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
        if (!row) return res.status(404).json({ error: "not found" });
        contactId = row.ghl_contact_id;
      }
      if (!contactId) return res.status(400).json({ error: "ready_id or contact_id required" });
      const reigniteAt = normalizeReigniteAt((typeof b.reignite_at === "string" && b.reignite_at) || (row && row.reignite_at) || "");
      if (!reigniteAt) return res.status(400).json({ error: "A future reignite date is required (up to ~18 months out)." });
      const message = String((typeof b.message === "string" && b.message.trim()) ? b.message : ((row && row.reignite_message) || "")).trim();
      if (!message) return res.status(400).json({ error: "The re-engagement message for that date is required." });
      // Ack now (optional; empty = silent park). Human-approved + time-sensitive
      // warmth -> immediate send, same exemption as lost goodbyes / move+message.
      const ack = ((typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "").trim();
      let ackSent = false;
      if (ack) { try { await sendReplyViaGhl(token, contactId, ack, clientId); ackSent = true; } catch (_) {} }
      let parkRow = null;
      try {
        parkRow = await scheduleReignition({
          clientId, contactId, contactName: (row && row.contact_name) || b.contact_name || null,
          agent: "booking", reigniteAt, message,
          reason: (typeof b.reason === "string" && b.reason.trim()) || (row && row.reasoning) || null,
          source: row && row.kind === "reignite" ? "agent" : "manual", createdBy: staffEmail,
        });
      } catch (e) { return res.status(500).json({ error: `couldn't schedule: ${e.message}` }); }
      // Optional teach-why lesson (an edited date/message trains the agent).
      let lessonId = null;
      if (b.lesson && String(b.lesson).trim()) {
        try {
          const [lrow] = await sb(`agent_lessons`, { method: "POST", headers: { Prefer: "return=representation" },
            body: JSON.stringify([{ client_id: clientId, kind: "fix", scope: "academy", lesson: String(b.lesson).trim(), created_by: staffEmail, stage_from: LESSON_STAGE_FROM, thread_snapshot: threadSnapshot(row), context: { contact_id: contactId, reignite_at: reigniteAt, sent: ack || null } }]) });
          lessonId = lrow?.id || null;
        } catch (_) {}
      }
      // Truthful bookkeeping: acted-on row 'sent' only when the ack went out;
      // every other queued card for this lead is parked away, never fake-'sent'.
      try {
        if (row && ackSent) await sb(`agent_ready_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", reignite_at: reigniteAt, reignite_message: message, approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
        await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "parked for reignition", approved_by: staffEmail, updated_at: new Date().toISOString() }) });
      } catch (_) {}
      try { await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "parked for reignition", updated_at: new Date().toISOString() }) }); } catch (_) {}
      try { await logApproval({ client_id: clientId, ghl_contact_id: contactId, contact_name: (row && row.contact_name) || null, final_reply: `[reignite ${reigniteAt.slice(0, 10)}]${ackSent ? " + ack sent" : ""}`, reasoning: (row && row.reasoning) || null, status: "sent", lesson_id: lessonId, created_by: staffEmail }); } catch (_) {}
      return res.status(200).json({ ok: true, scheduled_for: reigniteAt, ack_sent: ackSent, lesson_id: lessonId, reignition_id: (parkRow && parkRow.id) || null });
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
      // Find this contact's opportunity (provider-aware) so we can set its status.
      let oppId = null, oppRef = null;
      try { oppRef = await findOpenOpp({ clientId, ghl, token, locationId, contactId }); oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null; }
      catch (e) { return res.status(e.status || 502).json({ error: `find opp: ${e.message}` }); }
      if (!oppRef) return res.status(200).json({ error: "No opportunity found for this contact - nothing to mark lost." });
      // Send a closing message only if one was explicitly provided.
      const closing = (typeof b.reply === "string" ? b.reply : (row ? row.draft_message : "")) || "";
      const goodbyeRequested = !!closing.trim();
      let goodbyeSent = false, goodbyeError = null;
      if (goodbyeRequested) { try { await sendReplyViaGhl(token, contactId, closing.trim(), clientId); goodbyeSent = true; } catch (e) { goodbyeError = e.message || String(e); } }
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
          // Route per the academy's authored flow (the not_interested edge; GTA
          // seed = responded -> nurture). Router reads the edge; if the academy
          // PAUSED it, routed.matched is true but routed.moved is false -> we
          // respect the pause and fall through to the terminal LOST path (no
          // move). On no edge (unseeded / lookup blip) we run the original
          // hardcoded move to nurture - behavior-identical for GTA.
          const routed = await routeTransition({ clientId, sb, ghl, token, locationId, fromRole: "responded", trigger: "not_interested", contactId, oppRef, reason });
          if (routed.matched) {
            if (routed.moved) { await enrollContact({ clientId, automationKey: "nurture", contactId }); routedToNurture = true; }
          } else {
            const ns = await nurtureStage(token, locationId, { clientId, sb });
            if (ns) {
              // Provider-aware: on provider='ghl' this is the identical PUT (+ shadow
              // mirror); on 'portal' it updates the store row and writes NO GHL.
              await moveStage({ clientId, ghl, token, oppRef, stage: ns, role: "nurture", contactId, reason });
              await enrollContact({ clientId, automationKey: "nurture", contactId });
              routedToNurture = true;
            }
          }
        }
      } catch (_) { /* fall through to the GHL-native lost path below */ }
      if (!routedToNurture) {
        try { await setStatus({ clientId, ghl, token, oppRef, status: "lost", contactId, reason }); }
        catch (e) { return res.status(e.status || 502).json({ error: `mark lost: ${e.message}` }); }
      }
      try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: routedToNurture ? "nurture" : "lost", reason }]) }); } catch (_) {}
      // Clear ALL of this lead's queued cards (replies + follow-ups) - they're done in Responded now.
      // Truthful bookkeeping: only the acted-on row where a goodbye actually went out is
      // 'sent'; every other swept card is 'canceled' (nothing was texted). Stamping the
      // whole sweep 'sent' faked sent_at rows and poisoned the draft-vs-sent training data.
      // A requested goodbye that FAILED to send is recorded as such on the acted-on
      // row (not the generic 'marked lost' sweep), so it never masquerades as a
      // deliberate silent close and the deck can surface the failure.
      try {
        if (row && goodbyeSent) await sb(`agent_ready_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
        else if (row && goodbyeRequested && !goodbyeSent) await sb(`agent_ready_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: `goodbye send failed: ${(goodbyeError || "unknown").slice(0, 160)}`, approved_by: staffEmail, updated_at: new Date().toISOString() }) });
        await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "marked lost", approved_by: staffEmail, updated_at: new Date().toISOString() }) });
      } catch (_) {}
      try { await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "marked lost", updated_at: new Date().toISOString() }) }); } catch (_) {}
      await cancelReignitions(clientId, contactId, routedToNurture ? "moved to nurture" : "marked lost");
      return res.status(200).json({ ok: true, marked_lost: !routedToNurture, routed_to_nurture: routedToNurture, opportunity_id: oppId, reason, goodbye_requested: goodbyeRequested, goodbye_sent: goodbyeSent, goodbye_error: goodbyeError });
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
      let oppId = null, oppRef = null;
      try { oppRef = await findOpenOpp({ clientId, ghl, token, locationId, contactId }); oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null; }
      catch (e) { return res.status(e.status || 502).json({ error: `find opp: ${e.message}` }); }
      if (!oppRef) return res.status(200).json({ error: "No opportunity found for this contact - nothing to abandon." });
      // Optional goodbye: write a message + mark unqualified in ONE action (Zoran
      // 2026-07-10). Sends only when explicitly provided - V1.5 overlays and older
      // deck builds omit `reply` and keep today's silent close. Sent BEFORE the
      // close, like confirm-lost, so send guards still see an open opp.
      const closing = (typeof b.reply === "string" ? b.reply : "").trim();
      const goodbyeRequested = !!closing;
      let goodbyeSent = false, goodbyeError = null;
      if (goodbyeRequested) { try { await sendReplyViaGhl(token, contactId, closing, clientId); goodbyeSent = true; } catch (e) { goodbyeError = e.message || String(e); } }
      const reason = (b.reason || (row && row.lost_reason) || "").toString().trim() || null;
      try {
        await setStatus({ clientId, ghl, token, oppRef, status: "abandoned", role: "unqualified", contactId, reason });
      } catch (e) { return res.status(e.status || 502).json({ error: `abandon: ${e.message}` }); }
      // Stamp the unqualified tag (best-effort — the abandon already succeeded, so
      // a tag failure must not 500 the action).
      try { await markUnqualified(token, contactId, clientId); } catch (_) {}
      try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "abandoned", reason }]) }); } catch (_) {}
      // Truthful bookkeeping: the acted-on row is 'sent' only when a goodbye actually
      // went out; every other swept card is 'canceled', never fake-'sent'.
      try {
        if (row && goodbyeSent) await sb(`agent_ready_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
        else if (row && goodbyeRequested && !goodbyeSent) await sb(`agent_ready_replies?id=eq.${encodeURIComponent(row.id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: `goodbye send failed: ${(goodbyeError || "unknown").slice(0, 160)}`, approved_by: staffEmail, updated_at: new Date().toISOString() }) });
        await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "marked unqualified", approved_by: staffEmail, updated_at: new Date().toISOString() }) });
      } catch (_) {}
      try { await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "abandoned", updated_at: new Date().toISOString() }) }); } catch (_) {}
      await cancelReignitions(clientId, contactId, "marked unqualified");
      return res.status(200).json({ ok: true, marked_abandoned: true, unqualified: true, opportunity_id: oppId, reason, goodbye_requested: goodbyeRequested, goodbye_sent: goodbyeSent, goodbye_error: goodbyeError });
    }

    // Options for the Hawkeye deck's Book-it pickers (Zoran 2026-07-08): the
    // academy's trial calendars (the offer-tied calendar entry points) + each
    // calendar's open slots for the next 2 weeks. Read-only.
    if (b.action === "book-options") {
      const cals = await loadCalendars(sb, clientId);
      const out = [];
      for (const c of cals) {
        let slots = [];
        try {
          const byDay = await freeSlots(token, c.key, { clientId, calLabel: c.label, days: 14 });
          slots = summarizeSlots(byDay, 24);
        } catch (_) {}
        out.push({ key: c.key, label: c.label, group: c.group || null, slots });
      }
      return res.status(200).json({ calendars: out });
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
        if (unq) await markUnqualified(token, contactId, clientId);
        else await unmarkUnqualified(token, contactId, clientId);
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
      // Provider branch: booking_provider='portal' books onto OUR slot via the
      // capacity-safe book_trial_slot RPC (no GHL appointment at all); every
      // other academy keeps the exact GHL appointment POST.
      let appt = null, trialBookingId = null, confirmationSent = false;
      if ((await bookingProviderOf(clientId)) === "portal") {
        try {
          trialBookingId = await bookPortalTrial(clientId, { slotAtIso: startIso, group: row.book_group, contactId, contactName: row.contact_name, athleteName: (b.athlete_name || "").toString().trim() || null });
        } catch (e) { return res.status(502).json({ error: `book: ${e.message}` }); }
        // Tell the parent it's locked in. GHL academies get GHL's own calendar
        // notification (toNotify below); portal academies got NOTHING - the card's
        // confirmation draft was never sent anywhere, so a lead who said "yes
        // please" heard silence until a human approved the next confirm card
        // (caught live on GTA 2026-07-10, Mike Sandhu). Prefers the deck's edited
        // text (b.reply), falls back to the detector's draft. Human-approved +
        // time-sensitive -> sends immediately (same exemption as lost goodbyes).
        // Add-to-calendar links ride along (same links the scripted confirmation
        // template carries), so this message fully replaces that step.
        // Distinguish "cleared the box" (b.reply is an empty string - the deck
        // ALWAYS sends a string) from "reply omitted" (undefined, old inbox card):
        // only fall back to the detector draft when reply was NOT provided. A
        // deliberately-cleared box must send NOTHING, not resurrect a stale draft
        // (Zoran 2026-07-10 - staff clears it when they already messaged the parent).
        let confirmMsg = (typeof b.reply === "string" ? b.reply : (row.draft_message || "")).trim();
        if (confirmMsg) {
          try {
            const startMs = new Date(startIso).getTime();
            const cal = { startMs, endMs: startMs + 3600000, title: "Free Trial" };
            confirmMsg += `\n\nAdd it to your calendar:\n\nApple: ${buildIcalUrl(cal)}\n\nGoogle: ${buildGoogleCalUrl(cal)}`;
          } catch (_) {}
          try { await sendReplyViaGhl(token, contactId, confirmMsg, clientId); confirmationSent = true; } catch (_) {}
        }
        // Also send the booking-confirmation EMAIL. The scripted "Booking
        // confirmation" step sent SMS + email, but the dedup marker below
        // suppresses that whole step - so without this the parent got the SMS but
        // never the "Your free trial is booked!" email (#11). Best-effort, email
        // only, only when we actually texted a confirmation. (The scripted
        // template's Location line still arrives via the same-day 9am check-in.)
        if (confirmationSent) {
          try {
            const info = await resolveContactInfo(token, contactId);
            if (info && info.email) await sendOn({ channel: "email", clientId, toEmail: info.email, subject: "Your free trial is booked!", body: confirmMsg, vars: {} });
          } catch (_) {}
        }
        // Mark the confirm agent's scripted "Booking confirmation" (when:
        // immediate) as handled for THIS trial - without this marker the next
        // confirm cron self-sends the template minutes later and the parent
        // gets two booking confirmations back to back. The same-day reminder
        // still fires (different step_key). fireScriptedStep matches
        // kind=confirm_auto + step_key + same trial_at (epoch compare).
        if (confirmationSent) {
          try {
            await sb(`agent_confirm_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
              client_id: clientId, ghl_contact_id: String(contactId), contact_name: row.contact_name || null,
              kind: "confirm_auto", step_key: "confirm", draft_message: confirmMsg, confidence: 1,
              trial_at: startIso, status: "sent", auto_sent: false, approved_by: staffEmail,
              approved_at: new Date().toISOString(), sent_at: new Date().toISOString(),
              reasoning: "Booking confirmation sent with the Book-it approval (replaces the scripted immediate step).",
              created_by: staffEmail,
            }]) });
          } catch (_) { /* marker is dedup only - never block the booking */ }
        }
      } else {
        try {
          appt = await ghl("POST", `/calendars/events/appointments`, { token, body: {
            calendarId, locationId, contactId, startTime: startIso,
            appointmentStatus: "confirmed", ignoreDateRange: true, toNotify: true,
            title: `Free Trial${row.contact_name ? " - " + row.contact_name : ""}`,
          } });
        } catch (e) { return res.status(e.status || 502).json({ error: `GHL book: ${e.message}` }); }
      }
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
      // Advance the opp per the academy's authored flow (the booked edge; GTA
      // seed = -> Scheduled Trial). Router reads the stage_transitions edge; on
      // no edge (unseeded / paused / lookup blip) it returns matched:false and we
      // run the original hardcoded move. moveStage's kpiTrialBooked hook fires on
      // either path (role stays scheduled_trial), so the trial-booked KPI is
      // unaffected. Best-effort - a stage-move failure must never break a booking.
      try {
        const oppRef = await findOpenOpp({ clientId, ghl, token, locationId, contactId });
        const routed = await routeTransition({ clientId, sb, ghl, token, locationId, fromRole: "responded", trigger: "booked", contactId, oppRef, reason: "booking approved" });
        if (!routed.matched) {
          const sts = await scheduledTrialStage(token, locationId, { clientId, sb });
          if (sts && oppRef) await moveStage({ clientId, ghl, token, oppRef, stage: sts, role: "scheduled_trial", contactId });
        }
      } catch (_) {}
      try { await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      await cancelReignitions(clientId, contactId, "trial booked");
      try { await logApproval({ client_id: clientId, ghl_contact_id: contactId, contact_name: row.contact_name || null, final_reply: `[booked ${row.book_group || "trial"} @ ${startIso}]${confirmationSent ? " + confirmation text sent" : ""}`, status: "sent", created_by: staffEmail }); } catch (_) {}
      return res.status(200).json({ ok: true, booked: true, confirmation_sent: confirmationSent, appointment_id: appt?.id || appt?.appointment?.id || trialBookingId || null, slot_at: startIso });
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
      // Find this contact's open opportunity (provider-aware; for the stage move + outcome log).
      let oppId = null, oppRef = null;
      try { oppRef = await findOpenOpp({ clientId, ghl, token, locationId, contactId }); oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null; }
      catch (e) { return res.status(e.status || 502).json({ error: `find opp: ${e.message}` }); }
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
      // Move the opp OUT of Responded per the academy's authored flow (the
      // went_quiet edge; GTA seed = -> Interested). Best-effort — the enroll
      // already happened; the GHL workflow will move them too. Router reads the
      // stage_transitions edge; if the academy has no edge (unseeded / paused /
      // lookup blip) it returns matched:false and we run the original hardcoded
      // move to Interested — behavior-identical for GTA, zero regression.
      try {
        const routed = await routeTransition({ clientId, sb, ghl, token, locationId, fromRole: "responded", trigger: "went_quiet", contactId, oppRef, reason: "confirm-ghost: went quiet" });
        if (!routed.matched) {
          const is = await interestedStage(token, locationId, { clientId, sb });
          if (is && oppRef) await moveStage({ clientId, ghl, token, oppRef, stage: is, role: "interested", contactId });
        }
      } catch (_) {}
      try { if (oppId) await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "ghosted", reason: "sent to ghosted automation" }]) }); } catch (_) {}
      // Clear ALL of this lead's queued cards (replies + follow-ups) — they've left Responded.
      // Ghosting sends nothing itself - swept cards are 'canceled', never fake-'sent'.
      try { await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "sent to ghosted", approved_by: staffEmail, updated_at: new Date().toISOString() }) }); } catch (_) {}
      try { await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "sent to ghosted", updated_at: new Date().toISOString() }) }); } catch (_) {}
      await cancelReignitions(clientId, contactId, "sent to ghosted");
      return res.status(200).json({ ok: true, ghosted: true, portal: portalGhosted, workflow_id: workflowId, opportunity_id: oppId });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-approvals]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
