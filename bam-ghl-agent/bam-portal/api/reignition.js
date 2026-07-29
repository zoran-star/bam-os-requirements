import { withSentryApiRoute } from "./_sentry.js";
// ── REIGNITION: the staff actions + the admission cron ───────────────────────
// Design (approved): docs/plans/ignition-template.html
// Core (pure, tested): api/agent/reignition.js · Stage: api/agent/reignition-station.js
//
//   POST (staff)   create · add-roster · dry-run · approve · halt · list · get
//   GET ?action=admit   (Bearer CRON_SECRET) the daily pass: admit up to per_day
//                       people per campaign, then reconcile who replied / ran out.
//
// THIS FILE SENDS NOTHING. Every message a campaign delivers is an ordinary
// automation step delivered by the ordinary worker (api/automations.js -> _send.js),
// which is what keeps quiet hours, time zones, the empty-after-merge skip, the
// dedupe key, the retry ladder and reply handling applying to campaign messages
// with zero new code. Admission enrols; the worker sends. If you ever find yourself
// adding a fetch to a provider in here, the design has gone wrong.
//
// WHY THE STATE MACHINE LIVES IN THE CRON AND NOT IN THE WEBHOOKS. A stage
// transition must never itself send a message, and the send path must never be
// asked to think about campaigns. So the campaign's own pass owns every roster
// transition, reading state that already exists:
//   * an enrollment EXITED with reason 'replied'  -> they answered. Cancel-then-move.
//   * an enrollment COMPLETED                     -> the sequence ran out. Silent move.
// The inbound webhooks already cancel-then-move on reply (exitEnrollment first,
// bounce second) for any lead in a bounce role, and `reignition` is now one of
// them, so a reply is handled instantly; this pass is the reconciler and the
// safety net for the case where the instant path could not finish.

import { resolveAgentActor } from "./agent/_auth.js";
import { enrollContact } from "./automations.js";
import { routeTransition } from "./agent/_router.js";
import { moveStage, createOpp, findOpenOpp, resolveStage, pipelineFlags } from "./agent/_store.js";
import { pickGhlToken, ghl } from "./ghl/_core.js";
import { resolvePresetKey } from "./agent/preset-master.js";
import { PRESETS } from "./agent/presets.js";
import { stampReignitionStage } from "./agent/reignition-station.js";
import { contactsReadTable } from "./_contacts.js";
import {
  DEFAULT_PER_DAY, automationKeyFor, validateCampaignDraft, buildDryRun,
  planAdmissions, runAdmission, runReplyExit, runRanOutExit,
  startOfDayIso, rosterProgress, assertStepsCancelled,
} from "./agent/reignition.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CAMPAIGN_CAP = 25;   // campaigns touched per cron pass

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const nowIso = () => new Date().toISOString();
const enc = encodeURIComponent;

