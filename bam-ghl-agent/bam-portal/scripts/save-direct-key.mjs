#!/usr/bin/env node
// DIRECT-KEY CLI - paste a platform-locked academy's own restricted Stripe key
// from a terminal instead of the staff web panel.
//
//   pbpaste | node scripts/save-direct-key.mjs --client <uuid> --pk pk_live_... --as "Zoran"
//   pbpaste | node scripts/save-direct-key.mjs --client <uuid> --pk pk_live_... --as "Zoran" --save
//
// The first form PROBES ONLY and writes nothing. --save is what commits, the
// same Probe-then-Save discipline the panel (src/views/StripeContactLinkView
// .jsx) enforces with two buttons.
//
// EXIT CODES: 0 = probe fine, or saved AND proved in production. 1 = refused,
// or saved and the production read-back came back BROKEN. 2 = saved, but the
// production read-back could not be run, so nothing is proved either way.
//
// ─────────────────────────────────────────────────────────────────────────────
// BEFORE YOU RUN. All three are verified facts, not assumptions:
//
//  1. `npm install` must have been run in bam-portal. This script imports
//     api/stripe/direct-key.js, which transitively imports @sentry/node, so
//     without node_modules it dies on a bare ERR_MODULE_NOT_FOUND that says
//     nothing about Stripe.
//
//  2. A local .env.local does NOT carry CRON_SECRET, STRIPE_DIRECT_ENC_KEY or
//     PORTAL_BASE_URL (checked on Zoran's machine: none of the three are there).
//     Pull them from Vercel PRODUCTION and source them:
//         vercel env pull .env.production.local --environment=production
//         set -a; . ./.env.production.local; set +a
//     NEVER hand-copy STRIPE_DIRECT_ENC_KEY. One wrong character encrypts the
//     academy's live key into a blob production cannot decrypt, this CLI still
//     says SAVED, and nothing complains until a real payment fails days later.
//     That is exactly what the post-save proof below exists to catch.
//
//  3. The documented `pbpaste |` form leaves the live restricted key sitting in
//     the macOS clipboard after the run. Clear it:  printf '' | pbcopy
//
// ⛔ THIS CLI CARRIES NO AUTH OF ITS OWN, AND NEITHER DOES THE FUNCTION IT
// CALLS. saveDirectKey() was extracted OUT of api/stripe/direct-key.js's
// handler, and the 401 (no token) / 403 (not BAM staff) checks stayed BEHIND in
// that handler. So saveDirectKey is an unauthenticated write to an academy's
// payment credentials. This script is safe only because it runs LOCALLY, on a
// machine that already holds SUPABASE_SERVICE_ROLE_KEY - possession of that env
// var IS the authorization here. Any future HTTP caller that imports
// saveDirectKey inherits ZERO auth and must put its own gate in front of it.
// Which Supabase project that service-role key points at is PRINTED before any
// write, so nobody can save a live key into the wrong project unknowingly.
//
// THE SECRET KEY IS READ FROM STDIN, NEVER FROM A FLAG. A flag lands in shell
// history and in the process list of every other user on the machine. It is
// never echoed, logged or included in any output on any path, success or
// failure - only the last 4 characters the contract hands back.
//
// SHAPE GUARD (do not delete as redundant). The pasted key is rejected unless it
// is entirely printable ASCII, BEFORE it can reach fetch. A key carrying an
// embedded newline survives trim(), and undici then throws while BUILDING the
// request - before any response exists - with the whole header value ("Bearer
// <the entire key>") inside the message, and no .status on it, so a CLI that
// prints unknown errors prints the live key. api/_stripe-transport.js is getting
// its own transport-level guard; this one is the LOCAL half and stays. Scrubbing
// the message afterwards is not a substitute: the newline splits the key, so a
// key-shaped pattern stops at the break and leaves the tail on screen.
//
// THE TABLE NAME. This script does not need one and must not contain one. The
// direct-key table has a one-doorway audit scan (api/_stripe-transport-parity
// .test.mjs section C) that walks api/** and src/views but NOT scripts/, so a
// table name typed here would be a reference no audit can see. Everything that
// touches the table happens inside the contract.
//
// EVERY .status ERROR IS REPORTED AS A REFUSAL, i.e. as "nothing happened". That
// is true ONLY because every .status throw in saveDirectKey fires BEFORE the
// first write (the direct-key row upsert - see THE TABLE NAME above for why
// this file does not name the table). If a future .status throw ever lands
// AFTER that upsert, this CLI would confidently tell an operator nothing
// changed while a live key sits in the table. api/_direct-key-cli.test.mjs pins
// the contract's post-write region as throw-free so that premise dies loudly
// instead of the operator being misled.
//
// PROOF AFTER THE SAVE - the whole point of the --save path. "STRIPE_DIRECT_ENC_KEY
// is set" is not "STRIPE_DIRECT_ENC_KEY is the RIGHT one". A local encrypt-then-
// decrypt round trip proves nothing, because both halves use the same possibly-
// wrong key. So after a successful save this CLI asks PRODUCTION to read the row
// back: POST {PORTAL_BASE_URL}/api/stripe/cron-key-health with
// Authorization: Bearer ${CRON_SECRET}. That endpoint runs readAccountHealth for
// every direct-key academy, which must DECRYPT the stored key with PRODUCTION's
// enc key and call Stripe with it. We filter its `results` array to our
// client_id. Three outcomes, never two: proved / broken / could-not-ask.
// NOTE: that endpoint has no per-academy scope - it probes ALL direct-key
// academies on every call. Harmless while there is one, worth revisiting when
// there are twenty (an unrelated academy's blip lands in the same response we
// are reading, and we pay for a full sweep to answer one question).
//
// Env: VITE_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY always, plus
// STRIPE_DIRECT_ENC_KEY (encrypt at rest), PORTAL_BASE_URL (webhook
// registration AND the proof) and CRON_SECRET (the proof) for --save.

