// WHAT THE OWNER IS TOLD WHEN STRIPE IS NOT READY YET.
//
//   node api/_stripe-connect-requirements.test.mjs     # non-zero on any failure
//
// Plain node. No network, no database, no new dependency: every outbound call
// the code makes goes through globalThis.fetch and one stub covers all of them.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO DEFECTS THIS LOCKS DOWN. Elijah De Guzman (BAM San Jose) connected
// Stripe on 2026-07-30. The handshake worked and his account was stored. He was
// shown: "Stripe connection failed - Stripe connected, but it cannot accept
// payments yet. Finish the remaining steps in Stripe, then reconnect."
//
//   1. Nothing failed, and "then reconnect" is the opposite of how this works.
//      backfillStripeWhenChargeable() in api/action-items.js re-checks Stripe
//      and ticks the step itself. Sending someone back through OAuth when the
//      blocker is inside Stripe just loops them.
//
//   2. "the remaining steps" named no step. Stripe returns the real list in
//      requirements.currently_due, in the SAME response we had already fetched
//      and thrown away - canCharge() read charges_enabled and dropped the rest.
//      The portal's three examples (business details, bank account, ID
//      verification) were prose printed for every academy.
//
//      The same discard collapsed two states that must not collapse: any
//      failure returned `false`, so a network blip, an expired platform key and
//      a genuinely incomplete account were indistinguishable. House rule 10 - a
//      yes/no that crossed a network boundary has THREE outcomes.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES, BY RENDERING RATHER THAN BY GREPPING. A literal in a file is
// not evidence of what a person sees, so nothing here searches the source for
// the words we hope are there. It drives the REAL handleCallback in
// api/stripe/connect.js against stubbed Stripe and Supabase, takes the Location
// header it actually sets, feeds that URL into the REAL
// _stripeConnectReturnCheck lifted out of public/client-portal.html, and reads
// the string that reaches alert(). Then it renders the REAL
// openStripeConnectModal for each state and reads the HTML.
//
// Every assertion below is against one of those two rendered outputs, or
// against the row handleCallback actually wrote.
//
// DOES NOT PROVE that api/members.js reaches Stripe correctly in production, or
// that the modal looks right. checkMembersWiring() is a contract check between
// the producer's field names and the consumer's, which is the one thing here
// that reads source - it is the "defined, detected and invisible" failure, and
// a renderer cannot see it because the render is fed by hand.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing and must print NEGATIVE CONTROL
// PASSED. A control that no longer applies exits 2 and says so, rather than
// looking like a control that passed.
//
//   MUTATE=reconnect    the message goes back to "then reconnect"
//   MUTATE=errorchannel the callback reports pending as an error again
//   MUTATE=dropunmapped a requirement code with no mapping is silently dropped
//   MUTATE=droperrors   Stripe's own rejection reason is discarded again
//   MUTATE=collapse     unreachable is reported as not_ready (the old two-state
//                       collapse: "we could not ask" told as "you are not ready")
//   MUTATE=tickonfail   unreachable counts as ready, so a failed call would tick
//                       the onboarding step and stamp connected_at
//   MUTATE=generic      the card ignores the live data and prints the three
//                       hardcoded examples again
//   MUTATE=emdash       an em dash reaches owner-facing copy

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_HTML = path.join(HERE, "../public/client-portal.html");
const MUTATE = process.env.MUTATE || "";

// Set BEFORE connect.js is imported - it reads these at module load.
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.STRIPE_CONNECT_SECRET_KEY = "sk_test_stub_platform_key";
process.env.STRIPE_CONNECT_STATE_SECRET = "stub-state-secret";
process.env.STRIPE_CONNECT_CLIENT_ID = "ca_stub";

let pass = 0;
const fails = [];
let controlBroken = null;
const ok = (cond, what, detail) => {
  if (cond) { pass++; return true; }
  fails.push({ what, detail });
  return false;
};

