// Per-form INTRO automations - the first-touch sequence a lead gets the moment they
// fill the Contact form or the Free-Trial form (and portal routing is ON), plus the
// no-show first-touch fired from the post-trial review. Three keys:
//
//   contact_form - general enquiry: wait 2 min, then one SMS asking if they need help.
//   trial_form   - trial form filled but NO time picked: wait 20 min, then one SMS
//                  nudging them back to the calendar.
//   missed_trial - athlete no-showed their trial: wait 30 min, then one SMS offering
//                  to rebook. Enrolled from api/ghl/post-trial.js when the trainer
//                  marks "did not attend". Its completion rolls into 👻 Ghosted (the
//                  same roll-forward as contact_form / trial_form), so the chain is:
//                  no-show -> missed_trial first-touch -> Ghosted -> Nurture.
//
// These run on the SAME engine as 👻 Ghosted / 💔 Lead Nurture (api/automations.js):
// rows in `automations` + `automation_steps`.
//
// ⭐ CANONICAL COPY RULE (2026-07-25) - the defaults below ARE the single source of
// proven copy for every academy's seed. They are GTA's live, battle-tested copy with
// every academy literal replaced by a merge token. Two obligations follow:
//   1. When an academy edits its copy in the portal and the edit is GENERALLY good
//      (not an academy-specific fact), PROMOTE it back into these defaults so every
//      future academy seeds the improvement. Defaults that lag the best live copy
//      are a bug (that is exactly how San Jose nearly seeded weak copy, 2026-07-25).
//   2. NEVER put an academy-specific literal here (name, domain, owner, city, phone,
//      socials, schedule, address). Academy specifics are runtime facts resolved at
//      send time via merge tokens - see api/email-shells.js resolveMergeVars.
// Drift is caught by scripts/check-automation-divergence.mjs (run it in onboarding
// QA). Full rule: docs/automation-canonical-defaults.md.
//
// Merge tokens used (resolve at SEND time via api/email-shells.js resolveMergeVars,
// called from api/_send.js): {{contact.first_name}}, {{contact.fullName}},
// {{location.name}}, {{location.website}}, {{location_owner.first_name}}. Identity
// tokens fail to EMPTY for an academy with no value on file (the website link line
// drops from the message) - they never fall back to another academy's identity.
//
// DORMANT by default - seeds enabled:true but approved:false, so NOTHING sends until
// the academy approves it AND clients.ghl_kpi_config.portal_entry_routing.enabled is
// on. The engine fails closed (enabled + approved + >= 1 enabled step + enrolled).
//
// HARD RULE: never an em dash (U+2014) in any template - person-facing copy. Hyphens
// only. The shipped copy below uses none; keep it verbatim.

export const FORM_INTRO_KEYS = ["contact_form", "trial_form", "missed_trial"];

export const FORM_INTRO_DEFAULTS = {
  contact_form: {
    name: "📝 Contact Form intro",
    enabled: true,
    approved: false, // approve once per academy before anything can send
    step: {
      position: 0,
      wait_amount: 2,
      wait_unit: "minutes",
      channel: "sms",
      subject: null,
      body:
"Hi {{contact.first_name}},\n\nIt's coach from {{location.name}}. Just saw you filled in the form for extra info, is there anything I can help with?",
    },
  },
  trial_form: {
    name: "🏀 Trial Form intro",
    enabled: true,
    approved: false, // approve once per academy before anything can send
    step: {
      position: 0,
      wait_amount: 20,
      wait_unit: "minutes",
      channel: "sms",
      subject: null,
      body:
"Hi {{contact.first_name}}, it's coach from {{location.name}}.\n\nI saw you filled in the form to book a trial but didn't select a time. Do you need anything from me to help you book a trial?\n\nHere's the link to the calendar again: {{location.website}}/free-trial",
    },
  },
  missed_trial: {
    name: "📵 Missed Trial intro",
    enabled: true,
    approved: false, // approve once per academy before anything can send
    step: {
      position: 0,
      wait_amount: 30,
      wait_unit: "minutes",
      channel: "sms",
      subject: null,
      body:
"Hi {{contact.first_name}}, sorry we missed you at your trial - want to grab another time? Here's the calendar: {{location.website}}/free-trial",
    },
  },
};

