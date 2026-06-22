// POST /api/website/miami-book
// Calendar booking for DETAIL Miami free trial.
// Body: { calendarId, start, firstName, lastName, email, phone, contactId? }
// Returns: { ok, contactId, appointmentId, start, day, shortDate, time, fullDisplay, group, location }

import { withSentryApiRoute } from '../_sentry.js';
import { getClientGhlToken } from './availability.js';

const ALLOWED_CALENDARS = new Set([
  '290AH08i2I7Ts3yzd4W0', // Free Trial - Elementary Academy
  'HPQ2WsQ444DbtuatZPmM', // Free Trial - MS and HS Academy
]);
const MIAMI_LOC         = 'RBnlVgmXNMbFpgFGPGcv';
const MIAMI_CLIENT_UUID = '4708a68d-5365-48bf-a404-72a69fadd34d';
const GHL_BASE          = 'https://services.leadconnectorhq.com';

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

async function getMiamiToken() {
  if (SB_URL && SB_KEY) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/clients?id=eq.${MIAMI_CLIENT_UUID}&select=id,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows?.[0]) return await getClientGhlToken(rows[0]);
      }
    } catch (_) {}
  }
  return process.env.GHLKEY || '';
}

function makeHeaders(token) {
  return { Authorization: 'Bearer ' + token, Version: '2021-07-28', 'Content-Type': 'application/json' };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDatetime(iso) {
  const d = new Date(iso);
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return {
    day:         days[d.getDay()],
    shortDate:   `${months[d.getMonth()]} ${d.getDate()}`,
    time:        `${h12}:${pad2(m)} ${ampm}`,
    fullDisplay: `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} · ${h12}:${pad2(m)} ${ampm}`,
  };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { calendarId, start, firstName, lastName, email, phone, contactId: passedContactId } = req.body || {};

  if (!calendarId || !ALLOWED_CALENDARS.has(calendarId)) return res.status(400).json({ error: 'Invalid calendarId' });
  if (!start)     return res.status(400).json({ error: 'start is required' });
  if (!firstName) return res.status(400).json({ error: 'firstName is required' });
  if (!email)     return res.status(400).json({ error: 'email is required' });

  const startTime = new Date(start).toISOString();
  const endTime   = new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString(); // 2-hour sessions
  const group     = calendarId === '290AH08i2I7Ts3yzd4W0' ? 'Elementary' : 'MS / HS';

  const ghlToken = await getMiamiToken();
  const ghlH = makeHeaders(ghlToken);

  let contactId = passedContactId || null;

  // Layer 1: Supabase lookup from step 1
  if (!contactId && SB_URL && SB_KEY) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/website_leads?email=eq.${encodeURIComponent(email)}&client_id=eq.detail-miami&ghl_contact_id=not.is.null&order=created_at.desc&limit=1&select=ghl_contact_id`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows?.[0]?.ghl_contact_id) contactId = rows[0].ghl_contact_id;
      }
    } catch (_) {}
  }

  // Layer 2: GHL upsert / lookup
  let lastErrText = null;
  if (!contactId && ghlToken) {
    const body = {
      locationId: MIAMI_LOC, firstName, email,
      tags: ['miami-lead', 'miami-free-trial-booked'],
    };
    if (lastName) body.lastName = lastName;
    if (phone)    body.phone    = phone;
    try {
      const r = await fetch(`${GHL_BASE}/contacts/upsert`, {
        method: 'POST', headers: ghlH, body: JSON.stringify(body),
      });
      if (r.ok) {
        const data = await r.json();
        contactId = (data.contact || data).id || null;
      } else {
        lastErrText = await r.text();
        console.error('miami-book: GHL upsert failed:', r.status, lastErrText.slice(0, 200));
        try {
          const lr = await fetch(`${GHL_BASE}/contacts/lookup?email=${encodeURIComponent(email)}&locationId=${MIAMI_LOC}`, { headers: ghlH });
          if (lr.ok) { const ld = await lr.json(); contactId = ((ld.contacts || [])[0] || ld.contact || null)?.id; }
        } catch (_) {}
      }
    } catch (e) {
      console.error('miami-book: GHL upsert error:', e.message);
    }
  }

  if (!contactId) {
    return res.status(502).json({
      error: 'Booking failed — please go back and resubmit the form, or contact us directly.',
      detail: lastErrText ? lastErrText.slice(0, 200) : 'Could not resolve contact',
    });
  }

  const apptRes = await fetch(`${GHL_BASE}/calendars/events/appointments`, {
    method: 'POST',
    headers: ghlH,
    body: JSON.stringify({
      calendarId, locationId: MIAMI_LOC, contactId, startTime, endTime,
      title: `Free Trial — ${firstName}${lastName ? ' ' + lastName : ''}`,
      appointmentStatus: 'confirmed',
    }),
  });

  if (!apptRes.ok) {
    const err = await apptRes.text();
    return res.status(apptRes.status).json({ error: 'Failed to book appointment', detail: err });
  }

  const apptData = await apptRes.json();
  const fmt = formatDatetime(start);

  return res.status(200).json({
    ok: true, contactId,
    appointmentId: apptData.id || apptData.appointment?.id,
    start, ...fmt, group,
    location: '16414 NW 54th Ave, Hialeah, FL 33014',
  });
}

export default withSentryApiRoute(handler);
