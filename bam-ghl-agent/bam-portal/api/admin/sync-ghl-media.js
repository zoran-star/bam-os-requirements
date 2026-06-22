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

async function ghlListMedia(token, locationId, offset = 0) {
  const params = new URLSearchParams({
    altId: locationId, altType: 'location',
    type: 'file',
    limit: '100', offset: String(offset),
  });
  const r = await fetch(`${GHL}/medias/files?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Version: VER, Accept: 'application/json' },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GHL media ${r.status}: ${json.message || json.error || r.status}`);
  return json;
}

function ghlCategoryFromMime(mime) {
  if (!mime) return 'file';
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

// Files over this threshold are linked (GHL CDN URL) rather than copied into Supabase storage.
// Vercel Pro function timeout is 300s — a 50 MB file at ~10 MB/s download + upload would be tight.
const LINK_ONLY_THRESHOLD = 50 * 1024 * 1024; // 50 MB

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

  const results = { synced: 0, linked: 0, skipped: 0, failed: 0, errors: [] };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let page;
    try { page = await ghlListMedia(token, locationId, offset); }
    catch (e) { results.errors.push(`list@${offset}: ${e.message}`); break; }

    const items = page.files || page.medias || [];
    if (!items.length) { hasMore = false; break; }

    for (const item of items) {
      const srcUrl = item.url || item.downloadUrl;
      if (!srcUrl) { results.skipped++; continue; }
      if (existingUrls.has(srcUrl)) { results.skipped++; continue; }

      const name     = item.name || item.fileName || 'untitled';
      const mime     = item.contentType || item.mimeType || 'application/octet-stream';
      const cat      = ghlCategoryFromMime(mime);
      const label    = name.replace(/\.[^.]+$/, '');
      const clean    = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const fileSize = item.size || 0;

      try {
        if (fileSize > LINK_ONLY_THRESHOLD) {
          // Large file — store GHL CDN URL directly, skip Supabase copy
          await sbReq(`client_assets`, {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              client_id,
              label,
              category: cat,
              storage_path: null,
              link_url: srcUrl,
              mime_type: mime,
              size_bytes: fileSize,
              folder: 'GHL Import',
            }),
          });
          existingUrls.add(srcUrl);
          results.linked++;
        } else {
          const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          const path  = `${client_id}/${stamp}-${clean}`;

          const fileRes = await fetch(srcUrl);
          if (!fileRes.ok) throw new Error(`Download ${fileRes.status}`);
          const buffer = await fileRes.arrayBuffer();

          await sbStorageUpload('client-assets', path, buffer, mime);

          await sbReq(`client_assets`, {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              client_id,
              label,
              category: cat,
              storage_path: path,
              mime_type: mime,
              size_bytes: fileSize || buffer.byteLength,
              link_url: srcUrl,
              folder: 'GHL Import',
            }),
          });

          existingUrls.add(srcUrl);
          results.synced++;
        }
      } catch (e) {
        results.failed++;
        results.errors.push(`${name}: ${e.message}`);
      }
    }

    offset += items.length;
    hasMore = items.length === 100;
  }

  return res.status(200).json({ ok: true, locationId, ...results });
}

export default withSentryApiRoute(handler);
