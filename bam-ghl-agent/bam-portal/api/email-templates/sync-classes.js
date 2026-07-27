// SYNC CLASS declarations for the vendored designed emails (nurture-emails.js +
// onboarding-emails.js, addressed from an automation_steps body as
// "template:<key>").
//
// WHY THIS FILE EXISTS
// Academies share one preset of automated messages. Some of that content is
// generic brand copy and SHOULD land in every academy. Some of it must never
// travel: real parent testimonials, re-attributed by {{location.city}} to
// whichever academy sends them. A near-miss shipped one academy's real parent
// quotes to a different academy under that academy's city line. The weekly
// drift checker that would have caught a mis-marking was cancelled in favour of
// this structural control, so THIS DECLARATION IS THE ONLY THING STANDING
// BETWEEN A PRESET COPY AND THAT BUG. There is no safety net behind it.
//
// THE THREE CLASSES (strictest first)
//   attributed  carries a real person's words tied to a real place/person.
//               NEVER copy to another academy under any circumstance.
//   local       academy-specific literals (that academy's phone, WhatsApp,
//               review link, hardcoded city/wordmark). Copying it would send
//               one academy's details from another. Do not copy.
//   shared      generic/tokenized brand copy. Safe to copy everywhere.
//
// This is a SEPARATE file on purpose: nurture-emails.js carries a "GENERATED -
// do not hand-edit" banner, so a per-template field inside it would be wiped by
// the next generator run. Declarations live here, by key, by hand.
//
// ADDING A TEMPLATE: declare it here in the same commit. An UNDECLARED key does
// not quietly become `shared` - it resolves to the STRICTEST class (see
// UNDECLARED_TEMPLATE_SYNC_CLASS), so forgetting this file blocks a copy rather
// than leaking one. api/_sync-class.test.mjs fails if any live template key is
// missing from this map.

// Rank = strictness. Higher wins in every comparison (see strictest() in
// api/_sync-class.js). Do not reorder without changing that resolver.
export const SYNC_CLASS_RANK = Object.freeze({
  shared: 0,
  local: 1,
  attributed: 2,
});

export const SYNC_CLASSES = Object.freeze(Object.keys(SYNC_CLASS_RANK));

// The column default and the class of a step that declares nothing.
export const DEFAULT_SYNC_CLASS = "shared";

// FAIL CLOSED. A body that references a template we cannot classify (typo,
// newly generated key, template deleted) is treated as the strictest class.
// A wrong "shared" here is the exact bug this system exists to prevent; a
// wrong "attributed" only blocks a copy someone can then unblock by declaring
// the key.
export const UNDECLARED_TEMPLATE_SYNC_CLASS = "attributed";

// Every key in TEMPLATES (nurture-emails.js) + ONBOARDING_TEMPLATES
// (onboarding-emails.js). Verified against the live exports by the test.
export const TEMPLATE_SYNC_CLASS = Object.freeze({
  // ── Lead nurture ────────────────────────────────────────────────────────
  // Global brand story / method / scarcity. Fully tokenized, no real person's
  // words, no academy literals.
  "nurture-1": "shared",
  "nurture-2": "shared",
  "nurture-4": "shared",
  // REAL PARENT + ATHLETE QUOTES ("Parent of Adam, {{location.city}}"). The
  // quotes are real and were given to ONE academy; {{location.city}} silently
  // re-attributes them to whichever academy sends. Never copy.
  "nurture-3": "attributed",

  // ── Onboarding welcome sequence ─────────────────────────────────────────
  // These three are written around ONE academy: hardcoded "BY ANY MEANS GTA" /
  // "OAKVILLE · GTA" header, that academy's WhatsApp invite, coach phone
  // number, online-programs URL and Google review link. Not testimonials, but
  // copying them would send GTA's phone number from another academy.
  "onboarding-welcome": "local",
  "onboarding-training": "local",
  "onboarding-review": "local",
  // Onboarding copies of the nurture designs (free-trial CTA stripped). Same
  // content, so the same class as their source.
  "onboarding-story": "shared",
  "onboarding-era": "shared",
  "onboarding-testimonials": "attributed", // stripFreeTrial(nurture-3) - same real quotes
});

// The declared class of a template key, or the fail-closed class for a key we
// do not know about.
export function syncClassForTemplate(key) {
  const k = String(key || "").trim();
  return TEMPLATE_SYNC_CLASS[k] || UNDECLARED_TEMPLATE_SYNC_CLASS;
}
