// ── Pipeline Preset Registry (Phase 2 → station model 2026-07-14) ─────────────
// Presets are authored HERE, in code (Zoran, 2026-07-10): BAM-only, versioned in
// git, no template tables and no authoring UI.
//
// THE STATION MODEL (agreed 2026-07-14): a preset is an assembly line of STAGES,
// and each stage is a self-contained station declaring three things:
//
//   entry   how contacts ARRIVE here - the pipeline entry trigger (new_lead) if
//           this is the front door, plus the SOURCES that create arrivals
//           (website forms, calendars). A form source can name the intro
//           automation that fires when someone comes in through it.
//   engine  WHO works the station - an agent template, an automation, or a human.
//   exits   where contacts GO next - triggers to other stages or to a terminal
//           (member / unqualified / human). An exit can carry an automation
//           action that fires when it's taken (e.g. missed_trial on no_show).
//
// Because every stage carries its own entries/engine/exits, stages are PORTABLE:
// preset #2 lifts Confirm + Closing unchanged and adds one new call station in
// front. Forms and calendars stop being separately-configured artifacts - they
// are just sources on a stage's entry, so the seeders (entry points, automations)
// read THIS file instead of hardcoding their own lists.
//
// Storage is unchanged: buildPresetRows() compiles the tree into the exact
// pipeline_stages + stage_transitions rows the board, router, and agents already
// read. free_trial compiles to today's 5 stages + 23 edges (20 original +
// cancel_booking / done_trial ghosted_ran_out / nurture ghosted_ran_out, added
// 2026-07-21).
//
// Two things share this file:
//   • AGENT_TEMPLATES - reusable agent definitions. A template = an underlying
//     runtime (booking | confirm | closing behaviour, defined in
//     prompt-structure.js) + a mission + the lesson bucket it trains into. The
//     SAME template can appear in many presets: craft taught to `trial_confirm`
//     helps every preset that reuses it (Phase 4 scopes lessons by template).
//   • PRESETS - the playbooks. `free_trial` is today's exact live model.
//     `discovery_trial` is preset #2 (Zoran's outline): a discovery call before
//     the trial, reusing trial_confirm + closing untouched.
//
// Adding a preset = editing this file + (if it introduces a new agent mission)
// authoring that template's prompt sections. No migration, no DB template rows.
//
// Design: bam-ghl-agent/docs/agent-preset-architecture.html ·
//         docs/core-handoff/pipeline-presets.md

import { sbRest } from "./_store.js";
import { seedAutomations } from "./seed-automations.js";
import { attachReignition } from "./reignition-station.js";

// ── Agent templates ──────────────────────────────────────────────────────────
// runtime  = which existing agent behaviour drives it (prompt-structure.js AGENT_SPECS).
// mission  = the one-line job, what makes this template distinct from its runtime siblings.
// lessonKey= the agent_lessons.agent bucket it trains into. free_trial's templates
//            keep today's keys ('booking'/'confirm'/'closing') so existing lessons
//            keep applying; new templates get their own bucket so a call-booking
//            correction never bleeds into trial-booking (Phase 4 enforces this).
// disclosure= how openly this agent may discuss price: "range" | "exact" |
//            "withhold" (the bodies live in prompt-structure.js
//            PRICING_DISCLOSURE). It sits on the TEMPLATE, not the preset, so a
//            template reused in another sales system carries its policy along -
//            Zoran's call, 2026-07-24. It is BAM master (tier 1): ONE value that
//            propagates to every academy running that template, never a
//            per-academy field and never an offer-wizard question. Changing it
//            means editing this file, and the change is live for every academy on
//            the next prompt build. See docs/agent-pricing-transparency-plan.md.
// breakdown = whether this agent states a price as its PARTS or as one number:
//            "itemized" | "total_only" (Zoran 2026-07-26). It sits beside
//            disclosure, on the TEMPLATE, for the same reason and with the same
//            propagation. The two are independent axes and must not be
//            conflated: DISCLOSURE governs how much the agent volunteers,
//            BREAKDOWN governs the SHAPE of whatever it does say. A range-mode
//            agent still holds the core price, the tax, and the total for every
//            plan - it needs all three to answer "is that before or after tax"
//            correctly - it simply leads with the all-in band. Range governs what
//            it volunteers, never what it knows.
export const DISCLOSURE_MODES = ["range", "exact", "withhold"];
export const DEFAULT_DISCLOSURE = "range";
export const BREAKDOWN_MODES = ["itemized", "total_only"];
export const DEFAULT_BREAKDOWN = "itemized";

