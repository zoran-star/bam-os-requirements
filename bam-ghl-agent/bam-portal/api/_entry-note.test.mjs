// THE BORROWED DOOR.
//
//     node api/_entry-note.test.mjs        # exits non-zero on any failure
//
// Until 30 Jul 2026 the morning-of trial confirmation ended with this, as a literal,
// in api/agent/confirm-automations.js:
//
//     "F.Y.I the gym entrance we use is at the front of the building, on the left
//      side."
//
// One string, in a SHARED automation step, on the money path: every academy with a
// booked trial sent it. A family in San Jose, Hialeah or Melbourne was told on the
// morning of their trial about a door at a building in Oakville, Ontario.
//
// THE SHARP PART, and the reason this file exists rather than a one-line fix. The
// line above it is "Location: {{appointment.meeting_location}}", and that line DROPS
// OUT when the token resolves empty. The door sentence had no such rule. So the
// academy with the LEAST information on file - no address anywhere in its chain -
// sent a parent nothing at all about where to go, and then one confident sentence
// about somebody else's entrance. The less we knew, the more certain we sounded.
//
// It is now locations.entry_note: a fact on the VENUE the family is actually booked
// into, nullable, and rendered through {{appointment.entry_note}}. No note means no
// sentence - not a blank line, not a dangling "F.Y.I".
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT RENDERS THROUGH
//
// The REAL fireScriptedStep() out of api/agent-confirm.js, driven end to end against
// a stubbed wire, exactly as api/_confirm-email-lock.test.mjs drives it (and by the
// same .mutant- copy mechanism, because the function is not exported). That matters
// here more than anywhere: the CLAIM is about where the sentence comes from, so the
// run has to make the real three hops - the lead's open opportunity, that offer's
// Blueprint primary location, that venue's row - rather than hand a renderer a note
// and check it comes back out.
//
// Three academies, and the third is the one that used to be worst:
//
//   BAM GTA        a venue with an entry note. The sentence appears, with its real
//                  text, read from scripts/snapshots/bam-gta.json so this file and
//                  the two GTA locks cannot disagree about what GTA's door says.
//   BAM San Jose   two venues, no entry note on either, which is true today. NO
//                  sentence at all. Its venue `notes` hold CLASS TIMES, so this is
//                  also where a lazy repurpose of that column would show up as a
//                  parent being texted a schedule where a door should be.
//   Nowhere        no venue, no business_info location, no address on the row. The
//                  Location line goes AND the door sentence goes. This academy is
//                  the whole point: it is the shape that used to produce the
//                  borrowed door, and it must now produce silence.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing in the REAL source (a throwaway copy of
// it) and must report NEGATIVE CONTROL PASSED, meaning this suite CAUGHT it. A
// control that does not print that line is decorative and must not be quoted.
//
//   MUTATE=hardcode      node api/_entry-note.test.mjs
//        THE BUG ITSELF, re-planted: the literal goes back on the end of the
//        morning_of template in api/agent/confirm-automations.js. This is the
//        control the brief asked for by name - it is the only thing that proves
//        the sentence can no longer come from anywhere but the venue's own row.
//   MUTATE=no-drop       node api/_entry-note.test.mjs
//        entry_note leaves DROP_WHEN_EMPTY, so an academy with no note stops
//        dropping the mention and ships the hole where the sentence was. It is
//        caught by section 2b and ONLY by 2b, and that is worth knowing: on the
//        SHIPPED template the token sits last, where the trailing trim() tidies an
//        empty line away by accident. So sections 1-3 pass without the rule. The
//        rule earns its place the moment an owner edits the copy and puts a lead-in
//        above the token, which the portal's step editor lets every academy do. A
//        guard that is only load-bearing on the shape you have not shipped yet is
//        still load-bearing - it is just not provable on the shape you have.
//   MUTATE=any-venue     node api/_entry-note.test.mjs
//        the entry note stops being gated on the address we are actually sending,
//        so a venue's door description rides along with a DIFFERENT building's
//        address. Same class of error as the hardcode, one lookup further in.
//   MUTATE=notes-fallback node api/_entry-note.test.mjs
//        entry_note falls back to locations.notes - the repurpose this column was
//        deliberately NOT built as. San Jose's notes are class times, so this
//        control is a parent being told the schedule is the door.
//
// Measured 2026-07-30, unmutated ALL PASS; hardcode -> 11 failures, no-drop -> 1,
// any-venue -> 2, notes-fallback -> 3.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS DOES NOT PROVE. It does not touch the Business Blueprint save path (that
// is section P of scripts/verify-bb-hydration.mjs, control b10), and it does not
// prove the migration seeds what it says it seeds - nothing here runs SQL. It reads
// GTA's note from the snapshot, which carries it AHEAD of production under that
// file's own documented exception, so a green run here means "once the migration
// lands" and not "today".
//
// HARD RULE: never an em dash anywhere in this file. Hyphens only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.resolve(HERE, "../../../scripts/snapshots/bam-gta.json");
const MUTATE = process.env.MUTATE || "";

