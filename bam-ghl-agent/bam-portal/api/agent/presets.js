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

// ── Agent templates ──────────────────────────────────────────────────────────
// runtime  = which existing agent behaviour drives it (prompt-structure.js AGENT_SPECS).
// mission  = the one-line job, what makes this template distinct from its runtime siblings.
// lessonKey= the agent_lessons.agent bucket it trains into. free_trial's templates
//            keep today's keys ('booking'/'confirm'/'closing') so existing lessons
//            keep applying; new templates get their own bucket so a call-booking
//            correction never bleeds into trial-booking (Phase 4 enforces this).
export const AGENT_TEMPLATES = {
  trial_booking: { runtime: "booking", lessonKey: "booking", mission: "Book the lead into a free trial session." },
  trial_confirm: { runtime: "confirm", lessonKey: "confirm", mission: "Confirm a booked trial and make sure they show up." },
  closing:       { runtime: "closing", lessonKey: "closing", mission: "Convert a good-fit trial attendee into an enrolled member." },
  // Preset #2 additions - new missions, existing runtimes. Prompt sections to be
  // authored when discovery_trial ships (Phase 2 only DECLARES them).
  call_booking:  { runtime: "booking", lessonKey: "call_booking", mission: "Book the lead into a discovery call (not a trial yet)." },
  call_confirm:  { runtime: "confirm", lessonKey: "call_confirm", mission: "Confirm a booked discovery call and make sure they attend it." },
  // Member Care is NOT a pipeline-station agent: it iterates the MEMBERS roster
  // (api/agent-member-care.js), so it never appears as a stage engine. Declared
  // here so its lesson bucket + mission live in the same registry as its siblings.
  member_care:   { runtime: "member_care", lessonKey: "member_care", mission: "Watch member conversations; propose billing actions, replies, and staff to-dos for approval." },
};

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
          go("went_quiet", "interested"),
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
      { role: "interested", label: "Ghosted", position: 1,
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
          go("went_quiet", "interested"),
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
      { role: "interested", label: "Ghosted", position: 1,
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
    stages: stages.map((s) => ({ role: s.role, label: s.label, engine: s.engine ? s.engine.kind : "human",
      engine_ref: s.engine ? (s.engine.template || s.engine.key || null) : null })),
    agents: stages.filter((s) => s.engine && s.engine.kind === "agent")
      .map((s) => ({ template: s.engine.template, mission: (AGENT_TEMPLATES[s.engine.template] || {}).mission || "" })),
    automations: presetAutomationKeys(presetKey),
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

  const stageRows = [...p.stages].sort((a, b) => a.position - b.position).map((s) => ({
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
// SCOPE GUARD (Phase 2): the live board/router/agents key the pipeline by
// (client_id, role), NOT by offer - so a single academy can hold only ONE
// pipeline today. applyPreset therefore targets a fresh academy (no rows) or a
// re-stamp of the SAME offer. If the academy already has stages tagged to a
// DIFFERENT offer, it refuses: running two offer pipelines in one academy needs
// the offer-aware readers + per-offer unique keys built in Phase 3.
export async function applyPreset({ clientId, offerId, presetKey, dryRun = false, force = false, sb = sbRest, log = console.log } = {}) {
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
      `unique keys (Phase 3). Refusing to overwrite.`
    );
  }

  // Edge-conflict guard: the edge unique key INCLUDES the destination columns, so
  // stamping a DIFFERENT preset (or a same-preset "upgrade" that moves an edge's
  // destination) onto this offer does NOT conflict-update the old edge - it INSERTS
  // a second enabled edge for the same (from, trigger). Two enabled edges with
  // different destinations route a live event nondeterministically (a booked lead
  // silently goes to a stage no agent works). Detect that BEFORE writing anything.
  const sameOffer = (a, b) => (a || null) === (b || null);
  const newByFromTrig = new Map();
  for (const t of transitionRows) newByFromTrig.set(`${t.from_stage_role || ""}|${t.trigger}`, `${t.to_kind}|${t.to_stage_role || ""}|${t.to_terminal || ""}`);
  let conflicts = [];
  try {
    const edges = (await sb(`stage_transitions?client_id=eq.${encodeURIComponent(clientId)}&select=offer_id,from_stage_role,trigger,to_kind,to_stage_role,to_terminal,enabled`)) || [];
    conflicts = edges.filter((e) => {
      if (!sameOffer(e.offer_id, offerId) || e.enabled === false) return false;
      const key = `${e.from_stage_role || ""}|${e.trigger}`;
      const cur = `${e.to_kind}|${e.to_stage_role || ""}|${e.to_terminal || ""}`;
      return newByFromTrig.has(key) && newByFromTrig.get(key) !== cur;
    });
  } catch (_) { /* if the read fails, fall through - the upsert still runs */ }
  if (conflicts.length && !force) {
    const list = conflicts.map((e) => `  ${e.from_stage_role || "(entry)"} --${e.trigger}--> ${e.to_kind === "stage" ? e.to_stage_role : "@" + e.to_terminal}`).join("\n");
    throw new Error(
      `academy ${clientId} offer ${offerId || "(none)"} already has ${conflicts.length} edge(s) whose destination differs from preset '${presetKey}':\n${list}\n` +
      `Upserting would leave BOTH enabled (nondeterministic routing). Re-run with force:true to REPLACE this offer's edges cleanly.`
    );
  }
  // force: wipe this offer's existing edges so the preset is a clean replace, not
  // an additive merge that strands the old preset's edges alongside the new ones.
  if (force && !dryRun) {
    const offerFilter = offerId ? `offer_id=eq.${encodeURIComponent(offerId)}` : `offer_id=is.null`;
    await sb(`stage_transitions?client_id=eq.${encodeURIComponent(clientId)}&${offerFilter}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    log(`[force] cleared existing edges for client ${clientId} offer ${offerId || "(none)"} before re-stamping`);
  }

  if (dryRun) {
    log(`[dry-run] preset '${presetKey}' → client ${clientId} offer ${offerId || "(none)"}`);
    log(`[dry-run] ${stageRows.length} pipeline_stages rows:`);
    for (const s of stageRows) log(`   stage  ${s.position}  ${s.role.padEnd(22)} "${s.label}"`);
    log(`[dry-run] ${transitionRows.length} stage_transitions rows:`);
    for (const t of transitionRows) {
      const dest = t.to_kind === "stage" ? t.to_stage_role : `@${t.to_terminal}`;
      log(`   edge   ${String(t.from_stage_role || "(entry)").padEnd(22)} --${t.trigger}--> ${dest}`);
    }
    return { dryRun: true, stages: stageRows.length, transitions: transitionRows.length, stageRows, transitionRows };
  }

  // Upsert stages on the existing unique (client_id, role); merge so a re-stamp
  // updates label/position/offer without duplicating.
  await sb(`pipeline_stages?on_conflict=client_id,role`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(stageRows),
  });

  // Upsert edges on the per-offer edge unique (NULLS NOT DISTINCT, so a re-stamp
  // of the identical graph is a true no-op even though every edge key holds a NULL).
  await sb(`stage_transitions?on_conflict=client_id,offer_id,from_stage_role,trigger,to_kind,to_stage_role,to_terminal`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(transitionRows),
  });

  log(`preset '${presetKey}' applied → ${stageRows.length} stages + ${transitionRows.length} edges for client ${clientId} offer ${offerId || "(none)"}`);
  return { dryRun: false, stages: stageRows.length, transitions: transitionRows.length };
}
