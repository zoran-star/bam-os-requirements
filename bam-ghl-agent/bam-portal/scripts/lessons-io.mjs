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
//   node scripts/lessons-io.mjs dump <clientId>                            -> writes lessons-dump.json
//   node scripts/lessons-io.mjs apply <plan.json> [--archive-only] [--force] -> applies a consolidation plan
//
// Env (required): SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
// (or SUPABASE_SERVICE_KEY). Pull them from the Vercel project or a local .env.
//
// Storage model (matches the runtime readers in agent-*.js loadConfig + brain.js):
//   - Academy lesson  = agent_lessons row with client_id = <academy>, scope 'academy'
//   - General lesson  = agent_lessons row with client_id = NULL,      scope 'general'
//     (loaded for EVERY academy via or=(client_id.eq.X,and(client_id.is.null,scope.eq.general)))
// Both carry `agent` (booking|confirm|closing) so a general closing lesson never
// bleeds into booking. Consolidated rows are stamped created_by='consolidate-skill'
// and carry lineage in context: { source_ids, intake_gap?, preset? } so a merged
// lesson can always be traced back to the raw teach events that justified it.
// General rows are preset-tagged (context.preset, default 'free_trial') because
// today's agents only implement the training-offer + free-trial presets; when a
// second sales motion ships, the tag is how we split the shared brain.
//
// plan.json shape (all lineage fields optional but strongly encouraged):
// {
//   "client_id": "<uuid>",             // the academy whose pile was dumped
//   "academy":  [ { "agent": "booking", "lesson": "...", "source_ids": ["..."], "intake_gap": "IC-003" } ],
//   "general":  [ { "agent": "confirm", "lesson": "...", "preset": "free_trial"|"universal", "source_ids": ["..."] } ],
//   "archive_ids":         [ "<id>" ], // THIS academy's raw/replaced rows to deactivate
//   "archive_general_ids": [ "<id>" ]  // shared (client_id NULL) rows to deactivate - affects EVERY academy
// }
//
// APPLY is non-destructive: archived rows are set active=false (history kept, not
// loaded into prompts). Safety rails:
//   - validates agent enum + rejects em dashes (U+2014) and emojis in lesson text
//   - archive PATCHes are SCOPED (academy ids to plan.client_id, general ids to
//     client_id IS NULL) so a wrong uuid can't deactivate another academy's row
//   - counts actually-changed rows (return=representation); phantom ids and
//     failures make the script exit 1 so a broken archive can't report clean
//   - all inserts go in ONE atomic POST, and a <plan>.applied marker (written
//     right after the insert) blocks accidental re-inserts: a bare re-run after
//     an archive failure retries archives only; --archive-only skips inserts
//     after you fix archive ids; --force re-applies EVERYTHING (re-inserts!)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

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
const PRESETS = ["free_trial", "universal"];
const SEL = "id,client_id,agent,scope,kind,lesson,context,promotion_reason,promotion_status,created_by,created_at";

// Repo hard rules: lessons ride prompts and can echo into parent-facing SMS.
const EM_DASH = /—/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{231A}-\u{231B}\u{23E9}-\u{23FA}\u{FE0F}]/u;
function lessonTextProblems(text) {
  const problems = [];
  if (EM_DASH.test(text)) problems.push("contains an em dash (use a hyphen)");
  if (EMOJI.test(text)) problems.push("contains an emoji");
  return problems;
}

async function dump(clientId) {
  if (!clientId) {
    console.error("dump requires a clientId. A no-arg dump used to mix EVERY academy's lessons into one bucket - a misattribution trap. Consolidate one academy at a time.");
    process.exit(1);
  }
  // The academy's OWN active lessons (per agent) + the current SHARED general set.
  // context (ai_drafted/you_sent) + promotion_reason ride along: they are the
  // richest classification + intake-mining signal the skill has.
  const own = (await sb(`agent_lessons?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=${SEL}&order=agent.asc,created_at.asc`)) || [];
  const general = (await sb(`agent_lessons?client_id=is.null&scope=eq.general&active=eq.true&select=${SEL}&order=agent.asc,created_at.asc`)) || [];
  const byAgent = {};
  const warnings = [];
  for (const a of AGENTS) byAgent[a] = { academy: [], good: [], general: [] };
  for (const l of own) {
    const a = byAgent[l.agent] || (byAgent[l.agent] = { academy: [], good: [], general: [] });
    // kind='good' rows are positive examples handled by a DIFFERENT mechanism
    // (brain.js excludes them from the OVERRIDE lesson block) - keep them out of
    // the correction pile so they never get merged into a 'fix' lesson.
    if (l.kind === "good") { a.good.push(l); continue; }
    if (l.scope === "general") {
      // Legacy promote-flow row: scope='general' but still pinned to this academy,
      // so it only ever loaded here. Treat as an academy row to RE-classify.
      warnings.push(`Lesson ${l.id} (${l.agent}) has scope='general' but client_id set - legacy promote row; reclassify it as academy or true general.`);
      l.legacy_general = true;
    }
    a.academy.push(l);
  }
  for (const l of general) { const a = byAgent[l.agent] || (byAgent[l.agent] = { academy: [], good: [], general: [] }); a.general.push(l); }
  const out = { client_id: clientId, dumped_count: own.length + general.length, warnings, by_agent: byAgent };
  writeFileSync("lessons-dump.json", JSON.stringify(out, null, 2));
  console.log(`Wrote lessons-dump.json - ${own.length} academy + ${general.length} general lessons across ${Object.keys(byAgent).length} agents.`);
  for (const w of warnings) console.log(`WARNING: ${w}`);
}

