// Does a FAILED automation send actually get retried?
//
// api/automations.js processes each due job inside a try/catch. The catch is the
// retry handler: below MAX_ATTEMPTS it re-queues the job, at MAX_ATTEMPTS it fails
// it. The retry branch reschedules in the academy's own timezone:
//
//     nextSendableTime(new Date(Date.now() + RETRY_BACKOFF_MS), quietTz(client))
//
// `client` was declared with `const` INSIDE the try. A try block is its own scope,
// so the catch could not see it and that line threw ReferenceError - inside the
// error handler, where nothing catches it. Consequences, in order of how bad they
// are:
//   1. The throw escapes runWork() and handler(): every remaining job in that cron
//      run is dropped and the cron gets a 500.
//   2. The job never gets its retry patch, so it sits in 'sending' with attempts
//      NEVER incremented. It can therefore never reach MAX_ATTEMPTS and never fail
//      out. The 15-minute stale-claim reaper at the top of runWork puts it back to
//      pending, and the whole thing repeats - an unbounded re-send loop.
// The exhausted-retries branch does NOT mention `client`, so jobs that had already
// burned all 3 attempts were handled correctly. That asymmetry is why this hid:
// the only broken path was the ordinary one, a provider blip on attempt 1.
//
// This suite drives the REAL worker (the exported handler, ?action=work) against a
// stubbed fetch. No network, no database, no test framework. It asserts BEHAVIOUR -
// what patch lands on the job row - not the presence of a `let`.
//
// NEGATIVE CONTROL (a check nobody has watched go red is decorative):
//   MUTATE=scope node api/_automation-retry-scope.test.mjs
//     Rewrites automations.js in memory to put `client` back inside the try - the
//     exact bug - and runs the same scenarios against that copy. The run PASSES
//     only if it prints NEGATIVE CONTROL PASSED, i.e. the assertions noticed.
//     If the rewrite cannot be applied to the current source it says so and fails,
//     rather than quietly proving nothing.
//   MUTATE=utc node api/_automation-retry-scope.test.mjs
//     Rewrites the retry line to drop quietTz() and reschedule in UTC. Proves the
//     timezone assertions are real: an academy that is not on Toronto time, and an
//     academy row we never managed to load, must both still be rescheduled inside
//     a parent-facing window and not at a raw UTC hour.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

// This suite drives api/automations.js, whose first line imports api/_sentry.js,
// which statically imports @sentry/node - and with it @sentry/core, the
// OpenTelemetry SDK and `import-in-the-middle`. The CI step that runs these files
// says they need no dependencies, so the specifier is answered locally rather than
// making production load Sentry lazily to suit a test. Nothing under test changes:
// sentryApiEnabled is false unless VERCEL_ENV is "production", so
// withSentryApiRoute already returns the handler untouched and none of these
// functions is called. Same stub as api/_arming-gate.test.mjs.
register(`data:text/javascript,${encodeURIComponent(`
  const STUB = "data:text/javascript,${encodeURIComponent(
    "export function init(){} export function captureMessage(){} export function captureException(){}" +
    " export function flush(){return Promise.resolve(true)}" +
    " export function withIsolationScope(fn){return fn({setTag(){},setContext(){}})}")}";
  export async function resolve(spec, ctx, next) {
    if (spec === "@sentry/node") return { url: STUB, shortCircuit: true, format: "module" };
    return next(spec, ctx);
  }
`)}`);

const HERE   = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, "automations.js");
const MUTATE = process.env.MUTATE || "";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✅ " : "  ❌ ") + m); };

// ── the worker's world: env, a frozen clock, a stubbed fetch ──
process.env.VITE_SUPABASE_URL = "http://sb.test";
process.env.SUPABASE_URL = "http://sb.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.CRON_SECRET = "test-cron-secret";
delete process.env.VERCEL_ENV;          // keeps the Sentry wrapper inert (it re-throws)
delete process.env.GHL_API_KEY;         // no ambient token: an academy with no client row gets none
delete process.env.GHL_AGENCY_TOKEN;
delete process.env.GHL_LOCATIONS_JSON;

