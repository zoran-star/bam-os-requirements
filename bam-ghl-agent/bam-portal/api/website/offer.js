// Public endpoint — feeds the website enrollment funnel for one offer.
//
//   GET /api/website/offer?client_id=<uuid>&offer_id=<uuid?>
//     → { offer, intake_fields[], pricing[], agreement_url, welcome_video }
//
// Powers the parent-facing "join" funnel that lives on the academy's own site:
//   • intake_fields — the questions to render in step 1 (offer-builder defaults
//     that are always on + the academy's selected add-ons + any custom fields),
//     each given a concrete input `type` inferred from its label.
//   • pricing       — the offer's pricing options (step 2), each resolved to its
//     Price-Matched, routable Stripe price so the funnel shows the real charge
//     and the checkout can bill the exact matched price. Unmatched options come
//     back with available:false so the UI can hide/disable them.
//   • agreement_url — the signed-waiver PDF the parent reads + signs in step 3.
//
// Read-only and CORS-gated by clients.allowed_domains, same as the other
// api/website/* endpoints. No price/amount is ever trusted from the client —
// this endpoint only reports what the DB already says is routable.

import { withSentryApiRoute } from "../_sentry.js";
// Pure, no network and no database. It is the single owner of what a class's
// age bounds MEAN, and this endpoint reads it rather than re-deriving them.
import { classAgeRange } from "../agent/_class-routing.js";
import { STORAGE_ONLY_DEF_KEYS as CONTACT_STORAGE_ONLY_DEF_KEYS } from "../_contacts.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

async function sbReq(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.set;
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const d of row.allowed_domains || []) { set.add(`https://${d}`); set.add(`https://www.${d}`); }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

// ── Intake fields ──────────────────────────────────────────────────────────
// The offer builder's Training "Intake form fields" are these defaults (always
// on) plus whatever add-ons the academy checked (saved in
// offers.data.onboarding.intake_form_fields). Keep this list in sync with
// _bbStdOnboarding(...) in public/client-portal.html for the training type.
const TRAINING_INTAKE_DEFAULTS = [
  "Parent name", "Phone", "Email", "Emergency contact name", "Emergency contact phone",
];
// The same defaults, split at the point where the academy's own athlete fields
// belong. The enroll form collects the athlete's name itself, so its age /
// grade / gender questions have to sit next to that name, not after the
// emergency contact. Order: parent basics -> athlete -> emergency contact.
const PARENT_BASICS = TRAINING_INTAKE_DEFAULTS.slice(0, 3);
export const EMERGENCY_CONTACT = TRAINING_INTAKE_DEFAULTS.slice(3);

// Intake labels that are ALWAYS required, for every academy on the shared
// sales-system preset (lowercased). Emergency contact added 2026-07-24 -
// required on every enroll/onboarding form, not per academy.
const REQUIRED_INTAKE_LABELS = new Set([
  "parent name", "email", "phone", "name",
  "emergency contact name", "emergency contact phone",
]);

