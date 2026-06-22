import { withSentryApiRoute } from '../_sentry.js';

var ALLOWED = new Set(['sfnJdd2WAk2lHVTymTOh', 'f6d7oYjVJRiGr9JPqkow']);
var CH3_LOCATION_ID = 'lUqgMMX0RRf1FSG7Odg9';

function getCh3Key() {
  if (process.env.GHL_LOCATIONS_JSON) {
    try {
      var locs = JSON.parse(process.env.GHL_LOCATIONS_JSON);
      var entry = locs.find(function(l) { return l.locationId === CH3_LOCATION_ID || l.name === 'CH3 Training'; });
      if (entry && (entry.apiKeyV2 || entry.apiKey)) return entry.apiKeyV2 || entry.apiKey;
    } catch (_) {}
  }
  return process.env.GHLKEY || '';
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var { calendarId, startDate, endDate, timezone = 'America/New_York' } = req.query;

  if (!calendarId || !ALLOWED.has(calendarId)) {
    return res.status(400).json({ error: 'Invalid calendarId' });
  }
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  // GHL free-slots requires ms timestamps. If a YYYY-MM-DD string was passed, convert.
  function toMs(v) {
    if (/^\d{10,}$/.test(v)) return v; // already ms or seconds-as-string
    var d = new Date(v);
    return isNaN(d) ? v : String(d.getTime());
  }
  startDate = toMs(startDate);
  endDate   = toMs(endDate);

  var params = new URLSearchParams({ startDate, endDate, timezone });
  var url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?${params}`;

  var ghlRes;
  try {
    ghlRes = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + getCh3Key(),
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });
  } catch (e) {
    console.error('ch3-slots fetch error:', e.message);
    return res.status(502).json({ ok: false, error: 'Network error fetching slots' });
  }

  if (!ghlRes.ok) {
    var errText = await ghlRes.text();
    console.error('ch3-slots GHL error:', ghlRes.status, errText.slice(0, 200));
    return res.status(502).json({ ok: false, error: 'GHL error ' + ghlRes.status, detail: errText.slice(0, 200) });
  }

  var data;
  try { data = await ghlRes.json(); } catch (e) {
    return res.status(502).json({ ok: false, error: 'Invalid JSON from GHL' });
  }

  // GHL free-slots returns dates as top-level keys: { "2026-06-26": { slots:[...] }, traceId: "..." }
  // Filter to only date-shaped keys (YYYY-MM-DD).
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var slots = [];
  Object.keys(data || {}).forEach(function(date) {
    if (!DATE_RE.test(date)) return;
    var dayData = data[date];
    var rawSlots = Array.isArray(dayData) ? dayData : (dayData && (dayData.slots || dayData.openSlots || []));
    (rawSlots || []).forEach(function(iso) {
      if (typeof iso === 'string' && iso) slots.push({ start: iso, date: date });
      else if (iso && iso.startTime) slots.push({ start: iso.startTime, date: date });
    });
  });

  slots.sort(function(a, b) { return new Date(a.start) - new Date(b.start); });

  // Include raw GHL response keys when empty to help diagnose misconfigured calendars.
  var extra = slots.length === 0 ? { _ghl_keys: Object.keys(data || {}), _date_keys: Object.keys(dateMap) } : {};
  return res.status(200).json(Object.assign({ ok: true, slots: slots }, extra));
}

export default withSentryApiRoute(handler);
