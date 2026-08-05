// STRIPE TRANSPORT PARITY: one member management system, two transports, and the
// proof that they produce the same bytes.
//
//   node api/_stripe-transport-parity.test.mjs
//
// WHAT THIS IS ABOUT. The direct-key transport (api/_stripe-transport.js) lets a
// platform-locked academy (San Jose / CoachIQ) run on its OWN restricted Stripe
// key while every Connect academy keeps today's platform-key + Stripe-Account
// envelope. The prime directive, ruled by Zoran 2026-07-31: the difference
// between the two transports is EXACTLY the auth envelope and nothing else.
// Nothing downstream may ever ask which transport it got. This suite is the
// enforcement: byte parity, a one-doorway scan with an enforced inventory, and
// wiring pins, each with a negative control that must PRINT when it catches.
//
// WHAT IT PROVES
//   A. THE ENVELOPES, declared in this file as literals (code agreeing with
//      itself cannot pass). The REAL resolver is driven with a recording fetch
//      and a stubbed Supabase answer: platform (null account) = platform bearer,
//      no Stripe-Account header, and NO database lookup at all - the test-mode
//      hazard is structurally unreachable; connect = platform bearer + header;
//      direct = the academy's own decrypted key, no header; keyOverride wins
//      without a lookup. The decrypted key appears in no error property.
//   B. BYTE PARITY. The SHIPPED checkout handler (source-text extraction, the
//      billing-cadence cut() technique - checkout.js pulls pdf-lib transitively
//      so it cannot be imported), the SHIPPED members.js pause/cancel/refund
//      actions (same technique), the receipts module (real import) and the
//      welcome email (real renderEmail) are each run under BOTH transports.
//      Every recorded request is serialized, EXACTLY the auth envelope is
//      stripped (Authorization + Stripe-Account on Stripe calls, plus the
//      resolver's own client_stripe_direct doorway lookup), and the remainder
//      must be byte-identical. The strict leg runs ONE academy (San Jose) both
//      ways, so there is nothing to normalize; the cross leg runs the GTA
//      snapshot (connect) against the San Jose snapshot (direct) with only the
//      two tenant identifiers tokenized. Any other difference fails and PRINTS
//      the differing bytes.
//   C. ONE DOORWAY. A scan over api/** (.js/.ts/.mjs/.cjs) + src/views: the
//      table names client_stripe_direct / stripe_academy_webhooks and the
//      transport-mode vocabulary may appear ONLY in the allowlisted doorway
//      files. Tier 2: every file that touches stripe_connect_account_id or
//      builds a Stripe Authorization header from env must carry a reasoned
//      verdict line in scripts/stripe-transport-inventory.txt - unlisted, stale
//      and rubber-stamp lines all fail, and the counts print on every run.
//   D. WIRING PINS. The 4 checkout return sites use publishableFor (and no
//      process.env.STRIPE_PUBLISHABLE_KEY remains in them); the 7 money gates
//      keep the 503 could-not-ask catch; webhook.js resolves the tenant BEFORE
//      verifying the signature; reconcile-activations skips only academies with
//      no Stripe transport at all.
//
// WHAT IT DOES NOT PROVE
//   - That the resolver picks the right row per account (api/_stripe-transport
//     .test.mjs) or that the hollowed helpers delegate (api/_stripe-callsite-
//     wave.test.mjs). Not duplicated here.
//   - buildCancellationSnapshot and the receipts/access-sync side calls inside
//     members.js are STUBBED in the extraction (they import runtime modules that
//     do not load on plain node); their own reads are out of this comparison.
//   - src/views (.jsx) is scanned RAW, comments included, because blank()
//     desyncs on JSX. Fail-closed: a comment mentioning the tables in a JSX
//     file fails the scan and a human widens nothing without reading it.
//   - Nothing here touches a network or a database; every remote answer is a
//     fixture from scripts/snapshots/bam-gta.json + bam-san-jose.json.
//
// FIXTURE DISCIPLINE. fixtureProblems() fails the run when either snapshot lacks
// a column the SHIPPED resolver's select strings name (a stale fixture passes
// for the wrong reason), and a tripwire fails the run if any snapshot value ever
// matches a real live-key shape ((sk|rk)_live_... / whsec_...): placeholder
// secrets are a rule, not a habit.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. One per run; each edits an IN-MEMORY copy of shipped source
// behind a loud pin (a mutation that fails to apply must never look like a
// passing check) and must PRINT "NEGATIVE CONTROL PASSED (<name>)":
//
//   MUTATE=plant-branch    plants `if (client.stripe_transport === "direct") {}`
//                          in a members.js copy -> the Tier-1 scan reports it
//                          with file:line.
//   MUTATE=plant-blanked   plants the same branch inside a comment -> the scan
//                          must stay SILENT about members.js (comment-blanking
//                          works; the control passes when NO hit is reported).
//   MUTATE=envelope-leak   the extracted checkout builder adds one body field on
//                          the direct run only -> the strict byte comparison
//                          catches it and prints the differing bytes.
//   MUTATE=testmode-leak   a transport copy routes a NULL stripeAccount to the
//                          direct row -> section A's platform-envelope assertion
//                          catches the wrong bearer / the forbidden lookup.
//   MUTATE=collapse        a gate copy answers 409 "not connected" when the
//                          clients read THREW -> section D's three-outcome gate
//                          assertion catches it.
//
// EXIT CODES read like the other control suites: a control run exits 0 when the
// mutation IS caught (the banner prints), 1 when it slipped through or its pin
// moved. CI greps for the banner, not the exit code.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, "..");
const SNAPS = path.resolve(HERE, "../../../scripts/snapshots");
const INVENTORY = path.join(PORTAL, "scripts", "stripe-transport-inventory.txt");

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ─── env, set BEFORE any portal module is imported ───────────────────────────
// Fixture values on purpose: none of them matches the live-key tripwire shapes,
// and the platform key doubles as the in-test envelope literal below.
const SB_HOST = "https://sb.parity.invalid";
process.env.VITE_SUPABASE_URL = SB_HOST;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb-service-FIXTURE";
process.env.STRIPE_CONNECT_SECRET_KEY = "sk_platform_FIXTURE";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.ONBOARDING_STRIPE_SECRET_KEY; // live-mode path: keyOverride stays undefined
process.env.STRIPE_PUBLISHABLE_KEY = "pk_platform_FIXTURE";
process.env.STRIPE_DIRECT_ENC_KEY = "parity-suite-enc-key-fixture";

// ─── snapshots ───────────────────────────────────────────────────────────────
const SNAP_GTA = JSON.parse(fs.readFileSync(path.join(SNAPS, "bam-gta.json"), "utf8"));
const SNAP_SJ = JSON.parse(fs.readFileSync(path.join(SNAPS, "bam-san-jose.json"), "utf8"));
const GTA = SNAP_GTA.client;
const SJ = SNAP_SJ.client;
const SJ_DIRECT = SNAP_SJ.client_stripe_direct;

// ─── shipped sources ─────────────────────────────────────────────────────────
const readSource = (rel) => fs.readFileSync(path.join(HERE, rel), "utf8");
const TRANSPORT_SRC = readSource("_stripe-transport.js");
const CHECKOUT_SRC = readSource("website/checkout.js");
const MEMBERS_SRC = readSource("members.js");
const WEB = CHECKOUT_SRC;
const ONB = readSource("onboarding/checkout.js");
const WEBHOOK = readSource("stripe/webhook.js");
const RECONCILE = readSource("stripe/reconcile-activations.js");

// ─── cutting shipped code out of shipped files (billing-cadence technique) ───
function cut(src, pin, where) {
  const at = src.indexOf(pin);
  if (at === -1) {
    controlBroken = `This suite is pinned to text that is no longer in api/${where}:\n\n${pin}\n\nRe-point it, or delete the section that uses it - a pin that fails to apply looks exactly like a check that passed.`;
    throw new Error(controlBroken);
  }
  // Every pin here ends with the declaration's OWN opening brace, so matching
  // starts there - a `{}` default parameter inside the signature cannot fool it.
  if (!pin.endsWith("{")) { controlBroken = `cut() pin must end with "{": ${pin}`; throw new Error(controlBroken); }
  let depth = 1;
  for (let i = at + pin.length; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(at, i + 1) + ";\n"; }
  }
  controlBroken = `unbalanced braces after ${pin} in api/${where}`;
  throw new Error(controlBroken);
}
// A brace-less declaration (a const line): the exact line, or fail loudly.
function cutLine(src, line, where) {
  if (!src.split("\n").some((l) => l === line)) {
    controlBroken = `This suite is pinned to a line that is no longer in api/${where}:\n\n${line}`;
    throw new Error(controlBroken);
  }
  return line + "\n";
}