export const AGENT_TEMPLATES = {
  trial_booking: { runtime: "booking", lessonKey: "booking", disclosure: "range", breakdown: "itemized", mission: "Book the lead into a free trial session." },
  trial_confirm: { runtime: "confirm", lessonKey: "confirm", disclosure: "range", breakdown: "itemized", mission: "Confirm a booked trial and make sure they show up." },
  // closing runs AFTER the trial: "details at the trial" is incoherent there, and
  // its flow points the parent at the specific plan that fits + the sign-up link.
  // exact is the correct disclosure for that job (Zoran 2026-07-24).
  closing:       { runtime: "closing", lessonKey: "closing", disclosure: "exact", breakdown: "itemized", mission: "Convert a good-fit trial attendee into an enrolled member." },
  // Preset #2 additions - new missions, existing runtimes. Prompt sections to be
  // authored when discovery_trial ships (Phase 2 only DECLARES them).
  call_booking:  { runtime: "booking", lessonKey: "call_booking", disclosure: "range", breakdown: "itemized", mission: "Book the lead into a discovery call (not a trial yet)." },
  call_confirm:  { runtime: "confirm", lessonKey: "call_confirm", disclosure: "range", breakdown: "itemized", mission: "Confirm a booked discovery call and make sure they attend it." },
  // Member Care is NOT a pipeline-station agent: it iterates the MEMBERS roster
  // (api/agent-member-care.js), so it never appears as a stage engine. Declared
  // here so its lesson bucket + mission live in the same registry as its siblings.
  // disclosure "exact" because it talks to people who ALREADY pay a known amount
  // about their own billing - quoting them a range would be nonsense. Inert today:
  // member_care is not in AGENT_SPECS, so it gets no pricing_disclosure section.
  member_care:   { runtime: "member_care", lessonKey: "member_care", disclosure: "exact", breakdown: "itemized", mission: "Watch member conversations; propose billing actions, replies, and staff to-dos for approval." },
};

