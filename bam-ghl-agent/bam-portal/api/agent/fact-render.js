// ── Agent FACT renderer (Build 2: facts are derived, never typed) ────────────
// A fact section of the agent brain is a VIEW onto structured data the academy
// already maintains - not free text someone retypes per academy (tier 3 of the
// control-dial model, Zoran 2026-07-23). The academy edits their OFFER; every
// agent reads the change on the next prompt build. No double entry, no drift.
//
// First fact wired: `program` <- offers.data (general_info + general + schedule
// classes). Proof of why this exists: before this shipped, GTA had THREE
// different answers for ages (stored override "6 and up", offer "9-17",
// hardcoded default "9 and up").
//
// Precedence (applied in _sections.loadMergedOverrides + brain.loadBrainConfig):
//   rendered fact  >  stored per-academy text  >  hardcoded default
// The renderer returns null when the offer is too sparse to trust (fewer than 3
// lines) - the stored/default text then serves as the fallback, so a brand-new
// academy mid-onboarding never gets a half-empty brain section.
//
// Deliberately NOT rendered (Zoran 2026-07-23): private training, adult
// classes, camps/clinics - each becomes its own OFFER TYPE later; until an
// academy has such an offer the agent treats it as not-currently-offered.

import { resolveFee, applyFee, taxFee } from "../_fees.js";
// The SAME reader the routing uses. renderBookingGroup used to reach into
// data.schedule.classes itself, which agreed with _class-slots.js for every offer
// in production and disagreed for the older top-level data.classes shape: the
// agent would have been told "no classes are set up, book nobody" while the
// resolver armed that academy and routed it happily. Two readers of one fact
// disagreeing is the exact divergence this build exists to remove, so there is
// now one reader.
import { classesOf } from "./_class-slots.js";
import { resolveTestimonials } from "../_testimonials.js";

// ── tiny helpers ─────────────────────────────────────────────────────────────
const money = (v) => { const n = Number(String(v).replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? `$${n}` : null; };
const arr = (x) => Array.isArray(x) ? x : (x ? [x] : []);
// "17:00" -> "5:00pm" (leaves anything unparseable untouched)
const t12 = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return String(t || "");
  let h = Number(m[1]); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
  return `${h}:${m[2]}${ap}`;
};

// Pure: offers.data JSON in -> section text out (or null = fall back).
export function renderProgram(data) {
  if (!data || typeof data !== "object") return null;
  const gi = data.general_info || {};
  const gen = data.general || {};
  const classes = (data.schedule && Array.isArray(data.schedule.classes)) ? data.schedule.classes : [];
  const lines = [];

  if (gi.age_range) lines.push(`Ages: ${gi.age_range}`);

  const genders = Array.isArray(gi.gender) ? gi.gender.filter(Boolean) : (gi.gender ? [gi.gender] : []);
  if (genders.length >= 2) lines.push("Co-ed (boys + girls)");
  else if (genders.length === 1) lines.push(`${genders[0]} only`);

  if (gi.skill_level) {
    lines.push(String(gi.skill_level).toLowerCase() === "all"
      ? "Skill levels: all (beginners welcome, advanced athletes grouped appropriately)"
      : `Skill levels: ${gi.skill_level}`);
  }

  const desc = gi.description || gen.description;
  if (desc) lines.push(`What it is: ${desc}`);
  if (gen.structure) lines.push(`Structure: ${gen.structure}`);

  // Group size: per-class first (schedule step), else the offer's session
  // capacity (the booking limit) as a coarser fallback.
  const sizes = [...new Set(classes.map((c) => c && c.group_size).filter(Boolean).map(String))];
  if (sizes.length) lines.push(`Group sizes: ${sizes.join(" / ")} athletes per group`);
  else if (gi.capacity) lines.push(`Group sizes: up to ${gi.capacity} per session`);

  if (gi.coach_ratio) lines.push(`Coaches: ${gi.coach_ratio}`);

  return lines.length >= 3 ? lines.join("\n") : null;
}

// business_info <- the ACADEMY record + its saved locations (with directions
// notes - what the agent quotes to parents asking where to go) + live links.
export function renderBusinessInfo(client, data, locations) {
  if (!client || typeof client !== "object") return null;
  const lines = [client.business_name || "The academy"];
  const locs = arr(locations);
  if (locs.length) {
    for (const l of locs) {
      const bits = [l.title, l.address].filter(Boolean).join(" - ");
      if (bits) lines.push(`Location: ${bits}${l.notes ? ` (${String(l.notes).trim()})` : ""}`);
    }
  } else if (client.address) lines.push(`Location: ${client.address}`);
  const domain = client.website_setup && client.website_setup.domain;
  if (domain) lines.push(`Free trial booking link: https://${domain}/free-trial`);
  const link = (data && data.sales && data.sales.signup_url) || "";
  if (link) lines.push(`Sign-up link: ${link}`);
  return lines.length > 1 ? lines.join("\n") : null;
}

// schedule <- offer.data.schedule.classes, with location ids resolved to names
// and times in 12h ("Tue 5:00pm-6:00pm at Santa Clara Basketball Court").
export function renderSchedule(data, locations) {
  const classes = arr(data && data.schedule && data.schedule.classes);
  const locById = new Map(arr(locations).filter((l) => l && l.id).map((l) => [l.id, l.title]));
  const lines = [];
  for (const c of classes) {
    const times = arr(c.weekly_times).map((wt) => {
      const span = `${arr(wt.days).join("/")} ${t12(wt.start)}-${t12(wt.end)}`.trim();
      const at = locById.get(wt.location);
      return span ? `${span}${at ? ` at ${at}` : ""}` : "";
    }).filter(Boolean).join("; ");
    const name = c.title || c.age || "Class";
    const meta = [c.age, c.skill_level && String(c.skill_level).toLowerCase() !== "all" ? c.skill_level : null]
      .filter(Boolean).join(", ");
    if (times) lines.push(`${name}${meta ? ` (${meta})` : ""}: ${times}`);
  }
  const yr = data && data.schedule && data.schedule.year_round;
  if (yr) lines.push(String(yr).toLowerCase().includes("season") ? "Runs seasonally." : "Runs year-round.");
  return lines.length ? lines.join("\n") : null;
}

