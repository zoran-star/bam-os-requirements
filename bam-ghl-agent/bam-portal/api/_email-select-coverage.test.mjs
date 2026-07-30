// A COLUMN THE EMAIL LAYER READS AND THE SELECT LIST DOES NOT ASK FOR.
//
//   node api/_email-select-coverage.test.mjs
//
// Plain node. No network, no database, no dependencies.
//
// WHAT WAS WRONG. On 29 Jul 2026 three columns were added to `clients` and read by
// clientVars() - the one function that turns an academy's row into the merge vars every
// automation message renders from - and added to NO select list. loadClient() projects:
// a column it does not name is not on the row it returns. So all three arrived
// undefined and rendered as nothing, and BAM GTA sent LIVE automation emails with:
//
//   tagline        -> no sentence under the footer wordmark
//   instagram_url  -> no footer Instagram link at all
//   business_email -> no footer contact line, no {{SUPPORT_EMAIL}}, and on the
//                     APPROVAL PREVIEW no unsubscribe (see section 5 for why the live
//                     send kept its unsubscribe and the preview did not - the two
//                     surfaces that are supposed to be byte-identical were not)
//
// Nothing threw. Nothing was logged. Every existing suite stayed green, because every
// existing suite builds its own fixture row by hand and hands clientVars() a row that
// HAS the columns. The select list was the only thing that did not know, and no test
// asked it.
//
// THIS SUITE IS ABOUT THE CLASS, NOT THE INSTANCE. Three columns went missing the same
// way on the same day. So the required set is DERIVED - read out of clientVars()'s own
// source text, every `c.<column>` it touches - and compared against what the code
// ACTUALLY ASKS POSTGRES FOR, captured off a stubbed wire from the real loadClient. Add
// a column to clientVars() tomorrow, forget the select list, and section 2 fails naming
// it. Neither half is a list somebody has to remember to update.
//
// WHY IT RENDERS. Standing rule in this repo: a literal-grep audit gives false answers.
// So sections 3-5 do not inspect the select list at all - they build the row the way
// loadClient actually returns it (select-PROJECTED, so a column absent from the list is
// absent from the row) and read the bytes of the resulting email.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//   1. The derived required set is real: it finds the three columns that regressed, it
//      does NOT find `clients.email` (which clientVars deliberately never reads, and
//      which is named in a comment two lines away - so if comment-stripping breaks,
//      this says so instead of quietly widening the set), and it is not empty.
//   2. Both loadClient selects AND the send path's own select COVER that derived set, on
//      the real modules, measured from the URL that reached the wire. The send path is
//      in that list as of 30 Jul 2026 because it now RENDERS from its own row read (see
//      6), so a column missing from SENDER_COLS blanks a footer exactly the way a column
//      missing from CLIENT_COLS did.
//   3. POST-FIX, RENDERED: GTA's row as loadClient returns it today carries all three,
//      and the footer of a real email carries its tagline, its Instagram link, its
//      contact address and its unsubscribe.
//   4. PRE-FIX, RENDERED: the same row minus exactly those three columns renders all
//      four as EMPTY. This suite would have caught the regression, which is the only
//      thing that makes its green mean anything.
//   5. The live send path and the approval preview are compared, because they diverged:
//      sendOn substitutes location_email from its OWN row read, so the wire kept its
//      unsubscribe while the preview - which does not substitute - lost it.
//   6. THE `vars: {}` SENDERS. Three call sites hand sendOn no vars at all on purpose
//      (their merge tokens are resolved before the call): api/agent-confirm.js
//      fireScriptedStep (the scripted booking confirmation AND the same-day check-in),
//      api/agent-confirm.js fireCardEmail, and api/agent-approvals.js's confirmation
//      email. Their emails now carry the academy's whole footer, because sendOn renders
//      from clientVars(its own row) with the caller's vars on top. Asserted on the BYTES
//      THAT REACHED THE WIRE, against a client row that really has a tagline and an
//      Instagram URL, plus the pre-fix render alongside it showing both blank - so the
//      green means the suite would have caught the bug it was written for.
//      The class check is DERIVED, not a list: every value clientVars() puts in the
//      full-vars email must also be in the vars:{} email. Three columns went missing the
//      same way in one day; a hand-written list of footer fields would have missed them
//      the same way twice.
//
// WHAT IT DOES NOT PROVE
//   - That the select lists match the real schema. A typo in `google_review_url` would
//     400 identically and nothing here would say so; the stub answers whatever it is
//     asked. That gap is older than this change (see the same note in
//     api/_pending-client-column.test.mjs) and is not closed by it. (The 15 columns in
//     SENDER_COLS were checked against production's information_schema by hand on
//     30 Jul 2026, which is a one-time check and not a standing one.)
//   - Anything about columns read OUTSIDE clientVars(). `time_zone`, the ghl_* tokens
//     and `booking_provider` are read directly by their callers, so the derived set
//     does not cover them and a regression there would look exactly like this one did.
//   - Anything about the SMS branch of sendOn, which still renders from the caller's
//     vars alone and reads no client row. Every SMS caller passes clientVars today; a
//     future one that does not would send an academy-less text and nothing here would
//     say so.
//   - That an EMPTY value from the caller falls through to the row. It deliberately does
//     not: the caller's vars win even when they are blank, so the approval preview and
//     the wire stay byte-identical (section 5 records the one field that is exempt, and
//     why). A caller with a thin select therefore still ships blanks - on BOTH surfaces,
//     which is what section 2 is for.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing and must print NEGATIVE CONTROL PASSED:
//
//   MUTATE=nocols     node api/_email-select-coverage.test.mjs  # the three columns leave
//                                                              # CLIENT_COLS in both
//                                                              # loadClient files - the
//                                                              # live regression, restored
//   MUTATE=nosender   node api/_email-select-coverage.test.mjs  # business_email leaves
//                                                              # SENDER_COLS, so the send
//                                                              # path loses the address it
//                                                              # substitutes
//   MUTATE=thinsender node api/_email-select-coverage.test.mjs  # SENDER_COLS shrinks back
//                                                              # to the three identity
//                                                              # columns, so the row the
//                                                              # send renders from has no
//                                                              # tagline or Instagram
//   MUTATE=novarsbase node api/_email-select-coverage.test.mjs  # the render drops the row
//                                                              # base and uses only the
//                                                              # caller's vars - the shape
//                                                              # that shipped, restored
//   MUTATE=blindset   node api/_email-select-coverage.test.mjs  # the DERIVED set is
//                                                              # emptied, which would make
//                                                              # section 2 vacuously green
//   MUTATE=borrow     node api/_email-select-coverage.test.mjs  # a row missing the facts
//                                                              # inherits GTA's, the shape
//                                                              # a fallback would have
//
// `nocols`, `nosender`, `thinsender` and `novarsbase` are source edits against the real
// files, and a pin that cannot find its target is reported as NEGATIVE CONTROL FAILED,
// never as a pass. `blindset` attacks this suite's OWN extractor, because a coverage
// check whose required set can silently become empty is decorative.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = path.resolve(HERE, "../../../scripts/snapshots");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};
let controlBroken = null;

