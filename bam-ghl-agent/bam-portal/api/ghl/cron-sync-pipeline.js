import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken, ghl } from "./_core.js";
import { shadowUpsertOpportunity } from "../agent/_store.js";
export const maxDuration = 60;

// GHL -> store pipeline mirror (cron). The transition bridge for academies whose
// pipeline is portal-native (`pipeline_provider='portal'`) while their GHL
// WORKFLOWS still create + move opportunities on the GHL board (DETAIL Miami:
// the numbered "1. Trial Form / 2. Responded to X / 3. Trial Booked" workflows
// are fused with the nurture TEXTING, which stays on GHL by design). Post-flip
// the portal board reads the store, and shadowBackfillFromBoard no longer fires
// (the board GET stops touching GHL) - so without this cron, GHL-side creates
// and moves would be invisible. One-way: GHL -> store. NEVER writes GHL.
//
//   GET /api/ghl/cron-sync-pipeline              (Vercel cron, x-vercel-cron)
//   GET /api/ghl/cron-sync-pipeline?client_id=…  (manual, Bearer CRON_SECRET)
//
// Per qualifying client (pipeline_provider=portal AND pipeline_ghl_mirror=true):
//   1. Read the client's pipeline_stages registry (role <- ghl_stage_id). Only
//      REGISTERED pipelines/stages sync - other GHL boards (camps, hires) are
//      out of scope by construction, no name-matching bleed.
//   2. Fetch GHL's OPEN opps for the registered pipeline(s), paged.
//   3. ADOPT twins: an open store card with the same ghl_contact_id and no
//      ghl_opportunity_id (minted by the website lead path) gets stitched to
//      the GHL opp id instead of duplicating.
//   4. Upsert each opp - but stage moves are NEWER-WINS: if the store row's
//      last_stage_change_at is >= GHL's, the stage is left alone (a portal-side
//      drag must never be undone by the mirror).
//   5. Store-open rows whose GHL twin left the open set get their true status
//      pulled one-by-one (capped) and mirrored (won/lost/abandoned closes).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CLOSE_LOOKUPS_PER_RUN = 20; // per-client cap on one-by-one status pulls

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function fetchOpenOpps(token, locationId, pipelineId) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const qs = new URLSearchParams({ location_id: locationId, pipeline_id: pipelineId, status: "open", limit: "100", page: String(page) });
    const d = await ghl("GET", `/opportunities/search?${qs}`, { token });
    const ops = d.opportunities || d.data || [];
    out.push(...ops);
    if (ops.length < 100) break;
  }
  return out;
}