// ── which class to book into ────────────────────────────────────────────────
// THE TENTH FACT, and the reason it took until build B to exist.
//
// `booking_group` was the ONE fact default that could not be emptied: it carried
// BAM GTA's age bands (9 to 13, 14 and up) and shipped them to all 47 academies,
// and yet deleting it made things WORSE rather than better. "Group 1"/"Group 2"
// were the literal argument values three tool schemas took, and this section was
// the only prose that taught them, so an emptied body deleted routing while the
// same bands stayed written into api/agent-approvals.js. It had no renderer, so
// an academy filling in its offer could never clear it. That is what a named gap
// looks like: not a hole to punch, a thing that has to be built.
//
// What made it derivable is build A: age_min / age_max_mode / age_max on each
// class, and source_offer_class_key on each slot. The agent now works in the
// academy's REAL class names, which come from here, and the routing RULES below
// name no academy, no number and no group.
//
// THE RULES ARE PART OF THE RENDER, not a separate prose section, because a
// rendered fact REPLACES the default body (pick() in prompt-structure.js) - so
// craft left behind in the body would simply vanish for every academy that has
// an offer, which is every academy this matters for.
const BOOKING_ROUTING_RULES = [
  "Work out which class the athlete belongs in from their AGE, as a number, before you offer any time. Use check_availability - give it the age and it returns only the times that athlete can actually be booked into.",
  "- Exactly one class fits: book it. Ask nothing further about which class.",
  "- No class fits: they are not qualified for this academy. Say so honestly and kindly. Never book them into the closest one.",
  "- More than one class fits: ask ONE question that tells those classes apart, then book. check_availability tells you what the difference actually is. It is often skill level rather than age, and when the classes overlap on age, asking about age again cannot separate them and wastes the parent's time.",
  "- You cannot read the age: ask the parent for it. This is NOT the same as no class fitting - one of those turns a customer away and the other does not.",
  "Always name a class exactly as it is written below. Never invent a class, never use a group number, and never use a vague label like 'the younger group'.",
].join("\n");

// The fact-absent state. Same job as PRICING_NOT_CONFIGURED: an academy with no
// classes must be SILENT about which class, not fall back to somebody else's.
export const BOOKING_GROUP_NOT_CONFIGURED = [
  "No classes are set up for this academy yet, so there is nothing to book an athlete into and no way to tell which class they belong in.",
  "Do not name a class, do not name a session time, and do not book. Tell the lead you will come back to them with times, and flag the conversation to the admin.",
].join("\n");

// Pure: offers.data JSON in -> the routing section for THIS academy.
export function renderBookingGroup(data) {
  const classes = classesOf(data);
  const lines = [];
  for (const c of classes) {
    const title = (c && (c.title || c.name)) || null;
    if (!title) continue;
    const min = c.age_min == null || String(c.age_min).trim() === "" ? null : String(c.age_min).trim();
    const openTop = String(c.age_max_mode || "").trim().toLowerCase() === "no upper limit";
    const max = openTop ? null : (c.age_max == null || String(c.age_max).trim() === "" ? null : String(c.age_max).trim());
    let ages;
    if (min && max) ages = `ages ${min} to ${max}`;
    else if (min && openTop) ages = `ages ${min} and up`;
    else if (min) ages = `ages ${min} and up`;
    else if (max) ages = `up to age ${max}`;
    // An academy that has not set ages says so, rather than being given a band
    // it never chose. The age numbers are what the whole thing routes on, so a
    // guess here is the one thing worse than an admission.
    else ages = "ages not set - ask the admin before booking anyone into it";
    const extra = c.skill_level && String(c.skill_level).trim().toLowerCase() !== "all"
      ? `, ${String(c.skill_level).trim()} level` : "";
    lines.push(`- ${title}: ${ages}${extra}`);
  }
  if (!lines.length) return null;
  return `${BOOKING_ROUTING_RULES}\n\nThis academy's classes:\n${lines.join("\n")}`;
}

// ── pricing ──────────────────────────────────────────────────────────────────
// The numbers come from the academy's ROUTABLE, ACTIVE `offer_prices` rows -
// what api/website/checkout.js can actually sell - NOT from
// offers.data.pricing. That distinction is the whole point: the offer stores
// PRE-TAX amounts next to a free-text `added_fees` note, while offer_prices
// stores the exact total Stripe bills. Until 2026-07-24 this renderer read the
// offer, so BAM GTA's live agent quoted $200 and $279 for plans that charge
// $226.00 and $315.27. An agent naming a number the parent is not charged is
// the worst failure mode in this whole system, worse than one that declines to
// quote, so the offer's own price fields are deliberately never read here.
//
// The offer is still read for everything money is NOT: plan copy, what's
// included, what a commitment does when it ends, discount codes.
//
// `prices` = offer_prices rows for THIS training offer, pre-filtered to
// is_routable AND is_active (routable requires a confirmed entitlement rule, so
// it is exactly the sellable set). Three cases, on purpose:
//   [] (fetched, none)  -> tell the agent to quote NOTHING and flag the admin.
//                          Deliberate: an academy mid-onboarding stays silent on
//                          money until its catalog is seeded (Zoran 2026-07-24).
//   undefined (unknown) -> return null, fall back to stored/default text.
//   rows                -> render them.
//
// Disclosure mode is NOT here. How openly the agent may discuss these numbers is
// tier-1 sales craft carried by the agent template; this renderer only states
// the academy's facts. See docs/agent-pricing-transparency-plan.md.
export const PRICING_NOT_CONFIGURED = [
  "No sellable prices are configured for this academy yet.",
  "Do not quote any price, range, plan, or discount, and do not estimate one. Tell the lead you will get them exact numbers, and flag the conversation to the admin.",
].join("\n");

