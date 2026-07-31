// Test for the agent stage guard
// (api/agent/_stage.js contactStageState + api/agent/_store.js contactRoleState,
// and the three send paths that render their answer to a human).
//
//   node api/_stage-guard-unknown.test.mjs      # exits non-zero on any failure
//
// Plain node, same style as api/_gmail-mailbox-unknown.test.mjs: no dependencies,
// no network, no database. globalThis.fetch is replaced by a fake wire, and any
// URL this file did not expect is a hard error rather than a real request.
//
// ─── WHAT THIS SUITE IS FOR ─────────────────────────────────────────────────
//
// "Is this lead still in the Responded stage?" is a question we can only answer
// by asking GHL or the portal store. The function that asked it returned a bare
// boolean and its catch returned false, so a GHL timeout, an expired token and a
// lead who genuinely moved on all produced the same value.
//
// The send path then rendered that value to staff as a 409 reading "This lead is
// no longer in the Responded stage - not sending." That sentence is a FACT ABOUT
// A REAL PARENT, stated to a person who has no way to tell it apart from the
// truth and who will act on it: they close the card, they stop chasing the lead,
// they go looking in the pipeline for a move that never happened.
//
// House rule 10: a yes/no answer that crossed a network boundary must have THREE
// outcomes, not two. yes / no, and here is why / we could not ask.
//
// THE PROPERTY THIS SUITE EXISTS TO PIN, and the one staff rely on:
//
//     NO TRANSIENT FAILURE, AT ANY HOP, CAN PRODUCE THE "MOVED ON" ANSWER.
//
// That is a claim about an ABSENCE, and an absence is not evidence on its own.
// So every hop that could produce it is planted with the collapse and this suite
// has to catch it: MUTATE=collapse (the GHL read), MUTATE=storecollapse (the
// portal read), MUTATE=flagguess (the read that decides WHICH of those two to
// ask), MUTATE=unreadable (a 200 that answers nothing), MUTATE=nullisno (the
// shared shape), and MUTATE=send409 (the caller itself, which is the original
// bug exactly). A control that finds no target reports NEGATIVE CONTROL FAILED
// rather than passing quietly.
//
// The other half of a real fix is that the two answers stay TELLABLE APART. A
// guard that refuses everything is not safer, it is an outage of its own, so a
// real "no" must still 409 with the moved-on wording and a real "yes" must still
// send. MUTATE=samewords plants the version where staff cannot tell them apart.
//
// ─── NEGATIVE CONTROLS ──────────────────────────────────────────────────────
//
// Each writes a mutated MIRROR of api/ (relative imports resolve exactly as in
// production), imports the route from it, and deletes it again. Nothing is ever
// written over a real source file.
//
//   MUTATE=collapse          node api/_stage-guard-unknown.test.mjs  # the GHL catch goes back to "no" (the original bug)
//   MUTATE=storecollapse     node api/_stage-guard-unknown.test.mjs  # the portal read's catch goes back to "no"
//   MUTATE=flagguess         node api/_stage-guard-unknown.test.mjs  # an unreadable provider flag guesses "ghl" and answers anyway
//   MUTATE=unreadable        node api/_stage-guard-unknown.test.mjs  # a 200 that carries no list counts as "no"
//   MUTATE=nullisno          node api/_stage-guard-unknown.test.mjs  # the unknown state carries inStage:false again
//   MUTATE=send409           node api/_stage-guard-unknown.test.mjs  # the send path states the unknown as "no longer in the stage"
//   MUTATE=samewords         node api/_stage-guard-unknown.test.mjs  # the two refusals read identically to staff
//   MUTATE=rebooksamereason  node api/_stage-guard-unknown.test.mjs  # the rebook caller merges could-not-ask into not-in-stage

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, "..");
const API = HERE;
const MIRROR = path.join(PORTAL, ".mutant-api");
const MUTATE = process.env.MUTATE || "";

// Read at module load by the routes, so they have to be set before the import.
process.env.SUPABASE_URL = "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
process.env.ANTHROPIC_API_KEY = "stub-anthropic-key";
delete process.env.GHL_LOCATIONS_JSON;