// ─── frozen clock (both parity runs must mint identical timestamps) ──────────
const RealDate = Date;
const FROZEN_MS = RealDate.parse("2026-08-01T12:00:00Z");
const FROZEN_SEC = Math.floor(FROZEN_MS / 1000);
function freezeClock() {
  class FrozenDate extends RealDate {
    constructor(...args) { if (args.length === 0) { super(FROZEN_MS); } else { super(...args); } }
    static now() { return FROZEN_MS; }
  }
  globalThis.Date = FrozenDate;
}
function thawClock() { globalThis.Date = RealDate; }

// ─── the recording fetch ─────────────────────────────────────────────────────
// One router serves BOTH remote surfaces: Supabase REST (the fixture rows) and
// api.stripe.com (canned Stripe answers). Every request is recorded; anything
// unrouted throws, so a code path this suite did not model fails loudly instead
// of being silently absorbed.
let RECORDED = [];
let sbRoutes = [];       // [ [methodOrNull, regex over the /rest/v1/ tail, data|fn] ]
let stripeRoutes = [];   // [ [method, regex over the /v1 tail, data|fn] ]
let directRowsByAcct = {}; // acct id -> client_stripe_direct row served to the resolver
const realFetch = globalThis.fetch;

function jsonRes(data, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(data) };
}
function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    if (u.startsWith(`${SB_HOST}/rest/v1/`)) {
      const tail = u.slice(`${SB_HOST}/rest/v1/`.length);
      RECORDED.push({ kind: "sb", method, path: tail, headers: { ...(init.headers || {}) }, body: init.body ?? null });
      if (tail.startsWith("client_stripe_direct?")) {
        const m = tail.match(/stripe_account_id=eq\.([^&]+)/);
        const acct = m ? decodeURIComponent(m[1]) : null;
        const row = acct && directRowsByAcct[acct];
        return jsonRes(row ? [row] : []);
      }
      for (const [meth, re, data] of sbRoutes) {
        if ((meth == null || meth === method) && re.test(tail)) {
          return jsonRes(typeof data === "function" ? data({ method, path: tail, body: init.body }) : data);
        }
      }
      return jsonRes([]);
    }
    if (u.startsWith("https://api.stripe.com/v1")) {
      const tail = u.slice("https://api.stripe.com/v1".length);
      RECORDED.push({ kind: "stripe", method, path: tail, headers: { ...(init.headers || {}) }, body: init.body ?? null });
      for (const [meth, re, data] of stripeRoutes) {
        if (meth === method && re.test(tail)) {
          const d = typeof data === "function" ? data({ method, path: tail, body: init.body }) : data;
          return d && d.__status ? jsonRes(d.body, d.__status) : jsonRes(d);
        }
      }
      throw new Error(`parity suite: unrouted Stripe call ${method} ${tail}`);
    }
    throw new Error(`parity suite: unexpected fetch to ${u}`);
  };
}
function restoreFetch() { globalThis.fetch = realFetch; }

// ─── serialization + the parity comparator ───────────────────────────────────
// {kind, method, path, headers (sorted, envelope stripped), body} per request.
// The auth envelope is EXACTLY what gets stripped: Authorization + Stripe-Account
// on Stripe calls (the transport's whole output), nothing on Supabase calls (the
// service key is the same fixture on both runs, so a difference there is real),
// plus the resolver's own client_stripe_direct doorway lookup, which only the
// direct run makes and which IS the transport resolution, not the work.
function serializeSequence(records) {
  return records
    .filter((r) => !(r.kind === "sb" && r.path.startsWith("client_stripe_direct")))
    .map((r) => {
      const h = { ...r.headers };
      if (r.kind === "stripe") { delete h.Authorization; delete h["Stripe-Account"]; }
      const sorted = {};
      for (const k of Object.keys(h).sort()) sorted[k] = h[k];
      return JSON.stringify({ kind: r.kind, method: r.method, path: r.path, headers: sorted, body: r.body ?? null });
    });
}
function compareSequences(aRecs, bRecs, label, normalize = (s) => s) {
  const a = serializeSequence(aRecs).map(normalize);
  const b = serializeSequence(bRecs).map(normalize);
  let same = a.length === b.length && a.every((line, i) => line === b[i]);
  ok(same, `${label}: ${a.length} request(s), byte-identical outside the auth envelope`);
  if (!same) {
    console.log(`\n     THE DIFFERING BYTES (${label}):`);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) {
        console.log(`     request ${i + 1} of ${n}:`);
        console.log(`       connect: ${a[i] || "(absent)"}`);
        console.log(`       direct:  ${b[i] || "(absent)"}`);
      }
    }
    console.log("");
  }
  return same;
}

// ─── shared fixture data for the section B legs ──────────────────────────────
const OFFER_ID = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";
const PLAN_ROW = {
  id: "aaaa1111-op00-4000-8000-000000000001", title: "Steady", amount_cents: 22600, currency: "cad",
  billing_interval: "4_weeks", stripe_price_id: "price_PARITYPLAN", source_offer_id: OFFER_ID,
  source_offer_price_key: "Steady|4_weeks", is_active: true, is_routable: true, sort_order: 1, billing_cadence: null,
};
const FEE_ROW = {
  id: "aaaa1111-op00-4000-8000-000000000002", title: "Steady sign-up", amount_cents: 7500, currency: "cad",
  billing_interval: "signup_fee", stripe_price_id: "price_PARITYFEE", source_offer_id: OFFER_ID,
  source_offer_price_key: "Steady|signup_fee", is_active: true, is_routable: true, sort_order: 9,
};
const OFFER_DATA = { pricing: { pricing_offerings: [{ title: "Steady", signup_fee: "75", signup_fee_on_base: "Charge", commitments: [] }] } };

function checkoutSbRoutes(clientRow) {
  return [
    [null, /^clients\?select=allowed_domains/, [{ allowed_domains: ["parity.fixture"] }]],
    [null, /^clients\?id=eq\./, [clientRow]],
    [null, /^offer_prices\?tenant_id=.*source_offer_price_key=eq\.Steady%7C4_weeks/, [PLAN_ROW]],
    [null, /^offer_prices\?tenant_id=.*source_offer_price_key=eq\.Steady%7Csignup_fee/, [FEE_ROW]],
    [null, /^offers\?id=eq\./, [{ data: OFFER_DATA }]],
    [null, /^members\?client_id=/, []],
    ["POST", /^members\?select=id,agreement_pdf_path$/, [{ id: "mem-parity-1", agreement_pdf_path: null }]],
    ["POST", /^member_audit_log$/, null],
  ];
}
const CHECKOUT_STRIPE_ROUTES = [
  ["GET", /^\/customers\?/, { data: [] }],
  ["POST", /^\/customers$/, { id: "cus_PARITY" }],
  ["POST", /^\/subscriptions$/, {
    id: "sub_PARITY", status: "incomplete", customer: "cus_PARITY",
    latest_invoice: { confirmation_secret: { client_secret: "cs_PARITY_secret" } },
  }],
];
function checkoutReq(clientId) {
  return {
    method: "POST",
    headers: { origin: "https://parity.fixture" },
    body: {
      client_id: clientId, offer_id: OFFER_ID, offer_price_key: "Steady|4_weeks",
      parent: { first: "Maya", last: "Alvarez", email: "maya.alvarez@example.com", phone: "+1 555 0100" },
      athlete: { first: "Jordan", last: "Alvarez" },
      intake: {},
      agreement: { signature: "data:image/png;base64,PARITYSIG" },
    },
  };
}
const fakeRes = () => ({
  code: null, body: null, headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.code = c; return this; },
  json(o) { this.body = o; return this; },
  end() { return this; },
});

// The decryptable direct row the resolver is served: the SNAPSHOT keeps its
// placeholder ciphertext, the RUN swaps in real AES-GCM bytes minted from the
// fixture key so decryptSecret() exercises the shipped path.
let DIRECT_ROW = null; // filled after the crypto module import below

