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
"Hi {{contact.first_name}},\n\nIt's coach from By Any Means Basketball. Just saw you filled in the form for extra info, is there anything I can help with?",
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
"Hi {{contact.first_name}}, it's coach from By Any Means GTA.\n\nI saw you filled in the form to book a trial but didn't select a time. Do you need anything from me to help you book a trial?\n\nHere's the link to the calendar again: {{location.website}}/free-trial",
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
