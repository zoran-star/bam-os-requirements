// WHAT STRIPE ACTUALLY SAID, kept instead of thrown away.
//
// Every caller in this repo used to ask Stripe for a connected account, read
// ONE boolean off the response (`charges_enabled`) and drop the rest on the
// floor. Two things went wrong because of that.
//
//   1. We told an academy owner "finish the remaining steps in Stripe" while
//      holding the list of those steps in a response we had already fetched.
//      The portal's three examples (business details, bank account, ID
//      verification) were generic prose, not that account's real requirements.
//
//   2. `if (!r.ok) return false` collapsed two different states into one. A
//      network blip, an expired platform key and a genuinely incomplete
//      account all produced the same `false`, the same stored row and the same
//      message. We could not tell "Stripe says this owner is not ready" from
//      "our call to Stripe did not work".
//
// So readStripeAccount() answers with THREE outcomes, never two, and carries
// the reason:
//
//   "ready"       charges_enabled === true. They can take money.
//   "not_ready"   Stripe answered and says no, plus WHY (requirements +
//                 disabled_reason).
//   "unreachable" we did not get an answer. We know nothing about the account.
//
// Callers that need the old boolean ask `outcome === "ready"`, which is false
// for both of the other two, so the stored status and the self-heal behave
// exactly as before. What changed is that the reason survives the call.
//
// Requirement codes are machine strings (`individual.verification.document`,
// `external_account`). describeRequirement() maps the ones we know to plain
// English. A code with no mapping is SHOWN, never dropped: an ugly line an
// owner can read out to support beats a silently missing one, which is the
// failure that made the generic copy look complete when it was not.
//
// Every item also carries its raw `codes`, mapped or not, so the label can
// never be the only thing on screen and a wrong mapping is still traceable.

// ── the top-level requirements, which name no person or company ─────────────
const TOP = {
  "external_account": "A bank account for Stripe to pay out to",
  "bank_account": "A bank account for Stripe to pay out to",
  "business_type": "Whether this account is an individual or a company",
  "business_profile.url": "Your business website address",
  "business_profile.mcc": "The industry category that matches your academy",
  "business_profile.product_description": "A description of what you sell",
  "business_profile.support_phone": "A support phone number",
  "business_profile.support_email": "A support email address",
  "business_profile.support_address": "A support address",
  "business_profile.name": "Your public business name",
  "tos_acceptance.date": "Acceptance of the Stripe services agreement",
  "tos_acceptance.ip": "Acceptance of the Stripe services agreement",
  "tos_acceptance.service_agreement": "Acceptance of the Stripe services agreement",
  "settings.dashboard.display_name": "The business name shown on receipts",
  "settings.payments.statement_descriptor": "The wording that appears on a parent's card statement",
};

// ── leaves that hang off a PERSON (individual / representative / person_xxx) ─
const PERSON_LEAF = {
  "first_name": "legal first name",
  "last_name": "legal last name",
  "maiden_name": "maiden name",
  "email": "email address",
  "phone": "phone number",
  "dob.day": "date of birth",
  "dob.month": "date of birth",
  "dob.year": "date of birth",
  "id_number": "government ID number",
  "id_number_secondary": "second government ID number",
  "ssn_last_4": "last 4 digits of their SSN",
  "address.line1": "street address",
  "address.line2": "street address",
  "address.city": "city",
  "address.state": "state or province",
  "address.postal_code": "postal code",
  "address.country": "country",
  "verification.document": "photo ID document",
  "verification.additional_document": "an extra proof-of-address document",
  "political_exposure": "political exposure declaration",
  "relationship.title": "job title",
  "relationship.owner": "whether they own 25% or more of the business",
  "relationship.director": "whether they are a director",
  "relationship.executive": "whether they are an executive",
  "relationship.representative": "whether they are the account representative",
  "relationship.percent_ownership": "how much of the business they own",
};