// PostgREST `in.(...)` takes a comma-separated list, and a raw value carrying a
// comma, a quote, a parenthesis or a backslash silently reshapes the FILTER.
// Quoting handles those. It does NOT handle `&` or `#`, which reshape the URL
// itself - `&` starts a new query parameter and `#` truncates everything after it
// - so the assembled list is URL-encoded too.
//
// Every one of those cases already failed closed (PostgREST 400s, sb() throws) so
// none of them could message the wrong person. The reason to fix it is quieter:
// the throw was caught into an error counter, so a single malformed contact id
// stalled that campaign's admissions on every pass, forever, with nothing on
// screen explaining why.
const pgList = (values) =>
  encodeURIComponent((values || []).map((v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(","));

// A paste of contact ids is user input with no natural ceiling, and a long enough
// one 414s the whole request rather than failing on one row. loadRoster already
// caps at 5000; this matches it at the other end.
const MAX_ROSTER_ADD = 2000;

// ── the tier gate ────────────────────────────────────────────────────────────
// Reignition is V2 + pipeline_provider='portal', ONLY, and this is the check -
// there was previously a comment asserting it and nothing enforcing it.
//
// It is not a nicety. Every rail except `in_pipeline` reads a portal table that a
// GHL-provider academy also has, so on such an academy the rails would look like
// they ran: `loadCandidates` would find zero open opportunities in a table nobody
// writes to, conclude that nobody is in the pipeline, and admit a lead who is
// mid-conversation with the booking agent - and the campaign texts would still
// send, because sending never depended on the card. So this is the one gate whose
// absence could message somebody who should have been excluded.
//
// Fails CLOSED: pipelineFlags already answers 'ghl' on any error, and an
// unreadable clients row answers not-V2.
async function portalGate(clientId) {
  let v2 = false;
  try {
    const rows = await sb(`clients?id=eq.${enc(clientId)}&select=v2_access&limit=1`);
    v2 = !!(Array.isArray(rows) && rows[0] && rows[0].v2_access);
  } catch (_) { return { ok: false, reason: "could not read the academy's tier" }; }
  if (!v2) return { ok: false, reason: "reignition is V2 only, and this academy is not on V2" };
  let provider = "ghl";
  try { ({ provider } = await pipelineFlags(clientId)); } catch (_) { return { ok: false, reason: "could not read the academy's pipeline provider" }; }
  if (provider !== "portal") {
    return { ok: false, reason: `this academy's pipeline still lives in GHL (pipeline_provider='${provider}'). Reignition reads and writes the portal board, so its rails cannot see who is already being worked.` };
  }
  return { ok: true };
}

// ── candidate screening data ─────────────────────────────────────────────────
// Loads the facts the rails need for a batch of contacts. Every field is loaded
// EXPLICITLY and defaults to the excluding value, because screenCandidate fails
// closed on anything that is not a definite boolean false: a lookup that errors
// must exclude the person, not wave them through.
async function loadCandidates(clientId, contactIds, campaignId = null, campaign = null) {
  const ids = [...new Set((contactIds || []).map((x) => String(x)).filter(Boolean))];
  if (!ids.length) return [];
  const inList = pgList(ids);

  const table = await contactsReadTable(clientId);
  const contacts = (await sb(`${table}?client_id=eq.${enc(clientId)}&ghl_contact_id=in.(${inList})&select=ghl_contact_id,name,athlete_name,email,phone,dnd`)) || [];
  const byId = new Map(contacts.map((c) => [String(c.ghl_contact_id), c]));

  // Current members (the roster rule: live / paused / payment_failed / cancelling).
  const members = (await sb(`members?client_id=eq.${enc(clientId)}&ghl_contact_id=in.(${inList})&status=in.(live,paused,payment_failed,cancelling)&select=ghl_contact_id`)) || [];
  const memberIds = new Set(members.map((m) => String(m.ghl_contact_id)));

  // Anyone already live in a pipeline stage - any OPEN opportunity, any stage.
  // entry_point rides along so the rail can tell a card THIS campaign created
  // (a half-finished admission of our own) from somebody genuinely being worked.
  const opps = (await sb(`opportunities?client_id=eq.${enc(clientId)}&status=eq.open&ghl_contact_id=in.(${inList})&select=ghl_contact_id,stage_role,entry_point`)) || [];
  const oppRole = new Map(opps.map((o) => [String(o.ghl_contact_id), o.stage_role || "open"]));
  const oppEntry = new Map(opps.map((o) => [String(o.ghl_contact_id), o.entry_point || null]));

  // Unsubscribed / complained / hard-bounced. email_suppressions is keyed by
  // address, so this is a second lookup on the addresses we just resolved.
  const emails = [...new Set(contacts.map((c) => String(c.email || "").trim().toLowerCase()).filter(Boolean))];
  const suppressed = new Set();
  if (emails.length) {
    const rows = (await sb(`email_suppressions?email=in.(${pgList(emails)})&select=email`)) || [];
    for (const r of rows) suppressed.add(String(r.email || "").toLowerCase());
  }

  // Already on THIS campaign (repeat visitors across campaigns are fine).
  const onCampaign = new Set();
  if (campaignId) {
    const rows = (await sb(`ignition_roster?campaign_id=eq.${enc(campaignId)}&select=contact_id`)) || [];
    for (const r of rows) onCampaign.add(String(r.contact_id));
  }

  // Already REPLIED to this campaign. Two independent sources, because either one
  // alone has a gap: the roster row is our own bookkeeping (and the reachable bug
  // here is precisely a roster write that did not land), and the enrolment is the
  // engine's record (which a re-enrolment would eventually blur). Whichever says
  // "they answered" wins - this is the promise that nobody gets a campaign step
  // after replying, so it errs towards not messaging.
  //
  // THESE READS DELIBERATELY HAVE NO CATCH, and that is the fix for a real bug
  // rather than an oversight. They used to be wrapped in a try/catch that, on a
  // failure, marked EVERY id in the batch as replied - reasoning that a pass which
  // admits nobody is recoverable while texting somebody who already answered is
  // not. The first half of that was false. `replied_on_campaign` raises the
  // `already_replied` rail, `runAdmit` treats every rail as TERMINAL, and there is
  // no un-exclude path (`add-roster` requires a draft campaign), so one transient
  // Supabase blip permanently wrote off up to `per_day` people - 15 by default,
  // 200 at most - with a stated reason that was untrue of every one of them.
  //
  // Letting a throw propagate is what the five sibling lookups above already do:
  // it lands in runAdmit's per-campaign catch, increments `line.errors`, and
  // touches NOBODY. That is fail-closed in the sense the old comment intended -
  // nobody is messaged - without converting a read failure into permanent damage
  // to a real person's roster row. Do not "harden" this by adding a catch back.
  const replied = new Set();
  if (campaign) {
    const roster = (await sb(`ignition_roster?campaign_id=eq.${enc(campaign.id)}&state=eq.replied&select=contact_id`)) || [];
    for (const r of roster) replied.add(String(r.contact_id));
    const autos = await sb(`automations?client_id=eq.${enc(clientId)}&automation_key=eq.${enc(campaign.automation_key)}&select=id&limit=1`);
    const auto = Array.isArray(autos) && autos[0];
    if (auto) {
      const enrs = (await sb(`automation_enrollments?client_id=eq.${enc(clientId)}&automation_id=eq.${auto.id}&status=eq.exited&contact_id=in.(${inList})&select=contact_id,exit_reason`)) || [];
      for (const e of enrs) if (/repl/i.test(String(e.exit_reason || ""))) replied.add(String(e.contact_id));
    }
  }

  return ids.map((id) => {
    const c = byId.get(id) || null;
    const email = c && c.email ? String(c.email).trim().toLowerCase() : "";
    return {
      contact_id: id,
      name: (c && (c.name || c.athlete_name)) || null,
      email: c ? c.email : null,
      phone: c ? c.phone : null,
      // A contact we could not read at all leaves dnd undefined, which excludes.
      dnd: c ? c.dnd === true : undefined,
      is_member: memberIds.has(id),
      open_stage_role: oppRole.has(id) ? oppRole.get(id) : null,
      open_entry_point: oppEntry.has(id) ? oppEntry.get(id) : null,
      email_suppressed: c ? (email ? suppressed.has(email) : false) : undefined,
      already_on_campaign: onCampaign.has(id),
      replied_on_campaign: replied.has(id),
    };
  });
}

// Campaigns are addressed by id OR slug. A slug is lowercase letters, digits and
// hyphens, so a 36-character one can look EXACTLY like a uuid - and the old
// hex-and-hyphen test then sent it down the id branch and 404'd a campaign that
// exists. Try the strict uuid shape first, then always fall back to slug, so an
// ambiguous string resolves either way instead of neither.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function loadCampaign(clientId, idOrSlug) {
  const key = String(idOrSlug || "");
  if (!key) return null;
  if (UUID_RE.test(key)) {
    const byId = await sb(`ignition_campaigns?client_id=eq.${enc(clientId)}&id=eq.${enc(key)}&select=*&limit=1`);
    if (Array.isArray(byId) && byId[0]) return byId[0];
  }
  const rows = await sb(`ignition_campaigns?client_id=eq.${enc(clientId)}&slug=eq.${enc(key)}&select=*&limit=1`);
  return (Array.isArray(rows) && rows[0]) || null;
}

const loadRoster = (campaignId, filter = "") =>
  sb(`ignition_roster?campaign_id=eq.${enc(campaignId)}${filter}&order=created_at.asc&select=*&limit=5000`).then((r) => (Array.isArray(r) ? r : []));

// ── staff actions ────────────────────────────────────────────────────────────
async function handlePost(req, res) {
  const actor = await resolveAgentActor(req);
  if (!actor) return res.status(401).json({ error: "sign in required" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const clientId = b.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!actor.canActOn(clientId)) return res.status(403).json({ error: "not your academy" });
  // Building a campaign is a STAFF surface (design: the owner's tile is a window,
  // not a control). Reads are open to the academy; writes are not.
  const READ_ONLY = ["list", "get", "dry-run"];
  if (!READ_ONLY.includes(b.action) && !actor.isStaff) return res.status(403).json({ error: "staff only" });

  if (b.action === "list") {
    const rows = (await sb(`ignition_campaigns?client_id=eq.${enc(clientId)}&order=created_at.desc&select=*`)) || [];
    return res.status(200).json({ campaigns: rows });
  }

  if (b.action === "get") {
    const c = await loadCampaign(clientId, b.campaign || b.slug);
    if (!c) return res.status(404).json({ error: "no such campaign" });
    const roster = await loadRoster(c.id);
    // "On step N / next on Thu" is read LIVE from the automation engine, never
    // from a column on the roster: the engine owns which step a person is on and
    // when the next one fires, and a copy would drift the first time a step was
    // skipped, deferred for quiet hours, or retried.
    const autos = await sb(`automations?client_id=eq.${enc(clientId)}&automation_key=eq.${enc(c.automation_key)}&select=id&limit=1`);
    const auto = Array.isArray(autos) && autos[0];
    let enrollments = [], steps = [], nextJobByEnrollment = {};
    if (auto) {
      steps = (await sb(`automation_steps?automation_id=eq.${auto.id}&enabled=eq.true&order=position.asc&select=id,position,channel`)) || [];
      // Newest first, so that when a contact holds more than one enrolment (a
      // re-admission leaves the old exited row behind) rosterProgress breaks its
      // tie deterministically instead of last-row-wins over an unordered read.
      enrollments = (await sb(`automation_enrollments?client_id=eq.${enc(clientId)}&automation_id=eq.${auto.id}&order=entered_at.desc&select=id,contact_id,current_position,status,entered_at&limit=5000`)) || [];
      const jobs = (await sb(`automation_jobs?client_id=eq.${enc(clientId)}&automation_id=eq.${auto.id}&status=eq.pending&order=run_after.asc&select=enrollment_id,run_after&limit=5000`)) || [];
      for (const j of jobs) if (j.enrollment_id && !nextJobByEnrollment[j.enrollment_id]) nextJobByEnrollment[j.enrollment_id] = j.run_after;
    }
    return res.status(200).json({ campaign: c, roster: rosterProgress({ roster, enrollments, steps, nextJobByEnrollment }) });
  }

  // CREATE a draft. Nothing sends in draft, ever. This also creates the campaign's
  // automation row - dormant (approved:false), with no steps: the messages are
  // written fresh for every campaign through the ordinary step builder, which is
  // what puts them through the ordinary render + review.
  if (b.action === "create") {
    const draft = {
      slug: String(b.slug || "").trim(),
      name: String(b.name || "").trim(),
      consent_basis: b.consent_basis,
      per_day: b.per_day == null ? DEFAULT_PER_DAY : Number(b.per_day),
      channels: Array.isArray(b.channels) && b.channels.length ? b.channels : ["sms"],
    };
    const problems = validateCampaignDraft(draft);
    if (problems.length) return res.status(400).json({ error: "campaign draft refused", problems });

    const gate = await portalGate(clientId);
    if (!gate.ok) return res.status(400).json({ error: "reignition is not available for this academy", problems: [gate.reason] });

    const automation_key = automationKeyFor(draft.slug);

    // ORDER MATTERS, and it used to be the other way round.
    // The automations upsert is merge-duplicates on (client_id, automation_key)
    // and it sets approved:false. So creating a campaign whose slug collided with
    // a RUNNING one used to land that write first, de-approve the live campaign's
    // automation, and the next worker pass then cancelled every admitted person's
    // remaining steps - a mid-flight campaign killed by a typo in a new one. The
    // campaign row goes in FIRST now, so the unique constraint refuses the
    // duplicate before anything touches a live automation.
    const clash = await loadCampaign(clientId, draft.slug);
    if (clash) return res.status(409).json({ error: `a campaign with slug '${draft.slug}' already exists (state '${clash.state}'). Pick another slug.` });

    let campaign;
    try {
      const ins = await sb(`ignition_campaigns`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ client_id: clientId, slug: draft.slug, name: draft.name, state: "draft",
          per_day: draft.per_day, consent_basis: String(draft.consent_basis).trim(), automation_key,
          channels: draft.channels, offer_id: b.offer_id || null, created_by: actor.email, updated_at: nowIso() }]),
      });
      campaign = Array.isArray(ins) && ins[0];
    } catch (e) {
      // Includes the unique-constraint race two staff hitting create at once.
      return res.status(409).json({ error: `could not create campaign '${draft.slug}': ${e.message}` });
    }
    if (!campaign) return res.status(500).json({ error: "campaign insert returned nothing" });

    // Only now the automation. If THIS fails, roll the campaign row back: leaving
    // it would burn the slug permanently on a campaign that can never send (there
    // is no delete action, and create would keep 409ing on the same name).
    try {
      await sb(`automations?on_conflict=client_id,automation_key`, {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ client_id: clientId, automation_key, name: `Reignition: ${draft.name}`, enabled: true, approved: false, offer_id: b.offer_id || null, updated_at: nowIso() }]),
      });
    } catch (e) {
      try { await sb(`ignition_campaigns?id=eq.${campaign.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (_) { /* best-effort */ }
      return res.status(500).json({ error: `could not create the campaign's automation, so the campaign was rolled back - the slug '${draft.slug}' is free to reuse: ${e.message}` });
    }
    return res.status(200).json({ ok: true, campaign, automation_key });
  }

  // ADD people. Staff picks them by hand; tags and filters help BUILD the list
  // upstream but never enrol anybody. Everyone is screened here and the refusals
  // come back with their reasons - there is no force flag.
  if (b.action === "add-roster") {
    const c = await loadCampaign(clientId, b.campaign || b.slug);
    if (!c) return res.status(404).json({ error: "no such campaign" });
    if (c.state !== "draft") return res.status(400).json({ error: `campaign is '${c.state}'; the roster is built in draft` });
    const asked = Array.isArray(b.contact_ids) ? b.contact_ids : [];
    if (asked.length > MAX_ROSTER_ADD) {
      return res.status(400).json({ error: `${asked.length} contacts in one call; add at most ${MAX_ROSTER_ADD} at a time (a longer list overflows the request URL and fails as a whole).` });
    }
    const candidates = await loadCandidates(clientId, asked, c.id, c);
    const dry = buildDryRun({ campaign: c, candidates });
    if (dry.roster.length) {
      await sb(`ignition_roster?on_conflict=campaign_id,contact_id`, {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(dry.roster.map((r) => ({ campaign_id: c.id, client_id: clientId, contact_id: r.contact_id, contact_name: r.name, state: "queued", updated_at: nowIso() }))),
      });
    }
    return res.status(200).json({ ok: true, added: dry.roster.length, excluded: dry.excluded });
  }

  // THE GATE. The exact roster, the count, and everyone the rails removed with the
  // reason - re-screened against today's data, not the data at add time. Sends
  // nothing. The consent basis rides along because the approver has to read it.
  if (b.action === "dry-run") {
    const c = await loadCampaign(clientId, b.campaign || b.slug);
    if (!c) return res.status(404).json({ error: "no such campaign" });
    const roster = await loadRoster(c.id);
    const candidates = await loadCandidates(clientId, roster.map((r) => r.contact_id), null, c);
    const dry = buildDryRun({ campaign: c, candidates });
    // The campaign cannot send a thing without at least one enabled step.
    const autos = await sb(`automations?client_id=eq.${enc(clientId)}&automation_key=eq.${enc(c.automation_key)}&select=id&limit=1`);
    const auto = Array.isArray(autos) && autos[0];
    const steps = auto ? (await sb(`automation_steps?automation_id=eq.${auto.id}&enabled=eq.true&select=id`)) || [] : [];
    if (!steps.length) dry.problems.push(`the campaign's automation '${c.automation_key}' has no enabled steps - write the messages first.`);
    dry.approvable = dry.problems.length === 0 && dry.roster.length > 0;
    dry.steps = steps.length;
    return res.status(200).json({ dry_run: dry });
  }

  // APPROVE. Re-runs the whole gate server-side (a client that skipped the dry run
  // gets the same refusals), stamps the stage on first use, turns the campaign's
  // automation on, and moves the campaign to `approved` so the cron may admit.
  if (b.action === "approve") {
    const c = await loadCampaign(clientId, b.campaign || b.slug);
    if (!c) return res.status(404).json({ error: "no such campaign" });
    if (c.state !== "draft") return res.status(400).json({ error: `campaign is '${c.state}'; only a draft is approved` });
    const gate = await portalGate(clientId);
    if (!gate.ok) return res.status(400).json({ error: "reignition is not available for this academy", problems: [gate.reason] });
    const roster = await loadRoster(c.id);
    const candidates = await loadCandidates(clientId, roster.map((r) => r.contact_id), null, c);
    const dry = buildDryRun({ campaign: c, candidates });
    const autos = await sb(`automations?client_id=eq.${enc(clientId)}&automation_key=eq.${enc(c.automation_key)}&select=id&limit=1`);
    const auto = Array.isArray(autos) && autos[0];
    const steps = auto ? (await sb(`automation_steps?automation_id=eq.${auto.id}&enabled=eq.true&select=id`)) || [] : [];
    if (!steps.length) dry.problems.push(`the campaign's automation '${c.automation_key}' has no enabled steps.`);
    if (dry.problems.length || !dry.roster.length) return res.status(400).json({ error: "approval refused", problems: dry.problems.length ? dry.problems : ["the roster is empty."], dry_run: dry });

    // Stamp the stage on FIRST USE, through the same idempotent (client_id, role)
    // upsert applyPreset uses. Re-approving another campaign rewrites the same row.
    const presetKey = await resolvePresetKey(clientId, { sb });
    await stampReignitionStage({ clientId, offerId: c.offer_id || null, presetKey, preset: presetKey ? PRESETS[presetKey] : null, sb, log: () => {} });

    await sb(`automations?id=eq.${auto.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ enabled: true, approved: true, updated_at: nowIso() }) });
    // WHO approved this is recorded, not just WHEN. Staff approval is the entire
    // gate on messaging several hundred people who never asked to hear from us;
    // an approval nobody's name is on is not a gate.
    const upd = await sb(`ignition_campaigns?id=eq.${c.id}`, { method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ state: "approved", approved_by: actor.email, approved_at: nowIso(), updated_at: nowIso() }) });
    return res.status(200).json({ ok: true, campaign: Array.isArray(upd) && upd[0], approved: dry.count, approved_by: actor.email });
  }

  // HALT. Whoever has not been reached is simply never reached - the queued rows
  // are marked and nothing was ever queued for them, so nothing has to be
  // cancelled. People already mid-sequence keep their own conversation: yanking a
  // live thread is not what "stop the campaign" means.
  if (b.action === "halt") {
    const c = await loadCampaign(clientId, b.campaign || b.slug);
    if (!c) return res.status(404).json({ error: "no such campaign" });
    await sb(`ignition_campaigns?id=eq.${c.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ state: "halted", halted_at: nowIso(), updated_at: nowIso() }) });
    const upd = await sb(`ignition_roster?campaign_id=eq.${c.id}&state=eq.queued`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "halted", updated_at: nowIso() }) });
    return res.status(200).json({ ok: true, never_reached: Array.isArray(upd) ? upd.length : 0 });
  }

  return res.status(400).json({ error: "unknown action" });
}