// ─── the account shapes Stripe really returns ───────────────────────────────
// currently_due carries an unmapped code on purpose in one fixture: Stripe adds
// requirement codes whenever it likes, and a code we have never seen must reach
// the owner rather than vanish.
const ACCOUNT_NOT_READY = {
  id: "acct_1Tz08nLhm4hK898M",
  charges_enabled: false,
  details_submitted: true,
  requirements: {
    currently_due: [
      "external_account",
      "individual.verification.document",
      "individual.dob.day",
      "individual.dob.month",
      "individual.dob.year",
      "business_profile.url",
    ],
    past_due: ["external_account"],
    pending_verification: ["individual.id_number"],
    // Stripe telling us WHY something already submitted was thrown out. Without
    // it the owner re-uploads the same rejected file and waits again.
    errors: [{
      requirement: "individual.verification.document",
      code: "verification_document_not_readable",
      reason: "The uploaded file is not readable. Upload a clearer photo of the document.",
    }],
    disabled_reason: "requirements.past_due",
  },
};
const ACCOUNT_UNKNOWN_CODE = {
  id: "acct_1Tz08nLhm4hK898M",
  charges_enabled: false,
  details_submitted: true,
  requirements: {
    currently_due: ["individual.verification.proof_of_liveness", "external_account"],
    past_due: [],
    pending_verification: [],
    disabled_reason: "awaiting_hyperspace_review",
  },
};
const ACCOUNT_READY = {
  id: "acct_1Tz08nLhm4hK898M",
  charges_enabled: true,
  details_submitted: true,
  requirements: { currently_due: [], past_due: [], pending_verification: [], disabled_reason: null },
};

// ─── mutants ────────────────────────────────────────────────────────────────
// A mutated copy is written NEXT TO the original so its relative imports still
// resolve, and connect.js's import is re-pointed at the mutated module. A
// mutation whose anchor text has moved sets controlBroken instead of passing.
const REQ_EDITS = {
  reconnect: [[
    " It ticks itself once Stripe says you can take payments, so there is no need to reconnect.",
    ", then reconnect."]],
  dropunmapped: [[
    "    const d = describeRequirement(code);\n    const hit = byLabel.get(d.label);",
    "    const d = describeRequirement(code);\n    if (!d.mapped) continue;\n    const hit = byLabel.get(d.label);"]],
  droperrors: [[
    "  const problems = (Array.isArray(req.errors) ? req.errors : []).map(e => ({",
    "  const problems = [].map(e => ({"]],
  collapse: [[
    '  const unreachable = (error) => ({\n    outcome: "unreachable",',
    '  const unreachable = (error) => ({\n    outcome: "not_ready",']],
  tickonfail: [[
    '  const unreachable = (error) => ({\n    outcome: "unreachable",\n    ready: false,',
    '  const unreachable = (error) => ({\n    outcome: "ready",\n    ready: true,']],
};
const CONNECT_EDITS = {
  errorchannel: [[
    'return redirectBack(res, "pending", connectReturnMessage(status));',
    'return redirectBack(res, "error", connectReturnMessage(status));']],
};
const HTML_EDITS = {
  generic: [[
    "  const live = stripe.live || null;",
    "  const live = null;"]],
  emdash: [[
    "Your Stripe account is linked, but Stripe says it <b>cannot accept payments yet</b>.",
    "Your Stripe account is linked — but Stripe says it <b>cannot accept payments yet</b>."]],
};

function applyEdits(src, edits, label) {
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in ${label}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING and proves nothing. Re-point it at the current code, or delete it - a control that fails to apply looks exactly like a control that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  return src;
}

const TMP = [];
function writeMutant(dir, name, src) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, src);
  TMP.push(p);
  return p;
}

