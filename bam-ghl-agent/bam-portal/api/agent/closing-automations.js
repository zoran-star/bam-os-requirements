// Closing agent — the INITIAL AUTOMATIONS (scripted post-trial follow-up sequence).
//
// When a good-fit attendee lands in the "Done Trial" stage (the post-trial form
// marked them a good fit), a short SCRIPTED sequence nudges them toward enrolling:
//
//   1. immediate     → warm post-trial follow-up ("hope you had a great time")
//   2. +2 days       → light nudge ("any questions about getting started?")
//   3. +4 days       → warm close-out ("door's always open")
//
// SMS-only and PORTAL-NATIVE: the only token is {{contact.first_name}}, resolved by
// the send engine (api/_send.js). No appointment / calendar links - the trial has
// already happened. The scripted touches are warm door-openers; they do NOT send the
// sign-up link (the AI closing agent does that contextually once the lead engages).
// The moment the lead REPLIES, the AI closing agent takes over the conversation.
//
// Timing is relative to the SEQUENCE START (when the first step fired), not an
// appointment - so "+2 days" means two days after the post-trial follow-up went out.
//
// Send mode reuses closing_agent_mode (via shouldAutoSend in _mode.js):
//   hawkeye    → each touch QUEUES for a one-tap ✓.
//   self_drive → it auto-fires (currently held by the global self-drive kill-switch).
//
// HARD RULE: never an em dash in any template (person-facing copy). Hyphens only.

const DAY = 86400000;

// The shipped defaults. Per-academy overrides live in
// clients.ghl_kpi_config.closing_initial_automations (enabled + per-step copy only;
// timing/channel are fixed here). Only token: {{contact.first_name}}.
export const DEFAULT_CLOSING_AUTOMATIONS = {
  enabled: true,
  approved: false,   // must be approved once per academy before anything sends
  steps: [
    {
      key: "post_trial",
      label: "Post-trial follow-up",
      when: "immediate",
      channel: "sms",
      enabled: true,
      template:
"Hi {{contact.first_name}}! Thanks for coming out to the free trial, hope you had a great time 🏀 Our coaches loved having you. Any questions about getting started as a member? Happy to help.",
    },
    {
      key: "nudge",
      label: "Follow-up nudge",
      when: "after_days",
      offset_days: 2,
      channel: "sms",
      enabled: true,
      template:
"Hey {{contact.first_name}}! Just checking in, any questions about getting signed up? We'd love to have you on the team 👍",
    },
    {
      key: "closeout",
      label: "Close-out",
      when: "after_days",
      offset_days: 4,
      channel: "sms",
      enabled: true,
      template:
"Hi {{contact.first_name}}, no pressure at all, but the door is always open whenever you're ready to join. Just reach out and we'll get you set up.",
    },
  ],
};

// Merge the per-academy override over the shipped defaults. Override may set
// enabled/approved and per-step enabled/template (by key); fixed fields (when,
// channel, offset_days, label) always come from the defaults.
export function getClosingAutomations(client) {
  const cfg = (client && client.ghl_kpi_config) || {};
  const ov = cfg.closing_initial_automations || {};
  const ovSteps = Array.isArray(ov.steps) ? ov.steps : [];
  const byKey = new Map(ovSteps.map(s => [s && s.key, s]));
  const steps = DEFAULT_CLOSING_AUTOMATIONS.steps.map(def => {
    const o = byKey.get(def.key) || {};
    return {
      ...def,
      enabled: typeof o.enabled === "boolean" ? o.enabled : def.enabled,
      template: typeof o.template === "string" && o.template.trim() ? o.template : def.template,
    };
  });
  return {
    enabled: typeof ov.enabled === "boolean" ? ov.enabled : DEFAULT_CLOSING_AUTOMATIONS.enabled,
    approved: ov.approved === true,
    steps,
  };
}

export function automationsLive(autos) {
  return !!(autos && autos.enabled && autos.approved && (autos.steps || []).some(s => s.enabled));
}

// ── timing (relative to sequence start) ──
// `startedMs` = when the FIRST step fired for this contact (null = nothing sent yet,
// so only the immediate step is due). An after_days step is due once that many days
// have passed since the sequence started.
export function stepIsDue(step, nowMs, startedMs) {
  if (step.when === "immediate") return true;
  if (step.when === "after_days") {
    if (!startedMs) return false;
    return nowMs >= startedMs + (Number(step.offset_days) || 0) * DAY;
  }
  return false;
}

// The next step to act on: the first ENABLED, not-yet-handled step that is due now.
export function nextDueStep(autos, { nowMs, startedMs, sentKeys }) {
  const handled = sentKeys instanceof Set ? sentKeys : new Set(sentKeys || []);
  for (const step of (autos.steps || [])) {
    if (!step.enabled) continue;
    if (handled.has(step.key)) continue;
    if (stepIsDue(step, nowMs, startedMs)) return step;
  }
  return null;
}
