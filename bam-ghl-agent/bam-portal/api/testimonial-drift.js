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
// estate. Two mitigations, both deliberate: the response ALWAYS carries the
// full verdict plus `checked_at`, so state can be asked for rather than
// inferred; and a failed read THROWS to a 500 instead of returning an empty
// pass, so an outage is visible as an outage.
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

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!cronOk(req)) return res.status(403).json({ error: "Forbidden" });

  // Deliberately NOT wrapped in a try/catch that returns an empty pass. A read
  // failure must surface as a 500: "I could not find out" is not "there is
  // nothing wrong".
  const { failures, reports, summary, automations, academies } =
    await reconcileTestimonialDrift(sbReq);

  let slack = { posted: false, reason: "no failures" };
  if (failures.length && !req.query.dry) {
    slack = await alertSlack(
      `:rotating_light: Testimonial drift: ${summary}\n` +
      failures.map((f) => `• ${f}`).join("\n") +
      `\n\nAn academy is sending a real parent's words that it did not earn. ` +
      `Fix by populating its own store (the /testimonials skill) or disabling the step. ` +
      `Do not hand-edit the step body.`
    );
  }

  return res.status(200).json({
    ok: failures.length === 0,
    checked_at: new Date().toISOString(),
    summary,
    automations,
    academies,
    failures,
    reports,
    slack,
  });
}

export default withSentryApiRoute(handler);