// Load connect.js and _requirements.js, mutated together when the control asks.
async function loadModules() {
  const dir = path.join(HERE, "stripe");
  const reqEdits = REQ_EDITS[MUTATE] || [];
  const conEdits = CONNECT_EDITS[MUTATE] || [];
  if (!reqEdits.length && !conEdits.length) {
    return {
      connect: (await import("./stripe/connect.js")).default,
      requirements: await import("./stripe/_requirements.js"),
    };
  }
  const tag = `.mutant-${process.pid}-`;
  const reqSrc = applyEdits(fs.readFileSync(path.join(dir, "_requirements.js"), "utf8"), reqEdits, "api/stripe/_requirements.js");
  writeMutant(dir, `${tag}_requirements.js`, reqSrc);
  let conSrc = applyEdits(fs.readFileSync(path.join(dir, "connect.js"), "utf8"), conEdits, "api/stripe/connect.js");
  if (!conSrc.includes('from "./_requirements.js"')) {
    controlBroken = `MUTATE=${MUTATE}: api/stripe/connect.js no longer imports ./_requirements.js, so the mutated module would never be loaded and the control would prove nothing.`;
    throw new Error(controlBroken);
  }
  conSrc = conSrc.split('from "./_requirements.js"').join(`from "./${tag}_requirements.js"`);
  const conPath = writeMutant(dir, `${tag}connect.js`, conSrc);
  return {
    connect: (await import(pathToFileURL(conPath).href)).default,
    requirements: await import(pathToFileURL(path.join(dir, `${tag}_requirements.js`)).href),
  };
}

// ─── the stubbed wire ───────────────────────────────────────────────────────
// Anything the code asks for that is not stubbed THROWS, so the day a new
// dependency appears this test says so rather than drifting.
let STRIPE_ACCOUNT = ACCOUNT_NOT_READY;
let STRIPE_ACCOUNT_FAILS = null;     // null | "network" | "http"
let DB_WRITES = [];

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u === "https://connect.stripe.com/oauth/token" && method === "POST") {
    return json({ stripe_user_id: "acct_1Tz08nLhm4hK898M", livemode: true });
  }
  if (u.startsWith("https://api.stripe.com/v1/accounts/")) {
    if (STRIPE_ACCOUNT_FAILS === "network") throw new Error("fetch failed");
    if (STRIPE_ACCOUNT_FAILS === "http") return json({ error: { message: "Expired API Key provided", code: "api_key_expired" } }, 401);
    return json(STRIPE_ACCOUNT);
  }
  if (u.includes("/rest/v1/clients?") && method === "PATCH") {
    DB_WRITES.push(JSON.parse(init.body));
    return new Response("", { status: 200 });   // Prefer: return=minimal, empty body
  }
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

// ─── driving the real callback ──────────────────────────────────────────────
function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.STRIPE_CONNECT_STATE_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

// Returns { location, status, msg, write } - what the browser is actually sent
// and what was actually stored.
async function runCallback(handler, { account, failure = null }) {
  STRIPE_ACCOUNT = account;
  STRIPE_ACCOUNT_FAILS = failure;
  DB_WRITES = [];
  let location = null, code = null;
  const res = {
    setHeader: (k, v) => { if (String(k).toLowerCase() === "location") location = v; },
    status: (s) => { code = s; return res; },
    end: () => res,
    json: (b) => { res.body = b; return res; },
  };
  const req = {
    method: "GET",
    headers: { host: "portal.byanymeansbusiness.com" },
    query: {
      code: "ac_stub_authorization_code",
      state: signState({ client_id: "11111111-2222-3333-4444-555555555555", user_id: "u1", exp: Date.now() + 60000, nonce: "n" }),
    },
  };
  await handler(req, res);
  if (code !== 302 || !location) {
    throw new Error(`handleCallback did not redirect (status ${code}, location ${location}). The test cannot read what the owner is told.`);
  }
  const q = new URLSearchParams(location.split("?")[1].split("#")[0]);
  return { location, status: q.get("stripe_connect"), msg: q.get("msg") || "", write: DB_WRITES[0] || null };
}

