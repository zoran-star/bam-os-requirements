import { supabase } from "../../lib/supabase";

// Shared helpers for the staff Website V2 sandbox. Time + request-kind helpers
// are reused straight from ../contentv2/utils (ageShort, relTime,
// REQUEST_KINDS) - only website-specific bits live here.

// context.page_url -> short display path ("/free-trial", or the host when the
// URL has no path). Falls back to the raw string when it is not parseable.
export function pagePath(url) {
  if (!url) return "";
  try {
    const u = new URL(String(url));
    return u.pathname && u.pathname !== "/" ? u.pathname : u.host;
  } catch (_) {
    return String(url);
  }
}

// The ticket's annotations, defensively: context.annotations[] of
// { note, section, device } (the locked client annotator payload).
export function ticketAnnotations(ticket) {
  const list = ticket?.context?.annotations;
  return Array.isArray(list) ? list.filter((a) => a && typeof a === "object") : [];
}

// The device the client annotated on most - the sandbox opens on it.
export function dominantDevice(annotations) {
  let mobile = 0;
  let desktop = 0;
  for (const a of annotations || []) {
    if (a?.device === "mobile") mobile++;
    else desktop++;
  }
  return mobile > desktop ? "mobile" : "desktop";
}

// iframe src for the sandbox: the live page + annotate=1, which turns on the
// bam-client-sites section bridge (hover outlines + fc-annotate postMessages).
export function sandboxSrc(url) {
  if (!url) return null;
  const s = String(url);
  return s + (s.indexOf("?") === -1 ? "?" : "&") + "annotate=1";
}

// context.metric_snapshot -> ordered display chips (only keys that exist).
const METRIC_DEFS = [
  ["visitors", "Visitors"],
  ["form_started", "Form started"],
  ["saw_calendar", "Saw calendar"],
  ["booked", "Booked"],
];
export function metricChips(snap) {
  if (!snap || typeof snap !== "object") return [];
  return METRIC_DEFS
    .filter(([k]) => snap[k] !== undefined && snap[k] !== null)
    .map(([k, label]) => ({ key: k, label, value: String(snap[k]) }));
}

// Neutral academy-initials avatar text (house v1.6 avatar chip).
export function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

// All ticket mutations go through /api/v2-tickets with a fresh Bearer token
// (same recipe as ContentTicketDrawer.api).
export async function ticketApi(session, ticketId, action, body) {
  const { data: { session: fresh } } = await supabase.auth.getSession();
  const token = fresh?.access_token || session?.access_token;
  const res = await fetch(`/api/v2-tickets?action=${action}&id=${encodeURIComponent(ticketId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) { /* non-JSON error */ }
  if (!res.ok) throw new Error(json.error || (text ? text.slice(0, 180) : `HTTP ${res.status}`));
  return json;
}