// ─── the fixture: GTA, from the production snapshot ──────────────────────────
// The same snapshot every GTA lock reads, so "what GTA looks like today" has one answer
// across every suite. `email_domain` is the one SYNTHETIC field here (the snapshot does
// not carry it) and it is set to the site domain, which is what production has; it is
// only needed so the send path in section 5 clears its verified-domain gate.
const GTA = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, "bam-gta.json"), "utf8")).client;
const ROW = { ...GTA, email_domain: (GTA.website_setup && GTA.website_setup.domain) || "" };

// The three that regressed. Named here because the CONTROLS act on them, not because
// the coverage check needs a list - that one is derived.
const REGRESSED = ["business_email", "tagline", "instagram_url"];

// A second academy, same shape, different facts. Section 6 sends as this one to show the
// footer follows the ROW rather than a value that happens to be GTA's. Its sending domain
// stays GTA's so the send clears the verified-domain gate, which is a different question
// than whose footer this is.
const ALT_ID = "alt-academy-0000-0000-000000000000";
const ALT = {
  ...ROW,
  id: ALT_ID,
  public_name: "Northside Hoops",
  tagline: "Guard skills for Northside athletes, all year.",
  instagram_url: "https://instagram.com/northsidehoops",
};

// ─── the derived required set ────────────────────────────────────────────────
// Every `c.<column>` clientVars() reads, out of its own source. Comments are stripped
// FIRST, and that matters more than it looks: the comment beside `location_email`
// explains at length why it must NOT read `c.email`, and a naive scan would pick that
// up and require the owner's inbox column. `//` preceded by a colon is left alone so
// `https://` inside the function survives. Section 1 checks the extractor by what it
// found AND by what it refused to find.
function readsOf(src, marker, receiver) {
  const start = src.indexOf(marker);
  if (start < 0) {
    controlBroken = `this suite cannot find ${JSON.stringify(marker)} in the source it derives from. The function it reads has moved or been renamed, so the required set is whatever is left - re-point it or delete it.`;
    throw new Error(controlBroken);
  }
  const end = src.indexOf("\n}", start);
  const body = src.slice(start, end < 0 ? src.length : end);
  const nocomments = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out = new Set();
  const re = new RegExp(`\\b${receiver}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
  let m;
  while ((m = re.exec(nocomments))) out.add(m[1]);
  return out;
}

const SHELLS_SRC = fs.readFileSync(path.join(HERE, "email-shells.js"), "utf8");
const SEND_SRC = fs.readFileSync(path.join(HERE, "_send.js"), "utf8");

// What clientVars() needs on the row it is handed. This is the set both loadClient
// lists must cover.
let VARS_NEEDS = readsOf(SHELLS_SRC, "export function clientVars(client) {", "c");
// What clientSender() needs. A separate, much smaller read with a separate list.
let SENDER_NEEDS = readsOf(SEND_SRC, "async function clientSender(clientId) {", "row");
if (MUTATE === "blindset") { VARS_NEEDS = new Set(); SENDER_NEEDS = new Set(); }

console.log("\n── 1. the required set is DERIVED from clientVars(), and the extractor works ──");
{
  const list = [...VARS_NEEDS].sort();
  console.log(`     clientVars reads: ${list.join(", ")}`);
  console.log(`     clientSender reads: ${[...SENDER_NEEDS].sort().join(", ")}`);
  // Width, so a broken extractor returning nothing cannot make section 2 pass.
  ok(VARS_NEEDS.size >= 12, `clientVars's required set is ${VARS_NEEDS.size} columns wide, not a handful the extractor happened to find`);
  ok(SENDER_NEEDS.size >= 3, `clientSender's is ${SENDER_NEEDS.size} wide`);
  // The three that regressed must be IN it, or this suite cannot have caught them.
  for (const c of REGRESSED) ok(VARS_NEEDS.has(c), `the derived set includes ${c} (the column that went missing)`);
  ok(SENDER_NEEDS.has("business_email") && SENDER_NEEDS.has("email_domain"),
    "clientSender's derived set includes business_email and email_domain");
  // And the extractor's own negative control: `clients.email` is named in a COMMENT
  // inside clientVars, at length, precisely to say it must never be read. If it shows
  // up in the derived set, comment-stripping is broken and every claim below is soft.
  ok(!VARS_NEEDS.has("email"), "and does NOT include `email` - clientVars only names it in a comment, so comment-stripping held");
  ok(!VARS_NEEDS.has("domain"), "nor `domain`, which is a property of website_setup and not a column");
}

// ─── the stubbed wire ────────────────────────────────────────────────────────
let CLIENT_SELECTS = [];
let WIRE = null;
const reset = () => { CLIENT_SELECTS = []; WIRE = null; };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const body = init.body ? JSON.parse(init.body) : null;

  if (u.includes("/rest/v1/clients?")) {
    const sel = new URL(u).searchParams.get("select") || "";
    CLIENT_SELECTS.push(sel);
    const cols = sel.split(",").map((s) => s.trim()).filter(Boolean);
    // A SECOND academy, by id, for section 6: the send path reads the row itself now, so
    // "the footer is this academy's own" has to be shown by CHANGING the academy and
    // watching the footer change. One row would prove a pin just as well as data.
    const src = u.includes(`id=eq.${ALT_ID}`) ? ALT : ROW;
    // PROJECTED, which is the whole point: a column the select did not name is not on
    // the row that comes back. That is what turned three schema columns into three
    // blank lines in a parent's inbox, and it is what this stub has to reproduce
    // faithfully or none of the render sections mean anything.
    return json([Object.fromEntries(cols.filter((c) => c in src).map((c) => [c, src[c]]))]);
  }
  if (u === "https://api.resend.com/emails" && method === "POST") { WIRE = { subject: body.subject, html: body.html, from: body.from }; return json({ id: "stub-email" }); }
  if (u === "https://api.resend.com/domains") return json({ data: [{ name: ROW.email_domain, status: "verified" }] });
  if (u.includes("/rest/v1/email_events")) return method === "POST" ? json([{ id: "ev-1" }]) : json([]);
  if (u.includes("/rest/v1/email_suppressions")) return json([]);
  if (u.includes("/rest/v1/client_users")) return json([{ id: "cu-1", name: "Owner", phone: "+15550001111", role: "owner" }]);
  if (u.includes("/conversations/messages") && method === "POST") return json({ messageId: "stub-sms" });
  if (u.includes("services.leadconnectorhq.com/contacts/")) return json({ contacts: [{ id: "stub-owner-contact" }] });
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

// ─── the modules, as themselves ──────────────────────────────────────────────
// loadClient is module-private and is not exported for a test's convenience. The copy
// imported here is the real file byte for byte, plus one appended export line, so what
// runs below is the shipped select list. Same contract as
// api/_pending-client-column.test.mjs: a mutation pinned to text that has MOVED makes
// this suite report NEGATIVE CONTROL FAILED, not a pass.
//
// One pin covers both files: they share the line the three columns were added on.
const NOCOLS = [[`"business_email", "tagline", "instagram_url",`, ``]];
// business_email alone leaves the send path's select: the address it substitutes and
// holds on stops arriving, so every send below holds instead of going out.
const NOSENDER = [[
  `  "business_email", "public_name", "owner_name",`,
  `  "public_name", "owner_name",`]];
// The whole clientVars half leaves it - SENDER_COLS back to the three identity columns
// it carried before 30 Jul 2026. The send still goes out and still carries its
// unsubscribe; it is the FOOTER that empties, which is the failure mode that shipped and
// the reason a coverage check has to cover this list too.
const THINSENDER = [[
  `const SENDER_COLS = ["email_domain", "business_name",
  "business_email", "public_name", "owner_name", "website_setup", "address", "phone",
  "community_group_url", "community_group_platform", "google_review_url",
  "online_programs_url", "referral_offer", "tagline", "instagram_url"];`,
  `const SENDER_COLS = ["email_domain", "business_name", "business_email"];`]];
// The pre-fix render, restored byte for byte: the row is read, the guard consults it,
// and then the email is built from the caller's vars alone. Everything the three
// `vars: {}` senders put on the wire loses its academy.
const NOVARSBASE = [[
  `const renderVars = { ...(sender.baseVars || {}), ...(vars || {}), location_email: sender.businessEmail };`,
  `const renderVars = { ...(vars || {}), location_email: sender.businessEmail };`]];

let copyCount = 0;
async function copyOf(rel, edits, appendExport) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `${MUTATE ? `MUTATE=${MUTATE}` : "This suite"} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\nRe-point it at the current code or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  if (appendExport) src += `\nexport { ${appendExport} as __probe };\n`;
  const tmp = path.join(path.dirname(abs), `.selcov-${++copyCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}

const colEdits = MUTATE === "nocols" ? NOCOLS : [];
const AUTOMATIONS = await copyOf("automations.js", colEdits, "loadClient");
const CONFIRM = await copyOf("agent-confirm.js", colEdits, "loadClient");
const SEND_EDITS = MUTATE === "nosender" ? NOSENDER
  : MUTATE === "thinsender" ? THINSENDER
  : MUTATE === "novarsbase" ? NOVARSBASE
  : [];
const { sendOn } = SEND_EDITS.length ? await copyOf("_send.js", SEND_EDITS, null) : await import("./_send.js");
const { renderEmail, renderStepMessage, clientVars } = await import("./email-shells.js");

const LOADERS = [
  ["api/automations.js", AUTOMATIONS.__probe],
  ["api/agent-confirm.js", CONFIRM.__probe],
];

// ─── 2. coverage, measured off the wire ──────────────────────────────────────
console.log("\n── 2. every column clientVars reads is in what the code ASKS Postgres for ──");
const LOADED = new Map();
for (const [label, loadClient] of LOADERS) {
  reset();
  let row = null, threw = null;
  try { row = await loadClient(ROW.id); } catch (e) { threw = e; }
  ok(!threw, `${label}: the select succeeds${threw ? ` (threw ${threw.message})` : ""}`);
  const asked = new Set(String(CLIENT_SELECTS[0] || "").split(",").map((s) => s.trim()).filter(Boolean));
  const missing = [...VARS_NEEDS].filter((c) => !asked.has(c)).sort();
  ok(missing.length === 0,
    missing.length
      ? `${label}: ASKS FOR NEITHER of ${missing.length} column(s) clientVars reads: ${missing.join(", ")} - they will arrive undefined and render as nothing`
      : `${label}: covers all ${VARS_NEEDS.size} columns clientVars reads`);
  ok(CLIENT_SELECTS.length === 1, `${label}: one read, no pending-column retry needed (saw ${CLIENT_SELECTS.length})`);
  LOADED.set(label, row);
}
{
  reset();
  const r = await sendOn({ channel: "email", clientId: ROW.id, toEmail: "parent@example.test", subject: "s", body: "Hi {{contact.first_name}}, see you at training.", vars: { first_name: "Maya" } });
  ok(!!r.sent, `api/_send.js: the send goes out (${JSON.stringify(r)})`);
  const asked = new Set(String(CLIENT_SELECTS.find((s) => s.includes("email_domain")) || "").split(",").map((s) => s.trim()).filter(Boolean));
  const missing = [...SENDER_NEEDS].filter((c) => !asked.has(c)).sort();
  ok(missing.length === 0,
    missing.length
      ? `api/_send.js: clientSender ASKS FOR NEITHER of: ${missing.join(", ")}`
      : `api/_send.js: clientSender covers all ${SENDER_NEEDS.size} columns it reads`);
  // THE SAME CHECK THE TWO loadClient LISTS GET, and for the same reason: since
  // 30 Jul 2026 the send path RENDERS from this row (clientVars of it is the base every
  // email is built on, see section 6), so a column clientVars reads and this select does
  // not name arrives undefined and renders as nothing. Identical failure, identical
  // silence, one layer down - and the same derived set, so tomorrow's column is covered
  // without anybody remembering this list exists.
  const missingVars = [...VARS_NEEDS].filter((c) => !asked.has(c)).sort();
  ok(missingVars.length === 0,
    missingVars.length
      ? `api/_send.js: the send path renders from this row and ASKS FOR NEITHER of ${missingVars.length} column(s) clientVars reads: ${missingVars.join(", ")} - they render as nothing for every caller that passes no vars`
      : `api/_send.js: its select also covers all ${VARS_NEEDS.size} columns clientVars reads`);
  ok(CLIENT_SELECTS.filter((s) => s.includes("email_domain")).length === 1,
    "and it is still ONE read of the clients row per send, not one per fact");
}

// ─── the render seam ─────────────────────────────────────────────────────────
const FAMILY = { first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };
const BODY = "Hi {{contact.first_name}},\n\nJordan's spot is held for this week.\n\nSee you at training.";
// The ONE mutation seam for `borrow`, the same seam api/_tagline-instagram.test.mjs and
// api/_business-email.test.mjs use: how a caller turns a row into vars. `borrow` is
// byte-for-byte what a fallback to GTA's values would produce, because all three are
// read straight off the vars with no derivation in between.
function varsFor(row) {
  const v = { ...FAMILY, ...clientVars(row) };
  if (MUTATE === "borrow") {
    v.location_tagline = v.location_tagline || GTA.tagline;
    v.location_instagram_url = v.location_instagram_url || GTA.instagram_url;
    v.location_email = v.location_email || GTA.business_email;
  }
  return v;
}
const emailFor = (row) => renderEmail({ clientId: ROW.id, subject: "Your spot this week", body: BODY, vars: varsFor(row) });
// Pulled out by the footer's own style rather than searched for anywhere in the
// document, so "the tagline rendered" cannot be satisfied by the same words appearing
// in the body copy.
const taglineOf = (html) => { const m = /color:#9A9A92;">([\s\S]*?)<\/p>/.exec(String(html)); return m ? m[1].trim() : null; };
const igHrefOf = (html) => { const m = /<a href="([^"]*)"[^>]*>Instagram<\/a>/.exec(String(html)); return m ? m[1] : null; };
const unsubOf = (html) => { const m = /href="(mailto:[^"]*\?subject=Unsubscribe)"/.exec(String(html)); return m ? m[1] : null; };

