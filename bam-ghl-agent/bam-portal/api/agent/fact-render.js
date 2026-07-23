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

// ── tiny helpers ─────────────────────────────────────────────────────────────
const money = (v) => { const n = Number(String(v).replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? `$${n}` : null; };
const arr = (x) => Array.isArray(x) ? x : (x ? [x] : []);
// "17:00" -> "5:00pm" (leaves anything unparseable untouched)
const t12 = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return String(t || "");
  let h = Number(m[1]); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
  return `${h}:${m[2]}${ap}`;
};

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

// business_info <- the ACADEMY record + its saved locations (with directions
// notes - what the agent quotes to parents asking where to go) + live links.
export function renderBusinessInfo(client, data, locations) {
  if (!client || typeof client !== "object") return null;
  const lines = [client.business_name || "The academy"];
  const locs = arr(locations);
  if (locs.length) {
    for (const l of locs) {
      const bits = [l.title, l.address].filter(Boolean).join(" - ");
      if (bits) lines.push(`Location: ${bits}${l.notes ? ` (${String(l.notes).trim()})` : ""}`);
    }
  } else if (client.address) lines.push(`Location: ${client.address}`);
  const domain = client.website_setup && client.website_setup.domain;
  if (domain) lines.push(`Free trial booking link: https://${domain}/free-trial`);
  const link = (data && data.sales && data.sales.signup_url) || "";
  if (link) lines.push(`Sign-up link: ${link}`);
  return lines.length > 1 ? lines.join("\n") : null;
}

// schedule <- offer.data.schedule.classes, with location ids resolved to names
// and times in 12h ("Tue 5:00pm-6:00pm at Santa Clara Basketball Court").
export function renderSchedule(data, locations) {
  const classes = arr(data && data.schedule && data.schedule.classes);
  const locById = new Map(arr(locations).filter((l) => l && l.id).map((l) => [l.id, l.title]));
  const lines = [];
  for (const c of classes) {
    const times = arr(c.weekly_times).map((wt) => {
      const span = `${arr(wt.days).join("/")} ${t12(wt.start)}-${t12(wt.end)}`.trim();
      const at = locById.get(wt.location);
      return span ? `${span}${at ? ` at ${at}` : ""}` : "";
    }).filter(Boolean).join("; ");
    const name = c.title || c.age || "Class";
    const meta = [c.age, c.skill_level && String(c.skill_level).toLowerCase() !== "all" ? c.skill_level : null]
      .filter(Boolean).join(", ");
    if (times) lines.push(`${name}${meta ? ` (${meta})` : ""}: ${times}`);
  }
  const yr = data && data.schedule && data.schedule.year_round;
  if (yr) lines.push(String(yr).toLowerCase().includes("season") ? "Runs seasonally." : "Runs year-round.");
  return lines.length ? lines.join("\n") : null;
}

// pricing <- offer.data.pricing.pricing_offerings. Transparency mode stays
// RANGE for every academy for now (per Zoran it is really PRESET-level - moving
// it onto the shared preset is a later structural change).
export function renderPricing(data) {
  const offerings = arr(data && data.pricing && data.pricing.pricing_offerings).filter((o) => o && o.archived !== true);
  if (!offerings.length) return null;
  const monthlies = offerings.map((o) => Number(String(o.price || "").replace(/[^0-9.]/g, ""))).filter((n) => isFinite(n) && n > 0);
  const lo = monthlies.length ? Math.min(...monthlies) : null;
  const hi = monthlies.length ? Math.max(...monthlies) : null;
  const range = (lo && hi) ? (lo === hi ? `$${lo} per month` : `$${lo} to $${hi} per month`) : null;
  const out = ["Transparency mode: RANGE", ""];
  if (range) out.push(`When the lead asks about pricing, share the range (${range}) and say full details are covered at the trial.`, "");
  out.push("Full pricing (internal reference only, do not share unless transparency mode changes to EXACT):");
  for (const o of offerings) {
    const m = money(o.price);
    const commits = arr(o.commitments).map((c) => `${c.length} ${money(c.price) || ""}`.trim()).filter(Boolean).join(" | ");
    out.push(`- ${o.title || "Plan"}${o.billing_cycle ? ` (${o.billing_cycle})` : ""}: ${m ? m + "/mo" : ""}${commits ? " | " + commits : ""}`.replace(/:\s*\|/, ":"));
    if (o.whats_included) out.push(`  Includes: ${String(o.whats_included).trim()}`);
  }
  return out.join("\n");
}