async function runLeg({ direct, fn }) {
  const { bustTransportCache } = await import(pathToFileURL(path.join(HERE, "_stripe-transport.js")).href);
  bustTransportCache();
  directRowsByAcct = direct ? { [SJ_DIRECT.stripe_account_id]: DIRECT_ROW } : {};
  RECORDED = [];
  await fn();
  return RECORDED.slice();
}

// ─── temp-module builders ────────────────────────────────────────────────────
const TEMP_FILES = [];
async function importTemp(name, sourceText) {
  const p = path.join(HERE, name);
  fs.writeFileSync(p, sourceText);
  TEMP_FILES.push(p);
  try { return await import(pathToFileURL(p).href); }
  finally { try { fs.unlinkSync(p); } catch (_) { /* best effort */ } }
}

function buildCheckoutModule() {
  return [
    'import { stripeFetch as transportStripeFetch, publishableFor } from "./_stripe-transport.js";',
    // The shipped isTestMode() and stripeFetch() both read the ONE normalized
    // ONBOARDING_STRIPE_SECRET_KEY, so the extraction has to bring that module
    // along or the cut functions throw ReferenceError.
    'import { isOnboardingTestMode, onboardingKeyOverride } from "./_stripe-onboarding-key.js";',
    // sb() guards the service key before it becomes a header, so the extraction
    // needs the guard too - without it sb() throws ReferenceError, the origin
    // check fails closed, and every leg below 403s instead of comparing bytes.
    'import { assertHeaderSafeCredential, safeFetch } from "./_header-safe-credential.js";',
    'import { applyDiscountToCents, normCode, couponFromPromo, couponCoversKey } from "./_coupon-guardrails.js";',
    "",
    cutLine(CHECKOUT_SRC, 'const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();', "website/checkout.js"),
    cutLine(CHECKOUT_SRC, 'const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();', "website/checkout.js"),
    cutLine(CHECKOUT_SRC, 'const DEV_ORIGINS = new Set(["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5500"]);', "website/checkout.js"),
    cutLine(CHECKOUT_SRC, "let originsCache = { set: null, at: 0 };", "website/checkout.js"),
    cutLine(CHECKOUT_SRC, "const ORIGINS_TTL_MS = 60_000;", "website/checkout.js"),
    cutLine(CHECKOUT_SRC, 'const CADENCE_COL = "billing_cadence";', "website/checkout.js"),
    cutLine(CHECKOUT_SRC, "const STRIPE_TRIAL_MAX_SECS = 729 * 86400;", "website/checkout.js"),
    cutLine(CHECKOUT_SRC, 'const TERM_NOUN = { "4_weeks": "every 4 weeks", "3_months": "every 3 months", "6_months": "every 6 months" };', "website/checkout.js"),
    cutLine(CHECKOUT_SRC, 'const COMMITMENT_TERMS = new Set(["3_months", "6_months"]);', "website/checkout.js"),
    cut(CHECKOUT_SRC, "function nowIso() {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function norm(s) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function clampStartDate(raw) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function sbKey() {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "async function sb(path, init = {}) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "async function getAllowedOrigins() {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function stripeKey() {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function isTestMode() {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function intervalFor(term) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "const CADENCES = {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function resolveInterval(row, term) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function cadenceWarning(iv) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "async function sbWithCadence(pathFor) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function addInterval(date, iv) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, 'async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {', "website/checkout.js"),
    cut(CHECKOUT_SRC, "function piSecretFromSub(sub) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function money(cents, currency) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function lengthMatchesTerm(length, term) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "async function signupFeeAppliesTo({ clientId, offerId, planText, term }) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "function _termKeyFromLength(length) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "async function resolveCommitmentRevert({ clientId, offerId, planText, term }) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "async function handler(req, res) {", "website/checkout.js"),
    cut(CHECKOUT_SRC, "async function maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId, offerId, signedDoc }) {", "website/checkout.js"),
    "export { handler };\n",
  ].join("\n");
}

function buildMembersModule() {
  return [
    'import crypto from "node:crypto";',
    'import { stripeFetch as transportStripeFetch } from "./_stripe-transport.js";',
    "// Stubbed side calls: they import runtime modules plain node cannot load, and",
    "// their reads are declared OUT of this comparison in the header.",
    "const syncMemberAccessNonFatal = async () => {};",
    "const buildCancellationSnapshot = async () => ({});",
    'const receiptsCall = async () => ({ skipped: "stubbed by the parity suite" });',
    "",
    cutLine(MEMBERS_SRC, "const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;", "members.js"),
    cutLine(MEMBERS_SRC, "const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;", "members.js"),
    cutLine(MEMBERS_SRC, "const STRIPE_TRIAL_MAX_SECS = 729 * 86400;", "members.js"),
    cut(MEMBERS_SRC, "function subCurrentPeriodEnd(sub) {", "members.js"),
    cut(MEMBERS_SRC, "function nowIso() {", "members.js"),
    cut(MEMBERS_SRC, "function nowUnix() {", "members.js"),
    cut(MEMBERS_SRC, "function isoToUnix(iso) {", "members.js"),
    cut(MEMBERS_SRC, "function unixToDateStr(unix) {", "members.js"),
    cut(MEMBERS_SRC, "function newRowOperationId() {", "members.js"),
    cut(MEMBERS_SRC, "async function sb(path, init = {}) {", "members.js"),
    cut(MEMBERS_SRC, 'async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {', "members.js"),
    cut(MEMBERS_SRC, "async function writeAudit({ client_id, member_id, action_type, args, performed_by, performed_by_name, stripe_response, db_changes }) {", "members.js"),
    cut(MEMBERS_SRC, "async function actionPause(res, member, stripeAccount, ctx, body) {", "members.js"),
    cut(MEMBERS_SRC, "async function actionCancel(res, member, stripeAccount, ctx, body) {", "members.js"),
    cut(MEMBERS_SRC, "async function actionRefund(res, member, stripeAccount, ctx, body) {", "members.js"),
    "export { actionPause, actionCancel, actionRefund };\n",
  ].join("\n");
}

// ─── section C: the one-doorway scanner ──────────────────────────────────────
// blank(), copied from scripts/check-network-booleans.mjs (importing that file
// would execute its whole gate). One addition: keepStrings. The Tier-1 targets
// are TABLE NAMES, which live INSIDE query strings - blanking strings would
// blind the scan to exactly the fork it hunts - so the scan text keeps string
// and template literal bytes and blanks only comments (and regex bodies). The
// original full-blanking mode is kept for the brace-balance self-test below,
// exactly as the source gate runs it.
function blankSrc(src, { keepStrings = false } = {}) {
  const out = src.split("");
  const n = src.length;
  const kill = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " "; };
  const killStr = keepStrings ? () => {} : kill;

  const REGEX_OK_AFTER = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "throw", "case", "do", "else", "yield", "await",
  ]);
  function regexAllowedAt(idx) {
    let j = idx - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;
    const ch = src[j];
    if (/[=(,:[!&|?{};+\-*%<>~^]/.test(ch)) return true;
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
      return REGEX_OK_AFTER.has(src.slice(k + 1, j + 1));
    }
    return false;
  }

  function scanTemplate(start) {
    let j = start + 1;
    let chunk = j;
    while (j < n) {
      const ch = src[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === "`") { killStr(chunk, j); return j + 1; }
      if (ch === "$" && src[j + 1] === "{") {
        killStr(chunk, j);
        j = scanCode(j + 2, true);
        chunk = j;
        continue;
      }
      j++;
    }
    killStr(chunk, n);
    return n;
  }

  function scanCode(start, untilCloseBrace) {
    let i = start, depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (untilCloseBrace) {
        if (c === "{") depth++;
        else if (c === "}") { if (depth === 0) return i + 1; depth--; }
      }
      if (c === "/" && d === "/") { let j = i; while (j < n && src[j] !== "\n") j++; kill(i, j); i = j; continue; }
      if (c === "/" && d === "*") { let j = src.indexOf("*/", i + 2); j = j < 0 ? n : j + 2; kill(i, j); i = j; continue; }
      if (c === "`") { i = scanTemplate(i); continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) break; j++; }
        killStr(i + 1, j); i = j + 1; continue;
      }
      if (c === "/" && regexAllowedAt(i)) {
        let j = i + 1, closed = false, inClass = false;
        while (j < n) {
          const ch = src[j];
          if (ch === "\\") { j += 2; continue; }
          if (ch === "\n") break;
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) { closed = true; break; }
          j++;
        }
        if (closed) { kill(i + 1, j); i = j + 1; continue; }
      }
      i++;
    }
    return n;
  }

  scanCode(0, false);
  return out.join("");
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".vercel", ".git", "coverage", "__fixtures__", "__goldens__", "snapshots", "__mutation__"]);
const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
function* walkDir(dir, exts) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walkDir(full, exts); }
    else if (exts.has(path.extname(e.name)) && !isTestFile(e.name) && !e.name.startsWith(".")) yield full;
  }
}
function loadScanSources() {
  const sources = new Map(); // abs path -> { raw, jsx }
  for (const f of walkDir(path.join(PORTAL, "api"), new Set([".js", ".mjs", ".cjs", ".ts"]))) {
    sources.set(f, { raw: fs.readFileSync(f, "utf8"), jsx: false });
  }
  for (const f of walkDir(path.join(PORTAL, "src", "views"), new Set([".js", ".jsx"]))) {
    sources.set(f, { raw: fs.readFileSync(f, "utf8"), jsx: path.extname(f) === ".jsx" });
  }
  return sources;
}

