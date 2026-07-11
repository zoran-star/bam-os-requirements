// ── Pipeline Preset Registry (Phase 2) ───────────────────────────────────────
// Presets are authored HERE, in code (Zoran, 2026-07-10): BAM-only, versioned in
// git, no template tables and no authoring UI. A preset is a named sales playbook
// = its stage list + the transition graph between those stages + which worker
// runs each stage. `applyPreset()` STAMPS a preset onto an academy's OFFER,
// writing the `pipeline_stages` + `stage_transitions` rows the board, router, and
// agents already read.
//
// Two things share this file:
//   • AGENT_TEMPLATES — reusable agent definitions. A template = an underlying
//     runtime (booking | confirm | closing behaviour, defined in
//     prompt-structure.js) + a mission + the lesson bucket it trains into. The
//     SAME template can appear in many presets: craft taught to `trial_confirm`
//     helps every preset that reuses it (Phase 4 scopes lessons by template).
//   • PRESETS — the playbooks. `free_trial` is today's exact live model
//     (5 stages + 20 edges, byte-for-byte the seed_default_stage_transitions
//     flow). `discovery_trial` is preset #2 (Zoran's outline): a discovery call
//     before the trial, reusing trial_confirm + closing untouched.
//
// This is the "presets in CODE" decision made real. Adding a preset = editing
// this file + (if it introduces a new agent mission) authoring that template's
// prompt sections. No migration, no DB template rows.
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
  // Preset #2 additions — new missions, existing runtimes. Prompt sections to be
  // authored when discovery_trial ships (Phase 2 only DECLARES them).
  call_booking:  { runtime: "booking", lessonKey: "call_booking", mission: "Book the lead into a discovery call (not a trial yet)." },
  call_confirm:  { runtime: "confirm", lessonKey: "call_confirm", mission: "Confirm a booked discovery call and make sure they attend it." },
};

// Worker shorthands for a stage.
const agent = (template) => ({ kind: "agent", template });
const automation = (key) => ({ kind: "automation", key });
const HUMAN = { kind: "human" };

// Edge tuple helpers → the exact stage_transitions row shape.
// stage edge: to another role. terminal edge: to member | unqualified | human.
const to = (fromRole, trigger, toRole) => ({ fromRole, trigger, toKind: "stage", toRole });
const end = (fromRole, trigger, terminal) => ({ fromRole, trigger, toKind: "terminal", terminal });
const ENTRY = null; // from_stage_role IS NULL — the external new_lead entry.

