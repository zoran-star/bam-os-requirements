// Apply the age resolver to real SLOTS. The wiring layer of build B.
//
// api/agent/_class-routing.js answers ONE question - "which of this academy's
// classes fit an athlete of this age" - and knows nothing about slots, calendars
// or booking. This file is the layer between that answer and the three booking
// paths (the sales agent, the free-trial website page, DETAIL Miami's endpoint).
// It is the only place that decides which SLOTS a parent is offered, so the
// three paths cannot drift apart again.
//
// PURE. Every input is passed in. `loadClassesFor` takes its fetch function as
// an argument for the same reason, so the whole file runs under plain node with
// no network and no database.
//
// ── The defect this exists to close ─────────────────────────────────────────
// The three paths shared one broken shape: derive "Group N" from a label, filter
// slot NAMES by that substring, fall back to an arbitrary row. It worked for BAM
// GTA and nobody else, because GTA's slots were hand-named "Group 1 (Elementary)"
// and that is the exact text the matching looked for.
//
// The `|| rows[0]` fallback everyone notices FIRST is not the main defect. All
// three paths resolve the slot with an exact `start_time=eq.<iso>` match, so with
// classes at different start times only one row comes back and it is the right
// one. The real defect is one stage earlier: NOTHING FILTERED THE TIMES A PARENT
// WAS OFFERED BY THE ATHLETE'S AGE. A 9 year old was shown 6pm, picked it, and
// was booked into the 6pm class correctly and precisely. Every layer behaved as
// written and the child was in the wrong class. So `routeSlots` - the OFFER side
// - is the load-bearing export here, and `chooseSlotToBook` is the smaller half.
//
// ── Two outcomes, both correct ──────────────────────────────────────────────
// ONE class fits and MORE THAN ONE class fits are both ordinary, successful
// results, and nothing in this file's naming, logging or control flow treats the
// second as a failure or a fallback. That is not stylistic. BAM San Jose's
// Beginner Academy is ages 6-12 and its Elementary Academy is 9-12: they overlap
// almost completely because they differ by SKILL, not by age. Every 9 to 12 year
// old in San Jose returns two classes, every single time. `multiple` is that
// academy's normal path, so it carries a `question` as rich as `single` carries
// its slot, and the question is built from what actually differs between the
// matched classes rather than assumed to be about age.
//
// ── What a NULL source_offer_class_key means ────────────────────────────────
// It means the slot's class is UNKNOWN, which is not the same as "matches
// nobody" and not the same as "matches everybody".
//
// A slot whose class is unknown is NEVER HIDDEN from a parent, because hiding it
// would take an academy's schedule dark on the strength of a column nobody
// filled in. It is also never counted as a positive age match, so it can never
// be the reason we claim an athlete fits. It is returned separately, in
// `unidentified`, so a caller can log it and so it is never SILENT.
//
// Before we give up on an unkeyed slot we try to identify it from its NAME
// against the academy's OWN class titles - not against any hardcoded vocabulary.
// A slot named "Training - Beginner Academy (Tue)" contains exactly one class
// title and is therefore that class. If the name matches no class title, or more
// than one, the slot stays unidentified rather than being guessed at.
//
// This bridge is why the build is correct whether or not the GTA backfill has
// run, and it is not a legacy convenience: every academy after GTA arrives with
// slots generated from scratch, and a build that only works after a human
// remembers to run some SQL has a human in its critical path and does not know it.

import { classKey, classAgeRange, resolveClassesForAge } from "./_class-routing.js";

const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();

/** offer.data -> the classes array, wherever the wizard put it. */
export function classesOf(offerData) {
  const data = (offerData && typeof offerData === "object") ? offerData : {};
  const sched = data.schedule || {};
  if (Array.isArray(sched.classes)) return sched.classes;
  if (Array.isArray(data.classes)) return data.classes;
  return [];
}

/**
 * The academy's classes, each with the key that identifies it on a slot.
 * @returns {Array<{key:string,title:string,cls:object,index:number}>}
 */
