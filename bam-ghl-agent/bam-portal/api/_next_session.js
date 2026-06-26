// Resolve an academy's next OPEN free-trial slot to a friendly label
// (e.g. "Tue Jul 1 at 6:00 PM"), for the {{next_session}} merge token used in
// the trial-followup nudge. Best-effort: returns "" when no calendar / no open
// slots / any error, so the nudge sentence just drops out instead of breaking.
//
// Reuses the same GHL free-slots endpoint as api/website/availability.js.

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

export async function nextSessionLabel({ calendarId, token, timezone = "America/Toronto", days = 21 } = {}) {
  if (!calendarId || !token) return "";
  try {
    const start = Date.now();
    const end = start + days * 24 * 3600 * 1000;
    const params = new URLSearchParams({ startDate: String(start), endDate: String(end), timezone });
    const r = await fetch(`${GHL_V2}/calendars/${encodeURIComponent(calendarId)}/free-slots?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" },
    });
    if (!r.ok) return "";
    const json = await r.json().catch(() => ({}));
    // GHL returns { "<date>": { slots: [iso, ...] }, traceId }. Find the global earliest.
    let earliest = null;
    for (const v of Object.values(json)) {
      if (v && Array.isArray(v.slots)) {
        for (const iso of v.slots) {
          const t = new Date(iso).getTime();
          if (!Number.isNaN(t) && (earliest === null || t < earliest)) earliest = t;
        }
      }
    }
    if (earliest === null) return "";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(new Date(earliest));
  } catch { return ""; }
}