function validatePlan(plan) {
  const errs = [];
  if (!plan || typeof plan !== "object") return ["plan must be an object"];
  const academy = Array.isArray(plan.academy) ? plan.academy : [];
  const general = Array.isArray(plan.general) ? plan.general : [];
  const archiveIds = Array.isArray(plan.archive_ids) ? plan.archive_ids.filter(Boolean) : [];
  if ((academy.length || archiveIds.length) && !plan.client_id) {
    errs.push("plan.client_id is required when plan.academy or plan.archive_ids is non-empty");
  }
  for (const [bucket, list] of [["academy", academy], ["general", general]]) {
    list.forEach((l, i) => {
      const where = `${bucket}[${i}]`;
      if (!l || typeof l !== "object") { errs.push(`${where}: not an object`); return; }
      if (!AGENTS.includes(l.agent)) errs.push(`${where}: agent '${l.agent}' is not one of ${AGENTS.join("|")}`);
      const text = String(l.lesson || "").trim();
      if (!text) errs.push(`${where}: empty lesson text`);
      for (const p of lessonTextProblems(text)) errs.push(`${where}: ${p}`);
      if (bucket === "general" && l.preset && !PRESETS.includes(l.preset)) {
        errs.push(`${where}: preset '${l.preset}' is not one of ${PRESETS.join("|")}`);
      }
    });
  }
  return errs;
}

function lineage(l) {
  const ctx = {};
  if (Array.isArray(l.source_ids) && l.source_ids.length) ctx.source_ids = l.source_ids;
  if (l.intake_gap) ctx.intake_gap = String(l.intake_gap);
  return ctx;
}

