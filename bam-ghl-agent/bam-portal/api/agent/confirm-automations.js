// Confirm agent — the INITIAL AUTOMATIONS (scripted first-touch sequence).
//
// When a lead lands in the "Scheduled Trial" stage (the booking agent just booked
// them), a short SCRIPTED sequence goes out to make sure they show up:
//
//   1. immediate   → booking confirmation ("you're booked, reply YES")
//   2. day_before  → "still good for tomorrow?"
//   3. morning_of  → "today at {time}, bring shoes + water"
//
// These are TEMPLATES (no AI) — academy-agnostic defaults here, per-academy copy/
// timing overrides in clients.ghl_kpi_config.confirm_initial_automations. The moment
// the lead REPLIES, the AI confirm agent takes over the conversation (handled in
// agent-confirm.js); the scripted touches only ever fire while the lead is silent.
//
// Send mode reuses the confirm_agent_mode switch (via shouldAutoSend in _mode.js):
//   hawkeye    → each scripted touch QUEUES for a one-tap ✓ approval.
//   self_drive → it auto-fires (currently held by the global self-drive kill-switch).
//
// HARD RULE: never an em dash in any template (person-facing copy). Hyphens only.

const TZ = "America/Toronto";

// The shipped defaults — so a new academy's sequence is never blank. Tokens:
//   {first_name} parent first name · {day} "Mon, Jun 30" · {time} "7:00 PM"
//   {address} academy address (best-effort from business_info; blank if unknown)
export const DEFAULT_CONFIRM_AUTOMATIONS = {
  enabled: true,
  approved: false,   // must be approved once per academy before anything sends
  steps: [
    {
      key: "confirm",
      label: "Booking confirmation",
      when: "immediate",
      channel: "sms",
      enabled: true,
      template: "Hi {first_name}! You're booked for the free trial on {day} at {time}. Reply YES to confirm you're coming and we'll send everything you need. 🏀",
    },
    {
      key: "day_before",
      label: "Day-before reminder",
      when: "day_before",
      channel: "sms",
      enabled: true,
      template: "Hey {first_name}! Quick reminder the free trial is tomorrow ({day}) at {time}. Still good to come?",
    },
    {
      key: "morning_of",
      label: "Morning-of reminder",
      when: "morning_of",
      channel: "sms",
      enabled: true,
      template: "Reminder: the free trial is today at {time}! Bring court shoes and water. {address} See you there!",
    },
  ],
};

export const CONFIRM_AUTOMATION_WHENS = ["immediate", "day_before", "morning_of"];

// Merge the per-academy override (clients.ghl_kpi_config.confirm_initial_automations)
// over the shipped defaults. Override may set enabled/approved and per-step
// enabled/template (matched by key); unknown keys are ignored, missing keys keep
// their default. Returns a normalized { enabled, approved, steps }.
export function getConfirmAutomations(client) {
  const cfg = (client && client.ghl_kpi_config) || {};
  const ov = cfg.confirm_initial_automations || {};
  const ovSteps = Array.isArray(ov.steps) ? ov.steps : [];
  const byKey = new Map(ovSteps.map(s => [s && s.key, s]));
  const steps = DEFAULT_CONFIRM_AUTOMATIONS.steps.map(def => {
    const o = byKey.get(def.key) || {};
    return {
      ...def,
      enabled: typeof o.enabled === "boolean" ? o.enabled : def.enabled,
      template: typeof o.template === "string" && o.template.trim() ? o.template : def.template,
    };
  });
  return {
    enabled: typeof ov.enabled === "boolean" ? ov.enabled : DEFAULT_CONFIRM_AUTOMATIONS.enabled,
    approved: ov.approved === true,
    steps,
  };
}

// Live = the sequence is on AND approved for this academy. Until then the detector
// falls back to the old AI proactive opener (backward-compatible).
export function automationsLive(autos) {
  return !!(autos && autos.enabled && autos.approved && (autos.steps || []).some(s => s.enabled));
}

// ── timing ──
// Calendar-day difference (trialDate - now) in the academy timezone. 0 = trial is
// today, 1 = tomorrow, negative = already past. Calendar-based (not 24h windows) so
// "day before" / "morning of" copy is always date-correct.
function tzDateStr(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}
function dayDiffInTz(nowMs, trialMs) {
  const a = Date.parse(tzDateStr(nowMs) + "T00:00:00Z");
  const b = Date.parse(tzDateStr(trialMs) + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

// Is this step due to fire right now, given the booked trial time?
export function stepIsDue(when, nowMs, trialMs) {
  if (!trialMs) return when === "immediate"; // no known trial: only the immediate confirm
  const diff = dayDiffInTz(nowMs, trialMs);
  if (diff < 0) return false;                // trial already passed - nothing fires
  if (when === "immediate") return true;     // fire on the first run after they're booked
  if (when === "day_before") return diff === 1;
  if (when === "morning_of") return diff === 0 && nowMs < trialMs;
  return false;
}

// Pick the next scripted step to act on: the first ENABLED step that is due now and
// has not already been handled for this contact (sentKeys). One per detector run so
// touches never bunch up; the rest fire on later runs as they come due.
export function nextDueStep(autos, { nowMs, trialMs, sentKeys }) {
  const handled = sentKeys instanceof Set ? sentKeys : new Set(sentKeys || []);
  for (const step of (autos.steps || [])) {
    if (!step.enabled) continue;
    if (handled.has(step.key)) continue;
    if (stepIsDue(step.when, nowMs, trialMs)) return step;
  }
  return null;
}

// ── rendering ──
function fmtDay(ms) {
  try { return new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }); }
  catch { return ""; }
}
function fmtTime(ms) {
  try { return new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}
function firstName(name) {
  const n = String(name || "").trim();
  if (!n) return "there";
  return n.split(/\s+/)[0];
}
// Best-effort academy address from the business_info FACT section (a free-text
// "Location: ..." line). Blank if not found — templates are written to read fine
// without it.
export function addressFromOverrides(overrides) {
  const bi = overrides && overrides.business_info;
  if (typeof bi !== "string") return "";
  const m = bi.match(/^\s*(?:location|address)\s*:\s*(.+)$/im);
  return m ? m[1].trim() : "";
}

// Fill a template's tokens and tidy whitespace. Unknown tokens render empty.
export function renderTemplate(template, ctx = {}) {
  const map = {
    first_name: firstName(ctx.name),
    day: ctx.trialMs ? fmtDay(ctx.trialMs) : "",
    time: ctx.trialMs ? fmtTime(ctx.trialMs) : "",
    address: ctx.address || "",
    athlete: ctx.athlete || "your athlete",
  };
  return String(template || "")
    .replace(/\{(\w+)\}/g, (_, k) => (k in map ? map[k] : ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}
