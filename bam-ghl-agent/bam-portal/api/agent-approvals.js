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

import { pickGhlToken, ghl } from "./ghl/_core.js";
import { assemblePrompt } from "./agent/prompt-structure.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";
const DEFAULT_CLIENT_ID    = "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA

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

function buildSystem({ lessons, overrides, examples }) {
  let sys = assemblePrompt(overrides || {});
  const fixes = lessons.filter(l => l.kind !== "good").map(l => l.lesson).filter(Boolean);
  if (fixes.length) {
    sys += `\n\n<learned_lessons>\nYour trainer's corrections — follow them strictly, they override the guidance above when they apply:\n` +
      fixes.map(l => `- ${l}`).join("\n") + `\n</learned_lessons>`;
  }
  if (Array.isArray(examples) && examples.length) {
    sys += `\n\n<trainer_examples>\nApproved example exchanges — match this exact tone/length/style:\n` +
      examples.map(e => `Lead: "${e.parent_text}"\nYou: "${e.agent_text}"`).join("\n\n") + `\n</trainer_examples>`;
  }
  sys += `\n\n<live_booking>\n` +
    `You are drafting the next SMS to a REAL lead who just replied and is in the "Responded" stage. Your single goal is to book them into a free trial. A human reviews your draft before it sends. ` +
    `Respond ONLY by calling propose_reply: 'reply' = the exact text to send; 'reasoning' = 1-2 sentence why; 'confidence' = 0..1; ` +
    `'asked_to_book' = true if your reply invites them to book/come in; 'escalate' = true (with 'escalate_reason', reply empty) if your guardrails say to hand to a human instead of replying.\n</live_booking>`;
  return sys;
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

// Find the Training Pipeline + its "responded" stage id.
async function respondedStage(token, locationId) {
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = data.pipelines || data.data || [];
  const pipe = pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0];
  if (!pipe) return null;
  const stage = (pipe.stages || []).find(s => /respond/i.test(s.name || ""));
  return stage ? { pipelineId: pipe.id, stageId: stage.id } : null;
}

// HARD GUARD: the agent only ever drafts/sends for a contact whose opportunity
// is currently in the Responded stage. Never replies to members, Interested,
// booked, won/lost, etc.
async function contactInRespondedStage(token, locationId, contactId, rs) {
  try {
    const params = new URLSearchParams({ location_id: locationId, contact_id: contactId, pipeline_id: rs.pipelineId, limit: "20" });
    const d = await ghl("GET", `/opportunities/search?${params}`, { token });
    const opps = d.opportunities || d.data || [];
    return opps.some(o => (o.pipelineStageId || o.stageId) === rs.stageId);
  } catch (_) { return false; }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const staffEmail = await requireStaff(req);
  if (!staffEmail) return res.status(401).json({ error: "staff only" });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const b = req.body && typeof req.body === "object" ? req.body : {};
  const clientId = b.client_id || DEFAULT_CLIENT_ID;
  const client = await loadClient(clientId);
  if (!client) return res.status(404).json({ error: "academy not found" });
  const creds = await pickGhlToken(client);
  if (!creds) return res.status(400).json({ error: "academy not connected to GHL" });
  const { token, locationId } = creds;

  try {
    if (b.action === "list") {
      const rs = await respondedStage(token, locationId);
      if (!rs) return res.status(200).json({ queue: [], note: "no Responded stage found" });
      // Opportunities in the responded stage.
      const oppParams = new URLSearchParams({ location_id: locationId, pipeline_id: rs.pipelineId, pipeline_stage_id: rs.stageId, limit: "100" });
      let opps = [];
      try { const od = await ghl("GET", `/opportunities/search?${oppParams}`, { token }); opps = od.opportunities || od.data || []; } catch (_) {}
      const respondedContactIds = new Set(opps.map(o => o.contactId || o.contact?.id).filter(Boolean));
      // One conversations search; keep those whose last message is inbound.
      const cd = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, limit: "100" })}`, { token });
      const convos = cd.conversations || cd.data || [];
      const queue = convos
        .filter(c => respondedContactIds.has(c.contactId) && String(c.lastMessageDirection || "").toLowerCase() === "inbound")
        .map(c => ({ contact_id: c.contactId, conversation_id: c.id, name: c.fullName || c.contactName || "Unknown", last_message: c.lastMessageBody || "", last_at: c.lastMessageDate || c.dateUpdated || null }))
        .sort((a, b2) => new Date(b2.last_at || 0) - new Date(a.last_at || 0));
      return res.status(200).json({ queue, count: queue.length });
    }

    if (b.action === "draft") {
      if (!b.contact_id) return res.status(400).json({ error: "contact_id required" });
      const rs = await respondedStage(token, locationId);
      if (!rs) return res.status(200).json({ error: "No Responded stage found in the Training Pipeline." });
      if (!(await contactInRespondedStage(token, locationId, b.contact_id, rs))) {
        return res.status(200).json({ error: "This lead isn't in the Responded stage — the bot only replies to Responded-stage leads." });
      }
      const convo = await findConversation(token, locationId, b.contact_id);
      if (!convo) return res.status(200).json({ error: "no conversation for contact" });
      const messages = await threadMessages(token, convo.id);
      const cfg = await loadConfig(clientId);
      const out = await runAgent(buildSystem(cfg), messages);
      const agentMsgs = messages.filter(m => m.role === "agent");
      return res.status(200).json({
        conversation_id: convo.id,
        reply: out.reply || "",
        reasoning: out.reasoning || "",
        confidence: typeof out.confidence === "number" ? out.confidence : null,
        escalate: !!out.escalate,
        escalate_reason: out.escalate_reason || null,
        asked_to_book: !!out.asked_to_book || BOOK_ASK.test(out.reply || ""),
        reply_count: agentMsgs.length,
        booking_asks: agentMsgs.filter(m => BOOK_ASK.test(m.text)).length,
      });
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
      return res.status(200).json({ ok: true, sent: true, lesson_id: lessonId });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-approvals]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