// Deactivate one row with a SCOPED filter; returns true only if a row actually changed.
async function archiveOne(id, scopeFilter) {
  const rows = await sb(`agent_lessons?id=eq.${encodeURIComponent(id)}&${scopeFilter}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ active: false }),
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function apply(planPath, force, archiveOnly) {
  const raw = readFileSync(planPath, "utf8");
  const plan = JSON.parse(raw);

  const errs = validatePlan(plan);
  if (errs.length) {
    console.error(`Plan validation FAILED (${errs.length}) - nothing was written:`);
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
  }

  // Re-run guard: the same plan applied twice double-inserts every lesson.
  // The marker stores the plan hash. Rules:
  //   - same hash + failed archives  -> auto-retry the ARCHIVES ONLY (inserts landed)
  //   - same hash + clean            -> refuse (--force re-applies EVERYTHING, incl. re-inserts)
  //   - different hash + marker      -> refuse: either you fixed archive ids after a
  //     failure (use --archive-only) or it's a genuinely new plan (delete the marker)
  const marker = `${planPath}.applied`;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  let skipInserts = archiveOnly;
  if (existsSync(marker) && !force) {
    let prior = null;
    try { prior = JSON.parse(readFileSync(marker, "utf8")); } catch (_) {}
    if (prior && prior.hash === hash) {
      if (prior.inserts_done && Array.isArray(prior.failed) && prior.failed.length) {
        console.log(`Marker shows this plan's inserts landed but ${prior.failed.length} archive(s) failed - retrying the ARCHIVE phase only (no re-inserts).`);
        skipInserts = true;
      } else if (!archiveOnly) {
        console.error(`${marker} exists with the same plan hash - this plan is already applied. Re-running would duplicate every consolidated lesson. Options: --archive-only (archives only, no inserts) or --force (full re-apply, RE-INSERTS ALL LESSONS).`);
        process.exit(1);
      }
    } else if (prior && !archiveOnly) {
      console.error(`Marker at ${marker} is from a DIFFERENT plan (hash mismatch). If you only edited archive ids after a failed archive, re-run with --archive-only (the inserts already landed). If this is a genuinely new plan, delete the marker file first.`);
      process.exit(1);
    }
  }
  if (skipInserts) console.log("Running in archive-only mode - no lessons will be inserted.");

  const clientId = plan.client_id || null;
  const academy = Array.isArray(plan.academy) ? plan.academy : [];
  const general = Array.isArray(plan.general) ? plan.general : [];
  const archiveIds = Array.isArray(plan.archive_ids) ? plan.archive_ids.filter(Boolean) : [];
  const archiveGeneralIds = Array.isArray(plan.archive_general_ids) ? plan.archive_general_ids.filter(Boolean) : [];

  // 1) Insert ALL consolidated lessons in ONE atomic POST (single statement =
  //    academy + general land together or not at all, so a mid-apply crash can
  //    never leave half the inserts in). General rows (client_id NULL -> loaded
  //    for every academy) are preset-tagged: today's agents are the
  //    training-offer + free-trial presets only.
  if (!skipInserts) {
    const rows = [
      ...academy.map(l => ({
        client_id: clientId, agent: l.agent, scope: "academy", kind: "fix",
        lesson: String(l.lesson).trim(), active: true, created_by: "consolidate-skill",
        context: lineage(l),
      })),
      ...general.map(l => ({
        client_id: null, agent: l.agent, scope: "general", kind: "fix",
        lesson: String(l.lesson).trim(), active: true, created_by: "consolidate-skill",
        context: { preset: l.preset || "free_trial", ...lineage(l) },
      })),
    ];
    if (rows.length) await sb(`agent_lessons`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    console.log(`Inserted ${academy.length} academy + ${general.length} general (shared-brain) consolidated lessons.`);
    // Write the marker NOW - if the archive phase dies, a bare re-run must know
    // the inserts already landed and skip straight to the archives.
    writeFileSync(marker, JSON.stringify({ hash, inserts_done: true, applied_at: new Date().toISOString(), archived: 0, failed: ["archive phase not run yet"] }, null, 2));
  }

  // 2) Deactivate the raw + replaced rows (history kept; just not loaded into
  //    prompts). Academy ids are scoped to plan.client_id; general ids to
  //    client_id IS NULL - a stray uuid can no longer silently deactivate some
  //    other academy's lesson.
  let archived = 0;
  const failed = [];
  for (const id of archiveIds) {
    try {
      if (await archiveOne(id, `client_id=eq.${encodeURIComponent(clientId)}`)) archived++;
      else failed.push(`${id} (no matching ACTIVE row for this academy - wrong id, wrong bucket, or already archived?)`);
    } catch (e) { failed.push(`${id} (${e.message})`); }
  }
  for (const id of archiveGeneralIds) {
    try {
      if (await archiveOne(id, `client_id=is.null&scope=eq.general`)) archived++;
      else failed.push(`${id} (no matching ACTIVE shared general row - wrong id, wrong bucket, or already archived?)`);
    } catch (e) { failed.push(`${id} (${e.message})`); }
  }
  console.log(`Archived ${archived}/${archiveIds.length + archiveGeneralIds.length} source lessons (active=false).`);
  writeFileSync(marker, JSON.stringify({ hash, inserts_done: true, applied_at: new Date().toISOString(), archived, ...(failed.length ? { failed } : {}) }, null, 2));
  if (failed.length) {
    console.error(`ARCHIVE FAILED for ${failed.length} row(s) - the raw lessons below are STILL ACTIVE and now ride prompts NEXT TO their consolidated replacements:`);
    for (const f of failed) console.error(`  - ${f}`);
    console.error(`Recovery: fix the ids in ${planPath} (e.g. a shared general id belongs in archive_general_ids, not archive_ids), then re-run with --archive-only. NEVER use --force here - it would re-insert every lesson.`);
    process.exit(1);
  }

  console.log("Done. The agents load the consolidated set on their next run.");
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const archiveOnly = args.includes("--archive-only");
const [cmd, arg] = args.filter(a => !a.startsWith("--"));
if (cmd === "dump") await dump(arg || null);
else if (cmd === "apply") { if (!arg) { console.error("usage: apply <plan.json> [--archive-only] [--force]"); process.exit(1); } await apply(arg, force, archiveOnly); }
else { console.error("usage: node scripts/lessons-io.mjs dump <clientId> | apply <plan.json> [--archive-only] [--force]"); process.exit(1); }