// ── leaves that hang off the COMPANY ────────────────────────────────────────
const COMPANY_LEAF = {
  "name": "registered business name",
  "name_kana": "registered business name",
  "name_kanji": "registered business name",
  "tax_id": "business tax ID",
  "vat_id": "VAT number",
  "phone": "business phone number",
  "structure": "business structure",
  "address.line1": "street address",
  "address.line2": "street address",
  "address.city": "city",
  "address.state": "state or province",
  "address.postal_code": "postal code",
  "address.country": "country",
  "verification.document": "business registration document",
  "owners_provided": "confirmation that everyone who owns 25% or more is listed",
  "directors_provided": "confirmation that every director is listed",
  "executives_provided": "confirmation that every executive is listed",
  "registration_number": "business registration number",
};

// ── why Stripe has payments switched off, when there is no item to fix ──────
const DISABLED_REASON = {
  "requirements.past_due": "Stripe is waiting on information that is now overdue.",
  "requirements.pending_verification": "Stripe is still verifying what you sent. This usually clears on its own.",
  "requirements.pending_onboarding": "Stripe onboarding has not been finished yet.",
  "listed": "Stripe has flagged this account and is reviewing it. Contact Stripe support.",
  "under_review": "Stripe is reviewing this account. Contact Stripe support if it stays this way.",
  "rejected.fraud": "Stripe rejected this account for suspected fraud. Only Stripe can reopen it.",
  "rejected.terms_of_service": "Stripe rejected this account for a terms of service breach. Only Stripe can reopen it.",
  "rejected.listed": "Stripe rejected this account after a review. Only Stripe can reopen it.",
  "rejected.incomplete_verification": "Stripe rejected this account because verification was never completed.",
  "rejected.other": "Stripe rejected this account. Only Stripe can tell you why.",
  "platform_paused": "Payments are paused on this account.",
  "other": "Stripe has payments switched off on this account and did not say which item is missing.",
};

const PERSON_PREFIX = /^person_[A-Za-z0-9]+\./;

// Plain English for ONE requirement code. Always returns a label; `mapped`
// says whether that label came from the tables above or from the fallback.
// The fallback keeps the raw code in the label on purpose, so an unknown
// requirement is legible rather than invisible.
export function describeRequirement(code) {
  const raw = String(code || "").trim();
  if (!raw) return { code: raw, label: "Stripe asks for something it did not name", mapped: false };

  if (TOP[raw]) return { code: raw, label: TOP[raw], mapped: true };

  let scope = null;
  let leaf = null;
  if (PERSON_PREFIX.test(raw)) {
    scope = "person";
    leaf = raw.replace(PERSON_PREFIX, "");
  } else if (raw.startsWith("individual.")) {
    scope = "individual";
    leaf = raw.slice("individual.".length);
  } else if (raw.startsWith("representative.")) {
    scope = "representative";
    leaf = raw.slice("representative.".length);
  } else if (raw.startsWith("company.")) {
    scope = "company";
    leaf = raw.slice("company.".length);
  }

  if (scope === "company" && COMPANY_LEAF[leaf]) {
    return { code: raw, label: `Your business: ${COMPANY_LEAF[leaf]}`, mapped: true };
  }
  if (scope && scope !== "company" && PERSON_LEAF[leaf]) {
    const who = scope === "individual" ? "The account owner's"
      : scope === "representative" ? "The account representative's"
        : "A person listed on the account:";
    // "The account owner's photo ID document" reads straight through; the
    // person_xxx form cannot, because we do not know their name here.
    return { code: raw, label: `${who} ${PERSON_LEAF[leaf]}`, mapped: true };
  }

  // NO MAPPING. Show the code. A requirement we cannot name is still a
  // requirement, and hiding it is what made "finish the remaining steps" a
  // dead end in the first place.
  return { code: raw, label: `Stripe asks for: ${raw}`, mapped: false };
}

// Collapse a list of codes into de-duplicated, plain-English items. The three
// date-of-birth codes are one thing to a human, so they land on one line, but
// every code that produced that line is kept on the item.
export function describeRequirements(codes) {
  const byLabel = new Map();
  for (const code of Array.isArray(codes) ? codes : []) {
    const d = describeRequirement(code);
    const hit = byLabel.get(d.label);
    if (hit) { if (!hit.codes.includes(d.code)) hit.codes.push(d.code); }
    else byLabel.set(d.label, { label: d.label, mapped: d.mapped, codes: [d.code] });
  }
  return [...byLabel.values()];
}