// ─── lifting the browser's own functions out of the portal ──────────────────
// The portal is one HTML file with no import path, so the functions are lifted
// and RUN rather than searched. Brace-matched so a reformat cannot silently
// truncate a body into something that still parses.
function lift(html, name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} has been renamed or removed from public/client-portal.html; re-point this test at the function that renders it.`);
  let depth = 0, end = -1;
  for (let j = html.indexOf("{", start); j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error(`could not brace-match ${name} in public/client-portal.html.`);
  return html.slice(start, end);
}

function portalSource() {
  let html = fs.readFileSync(PORTAL_HTML, "utf8");
  const edits = HTML_EDITS[MUTATE];
  if (edits) html = applyEdits(html, edits, "public/client-portal.html");
  return html;
}

// The REAL modal, rendered. Returns the HTML the owner's browser would show.
function renderModal(html, stripeState) {
  const src = [
    lift(html, "escapeHTML"),
    lift(html, "_stripeNeedsList"),
    lift(html, "_stripeOnboardingBody"),
    lift(html, "openStripeConnectModal"),
  ].join("\n\n");
  const host = { innerHTML: "" };
  const doc = { getElementById: (id) => (id === "stripe-modal-host" ? host : null) };
  const fn = new Function("document", "_STRIPE_CONNECT_STATE", `${src}\n return openStripeConnectModal();`);
  fn(doc, stripeState);
  return host.innerHTML;
}

// The REAL return check, run against the URL connect.js actually redirected to.
// Returns every string that reached alert().
function renderReturnAlert(html, location) {
  const src = lift(html, "_stripeConnectReturnCheck");
  const search = "?" + (location.split("?")[1] || "").split("#")[0];
  const said = [];
  const store = new Map();
  const fn = new Function("window", "sessionStorage", "history", "alert", "setTimeout",
    `${src}\n return _stripeConnectReturnCheck();`);
  fn(
    { location: { search, pathname: "/client-portal.html", hash: "#members" } },
    { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    { replaceState: () => {} },
    (m) => said.push(String(m)),
    (f) => f(),
  );
  return said.join("\n");
}

// ─── the checks ─────────────────────────────────────────────────────────────

const EM_DASH = /—/;

async function main() {
  console.log("\n── Stripe Connect: what the owner is told when payments are not on yet ──");
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.\n`);

  const { connect, requirements } = await loadModules();
  const html = portalSource();
  const { readStripeAccount } = requirements;

  // ── 1. the OAuth return, end to end ──────────────────────────────────────
  const notReady = await runCallback(connect, { account: ACCOUNT_NOT_READY });
  const unreachable = await runCallback(connect, { account: ACCOUNT_NOT_READY, failure: "network" });
  const keyExpired = await runCallback(connect, { account: ACCOUNT_NOT_READY, failure: "http" });
  const ready = await runCallback(connect, { account: ACCOUNT_READY });

  const alertNotReady = renderReturnAlert(html, notReady.location);
  const alertUnreachable = renderReturnAlert(html, unreachable.location);
  const alertKeyExpired = renderReturnAlert(html, keyExpired.location);
  const alertReady = renderReturnAlert(html, ready.location);
  // The failure channel must still exist and still say "failed".
  const alertRealError = renderReturnAlert(html, "/client-portal.html?stripe_connect=error&msg=state%3A%20bad%20signature#members");

  ok(!/connection failed/i.test(alertNotReady), "nothing failed, so do not say it did",
    `the owner connected Stripe successfully and was told:\n    ${alertNotReady}\n    The handshake worked and the account was stored. Leading with a failure is what sent them back through OAuth looking for a problem that was never in the connection.`);
  ok(!/connection failed/i.test(alertUnreachable), "nothing failed, so do not say it did",
    `our own check of Stripe failed, and the owner was told their CONNECTION failed:\n    ${alertUnreachable}`);
  for (const [label, text] of [["not ready", alertNotReady], ["unreachable", alertUnreachable], ["expired key", alertKeyExpired]]) {
    ok(/^Stripe is connected\b/.test(text.trim()), "the pending alert opens by confirming the connection",
      `the ${label} alert opens with something other than the fact that Stripe IS connected, which is the one thing the owner needs to stop worrying about:\n    ${text}`);
  }
  ok(/failed/i.test(alertRealError) && /bad signature/.test(alertRealError), "a real failure still reads as one",
    `a genuinely broken callback (bad state signature) must still say so. Got:\n    ${alertRealError}\n    If the failure wording disappeared entirely, a real error now reads as routine.`);
  ok(alertReady.trim() === "Stripe connected.", "the success path is unchanged",
    `expected exactly "Stripe connected.", got:\n    ${alertReady}`);

  ok(!/then reconnect/i.test(alertNotReady) && /no need to reconnect/i.test(alertNotReady),
    "the message does not send them back through OAuth",
    `"then reconnect" is wrong advice: backfillStripeWhenChargeable() in api/action-items.js re-checks Stripe and ticks the step itself, so another OAuth round trip just loops them. The owner was told:\n    ${alertNotReady}`);

  // The whole point of defect 2: the message must name a REAL requirement from
  // the account, not a generic sentence.
  ok(/bank account/i.test(alertNotReady), "the message names a real outstanding item",
    `Stripe said external_account was currently_due and the owner was told:\n    ${alertNotReady}\n    "the remaining steps" that names no step is the message that started this.`);

  ok(alertNotReady !== alertUnreachable, "cannot-reach-Stripe stays different from not-ready",
    `"Stripe says this owner is not ready" and "our call to Stripe did not work" produced the SAME words:\n    ${alertNotReady}\n    That is the two-state collapse this build exists to remove. House rule 10: a yes/no that crossed a network boundary has three outcomes.`);
  ok(/could not reach/i.test(alertUnreachable) && !/still needs/i.test(alertUnreachable),
    "an unreachable Stripe is not reported as an incomplete account",
    `the network call failed and the owner was told something about their account instead:\n    ${alertUnreachable}`);
  ok(/could not reach/i.test(alertKeyExpired), "an expired platform key reads as our problem, not theirs",
    `Stripe answered 401 (expired platform key). That is our configuration, not the academy's account, and the owner was told:\n    ${alertKeyExpired}`);

  // ── 2. the stored row is untouched by all of this ────────────────────────
  ok(notReady.write && notReady.write.stripe_connect_status === "onboarding" && notReady.write.stripe_connect_connected_at === null,
    "the stored row is unchanged", `not-ready wrote ${JSON.stringify(notReady.write)}; it must still be status onboarding with a null connected_at.`);
  ok(unreachable.write && unreachable.write.stripe_connect_status === "onboarding" && unreachable.write.stripe_connect_connected_at === null,
    "a failed check never ticks the step",
    `we could not reach Stripe and the row was written as ${JSON.stringify(unreachable.write)}. A call we could not make is not permission to say an academy can take money.`);
  ok(ready.write && ready.write.stripe_connect_status === "connected" && !!ready.write.stripe_connect_connected_at,
    "the stored row is unchanged", `chargeable wrote ${JSON.stringify(ready.write)}; it must be status connected with a timestamp.`);
  const statuses = new Set([notReady, unreachable, keyExpired, ready].map(r => r.write && r.write.stripe_connect_status));
  ok([...statuses].every(s => s === "connected" || s === "onboarding"), "no new stripe_connect_status value",
    `the callback wrote ${[...statuses].join(", ")}. This build was not allowed to introduce a new status value.`);

  // ── 3. the Stripe card, rendered ─────────────────────────────────────────
  const live = async (account, failure = null) => {
    STRIPE_ACCOUNT = account; STRIPE_ACCOUNT_FAILS = failure;
    const s = await readStripeAccount("acct_1Tz08nLhm4hK898M", "sk_test_stub_platform_key");
    return { outcome: s.outcome, reachable: s.reachable, needs: s.needs, reviewing: s.reviewing, problems: s.problems, disabled_reason: s.disabled_reason };
  };
  const base = { status: "onboarding", account_id: "acct_1Tz08nLhm4hK898M" };
  const cardNotReady = renderModal(html, { ...base, live: await live(ACCOUNT_NOT_READY) });
  const cardUnknown = renderModal(html, { ...base, live: await live(ACCOUNT_UNKNOWN_CODE) });
  const cardUnreach = renderModal(html, { ...base, live: await live(ACCOUNT_NOT_READY, "network") });
  const cardReady = renderModal(html, { ...base, live: await live(ACCOUNT_READY) });
  const cardNoAcct = renderModal(html, { status: "onboarding", account_id: null, live: null });
  const cardConnected = renderModal(html, { status: "connected", account_id: "acct_1Tz08nLhm4hK898M", live: null });

  ok(!/business details, bank account, or ID verification/i.test(cardNotReady),
    "the card names this account's real requirements",
    "the card still prints the three hardcoded examples. They were prose, printed for every academy whatever their account actually needed.");
  for (const [needle, why] of [
    ["A bank account for Stripe to pay out to", "external_account was currently_due"],
    ["photo ID document", "individual.verification.document was currently_due"],
    ["date of birth", "individual.dob.day/month/year were currently_due"],
    ["Your business website address", "business_profile.url was currently_due"],
  ]) {
    ok(cardNotReady.includes(needle), "the card names this account's real requirements",
      `${why}, and the rendered card does not contain "${needle}".\n    Rendered:\n${cardNotReady}`);
  }
  // Three date-of-birth codes are one thing to a human, but all three codes
  // must survive onto the item so nothing is lost in the collapsing.
  const dobLines = (cardNotReady.match(/date of birth/g) || []).length;
  ok(dobLines === 1, "one line per human-readable item",
    `"date of birth" appears ${dobLines} times. dob.day, dob.month and dob.year are one thing to ask an owner for.`);
  for (const code of ["individual.dob.day", "individual.dob.month", "individual.dob.year"]) {
    ok(cardNotReady.includes(code), "no requirement code is lost when items collapse",
      `${code} does not appear anywhere in the rendered card, so collapsing the three date-of-birth codes onto one line lost it.`);
  }
  ok(cardNotReady.includes("The uploaded file is not readable"), "Stripe's own rejection reason reaches the owner",
    `Stripe returned requirements.errors saying the uploaded document is not readable, and the card does not say so anywhere. Without it the owner sees "photo ID document" asked for again and re-uploads the same rejected file.\n    Rendered:\n${cardNotReady}`);
  ok(/Stripe is reviewing/.test(cardNotReady) && /government ID number/.test(cardNotReady),
    "pending_verification is shown separately",
    "individual.id_number was in pending_verification. Something Stripe is checking is not something the owner has to go and do, and the card must not mix them.");

  // Rule 4: a code with no mapping is SHOWN, not hidden.
  ok(cardUnknown.includes("individual.verification.proof_of_liveness"),
    "an unmapped requirement code is shown, never dropped",
    `Stripe named individual.verification.proof_of_liveness and the rendered card does not contain it anywhere. A silently dropped requirement is worse than an ugly one - it is exactly what made "finish the remaining steps" a dead end.\n    Rendered:\n${cardUnknown}`);
  ok(cardUnknown.includes("awaiting_hyperspace_review") || /bank account/i.test(cardUnknown),
    "an unmapped disabled_reason is shown too",
    `Stripe gave disabled_reason "awaiting_hyperspace_review" and nothing about it reached the card.`);

  ok(/could not reach Stripe/i.test(cardUnreach) && !/cannot accept payments yet/i.test(cardUnreach),
    "the card keeps cannot-reach-Stripe apart from not-ready",
    `our call failed and the card told the owner about their account:\n${cardUnreach}`);
  ok(cardUnreach !== cardNotReady, "the card keeps cannot-reach-Stripe apart from not-ready",
    "the two states render identically.");
  ok(/Open Stripe dashboard/.test(cardUnreach) && !/Finish in Stripe/.test(cardUnreach),
    "the button does not promise a step we cannot name",
    `"Finish in Stripe" asserts there is something to finish. We do not know that here.\n${cardUnreach}`);

  ok(/can accept payments/i.test(cardReady) && !/still needs/i.test(cardReady),
    "an account Stripe has already cleared says so",
    `Stripe reports charges_enabled and the card still asks for something:\n${cardReady}`);
  ok(/start the connect flow again/i.test(cardNoAcct),
    "an unfinished OAuth still says restart the flow",
    `with no account stored, restarting OAuth IS the fix and the card must still say so:\n${cardNoAcct}`);

  for (const [label, card] of [["not ready", cardNotReady], ["unknown code", cardUnknown], ["unreachable", cardUnreach], ["ready", cardReady]]) {
    ok(/you do not need to reconnect/i.test(card), "the card never sends them back through OAuth",
      `the ${label} card does not tell the owner they need not reconnect, and the modal's other button is a reconnect. Rendered:\n${card}`);
  }

  // ── 4. no em dash in anything a person reads ─────────────────────────────
  const rendered = {
    "alert: not ready": alertNotReady, "alert: unreachable": alertUnreachable,
    "alert: expired key": alertKeyExpired, "alert: connected": alertReady,
    "card: not ready": cardNotReady, "card: unknown code": cardUnknown,
    "card: unreachable": cardUnreach, "card: ready": cardReady,
    "card: no account": cardNoAcct, "card: connected": cardConnected,
  };
  for (const [where, text] of Object.entries(rendered)) {
    ok(!EM_DASH.test(text), "no em dash in owner-facing copy",
      `${where} contains an em dash. Repo rule: hyphen, comma or colon, every repo, no exceptions.\n    ${String(text).split("\n").find(l => EM_DASH.test(l)) || text}`);
  }

  // ── 5. producer and consumer agree on field names ───────────────────────
  checkMembersWiring();

  // ─── report ─────────────────────────────────────────────────────────────
  for (const f of fails) console.log(`\n── ${f.what} ──\n  ${f.detail}`);

  if (MUTATE) {
    const caught = fails.length > 0;
    console.log(caught
      ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} failure(s), ${pass} checks still passed).`
      : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
    process.exit(caught ? 0 : 1);
  }
  if (!fails.length) {
    console.log(`\n✅ ${pass} checks passed, all against rendered output.`);
    console.log("   The owner is told what Stripe actually asked for, is not told to reconnect,");
    console.log("   and a Stripe we could not reach never reads as an academy that is not ready.\n");
    process.exit(0);
  }
  console.log(`\n❌ ${fails.length} failure(s), ${pass} passed.\n`);
  process.exit(1);
}

// The one source-reading check, and it is a contract not a hope: api/members.js
// PRODUCES stripe.live and _stripeOnboardingBody CONSUMES it. They are in
// different files with no shared type, so a renamed field renders an empty card
// and nothing else in this suite can see it - the render here is fed by hand.
function checkMembersWiring() {
  const members = fs.readFileSync(path.join(HERE, "members.js"), "utf8");
  const at = members.indexOf("stripeLive = {");
  if (at < 0) return ok(false, "members.js still produces stripe.live",
    "no `stripeLive = {` in api/members.js. If the producer moved, re-point this check at it - without it the Stripe card can go blank and every render in this file still passes, because the renders are fed by hand.");
  const block = members.slice(at, members.indexOf("};", at));
  for (const field of ["outcome", "reachable", "needs", "reviewing", "problems", "disabled_reason"]) {
    ok(new RegExp(`\\b${field}\\s*:`).test(block), "members.js still produces stripe.live",
      `_stripeOnboardingBody in public/client-portal.html reads live.${field}, and api/members.js no longer puts it on the payload. The card would render without it and say nothing.`);
  }
  ok(/readStripeAccount\(/.test(members), "members.js reads Stripe through the shared module",
    "api/members.js no longer calls readStripeAccount. If it grew its own Stripe call it will have its own idea of what a failure means, which is the fork this build removed.");
  ok(/stripe_connect_status\s*!==\s*"connected"/.test(members), "the extra Stripe call stays narrow",
    "the guard that keeps this to one Stripe call for an academy mid-setup has gone, so every members fetch for every academy now waits on Stripe.");
}

try {
  await main();
} catch (e) {
  if (controlBroken) { console.log(`\n⚠️  ${controlBroken}\n`); process.exit(2); }
  console.log(`\n❌ the suite could not run: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
} finally {
  for (const p of TMP) { try { fs.unlinkSync(p); } catch (_) {} }
}
