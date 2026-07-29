// Verifies check-testimonial-seed-drift.mjs by running the REAL script against
// a SNAPSHOT OF PRODUCTION (taken 2026-07-29, the day GTA's store was seeded),
// then against four mutations that each break one invariant.
//
// The fixture is a prod snapshot, not hand-authored, because a fixture that
// drifts from production passes for the wrong reason. It WILL age: when the
// automations or store change shape, re-snapshot it rather than patching it.
//
//   node scripts/verify-testimonial-seed-drift.mjs                    → PASS (exit 0)
//   MUTATE=sj-enabled ...        San Jose's held nurture-3 turned on  → FAIL (exit 1)
//   MUTATE=gta-store-empty ...   live steps, emptied store            → FAIL (exit 1)
//   MUTATE=gta-no-step ...       quotes exist, step dropped at seed   → REPORT, exit 0
//   MUTATE=gta-none-starred ...  rows but none featured               → REPORT, exit 0
//
// The two mutations that FAIL are the ones that would send a real parent's
// words from an academy that did not earn them. The two that only REPORT are
// states that are correct-but-worth-knowing. Exit codes verified without a
// pipe: a `| head` masks the script's status behind head's own.
import { readFileSync } from 'node:fs';
const fx = JSON.parse(readFileSync(new URL('./__fixtures__/testimonial-seed-drift.prod.json', import.meta.url)));
const mutate = process.env.MUTATE;
if (mutate === 'sj-enabled') {
  fx.steps.find(s => s.automation_id === '88cc6556-79bb-4de8-93d1-c51a23f5fc10' && s.body === 'template:nurture-3').enabled = true;
}
if (mutate === 'gta-store-empty') fx.testimonials = [];
if (mutate === 'gta-no-step') fx.steps = fx.steps.filter(s => s.sync_class !== 'attributed' || s.automation_id !== '49cfe3da-27cd-4a34-b8f0-eb145c8b97ca');
if (mutate === 'gta-none-starred') fx.testimonials = fx.testimonials.map(t => ({ ...t, starred: false }));

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
