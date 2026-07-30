// Reconciles the testimonials STORE against the SEEDED automation steps that
// quote it. ONE implementation, imported by both callers:
//   • scripts/check-testimonial-seed-drift.mjs  (local, on demand)
//   • api/testimonial-drift.js                  (scheduled against prod + staff)
// Two copies of this invariant would drift, which is the whole failure family
// this workstream exists to kill.
//
// ⚠️ IT READS LIVE DATA, SO IT IS DELIBERATELY NOT A CI CHECK. There are no
// Supabase secrets in the workflows, so a CI run could only ever skip the live
// half - and "it is in CI" is the sentence people remember. A green CI run that
// skipped its own point is assurance-without-connection wearing this check's
// name. Its real home is the schedule.
//
// ⚠️ SILENCE IS NOT A PASS. The scheduled run alerts on FAILURE, so a broken
// cron looks exactly like a clean estate. The endpoint always returns its full
// verdict with a timestamp so the state can be asked for rather than inferred,
// and persists a heartbeat to `check_heartbeats`.
//
// ⛔ WHERE EXPECTED CADENCE LIVES, and it is deliberately NOT in the heartbeat
// table (design answer agreed with the orchestrator, 2026-07-29):
// `vercel.json` is the single source of truth for schedules. A copy of the
// cadence in `check_heartbeats` would be a second crontab that drifts from the
// real one, and then a staleness alert cannot tell you which copy is wrong -
// the exact copies-drift fault this workstream exists to kill.
// The principle: the table records what HAPPENED. Expectations belong with the
// thing being observed, never beside the observation. So a future fleet watchdog
// reads cadence from `vercel.json`, and each check's key-to-path mapping lives
// in the file that WRITES its heartbeat (here, CHECK_KEY in
// api/testimonial-drift.js) so the mapping cannot drift from the writer.
//
// ⛔ COUPLING, NAMED ON PURPOSE: this keys on
// `automation_steps.sync_class = 'attributed'`, which is decided by
// `resolveSyncClass` in the templating room's seeder (it takes the STRICTEST of
// the row's stored class and the template's declared class). If what counts as
// `attributed` ever changes, THIS INVARIANT SILENTLY CHANGES MEANING RATHER
// THAN BREAKING. Whoever touches `resolveSyncClass` needs to find this comment.
// Agreed with AUTOMATION TEMPLATING II, 2026-07-29; they will flag a change.
//
// Keying on sync_class rather than scanning bodies for "testimonial" is not a
// preference: the text search finds ZERO steps, because the bodies are
// `template:nurture-3` and `template:onboarding-testimonials`.
//
// ⛔ HISTORICAL NOTE FOR ANYONE READING A DISABLED-STEP COUNT, because this WILL
// look wrong later. Until 2026-07-29, San Jose's `nurture-3` was the ONLY
// disabled step across every academy, and that single disabled step was used all
// day as a canary: migration checks reported "1 disabled step" as evidence the
// hold was intact. The hold existed because the template carried GTA's parents
// hardcoded and re-attributed them by city.
//
// THAT PRECONDITION SHIPPED. nurture-3 now renders each academy's own quotes
// from this store, so the hold was DELIBERATELY RELEASED and there are now ZERO
// disabled steps system-wide.
//
// So: "0 disabled steps" is NOT evidence that anyone violated the never-flip-an-
// existing-row rule. That rule is unchanged. What is gone is the cheap external
// signal that it was being honoured, and this check is what replaced it - it
// watches the thing the canary only implied, namely whether a live step is
// quoting a store that cannot support it.

// The steps that quote the store. Bodies are template references, so exact.
export const TESTIMONIAL_BODIES = ["template:nurture-3", "template:onboarding-testimonials"];

/**
 * @param {(path: string) => Promise<any>} sbReq  Supabase REST reader.
 * @returns {Promise<{failures: string[], reports: string[], summary: string,
 *   automations: number, academies: number}>}
 */
export async function reconcileTestimonialDrift(sbReq) {
  const [clients, testimonials, automations, steps] = await Promise.all([
    sbReq("clients?select=id,business_name"),
    sbReq("testimonials?select=client_id,starred"),
    sbReq("automations?select=id,client_id,automation_key,enabled&automation_key=in.(nurture,onboarding)"),
    sbReq("automation_steps?select=automation_id,position,body,enabled,sync_class"),
  ]);

  const nameOf = new Map((clients || []).map((c) => [c.id, c.business_name]));

  const store = new Map();
  for (const t of testimonials || []) {
    const s = store.get(t.client_id) || { rows: 0, starred: 0 };
    s.rows += 1;
    if (t.starred) s.starred += 1;
    store.set(t.client_id, s);
  }

  const stepsByAutomation = new Map();
  for (const s of steps || []) {
    if (!stepsByAutomation.has(s.automation_id)) stepsByAutomation.set(s.automation_id, []);
    stepsByAutomation.get(s.automation_id).push(s);
  }

  const failures = [];
  const reports = [];

  for (const a of automations || []) {
    const name = nameOf.get(a.client_id) || a.client_id;
    const mine = stepsByAutomation.get(a.id) || [];
    const tstSteps = mine.filter(
      (s) => TESTIMONIAL_BODIES.includes((s.body || "").trim()) || s.sync_class === "attributed"
    );
    const st = store.get(a.client_id) || { rows: 0, starred: 0 };

    for (const s of tstSteps) {
      // An automation switched off cannot send; nor can a switched-off step.
      // Only a live path is a live risk.
      if (a.enabled && s.enabled && st.rows === 0) {
        failures.push(
          `${name} · ${a.automation_key} step ${s.position} (${(s.body || "").trim()}) is ENABLED ` +
          `but the store is EMPTY - it can only be quoting content this academy does not own`
        );
      }
    }

    // ⛔ READ THIS BEFORE "FIXING" AN onboarding REPORT. Member-side
    // testimonials are OUT OF SCOPE (Zoran, 2026-07-29: once a family has
    // joined, they do not need convincing). The master deliberately ships SEVEN
    // onboarding steps against GTA's EIGHT, and the missing one is the
    // testimonials step. So an `onboarding` line here is INFORMATIONAL: it says
    // "this academy could carry that step", NOT "promote it".
    // Promoting it to close the gap would ship one academy's real parents to
    // every academy, which is the original failure with extra steps. The gap is
    // frozen pending Zoran's explicit "dropped, not deferred" ruling.
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

  const academies = new Set((automations || []).map((a) => a.client_id)).size;
  return {
    failures,
    reports: [...new Set(reports)],
    automations: (automations || []).length,
    academies,
    summary: failures.length
      ? `${failures.length} academy/academies send testimonial content they do not own`
      : `${(automations || []).length} nurture/onboarding automation(s) across ${academies} academies; no enabled step quotes an empty store`,
  };
}
