// ── The REIGNITION station ───────────────────────────────────────────────────
// Design (approved): docs/plans/ignition-template.html
//
// Academies arrive carrying piles of old leads nobody ever followed up. Reignition
// is the warm, paced, safe way staff put chosen people back into the sales system.
// It is a THIRD kind of front door into the pipeline, beside the form door and the
// calendar door that already exist - except this door has no automatic side: the
// only thing that opens it is a campaign roster a human built.
//
// WHY THIS FILE EXISTS SEPARATELY FROM presets.js. The station bolts onto ANY sales
// system, so it cannot be authored inside one preset. It is declared once, here,
// and attached to every preset in the registry by attachReignition(). free_trial
// and discovery_trial both get the identical station; a sales system we write next
// year gets it by existing. There is deliberately NO per-academy variant and no way
// to make one: the only thing adjustable is WHERE the exits point, and that is
// declared per SALES SYSTEM at attach time, never per academy.
//
// THE STAGE
//   entry   MANUAL ONLY. No `trigger` (it is not a front door for new leads), no
//           form source, no calendar source, no automatic enrolment of any kind.
//           A campaign roster is the single path in. Importing an academy's old
//           leads can therefore never, by itself, cause one message to send.
//   engine  the campaign's own automation (`ignition:<slug>`) - an ordinary
//           automation on the ordinary worker. Declared per campaign, not here,
//           because each campaign writes its own messages.
//   exits   declared BY ROLE, so they resolve against whatever stages the host
//           sales system happens to have:
//             replied             -> the system's talking stage      (default `responded`)
//             ran_out             -> the system's long game          (default `nurture`)
//             marked_unqualified  -> @unqualified   (terminal)
//             complaint_offtopic  -> @human         (terminal)
//
// THE VALIDATION, AND WHY IT FAILS CLOSED (Zoran's rule, made checkable)
// Two assumptions were stated as obvious and are now enforced instead of assumed:
//   1. a REPLY must land somewhere a person or an agent can answer it, and
//   2. a full ghost must land in an automation, or out of the pipeline entirely.
// So attaching the station to a sales system whose `replied` exit points at a drip
// (or at a terminal) is REFUSED, loudly, at attach time - which is module load, so
// it is a design-time failure a deploy cannot get past, not a runtime surprise a
// parent discovers by being answered by a robot. Same for a `ran_out` exit that
// points at a stage with a talker: that would put a person who never once responded
// in front of an agent.
//
// STAMPING. The station is NOT stamped by applyPreset - a stage nobody is running a
// campaign in is a permanently empty column on every academy's board. It is stamped
// on FIRST USE (campaign approval) by stampReignitionStage(), which reuses the exact
// idempotent pipeline_stages upsert on (client_id, role) that applyPreset uses, so a
// re-stamp is a no-op and the two can never disagree about a row's shape.

import { sbRest } from "./_store.js";

export const REIGNITION_ROLE = "reignition";
export const REIGNITION_LABEL = "Reignition";

// The two ADJUSTABLE exits, as ROLE names in the host sales system. A future
// system whose reignition is a slow-burn play attaches with { replied: "..." }
// pointing somewhere else; the validation below still has to pass.
export const DEFAULT_REIGNITION_EXITS = { replied: "responded", ran_out: "nurture" };

// The two FIXED exits. Both terminal, both immediate, neither adjustable: a wrong
// person is a wrong person and a complaint is a complaint in every sales system.
export const REIGNITION_TERMINAL_EXITS = [
  { trigger: "marked_unqualified", terminal: "unqualified" },
  { trigger: "complaint_offtopic", terminal: "human" },
];

// Engine kinds that can ANSWER a human being.
const TALKERS = new Set(["agent", "human"]);
// Engine kinds that send on a clock and never read what came back.
const SILENT = new Set(["automation"]);

// Roles a lead is bounced OUT of, back to the talking stage, when they reply while
// an automation is drip-feeding them. Exported so the inbound webhooks share ONE
// list instead of four copies that drift - `reignition` joining it is the whole
// reason this constant exists. ("interested" is the legacy key for "ghosted".)
export const REPLY_BOUNCE_ROLES = ["ghosted", "interested", "nurture", REIGNITION_ROLE];
export const bouncesToRespondedOnReply = (role) => REPLY_BOUNCE_ROLES.includes(String(role || ""));

const stageOf = (preset, role) => ((preset && preset.stages) || []).find((s) => s && s.role === role) || null;
const engineKind = (stage) => (stage && stage.engine && stage.engine.kind) || null;

