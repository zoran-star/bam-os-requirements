// POST /api/admin/sync-ghl-funnels?client_id=<uuid>&key=<CRON_SECRET>
// Pulls all funnel pages from a client's GHL location and upserts them into
// the client_funnel_pages table.
//
// Uses the Private Integration key from GHL_LOCATIONS_JSON for funnel access
// (GHL's funnels/page scope is not included in standard OAuth tokens).
// Falls back to the stored OAuth token if no PI key is found.

import { withSentryApiRoute } from '../_sentry.js';

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
const GHL    = 'https://services.leadconnectorhq.com';
const VER    = '2021-07-28';

function loadLocations() {
  try { return process.env.GHL_LOCATIONS_JSON ? JSON.parse(process.env.GHL_LOCATIONS_JSON) : []; }
  catch { return []; }
}

function getPrivateKey(locationId) {
  const locs = loadLocations();
  const loc = locs.find(l => l.locationId === locationId);
  return loc?.apiKeyV2 || loc?.apiKey || null;
}

async function sbReq(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
      ...(init.headers || {}),
    },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

async function ghlListPages(token, locationId, offset = 0) {
  const params = new URLSearchParams({ locationId, limit: '100', offset: String(offset) });
  const r = await fetch(`${GHL}/funnels/page?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Version: VER, Accept: 'application/json' },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GHL funnels/page ${r.status}: ${json.message || json.error || r.status}`);
  return json;
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const secret = (process.env.GHL_MEDIA_SYNC_SECRET || process.env.CRON_SECRET || '').trim();
  if (!secret || req.query.key !== secret) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  let client;
  try {
    const rows = await sbReq(
      `clients?id=eq.${client_id}&select=id,ghl_location_id,ghl_access_token&limit=1`
    );
    client = rows?.[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const locationId = client.ghl_location_id;
  if (!locationId) return res.status(400).json({ error: 'Client has no GHL location ID' });

  // Prefer Private Integration key (has funnels scope); fall back to OAuth token
  const token = getPrivateKey(locationId) || client.ghl_access_token;
  if (!token) return res.status(400).json({ error: 'No GHL token available for this client' });

  const results = { upserted: 0, skipped: 0, failed: 0, errors: [] };
  const now = new Date().toISOString();

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let page;
    try { page = await ghlListPages(token, locationId, offset); }
    catch (e) {
      results.errors.push(`list@${offset}: ${e.message}`);
      break;
    }

    const items = page.pages || page.data || [];
    if (!items.length) { hasMore = false; break; }

    for (const item of items) {
      const ghlPageId = item.id || item._id;
      if (!ghlPageId) { results.skipped++; continue; }

      try {
        await sbReq(`client_funnel_pages`, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            client_id,
            location_id: locationId,
            ghl_page_id: ghlPageId,
            ghl_funnel_id: item.funnelId || item.funnel_id || null,
            name: item.name || item.title || null,
            step_url: item.stepUrl || item.step_url || null,
            url: item.url || null,
            title: item.title || item.name || null,
            status: item.status || null,
            raw: item,
            synced_at: now,
          }),
        });
        results.upserted++;
      } catch (e) {
        results.failed++;
        results.errors.push(`${item.name || ghlPageId}: ${e.message}`);
      }
    }

    offset += items.length;
    hasMore = items.length === 100;
  }

  return res.status(200).json({ ok: true, locationId, ...results });
}

export default withSentryApiRoute(handler);
