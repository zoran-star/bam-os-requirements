// THE single place the sales agent's system prompt is assembled.
//
// Every agent path — sandbox preview, live approval-queue replies, scheduled
// follow-ups, and the trainer chat — MUST build its system prompt here so the
// bot is ALWAYS exactly the on-screen brain (prompt-structure.js sections +
// per-academy agent_prompt_sections overrides) plus its trainer lessons and
// approved examples, and nothing else. The only per-mode difference is the
// `trailer` (e.g. the sandbox tool instruction or the live-booking note).
//
// If you need to change how the prompt is built, change it HERE — never fork a
// second copy, or the live bot will silently drift from what staff preview.

import { assemblePrompt } from "./prompt-structure.js";

// Fetch the on-screen brain's per-academy state: section overrides + active
// lessons + approved examples. `sb` is the caller's Supabase REST helper.
export async function loadBrainConfig(sb, clientId) {
  const [lessons, ovRows, exRows] = await Promise.all([
    sb(`agent_lessons?client_id=eq.${clientId}&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
    sb(`agent_prompt_sections?client_id=eq.${clientId}&select=section_key,body`).catch(() => []),
    sb(`agent_examples?client_id=eq.${clientId}&select=parent_text,agent_text&order=created_at.asc`).catch(() => []),
  ]);
  const overrides = {};
  for (const r of (Array.isArray(ovRows) ? ovRows : [])) overrides[r.section_key] = r.body;
  return {
    lessons:  Array.isArray(lessons) ? lessons : [],
    overrides,
    examples: Array.isArray(exRows) ? exRows : [],
  };
}

// Build the agent system prompt from the brain + lessons + examples (+ optional
// lead context and a per-mode trailer). This is the ONLY assembly path.
export function buildAgentSystem({ lessons = [], overrides = {}, examples = [], leadContext = "", trailer = "", agent = "booking" } = {}) {
  let sys = assemblePrompt(overrides || {}, agent);

  const fixes = (Array.isArray(lessons) ? lessons : []).filter(l => l && l.kind !== "good").map(l => l.lesson).filter(Boolean);
  if (fixes.length) {
    sys += `\n\n<learned_lessons>\n` +
      `Your trainer has given you these corrections from past practice. They OVERRIDE the guidance above whenever they apply. Follow them strictly:\n` +
      fixes.map(l => `- ${l}`).join("\n") +
      `\n</learned_lessons>`;
  }

  if (Array.isArray(examples) && examples.length) {
    sys += `\n\n<trainer_examples>\n` +
      `These are your trainer's APPROVED example exchanges. They define the exact tone, length, and style to use — follow them over any examples above:\n` +
      examples.map(e => `Lead: "${e.parent_text}"\nYou: "${e.agent_text}"`).join("\n\n") +
      `\n</trainer_examples>`;
  }

  if (leadContext && String(leadContext).trim()) {
    sys += `\n\n<lead_context>\n` +
      `What you already know about this lead (from the form they submitted). Use it to qualify and personalize — do NOT re-ask for info you already have here:\n` +
      String(leadContext).trim() +
      `\n</lead_context>`;
  }

  if (trailer && String(trailer).trim()) sys += `\n\n${String(trailer).trim()}`;

  return sys;
}