// ── the fail-closed check ────────────────────────────────────────────────────
// Returns a list of human-readable problems. EMPTY means safe to attach. Pure, and
// exported so the test can prove a bad preset is refused without attaching one.
export function validateReignitionAttachment(preset, exits = DEFAULT_REIGNITION_EXITS) {
  const problems = [];
  const label = (preset && preset.key) || "(unnamed preset)";
  if (!preset || !Array.isArray(preset.stages) || !preset.stages.length) {
    return [`${label}: not a preset (no stages), so the reignition station has nothing to attach to.`];
  }
  if (stageOf(preset, REIGNITION_ROLE)) {
    problems.push(`${label}: already declares a '${REIGNITION_ROLE}' stage. The station is attached once, by attachReignition().`);
  }

  const e = { ...DEFAULT_REIGNITION_EXITS, ...(exits || {}) };

  // 1. replied -> must be a STAGE, and that stage must be able to talk back.
  const repliedRole = e.replied;
  const repliedStage = repliedRole ? stageOf(preset, repliedRole) : null;
  if (!repliedRole) {
    problems.push(`${label}: no 'replied' exit declared. A reply must always have somewhere to go.`);
  } else if (!repliedStage) {
    problems.push(`${label}: the 'replied' exit points at role '${repliedRole}', which this sales system does not have.`);
  } else if (!TALKERS.has(engineKind(repliedStage))) {
    problems.push(
      `${label}: the 'replied' exit points at '${repliedRole}', whose engine is '${engineKind(repliedStage) || "none"}'. ` +
      `A reply MUST land on an agent or a human. Answering a person's reply with a drip is the exact pipeline this check exists to stop.`
    );
  }

  // 2. ran_out -> an automation stage, or a terminal. Never a talker: nobody who
  //    ignored every message is handed to an agent as if they had said something.
  const ranOutRole = e.ran_out;
  if (!ranOutRole) {
    problems.push(`${label}: no 'ran_out' exit declared. A campaign that ends must hand the person somewhere.`);
  } else if (typeof ranOutRole === "object" && ranOutRole && ranOutRole.terminal) {
    // { terminal: "unqualified" } is a legitimate ran_out for a system with no long game.
    if (!["member", "unqualified", "human"].includes(ranOutRole.terminal)) {
      problems.push(`${label}: the 'ran_out' exit names terminal '${ranOutRole.terminal}', which is not a terminal.`);
    }
  } else {
    const ranOutStage = stageOf(preset, ranOutRole);
    if (!ranOutStage) {
      problems.push(`${label}: the 'ran_out' exit points at role '${ranOutRole}', which this sales system does not have.`);
    } else if (!SILENT.has(engineKind(ranOutStage))) {
      problems.push(
        `${label}: the 'ran_out' exit points at '${ranOutRole}', whose engine is '${engineKind(ranOutStage) || "none"}'. ` +
        `Silence must roll into an automation or out of the pipeline, never onto a talker.`
      );
    }
  }

  return problems;
}

// ── build the station for one sales system ───────────────────────────────────
// THROWS on any problem. There is no "attach anyway" flag on purpose.
export function buildReignitionStation(preset, { exits, position } = {}) {
  const problems = validateReignitionAttachment(preset, exits);
  if (problems.length) {
    throw new Error(
      "REIGNITION ATTACHMENT REFUSED:\n  - " + problems.join("\n  - ") +
      "\n\nFix the sales system's exits in api/agent/presets.js. See the header of api/agent/reignition-station.js."
    );
  }
  const e = { ...DEFAULT_REIGNITION_EXITS, ...(exits || {}) };
  const lastPos = Math.max(0, ...((preset.stages || []).map((s) => Number(s.position) || 0)));
  const ranOutExit = (typeof e.ran_out === "object" && e.ran_out && e.ran_out.terminal)
    ? { trigger: "ran_out", toKind: "terminal", terminal: e.ran_out.terminal }
    : { trigger: "ran_out", toKind: "stage", toRole: e.ran_out };

  return {
    role: REIGNITION_ROLE,
    label: REIGNITION_LABEL,
    position: position != null ? position : lastPos + 1,
    // MANUAL ONLY. No trigger (never a pipeline front door), no sources (no form,
    // no calendar). The empty object is the declaration, not an omission.
    entry: {},
    // The engine is the campaign's own automation, named per campaign
    // (`ignition:<slug>`), so it is not knowable here. Declared as a station with
    // no fixed engine; nothing enters it without a campaign, and a campaign always
    // brings its automation with it.
    engine: null,
    // Stamped on first campaign approval, not by applyPreset - see the header.
    attachOnUse: true,
    exits: [
      { trigger: "replied", toKind: "stage", toRole: e.replied },
      ranOutExit,
      ...REIGNITION_TERMINAL_EXITS.map((t) => ({ trigger: t.trigger, toKind: "terminal", terminal: t.terminal })),
    ],
  };
}

// Attach the station to a preset IN PLACE and return it. Called once per preset at
// module load in presets.js, so a mis-declared sales system fails the import.
export function attachReignition(preset, opts = {}) {
  preset.stages.push(buildReignitionStation(preset, opts));
  return preset;
}

// ── stamping ─────────────────────────────────────────────────────────────────
// The SAME idempotent upsert applyPreset uses for its stage anchors: on_conflict
// (client_id, role) + merge-duplicates, so calling this on every campaign approval
// for the rest of time writes the identical row and never duplicates.
export async function stampReignitionStage({ clientId, offerId = null, presetKey, preset = null, sb = sbRest, log = console.log } = {}) {
  if (!clientId) throw new Error("stampReignitionStage: clientId required");
  const p = preset || null;
  const station = p ? (stageOf(p, REIGNITION_ROLE) || buildReignitionStation(p)) : null;
  const row = {
    client_id: clientId,
    offer_id: offerId || null,
    role: REIGNITION_ROLE,
    label: REIGNITION_LABEL,
    position: (station && station.position) != null ? station.position : 6,
    is_terminal: false,
  };
  await sb(`pipeline_stages?on_conflict=client_id,role`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
  log(`reignition station stamped for client ${clientId}${presetKey ? ` (preset '${presetKey}')` : ""}`);
  return row;
}
