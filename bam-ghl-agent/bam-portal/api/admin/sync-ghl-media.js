// POST /api/admin/sync-ghl-media?client_id=<uuid>&key=<CRON_SECRET>
// Pulls all images + videos from a client's GHL media library and upserts
// them into the Supabase client-assets bucket + client_assets table.
// Skips files that are already synced (matched by original GHL URL stored in link_url).
// Gated by CRON_SECRET — internal admin use only.

import { withSentryApiRoute } from '../_sentry.js';
import { getClientGhlToken } from '../website/availability.js';

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
const GHL    = 'https://services.leadconnectorhq.com';
const VER    = '2021-07-28';

async function sbReq(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

async function sbStorageUpload(bucket, path, data, contentType) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: data,
  });
  if (!r.ok) throw new Error(`Storage upload ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

async function ghlListMedia(token, locationId, type, offset = 0) {
  const params = new URLSearchParams({ locationId, type, limit: '100', offset: String(offset) });
  const r = await fetch(`${GHL}/medias/?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Version: VER, Accept: 'application/json' },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GHL media ${r.status}: ${json.message || json.error || r.status}`);
  return json;
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const secret = (process.env.GHL_MEDIA_SYNC_SECRET || process.env.CRON_SECRET || '').trim();
  if (!secret || req.query.key !== secret) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  // Load client
  let client;
  try {
    const rows = await sbReq(
      `clients?id=eq.${client_id}&select=id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
    );
    client = rows?.[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Get (and refresh if needed) GHL token
  let token;
  try { token = await getClientGhlToken(client); }
  catch (e) { return res.status(502).json({ error: `GHL token: ${e.message}` }); }

  const locationId = client.ghl_location_id;

  // Load already-synced URLs to skip duplicates
  let existingUrls = new Set();
  try {
    const existing = await sbReq(
      `client_assets?client_id=eq.${client_id}&link_url=not.is.null&select=link_url`
    );
    existingUrls = new Set((existing || []).map(r => r.link_url));
  } catch (_) {}

  const results = { synced: 0, skipped: 0, failed: 0, errors: [] };

  for (const mediaType of ['image', 'video']) {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let page;
      try { page = await ghlListMedia(token, locationId, mediaType, offset); }
      catch (e) { results.errors.push(`list ${mediaType}@${offset}: ${e.message}`); break; }

      const items = page.medias || page.files || [];
      if (!items.length) { hasMore = false; break; }

      for (const item of items) {
        const srcUrl = item.url || item.downloadUrl;
        if (!srcUrl) { results.skipped++; continue; }
        if (existingUrls.has(srcUrl)) { results.skipped++; continue; }

        const name   = item.name || item.fileName || 'untitled';
        const mime   = item.mimeType || (mediaType === 'image' ? 'image/jpeg' : 'video/mp4');
        const cat    = mediaType === 'video' ? 'video' : 'photo';
        const label  = name.replace(/\.[^.]+$/, '');
        const clean  = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const stamp  = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const path   = `${client_id}/${stamp}-${clean}`;

        try {
          // Download the file from GHL CDN
          const fileRes = await fetch(srcUrl);
          if (!fileRes.ok) throw new Error(`Download ${fileRes.status}`);
          const buffer = await fileRes.arrayBuffer();

          // Upload to Supabase storage
          await sbStorageUpload('client-assets', path, buffer, mime);

          // Insert record — store original GHL URL in link_url for dedup on re-runs
          await sbReq(`client_assets`, {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              client_id,
              label,
              category: cat,
              storage_path: path,
              mime_type: mime,
              size_bytes: item.size || buffer.byteLength,
              link_url: srcUrl, // used as dedup key; cleared by client if they want to re-upload
              folder: 'GHL Import',
            }),
          });

          existingUrls.add(srcUrl);
          results.synced++;
        } catch (e) {
          results.failed++;
          results.errors.push(`${name}: ${e.message}`);
        }
      }

      offset += items.length;
      hasMore = items.length === 100;
    }
  }

  return res.status(200).json({ ok: true, locationId, ...results });
}

export default withSentryApiRoute(handler);
