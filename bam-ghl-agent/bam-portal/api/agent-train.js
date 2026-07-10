import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — CLIENT-SIDE agent training (local knowledge only)
//
//   POST /api/agent-train { action, ... }   (Supabase bearer)
//
// Who can call it: a client_users row that is status='active' AND (role='owner'
// OR can_train_agent=true) for the target academy (or BAM staff, for testing).
//
//   "chat"           { messages, client_id?, lead_context? }
//                      → role-play test. Proposes the agent's next reply (NOT sent).
//   "teach"          { lesson, client_id? }
//                      → save an academy lesson (born scope='academy', applies now,
//                        promotion_status always 'none'). An AI classifier still runs
//                        but its verdict is stored ONLY as a promotion_reason hint for
//                        the /consolidate-lessons skill - there is no approval queue.
//   "lessons"        { client_id? }            → this academy's lessons (active).
//   "forget"         { id }                    → deactivate one of this academy's lessons.
//   "sections"       { client_id? }            → brain sections; only location/offer are editable.
//   "update-section" { key, body, client_id? } → edit a LOCAL section (location/offer only).
//   "reset-section"  { key, client_id? }       → revert a LOCAL section to default.
//
// ⚠️ LOCAL ONLY. This endpoint can never write a general-layer brain section or a
// general-scope lesson. General lessons are created only by /consolidate-lessons;
// global brain sections go through agent/_sections.js gating.

import { assemblePrompt, SECTIONS, AGENT_SPECS, sectionKeysForAgent } from "./agent/prompt-structure.js";
import { buildAgentSystem } from "./agent/brain.js";
import { loadMergedOverrides, loadGlobalSections, isGlobalSection, canEditGlobalBrain, setGlobalSection, deleteGlobalSection } from "./agent/_sections.js";

// Which agent is being trained: booking | confirm | closing. Defaults to booking.
const pickAgent = (a) => (a && AGENT_SPECS[a]) ? a : "booking";
// Lessons AND saved examples are now per-agent (booking/confirm/closing): each is
// stored with its `agent` and only that agent ever loads it, so a booking lesson
// or example never bleeds the wrong tone into a confirm/closing chat.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";

