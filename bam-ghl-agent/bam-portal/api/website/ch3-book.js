import { withSentryApiRoute } from '../_sentry.js';

var ALLOWED = new Set(['sfnJdd2WAk2lHVTymTOh', 'f6d7oYjVJRiGr9JPqkow']);
var LOCATION_ID = 'lUqgMMX0RRf1FSG7Odg9';
var GHL_BASE = 'https://services.leadconnectorhq.com';

function getCh3Key() {
  if (process.env.GHL_LOCATIONS_JSON) {
    try {
      var locs = JSON.parse(process.env.GHL_LOCATIONS_JSON);
      var entry = locs.find(function(l) { return l.locationId === LOCATION_ID || l.name === 'CH3 Training'; });
      if (entry && (entry.apiKeyV2 || entry.apiKey)) return entry.apiKeyV2 || entry.apiKey;
    } catch (_) {}
  }
  return process.env.GHLKEY || '';
}

function ghlHeaders() {
  return {
    Authorization: 'Bearer ' + getCh3Key(),
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDatetime(iso) {
  var d = new Date(iso);
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var day = days[d.getDay()];
  var month = months[d.getMonth()];
  var date = d.getDate();
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  var time = `${h12}:${pad2(m)} ${ampm}`;
  var shortDate = `${month} ${date}`;
  var fullDisplay = `${day}, ${month} ${date} · ${time}`;
  return { day, shortDate, time, fullDisplay };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var { calendarId, start, firstName, lastName, email, phone } = req.body || {};

  if (!calendarId || !ALLOWED.has(calendarId)) {
    return res.status(400).json({ error: 'Invalid calendarId' });
  }
  if (!start) return res.status(400).json({ error: 'start is required' });
  if (!firstName) return res.status(400).json({ error: 'firstName is required' });
  if (!email) return res.status(400).json({ error: 'email is required' });

  var startTime = new Date(start).toISOString();
  var endTime = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();

  var group = calendarId === 'sfnJdd2WAk2lHVTymTOh' ? 'Youth' : 'HS / College';

  var contactBody = {
    locationId: LOCATION_ID,
    firstName,
    lastName: lastName || '',
    email,
    source: 'CH3 Free Trial Booking',
    tags: ['ch3-lead', 'ch3-free-trial-booked'],
  };
  if (phone) contactBody.phone = phone;

  var contactRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify(contactBody),
  });

  if (!contactRes.ok) {
    var errText = await contactRes.text();
    return res.status(contactRes.status).json({ error: 'Failed to upsert contact', detail: errText });
  }

  var contactData = await contactRes.json();
  var contactId = contactData.contact?.id || contactData.id;

  if (!contactId) {
    return res.status(500).json({ error: 'No contactId returned from GHL' });
  }

  var apptBody = {
    calendarId,
    locationId: LOCATION_ID,
    contactId,
    startTime,
    endTime,
    title: `Free Trial — ${firstName}${lastName ? ' ' + lastName : ''}`,
    appointmentStatus: 'confirmed',
  };

  var apptRes = await fetch(`${GHL_BASE}/calendars/events/appointments`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify(apptBody),
  });

  if (!apptRes.ok) {
    var apptErr = await apptRes.text();
    return res.status(apptRes.status).json({ error: 'Failed to book appointment', detail: apptErr });
  }

  var apptData = await apptRes.json();
  var appointmentId = apptData.id || apptData.appointment?.id;

  var fmt = formatDatetime(start);

  return res.status(200).json({
    ok: true,
    contactId,
    appointmentId,
    start,
    day: fmt.day,
    shortDate: fmt.shortDate,
    time: fmt.time,
    fullDisplay: fmt.fullDisplay,
    group,
    location: '625 N Spring St, Middletown, PA 17057',
  });
}

export default withSentryApiRoute(handler);