async function syncClient(client) {
  const r = { client_id: client.id, mirrored: 0, adopted: 0, skipped_newer: 0, closed: 0 };

  // 1. Stage registry = the role map + which pipelines are in scope.
  const stages = await sb(`pipeline_stages?client_id=eq.${client.id}&ghl_stage_id=not.is.null&select=id,role,ghl_stage_id,ghl_pipeline_id,offer_id`);
  if (!stages || !stages.length) { r.skip = "no registered stages"; return r; }
  const roleByStageId = new Map(stages.map(s => [s.ghl_stage_id, s]));
  const pipelineIds = [...new Set(stages.map(s => s.ghl_pipeline_id).filter(Boolean))];

  const creds = await pickGhlToken(client);
  if (!creds || !creds.token) { r.skip = "no ghl token"; return r; }

  // Current store state (ALL statuses) - adoption + newer-wins + close detection,
  // and the hard rule that a portal-side CLOSE IS FINAL: a closed store row is
  // never reopened or restaged by the mirror (this also makes the cron a natural
  // no-op for academies whose GHL board is dead, like GTA).
  const storeRows = await sb(`opportunities?client_id=eq.${client.id}&select=id,ghl_opportunity_id,ghl_contact_id,status,last_stage_change_at`);
  const storeByGhlId = new Map((storeRows || []).filter(x => x.ghl_opportunity_id).map(x => [x.ghl_opportunity_id, x]));
  const orphanByContact = new Map((storeRows || []).filter(x => !x.ghl_opportunity_id && x.ghl_contact_id && x.status === 'open').map(x => [x.ghl_contact_id, x]));

  const seenGhlIds = new Set();
  for (const pid of pipelineIds) {
    const opps = await fetchOpenOpps(creds.token, creds.locationId, pid);
    for (const o of opps) {
      const stageId = o.pipelineStageId || o.stageId || null;
      const info = roleByStageId.get(stageId);
      if (!info) continue; // unregistered stage - out of scope
      seenGhlIds.add(o.id);
      const contactId = o.contactId || (o.contact && o.contact.id) || null;

      // 3. Adopt the website-minted twin (same contact, no ghl id) before upserting.
      const twin = contactId && !storeByGhlId.has(o.id) ? orphanByContact.get(contactId) : null;
      if (twin) {
        await sb(`opportunities?id=eq.${twin.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_opportunity_id: o.id, updated_at: new Date().toISOString() }) });
        storeByGhlId.set(o.id, twin);
        orphanByContact.delete(contactId);
        r.adopted++;
      }

      // 4a. Portal close is final - never reopen/restage a closed store card.
      const existing = storeByGhlId.get(o.id);
      if (existing && existing.status && existing.status !== "open") { r.skipped_closed = (r.skipped_closed || 0) + 1; continue; }
      // 4b. Newer-wins: never let the mirror undo a portal-side stage change.
      const ghlMoveAt = o.lastStageChangeAt ? new Date(o.lastStageChangeAt).getTime() : 0;
      const storeMoveAt = existing && existing.last_stage_change_at ? new Date(existing.last_stage_change_at).getTime() : -1;
      if (existing && ghlMoveAt && storeMoveAt >= ghlMoveAt) { r.skipped_newer++; continue; }

      await shadowUpsertOpportunity(client.id, {
        ghlOpportunityId: o.id,
        ghlContactId: contactId,
        contactName: (o.contact && o.contact.name) || o.name || null,
        contactPhone: (o.contact && o.contact.phone) || null,
        stageRole: info.role,
        stageId: info.id,
        status: "open",
        ghlPipelineId: info.ghl_pipeline_id,
        monetaryValue: o.monetaryValue || 0,
        source: existing ? undefined : "ghl-sync",
        entryPoint: existing ? undefined : "ghl-sync",
        lastStageChangeAt: o.lastStageChangeAt || null,
      });
      r.mirrored++;
    }
  }

  // 5. Store-open rows that vanished from GHL's open set -> pull true status.
  const gone = [...storeByGhlId.entries()].filter(([gid, row]) => row.status === "open" && !seenGhlIds.has(gid)).slice(0, CLOSE_LOOKUPS_PER_RUN);
  for (const [gid] of gone) {
    try {
      const d = await ghl("GET", `/opportunities/${encodeURIComponent(gid)}`, { token: creds.token });
      const st = String((d.opportunity || d).status || "").toLowerCase();
      if (["won", "lost", "abandoned"].includes(st)) {
        await shadowUpsertOpportunity(client.id, { ghlOpportunityId: gid, status: st });
        r.closed++;
      }
    } catch (_) { /* deleted or unreadable - leave the store row as is */ }
  }
  return r;
}

async function handler(req, res) {
  const isCron = !!req.headers["x-vercel-cron"];
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!isCron && !(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const one = String(req.query.client_id || "").trim();
    const filter = one
      ? `id=eq.${encodeURIComponent(one)}`
      : `pipeline_provider=eq.portal&pipeline_ghl_mirror=is.true`;
    const clients = await sb(`clients?${filter}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,pipeline_provider,pipeline_ghl_mirror`);
    const results = [];
    for (const c of (clients || [])) {
      if (c.pipeline_provider !== "portal" || !c.pipeline_ghl_mirror) { results.push({ client_id: c.id, skip: "not portal+mirror" }); continue; }
      try { results.push(await syncClient(c)); }
      catch (e) { results.push({ client_id: c.id, error: e.message }); }
    }
    return res.status(200).json({ ok: true, synced: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
