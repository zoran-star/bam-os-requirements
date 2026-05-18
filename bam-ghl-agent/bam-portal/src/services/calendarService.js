// Google Calendar Service — calls /api/calendar/* and surfaces connection state honestly.
// No mock fallback: if calendar isn't connected or the API errors, we return an empty
// list with `connected: false` so the UI can show "Calendar disconnected" instead of
// silently rendering fake events.

const CONNECTED = import.meta.env.VITE_CALENDAR_CONNECTED === "true";

export async function fetchEvents(timeMin, timeMax, calendarId) {
  if (!CONNECTED) {
    return { data: [], error: null, connected: false };
  }
  try {
    let url = "/api/calendar/events?";
    if (timeMin) url += `timeMin=${encodeURIComponent(timeMin)}&`;
    if (timeMax) url += `timeMax=${encodeURIComponent(timeMax)}&`;
    if (calendarId) url += `calendarId=${encodeURIComponent(calendarId)}&`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) {
      return { data: [], error: json.error || `HTTP ${res.status}`, connected: false };
    }

    const events = (json.data || []).map(e => ({
      ...e,
      type: guessEventType(e.title),
      client: guessClient(e.title),
    }));
    return { data: events, error: null, connected: true };
  } catch (err) {
    return { data: [], error: err.message, connected: false };
  }
}

function guessEventType(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("standup") || t.includes("retro") || t.includes("all hands") || t.includes("internal")) return "internal";
  if (t.includes("review") || t.includes("audit")) return "review";
  if (t.includes("deadline") || t.includes("due")) return "deadline";
  return "call";
}

function guessClient(title) {
  // Strip common prefixes/suffixes to extract client name
  const match = (title || "").match(/^(.+?)\s*[—–-]\s*/);
  return match ? match[1].trim() : null;
}