export function fieldKey(label) {
  return String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Defs that exist ONLY so an answer has somewhere to land, for a question this
// file already renders from code. They must never be rendered AS defs.
//
// WHY AN EXPLICIT LIST AND NOT A CLEVER DEF SHAPE. The first design tried to
// find a value combination that custom_field_defs could carry which
// writePortalFieldValues would find and buildFields would never render. There
// isn't one, and the reason is structural rather than a missing trick: all three
// readers - this file, api/_contacts.js and api/custom-fields.js - select on the
// SAME `client_id + archived=false` pair. Everything that hides a row from one
// hides it from the others:
//   archived: true      buildFields never sees it, and neither does the storage
//                       write NOR the Members drawer. Nothing lands, nothing shows.
//   offer_id: <other>   dropped for THIS offer, rendered on that other offer's
//                       forms, needs a second offer to exist, and the offer_id FK
//                       to offers(id) forbids a sentinel id. A semantic lie.
//   label: ""           skipped by the early return below, and then shows as a
//                       blank row in the Members drawer and in field settings -
//                       which defeats the entire point, since the goal is for a
//                       coach to READ it.
// So the honest version is a named exclusion at the one choke point, which is
// what this is: two keys, imported from the module that owns the storage, not
// re-typed here.
//
// FOUR CONSEQUENCES THIS SKIP PREVENTS, all of which a rendered def would cause:
//   1. RELOCATION. Academy-level defs are pushed BEFORE the emergency block, and
//      the de-dupe below is by lowercased LABEL - so the def would win and the
//      emergency questions would jump up into the athlete section.
//   2. REQUIRED OVERRIDE. A rendered def takes `required` from its own row
//      (cfDefToField), not from REQUIRED_INTAKE_LABELS, so a def seeded
//      required:false would quietly make a REQUIRED question optional.
//   3. LEAD-FORM LEAK. coreDefs are spread into `lead_fields` too, so the free
//      trial form would start asking a stranger for their emergency contact.
//   4. REORDER. Anything pushed before EMERGENCY_CONTACT shifts the block, and
//      the "__<index>" suffix on every submitted key shifts with it.
// api/_emergency-contact-storage.test.mjs asserts all four against the rendered
// form rather than against this comment.
const STORAGE_ONLY_DEF_KEYS = new Set(CONTACT_STORAGE_ONLY_DEF_KEYS);

// Infer a concrete input type (+ options) from a question label. The offer
// builder only stores labels, so the funnel derives how to render each one.
function inferField(label) {
  const l = String(label).toLowerCase();
  const base = { key: fieldKey(label), label: String(label), type: "text", required: false };
  if (/\bemail\b/.test(l)) return { ...base, type: "email", placeholder: "you@email.com" };
  if (/phone|mobile|cell/.test(l)) return { ...base, type: "tel", placeholder: "(289) 000-0000" };
  if (/\b(dob|date of birth|birthday|birthdate)\b/.test(l)) return { ...base, type: "date" };
  if (/gender/.test(l)) return { ...base, type: "select", options: ["Boy", "Girl"] };
  if (/t-?shirt|jersey|shirt size/.test(l)) return { ...base, type: "select", options: ["YS", "YM", "YL", "AS", "AM", "AL", "AXL"] };
  if (/skill level|experience/.test(l)) return { ...base, type: "select", options: ["Beginner", "Intermediate", "Advanced"] };
  if (/relationship/.test(l)) return { ...base, type: "select", options: ["Parent", "Guardian", "Other"] };
  if (/grade/.test(l)) return { ...base, type: "text", placeholder: "e.g. Grade 7" };
  if (/medical|allergies|allergy|conditions|goals|notes|why|anything else/.test(l)) return { ...base, type: "textarea" };
  if (/address/.test(l)) return { ...base, type: "textarea", placeholder: "Street, city, postal code" };
  return base;
}

// custom_field_defs.type (the owner's explicit choice in the offer wizard) →
// the funnel form's input vocabulary (see enroll.jsx's renderer: textarea /
// select / tel / email / date / text). The owner picked the type, so we honor
// it rather than re-inferring from the label.
function cfDefType(def) {
  const t = String(def && def.type || "").toLowerCase();
  if (t === "email") return { type: "email", placeholder: "you@email.com" };
  if (t === "phone") return { type: "tel", placeholder: "(289) 000-0000" };
  if (t === "date") return { type: "date" };
  if (t === "select" || t === "multiselect") {
    const options = Array.isArray(def.options) ? def.options.map(String).filter(Boolean) : [];
    return { type: "select", ...(options.length ? { options } : {}) };
  }
  if (t === "boolean") return { type: "select", options: ["Yes", "No"] };
  return { type: "text" }; // text / number / url → plain input
}

// Turn a custom_field_defs row into a funnel field. Academy-core defs (offer_id
// null) + this offer's section-scoped defs both come through here.
function cfDefToField(def) {
  const label = String(def && def.label || "").trim();
  return {
    key: def.key || fieldKey(label),
    label,
    required: def.required === true,
    ...(def && def.help_text ? { help_text: String(def.help_text) } : {}),
    ...cfDefType(def),
  };
}

// Build the funnel field list for one section ("onboarding" = the join/enroll
// intake form, "sales" = the lead-capture form). Combines:
//   1. the training defaults (onboarding only - always-on contact basics)
//   2. the legacy offer.data JSON add-ons (kept for backward compat)
//   3. the academy-core + offer custom_field_defs the wizard now writes
// De-duped by label; contact basics stay required.
export function buildFields(offer, customDefs, section) {
  const onb = (offer.data && offer.data.onboarding) || {};
  const legacySelected = section === "onboarding" && Array.isArray(onb.intake_form_fields) ? onb.intake_form_fields : [];
  const legacyCustom = section === "onboarding" && Array.isArray(onb.intake_form_fields_custom) ? onb.intake_form_fields_custom : [];

  const out = [];
  const seen = new Set();
  const pushLabelField = (lbl) => {
    const s = String(lbl || "").trim();
    if (!s || /^add (custom|another)/i.test(s)) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    const f = inferField(s);
    if (REQUIRED_INTAKE_LABELS.has(k)) f.required = true;
    out.push(f);
  };
  const pushDefField = (def) => {
    // The one def-rendering choke point, so this single line covers BOTH loops
    // (academy-level and offer-scoped) and BOTH sections (intake and lead).
    // Keyed, not labelled: an academy is free to relabel its stored field and it
    // still must not render.
    if (def && STORAGE_ONLY_DEF_KEYS.has(String(def.key || ""))) return;
    const f = cfDefToField(def);
    if (!f.label) return;
    const k = f.label.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  // Academy-level defs (offer_id null) are the athlete's own attributes; the
  // offer-scoped ones are that offer's extra questions and stay at the end.
  const defs = customDefs || [];
  if (section === "onboarding") {
    PARENT_BASICS.forEach(pushLabelField);
    defs.filter((d) => d && !d.offer_id).forEach(pushDefField);
    EMERGENCY_CONTACT.forEach(pushLabelField);
  }
  legacySelected.forEach(pushLabelField);
  legacyCustom.forEach((c) => pushLabelField(typeof c === "string" ? c : (c && c.name)));
  defs.forEach(pushDefField);

  // Stable, unique keys for the form (label collisions already filtered above).
  return out.map((f, i) => ({ ...f, key: `${f.key}__${i}` }));
}

// Back-compat shim: the intake (onboarding) form.
function buildIntakeFields(offer, customDefs) {
  return buildFields(offer, customDefs, "onboarding");
}

// ── Pricing ──────────────────────────────────────────────────────────────────
// Mirror _bbTermFromLength / _bbPlanKeys in client-portal.html: a Membership
// offering yields a "<title>|monthly" base key plus "<title>|<term>" per
// commitment. We resolve each key to its routable Price-Matched catalog row.
// OPENED ADDITIVELY (Zoran, 2026-08-06): any whole 1-24 month count is its own
// `<n>_months` key; the old body collapsed n>=6 to "6_months" (a 12-month rung
// was sold and labelled as SIX months) and dropped everything under 3. "3
// months"/"6 months"/"12 weeks"/"24 weeks" still yield byte-identical keys, so
// nothing existing re-keys; out of range refuses loudly instead of collapsing.
// Mirror of _termFromLength in offers/match-prices.js.
function termFromLength(length) {
  const l = String(length || "").toLowerCase();
  const m = l.match(/(\d+)\s*month/);
  if (m) {
    const n = +m[1];
    if (n >= 1 && n <= 24) return `${n}_months`;
    console.warn(`[website/offer] commitment length "${length}" reads as ${n} months, outside the 1-24 month range this build can sell - this option is NOT shown for sale`);
    return null;
  }
  const w = l.match(/(\d+)\s*week/);
  if (w) {
    const n = +w[1];
    if (n % 4 === 0 && n / 4 >= 1 && n / 4 <= 24) return `${n / 4}_months`;
    console.warn(`[website/offer] commitment length "${length}" reads as ${n} weeks, which does not map to a whole 1-24 month term - this option is NOT shown for sale`);
    return null;
  }
  const y = l.match(/(\d+)\s*(?:year|yr)/);
  if (y || /\bannual(?:ly)?\b|\byearly\b/.test(l)) {
    const n = (y ? +y[1] : 1) * 12;
    if (n >= 1 && n <= 24) return `${n}_months`;
    console.warn(`[website/offer] commitment length "${length}" reads as ${n} months, outside the 1-24 month range this build can sell - this option is NOT shown for sale`);
    return null;
  }
  return null;
}

const TERM_LABELS = { monthly: "Monthly (billed every 4 weeks)", "3_months": "3 months", "6_months": "6 months" };
// Any other bounded <n>_months term labels itself ("9_months" -> "9 months");
// the three literals above stay byte-identical for the live vocabulary.
function termLabelOf(term) {
  if (TERM_LABELS[term]) return TERM_LABELS[term];
  const m = /^(\d+)_months$/.exec(String(term || ""));
  return m ? `${m[1]} months` : term;
}

// ── Billing cadence labels ───────────────────────────────────────────────────
// offer_prices.billing_cadence says how a price actually re-bills, separately
// from the term key that names the commitment. The vocabulary is owned by
// CADENCES in api/website/checkout.js, which is what actually charges; this map
// only puts a human phrase on each one. api/_billing-cadence.test.mjs fails if
// the two key sets ever drift apart.
const CADENCE_LABELS = {
  "4_weeks": "every 4 weeks",
  monthly: "monthly",
  "12_weeks": "every 12 weeks",
  "24_weeks": "every 24 weeks",
  "3_calendar_months": "every 3 months",
  "6_calendar_months": "every 6 months",
};
// What a row with NO cadence bills as today. Mirrors intervalFor(term) in
// api/website/checkout.js, so the card describes the charge that is really made
// rather than the one the term key implies.
const LEGACY_TERM_CADENCE_LABELS = {
  monthly: "every 4 weeks",
  "4_weeks": "every 4 weeks",
  "3_months": "every 3 months",
  "6_months": "every 6 months",
};
// Any other bounded <n>_months term bills calendar months when no cadence is
// set (intervalFor generalized the same way), so its legacy label follows suit.
function legacyTermCadenceLabel(term) {
  const m = /^(\d+)_months$/.exec(String(term || ""));
  return m && +m[1] >= 1 && +m[1] <= 24 ? `every ${m[1]} months` : null;
}
function cadenceOf(row) {
  const raw = row && row.billing_cadence != null ? String(row.billing_cadence).trim().toLowerCase() : "";
  return raw && Object.prototype.hasOwnProperty.call(CADENCE_LABELS, raw) ? raw : null;
}

// Pick the catalog row to charge for one offer_price_key: must be routable;
// prefer the canonical tier; otherwise the first routable row.
function pickRoutable(rows) {
  const routable = (rows || []).filter((r) => r.is_routable);
  if (!routable.length) return null;
  return routable.find((r) => r.tier === "canonical") || routable[0];
}

// `typedRows` are the offer_prices rows (the same rows checkout bills from).
// They are the ONLY place billing_cadence lives - pricing_catalog has no such
// column - so the cadence is looked up by offer_price_key rather than read off
// the catalog row. Optional and additive: no typed rows, or a schema without the
// column yet, and every entry simply reports the legacy cadence for its term.
function buildPricing(offer, catalogRows, typedRows) {
  const offerings = ((offer.data && offer.data.pricing && offer.data.pricing.pricing_offerings) || [])
    .filter((o) => o && !o.archived && String(o.type || "").toLowerCase() === "membership" && String(o.title || "").trim());

  // Index catalog rows by offer_price_key.
  const byKey = new Map();
  for (const r of catalogRows || []) {
    if (!r.offer_price_key) continue;
    if (!byKey.has(r.offer_price_key)) byKey.set(r.offer_price_key, []);
    byKey.get(r.offer_price_key).push(r);
  }
  // Cadence by the same key, from the typed rows. First one wins; a key with no
  // typed row is simply absent from the map.
  const cadenceByKey = new Map();
  for (const r of typedRows || []) {
    const k = r && r.source_offer_price_key;
    if (!k || cadenceByKey.has(k)) continue;
    cadenceByKey.set(k, cadenceOf(r));
  }

  const out = [];
  for (const o of offerings) {
    const title = String(o.title).trim();
    // Build S: the plan's one-time fee is its own catalog row, `<plan>|signup_fee`.
    // Charge/waive is an explicit owner choice per option (mirrors
    // signupFeeAppliesTo in api/website/checkout.js), so anything unanswered
    // waives it and the card shows no fee.
    const hasFee = parseFloat(o.signup_fee) > 0;
    const charges = (v) => hasFee && String(v || "").toLowerCase() === "charge";
    const planFee = pickRoutable(byKey.get(`${title}|signup_fee`));
    const options = [{ term: "monthly", key: `${title}|monthly`, included: o.whats_included || "", feeCharged: charges(o.signup_fee_on_base) }];
    for (const c of (o.commitments || [])) {
      const term = termFromLength(c.length);
      if (term) options.push({ term, key: `${title}|${term}`, included: c.whats_included || o.whats_included || "", feeCharged: charges(c.signup_fee_charge) });
    }
    for (const opt of options) {
      const row = pickRoutable(byKey.get(opt.key));
      const cadence = cadenceByKey.get(opt.key) || null;
      out.push({
        offer_price_key: opt.key,
        title,
        term: opt.term,
        term_label: termLabelOf(opt.term),
        whats_included: opt.included,
        available: !!row,
        amount_cents: row ? row.amount_cents : null,
        currency: row ? (row.currency || "cad") : null,
        plan: row ? row.canonical_plan : null,
        interval: row ? row.interval : null,
        // Build S: null when this plan has no fee OR this option waives it.
        signup_fee_cents: (planFee && opt.feeCharged) ? planFee.amount_cents : null,
        // ADDITIVE. billing_cadence is null for every row that has none, which is
        // every row today; cadence_label always says how the charge really
        // repeats, so a card can print it without knowing any of this.
        billing_cadence: cadence,
        cadence_label: CADENCE_LABELS[cadence] || LEGACY_TERM_CADENCE_LABELS[opt.term] || legacyTermCadenceLabel(opt.term) || null,
      });
    }
  }
  return out;
}

// Newest matching file's public URL for a given set of section keys.
async function fileUrl(offerId, sections) {
  const list = sections.map((s) => `"${s}"`).join(",");
  const files = await sbReq(
    `offer_files?offer_id=eq.${offerId}&section=in.(${list})&select=storage_path&order=created_at.desc&limit=1`
  );
  const path = files && files[0] && files[0].storage_path;
  return path ? `${SB_URL}/storage/v1/object/public/offers/${path}` : null;
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });
  const origin = req.headers.origin || "";
  let allowed = false;
  try { allowed = (await getAllowedOrigins()).has(origin); } catch { /* 403 below */ }
  if (allowed) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const { client_id } = req.query;
  const offerId = req.query.offer_id;
  if (!client_id) return res.status(400).json({ error: "client_id required" });

  try {
    // Pick the offer: explicit id, else the published training offer, else any
    // training offer (newest config wins).
    let offer;
    if (offerId) {
      const rows = await sbReq(`offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(client_id)}&select=id,title,type,status,data&limit=1`);
      offer = rows && rows[0];
    } else {
      const rows = await sbReq(`offers?client_id=eq.${encodeURIComponent(client_id)}&type=eq.training&select=id,title,type,status,data&order=status.asc,updated_at.desc`);
      offer = (rows || []).find((o) => o.status === "published") || (rows || [])[0];
    }
    if (!offer) return res.status(404).json({ error: "offer not found" });

    const catalogRows = await sbReq(
      `pricing_catalog?client_id=eq.${encodeURIComponent(client_id)}&offer_id=eq.${offer.id}` +
      `&select=offer_price_key,canonical_plan,interval,tier,is_routable,amount_cents,currency,stripe_price_id`
    );

    // Custom fields the owner defined in the offer wizard (the NEW system that
    // superseded the offer.data JSON list). Academy-core defs (offer_id null)
    // are collected on every offer; the offer's own defs are section-scoped
    // (sales = lead form, onboarding = join form). One read, split in memory.
    let coreDefs = [], salesDefs = [], onbDefs = [];
    try {
      // A def applies to this offer if offer_id = it OR a join row links it
      // (custom_field_def_offers, multi-offer). Fetch all client defs once, then
      // filter in memory - one extra tiny read for the links, degrades if the
      // join table has not been migrated yet.
      let linkedIds = new Set();
      try {
        const links = (await sbReq(`custom_field_def_offers?offer_id=eq.${offer.id}&select=field_id`)) || [];
        linkedIds = new Set(links.map((l) => l.field_id).filter(Boolean));
      } catch { /* join table not migrated yet - offer_id match still works */ }
      const defs = (await sbReq(
        `custom_field_defs?client_id=eq.${encodeURIComponent(client_id)}&archived=eq.false` +
        `&select=id,key,label,type,options,required,section,offer_id,help_text&order=position.asc`
      )) || [];
      for (const d of defs) {
        const appliesToOffer = d.offer_id === offer.id || linkedIds.has(d.id);
        if (!d.offer_id) coreDefs.push(d);          // academy-level: every offer
        else if (!appliesToOffer) continue;          // another offer's field, not linked here
        else if (d.section === "sales") salesDefs.push(d);
        else onbDefs.push(d); // onboarding (or unsectioned) offer defs default to the join form
      }
    } catch { /* additive - a defs failure never breaks the offer page */ }

    // Typed runtime rows: the authoritative "what can checkout sell" list
    // (offer tie-in step E). Frontends can send purchasable[].offer_price_id
    // to /api/website/checkout instead of the legacy offer_price_key.
    let purchasable = [], signupFees = [];
    try {
      // billing_cadence ships AHEAD of its migration, and PostgREST 400s the
      // WHOLE select over one unknown column - which on this path would empty the
      // purchasable list and take the enroll page's typed selectors with it. So
      // ask for the column, and on ANY failure fall back to the exact select that
      // shipped before it existed. Blind rather than narrow on purpose: sbReq
      // throws `Supabase <status>` and discards the body, so a 42703 is not
      // distinguishable here, and the fallback IS today's query - strictly better
      // than the empty list this catch would otherwise produce.
      const typedSelect = (withCadence) =>
        `offer_prices?tenant_id=eq.${encodeURIComponent(client_id)}&source_offer_id=eq.${offer.id}` +
        `&is_routable=eq.true&is_active=eq.true&order=sort_order.asc` +
        `&select=id,title,amount_cents,currency,billing_interval,source_offer_price_key${withCadence ? ",billing_cadence" : ""}`;
      try {
        purchasable = (await sbReq(typedSelect(true))) || [];
      } catch (_) {
        console.warn("[website/offer] offer_prices.billing_cadence is not readable yet (migration pending) - re-reading without it");
        purchasable = (await sbReq(typedSelect(false))) || [];
      }
      // Build S: a `<plan>|signup_fee` row is a one-time RIDER on an enrollment,
      // never something a parent can buy on its own. Keep it out of the
      // purchasable list (checkout attaches it as an invoice line instead) and
      // expose it separately so the plan cards can say "+ $X one-time".
      signupFees = purchasable.filter((p) => String(p.source_offer_price_key || "").split("|")[1] === "signup_fee");
      purchasable = purchasable.filter((p) => String(p.source_offer_price_key || "").split("|")[1] !== "signup_fee");
    } catch { /* additive block - never breaks the offer page */ }

    // Trial block: everything the FREE TRIAL funnel page needs, sourced from
    // the offer instead of hardcoded site constants. calendars = the offer's
    // calendar entry points (so re-pointing a calendar in the Entry Points
    // wizard re-points the live trial page); groups = the offer's schedule
    // classes (titles, ages, weekly times); copy = the Blueprint sales section.
    let trialCalendars = [];
    try {
      trialCalendars = (await sbReq(
        `entry_points?client_id=eq.${encodeURIComponent(client_id)}&offer_id=eq.${offer.id}` +
        `&type=eq.calendar&enabled=eq.true&order=label.asc&select=key,label,bookable_program_id`
      )) || [];
    } catch { /* additive - never breaks the offer page */ }
    const salesData = (offer.data && offer.data.sales) || {};
    const scheduleData = (offer.data && offer.data.schedule) || {};
    const trial = {
      sales_path: salesData.sales_path || null,
      duration_price: salesData.trial_duration_price || null,
      info_collect: Array.isArray(salesData.info_collect) ? salesData.info_collect : [],
      calendars: trialCalendars,
      groups: (Array.isArray(scheduleData.classes) ? scheduleData.classes : []).map((cls) => ({
        title: cls && cls.title ? String(cls.title) : null,
        age: cls && cls.age ? String(cls.age) : null,
        // The NUMERIC age range, so a client site can stop hardcoding one
        // academy's class boundary. `age` above stays and is unchanged: it is
        // free text an owner typed ("Elementary School", "Grades 5-8"), it is
        // what parent-facing copy shows, and it carries no reliable numeric
        // meaning - a grade is a different age in Ontario than in California,
        // which is exactly why nothing may machine-convert it.
        //
        // Passed through RAW. api/agent/_class-routing.js `classAgeRange()`
        // owns every rule about what these mean (both ends inclusive, "No
        // upper limit" beats a number left stranded in age_max when the owner
        // switched the toggle, neither bound set means unconfigured). A
        // consumer should port that function rather than re-derive it, or the
        // two repos drift and the drift is silent.
        age_min: cls && cls.age_min != null ? String(cls.age_min) : null,
        age_max: cls && cls.age_max != null ? String(cls.age_max) : null,
        age_max_mode: cls && cls.age_max_mode != null ? String(cls.age_max_mode) : null,
        // ⚠️ WHY `configured` CROSSES THE WIRE, and it is not a convenience.
        // An unconfigured class matches EVERY age by design, so academies did
        // not go dark the day the fields shipped. A site that cannot tell
        // "the offer fetch failed" from "the classes are present but nobody
        // has typed ages yet" has to guess, and both guesses are wrong: fail
        // closed and the page goes dark for every academy that has not filled
        // the fields in, which on day one is all of them except BAM GTA; fail
        // open and it shows a calendar the server will then refuse to book.
        // With this flag the site fails CLOSED on a failed fetch and DEFERS TO
        // THE SERVER when the classes are simply unconfigured.
        //
        // Read from classAgeRange() rather than recomputed here. The first
        // draft of this line inlined the same three-way test, which would have
        // been a second definition of "configured" in the exact commit whose
        // comment warns a consumer not to make one.
        age_configured: classAgeRange(cls).configured,
        weekly_times: (cls && Array.isArray(cls.weekly_times) ? cls.weekly_times : []).map((wt) => ({
          days: (wt && wt.days) || [],
          start: (wt && wt.start) || null,
          end: (wt && wt.end) || null,
        })),
      })),
    };

    const [agreementUrl, welcomeVideo] = await Promise.all([
      fileUrl(offer.id, ["onboarding:agreement", "agreement"]),
      fileUrl(offer.id, ["sales:welcome_video", "onboarding:welcome_video", "welcome_video"]),
    ]);

    // Activation telemetry (additive): the ops side live-checks the
    // sellable -> bookable chain from here without DB credentials (program
    // count + booking provider are not sensitive; CORS-gated like the rest).
    let activation = null;
    try {
      const [progs, clientRows] = await Promise.all([
        sbReq(`bookable_programs?tenant_id=eq.${encodeURIComponent(client_id)}&status=eq.ACTIVE&select=id,config&limit=5`),
        sbReq(`clients?id=eq.${encodeURIComponent(client_id)}&select=booking_provider&limit=1`),
      ]);
      activation = {
        active_programs: Array.isArray(progs) ? progs.length : 0,
        booking_provider: (clientRows && clientRows[0] && clientRows[0].booking_provider) || "ghl",
        last_run: (progs && progs[0] && progs[0].config && progs[0].config.activation_report) || null,
      };
    } catch { /* additive - never breaks the offer page */ }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      offer: {
        id: offer.id,
        title: offer.title || "Training",
        type: offer.type,
        sales_path: (offer.data && offer.data.sales && offer.data.sales.sales_path) || null,
      },
      intake_fields: buildIntakeFields(offer, [...coreDefs, ...onbDefs]),
      lead_fields: buildFields(offer, [...coreDefs, ...salesDefs], "sales"),
      // `purchasable` is passed for its billing_cadence only; every existing
      // pricing[] field still comes from the catalog rows exactly as before.
      pricing: buildPricing(offer, catalogRows, purchasable),
      purchasable,
      signup_fees: signupFees,
      trial,
      activation,
      agreement_url: agreementUrl,
      welcome_video: welcomeVideo,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
