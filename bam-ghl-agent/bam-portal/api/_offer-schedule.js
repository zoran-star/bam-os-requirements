// Offer schedule -> portal-native slot templates (the "B" transformation).
//
// PURE mapping, no I/O and no auth: it turns a Training offer's captured
// schedule (offer.data.classes[].weekly_times[]) + offer.data.capacity into
// slot_template CREATE payloads shaped for Luka's runtime endpoint
// POST /api/runtime/schedule/templates.
//
// A staff-authed orchestrator (see docs/offer-schedule-to-slots-spec.md) takes
// these payloads, dedupes against existing templates, POSTs the new ones, then
// calls generate-slots. Keeping the mapping pure means it is unit-testable with
// zero infra and the Luka-boundary calls stay in one thin, reviewable place.
//
// Contract (from api/runtime/schedule/templates.ts):
//   required: client_id, name, slot_type, default_start_time, default_end_time
//   optional: default_capacity (int>0, endpoint default 10), default_credit_cost
//             (int>=0, default 1), recurrence_rule ("WEEKLY:MO,WE"), location_id
//             (uuid, must belong to client) OR default_location (free text),
//             bookable_program_id (uuid; endpoint falls back to the client's
//             first ACTIVE program if omitted), is_active, description.

const DAY_TO_TOKEN = {
  su: "SU", sun: "SU", sunday: "SU",
  mo: "MO", mon: "MO", monday: "MO",
  tu: "TU", tue: "TU", tues: "TU", tuesday: "TU",
  we: "WE", wed: "WE", weds: "WE", wednesday: "WE",
  th: "TH", thu: "TH", thur: "TH", thurs: "TH", thursday: "TH",
  fr: "FR", fri: "FR", friday: "FR",
  sa: "SA", sat: "SA", saturday: "SA",
};
const TOKEN_ORDER = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const TOKEN_LABEL = { SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normDay(d) {
  return DAY_TO_TOKEN[String(d == null ? "" : d).trim().toLowerCase()] || null;
}

// Accepts "18:00", "6:00 PM", "6 PM", "6:30pm" -> "HH:MM" (24h). null if unparseable.
function normTime(t) {
  const s = String(t == null ? "" : t).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})$/); // already 24h HH:MM
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  }
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i); // 12h with am/pm
  if (m) {
    let h = +m[1]; const mi = m[2] ? +m[2] : 0; const ap = m[3].toLowerCase();
    if (h < 1 || h > 12 || mi > 59) return null;
    if (ap === "p" && h !== 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  return null;
}

function dayLabel(tokens) {
  return tokens.map((t) => TOKEN_LABEL[t]).join(", ");
}

// offer.data.classes[].weekly_times[].location can be a uuid, a { id }, or free
// text. Return { location_id } or { default_location } accordingly (or {}).
function locationFields(loc) {
  if (!loc) return {};
  if (typeof loc === "object") {
    if (loc.id && UUID_RE.test(String(loc.id))) return { location_id: String(loc.id) };
    const name = loc.name || loc.label || loc.title;
    return name ? { default_location: String(name).slice(0, 120) } : {};
  }
  const s = String(loc).trim();
  if (!s) return {};
  return UUID_RE.test(s) ? { location_id: s } : { default_location: s.slice(0, 120) };
}

/**
 * Map a Training offer to slot_template create payloads + a dedupe key each.
 *
 * @param {object} offer  the offers row: { id, title, data: { capacity, classes[] } }
 * @param {object} opts   { clientId, bookableProgramId?, slotType='GROUP_CLASS',
 *                          creditCost=0, capacityFallback=null }
 *                          creditCost defaults to 0: trials cost 0 credits
 *                          (Zoran 2026-07-07). Pass a non-zero value only for
 *                          credit-based member plans booking the same slots.
 * @returns {{ templates: Array<{payload:object, matchKey:string}>, warnings: string[] }}
 *          matchKey = `${recurrence}|${start}|${end}` - a natural key the
 *          orchestrator uses to skip templates that already exist (re-sync safe).
 */
export function offerToTemplatePayloads(offer, opts = {}) {
  const {
    clientId,
    bookableProgramId = null,
    slotType = "GROUP_CLASS",
    creditCost = 0,
    capacityFallback = null,
  } = opts;

  const data = (offer && offer.data) || {};
  const rawCap = Number(data.capacity);
  const capacity = Number.isFinite(rawCap) && rawCap > 0 ? Math.floor(rawCap)
    : (capacityFallback && capacityFallback > 0 ? Math.floor(capacityFallback) : null);
  const classes = Array.isArray(data.classes) ? data.classes : [];

  const templates = [];
  const warnings = [];
  const seen = new Set();

  if (!clientId) warnings.push("no clientId passed - payloads will fail validation");
  if (capacity == null) warnings.push('offer has no "Max capacity per session" set - templates will fall back to the endpoint default (10); set capacity on the offer.');
  if (!classes.length) warnings.push("offer has no classes in its Schedule section - nothing to generate.");

  classes.forEach((cls, ci) => {
    const title = (cls && (cls.title || cls.name)) || `Class ${ci + 1}`;
    if (String((cls && cls.consistent) || "").toLowerCase() === "no") {
      warnings.push(`"${title}" uses ad-hoc scheduling (not fixed weekly times) - can't auto-generate slots; skipped.`);
      return;
    }
    const rows = Array.isArray(cls && cls.weekly_times) ? cls.weekly_times : [];
    if (!rows.length) {
      warnings.push(`"${title}" has no weekly times - skipped.`);
      return;
    }
    rows.forEach((row, ri) => {
      const tokens = [...new Set((Array.isArray(row && row.days) ? row.days : []).map(normDay).filter(Boolean))]
        .sort((a, b) => TOKEN_ORDER.indexOf(a) - TOKEN_ORDER.indexOf(b));
      const start = normTime(row && row.start);
      const end = normTime(row && row.end);
      if (!tokens.length) { warnings.push(`"${title}" row ${ri + 1}: no valid days - skipped.`); return; }
      if (!start || !end) { warnings.push(`"${title}" row ${ri + 1}: missing/invalid start or end time - skipped.`); return; }
      if (start >= end) { warnings.push(`"${title}" row ${ri + 1}: start is not before end (${start}-${end}) - skipped.`); return; }

      const recurrence = "WEEKLY:" + tokens.join(",");
      const matchKey = `${recurrence}|${start}|${end}`;
      if (seen.has(matchKey)) { warnings.push(`"${title}" row ${ri + 1}: duplicate of another row (${matchKey}) - skipped.`); return; }
      seen.add(matchKey);

      const name = [offer && offer.title, title].filter(Boolean).join(" - ") || "Training";
      const payload = {
        client_id: clientId,
        name: `${name} (${dayLabel(tokens)})`.slice(0, 120),
        slot_type: slotType,
        default_start_time: start,
        default_end_time: end,
        default_credit_cost: creditCost,
        recurrence_rule: recurrence,
        is_active: true,
        ...locationFields(row && row.location),
      };
      if (capacity != null) payload.default_capacity = capacity;
      if (bookableProgramId) payload.bookable_program_id = bookableProgramId;

      templates.push({ payload, matchKey });
    });
  });

  return { templates, warnings };
}

// Exposed for tests.
export const _internals = { normDay, normTime, dayLabel, locationFields };