// ── Build 3: which named TEMPLATE is this preset's <runtime> agent? ───────────
// The prompt builders only know the RUNTIME ("booking" / "confirm" / "closing")
// because that is what selects a behaviour in prompt-structure.js. Nothing knew
// WHICH named template was on shift, so nothing could look up a per-template
// value. This closes that gap: walk the preset's stages for the agent engine
// whose template runs on this runtime.
//
// Ambiguity is a real possibility by design (discovery_trial runs BOTH
// call_booking and trial_booking, two "booking" templates in one preset), so the
// stage walk returns the FIRST in board position order, which is the stage a lead
// actually reaches first. Callers that need a specific stage's template should
// pass the template through rather than re-derive it from the runtime.
//
// Falls back to a unique registry match when the preset has no such stage. That
// is what resolves member_care, which is never a stage engine.
export function templateForRuntime(presetKey, runtime) {
  if (!runtime) return null;
  const p = PRESETS[presetKey];
  if (p) {
    const stages = [...(p.stages || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
    for (const s of stages) {
      const t = s && s.engine && s.engine.kind === "agent" && s.engine.template;
      if (t && AGENT_TEMPLATES[t] && AGENT_TEMPLATES[t].runtime === runtime) return t;
    }
  }
  const matches = Object.keys(AGENT_TEMPLATES).filter((k) => AGENT_TEMPLATES[k].runtime === runtime);
  return matches.length === 1 ? matches[0] : null;
}

// The disclosure mode for a resolved template, always a valid mode.
export function disclosureForTemplate(template) {
  const m = template && AGENT_TEMPLATES[template] && AGENT_TEMPLATES[template].disclosure;
  return DISCLOSURE_MODES.includes(m) ? m : DEFAULT_DISCLOSURE;
}

// The breakdown mode for a resolved template, always a valid mode. Mirrors
// disclosureForTemplate exactly, which is the point: academy #5 inherits this
// through resolvePresetKey -> templateForRuntime -> breakdownForTemplate with
// zero code and zero rows of its own, and flipping one line above reverts every
// academy on its next prompt build.
export function breakdownForTemplate(template) {
  const m = template && AGENT_TEMPLATES[template] && AGENT_TEMPLATES[template].breakdown;
  return BREAKDOWN_MODES.includes(m) ? m : DEFAULT_BREAKDOWN;
}

// ── Station-model shorthands ─────────────────────────────────────────────────
// Engines (who works a stage).
const agent = (template) => ({ kind: "agent", template });
const automation = (key) => ({ kind: "automation", key });
const HUMAN = { kind: "human" };

// Exits. go = to another stage. out = to a terminal (member | unqualified | human).
// Either can carry { action: automation(key) } - fired when the exit is taken.
const go  = (trigger, toRole, extra) => ({ trigger, toKind: "stage", toRole, ...(extra || {}) });
const out = (trigger, terminal, extra) => ({ trigger, toKind: "terminal", terminal, ...(extra || {}) });

// Entry sources. A form source seeds a funnels + entry_points pair and can name
// the intro automation that first-touches leads who arrive through it. A calendar
// source is NOT seeded here - booking go-live creates it - but declaring it tells
// the UI (and future validation) what bookable artifact the stage expects.
const form = ({ key, label, tags, funnel, intro }) => ({ kind: "website-form", key, label, tags, funnel, intro: intro || null });
const calendar = ({ ref, label }) => ({ kind: "calendar", ref, label });

// ── PRESETS ──────────────────────────────────────────────────────────────────
// Stages are authored in FLOW order (main path first, side stations after) with
// explicit `position` carrying the board order. The compiler emits stage rows in
// position order and edges in authored order, which keeps free_trial's compiled
// output identical to the pre-station-model file.
export const PRESETS = {
  // free_trial = the current live BAM model, reproduced exactly. Stamping it onto
  // an academy's Training offer must yield today's 5 stages + 23 edges verbatim.
  free_trial: {
    key: "free_trial",
    label: "Free Trial",
    version: 1,
    description: "Lead → book a free trial → confirm the trial → close after a good-fit trial.",
    // Qualification dimensions (Zoran, 2026-07-21). IMPORTANT: "interested in
    // basketball" is NOT a qualification - a lead who isn't interested goes to
    // Nurture, they are never marked unqualified. Unqualified is reserved for
    // leads who CANNOT be a customer (too far, wrong age, not a fit) and it
    // removes them from the pipeline entirely.
    qualifications: [
      { key: "location", label: "Close to the academy", detail: "Collected on the free-trial form (e.g. 'Are you close to Oakville?')" },
      { key: "age", label: "Athlete age in program range", detail: "Collected on the free-trial form" },
      { key: "program_fit", label: "Good fit for the program", detail: "Judged at the trial via the post-trial form" },
    ],
    // Post-conversion: fires on the @member terminal (a won lead going live) -
    // not a station, but part of what the preset stamps. The worker enrolls
    // automation_key 'onboarding' when a member activates (api/automations.js).
    postConversion: [automation("onboarding")],
    // Owner/staff SMS events this preset brings with it. Declared HERE, not in a
    // global list in the portal, for the same reason automations and forms are:
    // a preset owns what it brings, and an academy that has not applied it must
    // not be offered a switch for a thing it does not run.
    //
    // notifyOwners(clientId, key, msg) is the sender; clients.notification_prefs
    // holds the per-teammate opt-in under this key. The owner always receives it.
    notifications: [
      { key: "free_trial_booked", label: "Free trial booked",
        hint: "A family books, cancels or moves a free trial" },
    ],
    stages: [
      { role: "responded", label: "Booking", position: 0,
        entry: {
          trigger: "new_lead", // the pipeline's front door (from_stage_role NULL edge)
          sources: [
            form({ key: "free-trial", label: "Website Free Trial", tags: ["website-inquiry", "free trial form filled"],
                   funnel: { key: "free-trial", label: "Free trial landing page", primary: true }, intro: "trial_form" }),
            form({ key: "contact", label: "Website Contact Form", tags: ["website-inquiry", "contact form filled"],
                   funnel: { key: "contact", label: "Contact page", primary: false }, intro: "contact_form" }),
          ],
        },
        engine: agent("trial_booking"),
        exits: [
          go("booked", "scheduled_trial"),
          go("not_interested", "nurture"),
          out("marked_unqualified", "unqualified"),
          go("went_quiet", "ghosted"),
          out("complaint_offtopic", "human"),
        ],
      },
      { role: "scheduled_trial", label: "Confirm", position: 2,
        entry: { sources: [calendar({ ref: "free-trial", label: "Free trial calendar" })] },
        engine: agent("trial_confirm"),
        exits: [
          go("post_trial_good_fit", "done_trial"),
          out("post_trial_not_fit", "unqualified"),
          go("no_show", "responded", { action: automation("missed_trial") }),
          go("cant_make_it", "responded"),
          // Lead cancels their booked trial in the calendar -> back to the
          // booking agent to rebook (2026-07-21 team meeting).
          go("cancel_booking", "responded"),
          go("no_longer_wants", "nurture"),
          out("marked_unqualified", "unqualified"),
          out("complaint_offtopic", "human"),
        ],
      },
      { role: "done_trial", label: "Closing", position: 3,
        entry: {},
        engine: agent("closing"),
        exits: [
          out("enrolls", "member"),
          go("says_no", "nurture"),
          // Ghosts all of the closing agent's post-trial follow-ups -> roll into
          // the Nurture long game (2026-07-21 team meeting).
          go("ghosted_ran_out", "nurture"),
          out("marked_unqualified", "unqualified"),
          out("complaint_offtopic", "human"),
        ],
      },
      { role: "ghosted", label: "Ghosted", position: 1,
        entry: {},
        engine: automation("ghosted"),
        exits: [
          go("replied", "responded"),
          go("ghosted_ran_out", "nurture"),
        ],
      },
      { role: "nurture", label: "Nurture", position: 4,
        entry: {},
        // KEY FIX (2026-07-14): the worker enrolls + advances automation_key
        // 'nurture' (api/automations.js), NOT 'lead_nurture'. The old value was a
        // display-only mismatch here, but now this key DRIVES the seeder - so it
        // must match the engine.
        engine: automation("nurture"),
        exits: [
          go("replied", "responded"),
          // Completes the ENTIRE nurture sequence without ever replying -> exits
          // the pipeline as unqualified (2026-07-21 team meeting).
          out("ghosted_ran_out", "unqualified"),
        ],
      },
    ],
  },

  // discovery_trial = preset #2. A discovery call sits before the trial. Reuses
  // the ghosted + nurture automations and the trial_confirm + closing agents
  // unchanged; the only genuinely new pieces are the call_booking mission and the
  // discovery_call_booked stage worked by call_confirm.
  discovery_trial: {
    key: "discovery_trial",
    label: "Discovery Call → Trial",
    version: 1,
    description: "Lead → book a discovery call → confirm the call → book a trial → confirm the trial → close.",
    postConversion: [automation("onboarding")],
    stages: [
      { role: "responded", label: "Booking", position: 0,
        entry: {
          trigger: "new_lead",
          sources: [
            form({ key: "free-trial", label: "Website Free Trial", tags: ["website-inquiry", "free trial form filled"],
                   funnel: { key: "free-trial", label: "Free trial landing page", primary: true }, intro: "trial_form" }),
            form({ key: "contact", label: "Website Contact Form", tags: ["website-inquiry", "contact form filled"],
                   funnel: { key: "contact", label: "Contact page", primary: false }, intro: "contact_form" }),
          ],
        },
        engine: agent("call_booking"),
        exits: [
          go("booked", "discovery_call_booked"),
          go("not_interested", "nurture"),
          out("marked_unqualified", "unqualified"),
          go("went_quiet", "ghosted"),
          out("complaint_offtopic", "human"),
        ],
      },
      { role: "discovery_call_booked", label: "Call Confirm", position: 2,
        entry: { sources: [calendar({ ref: "discovery-call", label: "Discovery call calendar" })] },
        engine: agent("call_confirm"),
        exits: [
          go("booked", "scheduled_trial"),
          go("no_show", "responded"),
          go("cant_make_it", "responded"),
          go("no_longer_wants", "nurture"),
          out("marked_unqualified", "unqualified"),
          out("complaint_offtopic", "human"),
        ],
      },
      { role: "scheduled_trial", label: "Trial Confirm", position: 3,
        entry: { sources: [calendar({ ref: "free-trial", label: "Free trial calendar" })] },
        engine: agent("trial_confirm"),
        exits: [
          go("post_trial_good_fit", "done_trial"),
          out("post_trial_not_fit", "unqualified"),
          go("no_show", "responded", { action: automation("missed_trial") }),
          go("cant_make_it", "responded"),
          go("no_longer_wants", "nurture"),
          out("marked_unqualified", "unqualified"),
          out("complaint_offtopic", "human"),
        ],
      },
      { role: "done_trial", label: "Closing", position: 4,
        entry: {},
        engine: agent("closing"),
        exits: [
          out("enrolls", "member"),
          go("says_no", "nurture"),
          out("marked_unqualified", "unqualified"),
          out("complaint_offtopic", "human"),
        ],
      },
      { role: "ghosted", label: "Ghosted", position: 1,
        entry: {},
        engine: automation("ghosted"),
        exits: [
          go("replied", "responded"),
          go("ghosted_ran_out", "nurture"),
        ],
      },
      { role: "nurture", label: "Nurture", position: 5,
        entry: {},
        engine: automation("nurture"),
        exits: [
          go("replied", "responded"),
        ],
      },
    ],
  },
};

// ── The REIGNITION station, attached to every sales system ───────────────────
// One shared station (api/agent/reignition-station.js), attached here to every
// preset in the registry - which is what makes it a property of "a sales system"
// rather than of one academy. Exits are declared BY ROLE, so free_trial and
// discovery_trial both resolve them against their own stages with no per-system
// code; a sales system added below gets the station by existing.
//
// WHERE THE GUARANTEE IS ENFORCED, AND WHY IT IS NOT ENFORCED HERE.
// The rule (a reply must land on an agent or a human; silence must land on an
// automation or a terminal) is a DESIGN-TIME rule, so the check that fails a build
// belongs in a test, not in a module that production imports. attachReignition
// still throws - and api/_reignition.test.mjs asserts that every preset in this
// registry attaches cleanly, which is what actually blocks a bad sales system.
// Here the throw is CAUGHT and logged, because this module is imported by the
// automation worker, all four inbound webhooks, the router, the agent brain, the
// board and apply-preset: a throw at import would take the portal down over a
// mis-declared exit. Failing this way degrades exactly one feature (the preset
// simply has no reignition station, so nothing can enter it) instead of all of
// them. Fail closed on reignition, not on the portal.
//
// It attaches the station's EDGES (the router reads the flow graph straight from
// this master, so `reignition + replied -> responded` has to live here) but NOT a
// stamped stage row - buildPresetRows skips `attachOnUse` stations, so applying a
// preset still writes exactly the stage anchors it wrote before. The reignition
// row is stamped on first campaign approval instead, by stampReignitionStage().
//
// To point a future sales system's reignition somewhere else, attach it with an
// override there: attachReignition(PRESETS.slow_burn, { exits: { replied: "..." } }).
for (const key of Object.keys(PRESETS)) {
  try {
    attachReignition(PRESETS[key]);
  } catch (e) {
    // Loud, but survivable. A preset that lands here has NO reignition station, so
    // no campaign can ever put anybody into it - the unsafe pipeline is refused,
    // the portal stays up, and api/_reignition.test.mjs fails on the missing
    // station, which is where this is meant to be caught.
    console.error(`[presets] REIGNITION NOT ATTACHED to '${key}' - no campaign can run on it. ${e.message}`);
  }
}

// ── Derived views over the station tree ──────────────────────────────────────

// Every role a preset uses (for validation / display), in board (position) order.
export function presetRoles(presetKey) {
  const p = PRESETS[presetKey];
  return p ? [...p.stages].sort((a, b) => a.position - b.position).map((s) => s.role) : [];
}

// Flatten the tree back into the flat transition list the compiler writes.
// Entry edges (from_stage_role NULL) first, then each stage's exits in authored
// (flow) order - the same ordering the pre-station-model flat lists carried.
function presetTransitions(p) {
  const list = [];
  for (const s of p.stages) {
    if (s.entry && s.entry.trigger) list.push({ fromRole: null, trigger: s.entry.trigger, toKind: "stage", toRole: s.role });
  }
  for (const s of p.stages) {
    for (const e of s.exits || []) list.push({ fromRole: s.role, trigger: e.trigger, toKind: e.toKind, toRole: e.toRole, terminal: e.terminal });
  }
  return list;
}

// Every automation key the preset relies on: stage engines + form-source intros +
// exit actions. This IS the seed list for seed-preset-automations - a new preset
// brings its own automations by declaring them on its stations.
export function presetAutomationKeys(presetKey) {
  const p = PRESETS[presetKey];
  if (!p) return [];
  const keys = [];
  const add = (k) => { if (k && !keys.includes(k)) keys.push(k); };
  for (const s of p.stages) {
    for (const src of (s.entry && s.entry.sources) || []) add(src.intro);
    if (s.engine && s.engine.kind === "automation") add(s.engine.key);
    for (const e of s.exits || []) if (e.action && e.action.kind === "automation") add(e.action.key);
  }
  for (const x of p.postConversion || []) if (x && x.kind === "automation") add(x.key);
  return keys;
}

// Every entry source the preset declares. seed-entry-points seeds the
// website-form ones (+ their funnels); calendar sources are created by booking
// go-live and are listed for display/validation only.
export function presetEntrySources(presetKey) {
  const p = PRESETS[presetKey];
  if (!p) return [];
  const list = [];
  for (const s of p.stages) {
    for (const src of (s.entry && s.entry.sources) || []) list.push({ ...src, stageRole: s.role });
  }
  return list;
}

// Every owner/staff SMS event the preset brings. The portal's notification pill
// row renders from THIS, so a preset-owned event can never end up as a switch in
// the UI with no preset behind it (or, worse, behind it but not wired - which is
// exactly how calendar_booking sat ON for BAM GTA sending nothing).
export function presetNotifications(presetKey) {
  const p = PRESETS[presetKey];
  return (p && Array.isArray(p.notifications)) ? p.notifications : [];
}

// UI-facing summary of everything the preset stamps - the "Choose the preset"
// step renders its chips from this, so the UI never hardcodes preset contents.
export function presetContents(presetKey) {
  const p = PRESETS[presetKey];
  if (!p) return null;
  const stages = [...p.stages].sort((a, b) => a.position - b.position);
  return {
    key: p.key,
    label: p.label,
    version: p.version || 1,
    description: p.description,
    // Qualification dimensions the preset judges leads on (see the note on
    // PRESETS.free_trial: interest is NOT one of them). For UI rendering later.
    qualifications: p.qualifications || [],
    // engine "campaign" = a station whose engine is supplied per campaign rather
    // than by the preset (reignition). It must NOT read as "human" - that would
    // tell the UI a person works the stage, and would satisfy the reignition
    // attachment check if anything ever pointed a `replied` exit at it.
    stages: stages.map((s) => ({ role: s.role, label: s.label,
      engine: s.engine ? s.engine.kind : (s.attachOnUse ? "campaign" : "human"),
      engine_ref: s.engine ? (s.engine.template || s.engine.key || null) : null })),
    agents: stages.filter((s) => s.engine && s.engine.kind === "agent")
      .map((s) => ({ template: s.engine.template, mission: (AGENT_TEMPLATES[s.engine.template] || {}).mission || "" })),
    automations: presetAutomationKeys(presetKey),
    notifications: presetNotifications(presetKey),
    forms: presetEntrySources(presetKey).filter((x) => x.kind === "website-form").map((x) => ({ key: x.key, label: x.label })),
    calendars: presetEntrySources(presetKey).filter((x) => x.kind === "calendar").map((x) => ({ ref: x.ref, label: x.label })),
  };
}

// ── Compiler ─────────────────────────────────────────────────────────────────
// Turn a preset into the concrete DB rows for one (client, offer). Pure - no I/O.
// Returns { stageRows, transitionRows } exactly matching the table columns.
export function buildPresetRows(presetKey, clientId, offerId) {
  const p = PRESETS[presetKey];
  if (!p) throw new Error(`unknown preset '${presetKey}' (known: ${Object.keys(PRESETS).join(", ")})`);
  if (!clientId) throw new Error("clientId required");

  // `attachOnUse` stations (today: reignition) are part of the FLOW - their edges
  // are compiled below and served to the router - but they are not stamped when a
  // preset is applied. A stage nobody is running a campaign in would otherwise be a
  // permanently empty column on every academy's board. They are stamped on first
  // use instead (stampReignitionStage), through this same idempotent upsert.
  const stageRows = [...p.stages].filter((s) => !s.attachOnUse).sort((a, b) => a.position - b.position).map((s) => ({
    client_id: clientId,
    offer_id: offerId || null,
    role: s.role,
    label: s.label,
    position: s.position,
    is_terminal: false, // preset stages are working stages; won/unqualified are terminal DESTINATIONS, not stages
  }));

  const transitionRows = presetTransitions(p).map((e, i) => ({
    client_id: clientId,
    offer_id: offerId || null,
    pipeline_id: null, // client-wide default flow - resolveEdge filters pipeline_id IS NULL
    from_stage_role: e.fromRole, // null for the new_lead entry
    trigger: e.trigger,
    to_kind: e.toKind,
    to_stage_role: e.toKind === "stage" ? e.toRole : null,
    to_terminal: e.toKind === "terminal" ? e.terminal : null,
    is_seed: true,
    sort_order: (i + 1) * 10,
  }));

  return { stageRows, transitionRows };
}

// STAMP a preset onto an academy's offer. Idempotent (upserts on the existing
// unique keys). Writes via the provided sbRest (defaults to _store's service-role
// reader). Pass { dryRun:true } to get the rows WITHOUT writing.
//
// PHASE 3 (2026-07-23): edges are NO LONGER copy-stamped. The router reads the
// flow graph straight from this file (preset-master.js, live since the Phase 1
// flip), so per-academy stage_transitions rows are only (a) pause overrides an
// academy sets in focus mode and (b) the pre-flip rows kept as the emergency
// fallback. applyPreset now writes ONLY the pipeline_stages IDENTITY ANCHORS
// (opportunities FK them) - the edge-conflict guard and the 409/force flow died
// with the stamping. `force` is accepted and ignored so old callers don't break.
//
// SCOPE GUARD (Phase 2): the live board/router/agents key the pipeline by
// (client_id, role), NOT by offer - so a single academy can hold only ONE
// pipeline today. applyPreset therefore targets a fresh academy (no rows) or a
// re-stamp of the SAME offer. If the academy already has stages tagged to a
// DIFFERENT offer, it refuses: running two offer pipelines in one academy needs
// the offer-aware readers + per-offer unique keys (parked Phase 3b spec).
export async function applyPreset({ clientId, offerId, presetKey, dryRun = false, force = false, sb = sbRest, log = console.log } = {}) {
  void force; // Phase 3: no edge stamping left to force
  const { stageRows, transitionRows } = buildPresetRows(presetKey, clientId, offerId);

  // Multi-offer-per-academy guard.
  const existing = (await sb(
    `pipeline_stages?client_id=eq.${encodeURIComponent(clientId)}&select=role,offer_id`
  )) || [];
  const otherOffer = existing.find((r) => r.offer_id && r.offer_id !== offerId);
  if (otherOffer) {
    throw new Error(
      `academy ${clientId} already has a pipeline for offer ${otherOffer.offer_id}. ` +
      `Running a SECOND offer pipeline in one academy needs offer-aware readers + per-offer ` +
      `unique keys (Phase 3b). Refusing to overwrite.`
    );
  }

  if (dryRun) {
    log(`[dry-run] preset '${presetKey}' → client ${clientId} offer ${offerId || "(none)"}`);
    log(`[dry-run] ${stageRows.length} pipeline_stages anchor rows:`);
    for (const s of stageRows) log(`   stage  ${s.position}  ${s.role.padEnd(22)} "${s.label}"`);
    log(`[dry-run] ${transitionRows.length} edges (runtime-read from the master, NOT written):`);
    for (const t of transitionRows) {
      const dest = t.to_kind === "stage" ? t.to_stage_role : `@${t.to_terminal}`;
      log(`   edge   ${String(t.from_stage_role || "(entry)").padEnd(22)} --${t.trigger}--> ${dest}`);
    }
    log(`[dry-run] would seed automations (idempotent, edit-safe): ${presetAutomationKeys(presetKey).join(", ")}`);
    return { dryRun: true, stages: stageRows.length, transitions: transitionRows.length, stageRows, transitionRows };
  }

  // Upsert the stage IDENTITY ANCHORS on the existing unique (client_id, role);
  // merge so a re-stamp updates label/position/offer without duplicating.
  await sb(`pipeline_stages?on_conflict=client_id,role`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(stageRows),
  });

  // Seed the preset's automations from the canonical defaults IN THE SAME STEP
  // (2026-07-25): applying a preset without its drips left academies with stages
  // but zero automations (San Jose sat like that for two days). Idempotent +
  // edit-safe (create only if missing, steps only when zero), so a re-stamp
  // never touches copy an academy already edited. Non-fatal on failure - the
  // stage anchors are in; a retry or the portal's seed action recovers.
  let automations = [];
  try {
    automations = await seedAutomations({ clientId, offerId, keys: presetAutomationKeys(presetKey), sb });
    log(`preset '${presetKey}' automations seeded: ${automations.map((a) => `${a.key}${a.created ? " (new)" : ""}=${a.steps ?? "?"} steps`).join(", ")}`);
  } catch (e) {
    log(`preset '${presetKey}' automation seed FAILED (recover via seed-preset-automations): ${e.message || e}`);
  }

  log(`preset '${presetKey}' applied → ${stageRows.length} stage anchors for client ${clientId} offer ${offerId || "(none)"}; ${transitionRows.length} edges served live from the master`);
  return { dryRun: false, stages: stageRows.length, transitions: transitionRows.length, automations };
}