export function classIndex(classes) {
  const list = Array.isArray(classes) ? classes : [];
  return list.map((cls, index) => ({
    index,
    cls: cls || {},
    key: classKey(cls, index, list),
    title: (cls && (cls.title || cls.name)) || `Class ${index + 1}`,
  }));
}

/**
 * The academy's training-offer classes. The ONLY function here that does I/O,
 * and it takes the fetch function so it is still callable from a test with a
 * stub. Returns [] on any failure: a lookup hiccup must never look like "this
 * academy has no classes", which would arm nothing and change nothing.
 */
export async function loadClassesFor(sbFn, clientId) {
  try {
    if (!clientId || typeof sbFn !== "function") return [];
    const rows = await sbFn(
      `offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=data&order=sort_order.asc&limit=1`
    );
    return classesOf(Array.isArray(rows) && rows[0] ? rows[0].data : null);
  } catch (_) { return []; }
}

// ── the arming gate ─────────────────────────────────────────────────────────

/**
 * May this academy be routed by age at all?
 *
 * WHY THIS GATE EXISTS, and it is the difference between shipping and breaking
 * every academy that has not filled the fields in. An UNCONFIGURED class - one
 * with no age numbers at all - matches EVERY age by design (`configured:false`
 * in the resolver), because the alternative, unconfigured matches nobody, would
 * have taken every academy offline the day the field shipped. That default is
 * right for the resolver and wrong for routing: switch an academy to age routing
 * with one class unconfigured and every athlete matches that class on top of
 * whatever else they match, so every athlete returns `multiple` and the agent
 * asks a question where it used to route silently.
 *
 * So an academy is armed only when EVERY class it has can actually decide. Any
 * class that cannot - unconfigured, or a range that fits nobody, or an owner who
 * said there is an oldest age and did not type one - disarms the whole academy,
 * and the caller falls back to exactly what it did before age routing existed.
 *
 * Not armed is a normal state, not an error. It is what an academy looks like on
 * the day before its owner fills the fields in.
 *
 * @returns {{armed:boolean, reason:string|null, unconfigured:string[], problems:string[]}}
 */
export function ageRoutingReadiness(classes) {
  const idx = classIndex(classes);
  if (!idx.length) {
    return { armed: false, reason: "this academy has no classes on its training offer", unconfigured: [], problems: [] };
  }
  const unconfigured = [];
  const problems = [];
  for (const c of idx) {
    const r = classAgeRange(c.cls);
    if (!r.configured) { unconfigured.push(c.title); continue; }
    if (r.invalid) problems.push(`"${c.title}" has an age range that fits nobody (${r.min} to ${r.max}).`);
    if (r.incomplete) problems.push(`"${c.title}" says it has an oldest age but none was entered.`);
  }
  if (unconfigured.length) {
    return {
      armed: false,
      reason: `these classes have no ages set: ${unconfigured.join(", ")}`,
      unconfigured, problems,
    };
  }
  if (problems.length) {
    return { armed: false, reason: problems.join(" "), unconfigured, problems };
  }
  return { armed: true, reason: null, unconfigured: [], problems: [] };
}

// ── identifying a slot's class ──────────────────────────────────────────────

/** The class key stamped on a slot or template row, or null. */
export function slotClassKey(slot) {
  const k = slot && (slot.source_offer_class_key ?? slot.sourceOfferClassKey);
  const s = String(k == null ? "" : k).trim();
  return s || null;
}

/**
 * Which class is this slot? Key first, then the slot's own NAME against the
 * academy's own class titles, then unidentified.
 *
 * @returns {{key:string|null, via:"key"|"name"|null}}
 */