// Nothing here reaches a network, but the modules under test read these at import
// time and build real URLs out of them.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";

// ─── the frozen clock ────────────────────────────────────────────────────────
// 17:00 UTC on the day of the trial. Deliberately a moment that is past the 9am
// check-in hour in ALL THREE of these academies' own zones (1pm Eastern, 10am
// Pacific, 12pm Central) and still before the trial, because the whole point of this
// file is comparing academies and a clock that only suits one of them would make two
// of the three renders "no scripted step due" instead of a message to read.
const FAKE_NOW = Date.parse("2026-08-04T17:00:00.000Z");
const TRIAL_START = "2026-08-04T23:00:00.000Z";
const TRIAL_END = "2026-08-05T00:00:00.000Z";
{
  const Real = Date;
  class Frozen extends Real {
    constructor(...a) { if (a.length === 0) super(FAKE_NOW); else super(...a); }
    static now() { return FAKE_NOW; }
  }
  globalThis.Date = Frozen;
}

const SNAPSHOT = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
const GTA_NOTE = SNAPSHOT.facts.location_entry_note;
const GTA_VENUE_ADDRESS = SNAPSHOT.facts.location_venue;
if (!GTA_NOTE || !GTA_VENUE_ADDRESS) {
  console.error("\n❌ STALE FIXTURE: scripts/snapshots/bam-gta.json has no facts.location_entry_note or"
    + "\n   facts.location_venue. The GTA case below would then assert that an academy WITH a note"
    + "\n   sends nothing, which is the failure this file exists to catch. Re-capture the facts block.\n");
  process.exit(2);
}

// The literal that used to ship. Held here as data so the assertions can hunt for it
// by value: if it ever reappears in a rendered message for an academy that did not
// write it, that is the bug returning, whatever route it took to get there.
const RETIRED_LITERAL = "F.Y.I the gym entrance we use is at the front of the building, on the left side.";

// ─── the three academies ─────────────────────────────────────────────────────
// Real shapes, taken from production on 2026-07-30 by read-only select. San Jose's
// venue `notes` really do hold class times; that is not invented to make a point.
const SCENES = {
  gta: {
    label: "BAM GTA - a venue WITH an entry note",
    client: { id: "cid-gta", business_name: "BAM GTA", public_name: "By Any Means Toronto",
      address: "2205 Rosemount Cres, Oakville, ON", time_zone: "America/New_York" },
    offerId: "offer-gta", venueId: "venue-gta",
    venue: { address: GTA_VENUE_ADDRESS, notes: "Entrance is on the left side.", entry_note: GTA_NOTE },
  },
  sanjose: {
    label: "BAM San Jose - a venue with NO entry note",
    client: { id: "cid-sj", business_name: "BAM San Jose", public_name: "By Any Means San Jose",
      address: "1051 W San Fernando St, San Jose, CA 95126", time_zone: "America/Los_Angeles" },
    offerId: "offer-sj", venueId: "venue-sj",
    // entry_note NULL, and notes holding something that is NOT a door. Both true today.
    venue: { address: "1051 W San Fernando St, San Jose, CA 95126",
      notes: "Pre-Season Academy (7th-12th grade) - Wed + Fri 7-8pm", entry_note: null },
  },
  nowhere: {
    label: "no address ANYWHERE and no entry note - the case that used to borrow the door",
    client: { id: "cid-nowhere", business_name: "Nowhere Academy", public_name: "Nowhere Academy",
      address: "", time_zone: "America/Chicago" },
    // No opportunity, so no offer, so no venue: the address chain has nothing to find
    // and clients.address is blank behind it.
    offerId: null, venueId: null, venue: null,
  },
};