// ── the cron: admit today's people, then reconcile ───────────────────────────
async function runAdmit(res) {
  _creds = new Map();
  _tz = new Map();
  let campaigns = [];
  try {
    campaigns = (await sb(`ignition_campaigns?state=in.(approved,running)&order=created_at.asc&limit=${CAMPAIGN_CAP}&select=*`)) || [];
  } catch (e) { return res.status(500).json({ error: `load campaigns: ${e.message}` }); }

  const out = [];
  for (const c of campaigns) {
    const line = { campaign: c.slug, admitted: 0, excluded: 0, replied: 0, ran_out: 0, not_admitted: 0, errors: 0 };
    try {
      // Reconcile FIRST, so people who left overnight free nothing up but also do
      // not sit in the roster looking live.
      //
      // It runs BEFORE the tier gate and regardless of it, deliberately. The gate
      // stops us STARTING anything new; it must not stop us finishing what is
      // already in flight. An academy flipped back to GHL mid-campaign otherwise
      // leaves everybody frozen at `admitted` forever - replies never handed over,
      // silence never rolled into the long game.
      Object.assign(line, await reconcile(c));

      // The tier gate, per pass, on ADMISSION only. A campaign approved while an
      // academy was on the portal board must stop admitting the moment it moves
      // back to GHL, because from then on the rails cannot see who is being worked.
      const gate = await portalGate(c.client_id);
      if (!gate.ok) { line.skipped = gate.reason; out.push(line); continue; }

      const roster = await loadRoster(c.id, "&state=eq.queued");
      // THE DAY, not a rolling 24 hours. A fixed-time cron against a rolling
      // window sees yesterday's run still inside it and admits nobody - forever.
      const tz = await academyTz(c.client_id);
      const since = startOfDayIso(new Date(), tz);
      const admittedToday = ((await sb(`ignition_roster?campaign_id=eq.${enc(c.id)}&admitted_at=gte.${since}&select=id`)) || []).length;
      const plan = planAdmissions({ campaign: c, roster, admittedToday });

      if (plan.admit.length) {
        const candidates = await loadCandidates(c.client_id, plan.admit.map((r) => r.contact_id), null, c);
        const byId = new Map(candidates.map((x) => [x.contact_id, x]));
        const creds = await credsFor(c.client_id);
        for (const row of plan.admit) {
          try {
            const r = await runAdmission(
              { clientId: c.client_id, contactId: row.contact_id, campaign: c, candidate: byId.get(String(row.contact_id)) || {} },
              {
                // MAKE the card exist. Everyone who reaches here has NO open
                // opportunity - the in_pipeline rail excluded everyone who did -
                // so there is nothing to find and one has to be created, exactly
                // as the form door (api/website/leads.js) and the calendar door
                // do. Silent: creating a card sends nothing. Only the enrolment
                // below makes a message happen, through the ordinary worker.
                placeCard: async ({ clientId, contactId, toRole, reason }) => {
                  try {
                    const stage = await resolveStage(sb, ghl, { clientId, token: creds && creds.token, locationId: creds && creds.locationId, role: toRole });
                    if (!stage) return { ok: false, error: `no '${toRole}' stage resolved for this academy` };
                    const existing = await openOppFor(clientId, creds, contactId);
                    if (existing) {
                      await moveStage({ clientId, sb, ghl, token: creds && creds.token, oppRef: existing, stage, role: toRole, contactId, reason });
                      return { ok: true, role: toRole, oppRef: existing, created: false };
                    }
                    const cand = byId.get(String(contactId)) || {};
                    const ref = await createOpp({
                      clientId, sb, ghl, token: creds && creds.token, locationId: creds && creds.locationId,
                      contactId, stage, role: toRole, offerId: c.offer_id || null,
                      name: cand.name || null, contactName: cand.name || null, contactPhone: cand.phone || null,
                      source: "reignition", entryPoint: `ignition:${c.slug}`,
                    });
                    if (!ref || (!ref.id && !ref.ghlOpportunityId)) return { ok: false, error: "createOpp returned no card" };
                    return { ok: true, role: toRole, oppRef: ref, created: true };
                  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
                },
                enrol: ({ clientId, contactId, automationKey }) => enrollContact({ clientId, automationKey, contactId }),

                // Does this enrolment actually have a step job? ANY status counts:
                // job rows are never deleted, so one existing proves step 1 was
                // scheduled, and asking for `pending` alone would race a worker
                // that has already sent it.
                hasScheduledStep: async ({ enrollmentId }) => {
                  const rows = await sb(`automation_jobs?enrollment_id=eq.${enc(enrollmentId)}&select=id&limit=1`);
                  return Array.isArray(rows) && rows.length > 0;
                },

                // An active enrolment that can never produce a job is a dead end -
                // enrollContact will keep answering "already enrolled" forever.
                // Retiring it lets the next pass enrol cleanly.
                retireStalledEnrolment: async ({ enrollmentId }) => {
                  await sb(`automation_enrollments?id=eq.${enc(enrollmentId)}`, {
                    method: "PATCH", headers: { Prefer: "return=minimal" },
                    body: JSON.stringify({ status: "exited", exited_at: nowIso(), exit_reason: "reignition: enrolment had no scheduled step - retired so it can be re-enrolled" }),
                  });
                },
              }
            );
            // THE THREE OUTCOMES, all handled. Anything else is a bug.
            if (r.admitted) {
              await sb(`ignition_roster?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
                body: JSON.stringify({ state: "admitted", admitted_at: nowIso(), enrollment_id: r.enrollment_id, updated_at: nowIso() }) });
              line.admitted++;
            } else if (r.rail) {
              // A RAIL refused them at enrol time - days after the dry run, a
              // person can have become a member, entered the pipeline or opted out.
              // Terminal, and the reason is true.
              await sb(`ignition_roster?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
                body: JSON.stringify({ state: "excluded", excluded_reason: r.reason, updated_at: nowIso() }) });
              line.excluded++;
            } else {
              // A FAILURE on our side (no card, or the automation would not enrol
              // them). NOT an exclusion: the person is fine, nothing was sent, and
              // writing them off would tell staff we refused somebody we did not.
              // Leave the row QUEUED so the next pass retries - which reuses the
              // card if one was already created - and make it visible.
              console.error(`[reignition] '${c.slug}' NOT admitted ${row.contact_id} (${r.code}): ${r.detail || r.reason}`);
              line.not_admitted++;
            }
          } catch (_) { line.errors++; }
        }
      }

      if (c.state === "approved" && line.admitted > 0) {
        await sb(`ignition_campaigns?id=eq.${c.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ state: "running", started_at: c.started_at || nowIso(), updated_at: nowIso() }) });
      }
      // Done when nothing is left in flight.
      const live = (await sb(`ignition_roster?campaign_id=eq.${enc(c.id)}&state=in.(queued,admitted)&select=id&limit=1`)) || [];
      if (!live.length && c.state !== "halted") {
        await sb(`ignition_campaigns?id=eq.${c.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ state: "done", completed_at: nowIso(), updated_at: nowIso() }) });
      }
    } catch (e) { line.errors++; line.error = String(e.message || e).slice(0, 200); }
    out.push(line);
  }
  return res.status(200).json({ ok: true, campaigns: out });
}