// offer_prices.billing_interval -> how a human says it.
const INTERVAL_LABEL = { "4_weeks": "every 4 weeks", "3_months": "3 months prepaid", "6_months": "6 months prepaid" };
const TERM_WORDS = { "3_months": "3 month", "6_months": "6 month" };
// Cents -> "$226.00" / "$315.27". Always two decimals: once a price is stated as
// a stack of parts ("Plan $200.00 + HST 13% $26.00 = TOTAL $226.00"), a bare
// "$226" next to "$26.00" reads as a different kind of number. Consistent cents
// is what makes the receipt scan as one column (Zoran's approved shape,
// 2026-07-26).
const fromCents = (c) => {
  const n = Number(c);
  if (!isFinite(n)) return null;
  return `$${(n / 100).toFixed(2)}`;
};
// Mirrors termFromLength in api/website/offer.js: a commitment's free-text
// length ("3 Months (12 Weeks)", "24 Weeks") -> the term key in offer_price_key.
const termFromLength = (length) => {
  const l = String(length || "").toLowerCase();
  const m = l.match(/(\d+)\s*month/);
  if (m) { const n = +m[1]; if (n >= 6) return "6_months"; if (n >= 3) return "3_months"; }
  if (/24\s*week/.test(l)) return "6_months";
  if (/12\s*week/.test(l)) return "3_months";
  return null;
};

// ── the breakdown: RECONCILE, never divide ───────────────────────────────────
// A price has three parts a parent cares about: the core price the owner typed,
// the tax, and the total that leaves their account. Only two of those are
// stored. The third is derived, and HOW it is derived is the whole build.
//
//   total = offer_prices.amount_cents          (what Stripe charges; never derived)
//   base  = the owner's typed offer price      (matched via source_offer_price_key)
//   tax   = total - base                       (integer cents)
//
// Subtraction, not division. `total / 1.13` is rejected on four counts: it
// assumes the fee was a percent (a flat fee divides wrong and cannot be
// detected), it invents a base nobody typed (279.00 comes back as
// 278.99999999999994 and needs a round), it duplicates logic that already lives
// in _fees.js, and - worst - it can never fail, so a drifted row would emit a
// confident fake tax line. Subtraction cannot invent, and the three printed
// lines therefore always sum to the exact amount charged.
//
// THE HONESTY GATE. Before printing any part, re-run the identical _fees.js call
// that api/offers/match-prices.js used to build the Stripe price. If
// applyFee(base, resolveFee(...)) does not equal the catalog amount to the cent,
// the parts are NOT printed - the total is stated alone and the admin is
// flagged. A mismatch means the owner edited a base without re-pricing, or a
// `taxable` flag is wrong; both are exactly the drift this workstream exists to
// catch, and an agent that declines to break a price out is better than one that
// breaks it out wrong.
//
// No new column. base_cents is deliberately NOT stored on offer_prices: it would
// be a second copy of a number the offer already holds, and copies drift, which
// is the precise fault that created this workstream. Offer = the owner's input.
// Catalog = Stripe's truth. Tax = the difference. Three things, no fourth.
const centsOf = (v) => { const n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) : null; };

// The owner-typed base + its taxable inputs for one catalog row. Mirrors
// buildOfferTargets in api/offers/match-prices.js line for line, INCLUDING the
// archived/type filter and the per-row taxable precedence (a commitment's own
// flag wins over the offering's). Any divergence here is what reconciliation
// catches. Returns null when the offer has no such base - a catalog row can
// legitimately outlive the offering that minted it, which is total-only WITHOUT
// a flag.
function baseSourceFor(offerings, title, term) {
  const want = String(title || "").trim().toLowerCase();
  const off = offerings.find((o) => o && !o.archived
    && String(o.type || "").toLowerCase() === "membership"
    && String(o.title || "").trim().toLowerCase() === want);
  if (!off) return null;
  if (term === "monthly")    return { base: centsOf(off.price), taxable: off.taxable, legacyText: off.added_fees };
  if (term === "signup_fee") return { base: centsOf(off.signup_fee), taxable: off.signup_fee_taxable, legacyText: null };
  // A commitment's base lives on offering.commitments[].price, matched by term.
  // An unparseable length yields no base, so that row falls to total-only -
  // correct, because an unparseable length is not a number to guess with.
  const c = arr(off.commitments).find((x) => x && termFromLength(x.length) === term);
  if (!c) return null;
  return { base: centsOf(c.price), taxable: c.taxable != null ? c.taxable : off.taxable, legacyText: c.added_fees };
}

