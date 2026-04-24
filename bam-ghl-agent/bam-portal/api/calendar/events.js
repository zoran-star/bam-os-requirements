// Vercel Serverless Function — Google Calendar Events
// GET: list events from both Mike calendars, merged + sorted
// Uses OAuth refresh token for private calendar access

const GCAL_API = "https://www.googleapis.com/calendar/v3";

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
    `&maxResults=50&singleEvents=true&orderBy=startTime`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

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

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Two Google accounts: Bball and Business, each with their own refresh token + calendar
  const accounts = [
    { refreshToken: process.env.GOOGLE_REFRESH_TOKEN_BBALL, calendarId: process.env.GOOGLE_CALENDAR_ID },
    { refreshToken: process.env.GOOGLE_REFRESH_TOKEN_BUSINESS, calendarId: process.env.GOOGLE_CALENDAR_ID_2 },
    // Legacy fallback: single GOOGLE_REFRESH_TOKEN for both calendars
    ...(process.env.GOOGLE_REFRESH_TOKEN && !process.env.GOOGLE_REFRESH_TOKEN_BBALL
      ? [{ refreshToken: process.env.GOOGLE_REFRESH_TOKEN, calendarId: process.env.GOOGLE_CALENDAR_ID },
         { refreshToken: process.env.GOOGLE_REFRESH_TOKEN, calendarId: process.env.GOOGLE_CALENDAR_ID_2 }]
      : []),
  ].filter(a => a.refreshToken && a.calendarId);

  if (accounts.length === 0) {
    return res.status(401).json({
      error: "Not authenticated. Visit /api/auth/google/login to connect Google Calendar.",
      loginUrl: "/api/auth/google/login",
    });
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

    // Get access tokens and fetch events for each account in parallel
    const results = await Promise.all(
      accounts.map(async ({ refreshToken, calendarId }) => {
        const accessToken = await getAccessToken(refreshToken);
        if (!accessToken) return [];
        return fetchCalendarEvents(calendarId, accessToken, timeMin, timeMax);
      })
    );

    // Merge and sort by start time
    const allEvents = results.flat().sort((a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    return res.status(200).json({ data: allEvents });
  } catch (err) {
    console.error("Calendar error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
