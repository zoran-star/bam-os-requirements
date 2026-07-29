#!/usr/bin/env node
// Reconciles the testimonials STORE against the SEEDED automation steps that
// quote it. Answers a question no single-sided check can: does what we send
// match what the academy actually has?
//
// WHY IT EXISTS: the drop rule fires at SEED time, not render time, so there is
// an ordering dependency with an invisible failure mode. Seed an academy before
// its quotes arrive and the testimonial step is dropped correctly-but-
// prematurely; it then needs a re-seed that nobody knows to run. The templating
// room asked for that to be asserted somewhere rather than left in a runbook.
// This is that assertion.
//
// It keys on `automation_steps.sync_class = 'attributed'` and the two
// testimonial template bodies, not on scanning text for the word - attributed
// is the system's own marker for "this step carries a named person's words".
//
// TWO INVARIANTS, and they fail differently on purpose:
//
//   ⛔ FAIL - an ENABLED attributed step on an academy with an EMPTY store.
//      That academy is sending testimonial content it does not own. This is the
//      DETAIL Miami failure in automation form, and it is why San Jose's
//      nurture-3 is held disabled.
//
//   ⚠️ REPORT - a POPULATED store with NO testimonial step seeded.
//      The ordering dependency, caught: quotes arrived after the seed, the step
//      was dropped, and the sequence needs re-seeding to pick it up. Not a
//      failure (nothing wrong is being sent) but nobody would otherwise know.
//
// Reported, never failed: a populated store with zero starred rows. That is the
// "they gave us quotes and chose not to feature any" state, which correctly
// stops the email and must stay distinguishable from an empty store.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-testimonial-seed-drift.mjs
// No credentials = exit 2. It does NOT pass when it cannot look: a reconciler
// that greens out on a failed read is the exact bug this whole workstream keeps
// finding.

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

if (!SB_URL || !SB_KEY) {
  console.error("FAIL - no Supabase credentials. This check cannot run blind; it will not report a pass it did not verify.");
  process.exit(2);
}

// The steps that quote the store. Bodies are template references, so these are
// exact rather than fuzzy.
const TESTIMONIAL_BODIES = ["template:nurture-3", "template:onboarding-testimonials"];

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} on ${path}`);
  return r.json();
}

const [clients, testimonials, automations, steps] = await Promise.all([
  sb("clients?select=id,business_name"),
  sb("testimonials?select=client_id,starred"),
  sb("automations?select=id,client_id,automation_key,enabled&automation_key=in.(nurture,onboarding)"),
  sb("automation_steps?select=automation_id,position,body,enabled,sync_class"),
]);

const nameOf = new Map(clients.map((c) => [c.id, c.business_name]));
const store = new Map();
for (const t of testimonials) {
  const s = store.get(t.client_id) || { rows: 0, starred: 0 };
  s.rows += 1;
  if (t.starred) s.starred += 1;
  store.set(t.client_id, s);
}
const stepsByAutomation = new Map();
for (const s of steps) {
  if (!stepsByAutomation.has(s.automation_id)) stepsByAutomation.set(s.automation_id, []);
  stepsByAutomation.get(s.automation_id).push(s);
}

const failures = [];
const reports = [];

for (const a of automations) {
  const name = nameOf.get(a.client_id) || a.client_id;
  const mine = stepsByAutomation.get(a.id) || [];
  const tstSteps = mine.filter(
    (s) => TESTIMONIAL_BODIES.includes((s.body || "").trim()) || s.sync_class === "attributed"
  );
  const st = store.get(a.client_id) || { rows: 0, starred: 0 };

  for (const s of tstSteps) {
    // An automation switched off entirely cannot send; a step switched off
    // cannot either. Only a live path is a live risk.
    const live = a.enabled && s.enabled;
    if (live && st.rows === 0) {
      failures.push(
        `${name} · ${a.automation_key} step ${s.position} (${(s.body || "").trim()}) is ENABLED ` +
        `but the store is EMPTY - it can only be quoting content this academy does not own`
      );
    }
  }

  if (st.rows > 0 && st.starred > 0 && tstSteps.length === 0) {
    reports.push(
      `${name} · ${a.automation_key} has NO testimonial step but the store has ${st.rows} row(s), ` +
      `${st.starred} starred - dropped at seed time before the quotes existed. Needs a re-seed to pick it up.`
    );
  }
  if (st.rows > 0 && st.starred === 0) {
    reports.push(
      `${name} · store has ${st.rows} row(s) but NONE starred - the email correctly does not ship. ` +
      `They gave us quotes and featured none; this is not the same as never having asked.`
    );
  }
}

const dedup = [...new Set(reports)];
if (dedup.length) {
  console.log("REPORT (not failures):");
  for (const r of dedup) console.log(`  ${r}`);
  console.log("");
}

if (failures.length) {
  console.error(`FAIL - ${failures.length} academy/academies send testimonial content they do not own:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    `\n  Fix by populating that academy's own store (the /testimonials skill) or by\n` +
    `  disabling the step. Do NOT hand-edit the step body to remove the quotes.`
  );
  process.exit(1);
}

console.log(
  `PASS - ${automations.length} nurture/onboarding automation(s) checked across ` +
  `${new Set(automations.map((a) => a.client_id)).size} academies; no enabled step quotes an empty store.`
);