export function describeDisabledReason(reason) {
  const raw = String(reason || "").trim();
  if (!raw) return null;
  if (DISABLED_REASON[raw]) return { code: raw, label: DISABLED_REASON[raw], mapped: true };
  // Same rule as the requirement codes: an unknown reason is shown, not eaten.
  return { code: raw, label: `Stripe reports: ${raw}`, mapped: false };
}

// ── the one place anything in this repo asks Stripe about an account ────────
//
// THREE outcomes. `ready` is the only one that may tick an onboarding step or
// stamp stripe_connect_connected_at; `unreachable` must never be reported to
// an owner as "your account is not ready", because we do not know that.
export async function readStripeAccount(acctId, platformSecret, opts = {}) {
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const unreachable = (error) => ({
    outcome: "unreachable",
    ready: false,
    reachable: false,
    error,
    charges_enabled: null,
    details_submitted: null,
    disabled_reason: null,
    needs: [],
    reviewing: [],
    problems: [],
  });

  if (!acctId) return unreachable("no connected account id");
  if (!platformSecret) return unreachable("no Stripe platform key configured");

  let r, a;
  try {
    r = await doFetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(acctId)}`, {
      headers: { Authorization: `Bearer ${platformSecret}` },
    });
    a = await r.json();
  } catch (e) {
    return unreachable(`could not reach Stripe: ${e && e.message ? e.message : String(e)}`);
  }
  if (!r.ok) {
    const msg = (a && a.error && (a.error.message || a.error.code)) || `HTTP ${r.status}`;
    return unreachable(`Stripe answered ${r.status}: ${msg}`);
  }

  const req = (a && a.requirements) || {};
  // requirements.errors is Stripe telling us WHY something already submitted
  // was rejected ("The document is unreadable"). Without it an owner who
  // uploaded an ID that Stripe threw out just sees the same item asked for
  // again, with nothing to act on. `reason` is Stripe's own sentence and is
  // passed through verbatim; when there is none, the machine code is shown
  // rather than an empty line, the same rule as the requirement codes.
  const problems = (Array.isArray(req.errors) ? req.errors : []).map(e => ({
    requirement: (e && e.requirement) || null,
    label: (e && (e.reason || e.code)) || "Stripe rejected something and did not say what",
    what: e && e.requirement ? describeRequirement(e.requirement).label : null,
    code: (e && e.code) || null,
  }));
  // currently_due is what blocks charges today; past_due is the subset Stripe
  // has already chased. Union, because an academy needs to see both and Stripe
  // does not always repeat one inside the other.
  const due = [...(req.currently_due || []), ...(req.past_due || [])];
  return {
    outcome: a.charges_enabled === true ? "ready" : "not_ready",
    ready: a.charges_enabled === true,
    reachable: true,
    error: null,
    charges_enabled: a.charges_enabled === true,
    details_submitted: a.details_submitted === true,
    disabled_reason: describeDisabledReason(req.disabled_reason),
    needs: describeRequirements(due),
    reviewing: describeRequirements(req.pending_verification || []),
    problems,
  };
}

// ── the same question, asked with the ACADEMY'S OWN key ─────────────────────
//
// Direct-key academies (platform-locked Stripe, no Connect OAuth) are read via
// GET /v1/account with their restricted key as the bearer and NO Stripe-Account
// header - the key IS the account. Same describers, same three-outcome shape as
// readStripeAccount(), so nothing downstream can tell the transports apart.
//
// ONE addition to the shape: a 401/403 means THE KEY cannot answer - revoked,
// rolled, or stripped of its Account read permission. That is a fact about the
// stored credential, not about the network, so it comes back as outcome
// "unreachable" PLUS `credential_problem: true` and a reason that says so.
// A network failure stays plain unreachable with credential_problem absent -
// the resolver flips a key to 'invalid' only on the former, never the latter.
export async function readStripeAccountViaKey(key, opts = {}) {
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const unreachable = (error, extra = {}) => ({
    outcome: "unreachable",
    ready: false,
    reachable: false,
    error,
    charges_enabled: null,
    details_submitted: null,
    disabled_reason: null,
    needs: [],
    reviewing: [],
    problems: [],
    ...extra,
  });

  if (!key) return unreachable("no direct API key on file");

  let r, a;
  try {
    r = await doFetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${key}` },
    });
    a = await r.json();
  } catch (e) {
    return unreachable(`could not reach Stripe: ${e && e.message ? e.message : String(e)}`);
  }
  if (r.status === 401 || r.status === 403) {
    const msg = (a && a.error && (a.error.message || a.error.code)) || `HTTP ${r.status}`;
    return unreachable(
      `the stored key cannot answer for this account (Stripe ${r.status}: ${msg}) - it was revoked, rolled, or lost its Account read permission`,
      { credential_problem: true }
    );
  }
  if (!r.ok) {
    const msg = (a && a.error && (a.error.message || a.error.code)) || `HTTP ${r.status}`;
    return unreachable(`Stripe answered ${r.status}: ${msg}`);
  }

  const req = (a && a.requirements) || {};
  const problems = (Array.isArray(req.errors) ? req.errors : []).map(e => ({
    requirement: (e && e.requirement) || null,
    label: (e && (e.reason || e.code)) || "Stripe rejected something and did not say what",
    what: e && e.requirement ? describeRequirement(e.requirement).label : null,
    code: (e && e.code) || null,
  }));
  const due = [...(req.currently_due || []), ...(req.past_due || [])];
  return {
    outcome: a.charges_enabled === true ? "ready" : "not_ready",
    ready: a.charges_enabled === true,
    reachable: true,
    error: null,
    charges_enabled: a.charges_enabled === true,
    details_submitted: a.details_submitted === true,
    disabled_reason: describeDisabledReason(req.disabled_reason),
    needs: describeRequirements(due),
    reviewing: describeRequirements(req.pending_verification || []),
    problems,
  };
}