// GTA's row as loadClient ACTUALLY returns it - not hand-built. Both files agree, so
// either will do; automations.js is the send worker, so that is the one used.
const AS_LOADED = LOADED.get("api/automations.js") || {};
// The SAME row minus exactly the three columns, which is the shape production returned
// before this fix: they were in clientVars and in no select list, so loadClient's
// projection dropped them.
const AS_LOADED_PREFIX = { ...AS_LOADED };
for (const c of REGRESSED) delete AS_LOADED_PREFIX[c];

// ─── 3. post-fix, rendered ───────────────────────────────────────────────────
console.log("\n── 3. the row loadClient returns today renders GTA's whole footer ──");
{
  // The fixture has to carry the facts, or the whole section passes against a drifted
  // snapshot without noticing.
  for (const c of REGRESSED) ok(!!GTA[c], `(fixture) the GTA snapshot carries ${c}`);
  for (const c of REGRESSED) ok(c in AS_LOADED, `loadClient's row carries ${c}`);
  const html = emailFor(AS_LOADED);
  ok(taglineOf(html) === GTA.tagline, `the footer tagline is GTA's own: ${JSON.stringify(GTA.tagline)}`);
  ok(igHrefOf(html) === GTA.instagram_url, `the footer Instagram link is GTA's own: ${GTA.instagram_url}`);
  ok(html.includes(`<a href="mailto:${GTA.business_email}"`), "the footer Email link is the academy's public address");
  ok(unsubOf(html) === `mailto:${GTA.business_email}?subject=Unsubscribe`, "and the unsubscribe points at the same address");
  ok(!html.includes(GTA.email), "the owner's personal inbox is nowhere in the email");
  ok(!html.includes("{{TAGLINE}}") && !html.includes("{{INSTAGRAM_URL}}") && !html.includes("{{SUPPORT_EMAIL}}"),
    "no raw placeholder is left showing");
  // Editing the row changes the email - the assertion a hardcode cannot satisfy.
  const edited = { ...AS_LOADED, tagline: "A different sentence entirely.", instagram_url: "https://instagram.com/someoneelse" };
  const html2 = emailFor(edited);
  ok(taglineOf(html2) === "A different sentence entirely." && igHrefOf(html2) === "https://instagram.com/someoneelse",
    "editing the row changes the footer, so these are data and not a pin");
}