// Local (per-academy) vs global section gating now lives in agent/_sections.js
// (isGlobalSection / canEditGlobalBrain) so every agent agrees on the split.

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// bearer → { user, isStaff, grants: [{ id, client_id }] } where grants are the
// academies this user is allowed to TRAIN (active + owner OR can_train_agent).
// The grant set MUST match resolveAgentActor in api/agent/_auth.js: owners can
// work the Hawkeye deck, so their teach-why must save too - a narrower gate here
// 403'd owner lessons and the fire-and-forget teach callers swallowed the loss.
async function resolveTrainer(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await r.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  let rows = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&or=(role.eq.owner,can_train_agent.eq.true)&select=id,client_id`);
  if ((!rows || !rows.length) && user.email) {
    rows = await sb(`client_users?email=eq.${encodeURIComponent(user.email)}&status=eq.active&or=(role.eq.owner,can_train_agent.eq.true)&select=id,client_id`);
  }
  const grants = Array.isArray(rows) ? rows : [];
  return { user, isStaff, grants };
}

// Resolve the target academy for this request + the client_user row id (for
// attribution). Throws 403 if the caller may not train that academy.
function pickAcademy(ctx, bodyClientId) {
  if (ctx.isStaff) {
    // Staff may test any academy; attribution stays null (not a client trainer).
    const cid = bodyClientId || (ctx.grants[0] && ctx.grants[0].client_id);
    if (!cid) throw Object.assign(new Error("client_id required"), { status: 400 });
    return { clientId: cid, clientUserId: null };
  }
  if (!ctx.grants.length) throw Object.assign(new Error("you do not have agent-training access"), { status: 403 });
  let grant;
  if (bodyClientId) {
    grant = ctx.grants.find(g => g.client_id === bodyClientId);
    if (!grant) throw Object.assign(new Error("no training access for that academy"), { status: 403 });
  } else if (ctx.grants.length === 1) {
    grant = ctx.grants[0];
  } else {
    throw Object.assign(new Error("client_id required (multiple academies)"), { status: 400 });
  }
  return { clientId: grant.client_id, clientUserId: grant.id };
}

async function activeLessons(clientId, agent = "booking") {
  // Same shape as the LIVE readers (agent-approvals/confirm/closing + brain.js):
  // this academy's own lessons + the shared general set, so the Train-tab test
  // chat previews the same brain that actually sends.
  try {
    const rows = await sb(`agent_lessons?or=(client_id.eq.${clientId},and(client_id.is.null,scope.eq.general))&agent=eq.${agent}&active=eq.true&select=lesson,kind&order=created_at.asc`);
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}
async function sectionOverrides(clientId) {
  // Merged: shared BAM global brain (general/goal) UNDER this academy's own (location/offer).
  try { return await loadMergedOverrides(clientId); }
  catch (_) { return {}; }
}
async function savedExamples(clientId, agent = "booking") {
  try {
    const rows = await sb(`agent_examples?client_id=eq.${clientId}&agent=eq.${agent}&select=parent_text,agent_text&order=created_at.asc`);
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}

async function anthropic(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

// ── Sandbox chat (role-play test, never sent) ───────────────────────────────
const REPLY_TOOL = {
  name: "propose_reply",
  description: "Propose the agent's next text message to the lead (test — not sent).",
  input_schema: {
    type: "object",
    properties: {
      reply:           { type: "string", description: "The exact text to send the lead. Empty if escalating instead." },
      reasoning:       { type: "string", description: "Short (1-2 sentences) explanation of the choice / current stage." },
      confidence:      { type: "number", description: "0..1 confidence this is the right reply." },
      escalate:        { type: "boolean", description: "True if instructions say to silently flag this to a human admin instead of replying." },
      escalate_reason: { type: "string", description: "If escalate is true, why." },
      sources:         { type: "array", items: { type: "string" }, description: "The section tag(s) you drew this reply from — e.g. pricing, schedule, program, policies, tone, objection_handling, conversation_flow, qualification, guardrails. List the 1-3 most relevant. Use 'learned_lessons' if a trainer lesson drove it." },
    },
    required: ["reply", "reasoning", "confidence", "escalate"],
  },
};

const TRAIN_TRAILER =
  `<sandbox_mode>\nYou are in a TRAINING TEST talking to a coach role-playing as a lead — NOT a real customer. Do not actually send anything. ALWAYS respond by calling propose_reply: 'reply' is the exact text you'd send, 'reasoning' is a short why. Set 'escalate'=true when your instructions say to silently flag to admin (leave 'reply' empty then). In 'sources', list the section tag(s) of your knowledge you actually used (e.g. pricing, schedule, program, tone, objection_handling, conversation_flow, qualification, guardrails) so the trainer can see where it came from.\n</sandbox_mode>`;
function buildSystem(lessons, overrides, examples, leadContext, agent = "booking") {
  return buildAgentSystem({ lessons, overrides, examples, leadContext, trailer: TRAIN_TRAILER, agent });
}

async function handleChat(messages, clientId, leadContext, res, agent = "booking") {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "messages required" });
  // Each agent previews from ITS OWN lessons AND its OWN saved examples
  // (booking/confirm/closing, scoped) so a booking example never bleeds into a
  // confirm/closing preview and vice versa.
  const [lessons, overrides, examples] = await Promise.all([
    activeLessons(clientId, agent),
    sectionOverrides(clientId),
    savedExamples(clientId, agent),
  ]);
  const system = buildSystem(lessons, overrides, examples, leadContext, agent);
  const msgs = messages.filter(m => m && typeof m.text === "string" && m.text.trim() !== "")
    .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text }));
  while (msgs.length && msgs[msgs.length - 1].role === "assistant") msgs.pop();
  if (!msgs.length) return res.status(400).json({ error: "need at least one lead message" });
  const data = await anthropic({ model: ANTHROPIC_MODEL, max_tokens: 1024, system, tools: [REPLY_TOOL], tool_choice: { type: "tool", name: "propose_reply" }, messages: msgs });
  const tool = (data.content || []).find(b => b.type === "tool_use" && b.name === "propose_reply");
  if (!tool?.input) return res.status(502).json({ error: "no structured reply from Claude" });
  return res.status(200).json({
    reply: tool.input.reply || "",
    reasoning: tool.input.reasoning || "",
    confidence: typeof tool.input.confidence === "number" ? tool.input.confidence : null,
    escalate: !!tool.input.escalate,
    escalate_reason: tool.input.escalate_reason || null,
    sources: (Array.isArray(tool.input.sources) ? tool.input.sources : [])
      .map(t => {
        const key = String(t).toLowerCase().trim();
        if (key === "learned_lessons" || key === "lessons") return "Trainer lesson";
        const s = SECTIONS.find(x => x.key === key || x.tag === key);
        return s ? s.label : t;
      })
      .filter(Boolean).slice(0, 4),
    lessons_applied: lessons.filter(l => l.kind !== "good").length,
  });
}

