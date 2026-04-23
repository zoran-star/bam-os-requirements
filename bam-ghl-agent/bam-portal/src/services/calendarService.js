// Google Calendar Service — calls /api/calendar/* when connected, falls back to mock data

const CONNECTED = import.meta.env.VITE_CALENDAR_CONNECTED === "true";

function getMockEvents() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay() + 1);

  const makeEvent = (dayOffset, hour, duration, title, type, client) => {
    const start = new Date(monday);
    start.setDate(monday.getDate() + dayOffset);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + duration);
    return {
      id: `mock-${dayOffset}-${hour}`,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      type,
      client,
      attendees: [],
    };
  };

  return [
    makeEvent(0, 9, 30, "SM Team Standup", "internal", null),
    makeEvent(0, 10, 60, "HoopGENEius — Weekly Check-in", "call", "HoopGENEius"),
    makeEvent(0, 14, 45, "ProBound — Ads Review", "review", "ProBound Training"),
    makeEvent(1, 9, 30, "SM Team Standup", "internal", null),
    makeEvent(1, 11, 60, "BTG Basketball — Onboarding", "call", "BTG Basketball"),
    makeEvent(1, 15, 30, "Content Review", "review", null),
    makeEvent(2, 9, 30, "SM Team Standup", "internal", null),
    makeEvent(2, 10, 60, "Straight Buckets — Strategy", "call", "Straight Buckets"),
    makeEvent(2, 13, 60, "All Hands Meeting", "internal", null),
    makeEvent(3, 9, 30, "SM Team Standup", "internal", null),
    makeEvent(3, 11, 45, "Supreme Hoops — Check-in", "call", "Supreme Hoops"),
    makeEvent(3, 14, 30, "Ad Creative Deadline", "deadline", null),
    makeEvent(4, 9, 30, "SM Team Standup", "internal", null),
    makeEvent(4, 10, 60, "Basketball Lab — Launch Prep", "call", "Basketball Lab"),
    makeEvent(4, 15, 60, "Week Retro", "internal", null),
  ];
}

export async function fetchEvents(timeMin, timeMax, calendarId) {
  if (!CONNECTED) return { data: getMockEvents(), error: null };
  try {
    let url = "/api/calendar/events?";
    if (timeMin) url += `timeMin=${encodeURIComponent(timeMin)}&`;
    if (timeMax) url += `timeMax=${encodeURIComponent(timeMax)}&`;
    if (calendarId) url += `calendarId=${encodeURIComponent(calendarId)}&`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) return { data: getMockEvents(), error: json.error };

    // Map GCal events to portal format
    const events = (json.data || []).map(e => ({
      ...e,
      type: guessEventType(e.title),
      client: guessClient(e.title),
    }));
    return { data: events, error: null };
  } catch (err) {
    return { data: getMockEvents(), error: err.message };
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