import { probeKey, saveDirectKey } from "../api/stripe/direct-key.js";

const args = process.argv.slice(2);
// A flag-shaped "value" is NOT a value. `--as --save` (the operator started
// typing their name and never did) used to make the actor the literal string
// "--save" AND still save, because --save was present in argv either way. The
// audit row would then name a flag as the human who armed a live payment
// credential. Returning null lets the blank-actor guard below refuse the run.
const val = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const next = args[i + 1];
  if (next == null || String(next).startsWith("--")) return null;
  return next;
};
const has = (flag) => args.includes(flag);

const clientId = val("--client");
const publishableKey = val("--pk");
const actor = String(val("--as") || "").trim();
const doSave = has("--save");

const USAGE = 'usage: pbpaste | node scripts/save-direct-key.mjs --client <uuid> --pk <pk_live_...> [--save] --as "<your name>"';
const NOT_FOUND_HINT =
  "No academy has that client id, so nothing was written and nothing was reached. " +
  "That is almost always a typo in --client: copy the academy's client id out of the staff panel and run it again.";

function die(msg) { console.error(msg); process.exit(1); }

// ── three-outcome reporting ──────────────────────────────────────────────────
// success / expected failure / unknown, never two. An expected failure carries
// a .status the contract set deliberately (400 bad input, 404 no academy, 409
// wrong account, 502 Stripe unreachable) and gets reported as a plain no. An
// error WITHOUT a .status is a could-not-ask - a crash, a DB error, a network
// drop - and reporting one as a clean no would tell the operator the academy is
// untouched when nobody established that. The wording splits on WHERE it
// happened: before the save nothing can have been written, during the save a
// partial write is possible and the operator has to be told so.
//
// The HTTP number itself is deliberately NOT printed. This is a CLI; "409" is
// vocabulary from a protocol the operator is not speaking. The MESSAGE is what
// carries the meaning, and for the collision case it is printed VERBATIM: the
// contract already resolved the other academy's name where it could and fell
// back to a client_id where it could not, so re-wording it here could only make
// it less true.
function failExpected(e) {
  const msg = e.message || String(e);
  if (e.status === 404) {
    console.error(`\nrefused: ${msg}. ${NOT_FOUND_HINT}`);
  } else if (e.status === 409) {
    console.error(`\nrefused: ${msg}`);
  } else if (e.status === 502) {
    console.error(`\ncould not reach Stripe to check the key: ${msg}\n` +
      "Nothing was written and nothing is wrong with the key as far as anyone knows - Stripe did not answer. " +
      "This is RETRYABLE: run the exact same command again in a minute.");
  } else {
    console.error(`\nrefused: ${msg}`);
  }
  process.exit(1);
}
function failUnknownBeforeSave(e) {
  console.error(`\ncould not complete, unchanged: ${e.message || String(e)}`);
  process.exit(1);
}
function failUnknownDuringSave(e) {
  console.error(`\ncould not complete, and the save may have PARTLY landed - ` +
    `check the academy in the staff panel before retrying: ${e.message || String(e)}`);
  process.exit(1);
}

