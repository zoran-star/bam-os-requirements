// Vercel Serverless Function — Post-trial review submit.
//
//   POST /api/ghl/post-trial?client_id=<uuid>
//     body: { opportunity_id, good_fit, trainer, notes }
//     → records a post_trial_reviews row. If good_fit:
//        • moves the opportunity to the Done Trial stage
//        • writes the trainer to the contact's "Lead Sales Person" field
//        • QUEUES a signup-link text (status 'queued') — NOT sent yet; the
//          comms tab will deliver queued texts once it exists.
//
// Auth: Supabase JWT — staff, or client_users membership for client_id.

import { withSentryApiRoute } from "../_sentry.js";
import { moveStage, pipelineFlags, oppMatchClause } from "../agent/_store.js";
import { contactProvider } from "../_contacts.js";
import { enrollContact, isAutomationLive } from "../automations.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION = "2021-07-28";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role,name&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role,name&limit=1`);
  }
  const isStaff = Array.isArray(staff) && staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, staff: isStaff ? staff[0] : null, isStaff, clientIds };
}

async function ghl(method, path, { token, body } = {}) {
  const res = await fetch(`${GHL_V2}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  if (!res.ok) { const e = new Error((json && (json.message || json.error)) || `GHL ${res.status}`); e.status = res.status; throw e; }
  return json;
}

async function getToken(client) {
  if (!client.ghl_access_token) throw new Error("academy not connected to GHL");
  const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
  if (exp - Date.now() > 60_000 || !client.ghl_refresh_token) return client.ghl_access_token;
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim(), sec = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !sec) return client.ghl_access_token;
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: "refresh_token", refresh_token: client.ghl_refresh_token, user_type: "Location" }),
  });
  const tok = await r.json();
  if (!r.ok || !tok?.access_token) return client.ghl_access_token;
  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token, ghl_token_expires_at: new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString() }),
  });
  return tok.access_token;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  const b = req.body || {};
  const oppId = b.opportunity_id;
  if (!oppId) return res.status(400).json({ error: "opportunity_id required" });
  const goodFit = !!b.good_fit;
  const showedUp = (b.showed_up === true || b.showed_up === false) ? b.showed_up : null;
  const trainer = (b.trainer || "").trim() || null;
  const notes = (b.notes || "").trim() || null;
  const sendLink = !!b.send_onboarding_link;

  const rows = await sb(`clients?id=eq.${clientId}&select=id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
  const client = rows?.[0];
  if (!client) return res.status(404).json({ error: "academy not found" });

  let token;
  try { token = await getToken(client); }
  catch (e) { return res.status(502).json({ error: `GHL token: ${e.message}` }); }

  // Look up the opportunity for contact + pipeline (provider-aware). A provider='portal'
  // academy's opp lives in the store and its id is a portal uuid, so a GHL fetch would
  // 404 - read the store row instead. `oppRef` is the handle passed to the stage moves.
  let contactId = null, pipelineId = null, oppRef = null;
  const { provider } = await pipelineFlags(clientId).catch(() => ({ provider: "ghl" }));
  if (provider === "portal") {
    try {
      const rows = await sb(`opportunities?client_id=eq.${encodeURIComponent(clientId)}&${oppMatchClause(oppId)}&select=id,ghl_opportunity_id,ghl_contact_id,ghl_pipeline_id&limit=1`);
      const row = Array.isArray(rows) && rows[0];
      if (row) { contactId = row.ghl_contact_id || null; pipelineId = row.ghl_pipeline_id || null; oppRef = { id: row.id, ghlOpportunityId: row.ghl_opportunity_id || null }; }
    } catch (e) { return res.status(500).json({ error: `store opp: ${e.message}` }); }
  } else {
    let opp;
    try { opp = (await ghl("GET", `/opportunities/${encodeURIComponent(oppId)}`, { token })).opportunity; }
    catch (e) { return res.status(e.status || 502).json({ error: `GHL opp: ${e.message}` }); }
    contactId = opp?.contactId || opp?.contact?.id || null;
    pipelineId = opp?.pipelineId || opp?.pipeline_id || null;
    oppRef = { ghlOpportunityId: oppId };
  }

  // Record the review (one per opportunity).
  try {
    await sb("post_trial_reviews?on_conflict=client_id,opportunity_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        client_id: clientId, opportunity_id: oppId, ghl_contact_id: contactId,
        good_fit: goodFit, showed_up: showedUp, trainer, notes,
        signup_text_status: sendLink ? "queued" : "skipped",
        created_by: ctx.staff?.name || ctx.user?.email || null,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) { return res.status(500).json({ error: `save review: ${e.message}` }); }

  // Contact provider gate: a 'portal' academy owns attendance + trainer in its own
  // tables (post_trial_reviews above, contact_trainers below), so the redundant GHL
  // custom-field writes are skipped for it. Every other academy keeps writing GHL.
  const contactProv = await contactProvider(clientId);

  // Write attendance to the "Did the Athlete show up?" field (non-fatal).
  if (contactId && showedUp !== null && contactProv !== "portal") {
    try {
      const cf = (await ghl("GET", `/locations/${encodeURIComponent(client.ghl_location_id)}/customFields`, { token })).customFields || [];
      const f = cf.find(x => /did the athlete show up|showed up|attended/i.test(x.name || ""));
      if (f) await ghl("PUT", `/contacts/${encodeURIComponent(contactId)}`, { token, body: { customFields: [{ id: f.id, field_value: showedUp ? "Yes" : "No" }] } });
    } catch (e) { console.error("attendance write failed (non-fatal):", e.message); }
  }

  // Mirror the trainer onto the contact so the Communications tab's trainer
  // tabs pick it up (also editable inline there).
  if (contactId && trainer) {
    try {
      await sb("contact_trainers?on_conflict=client_id,ghl_contact_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ client_id: clientId, ghl_contact_id: contactId, trainer, updated_by: ctx.staff?.name || ctx.user?.email || null, updated_at: new Date().toISOString() }),
      });
    } catch (e) { console.error("contact_trainers upsert failed (non-fatal):", e.message); }
  }

  const result = { ok: true, good_fit: goodFit, showed_up: showedUp, moved: false, trainer, signup_text: "none" };

  // Missed-trial first-touch: when the trainer marks the athlete as NOT attended,
  // start a rebooking outreach. PREFER the portal-native "missed_trial" automation
  // (configurable in Train Agent -> 📵 Missed Trial). Its completion rolls into 👻
  // Ghosted automatically (api/automations.js roll-forward), so the chain is:
  //   no-show -> missed_trial first-touch -> Ghosted -> Nurture.
  // Only fall back to the academy's chosen GHL "missed trial" workflow
  // (offers.data.missed_trial_workflow) when the portal automation is NOT live, so a
  // contact never gets both. Non-fatal.
  if (showedUp === false && contactId) {
    let portalMissedLive = false;
    try { portalMissedLive = await isAutomationLive(clientId, "missed_trial"); } catch (_) { portalMissedLive = false; }
    if (portalMissedLive) {
      try {
        const en = await enrollContact({ clientId, automationKey: "missed_trial", contactId });
        result.missed_trial = (en && en.ok) ? "portal_enrolled" : `portal_${(en && en.skipped) || "skipped"}`;
      } catch (e) {
        console.error("missed-trial portal enroll failed (non-fatal):", e.message);
        result.missed_trial = "portal_failed";
      }
    } else {
      try {
        const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
        const wfId = ((offers && offers[0] && offers[0].data && offers[0].data.missed_trial_workflow) || "").trim();
        if (!wfId) {
          result.missed_trial = "no_workflow";   // portal automation off + no GHL workflow set
        } else {
          await ghl("POST", `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(wfId)}`, { token });
          result.missed_trial = "fired";
        }
      } catch (e) {
        console.error("missed-trial workflow failed (non-fatal):", e.message);
        result.missed_trial = "failed";
      }
    }
  }

  // No-show → move the opportunity back to the Interested stage so it re-enters
  // the nurture flow (the missed-trial automation handles the outreach). We don't
  // ask about "good fit" for a no-show, so this is the whole outcome for them.
  if (showedUp === false) {
    try {
      const pls = (await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(client.ghl_location_id)}`, { token })).pipelines || [];
      const pl = pls.find(p => p.id === pipelineId) || pls[0];
      const interested = (pl?.stages || []).find(s => /interested/i.test(s.name || ""));
      if (interested) {
        // Move through the provider-aware store; on ghl it is the identical PUT and the
        // store does the shadow mirror internally (replacing the manual shadowMirrorMove).
        await moveStage({ clientId, sb, ghl, token, oppRef, stage: { pipelineId: pl.id, stageId: interested.id, stageName: interested.name }, role: "interested", contactId });
        result.moved = true;
        result.moved_to = "interested";
      }
    } catch (e) { console.error("no-show interested move failed (non-fatal):", e.message); }
  }

  if (goodFit) {
    // Move to the Done Trial stage of the opp's pipeline.
    try {
      const pls = (await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(client.ghl_location_id)}`, { token })).pipelines || [];
      const pl = pls.find(p => p.id === pipelineId) || pls[0];
      const doneStage = (pl?.stages || []).find(s => { const n = (s.name || "").toLowerCase(); return n.includes("trial") && (n.includes("done") || n.includes("complete") || n.includes("attended")); });
      if (doneStage) {
        // Move through the provider-aware store; on ghl it is the identical PUT and the
        // store does the shadow mirror internally (replacing the manual shadowMirrorMove).
        await moveStage({ clientId, sb, ghl, token, oppRef, stage: { pipelineId: pl.id, stageId: doneStage.id, stageName: doneStage.name }, role: "done_trial", contactId });
        result.moved = true;
      }
    } catch (e) { console.error("done-trial move failed (non-fatal):", e.message); }

    // Write the trainer to the contact's "Lead Sales Person" field (GTA convention).
    if (contactId && trainer && contactProv !== "portal") {
      try {
        const cf = (await ghl("GET", `/locations/${encodeURIComponent(client.ghl_location_id)}/customFields`, { token })).customFields || [];
        const lsp = cf.find(f => /lead sales person/i.test(f.name || "")) || cf.find(f => /sales person|trainer/i.test(f.name || ""));
        if (lsp) {
          await ghl("PUT", `/contacts/${encodeURIComponent(contactId)}`, { token, body: { customFields: [{ id: lsp.id, field_value: trainer }] } });
        }
      } catch (e) { console.error("trainer write failed (non-fatal):", e.message); }
    }

  }

  // Send the trainer's first follow-up message: their personal note (TOP) + the
  // academy sign-up link on its own line at the BOTTOM (only when "add the sign-up
  // link" is on). Link is configured per-academy on the training offer
  // (offers.data.signup_url). Never send for a no-show (guard if the flag leaks).
  const firstMessage = (b.first_message || "").toString().trim();
  if (contactId && showedUp !== false && (firstMessage || sendLink)) {
    try {
      let signupUrl = "";
      if (sendLink) {
        const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
        signupUrl = ((offers && offers[0] && offers[0].data && offers[0].data.signup_url) || "").trim();
      }
      const parts = [];
      if (firstMessage) parts.push(firstMessage);
      if (signupUrl)    parts.push(signupUrl);
      const msg = parts.join("\n\n");
      if (!msg) {
        result.signup_text = sendLink ? "no_link" : "none";   // link asked for but none set, and no note typed
      } else {
        await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId, message: msg } });
        result.signup_text = "sent";
        try {
          await sb(`post_trial_reviews?client_id=eq.${encodeURIComponent(clientId)}&opportunity_id=eq.${encodeURIComponent(oppId)}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ signup_text_status: "sent", updated_at: new Date().toISOString() }),
          });
        } catch (_) {}
      }
    } catch (e) {
      console.error("first-message send failed (non-fatal):", e.message);
      result.signup_text = "failed";
    }
  }

  return res.status(200).json(result);
}

export default withSentryApiRoute(handler);
