import { withSentryApiRoute } from "./_sentry.js";
// Google Calendar OAuth — per-staff connect flow.
// Reached via explicit vercel.json rewrites (the dynamic [step].js route
// did not resolve under this project's rewrites — same reason the Meta
// staff OAuth uses explicit rewrites):
//   GET /api/auth/google/login?token=<supabase access token>
//   GET /api/auth/google/callback?code=...&state=<supabase access token>
//
// login   → verify the staff member, redirect to Google's consent screen
// callback → exchange the code, store the refresh token in
//            staff_calendar_tokens keyed to that staff user

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Verify a Supabase access token and return the user, or null.
async function verifySupabaseUser(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? u : null;
  } catch (_) {
    return null;
  }
}

// Canonical staff URL — used everywhere we generate OAuth redirect URIs.
// Otherwise Vercel's *.vercel.app preview hostname leaks into Google's
// allow-list mismatch (and into Slack notifications, etc). Pinned to
// STAFF_PORTAL_URL env, else canonical staff.byanymeansbusiness.com.
// Dev/localhost falls through. The registered redirect URI in the
// Google Cloud Console MUST match the canonical staff URL.
function staffBaseUrl(req) {
  if (process.env.STAFF_PORTAL_URL) return process.env.STAFF_PORTAL_URL.replace(/\/+$/, "");
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  if (/localhost|127\.0\.0\.1/.test(origin)) return origin.replace(/\/+$/, "");
  return "https://staff.byanymeansbusiness.com";
}

async function handler(req, res) {
  const step = req.query.step;
  const redirectUri = `${staffBaseUrl(req)}/api/auth/google/callback`;

  // ── LOGIN: send the staff member to Google's consent screen ──
  if (step === "login") {
    const user = await verifySupabaseUser(req.query.token);
    if (!user) {
      return res.status(401).send("Not signed in. Open the staff portal, then connect from the Calendar page.");
    }
    if (!GOOGLE_CLIENT_ID) return res.status(500).send("GOOGLE_CLIENT_ID not configured");

    const scopes = [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" ");
    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      access_type: "offline",
      prompt: "consent",
      state: req.query.token,   // round-trip the supabase token; re-verified in callback
    });
    return res.redirect(302, authUrl);
  }

  // ── CALLBACK: exchange the code, store the refresh token for this staff user ──
  if (step === "callback") {
    const { code, state, error } = req.query;
    if (error || !code || !state) return res.redirect(302, "/?gcal=error");

    const user = await verifySupabaseUser(state);
    if (!user) {
      return res.status(401).send("Session expired during connect. Try again from the Calendar page.");
    }

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenRes.json();
      // No refresh_token means Google didn't issue one (already-granted without
      // revoke). prompt=consent should force one; if it still fails, surface it.
      if (tokens.error || !tokens.refresh_token) {
        return res.redirect(302, "/?gcal=error&reason=no_refresh_token");
      }

      // Which Google account did they connect? (best-effort)
      let googleEmail = null;
      try {
        const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (meRes.ok) googleEmail = (await meRes.json())?.email || null;
      } catch (_) { /* email is best-effort */ }

      // Upsert the token row for this staff user (UNIQUE on staff_user_id)
      const upsertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/staff_calendar_tokens?on_conflict=staff_user_id`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            staff_user_id: user.id,
            google_email: googleEmail,
            refresh_token: tokens.refresh_token,
            calendar_id: "primary",
            updated_at: new Date().toISOString(),
          }),
        }
      );
      if (!upsertRes.ok) {
        console.error("calendar token upsert failed:", await upsertRes.text());
        return res.redirect(302, "/?gcal=error");
      }
      return res.redirect(302, "/?gcal=connected");
    } catch (err) {
      console.error("google oauth callback error:", err?.message || err);
      return res.redirect(302, "/?gcal=error");
    }
  }

  return res.status(404).json({ error: "unknown step (expected login or callback)" });
}

export default withSentryApiRoute(handler);