// ── args ─────────────────────────────────────────────────────────────────────
if (!clientId) die(USAGE);
if (!publishableKey) die(`--pk <pk_live_...> required - the checkout cannot mount Stripe.js without it\n${USAGE}`);
// The actor is what makes the audit row answerable. A CLI has no staff row and
// no auth user, so the NAME is the only identity this path can supply, and an
// empty or whitespace-only one would land a nameless row against a live payment
// credential. saveDirectKey would throw on it anyway; catching it here means we
// never reach live Stripe on a run that cannot possibly be saved. This is also
// what catches `--as --save`, because val() refuses to read a flag as a value.
if (!actor) die(`--as "<your name>" is required - it is the only identity a CLI save can put in the audit trail.\n` +
  `If you typed --as immediately followed by another flag, the name never made it in.\n${USAGE}`);

// EVERY CHARACTER OF A CREDENTIAL IS PRINTABLE ASCII. Anything else in one is
// damage picked up in transit, and it is refused rather than repaired - see the
// SHAPE GUARD note in the header for why (the throw it causes puts the whole
// header value, credential included, in a message nothing here can safely
// print). Declared here because it guards the ENVIRONMENT's credentials too,
// not only the pasted key.
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

const SUPABASE_URL = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const CRON_SECRET = String(process.env.CRON_SECRET || "").trim();
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  die("missing env: VITE_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY");
}
// The same defect, one level up: an env var written with `echo` instead of
// `printf` carries a trailing newline (this has bitten this repo before). The
// trim above handles that; an INTERNAL break cannot be trimmed and would make
// undici throw with "Bearer <the whole service-role key>" in the message. The
// VALUE is never printed here, only the variable's name.
if (!PRINTABLE_ASCII.test(SUPABASE_SERVICE_KEY)) {
  die("SUPABASE_SERVICE_ROLE_KEY contains a character it cannot contain (a line break, a space or an invisible " +
    "character). Re-pull it rather than re-typing it: vercel env pull .env.production.local --environment=production");
}
const SB_HOST = (() => { try { return new URL(SUPABASE_URL).host; } catch { return String(SUPABASE_URL); } })();

const PORTAL_BASE_URL = String(process.env.PORTAL_BASE_URL || "").trim().replace(/\/+$/, "");
// Checked BEFORE any Stripe contact, all three together, so an operator fixes
// their environment once instead of discovering the next gap after the next
// live probe. PORTAL_BASE_URL used to be undocumented-but-required: without it
// the save wrote the credential and then ALWAYS failed webhook registration,
// every single time, and it is now also what the proof is addressed to.
if (doSave) {
  const missing = [];
  if (!process.env.STRIPE_DIRECT_ENC_KEY) {
    missing.push("STRIPE_DIRECT_ENC_KEY - the key cannot be encrypted at rest without it");
  }
  if (!PORTAL_BASE_URL || !/^https?:\/\//i.test(PORTAL_BASE_URL)) {
    missing.push("PORTAL_BASE_URL (https://...) - without it the credential is written and webhook registration then fails every time, and the save cannot be proved");
  }
  if (!CRON_SECRET) {
    missing.push("CRON_SECRET - it is how this CLI asks production to read the saved key back");
  } else if (!PRINTABLE_ASCII.test(CRON_SECRET)) {
    missing.push("CRON_SECRET is present but carries a line break or an invisible character - re-pull it, do not re-type it");
  }
  if (missing.length) {
    die(`missing env for --save:\n  - ${missing.join("\n  - ")}\n\n` +
      "Pull them from Vercel PRODUCTION, do not hand-copy them:\n" +
      "  vercel env pull .env.production.local --environment=production\n" +
      "  set -a; . ./.env.production.local; set +a");
  }
}

