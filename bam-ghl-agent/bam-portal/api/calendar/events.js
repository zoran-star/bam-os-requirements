import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — Google Calendar Events (per-staff)
//   GET    /api/calendar/events  → the signed-in staff member's calendar
//   DELETE /api/calendar/events  → disconnect (remove their stored token)
//
// Auth: Supabase Bearer token. Each staff member connects their own Google
// Calendar via /api/auth/google/login; the refresh token lives in the
// staff_calendar_tokens table keyed to their auth user id.

const GCAL_API = "https://www.googleapis.com/calendar/v3";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

// Exchange a Google refresh token for a short-lived access token.
async function getAccessToken(refreshToken) {
  if (!refreshToken) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

async function fetchCalendarEvents(calendarId, accessToken, timeMin, timeMax) {
  const url = `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events?` +
    `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&maxResults=100&singleEvents=true&orderBy=startTime`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map(e => ({
    id: e.id,
    title: e.summary || "Untitled",
    description: e.description || "",
    location: e.location || "",
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    allDay: !!e.start?.date,
    status: e.status || "confirmed",
    calendar: calendarId,
    organizer: e.organizer?.displayName || e.organizer?.email || "",
    attendees: (e.attendees || []).map(a => ({
      name: a.displayName || a.email,
      email: a.email,
      status: a.responseStatus || "",
    })),
    hangoutLink: e.hangoutLink || "",
    htmlLink: e.htmlLink || "",
    colorId: e.colorId || null,
  }));
}

async function handler(req, res) {
  const bearer = (req.headers.authorization || "").startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const user = await verifySupabaseUser(bearer);
  if (!user) return res.status(401).json({ error: "auth required", connected: false });

  // ── DELETE: disconnect this staff member's calendar ──
  if (req.method === "DELETE") {
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff_calendar_tokens?staff_user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "DELETE",
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      }
    );
    if (!delRes.ok) return res.status(500).json({ error: "disconnect failed" });
    return res.status(200).json({ ok: true, connected: false });
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Look up this staff member's stored Google Calendar token.
  const rowRes = await fetch(
    `${SUPABASE_URL}/rest/v1/staff_calendar_tokens?staff_user_id=eq.${encodeURIComponent(user.id)}&select=refresh_token,calendar_id,google_email`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const rows = rowRes.ok ? await rowRes.json() : [];
  const conn = rows[0];
  if (!conn?.refresh_token) {
    // Not connected yet — honest empty state, no fake events.
    return res.status(200).json({ data: [], connected: false });
  }

  try {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const timeMin = req.query.timeMin || weekStart.toISOString();
    const timeMax = req.query.timeMax || weekEnd.toISOString();

    const accessToken = await getAccessToken(conn.refresh_token);
    if (!accessToken) {
      // Refresh token rejected — likely revoked in the Google account.
      return res.status(200).json({ data: [], connected: false, reason: "token_revoked" });
    }
    const events = await fetchCalendarEvents(conn.calendar_id || "primary", accessToken, timeMin, timeMax);
    events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return res.status(200).json({ data: events, connected: true, google_email: conn.google_email || null });
  } catch (err) {
    console.error("Calendar error:", err.message);
    return res.status(500).json({ error: err.message, connected: false });
  }
}

export default withSentryApiRoute(handler);
