// Scheduled reconciliation: does what we SEND match what each academy actually
// HAS? Alerts when an academy's live testimonial step quotes an empty store,
// which means it can only be quoting words that academy did not earn.
//
//   GET /api/testimonial-drift            cron (x-vercel-cron) or CRON_SECRET bearer
//   GET /api/testimonial-drift?dry=1      same, never posts to Slack
//
// WHY A SCHEDULE AND NOT CI: this reads live `automation_steps` and
// `testimonials`. CI has no Supabase secrets, so a CI run could only skip the
// live half while still reporting green - and "it is in CI" is what people
// remember. This runs where the credentials already are, adding no new secret
// exposure.
//
// ⚠️ SILENCE IS NOT A PASS, and that is this endpoint's own weak point. It
// alerts only on failure, so a broken schedule looks identical to a clean
// estate. Three mitigations, and one honest limit:
//   1. the response ALWAYS carries the full verdict plus `checked_at`, so state
//      can be asked for rather than inferred
//   2. a failed read THROWS to a 500 instead of returning an empty pass - "I
//      could not find out" must never become "I found out there is nothing"
//   3. every run PERSISTS its heartbeat to `check_heartbeats`, and a run that
//      finds its own previous heartbeat stale ALERTS ABOUT THE GAP as well as
//      about drift. Staleness becomes a condition instead of an assumption.
//
// THE HONEST LIMIT: a PERMANENTLY dead cron still cannot alert about itself.
// Nothing inside a check can detect the check not running. What (3) buys is
// that the state becomes DISCOVERABLE with one query instead of invisible -
// detected by something READING the heartbeat, not by the heartbeat itself.
// Do not describe this as cron monitoring.
//
// (3) is the same reasoning as `clients.google_rating_checked_at` one level up:
// a fetched fact that looks current and may be days dead must carry its date.
//
// The invariants and the named `resolveSyncClass` coupling live in
// api/_testimonial-drift.js, which is the single implementation this shares
// with scripts/check-testimonial-seed-drift.mjs.

import { withSentryApiRoute } from "./_sentry.js";
import { reconcileTestimonialDrift } from "./_testimonial-drift.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

function cronOk(req) {
  if (req.headers["x-vercel-cron"]) return true;
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return !!(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
}

async function sbReq(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} on ${path}`);
  return r.json();
}

// Best-effort alert. Never throws: a Slack outage must not make the check look
// like it failed, and must not make it look like it passed either - the caller
// still gets the verdict in the response body.
async function alertSlack(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ALERTS_CHANNEL || process.env.SLACK_STAFF_CHANNEL;
  if (!token || !channel) return { posted: false, reason: "slack not configured" };
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text }),
    });
    const j = await r.json().catch(() => ({}));
    return { posted: !!j.ok, reason: j.ok ? null : j.error || "unknown" };
  } catch (e) {
    return { posted: false, reason: String((e && e.message) || e) };
  }
}

const CHECK_KEY = "testimonial-drift";
// A daily schedule that has not reported for over two days has either stopped
// or is being run by hand. Either way its verdict is not current, and treating
// it as one is the assumption this threshold exists to refuse.
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

// Best-effort heartbeat read. Absent table or failed read must NOT break the
// drift check itself - the reconciliation is the primary job and the heartbeat
// is instrumentation. Returns null when it cannot tell, and null is reported as
// "unknown", never as "fresh".
async function readHeartbeat() {
  try {
    const rows = await sbReq(`check_heartbeats?check_key=eq.${CHECK_KEY}&select=checked_at,ok`);
    return (rows && rows[0]) || null;
  } catch (_) {
    return null;
  }
}

async function writeHeartbeat(payload) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/check_heartbeats?on_conflict=check_key`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify([payload]),
    });
    return { written: r.ok, reason: r.ok ? null : `Supabase ${r.status}` };
  } catch (e) {
    return { written: false, reason: String((e && e.message) || e) };
  }
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!cronOk(req)) return res.status(403).json({ error: "Forbidden" });

  // Read the previous heartbeat BEFORE writing this run's, so a gap is visible.
  const previous = await readHeartbeat();

  // Deliberately NOT wrapped in a try/catch that returns an empty pass. A read
  // failure must surface as a 500: "I could not find out" is not "there is
  // nothing wrong".
  const { failures, reports, summary, automations, academies } =
    await reconcileTestimonialDrift(sbReq);

  const now = new Date();
  const gapMs = previous ? now - new Date(previous.checked_at) : null;
  // A first-ever run has no previous heartbeat: that is unknown, not stale.
  const stale = gapMs != null && gapMs > STALE_AFTER_MS;
  const gapDays = gapMs != null ? Math.floor(gapMs / 86400000) : null;

  const heartbeat = await writeHeartbeat({
    check_key: CHECK_KEY,
    checked_at: now.toISOString(),
    ok: failures.length === 0,
    detail: { summary, automations, academies, failures, reports },
  });

  const alerts = [];
  if (failures.length) {
    alerts.push(
      `:rotating_light: Testimonial drift: ${summary}\n` +
      failures.map((f) => `• ${f}`).join("\n") +
      `\n\nAn academy is sending a real parent's words that it did not earn. ` +
      `Fix by populating its own store (the /testimonials skill) or disabling the step. ` +
      `Do not hand-edit the step body.`
    );
  }
  if (stale) {
    alerts.push(
      `:hourglass: Testimonial drift check had not run for ${gapDays} day(s) ` +
      `(last: ${previous.checked_at}). A schedule that stops looks exactly like a clean ` +
      `estate, so this gap is reported as a condition rather than assumed harmless. ` +
      `Check the cron entry in vercel.json and the deploy.`
    );
  }
  if (!heartbeat.written) {
    alerts.push(
      `:warning: Testimonial drift check ran but could NOT persist its heartbeat ` +
      `(${heartbeat.reason}). Its next run cannot detect a gap, so silence stops ` +
      `being evidence until this is fixed.`
    );
  }

  let slack = { posted: false, reason: alerts.length ? "dry run" : "nothing to report" };
  if (alerts.length && !req.query.dry) slack = await alertSlack(alerts.join("\n\n"));

  return res.status(200).json({
    ok: failures.length === 0,
    checked_at: now.toISOString(),
    // Freshness of the PREVIOUS run, so a reader can judge whether the schedule
    // is alive without inferring it from the absence of an alert.
    previous_checked_at: previous ? previous.checked_at : null,
    previous_gap_days: gapDays,
    stale,
    summary,
    automations,
    academies,
    failures,
    reports,
    heartbeat,
    slack,
  });
}

export default withSentryApiRoute(handler);