// ── PRESETS ──────────────────────────────────────────────────────────────────
export const PRESETS = {
  // free_trial = the current live BAM model, reproduced exactly. Stamping it onto
  // an academy's Training offer must yield today's 5 stages + 20 edges verbatim.
  free_trial: {
    key: "free_trial",
    label: "Free Trial",
    description: "Lead → book a free trial → confirm the trial → close after a good-fit trial.",
    stages: [
      { role: "responded",       label: "Booking", position: 0, worker: agent("trial_booking") },
      { role: "interested",      label: "Ghosted", position: 1, worker: automation("ghosted") },
      { role: "scheduled_trial", label: "Confirm", position: 2, worker: agent("trial_confirm") },
      { role: "done_trial",      label: "Closing", position: 3, worker: agent("closing") },
      { role: "nurture",         label: "Nurture", position: 4, worker: automation("lead_nurture") },
    ],
    transitions: [
      to(ENTRY,             "new_lead",            "responded"),
      to("responded",       "booked",              "scheduled_trial"),
      to("responded",       "not_interested",      "nurture"),
      end("responded",      "marked_unqualified",  "unqualified"),
      to("responded",       "went_quiet",          "interested"),
      end("responded",      "complaint_offtopic",  "human"),
      to("scheduled_trial", "post_trial_good_fit", "done_trial"),
      end("scheduled_trial","post_trial_not_fit",  "unqualified"),
      to("scheduled_trial", "no_show",             "responded"),
      to("scheduled_trial", "cant_make_it",        "responded"),
      to("scheduled_trial", "no_longer_wants",     "nurture"),
      end("scheduled_trial","marked_unqualified",  "unqualified"),
      end("scheduled_trial","complaint_offtopic",  "human"),
      end("done_trial",     "enrolls",             "member"),
      to("done_trial",      "says_no",             "nurture"),
      end("done_trial",     "marked_unqualified",  "unqualified"),
      end("done_trial",     "complaint_offtopic",  "human"),
      to("interested",      "replied",             "responded"),
      to("interested",      "ghosted_ran_out",     "nurture"),
      to("nurture",         "replied",             "responded"),
    ],
  },

  // discovery_trial = preset #2. A discovery call sits before the trial. Reuses
  // the ghosted + nurture automations and the trial_confirm + closing agents
  // unchanged; the only genuinely new pieces are the call_booking mission and the
  // discovery_call_booked stage worked by call_confirm.
  discovery_trial: {
    key: "discovery_trial",
    label: "Discovery Call → Trial",
    description: "Lead → book a discovery call → confirm the call → book a trial → confirm the trial → close.",
    stages: [
      { role: "responded",            label: "Booking",      position: 0, worker: agent("call_booking") },
      { role: "interested",           label: "Ghosted",      position: 1, worker: automation("ghosted") },
      { role: "discovery_call_booked",label: "Call Confirm", position: 2, worker: agent("call_confirm") },
      { role: "scheduled_trial",      label: "Trial Confirm",position: 3, worker: agent("trial_confirm") },
      { role: "done_trial",           label: "Closing",      position: 4, worker: agent("closing") },
      { role: "nurture",              label: "Nurture",      position: 5, worker: automation("lead_nurture") },
    ],
    transitions: [
      to(ENTRY,                    "new_lead",            "responded"),
      to("responded",              "booked",              "discovery_call_booked"),
      to("responded",              "not_interested",      "nurture"),
      end("responded",             "marked_unqualified",  "unqualified"),
      to("responded",              "went_quiet",          "interested"),
      end("responded",             "complaint_offtopic",  "human"),
      to("discovery_call_booked",  "booked",              "scheduled_trial"),
      to("discovery_call_booked",  "no_show",             "responded"),
      to("discovery_call_booked",  "cant_make_it",        "responded"),
      to("discovery_call_booked",  "no_longer_wants",     "nurture"),
      end("discovery_call_booked", "marked_unqualified",  "unqualified"),
      end("discovery_call_booked", "complaint_offtopic",  "human"),
      to("scheduled_trial",        "post_trial_good_fit", "done_trial"),
      end("scheduled_trial",       "post_trial_not_fit",  "unqualified"),
      to("scheduled_trial",        "no_show",             "responded"),
      to("scheduled_trial",        "cant_make_it",        "responded"),
      to("scheduled_trial",        "no_longer_wants",     "nurture"),
      end("scheduled_trial",       "marked_unqualified",  "unqualified"),
      end("scheduled_trial",       "complaint_offtopic",  "human"),
      end("done_trial",            "enrolls",             "member"),
      to("done_trial",             "says_no",             "nurture"),
      end("done_trial",            "marked_unqualified",  "unqualified"),
      end("done_trial",            "complaint_offtopic",  "human"),
      to("interested",             "replied",             "responded"),
      to("interested",             "ghosted_ran_out",     "nurture"),
      to("nurture",                "replied",             "responded"),
    ],
  },
};

// Every role a preset uses (for validation / display).
export function presetRoles(presetKey) {
  const p = PRESETS[presetKey];
  return p ? p.stages.map((s) => s.role) : [];
}

// Turn a preset into the concrete DB rows for one (client, offer). Pure — no I/O.
// Returns { stageRows, transitionRows } exactly matching the table columns.
export function buildPresetRows(presetKey, clientId, offerId) {
  const p = PRESETS[presetKey];
  if (!p) throw new Error(`unknown preset '${presetKey}' (known: ${Object.keys(PRESETS).join(", ")})`);
  if (!clientId) throw new Error("clientId required");

  const stageRows = p.stages.map((s) => ({
    client_id: clientId,
    offer_id: offerId || null,
    role: s.role,
    label: s.label,
    position: s.position,
    is_terminal: false, // preset stages are working stages; won/unqualified are terminal DESTINATIONS, not stages
  }));

  const transitionRows = p.transitions.map((e, i) => ({
    client_id: clientId,
    offer_id: offerId || null,
    pipeline_id: null, // client-wide default flow — resolveEdge filters pipeline_id IS NULL
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
// (client_id, role), NOT by offer — so a single academy can hold only ONE
// pipeline today. applyPreset therefore targets a fresh academy (no rows) or a
// re-stamp of the SAME offer. If the academy already has stages tagged to a
// DIFFERENT offer, it refuses: running two offer pipelines in one academy needs
// the offer-aware readers + per-offer unique keys built in Phase 3.
export async function applyPreset({ clientId, offerId, presetKey, dryRun = false, sb = sbRest, log = console.log } = {}) {
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