export function identifySlotClass(slot, idx) {
  const index = Array.isArray(idx) ? idx : [];
  const stamped = slotClassKey(slot);
  if (stamped) {
    const hit = index.find((c) => c.key === stamped);
    // A stamped key that matches no class is still an ANSWER - it says this slot
    // belongs to a class the offer no longer has (an owner renamed one; see
    // _class-routing.js's header). It is not this academy's current class, so it
    // is not eligible for anyone, but it is identified, not unknown.
    return { key: stamped, via: "key", known: !!hit };
  }
  const name = norm(slot && slot.name);
  if (!name) return { key: null, via: null, known: false };
  const hits = index.filter((c) => c.title && name.includes(norm(c.title)));
  if (hits.length === 1) return { key: hits[0].key, via: "name", known: true };
  return { key: null, via: null, known: false };
}

/**
 * Which class does a calendar entry point serve, read from the academy's own
 * class titles in the calendar's label. Exactly one title match narrows to that
 * class; none or several means this calendar does not narrow at all.
 *
 * This REPLACES groupOf(). It carries no vocabulary of its own: an academy that
 * calls its classes "Group 1" and "Group 2" gets the same narrowing it always
 * had, because the words come from that academy's offer rather than from here.
 */
export function classForCalendar(label, idx) {
  const index = Array.isArray(idx) ? idx : [];
  const l = norm(label);
  if (!l) return null;
  const hits = index.filter((c) => c.title && l.includes(norm(c.title)));
  return hits.length === 1 ? hits[0].key : null;
}

/** A class by its real name, as the agent emits it. Exact title match, then unique substring. */
export function classByName(name, idx) {
  const index = Array.isArray(idx) ? idx : [];
  const n = norm(name);
  if (!n) return null;
  const exact = index.find((c) => norm(c.title) === n);
  if (exact) return exact;
  const byKey = index.find((c) => c.key === String(name || "").trim());
  if (byKey) return byKey;
  const hits = index.filter((c) => norm(c.title).includes(n) || n.includes(norm(c.title)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * What a PARENT should be told this session is - decision 3, 30 July 2026.
 *
 * `schedule_slots.name` is an internal filing label, built by _offer-schedule.js
 * as `${offer title} - ${class title} (${days})`. DETAIL Miami's 157 live slots
 * are all called "Training - DETAIL Academy (Mon, Wed, Fri)", and that is the
 * string that leaks to customers: it names our offer, repeats days the parent
 * already picked, and buries the one word they care about. The class's own title
 * is what the academy actually calls it, so that is what a parent gets.
 *
 * Falls back to the slot's name when the class cannot be identified, because a
 * parent seeing a clumsy label is better than a parent seeing nothing.
 */
export function parentFacingClassName(slot, classes) {
  const idx = classIndex(classes);
  const id = identifySlotClass(slot, idx);
  const hit = id.key ? idx.find((c) => c.key === id.key) : null;
  return (hit && hit.title) || (slot && slot.name) || null;
}

// ── what tells two matched classes apart ────────────────────────────────────

// The fields a class row actually carries that a parent could answer about.
// `age` is the owner's free-text band and is listed LAST on purpose: when two
// classes overlap on age, the age text is the least likely thing to separate
// them, and asking a parent about it is the specific mistake this exists to
// prevent.
const DISTINGUISHING_FIELDS = [
  { field: "skill_level", label: "Skill level" },
  { field: "gender",      label: "Who it is for" },
  { field: "group_size",  label: "Group size" },
  { field: "age",         label: "Age band" },
];

/**
 * Given the classes that all fit, what actually differs between them?
 *
 * Returned so a caller can ask the RIGHT question. San Jose's two overlapping
 * classes differ on `skill_level`, so its one question is "has your child played
 * organised basketball before?" - not an age question, which cannot separate
 * them and which the parent has already answered.
 *
 * @returns {Array<{field:string,label:string,options:Array<{key,title,value}>}>}
 */
export function distinguishingFields(matchKeys, idx) {
  const index = Array.isArray(idx) ? idx : [];
  const keys = new Set(matchKeys || []);
  const picked = index.filter((c) => keys.has(c.key));
  if (picked.length < 2) return [];
  const out = [];
  for (const { field, label } of DISTINGUISHING_FIELDS) {
    const values = picked.map((c) => {
      const v = c.cls[field];
      const s = Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v == null ? "" : v).trim();
      return { key: c.key, title: c.title, value: s || null };
    });
    // Every class must have an answer, and the answers must not all be the same.
    // A field two classes leave blank tells a parent nothing.
    if (values.some((v) => !v.value)) continue;
    if (new Set(values.map((v) => norm(v.value))).size < 2) continue;
    out.push({ field, label, options: values });
  }
  return out;
}

/** Do every pair of these classes overlap on age? Then age cannot separate them. */
export function agesOverlap(matchKeys, idx) {
  const index = Array.isArray(idx) ? idx : [];
  const keys = new Set(matchKeys || []);
  const ranges = index.filter((c) => keys.has(c.key)).map((c) => classAgeRange(c.cls));
  if (ranges.length < 2) return false;
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const a = ranges[i], b = ranges[j];
      const aMin = a.min === null ? -Infinity : a.min, aMax = a.max === null ? Infinity : a.max;
      const bMin = b.min === null ? -Infinity : b.min, bMax = b.max === null ? Infinity : b.max;
      if (aMax < bMin || bMax < aMin) return false;
    }
  }
  return true;
}