// ─── 4. pre-fix, rendered: the regression, reproduced ────────────────────────
console.log("\n── 4. the same row WITHOUT those three columns renders all four blank ──");
{
  const html = emailFor(AS_LOADED_PREFIX);
  ok(taglineOf(html) === "", "no tagline sentence (this is what GTA's parents received)");
  ok(igHrefOf(html) === null, "no footer Instagram anchor at all");
  ok(!html.includes(`<a href="mailto:${GTA.business_email}"`), "no footer Email link");
  ok(unsubOf(html) === null, "and NO unsubscribe destination on this surface");
  // Nothing dead or borrowed shipped in their place, which is why it was quiet.
  ok(!html.includes('href=""'), "nothing dead shipped in their place");
  ok(!html.includes(GTA.tagline) && !html.includes(GTA.instagram_url), "and nothing was borrowed from anywhere");
  ok(html.includes("Jordan&#39;s spot is held") || html.includes("Jordan's spot is held"),
    "the message body was fine, which is exactly why nobody noticed");
}

// ─── 5. the send path vs the approval preview, which DIVERGED ───────────────
// The repo's claim is that the email an owner approves is byte-for-byte the email that
// goes out (ONE RENDER PATH, api/_send.js). It was not, and this is the shape of the
// gap: sendOn re-reads the row itself for business_email and SUBSTITUTES it into the
// vars, so the wire kept its unsubscribe while the preview - which renders straight
// from clientVars(loadClient(...)) - had none. The tagline and Instagram had no such
// substitution and were gone from both.
console.log("\n── 5. what the wire carried vs what the owner was shown ──");
{
  reset();
  const r = await sendOn({ channel: "email", clientId: ROW.id, toEmail: "parent@example.test", subject: "Your spot this week", body: BODY, vars: varsFor(AS_LOADED) });
  ok(!!r.sent && !!WIRE, `post-fix, the send goes out (${JSON.stringify(r)})`);
  ok(WIRE && taglineOf(WIRE.html) === GTA.tagline, "the bytes on the wire carry GTA's tagline");
  ok(WIRE && igHrefOf(WIRE.html) === GTA.instagram_url, "and its Instagram link");
  ok(WIRE && unsubOf(WIRE.html) === `mailto:${GTA.business_email}?subject=Unsubscribe`, "and its unsubscribe");
  // The preview surface and the wire now agree on all three, which is the claim.
  const preview = emailFor(AS_LOADED);
  ok(WIRE && taglineOf(preview) === taglineOf(WIRE.html) && igHrefOf(preview) === igHrefOf(WIRE.html)
    && unsubOf(preview) === unsubOf(WIRE.html),
    "the approval preview and the wire agree on all three footer facts");

  // And the pre-fix shape, on the wire, so the divergence is recorded and not inferred.
  reset();
  const r2 = await sendOn({ channel: "email", clientId: ROW.id, toEmail: "parent@example.test", subject: "Your spot this week", body: BODY, vars: varsFor(AS_LOADED_PREFIX) });
  ok(!!r2.sent && !!WIRE, "pre-fix the send was NOT held - it went out, degraded");
  ok(WIRE && unsubOf(WIRE.html) === `mailto:${GTA.business_email}?subject=Unsubscribe`,
    "(recording the divergence) the WIRE kept its unsubscribe, because sendOn substitutes location_email from its own read");
  ok(WIRE && taglineOf(WIRE.html) === "" && igHrefOf(WIRE.html) === null,
    "but the tagline and Instagram were gone from the wire too");
  ok(unsubOf(emailFor(AS_LOADED_PREFIX)) === null,
    "while the approval preview had no unsubscribe at all, so the two surfaces disagreed");
  // AND THEY STILL WOULD BE, which is a decision rather than a leftover. sendOn now
  // renders from clientVars(its own row), but the CALLER'S VARS WIN - including the
  // empty ones. A worker whose select dropped `tagline` passes location_tagline:"" and
  // that empty value is what renders, so the approval preview an owner said yes to and
  // the email that goes out stay byte-identical. Repairing it here instead would make
  // the wire quietly better than the preview, and the two surfaces are supposed to be
  // the same email. The thin select is caught in section 2, where it belongs; only
  // location_email is exempt, because a hold hangs off it (see the comment in sendOn).
  ok(WIRE && taglineOf(WIRE.html) === taglineOf(emailFor(AS_LOADED_PREFIX)),
    "the caller's EMPTY value still wins over the row, so the wire matches the preview rather than out-rendering it");
}