// ── Classifier: is this lesson LOCAL fact or GLOBAL sales-craft? ─────────────
const CLASSIFY_TOOL = {
  name: "classify_lesson",
  description: "Classify a coaching lesson taught to an academy's AI booking agent.",
  input_schema: {
    type: "object",
    properties: {
      global: { type: "boolean", description: "True ONLY if the lesson is general sales-craft that would apply to ANY basketball academy (tone, persuasion, conversation style, objection handling, booking technique). False if it is specific to THIS academy (its pricing, schedule, location, coaches, programs, policies, or any local fact)." },
      reason: { type: "string", description: "One short sentence explaining the call." },
    },
    required: ["global", "reason"],
  },
};

async function classifyLesson(lessonText) {
  if (!ANTHROPIC_KEY) return { global: false, reason: "classifier unavailable" };
  try {
    const data = await anthropic({
      model: ANTHROPIC_MODEL, max_tokens: 256,
      system: "You decide whether a lesson taught to a single basketball academy's AI booking agent is LOCAL (specific to that one academy — its pricing, schedule, location, coaches, programs, policies, local facts) or GLOBAL sales-craft (general persuasion, tone, conversation style, objection handling, booking technique that would help ANY academy). Be conservative: only mark global=true when the lesson is clearly generic sales-craft with no academy-specific fact in it.",
      tools: [CLASSIFY_TOOL], tool_choice: { type: "tool", name: "classify_lesson" },
      messages: [{ role: "user", content: `Lesson:\n"${lessonText}"` }],
    });
    const tool = (data.content || []).find(b => b.type === "tool_use" && b.name === "classify_lesson");
    if (tool?.input) return { global: !!tool.input.global, reason: String(tool.input.reason || "") };
  } catch (e) { /* fall through to local */ }
  return { global: false, reason: "could not classify — kept local" };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let ctx;
  try { ctx = await resolveTrainer(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const b = req.body && typeof req.body === "object" ? req.body : {};
  let target;
  try { target = pickAcademy(ctx, b.client_id); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const { clientId, clientUserId } = target;

  try {
    if (b.action === "chat") {
      return await handleChat(b.messages, clientId, b.lead_context || "", res, pickAgent(b.agent));
    }

    if (b.action === "teach") {
      if (!b.lesson || !String(b.lesson).trim()) return res.status(400).json({ error: "lesson text required" });
      const text = String(b.lesson).trim();
      const cls = await classifyLesson(text);
      const [row] = await sb(`agent_lessons`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          client_id: clientId,
          agent: pickAgent(b.agent),
          kind: b.kind || "lesson",
          lesson: text,
          context: b.context || {},
          scope: "academy",                                   // always born local
          // Promote-to-general is RETIRED (2026-07-10): /consolidate-lessons does the
          // classification in batch. The per-teach classifier verdict is kept only as
          // a hint for that skill (promotion_reason), never as a pending queue.
          promotion_status: "none",
          promotion_reason: cls.reason ? `${cls.global ? "[general-craft?]" : "[local]"} ${cls.reason}` : null,
          submitted_by_client_user: clientUserId,
          created_by: ctx.user.email || "client-trainer",
        }]),
      });
      return res.status(200).json({ ok: true, lesson: row, proposed_global: cls.global, reason: cls.reason });
    }

    if (b.action === "save-example") {
      if (!b.parent_text || !b.agent_text) return res.status(400).json({ error: "parent_text and agent_text required" });
      const [row] = await sb(`agent_examples`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ client_id: clientId, agent: pickAgent(b.agent), parent_text: String(b.parent_text), agent_text: String(b.agent_text), created_by: ctx.user.email || "client-trainer" }]),
      });
      return res.status(200).json({ ok: true, example: row });
    }

    if (b.action === "lessons") {
      const rows = await sb(`agent_lessons?client_id=eq.${clientId}&agent=eq.${pickAgent(b.agent)}&active=eq.true&select=id,kind,lesson,scope,promotion_status,promotion_reason,created_by,created_at&order=created_at.desc`);
      return res.status(200).json({ lessons: Array.isArray(rows) ? rows : [] });
    }

    if (b.action === "forget") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      // scope the delete to this academy so a trainer can't touch another's lessons
      await sb(`agent_lessons?id=eq.${encodeURIComponent(b.id)}&client_id=eq.${clientId}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }),
      });
      return res.status(200).json({ ok: true });
    }

    if (b.action === "sections") {
      const agent = pickAgent(b.agent);
      // Two override sources: the GLOBAL brain (shared) and this academy's OWN.
      const [globalMap, clientRows] = await Promise.all([
        loadGlobalSections(),
        sb(`agent_prompt_sections?client_id=eq.${clientId}&select=section_key,body`).catch(() => []),
      ]);
      const clientMap = {};
      for (const r of (Array.isArray(clientRows) ? clientRows : [])) clientMap[r.section_key] = r.body;
      const canGlobal = canEditGlobalBrain(ctx, clientId);   // BAM staff or a global-editor academy (GTA)
      const bySection = new Map(SECTIONS.map(s => [s.key, s]));
      const sections = sectionKeysForAgent(agent)
        .map(k => bySection.get(k)).filter(Boolean)
        .map(s => {
          const glob = isGlobalSection(s.key);
          const ovVal = glob ? globalMap[s.key] : clientMap[s.key];   // global sections show the GLOBAL value
          return {
            key: s.key, label: s.label, group: s.layer,
            body: ovVal != null ? ovVal : s.body,
            default_body: s.body,
            is_default: ovVal == null,
            scope: glob ? "global" : "local",                          // UI badges global edits (affect all academies)
            editable: glob ? canGlobal : true,                         // local = always editable; global = only a global editor
          };
        });
      return res.status(200).json({ agent, sections, can_edit_global: canGlobal });
    }

    if (b.action === "update-section") {
      if (!b.key || !SECTIONS.some(s => s.key === b.key)) return res.status(400).json({ error: "unknown section key" });
      if (b.body == null || !String(b.body).trim()) return res.status(400).json({ error: "body required" });
      if (isGlobalSection(b.key)) {
        // GLOBAL section: editing it changes EVERY academy's agents. Gate on a global editor.
        if (!canEditGlobalBrain(ctx, clientId)) return res.status(403).json({ error: "that section is managed by BAM (global) - not editable here" });
        await setGlobalSection(b.key, b.body, ctx.user.email);
        return res.status(200).json({ ok: true, scope: "global" });
      }
      // LOCAL section: this academy's own override (location/offer).
      await sb(`agent_prompt_sections?on_conflict=client_id,section_key`, {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ client_id: clientId, section_key: b.key, body: String(b.body), updated_by: ctx.user.email || "client-trainer", updated_at: new Date().toISOString() }]),
      });
      return res.status(200).json({ ok: true, scope: "local" });
    }

    if (b.action === "reset-section") {
      if (!b.key) return res.status(400).json({ error: "key required" });
      if (isGlobalSection(b.key)) {
        if (!canEditGlobalBrain(ctx, clientId)) return res.status(403).json({ error: "that section is managed by BAM (global) - not editable here" });
        await deleteGlobalSection(b.key);   // revert the GLOBAL section to its BAM default (for all academies)
        return res.status(200).json({ ok: true, scope: "global" });
      }
      await sb(`agent_prompt_sections?client_id=eq.${clientId}&section_key=eq.${encodeURIComponent(b.key)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return res.status(200).json({ ok: true, scope: "local" });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-train]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