// policies <- offer.data.policy (cancel / pause / refunds / makeup / parents
// watching / under-18 / holidays).
export function renderPolicies(data) {
  const p = (data && data.policy) || {};
  if (!Object.keys(p).length) return null;
  const lines = [];
  const amt = Number(p.cancel_notice_amount);
  if (p.cancellation === "Notice required" && amt > 0) {
    const unit = p.cancel_notice_unit === "hours" ? "hours" : "days";
    lines.push(`Cancellation: ${amt} ${amt === 1 ? unit.replace(/s$/, "") : unit} written notice required.`);
  } else lines.push("Cancellation: members can cancel anytime.");
  if (p.pause_allowed === "Yes") {
    const mn = Number(p.pause_min_days), mx = Number(p.pause_max_days), per = Number(p.pause_per_year);
    const len = (mn > 0 && mx > 0 && mn < mx) ? `${mn} to ${mx} days at a time` : (mx > 0 ? `up to ${mx} days at a time` : "flexible length");
    const freq = per === 1 ? ", once per year" : per === 2 ? ", twice per year" : per > 0 ? `, ${per} times per year` : "";
    lines.push(`Pause: memberships can be paused (${len}${freq}).`);
  } else if (p.pause_allowed === "No") lines.push("Pause: memberships cannot be paused.");
  const rw = Number(p.refund_window_days);
  lines.push((p.refund_policy === "Refundable within a window" && rw > 0)
    ? `Refunds: refundable within ${rw} days of purchase, otherwise non-refundable.`
    : "Refunds: fees already charged are non-refundable except where required by law.");
  if (p.makeup_policy && String(p.makeup_policy).trim()) lines.push(`Makeup/reschedule: ${String(p.makeup_policy).trim()}`);
  if (p.parent_watching) lines.push(`Parents watching: ${p.parent_watching}.`);
  if (p.under_18) lines.push(`Under-18s: ${p.under_18}.`);
  if (p.holiday_schedule) lines.push(`Holidays: ${p.holiday_schedule}.`);
  return lines.join("\n");
}

// qualification_config <- the preset's 3 locked criteria (the FRAMEWORK, tier 1)
// filled with this academy's VALUES: its locations, its age range, its skill
// levels. Kills the hardcoded "near Oakville/GTA" default leaking to other
// academies - the exact bug that would have had San Jose's agent qualifying
// Bay Area parents by Ontario geography.
export function renderQualification(data, client, locations) {
  const gi = (data && data.general_info) || {};
  const locNames = arr(locations).map((l) => l && l.title).filter(Boolean);
  const where = locNames.length ? locNames.join(" / ") : ((client && client.address) || null);
  if (!where && !gi.age_range) return null;
  const skill = gi.skill_level ? String(gi.skill_level) : null;
  return [
    "Qualify leads on these dimensions:",
    `- Location proximity: Are they close enough to realistically attend sessions at ${where || "the academy"}?`,
    `- Athlete age: Athlete must be within the program's age range${gi.age_range ? ` (${gi.age_range})` : " (see program)"}`,
    `- Program fit: ${skill && skill.toLowerCase() === "all" ? "All skill levels accepted" : (skill ? `${skill} program` : "See the program")} - place them in the right group for their level`,
    "",
    "Interest level is NOT a qualification. Leads who aren't interested are never marked unqualified - they get moved to Nurture. Unqualified means they cannot be a customer (too far, wrong age, not a fit) and it removes them from the pipeline entirely.",
  ].join("\n");
}

// selling_points <- offer.data.value (the canonical home - Build 3 resolved,
// Zoran 2026-07-23: GTA's curated bullets were moved INTO its offer value, so
// every academy's differentiators now live where the owner edits them).
export function renderSellingPoints(data) {
  const v = (data && data.value) || {};
  const parts = [];
  if (v.what_makes_different) parts.push(String(v.what_makes_different).trim());
  if (v.program_structure) parts.push(`Program structure: ${String(v.program_structure).trim()}`);
  return parts.length ? parts.join("\n\n") : null;
}

// ── loader: which rendered facts does this academy get? ──────────────────────
// Reads the academy's Training offer + client record + saved locations (60s
// cache - "edit the offer, the agent knows it" stays effectively immediate
// without three DB reads per prompt build). Returns a partial overrides map;
// empty object on any failure - rendering must never break an agent.
const TTL_MS = 60 * 1000;
const factCache = new Map(); // clientId -> { src: {data, client, locations}, at }

export async function derivedFactOverrides(clientId, sbFn) {
  try {
    if (!clientId || typeof sbFn !== "function") return {};
    let hit = factCache.get(clientId);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      const enc = encodeURIComponent(clientId);
      const [offerRows, clientRows, locationRows] = await Promise.all([
        sbFn(`offers?client_id=eq.${enc}&type=eq.training&select=data&order=sort_order.asc&limit=1`).catch(() => []),
        sbFn(`clients?id=eq.${enc}&select=business_name,address,website_setup&limit=1`).catch(() => []),
        sbFn(`locations?client_id=eq.${enc}&select=id,title,address,notes&order=sort_order.asc&limit=10`).catch(() => []),
      ]);
      hit = {
        src: {
          data:      (Array.isArray(offerRows) && offerRows[0] && offerRows[0].data) || null,
          client:    (Array.isArray(clientRows) && clientRows[0]) || null,
          locations: Array.isArray(locationRows) ? locationRows : [],
        },
        at: Date.now(),
      };
      factCache.set(clientId, hit);
    }
    const { data, client, locations } = hit.src;
    if (!data) return {};
    const out = {};
    const set = (key, body) => { if (body) out[key] = body; };
    set("program",        renderProgram(data));
    set("schedule",       renderSchedule(data, locations));
    set("pricing",        renderPricing(data));
    set("policies",       renderPolicies(data));
    set("business_info",  renderBusinessInfo(client, data, locations));
    set("selling_points", renderSellingPoints(data));
    set("qualification_config", renderQualification(data, client, locations));
    return out;
  } catch (_) {
    return {};
  }
}
