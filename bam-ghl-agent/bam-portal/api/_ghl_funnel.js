// Canonical acquisition funnel + deterministic GHL stage mapping.
//
// Stage semantics confirmed for BAM GTA (Zoran, 2026-06-06) — and the same
// pattern recurs across most academies, so we map by stage-name keywords rather
// than guessing each time:
//   "Interested"      = lead submitted their info (GHL form)        -> Lead
//   "Responded"       = lead actually replied / got back in touch   -> Contacted
//   "Scheduled Trial" = lead booked a trial                         -> Booked
//   "Done Trial"      = lead showed up to AND finished the trial    -> Showed
// then Won (became a member) / Lost (ghosted, no-show, not interested).
//
// GHL automations shuffle leads between stages (response, ghosting, no-show,
// where they get lost) — that movement is what these stages capture.

export const CANONICAL_FUNNEL = [
  { step: "Lead",      desc: 'Submitted their info — usually a GHL form (GTA: "Interested").' },
  { step: "Contacted", desc: 'Actually replied / got back in touch (GTA: "Responded").' },
  { step: "Booked",    desc: 'Scheduled a trial or appointment (GTA: "Scheduled Trial").' },
  { step: "Showed",    desc: 'Showed up to and finished the trial (GTA: "Done Trial").' },
  { step: "Trial",     desc: 'In an active trial period, if tracked separately from "done trial".' },
  { step: "Won",       desc: "Became a paying member / enrolled." },
  { step: "Lost",      desc: "Dropped out — ghosted, no-showed, or not interested." },
];

// Ordered: more specific / terminal states first so e.g. "no-show" → Lost
// (not Showed) and "scheduled trial" → Booked (not the generic Trial rule).
const RULES = [
  { canonical: "Lost",      re: /lost|dead|ghost|no[\s-]?show|not interested|disqualif|unqualif|closed[\s-]?lost|cancel|churn/i },
  { canonical: "Won",       re: /\bwon\b|member|enroll|closed[\s-]?won|paying|joined|active client/i },
  { canonical: "Showed",    re: /done trial|completed trial|trial (?:done|complete)|attended|showed up|\bshowed\b|\bshow\b/i },
  { canonical: "Booked",    re: /schedul|booked|appointment|trial (?:booked|set)|set trial/i },
  { canonical: "Trial",     re: /trial/i },
  { canonical: "Contacted", re: /responded|contacted|engaged|replied|in touch|nurtur|follow[\s-]?up|reached/i },
  { canonical: "Lead",      re: /interested|new lead|fresh lead|form|inquir|enquir|opt[\s-]?in|sign[\s-]?up|prospect|new inquiry/i },
];

export function mapStageName(name) {
  const n = (name || "").trim();
  if (!n) return null;
  for (const r of RULES) if (r.re.test(n)) return r.canonical;
  return null;
}

// Recommend KPIs based only on the funnel steps actually present, and explain
// which can't be computed (and why) for steps that are missing.
export function buildKpis(present) {
  const has = (s) => present.includes(s);
  const kpis = [], hidden = [];

  if (has("Lead")) kpis.push({ id: "leads", label: "Leads", formula: "# entering the Lead stage (form fills)", why: "Top of funnel — how many new people came in.", recommended: true });
  if (has("Lead") && has("Contacted")) kpis.push({ id: "response_rate", label: "Response rate", formula: "Responded ÷ Interested", why: "Are leads actually engaging back, or going cold right away?", recommended: true });
  if (has("Booked") && (has("Contacted") || has("Lead"))) kpis.push({ id: "booking_rate", label: "Trial booking rate", formula: `Scheduled Trial ÷ ${has("Contacted") ? "Responded" : "Interested"}`, why: "Of engaged leads, how many actually schedule a trial.", recommended: true });
  if (has("Booked") && has("Showed")) kpis.push({ id: "show_rate", label: "Trial show rate", formula: "Done Trial ÷ Scheduled Trial", why: "Do booked leads actually show up and finish? Usually the biggest drop-off.", recommended: true });
  if (has("Showed") && has("Won")) kpis.push({ id: "close_rate", label: "Trial → member rate", formula: "Members ÷ Done Trial", why: "Of those who finish the trial, how many become paying members.", recommended: true });
  if (has("Lead") && has("Won")) kpis.push({ id: "overall_conv", label: "Overall conversion", formula: "Members ÷ Interested", why: "The whole funnel in one number — lead to paying member.", recommended: true });
  if (has("Lost")) kpis.push({ id: "loss_by_stage", label: "Where leads drop off", formula: "Lost grouped by the stage they left from", why: "Pinpoints the leakiest step — ghosting vs no-show vs trial-not-converting.", recommended: true });

  if (!has("Showed")) hidden.push({ label: "Trial show rate", why: "No 'done / attended trial' stage detected — can't tell who showed up." });
  if (!has("Won")) hidden.push({ label: "Trial → member rate", why: "No 'member / enrolled / won' stage detected." });
  if (!has("Contacted")) hidden.push({ label: "Response rate", why: "No 'responded / contacted' stage detected." });

  return { kpis, hidden };
}