// ── the secret, from stdin only ──────────────────────────────────────────────
async function readStdin() {
  if (process.stdin.isTTY) {
    die(`nothing piped in. The restricted key is read from STDIN so it never lands in shell history or the process list.\n${USAGE}`);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}
const secretFromStdin = await readStdin();
// Deliberately not `if (!secretFromStdin) die(...)` on one line: no print call
// in this file may sit in reach of the secret's own identifier, which is what
// api/_direct-key-cli.test.mjs scans for.
const gotSecret = secretFromStdin.length > 0;
if (!gotSecret) {
  die(`stdin was empty - pipe the rk_live_ key in.\n${USAGE}`);
}

// THE SHAPE GUARD. See the header. Every character of a Stripe key is printable
// ASCII, so anything else is damage the paste picked up on the way here - and it
// has to be refused BEFORE the value can reach fetch, because the throw it
// causes there carries the whole key in its message. Rejected by shape, not by
// scrubbing: this catches LF, CR, NUL, tab, spaces, zero-width spaces,
// non-breaking spaces, a BOM and accented characters alike, without this file
// ever having to enumerate them.
const shapeOk = PRINTABLE_ASCII.test(secretFromStdin);
if (!shapeOk) {
  die("that is not a usable key: it contains characters a Stripe key cannot contain " +
    "(a line break, a tab, a space, or an invisible character such as a non-breaking space or a byte-order mark).\n\n" +
    "This is almost certainly a PASTE ARTEFACT. A key copied out of a wrapped email, a PDF or a chat message picks up " +
    "line breaks and invisible spacing characters that survive trimming.\n\n" +
    "Nothing was sent to Stripe and nothing was written. Re-copy the key as ONE unbroken line, straight from the Stripe " +
    `dashboard (Developers > API keys > reveal), and pipe it in again.\n${USAGE}`);
}

// ── supabase ─────────────────────────────────────────────────────────────────
async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// ── the academy ──────────────────────────────────────────────────────────────
// Looked up BEFORE the probe: a typo'd uuid should cost nothing and reach
// nobody's live Stripe account. The contract 404s on the same condition; this is
// the cheap early copy of that answer, worded identically.
let client;
try {
  const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name&limit=1`);
  client = Array.isArray(rows) && rows[0] ? rows[0] : null;
} catch (e) {
  failUnknownBeforeSave(e);
}
if (!client) die(`academy not found: ${clientId}. ${NOT_FOUND_HINT}`);
const NAME = client.business_name || `academy ${client.id}`;

// ── preflight: say where this is pointing BEFORE anything is written ─────────
console.log(`\n── ${NAME} direct Stripe key ${doSave ? "(SAVE)" : "(PROBE ONLY)"} ──`);
console.log(`  client        ${client.id}`);
console.log(`  supabase      ${SB_HOST}   <- the project this writes to`);
if (doSave) {
  console.log(`  production    ${PORTAL_BASE_URL}   <- webhook registration, and where the save is proved`);
  console.log("  env           STRIPE_DIRECT_ENC_KEY + CRON_SECRET present (values never printed)");
}
console.log("\nprobing the key against live Stripe (writes nothing) ...");

let report;
try {
  report = await probeKey(secretFromStdin, publishableKey);
} catch (e) {
  if (e.status) failExpected(e);
  failUnknownBeforeSave(e);
}

const yn = (v) => (v === true ? "yes" : "no");
console.log("\n── what this key is ──");
console.log(`  academy             ${NAME}`);
console.log(`  stripe account      ${report.account_id}`);
console.log(`  charges enabled     ${yn(report.charges_enabled)}`);
console.log(`  details submitted   ${yn(report.details_submitted)}`);
console.log(`  key last4           ${report.key_last4}`);
console.log("  capabilities");
const caps = Object.entries(report.capabilities || {});
if (!caps.length) console.log("    (none reported)");
for (const [name, able] of caps) console.log(`    ${name.padEnd(18)}${yn(able)}`);

if (!doSave) {
  console.log("\nPROBE ONLY. Nothing was written. Re-run the same command with --save to commit it.");
  process.exit(0);
}

// ── save ─────────────────────────────────────────────────────────────────────
// performedBy and createdBy are LITERAL null on purpose. They are uuid columns
// in two different id spaces (member_audit_log.performed_by holds a staff row
// id, the direct-key row's created_by holds an auth user id) and a CLI run has
// neither. Inventing a staff row to fill them would put a fiction in the audit;
// the --as name is what makes this run answerable.
//
// The account-collision refusal is NOT re-implemented here. It lives inside
// saveDirectKey and arrives as a .status 409 whose message already names the
// other academy where it can, so a second lookup out here could only produce a
// second, differently-worded answer to the same question.
console.log("\nsaving ...");
let saved;
try {
  saved = await saveDirectKey({
    clientId: client.id,
    secretKey: secretFromStdin,
    publishableKey,
    performedByName: actor,
    performedBy: null,
    createdBy: null,
  });
} catch (e) {
  if (e.status) failExpected(e);
  failUnknownDuringSave(e);
}

console.log(`\nSAVED - ${NAME} now runs on its own Stripe key (last4 ${saved.key_last4}, account ${saved.account_id}), saved by ${actor}.`);

// ── webhook ──────────────────────────────────────────────────────────────────
// Registration is attempted AFTER the row is written and its failure is
// reported, never thrown: the contract does not roll the save back. Saying so
// out loud matters, because the natural reading of an error at the end of a run
// is "so none of it happened".
const wh = saved.webhook || {};
if (wh.ok) {
  console.log(`   webhook: ${wh.skipped || wh.action || "ok"}${wh.endpoint_id ? ` (${wh.endpoint_id})` : ""}`);
} else {
  console.log(`   webhook: FAILED - ${wh.error || "unknown error"}`);
  console.log("   THE SAVE STILL STANDS. The key is stored and live; only the webhook endpoint is missing,");
  console.log("   which means this academy's Stripe events will not reach the portal until it is registered.");
  console.log("   Re-run the webhook registration from the staff Stripe panel (it is idempotent).");
}

// ── the proof: can PRODUCTION read back what we just wrote? ──────────────────
// REQUIRED, not optional, and never skipped on a save. The failure it exists for
// is silent: a local STRIPE_DIRECT_ENC_KEY that differs from production's
// encrypts the academy's live key into a blob production cannot decrypt. Every
// local check passes, this CLI says SAVED, and the first anyone hears of it is a
// payment that does not go through. Only production can answer this, so we ask
// production. See the header for why a local round trip is not evidence.
const RETRY_PROOF =
  `curl -sS -X POST "$PORTAL_BASE_URL/api/stripe/cron-key-health" -H "Authorization: Bearer $CRON_SECRET"` +
  `\n     ... then look for "${clientId}" in the results array (outcome ready or not_ready = production can read the key).`;

// Shapes, not string equality: the message comes from production and only its
// KIND matters. A decrypt failure is AES-GCM refusing to authenticate the blob,
// or the enc key being absent there entirely.
const CREDENTIAL_SHAPED = /unable to authenticate data|unsupported state|bad decrypt|wrong final block|invalid key length|invalid initialization vector|STRIPE_DIRECT_ENC_KEY|decrypt|invalid api key|expired|no such key|permission/i;
const NETWORK_SHAPED = /fetch failed|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|timed? ?out|network|aborted|Stripe 5\d\d|429|rate limit/i;

function proofProved(outcome) {
  console.log(`\nPROVED - production read the key back (health: ${outcome}).`);
  console.log("Production decrypted the stored key with its own encryption key and used it against Stripe,");
  console.log("so the credential this run wrote is one production can actually use. The save is complete.");
  if (outcome === "not_ready") {
    console.log("(not_ready is about the Stripe ACCOUNT still finishing onboarding, not about the key - the key worked.)");
  }
  process.exit(0);
}
// `likely` is passed in rather than fixed, because the two ways this fails have
// DIFFERENT causes and different fixes. Printing the enc-key diagnosis at an
// operator whose key production decrypted perfectly well would send them to
// re-pull an env var that was never the problem.
function proofFailed(detail, likely) {
  console.error("\nNOT PROVED - THE SAVE LANDED BUT PRODUCTION CANNOT USE IT.");
  console.error(`   production said: ${detail}`);
  console.error(`   The key row for ${NAME} is written, and production cannot get a working Stripe call out of it.`);
  console.error(`   ${likely}`);
  console.error("   PAYMENTS FOR THIS ACADEMY WILL NOT WORK. Do NOT treat this academy as live.");
  console.error("   Fix that first, re-run this command with --save, and rely on it only once this says PROVED.");
  process.exit(1);
}
function proofInconclusive(detail) {
  console.error(`\nNOT PROVED - the save landed, but the check did not run: ${detail}`);
  console.error("   This is NOT a success and NOT a failure. Nothing here says the stored key is good,");
  console.error("   and nothing here says it is bad - production was never asked, or never answered.");
  console.error(`   Retry the proof on its own (it writes nothing):\n     ${RETRY_PROOF}`);
  process.exit(2);
}

console.log("\nasking production to read the key back ...");
let health = null;
let reachError = null;
try {
  const r = await fetch(`${PORTAL_BASE_URL}/api/stripe/cron-key-health`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      "Content-Type": "application/json",
    },
  });
  const txt = await r.text();
  if (!r.ok) reachError = `the endpoint answered ${r.status}: ${String(txt).slice(0, 200)}`;
  else health = txt ? JSON.parse(txt) : null;
} catch (e) {
  reachError = e.message || String(e);
}

if (reachError) proofInconclusive(`could not reach production - ${reachError}`);
const results = health && Array.isArray(health.results) ? health.results : null;
if (!results) proofInconclusive("production answered without a results array, so there is nothing to read our row out of");

const mine = results.find((row) => String(row.client_id) === String(client.id));
// Absent means production never probed this academy on this call - the row may
// not have been visible yet, or the endpoint's own query failed. It is NOT a
// clean bill of health, and it is not a decrypt failure either.
if (!mine) proofInconclusive(`production checked ${results.length} direct-key academy row(s) and ours was not among them`);

const detail = String(mine.error || "").slice(0, 300);
if (mine.outcome === "ready" || mine.outcome === "not_ready") {
  proofProved(mine.outcome);
} else if (mine.outcome === "invalid") {
  // Production DID decrypt the blob and Stripe rejected the key it found. The
  // diagnosis differs from a decrypt failure; the verdict does not.
  proofFailed(
    `the key was read but Stripe rejected it as invalid${detail ? ` (${detail})` : ""}`,
    "Production decrypted the stored key without trouble, so the encryption side is fine - STRIPE is what refused it. " +
    "The key was most likely rolled or revoked in the academy's own Stripe dashboard; get a fresh rk_live_ key from them."
  );
} else if (CREDENTIAL_SHAPED.test(detail)) {
  proofFailed(
    `could not read the stored credential (${detail})`,
    "The most likely cause is a local STRIPE_DIRECT_ENC_KEY that is not the one production runs on, so the blob this run " +
    "wrote cannot be decrypted there. Pull the production env: vercel env pull .env.production.local --environment=production"
  );
} else if (NETWORK_SHAPED.test(detail)) {
  proofInconclusive(`production could not complete the check (${detail}) - that reads like a blip, not a bad key`);
} else {
  proofInconclusive(`production returned "${mine.outcome}"${detail ? ` (${detail})` : ""}, which is neither an answer nor a recognised failure`);
}