const REST = `${process.env.SUPABASE_URL}/rest/v1/`;
const AUTH = `${process.env.SUPABASE_URL}/auth/v1/user`;
const GHL = "https://services.leadconnectorhq.com";

let pass = 0;
const fails = [];
const ok = (c, m) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { fails.push(m); console.log("  ❌ " + m); }
};

// A section that THROWS is a section that noticed something, not a suite that
// died. Without this, a mutation that makes the real code blow up takes the run
// down before the report prints, and CI (which requires the NEGATIVE CONTROL
// PASSED banner and deliberately does not accept a non-zero exit as proof)
// would then call a working control decorative.
async function section(label, fn) {
  console.log(`\n── ${label} ──`);
  try { await fn(); }
  catch (e) { ok(false, `${label}: threw instead of returning a result - ${(e && e.message) || e}`); }
}

// ─── mutated mirror, for the negative controls ──────────────────────────────
let controlBroken = null;

function mutateText(src, label, edits) {
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in ${label}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a control that fails to apply looks exactly like a control that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  return src;
}

// Each edit is pinned to the real line it reverts, so it breaks loudly if that
// line is rewritten rather than silently testing nothing. Written as ordinary
// double-quoted strings because the source they match contains backticks.
const EDITS = {
  // The original defect at the GHL hop: a transport failure becomes "not in the
  // stage", which the send path then states to staff as a fact about the lead.
  collapse: {
    "agent/_stage.js": [[
      "  } catch (e) {\n    return stageUnknown(`the GHL opportunity search failed: ${(e && e.message) || e}`);\n  }",
      "  } catch (e) {\n    return stageNo(`the GHL opportunity search failed: ${(e && e.message) || e}`);\n  }",
    ]],
  },
  // The same defect at the portal hop, which is the half a GHL-only fix misses.
  storecollapse: {
    "agent/_store.js": [[
      "      return stageUnknown(`the portal opportunity read failed: ${(e && e.message) || e}`);",
      "      return stageNo(`the portal opportunity read failed: ${(e && e.message) || e}`);",
    ]],
  },
  // The hop nobody looks at: the read that decides WHICH store owns the answer.
  // Guessing "ghl" for a portal academy asks a different system the question and
  // reports its answer as this one's.
  flagguess: {
    "agent/_stage.js": [[
      "    const flags = await pipelineFlagsState(ctx.clientId);\n    if (!flags.trusted) return stageUnknown(`could not read which pipeline this academy is on, so the stage was never checked (${flags.reason})`);\n    if (flags.provider === \"portal\") {",
      "    const flags = await pipelineFlagsState(ctx.clientId);\n    if (flags.provider === \"portal\") {",
    ]],
  },
  // The quiet half of the same collapse: a 200 whose body is not a list of
  // opportunities is not an answer of zero opportunities.
  unreadable: {
    "agent/_stage.js": [[
      "  if (!opps) return stageUnknown(\"the GHL opportunity search returned no readable list of opportunities\");",
      "  if (!opps) return stageNo(\"the GHL opportunity search returned no readable list of opportunities\");",
    ]],
  },
  // The shared shape. inStage:null is what stops a caller that reads only the
  // answer from silently reproducing the bug; inStage:false hands it straight back.
  nullisno: {
    "agent/_store.js": [[
      "export const stageUnknown = (why) => ({ inStage: null, trusted: false, reason: why });",
      "export const stageUnknown = (why) => ({ inStage: false, trusted: false, reason: why });",
    ]],
  },
  // The caller, which is where the harm actually lands: drop the third branch and
  // an unknown falls through to the 409 that asserts the lead moved on.
  send409: {
    "agent-approvals.js": [[
      "      if (!stSend.trusted) return res.status(503).json({ error: \"We couldn't check whether this lead is still in the Responded stage, so nothing was sent. Try again in a moment.\", unchecked: true, detail: stSend.reason });\n",
      "",
    ]],
  },
  // Three outcomes in the code, two in the sentence a human reads. The state is
  // separable and nobody can separate it.
  samewords: {
    "agent-approvals.js": [[
      "\"We couldn't check whether this lead is still in the Responded stage, so nothing was sent. Try again in a moment.\"",
      "\"This lead is no longer in the Responded stage - not sending.\"",
    ]],
  },
  // A non-HTTP caller: the rebook bounce. "We checked and they are not there" is
  // a finished decision; "we could not check" is a bounce still owed.
  rebooksamereason: {
    "agent/_rebook.js": [[
      "    if (!st.trusted) return { bounced: false, reason: \"stage-unknown\", detail: st.reason };",
      "    if (!st.trusted) return { bounced: false, reason: \"not-in-scheduled-trial\" };",
    ]],
  },
};