// The ONLY files allowed to say the tables' names or branch on the transport
// vocabulary (the approved plan's doorway list; tests are excluded from the walk
// and the migration lives outside the scanned tree).
const DOORWAY_ALLOWLIST = new Set([
  "api/_stripe-transport.js",
  "api/stripe/direct-key.js",
  "api/stripe/ensure-academy-webhook.js",
  "api/stripe/webhook.js",
  "api/stripe/cron-key-health.js",
  // The staff key-entry PANEL - the browser half of direct-key.js, named as the
  // doorway UI by the approved plan (section 4). It displays which transport an
  // academy runs ("Transport: direct key" badge); display of doorway state in
  // the doorway's own screen is not a fork. Caught by this scan during the
  // build and allowlisted WITH this note + a report to the orchestrator, not
  // silently.
  "src/views/StripeContactLinkView.jsx",
]);
const TABLE_NAMES = /client_stripe_direct|stripe_academy_webhooks/;
const VOCAB_PATTERNS = [
  /\bstripe_transport\b/,
  /\btransportLabel\b/,
  /\btransport_label\b/,
  /(?:===|!==|==|!=)\s*["'`](?:direct|connect)["'`]/,
  /["'`](?:direct|connect)["'`]\s*(?:===|!==|==|!=)/,
  /\.startsWith\(\s*["'`](?:direct|connect)[:"'`]/,
];

function scanOneDoorway(sources) {
  // Self-test first: the SAME tokenizer in full-blanking mode must keep every
  // api file brace-balanced, or the comment-blanking above is desynced too and
  // this scan is silently under-reporting. (JSX is exempt BECAUSE it fails this
  // - which is exactly why .jsx files are scanned raw, comments included.)
  const desynced = [];
  for (const [file, s] of sources) {
    if (s.jsx) continue;
    const b = blankSrc(s.raw, { keepStrings: false });
    let depth = 0, min = 0;
    for (const ch of b) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth < min) min = depth; }
    }
    if (depth !== 0 || min < 0) desynced.push(path.relative(PORTAL, file));
  }

  const tier1 = [];
  for (const [file, s] of sources) {
    const rel = path.relative(PORTAL, file);
    const text = s.jsx ? s.raw : blankSrc(s.raw, { keepStrings: true });
    text.split("\n").forEach((line, i) => {
      const table = TABLE_NAMES.test(line);
      const vocab = VOCAB_PATTERNS.some((p) => p.test(line));
      if ((table || vocab) && !DOORWAY_ALLOWLIST.has(rel)) {
        tier1.push({ rel, line: i + 1, why: table ? "table name" : "transport vocabulary", text: line.trim().slice(0, 120) });
      }
    });
  }

  const ENV_STRIPE_KEY = /process\.env\.[A-Z0-9_]*STRIPE[A-Z0-9_]*(?:KEY|SECRET)[A-Z0-9_]*/;
  const AUTHY = /Authorization|Bearer/;
  const tier2 = new Set();
  for (const [file, s] of sources) {
    const rel = path.relative(PORTAL, file);
    const text = s.jsx ? s.raw : blankSrc(s.raw, { keepStrings: true });
    const acct = /\bstripe_connect_account_id\b/.test(text);
    const envAuth = ENV_STRIPE_KEY.test(text) && AUTHY.test(text);
    if (acct || envAuth) tier2.add(rel);
  }
  return { desynced, tier1, tier2, fileCount: sources.size };
}

const INV_VERDICTS = new Set(["RESOLVER", "HOLLOWED", "PLATFORM_ONLY", "GATE", "OTHER"]);
const INV_MIN_REASON = 40;
function parseTransportInventory(text) {
  const entries = [];
  const errors = [];
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length !== 3) { errors.push(`line ${i + 1}: expected "VERDICT | file | reason", got ${parts.length} field(s)`); return; }
    const [verdict, file, reason] = parts;
    if (!INV_VERDICTS.has(verdict)) { errors.push(`line ${i + 1}: unknown verdict "${verdict}" (use ${[...INV_VERDICTS].join(", ")})`); return; }
    if (reason.length < INV_MIN_REASON) { errors.push(`line ${i + 1}: ${file} has a ${reason.length}-character reason. Say WHY this file's Stripe access is what its verdict claims, in at least ${INV_MIN_REASON} characters - a verdict nobody argued for is a rubber stamp.`); return; }
    entries.push({ verdict, file, reason, line: i + 1 });
  });
  return { entries, errors };
}

function runSectionC(sources, { silent = false } = {}) {
  const { desynced, tier1, tier2, fileCount } = scanOneDoorway(sources);
  const problems = [];
  if (desynced.length) {
    problems.push(`SELF-TEST FAILED: blank() desynced on ${desynced.length} file(s) (${desynced.slice(0, 4).join(", ")}). Brace depth does not return to zero, so the comment-blanking this scan reads through is unreliable and the scan is UNDER-REPORTING. Do not trust this run.`);
  }
  for (const h of tier1) {
    problems.push(`TRANSPORT FORK (Tier 1): ${h.rel}:${h.line} carries ${h.why} outside the doorway allowlist -> "${h.text}". The resolver is the ONLY file allowed to know a second transport exists; route this through api/_stripe-transport.js or argue the allowlist in review.`);
  }

  let invText = "";
  try { invText = fs.readFileSync(INVENTORY, "utf8"); }
  catch { problems.push(`Cannot read ${path.relative(PORTAL, INVENTORY)}. The inventory IS the Tier-2 gate; without it this scan proves nothing.`); }
  const { entries, errors } = parseTransportInventory(invText);
  for (const e of errors) problems.push(`inventory ${e}`);
  const known = new Map(entries.map((e) => [e.file, e]));
  const unlisted = [...tier2].filter((rel) => !known.has(rel)).sort();
  const stale = entries.filter((e) => !tier2.has(e.file));
  for (const rel of unlisted) {
    problems.push(`NEW UNAUDITED STRIPE ACCESS (Tier 2): ${rel} references stripe_connect_account_id or builds a Stripe env-key Authorization header and has no line in scripts/stripe-transport-inventory.txt. Add a verdict (RESOLVER / HOLLOWED / PLATFORM_ONLY / GATE / OTHER) with a real reason, or route it through the resolver.`);
  }
  for (const e of stale) {
    problems.push(`STALE INVENTORY LINE (Tier 2): stripe-transport-inventory.txt:${e.line} lists ${e.file}, which no longer matches the scan. Delete the line or the counts below are fiction.`);
  }

  if (!silent) {
    const counts = {};
    for (const v of INV_VERDICTS) counts[v] = 0;
    for (const e of entries) if (tier2.has(e.file)) counts[e.verdict]++;
    console.log(`\n  Stripe-transport inventory - ${tier2.size} file(s) touch Stripe account routing (${fileCount} files scanned):`);
    console.log(`    RESOLVER      ${String(counts.RESOLVER).padStart(3)}  the doorway itself (transport, key entry, webhook routing)`);
    console.log(`    HOLLOWED      ${String(counts.HOLLOWED).padStart(3)}  local helper delegates to the transport; zero call-site diffs`);
    console.log(`    PLATFORM_ONLY ${String(counts.PLATFORM_ONLY).padStart(3)}  BAM's own Stripe; must NEVER route through the resolver`);
    console.log(`    GATE          ${String(counts.GATE).padStart(3)}  reads the stored account field only to gate, never to fetch`);
    console.log(`    OTHER         ${String(counts.OTHER).padStart(3)}  explained case (see the line's reason)`);
  }
  return { problems, tier1, tier2 };
}