// One catalog row -> { total, base, tax, fee, mismatch }. base null = state the
// total alone; mismatch true = state the total alone AND flag the admin.
function componentsFor(row, term, planTitle, offerings, taxConfig) {
  const total = Math.round(Number(row && row.amount_cents));
  const src = baseSourceFor(offerings, planTitle, term);
  if (!src || !(src.base > 0)) return { total, base: null, mismatch: false };
  const fee = resolveFee({ taxConfig, taxable: src.taxable, legacyText: src.legacyText });
  if (applyFee(src.base, fee) !== total) return { total, base: null, mismatch: true };
  return { total, base: src.base, tax: total - src.base, fee, mismatch: false };
}

export function renderPricing(data, prices, taxConfig) {
  if (!Array.isArray(prices)) return null; // caller does not know - fall back
  const rows = prices.filter((p) =>
    p && p.is_routable !== false && p.is_active !== false && isFinite(Number(p.amount_cents)) && Number(p.amount_cents) > 0);
  if (!rows.length) return PRICING_NOT_CONFIGURED;

  // "Summer Unlimited|3_months" -> plan title + term. The title half IS the
  // offering title, which is also what the parent sees on the enrollment card,
  // so the agent and the website name the same plan the same way (offer_prices
  // .title is an internal label and can differ, e.g. GTA's "1/Wk - Monthly").
  const planOf = (r) => String(r.source_offer_price_key || "").split("|")[0].trim() || String(r.title || "Plan").trim();
  const termOf = (r) => String(r.source_offer_price_key || "").split("|")[1] || (r.billing_interval === "4_weeks" ? "monthly" : r.billing_interval) || "monthly";

  const offerings = arr(data && data.pricing && data.pricing.pricing_offerings);
  const offeringFor = (title) => offerings.find((o) => o && String(o.title || "").trim().toLowerCase() === title.toLowerCase()) || {};

  // Group in query order (sort_order) so the agent lists plans the way the
  // academy ordered them.
  // Build S: a `<plan>|signup_fee` row is a one-time rider, NOT a plan term.
  // Left in the term list it would render as a fake commitment length
  // ("signup_fee: $40"), so it is split out here and stated as its own line.
  const plans = new Map();
  const feeByPlan = new Map();
  for (const r of rows) {
    const title = planOf(r);
    if (termOf(r) === "signup_fee") { feeByPlan.set(title, r); continue; }
    if (!plans.has(title)) plans.set(title, { title, monthly: null, terms: [] });
    const p = plans.get(title);
    if (termOf(r) === "monthly") p.monthly = r; else p.terms.push(r);
  }
  if (!plans.size) return PRICING_NOT_CONFIGURED;   // fee rows alone are not sellable

  const currencies = [...new Set(rows.map((r) => String(r.currency || "").toUpperCase()).filter(Boolean))];
  const cur = currencies.length === 1 ? ` in ${currencies[0]}` : "";

  // Reconcile every row up front: the range line needs to know whether tax is
  // already inside these numbers before the plan loop runs.
  const comp = new Map();
  for (const r of rows) comp.set(r, componentsFor(r, termOf(r), planOf(r), offerings, taxConfig));

  // The academy's tax TEMPLATE, used only to NAME the tax ("HST 13%"). A row that
  // reconciled through a legacy free-text string keeps that string's own parsed
  // label instead, so an academy that never migrated still itemizes correctly.
  const tf = taxFee(taxConfig);
  const taxName = (fee) => {
    if (!fee) return null;
    if (tf && fee.label === tf.label) {
      const label = String((taxConfig && taxConfig.label) || "").trim();
      return label ? `${label} ${taxConfig.pct}%` : `${taxConfig.pct}%`;
    }
    return fee.label;
  };
  // "Plan $200.00 + HST 13% $26.00 = TOTAL $226.00", or null when there is
  // nothing honest to break out. A zero difference prints no tax line rather
  // than "$0.00": a row marked taxable "No" IS its own base, and $0.00 tax reads
  // as a claim about the law we do not own.
  const parts = (c) => {
    if (!c || c.base == null || !(c.tax > 0)) return null;
    const t = taxName(c.fee);
    return t ? `Plan ${fromCents(c.base)} + ${t} ${fromCents(c.tax)} = TOTAL ${fromCents(c.total)}` : null;
  };
  const drifted = [];   // rows whose parts did not reconcile - named for the admin

  // The band a RANGE-mode answer draws on: recurring plans only. Both ends exact
  // - rounding the top down would understate what a parent pays. The band is
  // ALL-IN: a pre-tax band in a first-touch text is the exact failure this build
  // exists to end (a parent hearing 200 and being billed 226).
  const monthlyRows = rows.filter((r) => termOf(r) === "monthly");   // fee rows excluded by termOf
  const recurring = monthlyRows.map((r) => Number(r.amount_cents));
  // Only claim tax is included when a monthly row actually proved it is.
  const taxInBand = !!(tf && monthlyRows.some((r) => parts(comp.get(r))));
  const bandTax = taxInBand ? `, ${String(taxConfig.label || "").trim() || `${taxConfig.pct}%`} included` : "";
  const head = [];
  if (recurring.length) {
    const lo = fromCents(Math.min(...recurring)), hi = fromCents(Math.max(...recurring));
    head.push("", lo === hi
      ? `Every plan is ${lo} every 4 weeks${bandTax}.`
      : `Range: ${lo} to ${hi} every 4 weeks${bandTax}.`);
  }

  const out = [];
  let sawParts = false;
  // Owner-typed copy rarely ends in a full stop; the agent reads this as prose.
  const sentence = (s) => { const t = String(s || "").trim(); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };
  // Names a row for the admin flag when its parts refused to reconcile.
  const flag = (title, term, c) => { if (c && c.mismatch) drifted.push(`${title} ${String(term).replace("_", " ")}`); };

  for (const p of plans.values()) {
    const o = offeringFor(p.title);
    const base = p.monthly ? `${fromCents(p.monthly.amount_cents)} ${INTERVAL_LABEL[p.monthly.billing_interval] || "every 4 weeks"}` : "prepaid terms only";
    out.push(`- ${p.title}: ${base}.${o.whats_included ? ` ${sentence(o.whats_included)}` : ""}`);
    // The parts of the headline amount, on their own line so the agent can read
    // them out as a stacked receipt. The plan headline keeps the TOTAL, because
    // the total is the only number that is true no matter how it is skimmed.
    if (p.monthly) {
      const c = comp.get(p.monthly);
      flag(p.title, "monthly", c);
      const line = parts(c);
      if (line) { out.push(`    ${line} ${INTERVAL_LABEL[p.monthly.billing_interval] || "every 4 weeks"}.`); sawParts = true; }
    }
    // The fee is charged once per athlete at enrollment, and only on the
    // options the academy marked "Charge". Say the real starting total so
    // "what does it cost to start" is answered with the number they pay. A
    // one-time charge that can move the first payment by a quarter is part of
    // the price, not a footnote, so the prompt names it in EVERY disclosure
    // mode - the one added fee the agent always volunteers.
    const feeRow = feeByPlan.get(p.title);
    if (feeRow) {
      const fc = comp.get(feeRow);
      flag(p.title, "signup fee", fc);
      const feeParts = parts(fc);
      if (feeParts) sawParts = true;
      const chargedOnBase = String(o.signup_fee_on_base || "").toLowerCase() === "charge";
      const waived = arr(o.commitments)
        .filter((c) => c && String(c.signup_fee_charge || "").toLowerCase() !== "charge" && termFromLength(c.length))
        .map((c) => TERM_WORDS[termFromLength(c.length)]).filter(Boolean);
      // The fee's own tax itemizes exactly like a plan's, from signup_fee_taxable.
      out.push(`    One-time sign-up fee: ${feeParts ? feeParts.replace(/^Plan /, "Fee ") + " " : `${fromCents(feeRow.amount_cents)} `}per athlete, charged once when they enroll.`);
      if (chargedOnBase && p.monthly) {
        out.push(`      First payment ${fromCents(Number(p.monthly.amount_cents) + Number(feeRow.amount_cents))}, then ${fromCents(p.monthly.amount_cents)}.`);
      }
      if (waived.length) out.push(`      No sign-up fee on the ${waived.join(" or ")} option${waived.length > 1 ? "s" : ""}.`);
    }
    for (const t of p.terms) {
      const term = termOf(t);
      const c = arr(o.commitments).find((x) => x && termFromLength(x.length) === term) || {};
      const after = c.after === "Other" ? String(c.after_other || "").trim() : String(c.after || "").trim();
      const label = INTERVAL_LABEL[t.billing_interval] || term.replace("_", " ");
      const tc = comp.get(t);
      flag(p.title, term, tc);
      const line = parts(tc);
      if (line) sawParts = true;
      out.push(`    ${label}: ${line || fromCents(t.amount_cents)}${after ? `, then ${after.charAt(0).toLowerCase() + after.slice(1)}` : ""}.`);
      if (c.whats_included) out.push(`      Includes: ${sentence(c.whats_included)}`);
      // `discount_notes` is DELIBERATELY NOT RENDERED (Zoran, 2026-08-06). It is a
      // free-text box where an academy owner leaves a note FOR OUR TEAM; it was
      // never customer-facing copy, and it is the one field here that routinely
      // carries its OWN arithmetic - a per-month figure and a percentage the owner
      // worked out by hand and never revisits when a price changes.
      //
      // Four of BAM San Jose's six notes are already wrong against its own offer:
      // "about $240/mo, save 20%" on a 3-month Unlimited that is $249.67/mo and
      // 16.8% off. Rendering it put a number the parent is NOT charged into the
      // fact sheet the agent quotes from - the exact failure the pricing block
      // above was rewritten to end, arriving one field later through free text
      // instead of through a stale price column.
      //
      // The note stays in offers.data and stays visible to staff. It simply never
      // becomes a fact. Nothing the agent says about money is typed by hand; the
      // amounts come from offer_prices, which is what Stripe actually bills.
      // Guarded by api/_discount-notes-never-quoted.test.mjs.
    }
  }

  // The header is written LAST because it describes what the body turned out to
  // contain. When nothing broke out it says nothing about tax at all - not "no
  // tax", which is a claim about the law we do not own. Absent config produces
  // silence, not a statement.
  out.unshift(
    `These are the exact amounts charged at checkout${cur}. Never quote a price that is not listed here.` +
    (sawParts ? " Each plan lists its parts; the TOTAL line is the amount that leaves the parent's account." : ""),
    ...head, "");

  // Discount codes were in offers.data all along and never rendered, while the
  // shared objection-handling text told the agent to "highlight any discounts
  // listed in your pricing config" - pointing at data it had never been given.
  const codes = arr(data && data.pricing && data.pricing.discount_codes).filter((d) => d && String(d.code || "").trim());
  if (codes.length) {
    out.push("", "Discount codes:");
    for (const d of codes) {
      const amount = String(d.kind || "").toLowerCase().includes("percent") ? `${d.value}% off` : `${money(d.value) || d.value} off`;
      const bits = [amount, d.duration ? `applies to ${String(d.duration).toLowerCase()}` : null,
        String(d.once_per_customer || "").toLowerCase() === "yes" ? "one use per customer" : null].filter(Boolean);
      out.push(`- ${String(d.code).trim()}: ${bits.join(", ")}.`);
    }
  }

  // The "if a note disagrees with a plan amount, the plan amount wins" line lived
  // here and went WITH the notes. It existed only to defend against owner-typed
  // arithmetic being wrong, so once the notes stopped being rendered it was
  // defending against nothing - and a disclaimer with no wrong number left to
  // correct is worse than absent: it tells the agent some number above may be
  // untrustworthy, inviting hedging about amounts that are now all exact.
  // The `sawNotes` flag that gated it went too, rather than being left behind as
  // a condition that can never be true again.

  // Reconciliation failed on at least one row: the amount charged is still
  // exact, but its parts are unknown, so the agent is told to quote the total
  // alone there rather than guess a split. Naming the rows is what turns a
  // silent degrade into a fixable admin task.
  if (drifted.length) {
    out.push("", `The parts of these amounts do not add up against the offer, so state them as a total only and never break them down: ${drifted.join(", ")}. Flag it to the admin so the offer and the catalog can be re-matched.`);
  }

  return out.join("\n");
}

