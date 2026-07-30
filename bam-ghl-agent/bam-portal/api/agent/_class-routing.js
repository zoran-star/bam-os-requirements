// Which class does an athlete of a given age belong in?
//
// PURE. No network, no database, no Supabase, no other portal imports. Every
// input is passed in. That is deliberate: three separate booking paths (the
// sales agent, the free-trial website page, DETAIL Miami's endpoint) have to
// give the SAME answer, and the only way to guarantee that is one function
// they all call, cheap enough that none of them has an excuse to reimplement it.
//
// NOTHING CALLS THIS YET. It is build A: make the data available and settle the
// rules. Build B wires it into the three call sites and deletes the calendar-name
// matching (groupOf() in api/agent/booking.js) that it replaces. Until then this
// file changes no behaviour for any academy.
//
// ── The rules Zoran approved, 30 July 2026 ──────────────────────────────────
//   Exactly one class fits  -> book it, ask nothing.
//   No class fits           -> the athlete is not qualified. Say so; never book
//                              them into "the closest one".
//   More than one fits      -> ask ONE question, then book.
//   The age cannot be read  -> ask the parent. This is NOT the same answer as
//                              "no class fits", and confusing the two is the
//                              whole reason this module exists: one of them
//                              turns a customer away.
//
// ── Two ends, both inclusive, and the top may be absent ─────────────────────
// `8 to 11` fits an 8, a 9, a 10 and an 11 year old. A missing age_max means NO
// UPPER LIMIT, and that is load-bearing rather than a convenience: BAM GTA's
// live second group is "ages 14 and up" (api/agent/prompt-structure.js, the
// booking-instructions body). If a missing max ever came to mean "matches
// nobody", GTA's older group would go dark for every athlete. A missing age_min
// likewise means no lower limit.
//
// A class with NEITHER bound set is UNCONFIGURED, and unconfigured matches
// everyone. Existing academies have not filled these in yet, so the alternative
// - unconfigured matches nobody - would take every academy offline the day the
// field shipped. Each match carries `configured` so a caller can tell a real
// age decision from a class that simply has not been set up.

// ── the per-class key ───────────────────────────────────────────────────────
// A class in offer.data.schedule.classes[] carries NO id. The wizard's
// block_builder appends a bare {} (see _bbBlockAdd in public/client-portal.html)
// and rows are addressed by array index, so there is nothing stable to use but
// the title. That matches the house precedent: offer_prices.source_offer_price_key
// is `${title}|${term}`, minted the same way from a block_builder row's title.
//
// CONSEQUENCE, and it is a real one: RENAMING A CLASS MINTS A NEW KEY. Slots
// already generated keep the old key and no longer point at any class in the
// offer. Nothing repairs that today, because api/schedule/sync-offer.js dedupes
// templates on `recurrence|start|end` and SKIPS any template that already exists,
// so a re-sync never revisits the key. A heal pass is needed and does not exist.

const KEY_MAX = 60;

/** Slug a class title into a key: lowercase, non-alphanumerics to "-". */
function slug(text) {
  return String(text == null ? "" : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KEY_MAX)
    .replace(/-+$/g, "");
}

/**
 * Deterministic key for one class, reproducible from the offer alone (the same
 * function runs on every re-sync, so it must never depend on time or randomness).
 *
 * @param {object} cls      the class row
 * @param {number} index    its index in the classes array
 * @param {Array}  classes  the whole array, for collision numbering
 * @returns {string}
 */
export function classKey(cls, index, classes) {
  const titleOf = (c, i) => (c && (c.title || c.name)) || `Class ${i + 1}`;
  const base = slug(titleOf(cls, index)) || `class-${index + 1}`;
  // Two classes titled the same slug to the same key. The FIRST keeps the bare
  // key so existing rows do not move; later ones get -2, -3, by position.
  const all = Array.isArray(classes) ? classes : [];
  let seen = 0;
  for (let i = 0; i < all.length && i < index; i += 1) {
    if ((slug(titleOf(all[i], i)) || `class-${i + 1}`) === base) seen += 1;
  }
  return seen === 0 ? base : `${base}-${seen + 1}`;
}

// ── reading the age range off a class ───────────────────────────────────────

function intOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(/-?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

// The owner picks whether there IS an oldest age before typing one, so that a
// blank box is never silently read as "and up". "Beginner, 8 to blank" would
// otherwise accept a 40 year old and nothing would look wrong.
const NO_UPPER_LIMIT = "no upper limit";

/**
 * Normalize a class's age bounds.
 *
 * Reads three fields off the class, all optional:
 *   age_min       youngest, inclusive. Blank = no lower limit.
 *   age_max_mode  "No upper limit" or "Set an oldest age" (the wizard's toggle).
 *   age_max       oldest, inclusive. Only meaningful when the mode says there is one.
 *
 * @returns {{min:number|null, max:number|null, configured:boolean, invalid:boolean, incomplete:boolean}}
 *   min/max null = that end is open. configured = the owner has set this class up.
 *   invalid = min above max, which fits nobody. incomplete = the owner said there
 *   IS an oldest age and then did not type one.
 */
export function classAgeRange(cls) {
  const c = cls || {};
  const min = intOrNull(c.age_min);
  const mode = String(c.age_max_mode == null ? "" : c.age_max_mode).trim().toLowerCase();
  const openTop = mode === NO_UPPER_LIMIT;
  // An explicit "no upper limit" wins over any number left behind in the box
  // when the owner switched the toggle.
  const max = openTop ? null : intOrNull(c.age_max);
  return {
    min,
    max,
    configured: min !== null || max !== null || openTop,
    invalid: min !== null && max !== null && min > max,
    incomplete: !openTop && mode !== "" && max === null,
  };
}

/** Inclusive at both ends. A null bound is no bound. An invalid range fits nobody. */
export function classFitsAge(cls, age) {
  if (!Number.isFinite(age)) return false;
  const r = classAgeRange(cls);
  if (r.invalid) return false;
  if (r.min !== null && age < r.min) return false;
  if (r.max !== null && age > r.max) return false;
  return true;
}

// ── reading the age the parent typed ────────────────────────────────────────
// `athlete_age` is a plain text box on the form and on the agent's side, so
// "9", "nine", "9 turning 10" and "" all really arrive.

const AGE_CEILING = 120;

/**
 * @returns {{ok:true, age:number, text:string} | {ok:false, reason:string, text:string}}
 *   reason: "empty" | "no_number" | "ambiguous_grade" | "ambiguous_band" | "out_of_range"
 */
export function parseAthleteAge(raw) {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "no_number", text };
    const n = Math.trunc(raw);
    if (n < 0 || n > AGE_CEILING) return { ok: false, reason: "out_of_range", text };
    return { ok: true, age: n, text };
  }

  if (!text) return { ok: false, reason: "empty", text };

  // "Grade 5" is not an age, and a grade means different ages in Ontario than in
  // California, so it cannot be converted safely. Ask instead of guessing.
  if (/\bgrades?\b/i.test(text)) return { ok: false, reason: "ambiguous_grade", text };
  // "U10" is a BAND (under 10), not this athlete's age. Same treatment.
  if (/\bu\s?-?\s?\d+\b/i.test(text)) return { ok: false, reason: "ambiguous_band", text };

  // First integer wins: "9 turning 10" is a 9 year old today. The sign is part
  // of the match on purpose - without it "-4" reads as a 4 year old.
  const m = text.match(/-?\d+/);
  if (!m) return { ok: false, reason: "no_number", text };  // "nine", "dunno", "-"
  const n = parseInt(m[0], 10);
  if (!Number.isFinite(n) || n < 0 || n > AGE_CEILING) return { ok: false, reason: "out_of_range", text };
  return { ok: true, age: n, text };
}

// ── the answer ─────────────────────────────────────────────────────────────