// ─── section D: the wiring pins (pure source-text checks, reusable by MUTATE) ─
function checkGate503(src, label) {
  const out = [];
  const catch503 = /\} catch \{\s*return res\.status\(503\)\.json\(\{ error: "could not verify billing setup, try again" \}\);\s*\}/g;
  const found = (src.match(catch503) || []).length;
  out.push({ ok: found >= 1, msg: `${label}: a clients read that THREW answers 503 could-not-ask (${found} gate catch(es))`, found });
  out.push({ ok: !/catch \{\s*return res\.status\(409\)/.test(src) && !/catch \{\s*return res\.status\(400\)/.test(src),
    msg: `${label}: no catch converts a failed read into the not-connected answer` });
  return out;
}
function runSectionD({ web = WEB } = {}) {
  const results = [];
  // The 4 checkout return sites: website/checkout.js x2 + onboarding/checkout.js x2.
  // The shipped build kept process.env.STRIPE_PUBLISHABLE_KEY in exactly ONE
  // form: the `.catch()` fallback ON the publishableFor call itself, so a
  // resolver throw degrades to today's platform behavior instead of 500ing a
  // paying parent. The pin therefore says: every return site asks publishableFor,
  // and the env var appears ONLY inside that attached fallback - a bare env read
  // deciding the browser mount is the regression this catches. (For a DIRECT
  // academy that fallback serves the platform pk + its account id, which
  // Stripe.js cannot mount; reported to the orchestrator as a known degraded
  // outage state, not silently pinned as intended.)
  const FALLBACK = "publishableFor(stripeAccount).catch(() => ({ publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null, stripe_account: stripeAccount || null }))";
  for (const [label, src] of [["website/checkout.js", web], ["onboarding/checkout.js", ONB]]) {
    const sites = (src.match(/publishableFor\(stripeAccount\)/g) || []).length;
    const guarded = src.split(FALLBACK).length - 1;
    const envReads = (src.match(/process\.env\.STRIPE_PUBLISHABLE_KEY/g) || []).length;
    results.push({ ok: sites === 2, msg: `${label}: both return sites ask the resolver's publishableFor (saw ${sites})` });
    results.push({ ok: guarded === 2 && envReads === 2,
      msg: `${label}: STRIPE_PUBLISHABLE_KEY survives ONLY as publishableFor's own .catch fallback (${guarded} guarded of ${envReads} env read(s))` });
  }
  // The 7 money gates carry the 503 could-not-ask catch.
  let gateCount = 0;
  for (const [label, src, want] of [
    ["website/checkout.js", web, 1],
    ["onboarding/checkout.js", ONB, 1],
    ["members.js", MEMBERS_SRC, 1],
    ["members/enroll.js", readSource("members/enroll.js"), 1],
    ["offers/create-price.js", readSource("offers/create-price.js"), 2],
    ["offers/match-prices.js", readSource("offers/match-prices.js"), 1],
  ]) {
    const rs = checkGate503(src, label);
    results.push(...rs.map(({ ok, msg }) => ({ ok, msg })));
    const found = rs[0].found;
    results.push({ ok: found === want, msg: `${label}: exactly ${want} gate(s) carry the catch (saw ${found})` });
    gateCount += Math.min(found, want);
  }
  results.push({ ok: gateCount === 7, msg: `all 7 money gates carry the 503 could-not-ask catch (saw ${gateCount})` });
  // webhook.js: the tenant (and therefore the signing secret) is resolved BEFORE
  // the signature is verified - the per-academy secret cannot exist otherwise.
  const handlerAt = WEBHOOK.indexOf("async function handler(req, res) {");
  const routeAt = WEBHOOK.indexOf("const routing = await resolveTenantContext(req);");
  const verifyAt = WEBHOOK.indexOf("verifyStripeSignature(rawBody, sig, routing.secret)");
  results.push({ ok: handlerAt >= 0 && routeAt > handlerAt && verifyAt > routeAt,
    msg: "webhook.js: resolveTenantContext(req) runs before verifyStripeSignature, in source order, inside the handler" });
  results.push({ ok: WEBHOOK.includes("if (!routing) {"),
    msg: "webhook.js: an unknown routing token is a terminal 401, not a fallback to the platform secret" });
  // reconcile-activations: the only skip left is "no Stripe transport at all" -
  // a direct academy (which stores its acct id at key save) is reconciled like
  // any Connect academy, through the resolver.
  results.push({ ok: RECONCILE.includes("return transportStripeFetch(path, { stripeAccount });"),
    msg: "reconcile-activations.js: the sub fetch rides the resolver" });
  results.push({ ok: RECONCILE.includes('if (!account) return { member_id: member.id, skipped: "no stripe transport" };'),
    msg: "reconcile-activations.js: the skip fires only for an academy with NO transport at all" });
  results.push({ ok: !RECONCILE.includes("stripe_connect_status") && !RECONCILE.includes("no connected account"),
    msg: "reconcile-activations.js: no Connect-only status gate strands a direct academy's stuck signups" });
  return results;
}

// ─── fixture discipline ──────────────────────────────────────────────────────
function fixtureProblems() {
  const out = [];
  // Every column the SHIPPED resolver's select strings name must exist in the
  // snapshots. If a select grows a column and the fixture does not, every parity
  // run below keeps passing against a version of reality that no longer exists.
  const dsMatch = TRANSPORT_SRC.match(/const DIRECT_SELECT = "([^"]+)"/);
  if (!dsMatch) out.push("SNAPSHOT STALE: api/_stripe-transport.js no longer declares DIRECT_SELECT as a string literal; this guard cannot read the resolver's select and proves nothing. Re-point it.");
  else {
    for (const col of dsMatch[1].split(",")) {
      if (!(col in SJ_DIRECT)) out.push(`SNAPSHOT STALE: the resolver selects client_stripe_direct.${col} but scripts/snapshots/bam-san-jose.json's client_stripe_direct block has no "${col}" key.`);
    }
  }
  const clientSel = TRANSPORT_SRC.match(/select=id,stripe_connect_account_id,stripe_connect_status/);
  if (!clientSel) out.push("SNAPSHOT STALE: the resolver's clients select (id,stripe_connect_account_id,stripe_connect_status) moved; re-point this guard.");
  for (const col of ["id", "stripe_connect_account_id", "stripe_connect_status"]) {
    if (!(col in GTA)) out.push(`SNAPSHOT STALE: bam-gta.json client has no "${col}" (the resolver selects it).`);
    if (!(col in SJ)) out.push(`SNAPSHOT STALE: bam-san-jose.json client has no "${col}" (the resolver selects it).`);
  }
  // The direct fixture must BE the direct fixture: SJ's real account id, active,
  // placeholder secrets.
  if (SJ_DIRECT.stripe_account_id !== SJ.stripe_connect_account_id) out.push("SNAPSHOT STALE: bam-san-jose.json's client_stripe_direct.stripe_account_id does not match the client row's stripe_connect_account_id.");
  if (SJ_DIRECT.status !== "active") out.push('SNAPSHOT STALE: bam-san-jose.json client_stripe_direct.status is not "active" - the resolver only routes on an active row, so every direct leg below would silently run Connect.');
  // The secret tripwire: NOTHING in either snapshot may look like a real live
  // key. Placeholders or the run dies.
  const LIVE_KEY = /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}|\bwhsec_[A-Za-z0-9]{20,}/;
  const sweep = (node, file, at) => {
    if (typeof node === "string") { if (LIVE_KEY.test(node)) out.push(`SECRET TRIPWIRE: ${file} carries a live-key-shaped value at ${at}. Snapshots hold PLACEHOLDERS only; a real key in a committed fixture is an incident, not a test input.`); return; }
    if (Array.isArray(node)) { node.forEach((v, i) => sweep(v, file, `${at}[${i}]`)); return; }
    if (node && typeof node === "object") { for (const [k, v] of Object.entries(node)) sweep(v, file, `${at}.${k}`); }
  };
  sweep(SNAP_GTA, "bam-gta.json", "$");
  sweep(SNAP_SJ, "bam-san-jose.json", "$");
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROLS (one per run, each prints its banner)
// ═════════════════════════════════════════════════════════════════════════════
if (MUTATE === "plant-branch" || MUTATE === "plant-blanked") {
  const pin = "    const stripeAccount = client.stripe_connect_account_id;";
  if (!MEMBERS_SRC.includes(pin)) {
    console.log(`❌ NEGATIVE CONTROL FAILED (${MUTATE}): the members.js pin moved:\n${pin}`);
    process.exit(1);
  }
  const branch = 'if (client.stripe_transport === "direct") {}';
  const planted = MEMBERS_SRC.replace(pin,
    MUTATE === "plant-branch" ? `${pin}\n    ${branch}` : `${pin}\n    // ${branch}`);
  const sources = loadScanSources();
  sources.set(path.join(HERE, "members.js"), { raw: planted, jsx: false });
  const { tier1 } = runSectionC(sources, { silent: true });
  const hits = tier1.filter((h) => h.rel === "api/members.js");
  if (MUTATE === "plant-branch") {
    if (hits.length) {
      console.log(`NEGATIVE CONTROL PASSED (plant-branch) - a transport branch planted in members.js was caught by the Tier-1 vocabulary scan at ${hits[0].rel}:${hits[0].line}: "${hits[0].text}".`);
      process.exit(0);
    }
    console.log("❌ NEGATIVE CONTROL FAILED (plant-branch) - a live transport branch in members.js and the one-doorway scan said nothing. The scan is decorative.");
    process.exit(1);
  } else {
    if (!hits.length) {
      console.log("NEGATIVE CONTROL PASSED (plant-blanked) - the same branch inside a comment produced NO Tier-1 hit for members.js: comment-blanking discriminates, so the scan will not be red on prose and then switched off.");
      process.exit(0);
    }
    console.log(`❌ NEGATIVE CONTROL FAILED (plant-blanked) - a COMMENT tripped the Tier-1 scan (${hits[0].rel}:${hits[0].line}). A gate that fires on prose gets disabled.`);
    process.exit(1);
  }
}

