// Annotation rules for BAM GTA, the classification Zoran worked through on 27 Jul 2026.
// Consumed by scripts/render-messages.mjs --annotate. Each email declares a BASE verdict
// covering all of its text, and rules override specific runs, so nothing is left unmarked.
//
//   p = photocopy   travels untouched
//   s = swap        travels once we collect the fact
//   c = custom      this academy's own, authored per academy
//
// Keyed by template key (nurture-1) or by "<automation_key>-<position>" (ghosted-3).

const R = (re, st, note, proposal) => ({ re, st, note, proposal });

// The frame, same verdict everywhere (Zoran, 27 Jul): top left is ALWAYS the
// logo, top right is ALWAYS just the academy's main city or town.
const FRAME = [
  R(/BY ANY MEANS/g, "p", "The logo, top left and bottom left. Leave GTA and San Jose as they are."),
  R(/OAKVILLE · GTA|OAKVILLE/g, "s", "Top right should be just the academy's main city or town."),
  R(/\bGTA\b/g, "s", "Part of the wordmark. Becomes the academy's own, from the logo."),
  R(/Youth and high-school basketball training in Oakville and across the GTA\./g, "s", "Footer tagline. Not collected for ANY academy, so everyone else's footer drops it."),
  R(/byanymeanstoronto\.ca/g, "s", "Footer links. Fill from the academy's own domain."),
  R(/BAM GTA/g, "s", "The internal label reaching a parent. Should be the parent-facing name."),
  R(/By Any Means Basketball/g, "p", "Global brand name. Every academy is a By Any Means academy."),
];

const SPEC = {
  "ghosted-3": {
    base: ["p", "Generic outreach copy. Works for any academy."],
    rules: [...FRAME,
      R(/coach Zoran from/g, "c", "REMOVE the owner name. The templated version reads \"It's coach from <academy>\"."),
    ],
  },
  "nurture-1": {
    base: ["c", "FULLY CUSTOM, the entire email including the frame. Designed per academy during onboarding. San Jose starts with GTA's version."],
    rules: [],
  },
  "nurture-2": {
    base: ["c", "FULLY CUSTOM, the entire email including the frame. Designed per academy during onboarding. San Jose starts with GTA's version."],
    rules: [],
  },
  "nurture-3": {
    base: ["s", "Stays templated for now. The whole email gets wired to the academy's own connected testimonials in a separate build."],
    rules: [...FRAME,
      R(/Parent of [A-Z][a-z]+/g, "s", "Attribution fills from that academy's own connected testimonials once the connection is built."),
      R(/"[^"]{25,}"/g, "s", "Quote fills from that academy's own connected testimonials. Templated until then."),
    ],
  },
  "nurture-4": {
    base: ["p", "Good as-is. Travels untouched."],
    rules: FRAME,
  },
  "onboarding-welcome": {
    base: ["p", "Generic welcome copy and structure. Travels."],
    // WHOLE LINE custom: the entire paragraph goes, not just the phrase in it.
    lineRules: [
      R(/WhatsApp/i, "s", "The whole line fills from the academy's own community group. Store the link plus its platform label so it reads Join the WhatsApp group, Join the Facebook group, and so on. No link on file means the whole line does not render."),
      R(/online programs/i, "c", "FULLY CUSTOM, the entire line. Most academies will not have online programs."),
      R(/Bring a friend|free month|merch/i, "c", "FULLY CUSTOM, the entire line. The referral perk and the merch shop are GTA's own."),
      R(/Follow along|Coach (?:Zoran|Adrian)/i, "s", "The whole line fills from coach socials. Onboarding must warn the client that anything they enter here is shown publicly."),
    ],
    rules: [...FRAME,
      R(/\(289\) 816-6569/g, "s", "Fills from the academy's own business number."),
      R(/1079 Linbrook Rd[^<]*/g, "s", "Fills from the session's location, NOT the business address."),
      R(/MONDAYS|TUESDAYS|WEDNESDAYS|THURSDAYS|SATURDAYS|Younger|Older|Weekly Schedule|LOCATION|Location/g, "s", "Generates from the 86 real sessions already in the system."),
    ],
  },
  "onboarding-training": {
    base: ["c", "FULLY CUSTOM, the entire email including the frame. Designed per academy. Keep GTA's and San Jose's as they are."],
    rules: [],
  },
  "onboarding-story": {
    base: ["c", "FULLY CUSTOM, the entire email including the frame. Same design as the global-ecosystem email, so the same call."],
    rules: [],
  },
  "onboarding-era": {
    base: ["c", "FULLY CUSTOM, the entire email including the frame. Designed per academy during onboarding."],
    rules: [],
  },
  "onboarding-testimonials": {
    base: ["s", "Stays templated for now. Gets wired to the academy's own connected testimonials in a separate build."],
    rules: [...FRAME,
      R(/Parent of [A-Z][a-z]+/g, "s", "Attribution fills from connected testimonials."),
      R(/"[^"]{25,}"/g, "s", "Quote fills from connected testimonials."),
    ],
  },
  "onboarding-review": {
    base: ["p", "Generic review ask. Travels."],
    rules: [...FRAME,
      R(/Leave a Google review|Google review/g, "s", "The button has nowhere to point without a review link on file."),
    ],
  },
};

export const SPEC_BY_KEY = SPEC;
export default SPEC;