// Quiet hours are wall-clock logic, so "now" has to be ours, not the machine's.
const RealDate = Date;
let NOW = RealDate.parse("2026-07-29T16:00:00.000Z");
class FrozenDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(NOW); else super(...args); }
  static now() { return NOW; }
}
globalThis.Date = FrozenDate;

const SB_BASE  = "http://sb.test/rest/v1/";
const GHL_BASE = "https://services.leadconnectorhq.com";
const reply = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => null },
  text: async () => (body === undefined || body === null ? "" : JSON.stringify(body)),
});

let world = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.startsWith(SB_BASE))  return world.supabase(u.slice(SB_BASE.length), method, body);
  if (u.startsWith(GHL_BASE)) return world.ghl(u.slice(GHL_BASE.length), method, body);
  throw new Error(`test stub: unexpected fetch ${method} ${u}`);
};

// One academy, one enrolled lead, one due SMS step. Everything the worker reads on
// the way to the send is served from here; anything else reads as an empty table.
function makeWorld({ client, ghlSend, attempts = 0 }) {
  const job = { id: "job-1", client_id: "client-1", automation_id: "auto-1", enrollment_id: "enr-1", step_id: "step-1", contact_id: "contact-1", status: "pending", attempts };
  const writes = [], ghlHits = [];
  return {
    job, writes, ghlHits,
    jobPatches: () => writes.filter(w => w.path === `automation_jobs?id=eq.${job.id}`).map(w => w.body),
    supabase(p, method, body) {
      if (method === "GET") {
        if (p.startsWith("automation_jobs?status=eq.pending")) return reply(200, [job]);
        if (p.startsWith("automations?id=eq."))                return reply(200, [{ id: "auto-1", client_id: job.client_id, automation_key: "ghosted", enabled: true, approved: true }]);
        if (p.startsWith("automation_enrollments?id=eq."))     return reply(200, [{ id: "enr-1", status: "active", current_position: 0 }]);
        if (p.startsWith("automation_steps?automation_id="))   return reply(200, [{ id: "step-1", automation_id: "auto-1", position: 0, enabled: true, channel: "sms", subject: null, body: "Hey, quick check in." }]);
        if (p.startsWith("clients?id=eq."))                    return reply(200, client ? [client] : []);
        return reply(200, []);
      }
      writes.push({ method, path: p, body });
      // the atomic pending->sending claim is the one write that reads a row back
      if (method === "PATCH" && p === `automation_jobs?id=eq.${job.id}&status=eq.pending`) return reply(200, [job]);
      return reply(200, null);
    },
    ghl(p, method) {
      ghlHits.push({ method, path: p });
      if (method === "GET" && p.startsWith("/contacts/")) return reply(200, { contact: { id: job.contact_id, phone: "+14165550123", firstName: "Maya", name: "Maya Alvarez" } });
      if (method === "POST" && p.startsWith("/conversations/messages")) return ghlSend();
      return reply(200, {});
    },
  };
}

// ── load the worker (the real file, or the re-broken copy under MUTATE) ──
function mutate(src) {
  if (MUTATE === "scope") {
    // Put `client` back inside the try: drop the hoisted declaration, restore the
    // block-scoped one at the assignment.
    const decl = /\n[ \t]*let client = null;\n/;
    const asgn = /\n([ \t]*)client = (clientCache\.get\(job\.client_id\)[^\n]*);/;
    if (!decl.test(src) || !asgn.test(src)) return null;
    return src.replace(decl, "\n").replace(asgn, "\n$1const client = $2;");
  }
  if (MUTATE === "utc") {
    // Drop the academy timezone from the retry reschedule.
    const line = /nextSendableTime\(new Date\(Date\.now\(\) \+ RETRY_BACKOFF_MS\), quietTz\(client\)\)/;
    if (!line.test(src)) return null;
    return src.replace(line, "nextSendableTime(new Date(Date.now() + RETRY_BACKOFF_MS), \"UTC\")");
  }
  return null;
}

