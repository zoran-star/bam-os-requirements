import { withSentryApiRoute } from "./_sentry.js";
// GET /api/health — operational readiness probe.
//
// Reports which integrations are wired (env present) + a live Supabase ping, so a deleted
// or rotated Vercel env var is visible immediately instead of silently breaking a flow.
//
// Auth: pass the CRON_SECRET as `?secret=<CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`.
//
// WHAT THIS BODY MAY CONTAIN, stated as narrowly as it is actually enforced:
// booleans from envPresent(), the list of missing REQUIRED names, and - for the
// live Supabase ping only - a diagnostic string this file WROTE (an HTTP status,
// or a failure name/code from describeFetchFailure). No env value, and nothing
// the runtime wrote, is ever put in it.
//
// That distinction is the whole point. This comment used to say "NEVER leaks
// secret values - only booleans", which was FALSE and was the reason the file
// read as safe: the Supabase ping built an Authorization header from the raw
// service-role key and assigned `e.message` from the surrounding catch straight
// into the returned object. A key with a line break in the middle makes undici
// throw a TypeError QUOTING THE WHOLE HEADER, so that field returned a live
// service-role key. A claim broader than what is enforced is how the original
// bug survived review.
//
// Returns 200 with a status body. Add `?strict=1` to get 503 when a REQUIRED integration is
// unconfigured or Supabase is unreachable (useful for an uptime monitor).

import { firstEnv, envPresent } from "./_env.js";
import { assertHeaderSafeCredential, describeFetchFailure } from "./_header-safe-credential.js";

const REQUIRED = {
  supabase_url:         ["VITE_SUPABASE_URL", "SUPABASE_URL"],
  supabase_service_key: ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"],
  stripe:               ["STRIPE_SECRET_KEY"],
  anthropic:            ["ANTHROPIC_API_KEY"],
};

const OPTIONAL = {
  stripe_connect:    ["STRIPE_CONNECT_SECRET_KEY"],
  slack:             ["SLACK_BOT_TOKEN"],
  cron:              ["CRON_SECRET"],
  agent_sessions:    ["AGENT_SESSION_INGEST_SECRET"],
  meta_app_id:       ["META_APP_ID"],
  meta_app_secret:   ["META_APP_SECRET"],
  google_client_id:  ["GOOGLE_CLIENT_ID"],
  google_client_secret: ["GOOGLE_CLIENT_SECRET"],
};

// The live ping, lifted out of the handler so it can be driven directly by
// api/_credential-leak.test.mjs - the leak lived in these fifteen lines and a
// guard nobody can execute is a guard nobody can trust.
//
// Returns { live, error } where `error` is ALWAYS a string this function chose.
// Trim first, then refuse: a trailing newline on the stored key is a paste
// artifact (production's SUPABASE_SERVICE_KEY has one), so it is trimmed off and
// the key is used; a break still inside it after the trim can never be a header
// value, so it never reaches fetch and the refusal names no key material.
async function pingSupabase(url, key) {
  // THE SHARED GUARD, not a local re-implementation of it. The first fix here
  // inlined trim + a printable-ASCII test, which was behaviourally fine and
  // structurally wrong: scripts/credential-header-scan.mjs classifies a site by
  // whether the value came through assertHeaderSafeCredential, so a hand-rolled
  // copy made this file read as having no credential header at all - invisible
  // to the very gate that is supposed to count it. Guards that only humans can
  // recognise do not get counted.
  let credential;
  try {
    credential = assertHeaderSafeCredential(key, "the Supabase service key (SUPABASE_SERVICE_ROLE_KEY)");
  } catch (e) {
    // The guard's own sentences: they name the variable and never the value.
    return { live: false, error: e.message };
  }
  let r;
  try {
    r = await fetch(`${url}/rest/v1/staff?select=id&limit=1`, {
      headers: { apikey: credential, Authorization: `Bearer ${credential}` },
    });
  } catch (e) {
    // NOT e.message. Whatever the runtime wrote is request material - the
    // invalid-header TypeError quotes the header, a DNS failure names the host.
    return { live: false, error: describeFetchFailure(e, "Supabase") };
  }
  return { live: r.ok, error: r.ok ? null : `HTTP ${r.status}` };
}

async function handler(req, res) {
  try {
    // ── auth (shared cron secret) ──
    const cronSecret = process.env.CRON_SECRET;
    const provided =
      (typeof req.query.secret === "string" && req.query.secret) ||
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!cronSecret || provided !== cronSecret) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const checks = {};
    const missing = [];
    for (const [name, vars] of Object.entries(REQUIRED)) {
      const configured = envPresent(...vars);
      checks[name] = { configured, required: true };
      if (!configured) missing.push(name);
    }
    for (const [name, vars] of Object.entries(OPTIONAL)) {
      checks[name] = { configured: envPresent(...vars), required: false };
    }

    // APNs push needs ALL three (key + id + team) — envPresent is OR, so check
    // them together. This is the quick "is push good to go?" signal.
    checks.apns = {
      configured:
        envPresent("APNS_KEY_P8", "APNS_KEY_P8_BASE64") &&
        envPresent("APNS_KEY_ID") &&
        envPresent("APNS_TEAM_ID"),
      required: false,
    };

    // ── live Supabase ping (proves the key actually works, not just present) ──
    let supabaseLive = false;
    const url = firstEnv("VITE_SUPABASE_URL", "SUPABASE_URL");
    const key = firstEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");
    if (url && key) {
      const ping = await pingSupabase(url, key);
      supabaseLive = ping.live;
      if (ping.error) checks.supabase_url.error = ping.error;
    }
    checks.supabase_url.live = supabaseLive;

    const ok = missing.length === 0 && supabaseLive;
    const code = req.query.strict === "1" && !ok ? 503 : 200;
    return res.status(code).json({ ok, missing, supabase_live: supabaseLive, checks });
  } catch (e) {
    console.error("[health]", e);
    return res.status(500).json({ ok: false, error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
