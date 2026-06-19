import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Sales-Agent SANDBOX (training only)
//
//   POST /api/agent-sandbox  { action, ... }   (staff bearer required)
//     action "chat"    { messages:[{role:'parent'|'agent', text}], client_id? }
//                        → Claude proposes the agent's next reply + reasoning.
//     action "teach"   { lesson, kind?, context?, client_id? }
//                        → save a training lesson (injected into future replies).
//     action "lessons" { client_id? }            → list active lessons.
//     action "forget"  { id }                     → deactivate a lesson.
//
// ⚠️ SANDBOX ONLY. This endpoint NEVER sends a message to GHL or a real phone.
// It calls Claude and returns the proposed reply for a trainer to review. The
// agent's behaviour = the vendored BAM GTA booking prompt + active lessons.

import { assemblePrompt, SECTIONS } from "./agent/prompt-structure.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";

// Default academy for the sandbox = BAM GTA (the only wired academy so far).
const DEFAULT_CLIENT_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Staff gate: Supabase bearer → user → row in `staff`. Returns the email or null.
async function requireStaff(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` },
  });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id) return null;
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  }
  return Array.isArray(staff) && staff[0] ? (user.email || "staff") : null;
}

async function activeLessons(clientId) {
  try {
    const rows = await sb(
      `agent_lessons?client_id=eq.${clientId}&active=eq.true&select=lesson,kind&order=created_at.asc`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}

// Per-academy overrides for individual prompt sections → { section_key: body }.
async function sectionOverrides(clientId) {
  try {
    const rows = await sb(`agent_prompt_sections?client_id=eq.${clientId}&select=section_key,body`);
    const map = {};
    for (const r of (Array.isArray(rows) ? rows : [])) map[r.section_key] = r.body;
    return map;
  } catch (_) { return {}; }
}

function buildSystem(lessons, overrides) {
  let sys = assemblePrompt(overrides || {});
  const fixes = lessons.filter(l => l.kind !== "good").map(l => l.lesson).filter(Boolean);
  if (fixes.length) {
    sys += `\n\n<learned_lessons>\n` +
      `Your trainer has given you these corrections from past practice. They OVERRIDE the guidance above whenever they apply. Follow them strictly:\n` +
      fixes.map(l => `- ${l}`).join("\n") +
      `\n</learned_lessons>`;
  }
  sys += `\n\n<sandbox_mode>\n` +
    `You are in a TRAINING SANDBOX talking to a coach role-playing as a parent/lead — NOT a real customer. ` +
    `Do not actually send anything. Instead, ALWAYS respond by calling the propose_reply tool: ` +
    `'reply' is the exact text you'd send the lead, 'reasoning' is a short (1-2 sentence) explanation of why you said it / what stage you're at, ` +
    `and set 'escalate' = true (with 'escalate_reason') in any case where your instructions say to silently flag the conversation to the admin. ` +
    `When escalating, still give a short reasoning and leave 'reply' empty.\n</sandbox_mode>`;
  return sys;
}

const REPLY_TOOL = {
  name: "propose_reply",
  description: "Propose the agent's next text message to the lead (sandbox — not sent).",
  input_schema: {
    type: "object",
    properties: {
      reply:          { type: "string", description: "The exact text to send the lead. Empty string if escalating instead of replying." },
      reasoning:      { type: "string", description: "Short (1-2 sentences) explanation of the choice / current stage of the conversation." },
      confidence:     { type: "number", description: "0..1 — how confident you are this is the right reply." },
      escalate:       { type: "boolean", description: "True if your instructions say to silently flag this to a human admin instead of replying." },
      escalate_reason:{ type: "string", description: "If escalate is true, why (e.g. complaint, off-topic, uncertain, repeat question)." },
    },
    required: ["reply", "reasoning", "confidence", "escalate"],
  },
};

async function handleChat(messages, clientId, res) {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "messages required" });

  const [lessons, overrides] = await Promise.all([activeLessons(clientId), sectionOverrides(clientId)]);
  const system = buildSystem(lessons, overrides);

  // Map sandbox turns → Anthropic roles. parent = user, agent = assistant.
  const anthropicMsgs = messages
    .filter(m => m && typeof m.text === "string" && m.text.trim() !== "")
    .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text }));
  // Must end on a user turn for a forced tool call.
  while (anthropicMsgs.length && anthropicMsgs[anthropicMsgs.length - 1].role === "assistant") anthropicMsgs.pop();
  if (!anthropicMsgs.length) return res.status(400).json({ error: "need at least one parent message" });

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system,
    tools: [REPLY_TOOL],
    tool_choice: { type: "tool", name: "propose_reply" },
    messages: anthropicMsgs,
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return res.status(502).json({ error: `Claude ${r.status}: ${(await r.text()).slice(0, 500)}` });
  const data = await r.json();
  const tool = (data.content || []).find(b => b.type === "tool_use" && b.name === "propose_reply");
  if (!tool?.input) return res.status(502).json({ error: "no structured reply from Claude" });

  return res.status(200).json({
    reply:        tool.input.reply || "",
    reasoning:    tool.input.reasoning || "",
    confidence:   typeof tool.input.confidence === "number" ? tool.input.confidence : null,
    escalate:     !!tool.input.escalate,
    escalate_reason: tool.input.escalate_reason || null,
    lessons_applied: lessons.filter(l => l.kind !== "good").length,
  });
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const staffEmail = await requireStaff(req);
  if (!staffEmail) return res.status(401).json({ error: "staff only" });

  const b = req.body && typeof req.body === "object" ? req.body : {};
  const clientId = b.client_id || DEFAULT_CLIENT_ID;
  const action = b.action;

  try {
    if (action === "chat") {
      return await handleChat(b.messages, clientId, res);
    }

    if (action === "teach") {
      if (!b.lesson || !String(b.lesson).trim()) return res.status(400).json({ error: "lesson text required" });
      const [row] = await sb(`agent_lessons`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          client_id:  clientId,
          kind:       b.kind || "lesson",
          lesson:     String(b.lesson).trim(),
          context:    b.context || {},
          created_by: staffEmail,
        }]),
      });
      return res.status(200).json({ ok: true, lesson: row });
    }

    if (action === "lessons") {
      const rows = await sb(
        `agent_lessons?client_id=eq.${clientId}&active=eq.true&select=id,kind,lesson,created_by,created_at&order=created_at.desc`
      );
      return res.status(200).json({ lessons: Array.isArray(rows) ? rows : [] });
    }

    if (action === "forget") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      await sb(`agent_lessons?id=eq.${encodeURIComponent(b.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ active: false }),
      });
      return res.status(200).json({ ok: true });
    }

    // ── Prompt "Brain" editor ──────────────────────────────
    if (action === "sections") {
      const ov = await sectionOverrides(clientId);
      return res.status(200).json({
        sections: SECTIONS.map(s => ({
          key:          s.key,
          label:        s.label,
          group:        s.group,
          body:         ov[s.key] != null ? ov[s.key] : s.body,  // current (override or default)
          default_body: s.body,
          is_default:   ov[s.key] == null,
        })),
      });
    }

    if (action === "update-section") {
      if (!b.key || !SECTIONS.some(s => s.key === b.key)) return res.status(400).json({ error: "unknown section key" });
      if (b.body == null || !String(b.body).trim()) return res.status(400).json({ error: "body required" });
      await sb(`agent_prompt_sections?on_conflict=client_id,section_key`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          client_id:   clientId,
          section_key: b.key,
          body:        String(b.body),
          updated_by:  staffEmail,
          updated_at:  new Date().toISOString(),
        }]),
      });
      return res.status(200).json({ ok: true });
    }

    if (action === "reset-section") {
      if (!b.key) return res.status(400).json({ error: "key required" });
      await sb(`agent_prompt_sections?client_id=eq.${clientId}&section_key=eq.${encodeURIComponent(b.key)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-sandbox]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
