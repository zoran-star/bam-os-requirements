// Verifies check-testimonial-seed-drift.mjs by running the REAL script against
// a SNAPSHOT OF PRODUCTION (taken 2026-07-29, the day GTA's store was seeded),
// then against four mutations that each break one invariant.
//
// The fixture is a prod snapshot, not hand-authored, because a fixture that
// drifts from production passes for the wrong reason. It WILL age: when the
// automations or store change shape, re-snapshot it rather than patching it.
//
//   node scripts/verify-testimonial-seed-drift.mjs                    → PASS (exit 0)
//   MUTATE=sj-store-emptied ...   SJ's store wiped under a live step  → FAIL (exit 1)
//   MUTATE=gta-store-emptied ...  GTA's store wiped under live steps  → FAIL (exit 1)
//   MUTATE=all-stores-emptied ... both wiped                          → FAIL (exit 1)
//   MUTATE=sj-unstarred ...       rows but none featured              → REPORT, exit 0
//   MUTATE=gta-step-dropped ...   quotes exist, step dropped at seed  → REPORT, exit 0
//
// The two mutations that FAIL are the ones that would send a real parent's
// words from an academy that did not earn them. The two that only REPORT are
// states that are correct-but-worth-knowing. Exit codes verified without a
// pipe: a `| head` masks the script's status behind head's own.
import { readFileSync } from 'node:fs';
const fx = JSON.parse(readFileSync(new URL('./__fixtures__/testimonial-seed-drift.prod.json', import.meta.url)));
const mutate = process.env.MUTATE;
const SJ_NURTURE = '88cc6556-79bb-4de8-93d1-c51a23f5fc10';
const GTA_NURTURE = '49cfe3da-27cd-4a34-b8f0-eb145c8b97ca';
const SJ = '5576acf0-acd3-4c05-9f9f-ebfde8618154';
const GTA = '39875f07-0a4b-4429-a201-2249bc1f24df';

// ⚠️ THE MUTATIONS CHANGED ON 2026-07-29 AND THE REASON MATTERS.
// The old set included "someone re-enables San Jose's held nurture-3", because
// that step was the only disabled step in the system and re-enabling it would
// have sent GTA's parents under San Jose's name. THAT HOLD WAS DELIBERATELY
// RELEASED once nurture-3 rendered from the store, so the danger it modelled can
// no longer arise that way - and a mutation that models an impossible state
// passes for the wrong reason. There are now ZERO disabled steps system-wide.
//
// ⛔ DO NOT READ "0 disabled steps" AS EVIDENCE THE HOLD WAS VIOLATED. It was
// released on purpose, after its precondition shipped. The rule it protected
// (never flip an existing row's enabled flag without a reason) is unchanged;
// what is gone is the cheap external signal that it was being honoured.
//
// So the mutations now model dangers that ARE still reachable from the current
// state: a store emptied underneath a live step, either academy.
if (mutate === 'sj-store-emptied') fx.testimonials = fx.testimonials.filter(t => t.client_id !== SJ);
if (mutate === 'gta-store-emptied') fx.testimonials = fx.testimonials.filter(t => t.client_id !== GTA);
if (mutate === 'all-stores-emptied') fx.testimonials = [];
if (mutate === 'sj-unstarred') fx.testimonials = fx.testimonials.map(t => t.client_id === SJ ? { ...t, starred: false } : t);
if (mutate === 'gta-step-dropped') fx.steps = fx.steps.filter(s => !(s.automation_id === GTA_NURTURE && s.sync_class === 'attributed'));

process.env.SUPABASE_URL = 'https://fixture.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
globalThis.fetch = async (url) => {
  const u = String(url);
  const key = u.includes('/clients?') ? 'clients'
    : u.includes('/testimonials?') ? 'testimonials'
    : u.includes('/automations?') ? 'automations' : 'steps';
  return { ok: true, json: async () => fx[key] };
};
await import(new URL('./check-testimonial-seed-drift.mjs', import.meta.url).href);
