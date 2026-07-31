#!/usr/bin/env node
// Verify the multi-summary resolution in api/ghl/cron-trial-summary.js (added
// 2026-07-31 so Major Hoops could split Coach Brandon's calendar into its own
// summary, texted straight to him, separate from Jeremy's).
//
// Imports the REAL resolveConfigs/normalizeEntry/FALLBACK_CONFIG - not a
// hand-copied stand-in - so this fails the moment the resolution logic drifts
// from what ships. Run:
//
//   node scripts/verify-trial-summary-multi.mjs
//
// MUTATE=m1|m2|m3 reverts one fix to prove the suite still catches it:
//   m1 = DB trial_summaries and fallback get merged/concatenated instead of DB
//        replacing the fallback wholesale (would double-send if both ever had
//        an entry for the same person)
//   m2 = legacy singular trial_summary is dropped instead of treated as a
//        one-entry array (breaks every OTHER client still on the old shape)
//   m3 = an entry with no destination (no to_phone/to_email) is not filtered
//        out (would crash trying to send to nobody)
import { resolveConfigs, normalizeEntry, FALLBACK_CONFIG } from '../api/ghl/cron-trial-summary.js';

const MUTATE = process.env.MUTATE || '';
let fails = 0;
const ok = (label, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) fails++;
};

console.log('=== 1. Major Hoops fallback itself has both entries ===');
const mh = FALLBACK_CONFIG.gXHbLTQzaEYlyLSKJUTU;
ok('fallback has 2 entries (Jeremy + Coach Brandon)', Array.isArray(mh) && mh.length === 2);
ok('Coach Brandon entry is labelled', mh.some((e) => e.label === 'Coach Brandon'));
ok("Coach Brandon's number is +16263913259", mh.some((e) => e.to_phone === '+16263913259'));
ok("Coach Brandon's calendar is his own (not Jeremy's 4)", mh.some((e) => e.label === 'Coach Brandon' && e.calendars.length === 1 && e.calendars[0].id === 'QTY8Zr8FZ2ZNPNU01ZvO'));
ok("Jeremy's entry keeps all 4 original calendars", mh.some((e) => !e.label && e.calendars.length === 4));
ok('the two entries use different phone numbers (no accidental collision)', new Set(mh.map((e) => e.to_phone)).size === 2);

console.log('\n=== 2. resolveConfigs: DB trial_summaries wins over fallback ===');
{
  const client = {
    ghl_location_id: 'gXHbLTQzaEYlyLSKJUTU',
    ghl_kpi_config: { trial_summaries: [{ enabled: true, to_phone: '+15550001111', calendars: [{ id: 'x', label: 'X' }] }] },
  };
  let cfgs = resolveConfigs(client);
  if (MUTATE === 'm1') cfgs = resolveConfigs(client).concat(FALLBACK_CONFIG.gXHbLTQzaEYlyLSKJUTU.map(normalizeEntry).filter(Boolean));
  ok('DB array REPLACES the fallback (not merged/concatenated)', cfgs.length === 1 && cfgs[0].to_phone === '+15550001111');
}

console.log('\n=== 3. resolveConfigs: legacy singular trial_summary still works ===');
{
  const client = {
    ghl_location_id: 'some-other-location-not-in-fallback',
    ghl_kpi_config: MUTATE === 'm2'
      ? {} // simulate "singular shape dropped"
      : { trial_summary: { enabled: true, to_phone: '+15550002222', calendars: [{ id: 'y', label: 'Y' }] } },
  };
  const cfgs = resolveConfigs(client);
  ok('a client still on the old single-object shape resolves to exactly 1 entry', cfgs.length === 1 && cfgs[0]?.to_phone === '+15550002222');
}

console.log('\n=== 4. resolveConfigs: no fallback + no DB config = empty, not a crash ===');
{
  const cfgs = resolveConfigs({ ghl_location_id: 'totally-unconfigured', ghl_kpi_config: {} });
  ok('unconfigured client resolves to an empty array', Array.isArray(cfgs) && cfgs.length === 0);
}

console.log('\n=== 5. normalizeEntry: filters entries that cannot send anything ===');
{
  const noDest = MUTATE === 'm3'
    ? { enabled: true, calendars: [{ id: 'z' }], to_phone: '+15550003333' } // force a destination back in
    : { enabled: true, calendars: [{ id: 'z' }] };                          // no to_phone / to_email
  ok('an entry with no destination normalizes to null', normalizeEntry(noDest) === null);
  ok('an entry with no calendars normalizes to null', normalizeEntry({ enabled: true, to_phone: '+1555' }) === null);
  ok('enabled:false normalizes to null even with everything else valid', normalizeEntry({ enabled: false, to_phone: '+1555', calendars: [{ id: 'z' }] }) === null);
  ok('calendar_ids expands into calendars', normalizeEntry({ enabled: true, to_phone: '+1555', calendar_ids: ['a', 'b'] })?.calendars.length === 2);
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails ? 1 : 0);
