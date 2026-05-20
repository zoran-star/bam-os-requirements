// Google Calendar Service — per-staff calendar via /api/calendar/*.
// Each staff member connects their own Google Calendar (OAuth). The API
// reports honest connection state; no mock fallback.
import { supabase } from "../lib/supabase";

export async function fetchEvents(timeMin, timeMax) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { data: [], error: null, connected: false, googleEmail: null };

    let url = "/api/calendar/events?";
    if (timeMin) url += `timeMin=${encodeURIComponent(timeMin)}&`;
    if (timeMax) url += `timeMax=${encodeURIComponent(timeMax)}&`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) {
      return { data: [], error: json.error || `HTTP ${res.status}`, connected: false, googleEmail: null };
    }

    const events = (json.data || []).map(e => ({
      ...e,
      type: guessEventType(e.title),
      client: guessClient(e.title),
    }));
    return {
      data: events,
      error: null,
      connected: json.connected === true,
      googleEmail: json.google_email || null,
      reason: json.reason || null,
    };
  } catch (err) {
    return { data: [], error: err.message, connected: false, googleEmail: null };
  }
}

// Build the OAuth connect URL for the current staff member. Navigating the
// browser here kicks off the Google consent flow; the callback stores the
// refresh token and redirects back with ?gcal=connected.
export async function getCalendarConnectUrl() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  return `/api/auth/google/login?token=${encodeURIComponent(token)}`;
}

// Disconnect the current staff member's Google Calendar.
export async function disconnectCalendar() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false };
  const res = await fetch("/api/calendar/events", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: res.ok };
}

function guessEventType(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("standup") || t.includes("retro") || t.includes("all hands") || t.includes("internal")) return "internal";
  if (t.includes("review") || t.includes("audit")) return "review";
  if (t.includes("deadline") || t.includes("due")) return "deadline";
  return "call";
}

function guessClient(title) {
  const match = (title || "").match(/^(.+?)\s*[—–-]\s*/);
  return match ? match[1].trim() : null;
}
