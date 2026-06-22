// GET /api/admin/ghl-scrape?client_id=<uuid>&key=<CRON_SECRET>
// Returns GHL forms, calendars, custom fields, and location info for a client.
// Uses getClientGhlToken (auto-refreshes OAuth token if expired).
// Gated by CRON_SECRET — internal admin use only.

import { withSentryApiRoute } from '../_sentry.js';
import { getClientGhlToken } from '../website/availability.js';

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
const GHL    = 'https://services.leadconnectorhq.com';
const VER    = '2021-07-28';

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function ghl(token, path) {
  const r = await fetch(`${GHL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: VER, Accept: 'application/json' },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) return { __error: json.message || json.error || `GHL ${r.status}`, __status: r.status };
  return json;
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const expected = (process.env.CRON_SECRET || '').trim();
  if (!expected || (req.query.key || '') !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const clientId = (req.query.client_id || '').trim();
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const rows = await sb(
    `clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
  );
  const client = rows?.[0];
  if (!client) return res.status(404).json({ error: 'client not found' });

  let token;
  try { token = await getClientGhlToken(client); }
  catch (e) { return res.status(502).json({ error: `token: ${e.message}` }); }

  const loc = client.ghl_location_id;

  const [forms, calendars, customFields, customValues, location] = await Promise.all([
    ghl(token, `/forms/?locationId=${loc}&limit=100`),
    ghl(token, `/calendars/?locationId=${loc}`),
    ghl(token, `/locations/${loc}/customFields`),
    ghl(token, `/locations/${loc}/customValues`),
    ghl(token, `/locations/${loc}`),
  ]);

  // Fetch calendar details for each calendar to get booking config
  const calList = calendars.calendars || [];
  const calDetails = await Promise.all(
    calList.map(c => ghl(token, `/calendars/${c.id}`))
  );

  return res.status(200).json({
    client: { id: client.id, name: client.business_name, locationId: loc },
    location: location.location || location,
    forms: forms.forms || forms,
    calendars: calList.map((c, i) => ({ ...c, details: calDetails[i] })),
    customFields: customFields.customFields || customFields,
    customValues: customValues.customValues || customValues,
  });
}

export default withSentryApiRoute(handler);