// ── what the owner reads after the OAuth round trip ─────────────────────────
//
// The old message said "Stripe connected, but it cannot accept payments yet.
// Finish the remaining steps in Stripe, then reconnect." Two things wrong with
// it. It never named a step, and "then reconnect" is the opposite of how this
// works: backfillStripeWhenChargeable() in api/action-items.js re-checks Stripe
// and ticks the step itself, so sending someone back through OAuth when the
// blocker is inside Stripe just loops them.
//
// Capped at `limit` characters because redirectBack() truncates the msg query
// param, and a message chopped mid-word is worse than a shorter one. Items are
// added only while the whole sentence still fits.
export function connectReturnMessage(status, limit = 280) {
  if (!status) return "";
  if (status.outcome === "unreachable") {
    // NOT "your account is not ready". We do not know that.
    return "Stripe is connected. We could not reach Stripe just now to check whether payments are switched on, so open the Stripe card on the Members tab to see where it stands.".slice(0, limit);
  }
  if (status.outcome === "ready") return "";

  const tail = " Finish that in Stripe. It ticks itself once Stripe says you can take payments, so there is no need to reconnect.";
  const head = "Stripe is connected but cannot take payments yet. Stripe still needs: ";
  const fallback = "Stripe is connected but cannot take payments yet. Open the Stripe card on the Members tab for the outstanding items. There is no need to reconnect.";

  const labels = (status.needs || []).map(n => n.label);
  if (!labels.length) {
    const why = status.disabled_reason && status.disabled_reason.label;
    const msg = why ? `Stripe is connected but cannot take payments yet. ${why} There is no need to reconnect.` : fallback;
    return msg.length <= limit ? msg : fallback.slice(0, limit);
  }

  const kept = [];
  for (const label of labels) {
    const next = [...kept, label];
    const more = labels.length - next.length;
    const line = `${head}${next.join("; ")}${more > 0 ? ` and ${more} more.` : "."}${tail}`;
    if (line.length > limit) break;
    kept.push(label);
  }
  if (!kept.length) return fallback.slice(0, limit);
  const more = labels.length - kept.length;
  return `${head}${kept.join("; ")}${more > 0 ? ` and ${more} more.` : "."}${tail}`;
}
