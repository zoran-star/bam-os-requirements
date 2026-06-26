// Confirm agent — the INITIAL AUTOMATIONS (scripted first-touch sequence).
//
// When a lead lands in the "Scheduled Trial" stage (the booking agent just booked
// them), a short SCRIPTED sequence goes out to make sure they show up:
//
//   1. immediate   → booking confirmation (SMS + a confirmation EMAIL, same text):
//                    details, "bring a basketball", and add-to-calendar links.
//   2. morning_of  → same-day check-in ("good to go for today?").
//
// PORTAL-NATIVE (no GHL tokens): we resolve the appointment date/time/location and
// generate the calendar links OURSELVES, so this works without GHL doing any merge.
// The lead's {{contact.first_name}} is resolved downstream by the send engine
// (api/_send.js). The moment the lead REPLIES, the AI confirm agent takes over.
//
// Send mode reuses confirm_agent_mode (via shouldAutoSend in _mode.js):
//   hawkeye    → each touch QUEUES for a one-tap ✓ approval (sends SMS + email).
//   self_drive → it auto-fires (currently held by the global self-drive kill-switch).
//
// HARD RULE: never an em dash in any template (person-facing copy). Hyphens only.

const TZ = "America/Toronto";
const PORTAL_BASE = process.env.PORTAL_BASE_URL || "https://portal.byanymeansbusiness.com";

// The shipped defaults (BAM GTA copy). Per-academy overrides live in
// clients.ghl_kpi_config.confirm_initial_automations (enabled + per-step copy only;
// timing/channel/email are fixed here). Tokens it resolves itself:
//   {{appointment.start_time}}            "Tue, Jun 30 at 7:00 PM"
//   {{appointment.only_start_time}}       "7:00 PM"
//   {{appointment.only_start_date}}       "Tuesday, June 30, 2026"
//   {{appointment.meeting_location}}      academy address
//   {{appointment.add_to_google_calendar}} Google Calendar URL we build
//   {{appointment.add_to_ical_outlook}}   /api/ical link we host (.ics)
// {{contact.first_name}} is left for the send engine to fill.
export const DEFAULT_CONFIRM_AUTOMATIONS = {
  enabled: true,
  approved: false,   // must be approved once per academy before anything sends
  steps: [
    {
      key: "confirm",
      label: "Booking confirmation",
      when: "immediate",
      channel: "sms",
      email: true,
      email_subject: "Your free trial is booked! 🏀",
      enabled: true,
      template:
"Your free trial is booked! Here are some important details:\n\n" +
"Date & Time: {{appointment.start_time}}\n\n" +
"Location: {{appointment.meeting_location}}\n\n" +
"Please bring a basketball if you have one. Prepare to be challenged, so come ready to work! After the trial, we'll chat to see if the program feels like a fit and talk next steps 👍\n\n" +
"You can add this to your calendar here:\n\n" +
"Apple: {{appointment.add_to_ical_outlook}}\n\n" +
"Google: {{appointment.add_to_google_calendar}}",
    },
    {
      key: "same_day",
      label: "Same-day check-in",
      when: "morning_of",
      channel: "sms",
      email: false,
      enabled: true,
      template:
"Hi {{contact.first_name}}, just wanted to check in to see if we're good to go for your trial today.\n\n" +
"Looking forward to seeing you, after the session we will chat to see if the program is a good fit 👍\n\n" +
"Here are the details:\n\n" +
"Time: {{appointment.only_start_time}}\n\n" +
"Date: {{appointment.only_start_date}}\n\n" +
"Location: {{appointment.meeting_location}}\n\n" +
"F.Y.I the gym entrance we use is at the front of the building, on the left side.",
    },
  ],
};

export const CONFIRM_AUTOMATION_WHENS = ["immediate", "day_before", "morning_of"];

// Merge the per-academy override over the shipped defaults. Override may set
// enabled/approved and per-step enabled/template (by key); fixed fields (when,
// channel, email, email_subject, label) always come from the defaults.
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
function tzDateStr(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}
function dayDiffInTz(nowMs, trialMs) {
  const a = Date.parse(tzDateStr(nowMs) + "T00:00:00Z");
  const b = Date.parse(tzDateStr(trialMs) + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}
export function stepIsDue(when, nowMs, trialMs) {
  if (!trialMs) return when === "immediate";
  const diff = dayDiffInTz(nowMs, trialMs);
  if (diff < 0) return false;
  if (when === "immediate") return true;
  if (when === "day_before") return diff === 1;
  if (when === "morning_of") return diff === 0 && nowMs < trialMs;
  return false;
}
export function nextDueStep(autos, { nowMs, trialMs, sentKeys }) {
  const handled = sentKeys instanceof Set ? sentKeys : new Set(sentKeys || []);
  for (const step of (autos.steps || [])) {
    if (!step.enabled) continue;
    if (handled.has(step.key)) continue;
    if (stepIsDue(step.when, nowMs, trialMs)) return step;
  }
  return null;
}

// ── appointment token rendering (portal-native) ──
function fmtFull(ms) {
  try {
    const d = new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
    const t = new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
    return `${d} at ${t}`;
  } catch { return ""; }
}
function fmtTime(ms) {
  try { return new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}
function fmtDate(ms) {
  try { return new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}
function dtUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
export function buildGoogleCalUrl({ startMs, endMs, title, location }) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: title || "Free Trial",
    dates: `${dtUtc(startMs)}/${dtUtc(endMs || startMs + 3600000)}`,
    details: "Your free trial session.",
  });
  if (location) p.set("location", location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
export function buildIcalUrl({ startMs, endMs, title, location }) {
  const p = new URLSearchParams({ start: String(startMs), end: String(endMs || startMs + 3600000), title: title || "Free Trial" });
  if (location) p.set("location", location);
  return `${PORTAL_BASE}/api/ical?${p.toString()}`;
}

// Replace the {{appointment.*}} tokens with values WE resolve. Leaves
// {{contact.*}} / {{location.*}} for the send engine. ctx: { startMs, endMs,
// location, title }.
export function resolveApptTokens(template, ctx = {}) {
  const cal = { startMs: ctx.startMs, endMs: ctx.endMs, title: ctx.title || "Free Trial", location: ctx.location || "" };
  const map = {
    "appointment.start_time": ctx.startMs ? fmtFull(ctx.startMs) : "",
    "appointment.only_start_time": ctx.startMs ? fmtTime(ctx.startMs) : "",
    "appointment.only_start_date": ctx.startMs ? fmtDate(ctx.startMs) : "",
    "appointment.meeting_location": ctx.location || "",
    "appointment.add_to_google_calendar": ctx.startMs ? buildGoogleCalUrl(cal) : "",
    "appointment.add_to_ical_outlook": ctx.startMs ? buildIcalUrl(cal) : "",
  };
  return String(template || "").replace(/\{\{\s*(appointment\.\w+)\s*\}\}/g, (_, k) => (k in map ? map[k] : ""));
}

// Best-effort academy address from the business_info FACT section ("Location:" line),
// used when the GHL appointment has no address of its own.
export function addressFromOverrides(overrides) {
  const bi = overrides && overrides.business_info;
  if (typeof bi !== "string") return "";
  const m = bi.match(/^\s*(?:location|address)\s*:\s*(.+)$/im);
  return m ? m[1].trim() : "";
}
