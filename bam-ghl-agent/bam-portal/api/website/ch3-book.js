import { withSentryApiRoute } from '../_sentry.js';
import { getClientGhlToken } from './availability.js';

var ALLOWED = new Set(['sfnJdd2WAk2lHVTymTOh', 'f6d7oYjVJRiGr9JPqkow']);
var LOCATION_ID = 'lUqgMMX0RRf1FSG7Odg9';
var GHL_BASE = 'https://services.leadconnectorhq.com';
var CH3_CLIENT_UUID = 'df59d13e-fefc-4acc-b4cc-5ab8d5edd732';

var SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
var SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

async function getCh3Token() {
  if (SB_URL && SB_KEY) {
    try {
      var r = await fetch(
        `${SB_URL}/rest/v1/clients?id=eq.${CH3_CLIENT_UUID}&select=id,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      if (r.ok) {
        var rows = await r.json();
        if (rows && rows[0]) return await getClientGhlToken(rows[0]);
      }
    } catch (_) {}
  }
  // Fallback: Private Integration key from GHL_LOCATIONS_JSON
  if (process.env.GHL_LOCATIONS_JSON) {
    try {
      var locs = JSON.parse(process.env.GHL_LOCATIONS_JSON);
      var entry = locs.find(function(l) { return l.locationId === LOCATION_ID || l.name === 'CH3 Training'; });
      if (entry && (entry.apiKeyV2 || entry.apiKey)) return entry.apiKeyV2 || entry.apiKey;
    } catch (_) {}
  }
  return process.env.GHLKEY || '';
}

function makeGhlHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
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

  var { calendarId, start, firstName, lastName, email, phone, contactId: passedContactId } = req.body || {};

  if (!calendarId || !ALLOWED.has(calendarId)) {
    return res.status(400).json({ error: 'Invalid calendarId' });
  }
  if (!start) return res.status(400).json({ error: 'start is required' });
  if (!firstName) return res.status(400).json({ error: 'firstName is required' });
  if (!email) return res.status(400).json({ error: 'email is required' });

  var startTime = new Date(start).toISOString();
  var endTime = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();

  var group = calendarId === 'sfnJdd2WAk2lHVTymTOh' ? 'Youth' : 'HS / College';

  // Resolve GHL token — OAuth first (same as GTA), Private Integration key as fallback.
  var ghlToken = await getCh3Token();
  var ghlH = makeGhlHeaders(ghlToken);

  // Resolve contactId: passed from step 1 → Supabase lookup → GHL upsert/lookup.
  var contactId = passedContactId || null;

  // Layer 1: Supabase — check if step 1 already created this contact.
  if (!contactId && SB_URL && SB_KEY) {
    try {
      var sbRes = await fetch(
        `${SB_URL}/rest/v1/website_leads?email=eq.${encodeURIComponent(email)}&client_id=eq.ch3-training&ghl_contact_id=not.is.null&order=created_at.desc&limit=1&select=ghl_contact_id`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      if (sbRes.ok) {
        var sbRows = await sbRes.json();
        if (sbRows && sbRows[0] && sbRows[0].ghl_contact_id) contactId = sbRows[0].ghl_contact_id;
      }
    } catch (_) {}
  }

  // Layer 2: GHL upsert / lookup using the resolved token.
  var lastErrText = null;
  if (!contactId && ghlToken) {
    var contactBody = {
      locationId: LOCATION_ID,
      firstName,
      lastName: lastName || undefined,
      email,
      tags: ['ch3-lead', 'ch3-free-trial-booked'],
    };
    if (phone) contactBody.phone = phone;

    try {
      var contactRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
        method: 'POST',
        headers: ghlH,
        body: JSON.stringify(contactBody),
      });
      if (contactRes.ok) {
        var contactData = await contactRes.json();
        contactId = (contactData.contact || contactData).id || null;
      } else {
        lastErrText = await contactRes.text();
        console.error('ch3-book GHL upsert failed:', contactRes.status, lastErrText.slice(0, 200));
        // Lookup fallback.
        try {
          var lookupRes = await fetch(
            `${GHL_BASE}/contacts/lookup?email=${encodeURIComponent(email)}&locationId=${encodeURIComponent(LOCATION_ID)}`,
            { headers: ghlH }
          );
          if (lookupRes.ok) {
            var lookupData = await lookupRes.json();
            var found = (lookupData.contacts || [])[0] || lookupData.contact || null;
            if (found) contactId = found.id;
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error('ch3-book GHL upsert error (non-fatal):', e.message);
    }
  }

  if (!contactId) {
    console.error('ch3-book: could not resolve contactId. Last error:', lastErrText && lastErrText.slice(0, 300));
    return res.status(502).json({
      error: 'Booking failed — please go back and resubmit the form, or text Coach Haynes at 267-216-8887.',
      detail: lastErrText ? lastErrText.slice(0, 200) : 'Could not resolve contact',
    });
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
    headers: ghlH,
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
