// ── Agent FACT renderer (Build 2: facts are derived, never typed) ────────────
// A fact section of the agent brain is a VIEW onto structured data the academy
// already maintains - not free text someone retypes per academy (tier 3 of the
// control-dial model, Zoran 2026-07-23). The academy edits their OFFER; every
// agent reads the change on the next prompt build. No double entry, no drift.
//
// First fact wired: `program` <- offers.data (general_info + general + schedule
// classes). Proof of why this exists: before this shipped, GTA had THREE
// different answers for ages (stored override "6 and up", offer "9-17",
// hardcoded default "9 and up").
//
// Precedence (applied in _sections.loadMergedOverrides + brain.loadBrainConfig):
//   rendered fact  >  stored per-academy text  >  hardcoded default
// The renderer returns null when the offer is too sparse to trust (fewer than 3
// lines) - the stored/default text then serves as the fallback, so a brand-new
// academy mid-onboarding never gets a half-empty brain section.
//
// Deliberately NOT rendered (Zoran 2026-07-23): private training, adult
// classes, camps/clinics - each becomes its own OFFER TYPE later; until an
// academy has such an offer the agent treats it as not-currently-offered.

// Pure: offers.data JSON in -> section text out (or null = fall back).
export function renderProgram(data) {
  if (!data || typeof data !== "object") return null;
  const gi = data.general_info || {};
  const gen = data.general || {};
  const classes = (data.schedule && Array.isArray(data.schedule.classes)) ? data.schedule.classes : [];
  const lines = [];

  if (gi.age_range) lines.push(`Ages: ${gi.age_range}`);

  const genders = Array.isArray(gi.gender) ? gi.gender.filter(Boolean) : (gi.gender ? [gi.gender] : []);
  if (genders.length >= 2) lines.push("Co-ed (boys + girls)");
  else if (genders.length === 1) lines.push(`${genders[0]} only`);

  if (gi.skill_level) {
    lines.push(String(gi.skill_level).toLowerCase() === "all"
      ? "Skill levels: all (beginners welcome, advanced athletes grouped appropriately)"
      : `Skill levels: ${gi.skill_level}`);
  }

  const desc = gi.description || gen.description;
  if (desc) lines.push(`What it is: ${desc}`);
  if (gen.structure) lines.push(`Structure: ${gen.structure}`);

  // Group size: per-class first (schedule step), else the offer's session
  // capacity (the booking limit) as a coarser fallback.
  const sizes = [...new Set(classes.map((c) => c && c.group_size).filter(Boolean).map(String))];
  if (sizes.length) lines.push(`Group sizes: ${sizes.join(" / ")} athletes per group`);
  else if (gi.capacity) lines.push(`Group sizes: up to ${gi.capacity} per session`);

  if (gi.coach_ratio) lines.push(`Coaches: ${gi.coach_ratio}`);

  return lines.length >= 3 ? lines.join("\n") : null;
}

// ── loader: which rendered facts does this academy get? ──────────────────────
// Reads the academy's Training offer (60s cache - "edit the offer, the agent
// knows it" stays effectively immediate without a DB read per prompt build).
// Returns a partial overrides map; empty object on any failure - rendering must
// never break an agent.
const TTL_MS = 60 * 1000;
const offerCache = new Map(); // clientId -> { data, at }

export async function derivedFactOverrides(clientId, sbFn) {
  try {
    if (!clientId || typeof sbFn !== "function") return {};
    let hit = offerCache.get(clientId);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      const rows = await sbFn(`offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
      hit = { data: (Array.isArray(rows) && rows[0] && rows[0].data) || null, at: Date.now() };
      offerCache.set(clientId, hit);
    }
    if (!hit.data) return {};
    const out = {};
    const program = renderProgram(hit.data);
    if (program) out.program = program;
    return out;
  } catch (_) {
    return {};
  }
}