function cleanupMirror() { try { fs.rmSync(MIRROR, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
process.on("exit", cleanupMirror);

// No MUTATE -> import the REAL files, so a clean run tests production code and
// nothing else. With MUTATE -> mirror the whole of api/ (so every relative
// import resolves exactly as it does in production), edit the mirror, import
// from there, and delete it. A real source file is never written to.
async function loadModules() {
  const edits = EDITS[MUTATE];
  let root = API;
  if (edits) {
    cleanupMirror();
    fs.cpSync(API, MIRROR, { recursive: true });
    for (const [rel, pairs] of Object.entries(edits)) {
      const f = path.join(MIRROR, rel);
      fs.writeFileSync(f, mutateText(fs.readFileSync(f, "utf8"), `api/${rel}`, pairs));
    }
    root = MIRROR;
  }
  const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  try {
    const [stage, store, approvals, confirm, closing, rebook] = await Promise.all([
      load("agent/_stage.js"), load("agent/_store.js"), load("agent-approvals.js"),
      load("agent-confirm.js"), load("agent-closing.js"), load("agent/_rebook.js"),
    ]);
    return { stage, store, approvals, confirm, closing, rebook };
  } catch (e) {
    if (edits) controlBroken = `MUTATE=${MUTATE} produced a copy of api/ that does not import: ${e && e.message}. The control is testing the mutation, not the code.`;
    throw e;
  } finally {
    cleanupMirror();
  }
}

// ─── the fake wire ──────────────────────────────────────────────────────────
//
// One knob per HOP. Every scenario below is a real thing that happens to a
// healthy system on a bad afternoon, and only the hop under test misbehaves, so
// any behaviour change is attributable to that hop alone.

function resp(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

// The states where we genuinely could not get an answer.
const OUTAGES = [
  ["a 500 from the provider", () => resp(500, '{"message":"internal error"}')],
  ["a 502 from a gateway in front of it", () => resp(502, "bad gateway")],
  ["an expired token (401)", () => resp(401, '{"message":"Invalid JWT"}')],
  ["fetch rejecting outright (DNS, TLS, reset)", () => { throw new TypeError("fetch failed"); }],
  ["a 200 with an empty body", () => resp(200, "")],
  ["a 200 carrying an error object instead of a list", () => resp(200, '{"message":"JWT expired","code":"PGRST301"}')],
];

const STAGE_IDS = { responded: "stage-responded", scheduled_trial: "stage-sched", done_trial: "stage-done" };
const PIPELINES = {
  pipelines: [{
    id: "pipe-training", name: "Training Pipeline",
    stages: [
      { id: STAGE_IDS.responded, name: "Responded" },
      { id: STAGE_IDS.scheduled_trial, name: "Scheduled Trial" },
      { id: STAGE_IDS.done_trial, name: "Done Trial" },
    ],
  }],
};

// One live scenario at a time. Each field is either a fixture or an outage fn.
let W = {};
let wire = [];
let logs = [];

const realFetch = globalThis.fetch;
const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;

function setScenario(over = {}) {
  wire = [];
  W = {
    provider: "ghl",          // what the flag read says (or "OUTAGE")
    flagsFail: null,          // outage fn for the clients pipeline-flag read
    membership: "yes",        // "yes" | "no" | outage fn, for the stage question
    role: "responded",
    ...over,
  };
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || "GET").toUpperCase();
  wire.push({ url: u, method, body: init.body });

  // ── staff auth ──
  if (u === AUTH) return resp(200, JSON.stringify({ id: "user-1", email: "staff@byanymeansbball.com" }));
  if (u.startsWith(`${REST}staff`)) return resp(200, JSON.stringify([{ role: "admin" }]));
  if (u.startsWith(`${REST}client_users`)) return resp(200, "[]");

  // ── the pipeline-provider flag read (api/agent/_store.js pipelineFlagsState) ──
  if (u.startsWith(`${REST}clients`) && u.includes("select=pipeline_shadow,pipeline_provider")) {
    if (W.flagsFail) return W.flagsFail();
    return resp(200, JSON.stringify([{ pipeline_shadow: false, pipeline_provider: W.provider }]));
  }
  // ── resolveStage's own provider probe, and the academy row ──
  if (u.startsWith(`${REST}clients`) && method === "GET") {
    if (u.includes("select=pipeline_provider&")) return resp(200, JSON.stringify([{ pipeline_provider: W.provider }]));
    return resp(200, JSON.stringify([CLIENT]));
  }
  if (u.startsWith(`${REST}pipeline_stages`)) {
    return resp(200, JSON.stringify([{ id: "row-1", label: W.role, ghl_pipeline_id: "pipe-training", ghl_stage_id: STAGE_IDS[W.role], ghl_stage_name: W.role }]));
  }
  // ── the portal store's answer to the stage question ──
  if (u.startsWith(`${REST}opportunities`) && u.includes("stage_role=eq.") && method === "GET") {
    if (typeof W.membership === "function") return W.membership();
    return resp(200, W.membership === "yes" ? '[{"id":"opp-1"}]' : "[]");
  }
  // ── every other Supabase table: healthy and empty ──
  if (u.startsWith(REST)) return method === "GET" ? resp(200, "[]") : resp(200, "[]");

  // ── GHL ──
  if (u.startsWith(`${GHL}/opportunities/pipelines`)) return resp(200, JSON.stringify(PIPELINES));
  if (u.startsWith(`${GHL}/opportunities/search`) && u.includes("contact_id=")) {
    if (typeof W.membership === "function") return W.membership();
    const stageId = W.membership === "yes" ? STAGE_IDS[W.role] : "stage-somewhere-else";
    return resp(200, JSON.stringify({ opportunities: [{ id: "opp-1", pipelineStageId: stageId, status: "open" }] }));
  }
  if (u.startsWith(`${GHL}/opportunities/search`)) return resp(200, '{"opportunities":[]}');
  if (u.startsWith(`${GHL}/conversations/messages`)) return resp(200, '{"messageId":"m1"}');
  if (u.startsWith(`${GHL}/`)) return resp(200, "{}");

  throw new Error(`unexpected fetch in a no-network suite: ${method} ${u}`);
};

function captureConsole() {
  logs = [];
  const sink = (...a) => logs.push(a.map(String).join(" "));
  console.log = sink; console.warn = sink; console.error = sink;
}
function releaseConsole() { console.log = realLog; console.warn = realWarn; console.error = realError; }

const CLIENT = {
  id: "seed", business_name: "BAM GTA", ghl_location_id: "loc-1",
  ghl_access_token: "ghl-token", ghl_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
  ghl_kpi_config: {}, time_zone: "America/New_York",
};

// pipelineFlagsState caches a SUCCESSFUL read for 30 seconds, so reusing one
// client id across scenarios would let an earlier healthy read answer for a
// later outage. Every scenario gets its own academy.
let idN = 0;
const freshClientId = () => `11111111-2222-4333-8444-${String(++idN).padStart(12, "0")}`;

// Drive a real route handler the way Vercel does.
async function callRoute(mod, body, headers = { authorization: "Bearer stub-user-token" }) {
  let code = 0, out = null;
  const res = { status(c) { code = c; return this; }, json(b) { out = b; return this; } };
  captureConsole();
  try { await mod.default({ method: "POST", headers, query: {}, body }, res); }
  finally { releaseConsole(); }
  return { code, body: out, wire: wire.slice(), logs: logs.slice() };
}

const sentToParent = (w) => w.filter((c) => c.method === "POST" && c.url.startsWith(`${GHL}/conversations/messages`));
const MOVED_ON = /no longer in the .* stage/i;

// The three send paths, each with the stage its 409 talks about.
const SEND_PATHS = (m) => [
  { name: "Booking (agent-approvals)", mod: m.approvals, role: "responded", stage: "Responded" },
  { name: "Confirm (agent-confirm)", mod: m.confirm, role: "scheduled_trial", stage: "Scheduled-Trial" },
  { name: "Closing (agent-closing)", mod: m.closing, role: "done_trial", stage: "Done-Trial" },
];

async function main() {
  console.log("\n── The agent stage guard: yes, no, and we could not ask ──");
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.\n`);

  const m = await loadModules();
  const { contactStageState } = m.stage;
  const { contactRoleState, pipelineFlagsState } = m.store;

  // ── 1. THE THREE OUTCOMES EXIST AND ARE DISTINCT ──────────────────────────
  await section("Yes, no, and we could not ask are three different answers", async () => {
    ok(typeof contactStageState === "function" && typeof contactRoleState === "function",
      "both halves are exported functions, so they can be executed here rather than pattern-matched");
    ok(typeof m.stage.contactInRespondedStage === "undefined" && typeof m.store.contactInRole === "undefined",
      "the bare-boolean names are gone, so a caller left on the old one fails at import instead of reading an object as `yes`");

    const rs = { pipelineId: "pipe-training", stageId: STAGE_IDS.responded, stageName: "Responded" };

    setScenario({ membership: "yes" });
    const yes = await contactStageState("ghl-token", "loc-1", "c1", rs, { clientId: freshClientId() });
    ok(yes.inStage === true && yes.trusted === true, "an open opp in the stage -> yes");

    setScenario({ membership: "no" });
    const no = await contactStageState("ghl-token", "loc-1", "c1", rs, { clientId: freshClientId() });
    ok(no.inStage === false && no.trusted === true, "an open opp somewhere else -> no");
    ok(no.reason && no.reason.length > 10, "...and the no carries a reason, which is the whole of `no, and here is why`");

    for (const [label, fail] of OUTAGES) {
      setScenario({ membership: fail });
      const st = await contactStageState("ghl-token", "loc-1", "c1", rs, { clientId: freshClientId() });
      ok(st.trusted === false, `GHL read: ${label} -> we could not ask`);
      // The assertion the old code failed, stated three ways because a caller can
      // read this value three ways.
      ok(st.inStage !== false, `GHL read: ${label} -> is NOT reported as "not in the stage"`);
      ok(st.inStage === null, `GHL read: ${label} -> the answer is absent (null), not a guess`);
      ok(st.reason && /fail|readable|error|JWT|502|500|401/i.test(st.reason), `GHL read: ${label} -> says why it could not ask`);
    }
  });

  // ── 2. EVERY HOP, NOT JUST THE OBVIOUS ONE ────────────────────────────────
  await section("The portal read and the flag read collapse the same way, so they get the same treatment", async () => {
    const stage = { pipelineId: "pipe-training", stageId: STAGE_IDS.scheduled_trial, stageName: "Scheduled Trial" };

    setScenario({ provider: "portal", membership: "yes", role: "scheduled_trial" });
    const y = await contactRoleState({ clientId: freshClientId(), contactId: "c1", role: "scheduled_trial", stage });
    ok(y.inStage === true && y.trusted === true, "portal store: a matching open opportunity row -> yes");

    setScenario({ provider: "portal", membership: "no", role: "scheduled_trial" });
    const n = await contactRoleState({ clientId: freshClientId(), contactId: "c1", role: "scheduled_trial", stage });
    ok(n.inStage === false && n.trusted === true, "portal store: zero rows -> no, because zero rows IS an answer");

    for (const [label, fail] of OUTAGES) {
      setScenario({ provider: "portal", membership: fail, role: "scheduled_trial" });
      const st = await contactRoleState({ clientId: freshClientId(), contactId: "c1", role: "scheduled_trial", stage });
      ok(st.trusted === false && st.inStage === null, `portal read: ${label} -> we could not ask, not "no"`);
    }

    // The hop nobody looks at. This read decides WHICH store owns the answer, so
    // guessing it wrong on a portal academy asks GHL a question only the portal
    // store can answer - and GHL's stale answer is the same false claim by
    // another route.
    for (const [label, fail] of OUTAGES) {
      setScenario({ provider: "portal", flagsFail: fail, membership: "no", role: "responded" });
      const flags = await pipelineFlagsState(freshClientId());
      ok(flags.trusted === false, `flag read: ${label} -> the flags themselves report untrusted`);

      setScenario({ provider: "portal", flagsFail: fail, membership: "no", role: "responded" });
      const st = await contactStageState("ghl-token", "loc-1", "c1",
        { pipelineId: "pipe-training", stageId: STAGE_IDS.responded, stageName: "Responded" }, { clientId: freshClientId() });
      ok(st.trusted === false && st.inStage === null,
        `flag read: ${label} -> the stage question answers "we could not ask" instead of falling through to the other system`);
    }

    // And the flag read still WORKS, or the guard above is just an outage.
    setScenario({ provider: "portal" });
    const good = await pipelineFlagsState(freshClientId());
    ok(good.trusted === true && good.provider === "portal", "a healthy flag read is trusted and still says portal");
  });

  // ── 3. THE FAIL DIRECTION. This is the property staff rely on. ────────────
  //
  // For every send path, at every hop, under every outage: the response must
  // never be the 409 that says the lead moved on, and nothing may reach a parent.
  await section("No transient failure anywhere produces the \"moved on\" answer", async () => {
    for (const p of SEND_PATHS(m)) {
      for (const hop of ["membership", "flagsFail"]) {
        for (const [label, fail] of OUTAGES) {
          const clientId = freshClientId();
          setScenario(hop === "membership"
            ? { membership: fail, role: p.role }
            : { provider: "portal", flagsFail: fail, membership: "no", role: p.role });
          const r = await callRoute(p.mod, { action: "send", client_id: clientId, contact_id: "c1", reply: "See you Tuesday!" });
          const text = String((r.body && r.body.error) || "");
          ok(!MOVED_ON.test(text),
            `${p.name}, ${hop === "membership" ? "stage read" : "flag read"}, ${label} -> does NOT tell staff the lead left the ${p.stage} stage`);
          ok(r.code !== 409, `${p.name}, ${hop === "membership" ? "stage read" : "flag read"}, ${label} -> not a 409 (a 409 is a claim about the lead)`);
          ok(r.code === 503 && r.body && r.body.unchecked === true,
            `${p.name}, ${hop === "membership" ? "stage read" : "flag read"}, ${label} -> 503 unchecked, which is a claim about US`);
          ok(sentToParent(r.wire).length === 0,
            `${p.name}, ${hop === "membership" ? "stage read" : "flag read"}, ${label} -> nothing was texted to the parent`);
        }
      }
    }
  });

  // ── 4. THE HEALTHY PATHS ARE UNCHANGED ────────────────────────────────────
  // A guard that refuses everything is not a fix, it is an outage of its own.
  await section("A real no still refuses, and a real yes still sends", async () => {
    for (const p of SEND_PATHS(m)) {
      setScenario({ membership: "no", role: p.role });
      const refused = await callRoute(p.mod, { action: "send", client_id: freshClientId(), contact_id: "c1", reply: "See you Tuesday!" });
      ok(refused.code === 409, `${p.name}: a lead who really moved on is still refused with a 409`);
      ok(MOVED_ON.test(String((refused.body && refused.body.error) || "")),
        `${p.name}: ...and staff are still told, in words, that the lead left the ${p.stage} stage`);
      ok(sentToParent(refused.wire).length === 0, `${p.name}: ...and nothing was texted`);
    }

    setScenario({ membership: "yes", role: "responded" });
    const sent = await callRoute(m.approvals, { action: "send", client_id: freshClientId(), contact_id: "c1", reply: "See you Tuesday!" });
    ok(sent.code === 200 && sent.body && sent.body.ok === true,
      "Booking: a lead still in the Responded stage is NOT refused - the approved reply goes through (or is parked for quiet hours), which is the whole point of the feature");
  });

  // ── 5. THE TWO REFUSALS ARE VISIBLY DIFFERENT TO A HUMAN ──────────────────
  // The deck renders the server's `error` string in a red toast, so this text IS
  // the product surface. Three outcomes in the code and two in the sentence is
  // the same bug wearing a fix.
  await section("Staff can tell \"they moved on\" from \"we could not check\"", async () => {
    setScenario({ membership: "no", role: "responded" });
    const no = await callRoute(m.approvals, { action: "send", client_id: freshClientId(), contact_id: "c1", reply: "hi" });
    setScenario({ membership: OUTAGES[0][1], role: "responded" });
    const unk = await callRoute(m.approvals, { action: "send", client_id: freshClientId(), contact_id: "c1", reply: "hi" });

    const noText = String(no.body.error), unkText = String(unk.body.error);
    ok(noText !== unkText, "the two refusals do not share a sentence");
    ok(no.code !== unk.code, `...nor a status code (${no.code} vs ${unk.code})`);
    ok(/couldn't check|could not check/i.test(unkText), "the uncertain one says we could not check");
    ok(/try again/i.test(unkText), "...and tells the reader what to do about it, which a 409 cannot");
    ok(!MOVED_ON.test(unkText), "...and makes no claim about where the lead is");
    ok(unk.body.detail && unk.body.detail.length > 10, "...and carries the underlying reason for whoever is debugging");
    for (const [label, t] of [["the moved-on refusal", noText], ["the could-not-check refusal", unkText], ["the detail", String(unk.body.detail)]])
      ok(!t.includes("—"), `no em dash in ${label}`);

    // The same distinction on the DRAFT path, which returns 200 with an error
    // string rather than a status - a fix that only covered `send` would leave
    // the draft button quietly lying.
    setScenario({ membership: "no", role: "responded" });
    const dNo = await callRoute(m.approvals, { action: "draft", client_id: freshClientId(), contact_id: "c1" });
    setScenario({ membership: OUTAGES[0][1], role: "responded" });
    const dUnk = await callRoute(m.approvals, { action: "draft", client_id: freshClientId(), contact_id: "c1" });
    ok(String(dNo.body.error) !== String(dUnk.body.error), "draft: the two messages differ too");
    ok(dUnk.body.unchecked === true && !MOVED_ON.test(String(dUnk.body.error)),
      "draft: the uncertain one is flagged unchecked and claims nothing about the lead");
  });

  // ── 6. A NON-HTTP CALLER KEEPS THEM APART TOO ─────────────────────────────
  // The rebook bounce has no status code to distinguish with, so it distinguishes
  // in its reason. "We checked and they are not there" is a finished decision;
  // "we could not check" is a bounce still owed.
  await section("The rebook bounce reports the two non-bounces differently", async () => {
    setScenario({ provider: "portal", membership: "no", role: "scheduled_trial" });
    const notThere = await m.rebook.bounceCancelledTrialToRebook({ clientId: freshClientId(), contactId: "c1" });
    ok(notThere.bounced === false && notThere.reason === "not-in-scheduled-trial", "a lead genuinely out of Scheduled-Trial -> not-in-scheduled-trial");

    setScenario({ provider: "portal", membership: OUTAGES[0][1], role: "scheduled_trial" });
    const unknown = await m.rebook.bounceCancelledTrialToRebook({ clientId: freshClientId(), contactId: "c1" });
    ok(unknown.bounced === false, "an unreadable store still does not bounce the lead, which is the safe direction");
    ok(unknown.reason === "stage-unknown", "...and it is reported as stage-unknown, not as a decision we never made");
    ok(unknown.reason !== notThere.reason, "...so the two non-bounces are tellable apart");
  });

  // ── report ────────────────────────────────────────────────────────────────
  globalThis.fetch = realFetch;

  if (MUTATE) {
    if (controlBroken) { console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
    const caught = fails.length > 0;
    console.log(caught
      ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} failure(s)).`
      : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
    process.exit(caught ? 0 : 1);
  }

  for (const f of fails) console.log(`\n── FAILED: ${f}`);
  console.log(`\n${fails.length ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fails.length} failed`);
  if (!fails.length) console.log("No transient failure at any hop can tell staff a lead moved on.\n");
  process.exit(fails.length ? 1 : 0);
}

try { await main(); }
catch (e) {
  releaseConsole();
  globalThis.fetch = realFetch;
  if (MUTATE && controlBroken) { console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  console.log(`\n❌ suite threw: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
}