// policies <- offer.data.policy (cancel / pause / refunds / makeup / parents
// watching / under-18 / holidays).
export function renderPolicies(data) {
  const p = (data && data.policy) || {};
  if (!Object.keys(p).length) return null;
  const lines = [];
  const amt = Number(p.cancel_notice_amount);
  if (p.cancellation === "Notice required" && amt > 0) {
    const unit = p.cancel_notice_unit === "hours" ? "hours" : "days";
    lines.push(`Cancellation: ${amt} ${amt === 1 ? unit.replace(/s$/, "") : unit} written notice required.`);
  } else lines.push("Cancellation: members can cancel anytime.");
  if (p.pause_allowed === "Yes") {
    const mn = Number(p.pause_min_days), mx = Number(p.pause_max_days), per = Number(p.pause_per_year);
    const len = (mn > 0 && mx > 0 && mn < mx) ? `${mn} to ${mx} days at a time` : (mx > 0 ? `up to ${mx} days at a time` : "flexible length");
    const freq = per === 1 ? ", once per year" : per === 2 ? ", twice per year" : per > 0 ? `, ${per} times per year` : "";
    lines.push(`Pause: memberships can be paused (${len}${freq}).`);
  } else if (p.pause_allowed === "No") lines.push("Pause: memberships cannot be paused.");
  const rw = Number(p.refund_window_days);
  lines.push((p.refund_policy === "Refundable within a window" && rw > 0)
    ? `Refunds: refundable within ${rw} days of purchase, otherwise non-refundable.`
    : "Refunds: fees already charged are non-refundable except where required by law.");
  if (p.makeup_policy && String(p.makeup_policy).trim()) lines.push(`Makeup/reschedule: ${String(p.makeup_policy).trim()}`);
  if (p.sibling_policy && String(p.sibling_policy).trim()) lines.push(`Siblings: ${String(p.sibling_policy).trim()}`);
  if (p.parent_watching) lines.push(`Parents watching: ${p.parent_watching}.`);
  if (p.under_18) lines.push(`Under-18s: ${p.under_18}.`);
  if (p.holiday_schedule) lines.push(`Holidays: ${p.holiday_schedule}.`);
  return lines.join("\n");
}