// ─── the wire ────────────────────────────────────────────────────────────────
const STATE = { scene: SCENES.gta, sms: [], emails: [], cardRows: [], priorReplies: [], unstubbed: [] };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const fail = (status, msg) => new Response(JSON.stringify({ message: msg }), { status, headers: { "content-type": "application/json" } });
  const S = STATE.scene;

  if (u === "https://api.resend.com/emails" && method === "POST") { STATE.emails.push(body); return json({ id: "stub" }); }
  if (u === "https://api.resend.com/domains") return json({ data: [] });
  if (u.includes("/conversations/messages") && method === "POST") { STATE.sms.push(body.message); return json({ messageId: "stub" }); }

  // Projected, like the real select: a column not asked for is not in the answer.
  if (u.includes("/rest/v1/clients?")) {
    const sel = (new URL(u).searchParams.get("select") || "").split(",").filter(Boolean);
    const row = {};
    for (const c of sel) row[c] = S.client[c];
    return json([row]);
  }
  if (u.includes("/rest/v1/agent_confirm_replies")) {
    if (method === "POST") { STATE.cardRows.push(...(Array.isArray(body) ? body : [body])); return json([]); }
    return json(STATE.priorReplies);
  }
  // The three hops. An academy with no offer on its opportunity returns nothing at
  // hop one, which is how "Nowhere" ends up with no venue at all.
  if (u.includes("/rest/v1/opportunities")) return json(S.offerId ? [{ offer_id: S.offerId }] : []);
  if (u.includes("/rest/v1/offers")) return json(S.venueId ? [{ data: { general_info: { location: S.venueId } } }] : []);
  if (u.includes("/rest/v1/locations")) {
    if (!S.venue) return json([]);
    const sel = (new URL(u).searchParams.get("select") || "").split(",").filter(Boolean);
    // PRE-MIGRATION, faithfully: entry_note does not exist yet, so a select naming it
    // 400s the whole request. UNAPPLIED below flips this on to prove the fallback.
    if (UNAPPLIED && sel.includes("entry_note")) return fail(400, 'column locations.entry_note does not exist');
    const row = {};
    for (const c of sel) row[c] = S.venue[c];
    return json([row]);
  }
  if (u.includes("/rest/v1/")) return json([]);
  if (u.includes("/appointments")) return json({ events: [{ startTime: TRIAL_START, endTime: TRIAL_END, status: "confirmed", title: "Free Trial" }] });
  if (u.includes("/contacts/")) return json({ contact: { firstName: "Maya", name: "Maya Alvarez", email: "maya@example.test", phone: "+15551234567" } });
  STATE.unstubbed.push(`${method} ${u}`);
  return json([]);
};

let UNAPPLIED = false;   // set by the pre-migration section near the end

// ─── mutated copies, for the negative controls ───────────────────────────────
// The edit is applied to a throwaway sibling copy, imported, then deleted. Nothing in
// the tree is modified. Same mechanism as api/_confirm-email-lock.test.mjs. This file
// uses it on an ORDINARY run too, because fireScriptedStep is not exported and a
// suite that re-implemented its argument-building would be testing its own copy of
// the send path instead of the send path.
const MUTANT_FILES = [];
const cleanupMutants = () => { while (MUTANT_FILES.length) { try { fs.unlinkSync(MUTANT_FILES.pop()); } catch (_) { /* best effort */ } } };
process.on("exit", cleanupMutants);

function mutateText(src, label, edits) {
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      console.error(`\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} is pinned to text that is no longer in ${label}:\n\n${find}\n\n`
        + "   The code it was written against has moved or been reformatted, so this control breaks NOTHING\n"
        + "   and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a\n"
        + "   control that fails to apply looks exactly like a control that passed.\n");
      process.exit(1);
    }
    src = src.split(find).join(repl);
  }
  return src;
}
let mutantCount = 0;
function writeMutant(rel, edits, append = "") {
  const abs = path.join(HERE, rel);
  const src = mutateText(fs.readFileSync(abs, "utf8"), `api/${rel}`, edits) + append;
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  MUTANT_FILES.push(tmp);
  return tmp;
}