/**
 * The one question to ask when more than one class fits. Never null when there
 * is more than one match: if nothing structured tells them apart, the question
 * is still askable by naming the classes, which is better than picking one.
 */
export function buildQuestion(matches, idx) {
  const keys = (matches || []).map((m) => m.key);
  const fields = distinguishingFields(keys, idx);
  const top = fields[0] || null;
  return {
    dimension: top ? top.field : null,
    label: top ? top.label : null,
    // TRUE means age has already done all the work it can and the question must
    // be about something else. San Jose is permanently in this state.
    ages_overlap: agesOverlap(keys, idx),
    options: (matches || []).map((m) => {
      const opt = top ? top.options.find((o) => o.key === m.key) : null;
      return { key: m.key, title: m.title, value: opt ? opt.value : null };
    }),
    also: fields.slice(1).map((f) => f.field),
  };
}

// ── the answer for the OFFER side ───────────────────────────────────────────

/**
 * Which slots may this athlete be OFFERED?
 *
 * @param {object}  o
 * @param {Array}   o.slots          schedule_slots rows (need id, name, source_offer_class_key)
 * @param {Array}   o.classes        offer.data.schedule.classes[]
 * @param {*}       o.rawAge         whatever the form or the agent captured; may be missing
 * @param {string}  o.calendarLabel  the entry point's label, when the caller has one
 *
 * @returns {{
 *   armed:boolean, notArmedReason:string|null,
 *   decision:"single"|"multiple"|"unqualified"|"unknown_age"|"no_classes"|"not_armed",
 *   age:number|null, ageText:string, ageReason:string|null,
 *   matches:Array, question:object|null,
 *   slots:Array, excluded:Array, unidentified:Array,
 *   problems:string[]
 * }}
 */
export function routeSlots({ slots, classes, rawAge, calendarLabel } = {}) {
  const rows = Array.isArray(slots) ? slots : [];
  const idx = classIndex(classes);
  const readiness = ageRoutingReadiness(classes);
  const calClass = classForCalendar(calendarLabel, idx);

  let decision = "not_armed";
  let resolved = null;
  if (readiness.armed) {
    resolved = resolveClassesForAge(rawAge, classes);
    decision = resolved.status;
  }

  // Which class keys are eligible. Not armed, or an age we could not read, means
  // we narrow by nothing: showing a parent everything is the behaviour that
  // predates this build, and it is the right thing to fall back to.
  let eligible = new Set(idx.map((c) => c.key));
  if (resolved && (resolved.status === "single" || resolved.status === "multiple")) {
    eligible = new Set(resolved.matches.map((m) => m.key));
  } else if (resolved && resolved.status === "unqualified") {
    eligible = new Set();
  }
  if (calClass) eligible = new Set([...eligible].filter((k) => k === calClass));

  const offered = [], excluded = [], unidentified = [];
  for (const s of rows) {
    const id = identifySlotClass(s, idx);
    if (!id.key) { unidentified.push(s); offered.push(s); continue; }
    if (eligible.has(id.key)) offered.push(s);
    else excluded.push(s);
  }

  return {
    armed: readiness.armed,
    notArmedReason: readiness.reason,
    decision,
    age: resolved && resolved.age != null ? resolved.age : null,
    ageText: resolved ? resolved.ageText : "",
    ageReason: resolved ? resolved.reason : null,
    matches: resolved ? resolved.matches : [],
    question: (resolved && resolved.status === "multiple") ? buildQuestion(resolved.matches, idx) : null,
    slots: offered,
    excluded,
    unidentified,
    problems: [...readiness.problems, ...((resolved && resolved.problems) || [])],
  };
}

