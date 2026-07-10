#!/usr/bin/env node
// Lesson consolidation I/O for the /consolidate-lessons skill.
//
// The teach-why loop appends a raw agent_lessons row every time staff edit an
// agent draft. Left alone the pile grows forever and every lesson rides every
// future prompt. This script is the DB half of the consolidation skill: DUMP the
// raw pile for a human+Claude to cluster, then APPLY a plan that writes a compact
// consolidated set (academy-specific + shared "general" lessons) and deactivates
// the raw sources.
//
// Usage:
//   node scripts/lessons-io.mjs dump [clientId]        -> writes lessons-dump.json
//   node scripts/lessons-io.mjs apply <plan.json>      -> applies a consolidation plan
//
// Env (required): SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
// (or SUPABASE_SERVICE_KEY). Pull them from the Vercel project or a local .env.
//
// Storage model (matches the runtime readers in agent-*.js loadConfig + brain.js):
//   - Academy lesson  = agent_lessons row with client_id = <academy>, scope 'academy'
//   - General lesson  = agent_lessons row with client_id = NULL,      scope 'general'
//     (loaded for EVERY academy via or=(client_id.eq.X,and(client_id.is.null,scope.eq.general)))
// Both carry `agent` (booking|confirm|closing) so a general closing lesson never
// bleeds into booking. Consolidated rows are stamped created_by='consolidate-skill'.
//
// APPLY is non-destructive: archived rows are set active=false (history kept, just
// not loaded into prompts). Re-running: include prior consolidate-skill rows in
// plan.archive_ids so the fresh consolidated set replaces them.

import { readFileSync, writeFileSync } from "node:fs";

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
if (!SB_URL || !SB_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const AGENTS = ["booking", "confirm", "closing"];

async function dump(clientId) {
  // The academy's OWN active lessons (per agent) + the current SHARED general set.
  const ownFilter = clientId ? `client_id=eq.${encodeURIComponent(clientId)}` : `client_id=not.is.null`;
  const own = (await sb(`agent_lessons?${ownFilter}&active=eq.true&select=id,client_id,agent,scope,kind,lesson,created_by,created_at&order=agent.asc,created_at.asc`)) || [];
  const general = (await sb(`agent_lessons?client_id=is.null&scope=eq.general&active=eq.true&select=id,client_id,agent,scope,kind,lesson,created_by,created_at&order=agent.asc,created_at.asc`)) || [];
  const byAgent = {};
  for (const a of AGENTS) byAgent[a] = { academy: [], general: [] };
  for (const l of own) { const a = byAgent[l.agent] || (byAgent[l.agent] = { academy: [], general: [] }); a.academy.push(l); }
  for (const l of general) { const a = byAgent[l.agent] || (byAgent[l.agent] = { academy: [], general: [] }); a.general.push(l); }
  const out = { client_id: clientId || null, dumped_count: own.length + general.length, by_agent: byAgent };
  writeFileSync("lessons-dump.json", JSON.stringify(out, null, 2));
  console.log(`Wrote lessons-dump.json — ${own.length} academy + ${general.length} general lessons across ${Object.keys(byAgent).length} agents.`);
}

// plan.json shape:
// {
//   "client_id": "<uuid>",                     // the academy these academy-lessons belong to
//   "academy": [ { "agent": "booking", "lesson": "..." }, ... ],
//   "general": [ { "agent": "confirm", "lesson": "..." }, ... ],
//   "archive_ids": [ "<id>", "<id>", ... ]      // raw + prior-consolidated rows to deactivate
// }
async function apply(planPath) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (!plan || typeof plan !== "object") throw new Error("plan must be an object");
  const clientId = plan.client_id || null;
  const academy = Array.isArray(plan.academy) ? plan.academy : [];
  const general = Array.isArray(plan.general) ? plan.general : [];
  const archiveIds = Array.isArray(plan.archive_ids) ? plan.archive_ids.filter(Boolean) : [];
  const now = new Date().toISOString();

  // 1) Insert consolidated ACADEMY lessons (need a client_id).
  if (academy.length) {
    if (!clientId) throw new Error("plan.client_id is required when plan.academy is non-empty");
    const rows = academy
      .filter(l => l && l.agent && String(l.lesson || "").trim())
      .map(l => ({ client_id: clientId, agent: l.agent, scope: "academy", kind: "fix", lesson: String(l.lesson).trim(), active: true, created_by: "consolidate-skill" }));
    if (rows.length) await sb(`agent_lessons`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    console.log(`Inserted ${rows.length} consolidated academy lessons.`);
  }

  // 2) Insert consolidated GENERAL lessons (client_id NULL -> loaded for every academy).
  if (general.length) {
    const rows = general
      .filter(l => l && l.agent && String(l.lesson || "").trim())
      .map(l => ({ client_id: null, agent: l.agent, scope: "general", kind: "fix", lesson: String(l.lesson).trim(), active: true, created_by: "consolidate-skill" }));
    if (rows.length) await sb(`agent_lessons`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    console.log(`Inserted ${rows.length} consolidated general (shared-brain) lessons.`);
  }

  // 3) Deactivate the raw + replaced rows (history kept; just not loaded into prompts).
  let archived = 0;
  for (const id of archiveIds) {
    try {
      await sb(`agent_lessons?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false, updated_at: now }) });
      archived++;
    } catch (e) { console.error(`archive ${id} failed: ${e.message}`); }
  }
  console.log(`Archived ${archived} source lessons (active=false).`);
  console.log("Done. The agents load the consolidated set on their next run.");
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "dump") await dump(arg || null);
else if (cmd === "apply") { if (!arg) { console.error("usage: apply <plan.json>"); process.exit(1); } await apply(arg); }
else { console.error("usage: node scripts/lessons-io.mjs dump [clientId] | apply <plan.json>"); process.exit(1); }