if (MUTATE === "collapse") {
  const pin = 'return res.status(503).json({ error: "could not verify billing setup, try again" });';
  if (!WEB.includes(pin)) {
    console.log("❌ NEGATIVE CONTROL FAILED (collapse): website/checkout.js's 503 gate line moved; the control cannot run.");
    process.exit(1);
  }
  const mutated = WEB.replace(pin, 'return res.status(409).json({ error: "academy is not connected to Stripe" });');
  const results = runSectionD({ web: mutated });
  const caught = results.filter((r) => !r.ok);
  if (caught.length) {
    console.log(`NEGATIVE CONTROL PASSED (collapse) - a gate answering 409 not-connected on a THROWN clients read was caught by ${caught.length} section-D assertion(s):\n   - ${caught.slice(0, 3).map((r) => r.msg).join("\n   - ")}`);
    process.exit(0);
  }
  console.log("❌ NEGATIVE CONTROL FAILED (collapse) - an outage now reads as 'not connected' and section D said nothing.");
  process.exit(1);
}

// The remaining controls (testmode-leak, envelope-leak) and the real run share
// the executable machinery below.

// ─── crypto + the runtime direct row ─────────────────────────────────────────
const CRYPTO = await import(pathToFileURL(path.join(HERE, "_stripe-direct-crypto.js")).href);
DIRECT_ROW = { ...SJ_DIRECT, secret_key_enc: CRYPTO.encryptSecret("rk_academy_FIXTURE") };

if (MUTATE === "testmode-leak") {
  // Mutate a COPY of the shipped transport so a null stripeAccount resolves like
  // a direct academy. Section A's platform-envelope assertion must catch it.
  const pin = '  if (!stripeAccount) return { bearer: platformKey(), accountHeader: null, label: "platform" };';
  if (!TRANSPORT_SRC.includes(pin)) {
    console.log("❌ NEGATIVE CONTROL FAILED (testmode-leak): the transport's null-account line moved; the control cannot run.");
    process.exit(1);
  }
  const mutated = TRANSPORT_SRC.replace(pin, '  if (!stripeAccount) stripeAccount = "acct_1RDtSMK6ZS1cqefu";   // MUTATED: test mode reaches the academy transport');
  installFetch();
  let caughtBy = null;
  try {
    const M = await importTemp(".stripe-parity-mutated-transport.mjs", mutated);
    directRowsByAcct = { [SJ_DIRECT.stripe_account_id]: DIRECT_ROW };
    stripeRoutes = [["GET", /^\/customers/, { data: [] }]];
    RECORDED = [];
    await M.stripeFetch("/customers?limit=1", {});
    const stripeRec = RECORDED.find((r) => r.kind === "stripe");
    const sbLookups = RECORDED.filter((r) => r.kind === "sb");
    if (stripeRec.headers.Authorization !== "Bearer sk_platform_FIXTURE") {
      caughtBy = `the platform envelope assertion: a NULL stripeAccount was sent with "${String(stripeRec.headers.Authorization).slice(0, 14)}..." instead of the platform bearer`;
    } else if (sbLookups.length > 0) {
      caughtBy = "the no-lookup assertion: a NULL stripeAccount performed a client_stripe_direct lookup, which is the doorway to the wrong account";
    }
  } finally { restoreFetch(); }
  if (caughtBy) {
    console.log(`NEGATIVE CONTROL PASSED (testmode-leak) - test mode routed to the academy transport and was caught by ${caughtBy}.`);
    process.exit(0);
  }
  console.log("❌ NEGATIVE CONTROL FAILED (testmode-leak) - a null account reached the academy key and section A's envelope assertions never noticed. A test-mode bug is now a live charge on the wrong Stripe account.");
  process.exit(1);
}

// ═════════════════════════════════════════════════════════════════════════════
// THE REAL RUN (plus envelope-leak, which rides section B)
// ═════════════════════════════════════════════════════════════════════════════

// ─── 0. fixture discipline ───────────────────────────────────────────────────
console.log("\n── 0. fixture discipline: snapshots fresh, secrets placeholder ──");
{
  const problems = fixtureProblems();
  ok(problems.length === 0, "both snapshots carry every resolver-selected column and no live-key-shaped value");
  for (const p of problems) console.log("     " + p);
  if (problems.length) {
    console.log(`\n❌ ${pass} passed, ${fail} failed. (fixtures are stale or unsafe - nothing below can be trusted)`);
    process.exit(1);
  }
}

const T = await import(pathToFileURL(path.join(HERE, "_stripe-transport.js")).href);