// THE BUG, as code. Puts the literal back on the end of the shared morning_of
// template, where it stood until 30 Jul 2026.
const HARDCODE_EDITS = [[
  `"Location: {{appointment.meeting_location}}\\n\\n" +`,
  `"Location: {{appointment.meeting_location}}\\n\\n" +\n"${RETIRED_LITERAL}\\n\\n" +`,
]];
// The mention-dropping rule, removed. The token still resolves empty; what changes is
// that its line no longer leaves with it.
const NODROP_EDITS = [[
  `const DROP_WHEN_EMPTY = ["appointment.entry_note"];`,
  `const DROP_WHEN_EMPTY = [];`,
]];
// The entry note un-gated from the address actually being sent, so a venue's door
// description travels with a different building's address.
const ANYVENUE_EDITS = [[
  `entryNote: venueAddress && location === venueAddress ? venue.entryNote : "",`,
  `entryNote: venue ? venue.entryNote : "",`,
]];
// entry_note falling back to the general venue note - the overload this column was
// deliberately not built as.
const NOTESFALLBACK_EDITS = [[
  `return { address: String(row.address || "").trim(), entryNote: String(row.entry_note || "").trim() };`,
  `return { address: String(row.address || "").trim(), entryNote: String(row.entry_note || row.notes || "").trim() };`,
]];
// notes-fallback has to be able to SEE notes, so it widens the select too. Kept with
// the control rather than in the shipped code on purpose.
const NOTESFALLBACK_SELECT = [[
  `&select=address,entry_note&limit=1`,
  `&select=address,entry_note,notes&limit=1`,
]];

const autosPath = ["hardcode", "no-drop"].includes(MUTATE)
  ? writeMutant("agent/confirm-automations.js", MUTATE === "hardcode" ? HARDCODE_EDITS : NODROP_EDITS)
  : path.join(HERE, "agent/confirm-automations.js");

const agentEdits = [];
if (autosPath !== path.join(HERE, "agent/confirm-automations.js")) {
  agentEdits.push([`from "./agent/confirm-automations.js"`, `from "./agent/${path.basename(autosPath)}"`]);
}
if (MUTATE === "any-venue") agentEdits.push(...ANYVENUE_EDITS);
if (MUTATE === "notes-fallback") agentEdits.push(...NOTESFALLBACK_EDITS, ...NOTESFALLBACK_SELECT);

const AGENT_SRC = fs.readFileSync(path.join(HERE, "agent-confirm.js"), "utf8");
if (!AGENT_SRC.includes("async function fireScriptedStep(")) {
  console.error("\n❌ api/agent-confirm.js no longer defines fireScriptedStep(). This suite drives that function\n"
    + "   directly; re-point it at whatever replaced it rather than deleting the coverage.\n");
  process.exit(2);
}
const agentPath = writeMutant("agent-confirm.js", agentEdits, "\nexport { fireScriptedStep as __fireScriptedStep };\n");
const AGENT = await import(pathToFileURL(agentPath).href);
const AUTOS_MOD = await import(pathToFileURL(autosPath).href);
cleanupMutants();

const { getConfirmAutomations } = AUTOS_MOD;

// ─── driving the real thing ──────────────────────────────────────────────────
// The morning_of step, reached the way the detector reaches it: the immediate
// confirmation already went for THIS trial, so nextDueStep moves on to the check-in.
// `template` overrides the shipped morning_of copy the way an OWNER does it, through
// clients.ghl_kpi_config.confirm_initial_automations - the same per-step override
// sanitizeAutomations() persists from the portal's step editor. It goes through
// getConfirmAutomations() rather than being handed to fireScriptedStep, so a custom
// template is resolved by exactly the code path a real academy's custom template is.
async function morningOf(sceneKey, { template } = {}) {
  STATE.scene = SCENES[sceneKey];
  STATE.sms = []; STATE.emails = []; STATE.cardRows = [];
  STATE.priorReplies = [{ kind: "confirm_auto", status: "sent", step_key: "confirm", trial_at: TRIAL_START }];
  const client = template
    ? { ...STATE.scene.client, ghl_kpi_config: { confirm_initial_automations: { steps: [{ key: "same_day", template }] } } }
    : STATE.scene.client;
  STATE.scene = { ...STATE.scene, client };
  const autos = getConfirmAutomations(client);
  autos.approved = true;
  const result = await AGENT.__fireScriptedStep({
    client: { ...STATE.scene.client }, token: "stub-token", locationId: "stub-location",
    mode: "self_drive", autos, cfg: {},
    item: { name: "Maya Alvarez", last_at: null }, contactId: "stub-contact", receiptOnly: false,
  });
  return { result, sms: STATE.sms[0] || "", card: STATE.cardRows[0] || null };
}

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };
const show = (s) => console.log("\n" + String(s).split("\n").map((l) => "      | " + l).join("\n") + "\n");