// coaches <- the academy's own STAFF records (client_users with a title or bio),
// NOT a typed claim. This kills the hardcoded default ("certified by By Any
// Means, played at the college or professional level") that was leaking a
// GTA-specific, and for other academies FALSE, credential claim onto every
// agent. When no coach profiles are filled in yet (e.g. San Jose today), it
// emits a NEUTRAL instruction so the agent makes NO invented claims - it never
// falls through to that leaky default.
export function renderCoaches(staff) {
  const rows = arr(staff).filter((s) => s && (String(s.title || "").trim() || String(s.bio || "").trim()));
  if (!rows.length) {
    return "Coach profiles for this academy are not filled in yet. Speak to the quality of coaching in general terms and invite the lead to meet the coaches at their trial. Do NOT invent specific credentials, certifications, playing history, or coach names.";
  }
  // Owners/head first, then the rest, in the order given.
  rows.sort((a, b) => (b.role === "owner" ? 1 : 0) - (a.role === "owner" ? 1 : 0));
  const lines = rows.map((s) => {
    const head = [s.name, String(s.title || "").trim()].filter(Boolean).join(" - ");
    const bio = String(s.bio || "").trim();
    return `- ${head}${bio ? `: ${bio}` : ""}`;
  });
  return "Our coaches (share naturally when relevant, do not dump the whole list):\n" + lines.join("\n");
}

// qualification_config <- the preset's 3 locked criteria (the FRAMEWORK, tier 1)
// filled with this academy's VALUES: its locations, its age range, its skill
// levels. Kills the hardcoded "near Oakville/GTA" default leaking to other
// academies - the exact bug that would have had San Jose's agent qualifying
// Bay Area parents by Ontario geography.
export function renderQualification(data, client, locations) {
  const gi = (data && data.general_info) || {};
  const locNames = arr(locations).map((l) => l && l.title).filter(Boolean);
  const where = locNames.length ? locNames.join(" / ") : ((client && client.address) || null);
  if (!where && !gi.age_range) return null;
  const skill = gi.skill_level ? String(gi.skill_level) : null;
  return [
    "Qualify leads on these dimensions:",
    `- Location proximity: Are they close enough to realistically attend sessions at ${where || "the academy"}?`,
    `- Athlete age: Athlete must be within the program's age range${gi.age_range ? ` (${gi.age_range})` : " (see program)"}`,
    `- Program fit: ${skill && skill.toLowerCase() === "all" ? "All skill levels accepted" : (skill ? `${skill} program` : "See the program")} - place them in the right group for their level`,
    "",
    "Interest level is NOT a qualification. Leads who aren't interested are never marked unqualified - they get moved to Nurture. Unqualified means they cannot be a customer (too far, wrong age, not a fit) and it removes them from the pipeline entirely.",
  ].join("\n");
}

