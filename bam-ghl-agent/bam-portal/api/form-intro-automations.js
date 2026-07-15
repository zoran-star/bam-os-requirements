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
// rows in `automations` + `automation_steps`. The shipped DEFAULTS below are the
// source of truth for the seed copy/delay/channel; the academy then edits the step
// in the portal (Train -> 📝 Contact Form / 🏀 Trial Form). Mirrors the
// confirm-automations.js style (shipped defaults + per-academy override-by-edit).
//
// DORMANT by default - seeds enabled:true but approved:false, so NOTHING sends until
// the academy approves it AND clients.ghl_kpi_config.portal_entry_routing.enabled is
// on. The engine fails closed (enabled + approved + >= 1 enabled step + enrolled).
//
// HARD RULE: never an em dash (U+2014) in any template - person-facing copy. Hyphens
// only. The shipped copy below uses none; keep it verbatim.
//
// Tokens that resolve at SEND time via api/email-shells.js resolveMergeVars (called
// from api/_send.js for SMS): {{contact.first_name}} and {{location.website}}.

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
"Hi {{contact.first_name}},\n\nIt's the coach from {{location.name}}. Just saw you filled in the form for extra info, is there anything I can help with?",
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
"Hi {{contact.first_name}}, it's the coach from {{location.name}}.\n\nI saw you filled in the form to book a trial but didn't select a time. Do you need anything from me to help you book a trial?\n\nHere's the link to the calendar again: {{location.website}}/free-trial",
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
// gets no reply (the engine advances form_intro -> ghosted -> nurture). Academy-
// agnostic copy (merge fields only) so it clones cleanly; the academy edits it in
// the portal after seeding. Same dormant rule: enabled:true + approved:false, so
// nothing sends until approved. HARD RULE: no em dash (U+2014) - hyphens only.
export const GHOSTED_DEFAULT = {
  name: "👻 Ghosted",
  enabled: true,
  approved: false,
  steps: [
    { position: 0, wait_amount: 1, wait_unit: "days", channel: "sms", subject: null,
      body: "Hi {{contact.first_name}}, still keen to get your athlete training with us? Happy to help you grab a free trial spot: {{location.website}}/free-trial" },
    { position: 1, wait_amount: 1, wait_unit: "days", channel: "sms", subject: null,
      body: "Hey {{contact.first_name}}, just checking in - want me to hold a trial spot for you? Here's the calendar: {{location.website}}/free-trial" },
    { position: 2, wait_amount: 1, wait_unit: "days", channel: "sms", subject: null,
      body: "Last nudge {{contact.first_name}} - the free trial is a no-pressure way to see if it's a fit. Here whenever you're ready: {{location.website}}/free-trial" },
  ],
};

// 💔 Lead Nurture - the LONG game. When Ghosted runs out, the worker enrolls the
// lead into automation_key 'nurture' (api/automations.js) and if the nurture
// sequence ALSO runs dry the lead goes terminal LOST. Until now this automation
// was never in the seed set, so on a fresh academy ghosted-exhausted leads were
// marked lost with zero long-game touches - THE missing station engine. Same
// dormant rule: enabled:true + approved:false so nothing sends until approved.
// Academy-agnostic copy (merge fields only). HARD RULE: no em dash - hyphens only.
export const NURTURE_DEFAULT = {
  name: "💔 Lead Nurture",
  enabled: true,
  approved: false,
  steps: [
    { position: 0, wait_amount: 7, wait_unit: "days", channel: "sms", subject: null,
      body: "Hi {{contact.first_name}}, checking in from {{location.name}} - no pressure at all. If the timing works down the road, a free trial spot is always open: {{location.website}}/free-trial" },
    { position: 1, wait_amount: 14, wait_unit: "days", channel: "sms", subject: null,
      body: "Hey {{contact.first_name}}, hope training is going well. If you ever want to see how we run things, come grab a free session: {{location.website}}/free-trial" },
    { position: 2, wait_amount: 21, wait_unit: "days", channel: "sms", subject: null,
      body: "Hi {{contact.first_name}}, last check-in from me - the door is always open whenever you're ready: {{location.website}}/free-trial" },
  ],
};

// 🎉 Onboarding - the WELCOME drip for a brand-new paid member. The worker
// enrolls automation_key 'onboarding' the moment a member goes live (see
// api/automations.js), but until now it was never in the seed set - new
// academies' first members got silence. Post-conversion piece of the preset
// (declared as postConversion in api/agent/presets.js). Same dormant rule:
// enabled:true + approved:false so nothing sends until the owner approves and
// edits the copy. Academy-agnostic merge fields only. HARD RULE: no em dash.
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