// ── the answer for the WRITE side ───────────────────────────────────────────

/**
 * Which of the rows at this exact time do we book into?
 *
 * @returns {{slot:object|null, reason:string|null, via:string, route:object}}
 *   slot null + reason set = refuse, and `reason` is a sentence fit to show a
 *   human. Refusing is a real outcome here: at the write step there is nobody
 *   left to ask, so guessing is the failure this whole build exists to remove.
 */
export function chooseSlotToBook({ rows, classes, rawAge, calendarLabel, className } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const idx = classIndex(classes);
  const route = routeSlots({ slots: list, classes, rawAge, calendarLabel });
  const out = (slot, via) => ({ slot, reason: null, via, route });

  if (!list.length) return { slot: null, reason: "no portal slot at that time", via: "none", route };

  // 1. The agent named a class. It is the most specific thing we know, so it
  //    wins over the age filter - the agent already applied the age filter to
  //    get here, and a staff member overriding it is allowed to.
  const named = className ? classByName(className, idx) : null;
  if (named) {
    const hit = list.find((s) => identifySlotClass(s, idx).key === named.key);
    if (hit) return out(hit, "class-name");
  }

  // 2. Rows whose class is identified AND eligible for this athlete.
  const eligible = route.slots.filter((s) => !route.unidentified.includes(s));
  if (eligible.length === 1) return out(eligible[0], "age");
  if (eligible.length > 1) {
    // NOT ARMED means this academy is running exactly as it did before age
    // routing existed, and before age routing existed this took the first row.
    // Keep doing that rather than turning a booking that works today into a
    // refusal on an academy whose owner has not been asked for ages yet.
    if (!route.armed) return out(eligible[0], "not-armed-first-row");
    return {
      slot: null,
      via: "ambiguous",
      reason: "more than one class runs at that time and both fit this athlete - pick the class before booking",
      route,
    };
  }

  // 3. Nothing identified fits. If the age was read and no class covers it, say
  //    so plainly rather than booking them into the nearest thing.
  if (route.decision === "unqualified") {
    return {
      slot: null,
      via: "unqualified",
      reason: "no class at that time is for this athlete's age",
      route,
    };
  }

  // 4. Unidentified rows. Never hidden, never claimed as a match, and bookable
  //    only when there is exactly one of them - which is the state every academy
  //    was in before slots carried a class at all.
  if (route.unidentified.length === 1) return out(route.unidentified[0], "unidentified");
  if (route.unidentified.length > 1) {
    if (!route.armed) return out(route.unidentified[0], "not-armed-first-row");
    return {
      slot: null,
      via: "ambiguous",
      reason: "more than one session runs at that time and none of them says which class it is - pick the class before booking",
      route,
    };
  }

  // Reachable when the athlete DOES fit a class, just not the one running at
  // this time - a staff member picking the wrong row off the deck, or a parent
  // returning to a stale link. Naming the age is what makes it actionable.
  return {
    slot: null,
    via: "none",
    reason: route.age != null
      ? `no class at that time is for a ${route.age} year old`
      : "no class at that time fits this athlete",
    route,
  };
}