// selling_points <- offer.data.value (the canonical home - Build 3 resolved,
// Zoran 2026-07-23: GTA's curated bullets were moved INTO its offer value, so
// every academy's differentiators now live where the owner edits them).
export function renderSellingPoints(data) {
  const v = (data && data.value) || {};
  const parts = [];
  if (v.what_makes_different) parts.push(String(v.what_makes_different).trim());
  if (v.program_structure) parts.push(`Program structure: ${String(v.program_structure).trim()}`);
  return parts.length ? parts.join("\n\n") : null;
}

// social_proof <- the testimonials store, via THE resolver (api/_testimonials.js).
//
// WHY THIS EXISTS, and it is a leak fix rather than a feature. The body for this
// section used to be a hardcoded literal in prompt-structure.js:
//     "Google Reviews: https://share.google/yel2SPxIMKzjsJG9c"
// That is BAM GTA's link, living in the SHARED prompt structure every academy's
// agent is built from, and nothing overrode it: this renderer did not exist, and
// 0 of 47 academies had a stored `social_proof` row. So San Jose, DETAIL Miami
// and Next Level all pointed parents at a Toronto academy's review page. Same
// shape as the "near Oakville/GTA" default renderQualification was written to
// kill, one section over.
//
// PURE ON PURPOSE: takes the already-resolved payload rather than a clientId, so
// the hierarchy lives in the resolver and this function is testable without a
// database. Do not re-resolve in here.
//
// The manual-vs-google distinction is NOT re-implemented here. A manual row does
// not merely have null rating/date - the KEYS ARE ABSENT (api/_testimonials.js
// publicShape, enforced again by testimonials_guard_source in the DB), so a typed
// quote physically cannot render stars or a date. Duplicating that guard is how
// the two copies drift, so this reads `source === "google"` for the one thing it
// is allowed to add and nothing else.
export function renderSocialProof(resolved, reviewUrl) {
  const r = resolved || {};
  const agg = r.aggregate || null;
  const rows = Array.isArray(r.testimonials) ? r.testimonials : [];
  const url = String(reviewUrl || "").trim();
  const parts = [];

  // The aggregate is a POINT-IN-TIME READING off the owner's Google profile, not
  // a sync - it goes stale silently the moment the next review lands. Rendered as
  // what Google showed, never as "your rating", for the same reason the card
  // shows a date: a number we genuinely fetched reads as current in a way a typed
  // one never would, so the provenance has to carry its own caveat.
  if (agg && agg.rating != null && agg.count != null) {
    parts.push(`Google showed ${agg.rating} stars across ${agg.count} reviews${agg.checked_at ? ` (read ${String(agg.checked_at).slice(0, 10)})` : ""}.`);
  }

  // One or two quotes, in the order the resolver gave them - the hierarchy is
  // Zoran's tier-1 lock and re-sorting here would fork it.
  for (const row of rows.slice(0, 2)) {
    if (!row || !row.quote) continue;
    const who = row.author || "Parent";
    const stars = row.source === "google" && row.rating != null ? ` (${row.rating} stars on Google)` : "";
    parts.push(`A parent said: "${String(row.quote).trim()}" - ${who}${stars}`);
  }

  if (url) parts.push(`If a parent asks where to leave a review, send them here: ${url}`);

  // NO FACT, NO OUTPUT. Returning null makes the section absent, which raises the
  // brain-health nudge chip exactly like the other eight. An academy with no
  // reviews says nothing about reviews - it never borrows another academy's.
  return parts.length ? parts.join("\n\n") : null;
}

// ── source map: where each derived fact is edited (the "Edit the brain" jump) ─
// Every derived section is a VIEW onto a source the academy already owns. This
// map tells the UI (client + staff portals) the plain-words source of each fact
// and a machine `jump` target the client portal turns into a real deep link into
// the Business Blueprint. Keys here ARE the derivable facts, and the COUNT is read
// from this map rather than written down anywhere - see FACT_KEYS below.
export const FACT_SOURCES = {
  program:              { label: "Rendered from: Offer - General info step",               jump: "offer:general_info" },
  schedule:             { label: "Rendered from: Offer - Schedule step",                   jump: "offer:schedule" },
  pricing:              { label: "Rendered from: Offer - Pricing step",                    jump: "offer:pricing" },
  policies:             { label: "Rendered from: Offer - Policy step",                     jump: "offer:policy" },
  selling_points:       { label: "Rendered from: Offer - Value step",                      jump: "offer:value" },
  business_info:        { label: "Rendered from: your Locations",                          jump: "locations" },
  qualification_config: { label: "Rendered from: Offer - General info and your Locations", jump: "offer:general_info+locations" },
  coaches:              { label: "Rendered from: your Team",                               jump: "team" },
  // The TENTH fact (build B, 30 July 2026). It renders the academy's own classes
  // and the age range on each, which is what the agent routes on. Adding it here
  // is what moves the brain-health strip from 9 to 10 - the total is derived from
  // this map, never written down.
  booking_group:        { label: "Rendered from: Offer - Schedule step (each class's ages)", jump: "offer:schedule" },
  // The review link lives on the clients row, edited in the offer's Onboarding
  // step (the `__google_review__` field) beside the community group, because an
  // academy has one review link, not one per offer. When a Reviews card exists
  // this jump should point there instead.
  social_proof:         { label: "Rendered from: your reviews and your Google review link", jump: "offer:onboarding" },
};
// The fact keys we try to render live (order = the UI's canonical order).
//
// The brain-health strip's TOTAL is derived from this list (api/agent-train.js),
// never written down. It used to read `total: 8` as a literal while `live` was
// computed from this array's length, so adding a ninth fact would have rendered
// "9 of 8 facts live" - a wrong number in the product, not a stale comment.
export const FACT_KEYS = Object.keys(FACT_SOURCES);