// 👻 Ghosted - the multi-step drip a lead rolls into when a form-intro first-touch
// gets no reply (the engine advances form_intro -> ghosted -> nurture). GTA's proven
// sequence: two SMS nudges, then a personal EMAIL from the owner (step 3 switching
// channel is deliberate - a fresh channel revives leads the SMS thread lost). Same
// dormant rule: enabled:true + approved:false, so nothing sends until approved.
// HARD RULE: no em dash (U+2014) - hyphens only.
export const GHOSTED_DEFAULT = {
  name: "👻 Ghosted",
  enabled: true,
  approved: false,
  steps: [
    { position: 0, wait_amount: 1, wait_unit: "days", channel: "sms", subject: null,
      body: "Hey {{contact.first_name}}! Just wanted to check in and see if you are still interested in having your child train with us 👍\n\n{{location.website}}" },
    { position: 1, wait_amount: 1, wait_unit: "days", channel: "sms", subject: null,
      body: "Hi {{contact.fullName}}\n\nJust wanted to see if my last message went through. We can get you in the gym for a free trial, here's the link: {{location.website}}/free-trial\n\nThank you! 🙏" },
    { position: 2, wait_amount: 1, wait_unit: "days", channel: "email", subject: "Try a session free",
      body: "Hi {{contact.first_name}},\n\nIt's coach {{location_owner.first_name}} from {{location.name}} - I just wanted to reach out over email to check and see if you would be interested in coming out to a free trial.\n\nIf so, feel free to book in using this link:\n\n{{location.website}}/free-trial\n\nThanks!" },
  ],
};

// 💔 Lead Nurture - the LONG game. When Ghosted runs out, the worker enrolls the
// lead into automation_key 'nurture' (api/automations.js) and if the nurture
// sequence ALSO runs dry the lead goes terminal LOST. GTA's proven sequence: the
// four DESIGNED brand emails (api/email-templates/nurture-emails.js, addressed as
// template:<key> so the DB holds a tiny ref) spread over ~8 weeks. The templates
// are tokenized - each render carries the sending academy's own identity. Same
// dormant rule: enabled:true + approved:false so nothing sends until approved.
export const NURTURE_DEFAULT = {
  name: "💔 Lead Nurture",
  enabled: true,
  approved: false,
  steps: [
    { position: 0, wait_amount: 1, wait_unit: "weeks", channel: "email", subject: "A global basketball ecosystem",
      body: "template:nurture-1" },
    { position: 1, wait_amount: 1, wait_unit: "weeks", channel: "email", subject: "A new era of training",
      body: "template:nurture-2" },
    { position: 2, wait_amount: 3, wait_unit: "weeks", channel: "email", subject: "What families are saying",
      body: "template:nurture-3" },
    { position: 3, wait_amount: 3, wait_unit: "weeks", channel: "email", subject: "Don't miss your shot",
      body: "template:nurture-4" },
  ],
};

// 🎉 Onboarding - the WELCOME drip for a brand-new paid member. The worker
// enrolls automation_key 'onboarding' the moment a member goes live (see
// api/automations.js). Post-conversion piece of the preset (declared as
// postConversion in api/agent/presets.js). DELIBERATELY skeletal: GTA's live
// onboarding is packed with academy-only facts (WhatsApp invite, socials, coach
// phone, weekly schedule, gym address) - those are OWNER-PROVIDED specifics the
// academy fills in the portal after seeding, never default literals. Same dormant
// rule: enabled:true + approved:false. Academy-agnostic merge fields only.
export const ONBOARDING_DEFAULT = {
  name: "🎉 Onboarding",
  enabled: true,
  approved: false,
  steps: [
    { position: 0, wait_amount: 2, wait_unit: "minutes", channel: "sms", subject: null,
      body: "Welcome to {{location.name}}, {{contact.first_name}}! We're pumped to have you. If anything comes up before the first session, text back here - this line reaches us directly." },
    { position: 1, wait_amount: 2, wait_unit: "days", channel: "sms", subject: null,
      body: "Hi {{contact.first_name}}, how are the first sessions feeling? Anything we can do better, tell us right here - we read every message." },
    { position: 2, wait_amount: 5, wait_unit: "days", channel: "sms", subject: null,
      body: "Hey {{contact.first_name}}, one week in with {{location.name}} - great to have you in the group. Consistency is where the growth is; see you at the next session!" },
  ],
};

// The full canonical registry, keyed by automation_key - the ONE map every seeder
// and the divergence checker read, so they can never disagree on what "canonical"
// means. Step shape is normalized by canonicalSteps().
export const CANONICAL_DEFAULTS = {
  ...FORM_INTRO_DEFAULTS,
  ghosted: GHOSTED_DEFAULT,
  nurture: NURTURE_DEFAULT,
  onboarding: ONBOARDING_DEFAULT,
};

// A default's steps as a plain array (form intros declare a single `step`).
export function canonicalSteps(def) {
  return (def && (def.steps || (def.step ? [def.step] : []))) || [];
}
