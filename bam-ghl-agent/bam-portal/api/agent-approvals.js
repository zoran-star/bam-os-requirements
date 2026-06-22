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
import { assemblePrompt } from "./agent/prompt-structure.js";
import { buildAgentSystem } from "./agent/brain.js";
import { loadContactMemory } from "./agent/contact-memory.js";
import { respondedStage, contactInRespondedStage, computeQueue } from "./agent/_stage.js";
import { agentMode, modeIsOn, shouldAutoSend } from "./agent/_mode.js";
import { resolveAgentActor } from "./agent/_auth.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";
const DEFAULT_CLIENT_ID    = "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA
const DETECT_CAP           = 10;   // max ready replies drafted per academy per run

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
  const [lessons, ovRows, exRows] = await Promise.all([
    sb(`agent_lessons?client_id=eq.${clientId}&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
    sb(`agent_prompt_sections?client_id=eq.${clientId}&select=section_key,body`).catch(() => []),
    sb(`agent_examples?client_id=eq.${clientId}&select=parent_text,agent_text&order=created_at.asc`).catch(() => []),
  ]);
  const overrides = {};
  for (const r of (Array.isArray(ovRows) ? ovRows : [])) overrides[r.section_key] = r.body;
  return { lessons: Array.isArray(lessons) ? lessons : [], overrides, examples: Array.isArray(exRows) ? exRows : [] };
}

const LIVE_BOOKING_TRAILER =
  `<live_booking>\n` +
  `You are drafting the next SMS to a REAL lead who just replied and is in the "Responded" stage. Your single goal is to book them into a free trial. A human reviews your draft before it sends. ` +
  `Respond ONLY by calling propose_reply: 'reply' = the exact text to send; 'reasoning' = 1-2 sentence why; 'confidence' = 0..1; ` +
  `'asked_to_book' = true if your reply invites them to book/come in; 'escalate' = true (with 'escalate_reason', reply empty) if your guardrails say to hand to a human instead of replying. ` +
  `If your lost_criteria say this lead should be closed out, set 'recommend_lost' = true with a short 'lost_reason' from the taxonomy, and put your warm closing message in 'reply' (a human confirms the Lost before anything changes).\n</live_booking>`;
function buildSystem({ lessons, overrides, examples }) {
  return buildAgentSystem({ lessons, overrides, examples, trailer: LIVE_BOOKING_TRAILER });
}

const REPLY_TOOL = {
  name: "propose_reply",
  description: "Propose the agent's next text to the lead (a human approves before it sends).",
  input_schema: {
    type: "object",
    properties: {
      reply:           { type: "string", description: "The exact text to send. Empty if escalating." },
      reasoning:       { type: "string", description: "Short (1-2 sentences) why / current stage." },
      confidence:      { type: "number", description: "0..1 confidence this is the right reply." },
      asked_to_book:   { type: "boolean", description: "True if this reply invites the lead to book or come in." },
      escalate:        { type: "boolean", description: "True if guardrails say to hand to a human instead of replying." },
      escalate_reason: { type: "string", description: "If escalate: why." },
      recommend_lost:  { type: "boolean", description: "True if your lost_criteria say this lead should be marked Lost (a human confirms it)." },
      lost_reason:     { type: "string", description: "If recommend_lost: the closest taxonomy reason (Too expensive / Not enough time / Started other programs / Not locked in / Bad fit / Invalid lead / Opted out / Other)." },
    },
    required: ["reply", "reasoning", "confidence", "escalate"],
  },
};

async function runAgent(system, messages) {
  const anthropicMsgs = messages
    .filter(m => m && typeof m.text === "string" && m.text.trim() !== "")
    .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text }));
  while (anthropicMsgs.length && anthropicMsgs[anthropicMsgs.length - 1].role === "assistant") anthropicMsgs.pop();
  if (!anthropicMsgs.length) throw new Error("no inbound message to reply to");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, system, tools: [REPLY_TOOL], tool_choice: { type: "tool", name: "propose_reply" }, messages: anthropicMsgs }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const data = await r.json();
  const tool = (data.content || []).find(b => b.type === "tool_use" && b.name === "propose_reply");
  if (!tool?.input) throw new Error("no structured reply from Claude");
  return tool.input;
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
  return msgs.map(m => ({ role: m.direction === "outbound" ? "agent" : "parent", text: m.text }));
}

// Draft the agent's next reply for one Responded-stage contact. Returns the
// structured proposal (reply/reasoning/confidence/escalate/…) or { error }.
// Shared by the on-demand `draft` action and the `detect` cron. opts lets the
// detector skip GHL calls it already made via computeQueue (stage check +
// conversation lookup) to stay well under GHL's rate limit:
//   { rs, conversationId, skipStageGuard }
async function draftForContact(token, locationId, clientId, contactId, cfg, opts = {}) {
  const rs = opts.rs || await respondedStage(token, locationId);
  if (!rs) return { error: "No Responded stage found in the Training Pipeline." };
  if (!opts.skipStageGuard && !(await contactInRespondedStage(token, locationId, contactId, rs))) {
    return { error: "This lead isn't in the Responded stage — the bot only replies to Responded-stage leads." };
  }
  let conversationId = opts.conversationId;
  if (!conversationId) {
    const convo = await findConversation(token, locationId, contactId);
    if (!convo) return { error: "no conversation for contact" };
    conversationId = convo.id;
  }
  const messages = await threadMessages(token, conversationId);
  const system = buildSystem(cfg) + await loadContactMemory(sb, clientId, contactId);
  const out = await runAgent(system, messages);
  const agentMsgs = messages.filter(m => m.role === "agent");
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
    last_message: (() => { const lead = [...messages].reverse().find(m => m.role === "parent"); return lead ? String(lead.text).slice(0, 500) : null; })(),
    reply_count: agentMsgs.length,
    booking_asks: agentMsgs.filter(m => BOOK_ASK.test(m.text)).length,
  };
}

// Fire a reply via GHL SMS (used by manual approve + self-drive auto-send).
async function sendReplyViaGhl(token, contactId, reply) {
  await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId, message: String(reply) } });
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

  let rs, queue;
  try { ({ rs, queue } = await computeQueue(token, locationId)); }
  catch (e) { return { client_id: client.id, error: `queue: ${e.message}` }; }
  if (!rs) return { client_id: client.id, skipped: "no Responded stage" };

  const cfg = await loadConfig(client.id);
  let drafted = 0, autoSent = 0, skipped = 0, escalated = 0, lostProposed = 0;
  const reasons = [];   // diagnostic: why each contact was skipped

  // Cap how many contacts we draft per run so a big Responded queue can't burst
  // GHL's rate limit (each draft hits GHL for the thread + Claude).
  let _first = true;
  for (const item of queue.slice(0, DETECT_CAP)) {
    if (!_first) await new Promise(r => setTimeout(r, 300));  // smooth GHL bursts
    _first = false;
    const contactId = item.contact_id;
    if (!contactId) { skipped++; reasons.push(`${item.name || "?"}: no contactId in queue item`); continue; }
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
          last_message: d.last_message || null,
          confidence: d.confidence, last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
        }]) });
        lostProposed++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: lost-insert failed — ${e.message}`); }
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
            last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
          }]) });
        } catch (_) {}
      }
      continue;
    }

    const auto = shouldAutoSend(mode, { confidence: d.confidence, escalate: d.escalate });
    if (auto) {
      try {
        await sendReplyViaGhl(token, contactId, d.reply);
        await sb(`agent_ready_replies`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: d.conversation_id || null,
          contact_name: item.name || null, draft_message: d.reply, reasoning: d.reasoning || null, confidence: d.confidence,
          asked_to_book: d.asked_to_book, reply_count: d.reply_count, booking_asks: d.booking_asks, last_message: d.last_message || null,
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
          asked_to_book: d.asked_to_book, reply_count: d.reply_count, booking_asks: d.booking_asks, last_message: d.last_message || null,
          last_lead_at: item.last_at || null, status: "pending", created_by: "detector",
        }]) });
        drafted++;
      } catch (e) { skipped++; reasons.push(`${item.name || contactId}: pending-insert failed — ${e.message}`); }
    }
  }
  return { client_id: client.id, business: client.business_name, mode, queued: queue.length, drafted, auto_sent: autoSent, escalated, lost_proposed: lostProposed, skipped, reasons };
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
      const { queue } = await computeQueue(creds.token, creds.locationId);
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
      return res.status(200).json({ ready: Array.isArray(rows) ? rows : [], count: Array.isArray(rows) ? rows.length : 0 });
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
      const { queue } = await computeQueue(token, locationId);
      return res.status(200).json({ queue, count: queue.length });
    }

    if (b.action === "draft") {
      if (!b.contact_id) return res.status(400).json({ error: "contact_id required" });
      const cfg = await loadConfig(clientId);
      const d = await draftForContact(token, locationId, clientId, b.contact_id, cfg);
      if (d.error) return res.status(200).json({ error: d.error });
      return res.status(200).json(d);
    }

    if (b.action === "send") {
      if (!b.contact_id || !b.reply || !String(b.reply).trim()) return res.status(400).json({ error: "contact_id and reply required" });
      // HARD GUARD: refuse to send unless the lead is still in the Responded stage.
      const rsSend = await respondedStage(token, locationId);
      if (!rsSend || !(await contactInRespondedStage(token, locationId, b.contact_id, rsSend))) {
        return res.status(409).json({ error: "This lead is no longer in the Responded stage — not sending." });
      }
      // Send via GHL (human-approved).
      try {
        await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId: b.contact_id, message: String(b.reply) } });
      } catch (e) {
        return res.status(e.status || 502).json({ error: `GHL send: ${e.message}` });
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
      if (!b.ready_id) return res.status(400).json({ error: "ready_id required" });
      const [row] = await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}&select=*`);
      if (!row) return res.status(404).json({ error: "not found" });
      const contactId = row.ghl_contact_id;
      // Find this contact's opportunity so we can set its status.
      let oppId = null;
      try {
        const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: locationId, contact_id: contactId, limit: "20" })}`, { token });
        const opps = d.opportunities || d.data || [];
        const pick = opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0];
        oppId = pick && pick.id;
      } catch (e) { return res.status(e.status || 502).json({ error: `GHL find opp: ${e.message}` }); }
      if (!oppId) return res.status(200).json({ error: "No opportunity found for this contact — nothing to mark lost." });
      // Send the warm closing message first, if the agent wrote one and staff kept it.
      const closing = (typeof b.reply === "string" ? b.reply : row.draft_message) || "";
      if (closing.trim()) { try { await sendReplyViaGhl(token, contactId, closing.trim()); } catch (_) {} }
      try {
        await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, { token, body: { status: "lost" } });
      } catch (e) { return res.status(e.status || 502).json({ error: `GHL mark lost: ${e.message}` }); }
      const reason = (b.lost_reason || row.lost_reason || "").toString().trim() || null;
      try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "lost", reason }]) }); } catch (_) {}
      try { await sb(`agent_ready_replies?id=eq.${encodeURIComponent(b.ready_id)}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", approved_by: staffEmail, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); } catch (_) {}
      return res.status(200).json({ ok: true, marked_lost: true, opportunity_id: oppId, reason });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-approvals]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