// ── loader: which rendered facts does this academy get? ──────────────────────
// Reads the academy's Training offer + client record + saved locations (60s
// cache - "edit the offer, the agent knows it" stays effectively immediate
// without three DB reads per prompt build). Returns a partial overrides map;
// empty object on any failure - rendering must never break an agent.
//
// opts.fresh === true forces a cache-miss refetch (the "Edit the brain" round
// trip: the client edits the offer, comes back, and must see the change now, not
// up to 60s later). All existing 2-arg callers are unaffected (opts defaults {}).
const TTL_MS = 60 * 1000;
const factCache = new Map(); // clientId -> { src: {data, client, locations, staff}, at }

// Drop one academy's cached source (or all, with no arg) so the next read is
// live. Exposed for callers that mutate an offer/locations/staff and want the
// agents to reflect it immediately without waiting out the TTL.
export function bustFactCache(clientId) {
  if (clientId) factCache.delete(clientId);
  else factCache.clear();
}

export async function derivedFactOverrides(clientId, sbFn, opts = {}) {
  try {
    if (!clientId || typeof sbFn !== "function") return {};
    let hit = factCache.get(clientId);
    if (!hit || Date.now() - hit.at > TTL_MS || opts.fresh === true) {
      const enc = encodeURIComponent(clientId);
      // offer_prices is fetched for the whole tenant (routable + active only,
      // a handful of rows) and narrowed to the training offer below, so all
      // five reads stay in ONE parallel batch instead of chaining on offer.id.
      const [offerRows, clientRows, locationRows, staffRows, priceRows] = await Promise.all([
        sbFn(`offers?client_id=eq.${enc}&type=eq.training&select=id,data&order=sort_order.asc&limit=1`).catch(() => []),
        // tax_config is the academy's tax TEMPLATE ({ label, pct }). It was not
        // read here before 2026-07-26, which is why the renderer could state a
        // total but never its parts.
        sbFn(`clients?id=eq.${enc}&select=business_name,address,website_setup,tax_config,google_review_url&limit=1`).catch(() => []),
        sbFn(`locations?client_id=eq.${enc}&select=id,title,address,notes&order=sort_order.asc&limit=10`).catch(() => []),
        sbFn(`client_users?client_id=eq.${enc}&status=eq.active&select=name,role,title,bio&limit=50`).catch(() => []),
        sbFn(`offer_prices?tenant_id=eq.${enc}&is_routable=eq.true&is_active=eq.true&order=sort_order.asc&select=title,amount_cents,currency,billing_interval,source_offer_id,source_offer_price_key`).catch(() => null),
      ]);
      const offer = (Array.isArray(offerRows) && offerRows[0]) || null;
      hit = {
        src: {
          data:      (offer && offer.data) || null,
          client:    (Array.isArray(clientRows) && clientRows[0]) || null,
          locations: Array.isArray(locationRows) ? locationRows : [],
          staff:     Array.isArray(staffRows) ? staffRows : [],
          // null (the read failed) stays null so renderPricing falls back rather
          // than asserting "no prices configured" on a transient error.
          prices:    Array.isArray(priceRows) && offer ? priceRows.filter((p) => p && p.source_offer_id === offer.id) : null,
        },
        at: Date.now(),
      };
      factCache.set(clientId, hit);
    }
    const { data, client, locations, staff, prices } = hit.src;
    if (!data) return {};
    const out = {};
    const set = (key, body) => { if (body) out[key] = body; };
    set("program",        renderProgram(data));
    set("schedule",       renderSchedule(data, locations));
    set("pricing",        renderPricing(data, prices, client && client.tax_config));
    set("policies",       renderPolicies(data));
    set("business_info",  renderBusinessInfo(client, data, locations));
    set("selling_points", renderSellingPoints(data));
    set("qualification_config", renderQualification(data, client, locations));
    set("coaches",        renderCoaches(staff));
    set("booking_group",  renderBookingGroup(data));

    // social_proof is the only fact that needs its own read, so it gets its own
    // catch - and that catch is LOAD-BEARING, not defensive habit.
    //
    // `resolveTestimonials` THROWS when it cannot answer, deliberately, so a seed
    // decision fails loudly rather than baking a wrong step. But this function's
    // outer catch returns `{}` for EVERYTHING, so an unguarded throw here would
    // blank all NINE facts and drop the agent back to its hardcoded defaults for
    // program, pricing, schedule and the rest. Losing the whole academy config
    // because a review lookup blipped is far worse than losing one section.
    //
    // So: prompt-side degrades quietly to fact-absent, seed-side fails loudly.
    // Same resolver, deliberately opposite handling, and the asymmetry is the
    // point - a page can afford to lose a strip, a seed cannot afford to bake a
    // wrong step and move on.
    try {
      set("social_proof", renderSocialProof(await resolveTestimonials(clientId), client && client.google_review_url));
    } catch (_) { /* reviews unavailable -> the agent says nothing about reviews */ }

    return out;
  } catch (_) {
    return {};
  }
}
