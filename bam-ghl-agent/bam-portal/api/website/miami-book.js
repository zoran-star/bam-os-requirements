// POST /api/website/miami-book
// Calendar booking for DETAIL Miami free trial.
// Body: { calendarId, start, firstName, lastName, email, phone, contactId? }
// Returns: { ok, contactId, appointmentId, start, day, shortDate, time, fullDisplay, group, location }

import { withSentryApiRoute } from '../_sentry.js';
import { getClientGhlToken } from './availability.js';
import { findOpenOpp, moveStage } from '../agent/_store.js';

const ALLOWED_CALENDARS = new Set([
  '290AH08i2I7Ts3yzd4W0', // Free Trial - Elementary Academy
  'HPQ2WsQ444DbtuatZPmM', // Free Trial - MS and HS Academy
]);
const MIAMI_LOC         = 'RBnlVgmXNMbFpgFGPGcv';
const MIAMI_CLIENT_UUID = '4708a68d-5365-48bf-a404-72a69fadd34d';
const GHL_BASE          = 'https://services.leadconnectorhq.com';

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// One clients read powers both the GHL token and the booking_provider branch.
async function getMiamiClient() {
  if (SB_URL && SB_KEY) {
    try {
      const rows = await sb(
        `clients?id=eq.${MIAMI_CLIENT_UUID}&select=id,booking_provider,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
      );
      if (rows?.[0]) return rows[0];
    } catch (_) {}
  }
  return { ghl_location_id: MIAMI_LOC };
}

async function getMiamiToken(client) {
  try {
    if (client?.id) return await getClientGhlToken(client);
  } catch (_) {}
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

  const client = await getMiamiClient();
  const ghlToken = await getMiamiToken(client);
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

  // ── booking_provider='portal': book onto OUR slot via the capacity-safe RPC
  // (mirrors api/website/leads.js's portal booking branch). The contact still
  // lives in GHL (contacts stay GHL-backed until Twilio), so the layers above
  // are unchanged - only the appointment write moves off GHL. Response shape
  // is identical to the GHL branch so the site needs no changes.
  if ((client.booking_provider || '') === 'portal') {
    const t = new Date(start);
    if (isNaN(t.getTime())) return res.status(400).json({ error: 'Invalid start time' });

    let ep = null;
    try {
      const eps = await sb(
        `entry_points?client_id=eq.${MIAMI_CLIENT_UUID}&type=eq.calendar&key=eq.${encodeURIComponent(calendarId)}&enabled=eq.true&select=id,label,offer_id,stage_name&limit=1`
      );
      ep = eps?.[0] || null;
    } catch (_) {}

    let slot = null;
    try {
      const slotRows = (await sb(
        `schedule_slots?tenant_id=eq.${MIAMI_CLIENT_UUID}&is_cancelled=eq.false&start_time=eq.${encodeURIComponent(t.toISOString())}&select=id,name&limit=10`
      )) || [];
      const groupMatch = /group\s*\d+/i.exec(ep?.label || '');
      const groupPrefix = groupMatch ? groupMatch[0].toLowerCase().replace(/\s+/g, ' ') : null;
      slot = slotRows.find(s => !groupPrefix || (s.name || '').toLowerCase().replace(/\s+/g, ' ').includes(groupPrefix)) || slotRows[0] || null;
    } catch (e) {
      return res.status(502).json({ error: 'Failed to book appointment', detail: String(e.message).slice(0, 200) });
    }
    if (!slot) return res.status(409).json({ error: 'That time is no longer available - please pick another time.' });

    let rpcRes;
    try {
      rpcRes = await sb(`rpc/book_trial_slot`, {
        method: 'POST',
        body: JSON.stringify({
          p_tenant_id: MIAMI_CLIENT_UUID,
          p_slot_id: slot.id,
          p_parent_name: `${firstName}${lastName ? ' ' + lastName : ''}` || null,
          p_parent_email: email.toLowerCase(),
          p_athlete_name: null,
          p_parent_phone: phone || null,
          p_athlete_dob: null,
          p_entry_point_id: ep?.id || null,
          p_offer_id: ep?.offer_id || null,
          p_ghl_contact_id: contactId,
          p_source: 'website',
          p_metadata: { calendar_key: calendarId, slot_name: slot.name },
        }),
      });
    } catch (e) {
      return res.status(502).json({ error: 'Failed to book appointment', detail: String(e.message).slice(0, 200) });
    }
    const trialBookingId = typeof rpcRes === 'string' ? rpcRes : (rpcRes && rpcRes.trial_booking_id) || null;
    if (!trialBookingId) return res.status(502).json({ error: 'Failed to book appointment' });

    // No GHL appointment fires on a portal booking, so Detail's GHL nurture
    // workflows get no AppointmentCreate stop signal - stamp the booked tag on
    // the (GHL-backed) contact as their hook. Best-effort.
    try {
      await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}/tags`, {
        method: 'POST', headers: ghlH, body: JSON.stringify({ tags: ['miami-free-trial-booked'] }),
      });
    } catch (_) {}

    // Advance the lead's card to the entry point's stage through the
    // provider-aware store (records the trial_booked KPI). Non-fatal.
    try {
      const ref = await findOpenOpp({ clientId: MIAMI_CLIENT_UUID, token: ghlToken, locationId: MIAMI_LOC, contactId });
      if (ref) {
        await moveStage({
          clientId: MIAMI_CLIENT_UUID, token: ghlToken, oppRef: ref,
          stage: { stageName: ep?.stage_name || 'Schedule Trial' },
          role: 'scheduled_trial', contactId,
        });
      }
    } catch (e) { console.error('miami-book: stage move failed (non-fatal):', e.message); }

    const fmt = formatDatetime(start);
    return res.status(200).json({
      ok: true, contactId,
      appointmentId: trialBookingId,
      start, ...fmt, group,
      location: '16414 NW 54th Ave, Hialeah, FL 33014',
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
