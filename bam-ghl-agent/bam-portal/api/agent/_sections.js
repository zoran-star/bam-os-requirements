// Shared global-brain merge for the agents' prompt sections.
//
// Two layers of section overrides:
//   • GLOBAL ("MANAGED BY BAM") = the general/goal-layer sections (Role/Identity,
//     Tone, Who qualifies, objection handling, ...). Shared across EVERY academy.
//     Stored once per section_key in `agent_global_sections`. Edited only by BAM
//     staff or a designated global-editor academy (BAM GTA).
//   • LOCAL (per-academy) = the location/offer-layer sections (this academy's
//     pricing, schedule, coaches, ...). Stored in `agent_prompt_sections` keyed by
//     client_id. Edited by the academy itself.
//
// Every agent builds its prompt from BOTH: the global brain as the base, then the
// academy's own overrides on top (local facts win). Until a global override exists
// the merge is byte-identical to the old behavior (defaults + per-client overrides).
import { SECTIONS } from "./prompt-structure.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Layers an academy edits for ITSELF. Everything else is global (BAM-managed).
export const LOCAL_LAYERS = ["location", "offer"];
export const isGlobalSection = (key) => {
  const s = SECTIONS.find((x) => x.key === key);
  return !!s && !LOCAL_LAYERS.includes(s.layer);
};

// Academies allowed to edit the GLOBAL brain from their own portal (besides BAM
// staff). BAM GTA is the flagship/master academy. A global edit here propagates to
// EVERY academy's agents.
export const GLOBAL_BRAIN_EDITOR_CLIENT_IDS = ["39875f07-0a4b-4429-a201-2249bc1f24df"];
export const canEditGlobalBrain = (ctx, clientId) =>
  !!(ctx && ctx.isStaff) || GLOBAL_BRAIN_EDITOR_CLIENT_IDS.includes(clientId);

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// { section_key: body } for every globally-overridden section.
export async function loadGlobalSections() {
  try {
    const rows = await sb(`agent_global_sections?select=section_key,body`);
    const map = {};
    for (const r of (Array.isArray(rows) ? rows : [])) map[r.section_key] = r.body;
    return map;
  } catch (_) { return {}; }
}

// Final per-section overrides for an academy's agent: GLOBAL brain first, then the
// academy's OWN overrides on top. Key sets are disjoint in practice (global =
// general/goal, local = location/offer), so this is a clean union with local winning.
export async function loadMergedOverrides(clientId) {
  const [globalMap, clientRows] = await Promise.all([
    loadGlobalSections(),
    sb(`agent_prompt_sections?client_id=eq.${clientId}&select=section_key,body`).catch(() => []),
  ]);
  const overrides = { ...globalMap };
  for (const r of (Array.isArray(clientRows) ? clientRows : [])) overrides[r.section_key] = r.body;
  return overrides;
}

// Upsert / clear a GLOBAL section (affects all academies). Caller must gate on
// canEditGlobalBrain first.
export async function setGlobalSection(sectionKey, body, updatedBy) {
  await sb(`agent_global_sections?on_conflict=section_key`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ section_key: sectionKey, body: String(body), updated_by: updatedBy || "client-trainer", updated_at: new Date().toISOString() }]),
  });
}
export async function deleteGlobalSection(sectionKey) {
  await sb(`agent_global_sections?section_key=eq.${encodeURIComponent(sectionKey)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
