import { withSentryApiRoute } from '../_sentry.js';

var ALLOWED = new Set(['sfnJdd2WAk2lHVTymTOh', 'f6d7oYjVJRiGr9JPqkow']);
var LOCATION_ID = 'lUqgMMX0RRf1FSG7Odg9';
var GHL_BASE = 'https://services.leadconnectorhq.com';
var GHL_V1 = 'https://rest.gohighlevel.com';

function getCh3Entry() {
  if (process.env.GHL_LOCATIONS_JSON) {
    try {
      var locs = JSON.parse(process.env.GHL_LOCATIONS_JSON);
      return locs.find(function(l) { return l.locationId === LOCATION_ID || l.name === 'CH3 Training'; }) || null;
    } catch (_) {}
  }
  return null;
}
function getCh3Key() {
  var entry = getCh3Entry();
  if (entry && (entry.apiKeyV2 || entry.apiKey)) return entry.apiKeyV2 || entry.apiKey;
  return process.env.GHLKEY || '';
}
function getCh3KeyV1() {
  var entry = getCh3Entry();
  return (entry && entry.apiKey) || null;
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

  // Resolve contactId: passed from step 1 → Supabase lookup → GHL V2 upsert → GHL V1 upsert/lookup.
  var contactId = passedContactId || null;

  // Layer 1: Supabase — check if step 1 already created this contact.
  if (!contactId) {
    var sbUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    var sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    if (sbUrl && sbKey) {
      try {
        var sbRes = await fetch(
          `${sbUrl}/rest/v1/website_leads?email=eq.${encodeURIComponent(email)}&client_id=eq.ch3-training&ghl_contact_id=not.is.null&order=created_at.desc&limit=1&select=ghl_contact_id`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        );
        if (sbRes.ok) {
          var sbRows = await sbRes.json();
          if (sbRows && sbRows[0] && sbRows[0].ghl_contact_id) contactId = sbRows[0].ghl_contact_id;
        }
      } catch (_) {}
    }
  }

  // Layer 2: GHL V2 upsert (requires contacts scope on the Private Integration key).
  var lastErrText = null;
  if (!contactId) {
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
        headers: ghlHeaders(),
        body: JSON.stringify(contactBody),
      });
      if (contactRes.ok) {
        var contactData = await contactRes.json();
        contactId = (contactData.contact || contactData).id || null;
      } else {
        lastErrText = await contactRes.text();
        console.error('ch3-book GHL V2 upsert failed:', contactRes.status, lastErrText.slice(0, 200));

        // V2 lookup fallback (same key — may also be 401 if no contacts scope).
        try {
          var v2LookupRes = await fetch(
            `${GHL_BASE}/contacts/lookup?email=${encodeURIComponent(email)}&locationId=${encodeURIComponent(LOCATION_ID)}`,
            { headers: ghlHeaders() }
          );
          if (v2LookupRes.ok) {
            var v2LookupData = await v2LookupRes.json();
            var v2Found = (v2LookupData.contacts || [])[0] || v2LookupData.contact || null;
            if (v2Found) contactId = v2Found.id;
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error('ch3-book GHL V2 error (non-fatal):', e.message);
    }
  }

  // Layer 3: GHL V1 location key — full contacts access, no scope restrictions.
  if (!contactId) {
    var v1Key = getCh3KeyV1();
    if (v1Key) {
      var v1Headers = { Authorization: `Bearer ${v1Key}`, 'Content-Type': 'application/json' };
      try {
        var v1Res = await fetch(`${GHL_V1}/v1/contacts/`, {
          method: 'POST',
          headers: v1Headers,
          body: JSON.stringify({
            locationId: LOCATION_ID,
            firstName,
            lastName: lastName || undefined,
            email,
            phone: phone || undefined,
          }),
        });
        if (v1Res.ok) {
          var v1Data = await v1Res.json();
          contactId = v1Data.contact?.id || v1Data.id || null;
        } else {
          // V1 create failed — try V1 search by email.
          try {
            var v1LookupRes = await fetch(
              `${GHL_V1}/v1/contacts/?locationId=${encodeURIComponent(LOCATION_ID)}&query=${encodeURIComponent(email)}`,
              { headers: { Authorization: `Bearer ${v1Key}` } }
            );
            if (v1LookupRes.ok) {
              var v1LookupData = await v1LookupRes.json();
              var v1Match = (v1LookupData.contacts || []).find(function(c) { return c.email === email; });
              if (v1Match) contactId = v1Match.id;
            }
          } catch (_) {}
        }
      } catch (e) {
        console.error('ch3-book GHL V1 error (non-fatal):', e.message);
      }
    }
  }

  if (!contactId) {
    console.error('ch3-book all contact layers failed. Last GHL error:', lastErrText && lastErrText.slice(0, 300));
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