// ─── A. the envelopes, against in-test literals ──────────────────────────────
console.log("\n── A. the three envelopes, byte-for-byte against literals declared HERE ──");
// Declared in this file on purpose: read from the code, the code would only ever
// be checked against itself.
const LEGACY_ENVELOPES = {
  platform: { authorization: "Bearer sk_platform_FIXTURE", account: undefined },
  connect: { authorization: "Bearer sk_platform_FIXTURE", account: GTA.stripe_connect_account_id },
  direct: { authorization: "Bearer rk_academy_FIXTURE", account: undefined },
};
installFetch();
try {
  stripeRoutes = [
    ["GET", /^\/customers/, { data: [] }],
    ["POST", /^\/charges$/, { __status: 402, body: { error: { message: "Your card was declined." } } }],
  ];

  // platform / null: no header, platform bearer, and NO lookup of any kind.
  T.bustTransportCache();
  directRowsByAcct = { [SJ_DIRECT.stripe_account_id]: DIRECT_ROW };
  RECORDED = [];
  await T.stripeFetch("/customers?limit=1", {});
  let rec = RECORDED.find((r) => r.kind === "stripe");
  ok(rec.headers.Authorization === LEGACY_ENVELOPES.platform.authorization, `platform: Authorization is byte-for-byte "${LEGACY_ENVELOPES.platform.authorization}"`);
  ok(!("Stripe-Account" in rec.headers), "platform: no Stripe-Account header exists at all");
  ok(RECORDED.filter((r) => r.kind === "sb").length === 0,
    "platform: a NULL stripeAccount performs NO database lookup - the test-mode path cannot even see the direct table");

  // connect: platform bearer + the account header, no direct row for GTA.
  T.bustTransportCache();
  RECORDED = [];
  await T.stripeFetch("/customers?limit=1", { stripeAccount: GTA.stripe_connect_account_id });
  rec = RECORDED.find((r) => r.kind === "stripe");
  ok(rec.headers.Authorization === LEGACY_ENVELOPES.connect.authorization, "connect: Authorization is the platform bearer");
  ok(rec.headers["Stripe-Account"] === LEGACY_ENVELOPES.connect.account, `connect: Stripe-Account is byte-for-byte "${LEGACY_ENVELOPES.connect.account}"`);

  // direct: the academy's own decrypted key, NO header.
  T.bustTransportCache();
  RECORDED = [];
  await T.stripeFetch("/customers?limit=1", { stripeAccount: SJ_DIRECT.stripe_account_id });
  rec = RECORDED.find((r) => r.kind === "stripe");
  ok(rec.headers.Authorization === LEGACY_ENVELOPES.direct.authorization, "direct: Authorization is the academy's own key (decrypted through the shipped crypto)");
  ok(!("Stripe-Account" in rec.headers), "direct: the key IS the account, so no Stripe-Account header exists");

  // keyOverride: wins without a lookup, header preserved as the caller intended.
  T.bustTransportCache();
  RECORDED = [];
  await T.stripeFetch("/customers?limit=1", { stripeAccount: SJ_DIRECT.stripe_account_id, keyOverride: "sk_test_override_FIXTURE" });
  rec = RECORDED.find((r) => r.kind === "stripe");
  ok(rec.headers.Authorization === "Bearer sk_test_override_FIXTURE" && rec.headers["Stripe-Account"] === SJ_DIRECT.stripe_account_id,
    "keyOverride: the caller's key + the caller's header, exactly as passed");
  ok(RECORDED.filter((r) => r.kind === "sb").length === 0, "keyOverride: short-circuits - no direct-row lookup happens");

  // The decrypted key leaks into NO error surface.
  T.bustTransportCache();
  RECORDED = [];
  let err = null;
  try { await T.stripeFetch("/charges", { method: "POST", body: { amount: 1 }, stripeAccount: SJ_DIRECT.stripe_account_id }); } catch (e) { err = e; }
  const errDump = JSON.stringify({ message: err && err.message, stripeStatus: err && err.stripeStatus, stripeResponse: err && err.stripeResponse, responseBody: err && err.responseBody, transportLabel: err && err.transportLabel });
  ok(!!err && err.stripeStatus === 402 && !errDump.includes("rk_academy_FIXTURE"),
    "direct errors: full superset shape, and the decrypted key appears in none of it");
} finally { restoreFetch(); }