// Read the enrollment each admitted person is on and act on what already happened.
// This is the ONLY place a roster row changes state after admission, so there is
// one story about who is where.
async function reconcile(c) {
  const stats = { replied: 0, ran_out: 0 };
  const autos = await sb(`automations?client_id=eq.${enc(c.client_id)}&automation_key=eq.${enc(c.automation_key)}&select=id&limit=1`);
  const auto = Array.isArray(autos) && autos[0];
  if (!auto) return stats;

  const rows = await loadRoster(c.id, "&state=eq.admitted");
  if (!rows.length) return stats;
  const creds = await credsFor(c.client_id);
  // Which automation does the ran-out destination run? The station's validation
  // guarantees that stage's engine IS an automation (or that the exit is a
  // terminal), so this is a lookup, not a guess - and it is read from the sales
  // system the academy actually runs, never hardcoded to 'nurture'.
  const presetKey = await resolvePresetKey(c.client_id, { sb });
  const engineKeyFor = (role) => {
    const p = presetKey ? PRESETS[presetKey] : null;
    const s = p && (p.stages || []).find((x) => x.role === role);
    return s && s.engine && s.engine.kind === "automation" ? s.engine.key : null;
  };

  for (const row of rows) {
    try {
      const enr = await sb(`automation_enrollments?client_id=eq.${enc(c.client_id)}&automation_id=eq.${auto.id}&contact_id=eq.${enc(String(row.contact_id))}&order=entered_at.desc&select=status,exit_reason,current_position&limit=1`);
      const e = Array.isArray(enr) && enr[0];
      if (!e || e.status === "active") continue;

      const replied = e.status === "exited" && /repl/i.test(String(e.exit_reason || ""));
      const deps = {
        // Cancel, and PROVE it. The generic exitEnrollment swallows its own
        // per-enrollment errors and always answers {ok:true}, so a job-cancel
        // PATCH that matched nothing would report success and the queued step
        // would still fire - which would make "a failed cancel aborts the move"
        // a comment rather than a guarantee. This cancels the jobs, RE-READS
        // them, and throws if any are still live; the throw is what stops
        // runReplyExit before the card moves. Idempotent: the inbound webhook
        // usually got there first, in which case there is nothing left to cancel.
        cancelUnsentSteps: async ({ clientId, contactId }) => {
          const enrs = (await sb(`automation_enrollments?client_id=eq.${enc(clientId)}&automation_id=eq.${auto.id}&contact_id=eq.${enc(String(contactId))}&select=id,status`)) || [];
          for (const en of enrs) {
            await sb(`automation_jobs?enrollment_id=eq.${en.id}&status=in.(pending,sending)`, {
              method: "PATCH", headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ status: "canceled", last_error: "replied - reignition campaign ended for them" }),
            });
          }
          for (const en of enrs) {
            const left = (await sb(`automation_jobs?enrollment_id=eq.${en.id}&status=in.(pending,sending)&select=id,status`)) || [];
            assertStepsCancelled(left);   // THROWS, and the throw aborts the move
            if (en.status === "active") {
              await sb(`automation_enrollments?id=eq.${en.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
                body: JSON.stringify({ status: "exited", exited_at: nowIso(), exit_reason: "replied - reignition campaign ended for them" }) });
            }
          }
          return { ok: true, enrollments: enrs.length };
        },
        moveCard: async ({ clientId, contactId, fromRole, trigger }) => {
          if (!creds) return null;
          const oppRef = await openOppFor(clientId, creds, contactId);
          if (!oppRef) return null;
          // ONLY move a card that is STILL in Reignition. This pass is a
          // reconciler: the instant path (the inbound webhook) usually moved them
          // already, and in the meantime the lead may have booked, converted, or
          // been closed. Re-running the exit blind would yank a booked lead out of
          // Scheduled Trial and hand them back to the booking agent.
          const cur = await currentRole(clientId, contactId);
          if (cur && cur !== fromRole) return { role: cur, already_moved: true };
          const r = await routeTransition({ clientId, sb, ghl, token: creds.token, locationId: creds.locationId, fromRole, trigger, contactId, oppRef, allowTerminal: true, reason: `reignition campaign '${c.slug}' ${trigger}` });
          return r && r.matched ? { role: r.role || null, terminal: r.terminal || null } : null;
        },
        // The destination's engine speaks - at ITS step one, on ITS own clock,
        // which is the quiet gap between the campaign's last word and nurture's
        // first. The transition itself sends nothing.
        enrolDestination: ({ clientId, contactId, role }) => {
          const key = engineKeyFor(role);
          return key ? enrollContact({ clientId, automationKey: key, contactId }) : { skipped: "destination has no automation engine" };
        },
      };

      if (replied) {
        await runReplyExit({ clientId: c.client_id, contactId: String(row.contact_id), automationKey: c.automation_key }, deps);
        await sb(`ignition_roster?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ state: "replied", updated_at: nowIso() }) });
        stats.replied++;
      } else if (e.status === "completed") {
        await runRanOutExit({ clientId: c.client_id, contactId: String(row.contact_id) }, deps);
        await sb(`ignition_roster?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ state: "ran_out", updated_at: nowIso() }) });
        stats.ran_out++;
      }
    } catch (e) {
      // One person's reconcile never stops the pass - but it is NOT swallowed.
      // The abort-on-failed-cancel lands here, and a cancel that keeps failing is
      // a lead whose card is stuck in Reignition with live steps behind it. The
      // roster row stays `admitted`, so the next pass retries; this is the only
      // way anybody finds out it needed to.
      console.error(`[reignition] reconcile failed for contact ${row.contact_id} on '${c.slug}' (row stays admitted, will retry): ${e.message || e}`);
    }
  }
  return stats;
}

// ── small shared lookups ─────────────────────────────────────────────────────
// Scoped to ONE cron pass (cleared in runAdmit), never module-lifetime: a warm
// lambda that cached a GHL token would keep serving it past its refresh.
let _creds = new Map();
async function credsFor(clientId) {
  if (_creds.has(clientId)) return _creds.get(clientId);
  let out = null;
  try {
    const rows = await sb(`clients?id=eq.${enc(clientId)}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
    const client = Array.isArray(rows) && rows[0];
    out = client ? await pickGhlToken(client) : null;
  } catch (_) { out = null; }
  _creds.set(clientId, out);
  return out;
}
// Which stage is this lead's open card in right now? Portal-store only, which is
// the correct scope: reignition is V2 / pipeline_provider='portal'. A null answer
// (GHL-provider academy, or no open card) is treated as "cannot contradict", so
// the reconciler falls back to the router's own edge resolution.
async function currentRole(clientId, contactId) {
  try {
    const rows = await sb(`opportunities?client_id=eq.${enc(clientId)}&ghl_contact_id=eq.${enc(String(contactId))}&status=eq.open&select=stage_role&order=created_at.desc&limit=1`);
    return (Array.isArray(rows) && rows[0] && rows[0].stage_role) || null;
  } catch (_) { return null; }
}
// The academy's own timezone, which is the day "fifteen a day" is counted in.
let _tz = new Map();
async function academyTz(clientId) {
  if (_tz.has(clientId)) return _tz.get(clientId);
  let tz = "UTC";
  try {
    const rows = await sb(`clients?id=eq.${enc(clientId)}&select=time_zone&limit=1`);
    tz = (Array.isArray(rows) && rows[0] && rows[0].time_zone) || "UTC";
  } catch (_) { tz = "UTC"; }
  _tz.set(clientId, tz);
  return tz;
}
async function openOppFor(clientId, creds, contactId) {
  try { return await findOpenOpp({ clientId, sb, ghl, token: creds && creds.token, locationId: creds && creds.locationId, contactId }); }
  catch (_) { return null; }
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
  if (req.method === "GET" && req.query.action === "admit") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    return await runAdmit(res);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try { return await handlePost(req, res); }
  catch (e) { console.error("[reignition]", e); return res.status(500).json({ error: e.message || "internal error" }); }
}

export default withSentryApiRoute(handler);
