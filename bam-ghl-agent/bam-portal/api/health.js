// GET /api/health — operational readiness probe.
//
// Reports which integrations are wired (env present) + a live Supabase ping, so a deleted
// or rotated Vercel env var is visible immediately instead of silently breaking a flow.
//
// Auth: pass the CRON_SECRET as `?secret=<CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`.
// NEVER leaks secret values — only booleans.
// Returns 200 with a status body. Add `?strict=1` to get 503 when a REQUIRED integration is
// unconfigured or Supabase is unreachable (useful for an uptime monitor).

import { firstEnv, envPresent } from "./_env.js";

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

export default async function handler(req, res) {
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
      try {
        const r = await fetch(`${url}/rest/v1/staff?select=id&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        supabaseLive = r.ok;
        if (!r.ok) checks.supabase_url.error = `HTTP ${r.status}`;
      } catch (e) {
        checks.supabase_url.error = e.message;
      }
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