// ─── B. byte parity across the transports ────────────────────────────────────
console.log("\n── B. byte parity: the same work, twice, differing ONLY in the envelope ──");
installFetch();
freezeClock();
try {
  // (1) the SHIPPED checkout handler, extracted by declaration line.
  let checkoutA = buildCheckoutModule();  // connect instance
  let checkoutB = buildCheckoutModule();  // direct instance
  if (MUTATE === "envelope-leak") {
    const pin = '"metadata[origin]": "fullcontrol-website-enrollment",';
    if (!checkoutB.includes(pin)) {
      console.log("❌ NEGATIVE CONTROL FAILED (envelope-leak): the subscription-body pin moved; the control cannot run.");
      restoreFetch(); thawClock(); process.exit(1);
    }
    checkoutB = checkoutB.replace(pin, `${pin} "metadata[transport]": "direct",`);
  }
  const modA = await importTemp(".stripe-parity-checkout-a.mjs", checkoutA);
  const modB = await importTemp(".stripe-parity-checkout-b.mjs", checkoutB);
  stripeRoutes = CHECKOUT_STRIPE_ROUTES;

  // STRICT LEG: one academy (San Jose), both transports. Nothing to normalize;
  // any non-envelope difference is a fork.
  sbRoutes = checkoutSbRoutes(SJ);
  const resA = fakeRes();
  const seqConnect = await runLeg({ direct: false, fn: () => modA.handler(checkoutReq(SJ.id), resA) });
  const resB = fakeRes();
  const seqDirect = await runLeg({ direct: true, fn: () => modB.handler(checkoutReq(SJ.id), resB) });
  ok(resA.code === 200 && resB.code === 200, `checkout ran to a 200 on both transports (saw ${resA.code}/${resB.code}${resA.code !== 200 ? `: ${JSON.stringify(resA.body).slice(0, 120)}` : ""})`);
  const strictSame = compareSequences(seqConnect, seqDirect, "checkout, San Jose as connect vs San Jose as direct");

  if (MUTATE === "envelope-leak") {
    restoreFetch(); thawClock();
    if (!strictSame) {
      console.log("NEGATIVE CONTROL PASSED (envelope-leak) - the direct run's subscription body grew one field and the strict byte comparison caught it (differing bytes printed above).");
      process.exit(0);
    }
    console.log("❌ NEGATIVE CONTROL FAILED (envelope-leak) - the direct transport sent a different body and the parity comparison called it identical. The comparison is decorative.");
    process.exit(1);
  }

  // The browser transport facts are the ONLY sanctioned response difference.
  ok(resA.body && resA.body.stripe_account === SJ.stripe_connect_account_id && resA.body.publishable_key === "pk_platform_FIXTURE",
    "connect response: platform publishable key + the connected account id (today's browser contract)");
  ok(resB.body && resB.body.stripe_account === null && resB.body.publishable_key === SJ_DIRECT.publishable_key,
    "direct response: the ACADEMY's publishable key + stripe_account null (Stripe.js mounts on its own account)");
  {
    const strip = (b) => JSON.stringify({ ...b, stripe_account: "<TRANSPORT>", publishable_key: "<TRANSPORT>" });
    ok(strip(resA.body) === strip(resB.body),
      "and outside those two fields the checkout response is byte-identical");
  }

  // CROSS LEG: the GTA snapshot (connect) against the San Jose snapshot
  // (direct). Only the two tenant identifiers are tokenized - the same
  // mechanical substitution on both sides - so a body difference beyond
  // client id + account id still fails. Both runs below are second runs on
  // their module instance, so the allowed-origins cache is warm on BOTH sides
  // and the sequences stay symmetric.
  sbRoutes = checkoutSbRoutes(GTA);
  const resC = fakeRes();
  const seqGta = await runLeg({ direct: false, fn: () => modA.handler(checkoutReq(GTA.id), resC) });
  ok(resC.code === 200, `checkout ran to a 200 on the GTA snapshot (saw ${resC.code})`);
  sbRoutes = checkoutSbRoutes(SJ);
  const resD = fakeRes();
  const seqDirect2 = await runLeg({ direct: true, fn: () => modB.handler(checkoutReq(SJ.id), resD) });
  const tokenize = (line) => line
    .split(GTA.id).join("<CLIENT>").split(SJ.id).join("<CLIENT>")
    .split(GTA.stripe_connect_account_id).join("<ACCT>").split(SJ.stripe_connect_account_id).join("<ACCT>");
  compareSequences(seqGta, seqDirect2, "checkout, GTA snapshot (connect) vs San Jose snapshot (direct), tenant ids tokenized", tokenize);

  // (2) members.js pause + cancel + refund, extracted by declaration line.
  const MEM = await importTemp(".stripe-parity-members.mjs", buildMembersModule());
  const memberFor = (clientId) => ({
    id: "mem-parity-1", client_id: clientId, athlete_name: "Jordan Alvarez", parent_name: "Maya Alvarez",
    parent_email: "maya.alvarez@example.com", plan: "Steady", status: "live", archetype: null,
    stripe_subscription_id: "sub_PARITY", stripe_customer_id: "cus_PARITY", pause_scheduled_for: null,
  });
  const ctx = { user: { id: "user-parity-1" }, staff: { name: "Parity Staff" } };
  const PERIOD_END = FROZEN_SEC + 14 * 86400;
  stripeRoutes = [
    ["GET", /^\/subscriptions\/sub_PARITY$/, { id: "sub_PARITY", status: "active", trial_end: null, items: { data: [{ current_period_end: PERIOD_END }] } }],
    ["POST", /^\/subscriptions\/sub_PARITY$/, { id: "sub_PARITY", status: "active", trial_end: null, cancel_at_period_end: true, current_period_end: PERIOD_END }],
    ["DELETE", /^\/subscriptions\/sub_PARITY$/, { id: "sub_PARITY", status: "canceled", current_period_end: PERIOD_END }],
    ["POST", /^\/refunds$/, { id: "re_PARITY", amount: 5000, currency: "cad", status: "succeeded" }],
  ];
  sbRoutes = [
    ["POST", /^cancellations\?select=id$/, [{ id: "cxl-parity-1" }]],
    ["GET", /^cancellations\?/, []],
    [null, /^cancellations/, null],
    [null, /^members\?/, null],
    [null, /^member_audit_log$/, null],
    [null, /^refunds$/, null],
  ];
  const memberActions = (mod, member, acct) => async () => {
    let r = fakeRes();
    await mod.actionPause(r, { ...member }, acct, ctx, { start_date: "2026-08-01", end_date: "2026-08-29", operation_id: "op-parity", reason: "parity pause" });
    if (r.code !== 200) throw new Error(`pause answered ${r.code}: ${JSON.stringify(r.body)}`);
    r = fakeRes();
    await mod.actionCancel(r, { ...member }, acct, ctx, { operation_id: "op-parity", reason: "parity cancel" });
    if (r.code !== 200) throw new Error(`cancel answered ${r.code}: ${JSON.stringify(r.body)}`);
    r = fakeRes();
    await mod.actionRefund(r, { ...member }, acct, ctx, { charge_id: "ch_PARITY", amount_cents: 5000, reason: "requested_by_customer" });
    if (r.code !== 200) throw new Error(`refund answered ${r.code}: ${JSON.stringify(r.body)}`);
  };
  const memConnect = await runLeg({ direct: false, fn: memberActions(MEM, memberFor(SJ.id), SJ.stripe_connect_account_id) });
  const memDirect = await runLeg({ direct: true, fn: memberActions(MEM, memberFor(SJ.id), SJ.stripe_connect_account_id) });
  compareSequences(memConnect, memDirect, "members.js pause+cancel+refund, San Jose as connect vs direct (strict)");
  const memGta = await runLeg({ direct: false, fn: memberActions(MEM, memberFor(GTA.id), GTA.stripe_connect_account_id) });
  compareSequences(memGta, memDirect, "members.js pause+cancel+refund, GTA (connect) vs San Jose (direct), tenant ids tokenized", tokenize);
  {
    const stripeCalls = memDirect.filter((r) => r.kind === "stripe");
    ok(stripeCalls.length === 4, `the action sequence really hit Stripe 4 times (pause read+write, cancel write, refund write; saw ${stripeCalls.length})`);
  }

  // (3) the receipt, through the REAL module (api/_member-receipts.js).
  const R = await import(pathToFileURL(path.join(HERE, "_member-receipts.js")).href);
  const receiptClient = {
    id: SJ.id, business_name: SJ.business_name, public_name: SJ.public_name, email: SJ.email,
    business_email: SJ.business_email, time_zone: SJ.time_zone, v2_access: true, receipt_mode: "recurring",
    tax_config: null, tax_registration_number: null, stripe_portal_url: null,
  };
  const invoice = {
    id: "in_PARITY", charge: "ch_PARITY", amount_paid: 22600, currency: "cad",
    status_transitions: { paid_at: FROZEN_SEC },
    lines: { data: [{ id: "il_PARITY", amount: 22600, price: { id: "price_PARITYPLAN" }, period: { start: FROZEN_SEC, end: PERIOD_END } }] },
  };
  stripeRoutes = [
    ["GET", /^\/charges\/ch_PARITY$/, { id: "ch_PARITY", payment_method_details: { card: { brand: "visa", last4: "4242" } } }],
  ];
  sbRoutes = [
    [null, /^clients\?id=eq\./, [receiptClient]],
    ["GET", /^member_receipts\?/, []],
    ["POST", /^member_receipts$/, ({ body }) => { const row = JSON.parse(body)[0]; return [{ ...row, id: "rcpt-parity-1" }]; }],
    ["PATCH", /^member_receipts\?/, null],
    [null, /^offer_prices\?/, [PLAN_ROW]],
    [null, /^offers\?/, [{ data: OFFER_DATA }]],
  ];
  const sbForReceipts = async (p, init = {}) => {
    const res = await globalThis.fetch(`${SB_HOST}/rest/v1/${p}`, { ...init, headers: { apikey: "sb-service-FIXTURE", Authorization: "Bearer sb-service-FIXTURE", "Content-Type": "application/json", ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  };
  const runReceipt = async () => {
    const sends = [];
    const sendOn = async (args) => { sends.push(args); return { sent: true }; };
    const wrapped = (p, acct) => T.stripeFetch(p, { stripeAccount: acct });
    const out = await R.maybeSendPaymentReceipt({
      sb: sbForReceipts, sendOn, member: memberFor(SJ.id), invoice,
      stripeFetch: wrapped, connectedAccount: SJ.stripe_connect_account_id,
    });
    return { out, sends };
  };
  let sendsConnect, sendsDirect;
  const rcptConnect = await runLeg({ direct: false, fn: async () => { const { out, sends } = await runReceipt(); sendsConnect = { out, sends }; } });
  const rcptDirect = await runLeg({ direct: true, fn: async () => { const { out, sends } = await runReceipt(); sendsDirect = { out, sends }; } });
  ok(sendsConnect.out && sendsConnect.out.ok === true && sendsDirect.out && sendsDirect.out.ok === true,
    "the receipt path ran to completion on both transports");
  compareSequences(rcptConnect, rcptDirect, "receipt: card read + row insert + status patch, connect vs direct (strict)");
  ok(JSON.stringify(sendsConnect.sends) === JSON.stringify(sendsDirect.sends) && sendsConnect.sends.length === 1,
    "the receipt EMAIL a parent gets (subject, body, vars) is byte-identical across transports");
  ok(!/rk_|sk_|whsec_|acct_|client_stripe_direct|pk_live_/.test(JSON.stringify(sendsConnect.sends)),
    "and it carries no key, no account id, no transport vocabulary");

  // (4) the welcome email, through the REAL renderEmail.
  const { renderEmail, clientVars } = await import(pathToFileURL(path.join(HERE, "email-shells.js")).href);
  const vars = { ...clientVars(SJ), ...(SNAP_SJ.facts || {}), first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };
  const renderWelcome = () => renderEmail({ clientId: SJ.id, subject: "Welcome to {{location.name}} 🏀", body: "template:onboarding-welcome", vars });
  T.bustTransportCache(); directRowsByAcct = { [SJ_DIRECT.stripe_account_id]: DIRECT_ROW };
  const welcomeDirect = renderWelcome();
  T.bustTransportCache(); directRowsByAcct = {};
  const welcomeConnect = renderWelcome();
  ok(welcomeDirect === welcomeConnect && welcomeDirect.length > 500,
    "the welcome email renders byte-identically whichever transport the academy is on (the render takes no transport input)");
  ok(welcomeDirect.includes(SJ.public_name), "and it is really San Jose's email (public_name reaches the parent)");
  ok(!/rk_academy|sk_platform|whsec_|acct_1|client_stripe_direct|pk_live_FIXTURE|direct:/.test(welcomeDirect),
    "and no transport fact of any kind reaches the words a parent reads");
} finally {
  restoreFetch();
  thawClock();
  for (const p of TEMP_FILES) { try { fs.unlinkSync(p); } catch (_) { /* already gone */ } }
}

// ─── C. one doorway: the scan + the enforced inventory ───────────────────────
console.log("\n── C. one doorway: table names, vocabulary, and the Tier-2 inventory ──");
{
  const { problems } = runSectionC(loadScanSources());
  ok(problems.length === 0, "no transport fork, no unaudited Stripe access, no stale or stub inventory line");
  for (const p of problems) console.log("     " + p);
}

// ─── D. the wiring pins ──────────────────────────────────────────────────────
console.log("\n── D. wiring: return sites, the 7 money gates, webhook order, reconcile ──");
for (const r of runSectionD()) ok(r.ok, r.msg);

// ─── footer ──────────────────────────────────────────────────────────────────
console.log("");
if (MUTATE) {
  // Only unreachable for MUTATE values that returned above; anything else is a
  // typo'd control name and must not read as success.
  console.log(`❌ Unknown MUTATE="${MUTATE}". Known controls: plant-branch, plant-blanked, envelope-leak, testmode-leak, collapse`);
  process.exit(1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
