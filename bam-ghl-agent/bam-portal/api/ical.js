// Portal-native "add to calendar" link. Generates an .ics file on the fly from
// query params so a trial-confirmation SMS/email can offer an Apple/Outlook calendar
// button without any GHL token. Stateless + public: it only echoes back the trial
// details already in the link (start/end/title/location), no lookup, no secrets.
//
//   GET /api/ical?start=<ms>&end=<ms>&title=<t>&location=<l>
//
// Pairs with the Google Calendar URL we build inline (calendar.google.com/render).

// Fold + escape per RFC 5545.
function esc(t) {
  return String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function dt(ms) {
  // UTC basic format: YYYYMMDDTHHMMSSZ
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export default function handler(req, res) {
  try {
    const q = req.query || {};
    const start = Number(q.start);
    if (!Number.isFinite(start)) { res.status(400).send("start (ms) required"); return; }
    const end = Number.isFinite(Number(q.end)) ? Number(q.end) : start + 3600000;
    const title = (q.title || "Free Trial").toString().slice(0, 200);
    const location = (q.location || "").toString().slice(0, 300);
    const uid = `trial-${start}-${end}@byanymeansbusiness.com`;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BAM//Free Trial//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dt(start)}`,
      `DTSTART:${dt(start)}`,
      `DTEND:${dt(end)}`,
      `SUMMARY:${esc(title)}`,
      location ? `LOCATION:${esc(location)}` : null,
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="free-trial.ics"');
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(lines.join("\r\n"));
  } catch (e) {
    res.status(500).send("ical error");
  }
}