/**
 * Which of this academy's classes fit this athlete?
 *
 * @param {*} rawAge   whatever the form or the agent captured
 * @param {Array} classes  offer.data.schedule.classes[]
 * @returns {{
 *   status: "single"|"multiple"|"unqualified"|"unknown_age"|"no_classes",
 *   age: number|null,
 *   ageText: string,
 *   reason: string|null,
 *   matches: Array<{index:number,key:string,title:string,min:number|null,max:number|null,configured:boolean}>,
 *   askOneQuestion: boolean,
 *   problems: string[]
 * }}
 *
 * status is the whole answer, and the five values are deliberately not
 * collapsible into a boolean:
 *   single      book it
 *   multiple    ask ONE question, then book (askOneQuestion is true)
 *   unqualified the age was read fine and no class covers it - turn them away
 *   unknown_age the age could NOT be read - ask the parent, never turn them away
 *   no_classes  the academy has no classes configured - an us problem, not theirs
 */
export function resolveClassesForAge(rawAge, classes) {
  const list = Array.isArray(classes) ? classes : [];
  const parsed = parseAthleteAge(rawAge);
  const problems = [];

  list.forEach((cls, i) => {
    const label = (cls && (cls.title || cls.name)) || `Class ${i + 1}`;
    const r = classAgeRange(cls);
    if (r.invalid) {
      problems.push(`"${label}" has age_min ${r.min} above age_max ${r.max}, so no athlete can ever match it.`);
    }
    if (r.incomplete) {
      problems.push(`"${label}" says it has an oldest age but none was entered, so it is being treated as having no upper limit.`);
    }
  });

  if (!list.length) {
    return {
      status: "no_classes",
      age: parsed.ok ? parsed.age : null,
      ageText: parsed.text,
      reason: parsed.ok ? null : parsed.reason,
      matches: [],
      askOneQuestion: false,
      problems,
    };
  }

  if (!parsed.ok) {
    return {
      status: "unknown_age",
      age: null,
      ageText: parsed.text,
      reason: parsed.reason,
      matches: [],
      askOneQuestion: false,
      problems,
    };
  }

  const matches = [];
  list.forEach((cls, i) => {
    if (!classFitsAge(cls, parsed.age)) return;
    const r = classAgeRange(cls);
    matches.push({
      index: i,
      key: classKey(cls, i, list),
      title: (cls && (cls.title || cls.name)) || `Class ${i + 1}`,
      min: r.min,
      max: r.max,
      configured: r.configured,
    });
  });

  const status = matches.length === 0 ? "unqualified" : (matches.length === 1 ? "single" : "multiple");
  return {
    status,
    age: parsed.age,
    ageText: parsed.text,
    reason: null,
    matches,
    askOneQuestion: status === "multiple",
    problems,
  };
}

// ── the hazard an owner should be shown ────────────────────────────────────

/**
 * Ages that fall BETWEEN this academy's classes and therefore fit nothing.
 *
 * Only INTERIOR gaps are reported. Below the youngest class and above the oldest
 * are not gaps, they are the edges of who the academy serves - a 4 year old and
 * a 40 year old are supposed to fit nothing. A 12 year old sitting between an
 * 8-11 class and a 13-18 class is the hazard, because the owner believes that
 * child is covered.
 *
 * @returns {Array<{from:number,to:number}>} inclusive spans, ascending
 */
export function ageCoverageGaps(classes) {
  const ranges = (Array.isArray(classes) ? classes : [])
    .map(classAgeRange)
    .filter((r) => r.configured && !r.invalid);
  if (ranges.length < 2) return [];

  const bounds = [];
  for (const r of ranges) {
    if (r.min !== null) bounds.push(r.min);
    if (r.max !== null) bounds.push(r.max);
  }
  if (!bounds.length) return [];
  const lo = Math.min(...bounds);
  const hi = Math.max(...bounds);

  const covered = (age) => ranges.some((r) =>
    (r.min === null || age >= r.min) && (r.max === null || age <= r.max));

  const gaps = [];
  let open = null;
  for (let age = lo; age <= hi; age += 1) {
    if (covered(age)) {
      if (open !== null) { gaps.push({ from: open, to: age - 1 }); open = null; }
    } else if (open === null) {
      open = age;
    }
  }
  // An unclosed run reaches `hi`, which is a bound of some class, so it is
  // covered - the run cannot still be open here. Guarded anyway rather than
  // relying on that argument staying true.
  if (open !== null) gaps.push({ from: open, to: hi });
  return gaps;
}

// Exposed for tests only.
export const _internals = { slug, intOrNull, AGE_CEILING };