let tmpFile = null;
async function loadHandler() {
  if (!MUTATE) return (await import(pathToFileURL(TARGET).href)).default;
  const mutated = mutate(readFileSync(TARGET, "utf8"));
  if (mutated === null) {
    console.error(`\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} could not be applied to api/automations.js.`);
    console.error("   The source moved out from under this control, so it is proving nothing. Fix the control.\n");
    process.exit(2);
  }
  // The copy lives outside the repo, so its relative imports are rewritten to
  // absolute file URLs - same module instances as the real file would get.
  const apiDir = pathToFileURL(HERE + path.sep).href;
  const rewritten = mutated
    .replace(/(\bfrom\s*")(\.\.?\/[^"]+)(")/g, (_, a, spec, c) => a + new URL(spec, apiDir).href + c)
    .replace(/(\bimport\(\s*")(\.\.?\/[^"]+)("\s*\))/g, (_, a, spec, c) => a + new URL(spec, apiDir).href + c);
  tmpFile = path.join(tmpdir(), `bam-automations-${MUTATE}-${process.pid}.mjs`);
  writeFileSync(tmpFile, rewritten);
  return (await import(pathToFileURL(tmpFile).href)).default;
}

const handler = await loadHandler();

// Run one worker pass. Returns what the cron saw and every write it made.
async function runWorker(w) {
  world = w;
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const req = { method: "GET", query: { action: "work" }, headers: { authorization: "Bearer test-cron-secret" } };
  try { await handler(req, res); return { res, threw: null }; }
  catch (e) { return { res, threw: e }; }
}

const iso = (ms) => new RealDate(ms).toISOString();

// ══ 1. A provider 5xx on attempt 1 must reschedule the job ══
// The ordinary case: Twilio/Resend/GHL blips, a timeout, anything retryable.
console.log("\n1. retryable send failure (GHL 502), attempts 0 of 3");
NOW = RealDate.parse("2026-07-29T16:00:00.000Z");   // 12:00 in Toronto, mid-window
let w = makeWorld({
  client: { id: "client-1", business_name: "BAM GTA", public_name: "By Any Means Toronto", time_zone: "America/Toronto", ghl_location_id: "loc-1", ghl_access_token: "tok-1", ghl_token_expires_at: iso(NOW + 30 * 86400000) },
  ghlSend: () => reply(502, { message: "upstream provider unavailable" }),
});
let r = await runWorker(w);
ok(!r.threw, `the worker survives the failed send${r.threw ? ` (threw ${r.threw.name}: ${r.threw.message})` : ""}`);
ok(r.res.code === 200 && r.res.body && r.res.body.ok === true, "the cron gets a 200, not a 500");
ok(w.ghlHits.some(h => h.method === "POST" && h.path.startsWith("/conversations/messages")), "the send was really attempted (this scenario is not vacuous)");
let patches = w.jobPatches();
ok(patches.length === 1, `exactly one disposition written to the job row (got ${patches.length})`);
let p0 = patches[0] || {};
ok(p0.status === "pending", `job re-queued as pending (got ${JSON.stringify(p0.status)})`);
ok(p0.attempts === 1, `attempts incremented to 1 (got ${JSON.stringify(p0.attempts)})`);
ok(p0.run_after === iso(NOW + 5 * 60000), `retry scheduled 5 min out (got ${JSON.stringify(p0.run_after)})`);
ok(String(p0.last_error || "").includes("upstream provider unavailable"), "the provider error is recorded on the row");
ok(r.res.body && r.res.body.failed === 0 && r.res.body.sent === 0, "counted as neither sent nor failed");

// ══ 2. The same failure at the retry ceiling must FAIL the job, not re-queue it ══
// This branch never referenced `client`, so it worked even while branch 1 crashed.
// It is here so the fix cannot quietly turn "give up" into "retry forever".
console.log("\n2. same failure at attempts 2 of 3 (the ceiling)");
w = makeWorld({
  attempts: 2,
  client: { id: "client-1", business_name: "BAM GTA", time_zone: "America/Toronto", ghl_location_id: "loc-1", ghl_access_token: "tok-1", ghl_token_expires_at: iso(NOW + 30 * 86400000) },
  ghlSend: () => reply(502, { message: "upstream provider unavailable" }),
});
r = await runWorker(w);
p0 = w.jobPatches()[0] || {};
ok(p0.status === "failed", `job marked failed (got ${JSON.stringify(p0.status)})`);
ok(p0.attempts === 3, `attempts reached MAX_ATTEMPTS (got ${JSON.stringify(p0.attempts)})`);
ok(!("run_after" in p0), "no retry scheduled once the attempts are spent");
ok(r.res.body && r.res.body.failed === 1, "counted as failed");

// ══ 3. The retry is scheduled in the ACADEMY's timezone, not ours ══
// San Jose sends on Pacific time. Frozen at 21:28 PDT: inside the window, so the
// send goes out; +5 min lands at 21:33, outside it, so the retry rolls to 08:00
// PDT. Rescheduling on Toronto time would answer 12:00Z - a different morning.
console.log("\n3. a Pacific academy reschedules on Pacific time");
NOW = RealDate.parse("2026-07-30T04:28:00.000Z");   // 21:28 in Los Angeles
w = makeWorld({
  client: { id: "client-1", business_name: "BAM San Jose", time_zone: "America/Los_Angeles", ghl_location_id: "loc-2", ghl_access_token: "tok-2", ghl_token_expires_at: iso(NOW + 30 * 86400000) },
  ghlSend: () => reply(500, { message: "carrier timeout" }),
});
r = await runWorker(w);
p0 = w.jobPatches()[0] || {};
ok(p0.attempts === 1, `still a retry, not a defer (got attempts ${JSON.stringify(p0.attempts)})`);
ok(p0.run_after === "2026-07-30T15:00:00.000Z", `retry rolls to 08:00 Pacific (got ${JSON.stringify(p0.run_after)})`);
ok(p0.run_after !== "2026-07-30T12:00:00.000Z", "not 08:00 Toronto");

// ══ 4. No client row still degrades to the quiet-hours default, never to UTC ══
// If the academy row cannot be read, quietTz() falls back to America/Toronto.
// Frozen at 21:28 Toronto, so a UTC fallback would answer 08:00Z - the small hours
// of the morning in Toronto, which is exactly the thing quiet hours exist to stop.
console.log("\n4. unreadable client row degrades to America/Toronto");
NOW = RealDate.parse("2026-07-30T01:28:00.000Z");   // 21:28 in Toronto
w = makeWorld({ client: null, ghlSend: () => reply(502, { message: "unused" }) });
r = await runWorker(w);
ok(!r.threw, `the worker survives a job with no client row${r.threw ? ` (threw ${r.threw.name}: ${r.threw.message})` : ""}`);
p0 = w.jobPatches()[0] || {};
ok(p0.attempts === 1, `the failed send is retried (got attempts ${JSON.stringify(p0.attempts)})`);
ok(p0.run_after === "2026-07-30T12:00:00.000Z", `retry rolls to 08:00 Toronto (got ${JSON.stringify(p0.run_after)})`);
ok(p0.run_after !== "2026-07-30T08:00:00.000Z", "not 08:00 UTC, which is 04:00 to a Toronto parent");

// ══ verdict ══
if (tmpFile) { try { unlinkSync(tmpFile); } catch (_) {} }
if (MUTATE) {
  console.log(fail
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fail} assertion(s) went red).`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative.`);
  process.exit(fail ? 0 : 1);
}
console.log(`\n${fail ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
