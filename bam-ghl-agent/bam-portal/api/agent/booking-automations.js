// Booking agent - the INITIAL AUTOMATIONS (scripted first-touch openers), keyed
// by ENTRY POINT.
//
// The Responded stage (Booking agent) is the hub of the Sales-Crew flow: leads
// enter it through several different doors, and each door wants a different
// opening message. So - unlike confirm-automations.js / closing-automations.js,
// which are single-entry stage-level sequences - the booking initial automations
// are grouped by entry point:
//
//   new_lead   → a fresh inbound lead (form / ad)            "let's get you booked"
//   rebook     → a no-show or a can't-make-it bounce-back    "sorry we missed you, new time?"
//   reengaged  → a Nurture / Ghosted lead who replied        "great to hear back"
//
// The trigger that landed the lead in Responded maps to one of those entry points
// (bookingEntryForTrigger). When live + approved, the booking detector fires the
// entry's next due step; the moment the lead replies, the AI booking agent takes
// over. Until the academy approves it (or for a disabled entry/step), the detector
// falls back to the existing AI cold-opener - backward-compatible, same gate model
// as confirm/closing.
//
// STATUS: Phase A (2026-07-06) - shipped DORMANT. Nothing calls these yet; the
// booking detector wiring is Phase C (see docs/initial-automations-design.md).
//
// Timing is relative to ENTRY (when the lead landed in Responded), like closing's
// after_days - NOT relative to a trial date. `startedMs` = when the first opener
// step fired for this contact.
//
// HARD RULE: never an em dash in any template (person-facing copy). Hyphens only.

const DAY = 86400000;

// The shipped defaults (BAM GTA copy). Per-academy overrides live in
// clients.ghl_kpi_config.booking_initial_automations (enabled/approved + per-entry,
// per-step enabled + template; fixed fields - when/channel/offset_days/label -
// always come from here). {{contact.first_name}} is filled by the send engine.
export const DEFAULT_BOOKING_AUTOMATIONS = {
  enabled: true,
  approved: false,   // must be approved once per academy before anything sends
  entries: {
    new_lead: {
      label: "New lead",
      steps: [
        {
          key: "opener",
          label: "First outreach",
          when: "immediate",
          channel: "sms",
          enabled: true,
          template:
"Hey {{contact.first_name}}! Thanks for reaching out about a free trial 🏀 What days usually work best for you? I'll get you set up.",
        },
      ],
    },
    rebook: {
      label: "Rebook (no-show / can't make it)",
      steps: [
        {
          key: "opener",
          label: "Rebook outreach",
          when: "immediate",
          channel: "sms",
          enabled: true,
          template:
"Hey {{contact.first_name}}, sorry we missed you at your trial! No worries at all - want to grab a new time? Let me know what works and I'll get you rebooked 🏀",
        },
      ],
    },
    reengaged: {
      label: "Re-engaged (replied from nurture / ghosted)",
      steps: [
        {
          key: "opener",
          label: "Re-engage outreach",
          when: "immediate",
          channel: "sms",
          enabled: true,
          template:
"Great to hear back {{contact.first_name}}! 🏀 Want to get you in for that free trial? Just tell me what days work and I'll set it up.",
        },
      ],
    },
  },
};

// The entry-point keys, in display order (for the UI + iteration).
export const BOOKING_ENTRY_POINTS = ["new_lead", "rebook", "reengaged"];
export const BOOKING_AUTOMATION_WHENS = ["immediate", "after_days"];

// Map a transition trigger (the door the lead came through) to a booking entry
// point. Returns null for triggers that don't land in Responded.
export function bookingEntryForTrigger(trigger) {
  switch (trigger) {
    case "new_lead":     return "new_lead";
    case "no_show":
    case "cant_make_it": return "rebook";
    case "replied":      return "reengaged";
    default:             return null;
  }
}

// Merge the per-academy override over the shipped defaults. Override may set
// enabled/approved (top level) and, per entry, per-step enabled + template (by
// key). Fixed fields (when, channel, offset_days, label) always come from the
// defaults. Returns the same { enabled, approved, entries:{ <key>:{ steps } } } shape.
export function getBookingAutomations(client) {
  const cfg = (client && client.ghl_kpi_config) || {};
  const ov = cfg.booking_initial_automations || {};
  const ovEntries = (ov.entries && typeof ov.entries === "object") ? ov.entries : {};
  const entries = {};
  for (const [ekey, edef] of Object.entries(DEFAULT_BOOKING_AUTOMATIONS.entries)) {
    const oe = ovEntries[ekey] || {};
    const ovSteps = Array.isArray(oe.steps) ? oe.steps : [];
    const byKey = new Map(ovSteps.map(s => [s && s.key, s]));
    const steps = edef.steps.map(def => {
      const o = byKey.get(def.key) || {};
      return {
        ...def,
        enabled: typeof o.enabled === "boolean" ? o.enabled : def.enabled,
        template: typeof o.template === "string" && o.template.trim() ? o.template : def.template,
      };
    });
    entries[ekey] = { label: edef.label, steps };
  }
  return {
    enabled: typeof ov.enabled === "boolean" ? ov.enabled : DEFAULT_BOOKING_AUTOMATIONS.enabled,
    approved: ov.approved === true,
    entries,
  };
}

// Live for a given entry point = the sequence is ON, APPROVED, and that entry has
// at least one enabled step. Until then the booking detector falls back to the AI
// cold-opener (backward-compatible).
export function automationsLive(autos, entryKey) {
  if (!autos || !autos.enabled || !autos.approved) return false;
  const entry = autos.entries && autos.entries[entryKey];
  return !!(entry && (entry.steps || []).some(s => s.enabled));
}

// ── timing (relative to entry) ──
// `startedMs` = when the first opener step fired for this contact (null = nothing
// sent yet, so only the immediate step is due). An after_days step is due once
// that many days have passed since the sequence started.
export function stepIsDue(step, nowMs, startedMs) {
  if (step.when === "immediate") return true;
  if (step.when === "after_days") {
    if (!startedMs) return false;
    return nowMs >= startedMs + (Number(step.offset_days) || 0) * DAY;
  }
  return false;
}

// The next step to act on for a given entry point: the first ENABLED,
// not-yet-handled step that is due now.
export function nextDueStep(autos, entryKey, { nowMs, startedMs, sentKeys }) {
  const entry = autos && autos.entries && autos.entries[entryKey];
  if (!entry) return null;
  const handled = sentKeys instanceof Set ? sentKeys : new Set(sentKeys || []);
  for (const step of (entry.steps || [])) {
    if (!step.enabled) continue;
    if (handled.has(step.key)) continue;
    if (stepIsDue(step, nowMs, startedMs)) return step;
  }
  return null;
}
