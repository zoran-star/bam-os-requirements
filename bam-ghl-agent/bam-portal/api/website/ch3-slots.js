import { withSentryApiRoute } from '../_sentry.js';

var ALLOWED = new Set(['sfnJdd2WAk2lHVTymTOh', 'f6d7oYjVJRiGr9JPqkow']);

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

  var params = new URLSearchParams({ startDate, endDate, timezone });
  var url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?${params}`;

  var ghlRes = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.GHLKEY}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
  });

  if (!ghlRes.ok) {
    var errText = await ghlRes.text();
    return res.status(ghlRes.status).json({ error: 'GHL error', detail: errText });
  }

  var data = await ghlRes.json();

  var dateMap = data._dates_ || data.date || {};

  var slots = [];
  for (var date of Object.keys(dateMap)) {
    var dayData = dateMap[date];
    var rawSlots = Array.isArray(dayData) ? dayData : (dayData.slots || []);
    for (var iso of rawSlots) {
      slots.push({ start: iso, date });
    }
  }

  slots.sort(function (a, b) {
    return new Date(a.start) - new Date(b.start);
  });

  return res.status(200).json({ slots });
}

export default withSentryApiRoute(handler);
