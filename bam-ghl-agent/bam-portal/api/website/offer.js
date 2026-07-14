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

function fieldKey(label) {
  return String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

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
    if (/^(parent name|email|phone|name)$/i.test(s)) f.required = true;
    out.push(f);
  };
  const pushDefField = (def) => {
    const f = cfDefToField(def);
    if (!f.label) return;
    const k = f.label.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  if (section === "onboarding") TRAINING_INTAKE_DEFAULTS.forEach(pushLabelField);
  legacySelected.forEach(pushLabelField);
  legacyCustom.forEach((c) => pushLabelField(typeof c === "string" ? c : (c && c.name)));
  (customDefs || []).forEach(pushDefField);

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
function termFromLength(length) {
  const l = String(length || "").toLowerCase();
  const m = l.match(/(\d+)\s*month/);
  if (m) { const n = +m[1]; if (n >= 6) return "6_months"; if (n >= 3) return "3_months"; }
  if (/24\s*week/.test(l)) return "6_months";
  if (/12\s*week/.test(l)) return "3_months";
  return null;
}

const TERM_LABELS = { monthly: "Monthly (billed every 4 weeks)", "3_months": "3 months", "6_months": "6 months" };

// Pick the catalog row to charge for one offer_price_key: must be routable;
// prefer the canonical tier; otherwise the first routable row.
function pickRoutable(rows) {
  const routable = (rows || []).filter((r) => r.is_routable);
  if (!routable.length) return null;
  return routable.find((r) => r.tier === "canonical") || routable[0];
}

function buildPricing(offer, catalogRows) {
  const offerings = ((offer.data && offer.data.pricing && offer.data.pricing.pricing_offerings) || [])
    .filter((o) => o && !o.archived && String(o.type || "").toLowerCase() === "membership" && String(o.title || "").trim());

  // Index catalog rows by offer_price_key.
  const byKey = new Map();
  for (const r of catalogRows || []) {
    if (!r.offer_price_key) continue;
    if (!byKey.has(r.offer_price_key)) byKey.set(r.offer_price_key, []);
    byKey.get(r.offer_price_key).push(r);
  }

  const out = [];
  for (const o of offerings) {
    const title = String(o.title).trim();
    const options = [{ term: "monthly", key: `${title}|monthly`, included: o.whats_included || "" }];
    for (const c of (o.commitments || [])) {
      const term = termFromLength(c.length);
      if (term) options.push({ term, key: `${title}|${term}`, included: c.whats_included || o.whats_included || "" });
    }
    for (const opt of options) {
      const row = pickRoutable(byKey.get(opt.key));
      out.push({
        offer_price_key: opt.key,
        title,
        term: opt.term,
        term_label: TERM_LABELS[opt.term] || opt.term,
        whats_included: opt.included,
        available: !!row,
        amount_cents: row ? row.amount_cents : null,
        currency: row ? (row.currency || "cad") : null,
        plan: row ? row.canonical_plan : null,
        interval: row ? row.interval : null,
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
    let purchasable = [];
    try {
      purchasable = (await sbReq(
        `offer_prices?tenant_id=eq.${encodeURIComponent(client_id)}&source_offer_id=eq.${offer.id}` +
        `&is_routable=eq.true&is_active=eq.true&order=sort_order.asc` +
        `&select=id,title,amount_cents,currency,billing_interval,source_offer_price_key`
      )) || [];
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
      pricing: buildPricing(offer, catalogRows),
      purchasable,
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