console.log("\n── the morning-of trial confirmation, rendered for three academies ──");
console.log("   Real fireScriptedStep, real three-hop venue lookup, stubbed wire.");
if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.`);

// ── 1. BAM GTA: a venue WITH a note ──
console.log(`\n── 1. ${SCENES.gta.label} ──`);
const gta = await morningOf("gta");
show(gta.sms);
check(gta.result === "sent", `the check-in actually sent (got ${JSON.stringify(gta.result)})`);
check(gta.sms.includes(GTA_NOTE), "the entry sentence appears, with its REAL text off the venue row");
check(gta.sms.includes(`Location: ${GTA_VENUE_ADDRESS}`),
  "and the address beside it is the SAME venue's address, not the registered business one");
check(!gta.sms.includes(SCENES.gta.client.address),
  "the registered business address does not appear (it is a house, not the gym)");
check(!gta.sms.includes(RETIRED_LITERAL), "and it is not the retired literal - the F.Y.I lead-in is gone with it");
// The sentence must be the LAST thing, on its own line, with one blank line above it.
check(/\n\nThe gym entrance we use is at the front of the building, on the left side\.$/.test(gta.sms),
  "it closes the message on its own line, cleanly spaced");

// ── 2. BAM San Jose: a venue with NO note ──
console.log(`\n── 2. ${SCENES.sanjose.label} ──`);
const sj = await morningOf("sanjose");
show(sj.sms);
check(sj.result === "sent", `the check-in still sends (got ${JSON.stringify(sj.result)})`);
check(!sj.sms.includes(RETIRED_LITERAL), "GTA's door sentence does NOT appear");
check(!/gym entrance|entrance we use|left side|front of the building/i.test(sj.sms),
  "and no sentence about an entrance appears at all, in any wording");
check(!/F\.Y\.I/i.test(sj.sms), "no dangling F.Y.I");
check(sj.sms.includes(`Location: ${SCENES.sanjose.venue.address}`), "its OWN venue address is still there");
check(!sj.sms.includes(SCENES.sanjose.venue.notes),
  "its venue NOTES (class times) do not leak into the message - entry_note is not `notes`");
// No stray line: the message must end on the Location line, with no trailing blank.
check(/Location: 1051 W San Fernando St, San Jose, CA 95126$/.test(sj.sms),
  "the message ENDS on the Location line - no blank line, no orphan where the sentence was");
check(!/\n\n\n/.test(sj.sms) && !/\n\s+\n/.test(sj.sms), "and there is no widened gap anywhere in it");

// ── 2b. the same academy, on a template its OWNER edited ──
// The shipped template puts the token last, where a trailing trim() would tidy an
// empty line away on its own. That is luck, not a rule, and it is not the shape this
// has to survive: every academy can rewrite this step's copy in the portal, and the
// natural way to write it is behind a lead-in. Without DROP_WHEN_EMPTY an academy
// with no note ships "Getting in:" followed by nothing, and a stray line after it -
// which is the "SCHEDULE: <nothing>" failure api/email-shells.js already learned once.
// This is the section MUTATE=no-drop is aimed at.
console.log("\n── 2b. an owner-edited template: the lead-in must leave with the fact ──");
const CUSTOM = "Hi {{contact.first_name}}, see you today.\n\n"
  + "Where: {{appointment.meeting_location}}\n\n"
  + "Getting in:\n{{appointment.entry_note}}\n\n"
  + "Bring water.";
const sjCustom = await morningOf("sanjose", { template: CUSTOM });
show(sjCustom.sms);
check(!/Getting in\s*:/i.test(sjCustom.sms),
  'the "Getting in:" lead-in is gone, because there was nothing to put under it');
check(!/\n\s*\n\s*\n/.test(sjCustom.sms), "no widened gap left where the block was");
check(sjCustom.sms.includes("Bring water.") && sjCustom.sms.includes("Where: 1051 W San Fernando St"),
  "and everything either side of it survives - a missing fact shortens the message, never breaks it");
const gtaCustom = await morningOf("gta", { template: CUSTOM });
show(gtaCustom.sms);
check(/Getting in:\n?The gym entrance/.test(gtaCustom.sms.replace(/\n+/g, "\n")),
  "the SAME template on an academy that HAS a note keeps the lead-in and fills it");

// ── 3. the nasty one: no address AND no note ──
console.log(`\n── 3. ${SCENES.nowhere.label} ──`);
const now = await morningOf("nowhere");
show(now.sms);
check(now.result === "sent", `it still sends - the check-in is transactional (got ${JSON.stringify(now.result)})`);
check(!now.sms.includes(RETIRED_LITERAL),
  "THE BUG: no borrowed door. The academy we know least about no longer sounds most certain");
check(!/gym entrance|entrance we use|left side|front of the building/i.test(now.sms),
  "no entrance sentence in any wording");
check(!/^\s*Location\s*:/im.test(now.sms), "the Location label drops out with its empty value (it always did)");
check(!/F\.Y\.I/i.test(now.sms), "and nothing dangles where the two of them used to be");
check(/Date: Tuesday, August 4, 2026$/.test(now.sms),
  "the message ends on the last fact it actually HAS, with no trailing hole");
check(now.sms.includes("good to go for your trial today"), "and the rest of the message is untouched");

// ── 4. the sentence can only come from the booked venue's own row ──
// Not a re-assertion of 1-3: this one is about ROUTE, not presence. Same academy,
// same venue, but the appointment carries its own address for a different building.
console.log("\n── 4. one venue's door cannot travel with another building's address ──");

const OTHER_BUILDING = "500 Somewhere Else Blvd, Mississauga, ON";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/appointments")) {
    return new Response(JSON.stringify({ events: [{ startTime: TRIAL_START, endTime: TRIAL_END, status: "confirmed", title: "Free Trial", address: OTHER_BUILDING }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};
const moved = await morningOf("gta");
globalThis.fetch = realFetch;
show(moved.sms);
check(moved.sms.includes(`Location: ${OTHER_BUILDING}`), "the appointment's own address wins, as it always has");
check(!moved.sms.includes(GTA_NOTE),
  "and GTA's door description does NOT follow it - we do not know that building's entrance");
check(!/gym entrance|entrance we use|left side/i.test(moved.sms), "nothing about a door is said at all");

// ── 5. pre-migration: entry_note does not exist yet ──
// The column ships ahead of its migration, so this is the live state until
// 20260730T160000 is applied. It must degrade to silence, and it must NOT take the
// venue address down with it - losing that is the 2026-07-04 regression, where
// families were sent to the registered business address.
console.log("\n── 5. before the migration lands: silence, but not a lost address ──");
UNAPPLIED = true;
const pre = await morningOf("gta");
UNAPPLIED = false;
show(pre.sms);
check(pre.result === "sent", `it still sends (got ${JSON.stringify(pre.result)})`);
check(!pre.sms.includes(GTA_NOTE) && !/gym entrance|F\.Y\.I/i.test(pre.sms),
  "no entry sentence, because there is no column to read one from yet");
check(pre.sms.includes(`Location: ${GTA_VENUE_ADDRESS}`),
  "but the VENUE address survives - the address-only retry ran, so nobody is sent to the wrong building");

// ── 6. the literal is gone from the tree ──
// Cheap, and it closes the door the other five leave open: a suite that renders can
// only see the paths it drives. This sees the file.
console.log("\n── 6. the literal is not in the source any more ──");
const SHIPPED_AUTOS = fs.readFileSync(path.join(HERE, "agent/confirm-automations.js"), "utf8");
const literalCore = "the gym entrance we use is at the front of the building";
// The comment that explains the retirement is allowed to NAME it. What must not
// exist is the sentence inside a template string that a message renders from.
const inTemplate = SHIPPED_AUTOS.split("\n")
  .filter((l) => l.toLowerCase().includes(literalCore) && !l.trim().startsWith("//"));
check(inTemplate.length === 0,
  `no shipped template still carries the sentence (found ${inTemplate.length} line(s))`);
if (inTemplate.length) inTemplate.forEach((l) => console.log("        " + l.trim()));

if (STATE.unstubbed.length) {
  fails++;
  console.log("\n  FAIL  unstubbed calls reached the wire - this run rendered with facts missing:");
  [...new Set(STATE.unstubbed)].forEach((c) => console.log("        " + c));
}

console.log(fails ? `\nRESULT: ${fails} FAILURE(S)` : "\nRESULT: ALL PASS");

if (MUTATE) {
  console.log(fails
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fails} assertion(s).`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} reverted a fix and every assertion still passed. That control is decorative.`);
  process.exit(fails ? 0 : 1);
}
process.exit(fails ? 1 : 0);