// ─── 6. the senders that pass NO vars at all ─────────────────────────────────
// api/agent-confirm.js fireScriptedStep (the scripted booking confirmation AND the
// same-day check-in ride the same call), api/agent-confirm.js fireCardEmail, and
// api/agent-approvals.js's confirmation email all call sendOn with `vars: {}` on
// purpose: their merge tokens are resolved into the body before the call, so there is
// nothing left to pass. Until 30 Jul 2026 sendOn substituted ONE var into that empty
// object - location_email, the field with a hold attached - and rendered the rest of the
// academy from nothing. Live, at an academy whose row carries both, every one of those
// emails went out with a blank tagline and no Instagram link.
console.log("\n── 6. a `vars: {}` sender still puts the whole academy on the wire ──");
{
  // What those callers actually hand over: finished text, no tokens, no vars.
  const RESOLVED = "Hi Maya,\n\nJordan's spot is booked for Tuesday at 7:00 PM.\n\nSee you at training.";
  const SUBJ = "Your free trial is booked!";
  // `html` is a STRING always, "" when nothing reached the wire. A send that holds is a
  // legitimate outcome to assert about (MUTATE=nosender produces exactly that), and a
  // suite that throws on it reports NEGATIVE CONTROL FAILED for a control that worked.
  const send = async (clientId, vars) => {
    reset();
    const r = await sendOn({ channel: "email", clientId, toEmail: "parent@example.test", subject: SUBJ, body: RESOLVED, vars });
    return { r, html: (WIRE && WIRE.html) || "" };
  };

  const blind = await send(ROW.id, {});
  ok(!!blind.r.sent && !!blind.html, `the vars:{} send goes out (${JSON.stringify(blind.r)})`);
  ok(taglineOf(blind.html) === GTA.tagline, `the WIRE carries the academy's tagline: ${JSON.stringify(GTA.tagline)}`);
  ok(igHrefOf(blind.html) === GTA.instagram_url, `and its Instagram link: ${GTA.instagram_url}`);
  ok(blind.html.includes(`<a href="mailto:${GTA.business_email}"`), "and its footer contact line");
  ok(unsubOf(blind.html) === `mailto:${GTA.business_email}?subject=Unsubscribe`, "and its unsubscribe, which is the one that never broke");
  ok(!blind.html.includes(GTA.email), "and the owner's personal inbox is nowhere in it");

  // THE SAME SEND, PRE-FIX, side by side. `{ location_email }` alone IS what sendOn used
  // to build for these callers, byte for byte, so this is the email GTA's parents got -
  // not a description of it. If this ever renders a tagline, the section above is
  // asserting something that was never broken.
  const preFix = renderStepMessage({ channel: "email", clientId: ROW.id, subject: SUBJ, body: RESOLVED, vars: { location_email: GTA.business_email } });
  ok(taglineOf(preFix.html) === "", "PRE-FIX, the same send rendered NO tagline sentence");
  ok(igHrefOf(preFix.html) === null, "PRE-FIX, no footer Instagram anchor at all");
  ok(unsubOf(preFix.html) === `mailto:${GTA.business_email}?subject=Unsubscribe`,
    "PRE-FIX, the unsubscribe was fine - the one field with a guard behind it was the one field nobody had to notice");
  ok(preFix.html !== blind.html, "so the wire changed, and this suite would have said so");

  // THE CLASS, DERIVED. Not "tagline and Instagram are back" - three columns went
  // missing the same way in one day, and a hand-written list of footer fields would have
  // missed all three the same way. The requirement is: whatever clientVars() puts into
  // an email when the caller spells it all out, a caller that spells out NOTHING gets
  // too. The expected set comes from clientVars()'s own output on the real row.
  const spelled = await send(ROW.id, clientVars(AS_LOADED));
  ok(!!spelled.r.sent && !!spelled.html && spelled.html === blind.html,
    "byte-for-byte, the vars:{} email IS the email a caller that passed every identity var gets");
  const full = clientVars(AS_LOADED);
  const rendered = Object.entries(full).filter(([, v]) => typeof v === "string" && v.trim() && spelled.html.includes(v));
  ok(rendered.length >= 4,
    `${rendered.length} of clientVars()'s values actually reach the email, so this check has something to measure (${rendered.map(([k]) => k).join(", ")})`);
  const dropped = rendered.filter(([, v]) => !blind.html.includes(v)).map(([k]) => k).sort();
  ok(dropped.length === 0,
    dropped.length
      ? `a vars:{} sender DROPS ${dropped.length} of them: ${dropped.join(", ")}`
      : `and a vars:{} sender drops none of them`);

  // Data, not a pin: a different academy's row, the same empty vars, its own footer.
  const other = await send(ALT_ID, {});
  ok(!!other.r.sent, "another academy's vars:{} send also goes out");
  ok(taglineOf(other.html) === ALT.tagline && igHrefOf(other.html) === ALT.instagram_url,
    "and carries ITS tagline and ITS Instagram, so the footer is read from the row and not from anywhere else");
  ok(!other.html.includes(GTA.tagline) && !other.html.includes(GTA.instagram_url),
    "with no trace of GTA's in it");
}

console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
