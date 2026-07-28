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
// {{location.name}}, {{location.website}} (with protocol, for links),
// {{location.domain}} (bare, for naming the site in prose), {{location_owner.first_name}}. Identity
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
      // {{location.domain}}, NOT {{location.website}}: this line NAMES the site rather
      // than linking it, and location.website carries the protocol, so the token that
      // looks right here sends "https://byanymeanstoronto.ca" as a standalone SMS line.
      // GTA's live copy has always read the bare domain; the master matches it.
      body: "Hey {{contact.first_name}}! Just wanted to check in and see if you are still interested in having your child train with us 👍\n\n{{location.domain}}" },
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

// 🎉 Onboarding - the WELCOME drip for a brand-new PAID member. The worker
// enrolls automation_key 'onboarding' the moment a member goes live (see
// api/automations.js). Post-conversion piece of the preset (declared as
// postConversion in api/agent/presets.js). Same dormant rule: enabled:true +
// approved:false. Academy-agnostic merge fields only.
//
// PROMOTED from 3 plain SMS to 7 steps (2026-07-27), mirroring GTA's live
// structure: the reference academy runs 6 designed emails woven through the
// first few weeks, and every academy onboarded before this seeded the weak
// 3-SMS version instead. That is obligation 1 of the canonical copy rule at the
// top of this file: a default that lags the best live copy is a bug.
//
// ⚠️ DELIBERATE DIVERGENCE FROM GTA - 7 STEPS HERE, 8 THERE. DO NOT "FIX" IT.
//
// GTA has one more email between `onboarding-era` and `onboarding-review`: the
// testimonials email (template:onboarding-testimonials). It is classed
// `attributed` in api/email-templates/sync-classes.js because it carries REAL
// BAM GTA PARENTS' QUOTES, re-attributed by {{location.city}} to whichever
// academy sends it. Promoting that step into this master is how one academy's
// real customers' words get sent as another academy's own - the exact near-miss
// this whole sync_class system was built after.
//
// So the gap is the feature. The ONLY thing that may close it is the separate
// testimonials workstream: a per-academy testimonial connection, where each
// academy's step renders ITS OWN families' quotes. Not by pasting GTA's
// template key in here, not by re-classing the template, not by "it renders
// tokenized so it's fine" (it renders fine; the WORDS are still GTA's parents').
// When that connection lands, insert the testimonials step between positions 5
// and 6 at +7 days, and see the note on step 7 below.
//
// Academy-specific facts GTA's live version carries in these bodies (WhatsApp
// invite, coach socials, general Instagram, coach phone, gym address, the
// literal weekly schedule) are OWNER-PROVIDED and are deliberately NOT here.
// They are collected per academy and filled in the portal. Copying GTA's text
// would send GTA's phone number and Oakville gym address from every academy.
export const ONBOARDING_DEFAULT = {
  name: "🎉 Onboarding",
  enabled: true,
  approved: false,
  steps: [
    // 1. Instant SMS. Sets the expectation that the real detail is in the email
    //    landing beside it. {{location.name}} resolves to the SENDING academy at
    //    send time - never a literal academy name (GTA's live copy says "By Any
    //    Means Basketball" here; that is exactly the literal a token replaces).
    { position: 0, wait_amount: 0, wait_unit: "minutes", channel: "sms", subject: null,
      body: "Hi {{contact.first_name}}, welcome to {{location.name}}! We're pumped to have you.\n\nMore information is on its way to your email, so check that out when you can.\n\nIf you need anything at all, just reply here - this line reaches the coaches directly." },

    // 2. The welcome email, sent alongside the SMS above.
    { position: 1, wait_amount: 0, wait_unit: "minutes", channel: "email",
      subject: "Welcome to {{location.name}}",
      body: "template:onboarding-welcome" },

    // 3. The weekly schedule SMS. sync_class 'local' is LOAD-BEARING, not
    //    decoration: it makes stepEnabled() (api/agent/seed-automations.js) seed
    //    this step OFF in every academy.
    //
    //    GTA's live version of this step is its hand-typed training times and
    //    the 1079 Linbrook Rd gym address. Copying that text into the master
    //    would text GTA's schedule and Oakville address to members of every
    //    other academy, so it is NOT here - the body below is a placeholder that
    //    names the shape of the message and nothing else.
    //
    //    Kept-and-disabled rather than omitted, on purpose. Omitting it would
    //    leave the master silently 6 steps against GTA's 8, and the next reader
    //    comparing the two would close the gap the fast way: by pasting GTA's
    //    text. A visible, switched-off slot is a standing instruction instead.
    //    Nothing can send from it until an academy writes its own schedule and
    //    turns it on.
    //
    //    Generating this from schedule_slots (every session is already real data
    //    in the system) is the proper fix and is a separate build.
    { position: 2, wait_amount: 5, wait_unit: "minutes", channel: "sms", subject: null,
      sync_class: "local",
      body: "SCHEDULE:\n\n[Add this academy's weekly training days and times here, then switch this step on.]\n\nLOCATION: [Add the training venue address here.]" },

    // 4. How to get the most out of training.
    { position: 3, wait_amount: 5, wait_unit: "minutes", channel: "email",
      subject: "How to get the most out of training",
      body: "template:onboarding-training" },

    // 5. The origin story (= the Lead Nurture "global ecosystem" design with the
    //    free-trial CTA stripped). Subject is deliberately brand-free: not every
    //    academy on this preset is a By Any Means academy.
    { position: 4, wait_amount: 3, wait_unit: "days", channel: "email",
      subject: "Where it all started",
      body: "template:onboarding-story" },

    // 6. A new era of training (= stripFreeTrial(nurture-2)).
    { position: 5, wait_amount: 7, wait_unit: "days", channel: "email",
      subject: "A new era of training",
      body: "template:onboarding-era" },

    // 7. The review ask. +14 days, NOT the +7 GTA uses, and that is deliberate.
    //    In GTA this step is +7 days after the TESTIMONIALS step, which is
    //    itself +7 days after era, so the ask reaches a parent about 24 days
    //    after joining. The testimonials step is absent here (see the divergence
    //    note above), so a +7 would land the ask a full week earlier in a
    //    member's life than the version we know works. +14 preserves the timing
    //    a parent actually experiences.
    //    WHEN THE TESTIMONIALS STEP IS INSERTED between 6 and 7: that step takes
    //    the +7, and this one goes back to +7.
    { position: 6, wait_amount: 14, wait_unit: "days", channel: "email",
      subject: "Quick favour?",
      body: "template:onboarding-review" },
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
