import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Scheduled Follow-Ups (the nudge engine)
//
//   GET  /api/agent-followups?action=detect   (Bearer CRON_SECRET)
//        → scan each enabled academy for quiet leads, pre-draft the next nudge
//          from the brain, and queue it (status='pending') with a send time.
//   GET  /api/agent-followups?action=work     (Bearer CRON_SECRET)
//        → send every APPROVED follow-up whose time has come (skips any whose
//          lead replied since it was drafted). Approve-each: pending never sends.
//
//   POST /api/agent-followups { action, ... }  (staff bearer)
//     "list"     { client_id? }                 → the timeline (upcoming + recent)
//     "approve"  { id }                         → pending → approved (will auto-send)
//     "skip"     { id }                         → drop it
//     "edit"     { id, message?, goal?, scheduled_at? }
//     "snooze"   { id, hours }                  → push the send time out
//     "send-now" { id }                         → send immediately
//     "detect-now" { client_id? }              → manually run the detector once
//
// Engine is per-academy gated by clients.ghl_kpi_config.followup_engine_enabled.

import { pickGhlToken, ghl } from "./ghl/_core.js";
import { assemblePrompt } from "./agent/prompt-structure.js";
import { buildAgentSystem } from "./agent/brain.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";
const DEFAULT_CLIENT_ID    = "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA

// Candidate window: a lead is "quiet" if OUR last message is older than this…
const MIN_QUIET_HOURS = 12;
// …and we stop chasing leads quiet longer than this.
const MAX_AGE_DAYS    = 14;
const DRAFT_CAP       = 12;   // max new drafts per academy per detector run
const RECENT_SENT_HRS = 20;   // don't re-draft a contact we nudged this recently

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function requireStaff(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` } });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id) return null;
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  return Array.isArray(staff) && staff[0] ? (user.email || "staff") : null;
}

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
  return Array.isArray(rows) && rows[0];
}

// ── brain (same source as the sandbox + approval queue) ──
async function loadConfig(clientId) {
  const [lessons, ovRows, exRows] = await Promise.all([
    sb(`agent_lessons?client_id=eq.${clientId}&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
    sb(`agent_prompt_sections?client_id=eq.${clientId}&select=section_key,body`).catch(() => []),
    sb(`agent_examples?client_id=eq.${clientId}&select=parent_text,agent_text&order=created_at.asc`).catch(() => []),
  ]);
  const overrides = {};
  for (const r of (Array.isArray(ovRows) ? ovRows : [])) overrides[r.section_key] = r.body;
  return { lessons: Array.isArray(lessons) ? lessons : [], overrides, examples: Array.isArray(exRows) ? exRows : [] };
}

function buildFollowupSystem({ lessons, overrides, examples }, quietHours) {
  const trailer = `<followup_scheduling>\n` +
    `A lead went quiet — they have not replied to your last message for about ${quietHours} hour(s). Decide the next SCHEDULED follow-up using YOUR follow-up rules (triggers, timing, and especially "when NOT to").\n` +
    `- If your "when NOT to" rules apply (they firmly said no / already booked / complaint / handed to a human / off-topic), set should_followup=false and stop=true.\n` +
    `- Otherwise set should_followup=true and decide: how many HOURS from now to send it (interpret your timing rules relative to how long they've already been quiet), the EXACT short message to send, and a one-line goal for this nudge.\n` +
    `A human approves your draft before it sends. Respond ONLY by calling schedule_followup.\n</followup_scheduling>`;
  return buildAgentSystem({ lessons, overrides, examples, trailer });
}

const SCHEDULE_TOOL = {
  name: "schedule_followup",
  description: "Decide the next scheduled follow-up for a quiet lead (a human approves before it sends).",
  input_schema: {
    type: "object",
    properties: {
      should_followup: { type: "boolean", description: "True to schedule a follow-up. False if your 'when NOT to' rules say to stop." },
      stop:            { type: "boolean", description: "True if we should STOP following up this lead entirely (firm no, booked, complaint, etc)." },
      send_in_hours:   { type: "number",  description: "Hours from now to send the follow-up, per your timing rules. Whole-ish numbers (e.g. 18, 24, 48)." },
      message:         { type: "string",  description: "The exact short follow-up text to send. Empty if should_followup is false." },
      goal:            { type: "string",  description: "One short line: the goal of this follow-up / where the conversation is (e.g. 'lock Mon 7pm trial')." },
      reason:          { type: "string",  description: "One short line: why now / which trigger applies." },
      confidence:      { type: "number",  description: "0..1 confidence this is the right move." },
    },
    required: ["should_followup", "message"],
  },
};

async function runScheduleAgent(system, transcript) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL, max_tokens: 600, system,
      tools: [SCHEDULE_TOOL], tool_choice: { type: "tool", name: "schedule_followup" },
      messages: [{ role: "user", content: `Here is the conversation so far (oldest first):\n\n${transcript}\n\nDecide the next scheduled follow-up.` }],
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const tool = (data.content || []).find(b => b.type === "tool_use" && b.name === "schedule_followup");
  if (!tool?.input) throw new Error("no schedule decision from Claude");
  return tool.input;
}

// ── GHL thread helpers ──
async function findConversation(token, locationId, contactId) {
  const search = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, contactId })}`, { token });
  return (search.conversations || search.data || [])[0] || null;
}
async function threadMessages(token, conversationId) {
  const data = await ghl("GET", `/conversations/${encodeURIComponent(conversationId)}/messages`, { token });
  const raw = data.messages?.messages || data.messages || data.data || [];
  const msgs = raw.map(m => ({
    text: m.body || m.message || "",
    direction: (m.direction || "").toLowerCase(),
    date: m.dateAdded || m.createdAt || m.timestamp || null,
  })).filter(m => m.text);
  msgs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  return msgs.map(m => ({ role: m.direction === "outbound" ? "agent" : "parent", text: m.text }));
}

const hoursSince = (d) => d ? (Date.now() - new Date(d).getTime()) / 3600000 : Infinity;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ── Detector: find quiet leads, draft the next nudge, queue it ──
async function detectForClient(client) {
  const cfg = client.ghl_kpi_config || {};
  if (!cfg.followup_engine_enabled) return { client_id: client.id, skipped: "engine off" };
  const creds = await pickGhlToken(client);
  if (!creds) return { client_id: client.id, skipped: "no GHL token" };
  const { token, locationId } = creds;

  // Find leads where OUR last message is outbound and stale (they went quiet).
  let convos = [];
  try {
    const cd = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, limit: "100" })}`, { token });
    convos = cd.conversations || cd.data || [];
  } catch (e) { return { client_id: client.id, error: `conversations: ${e.message}` }; }

  const candidates = convos.filter(c => {
    if (String(c.lastMessageDirection || "").toLowerCase() !== "outbound") return false;
    const h = hoursSince(c.lastMessageDate || c.dateUpdated);
    return h >= MIN_QUIET_HOURS && h <= MAX_AGE_DAYS * 24;
  }).slice(0, DRAFT_CAP);

  let drafted = 0, stopped = 0, skipped = 0;
  const cfgBrain = await loadConfig(client.id);

  for (const c of candidates) {
    const contactId = c.contactId;
    if (!contactId) { skipped++; continue; }
    // Skip if an active follow-up already exists, or we nudged recently.
    try {
      const existing = await sb(`agent_followups?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&or=(status.in.(pending,approved),and(status.eq.sent,sent_at.gte.${new Date(Date.now() - RECENT_SENT_HRS * 3600000).toISOString()}))&select=id&limit=1`);
      if (Array.isArray(existing) && existing.length) { skipped++; continue; }
    } catch (_) {}

    let thread;
    try { thread = await threadMessages(token, c.id); } catch (_) { skipped++; continue; }
    if (!thread.length) { skipped++; continue; }
    const transcript = thread.map(m => `${m.role === "agent" ? "You" : "Lead"}: ${m.text}`).join("\n");
    const quietHrs = Math.round(hoursSince(c.lastMessageDate || c.dateUpdated));

    let decision;
    try { decision = await runScheduleAgent(buildFollowupSystem(cfgBrain, quietHrs), transcript); }
    catch (_) { skipped++; continue; }

    if (!decision.should_followup || !decision.message || !String(decision.message).trim()) { stopped++; continue; }
    const sendInH = clamp(Number(decision.send_in_hours) || 24, 1, MAX_AGE_DAYS * 24);
    const scheduledAt = new Date(Date.now() + sendInH * 3600000).toISOString();
    try {
      await sb(`agent_followups`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: c.id,
          contact_name: c.fullName || c.contactName || "Lead",
          goal: decision.goal || null, draft_message: String(decision.message).trim(),
          scheduled_at: scheduledAt, status: "pending",
          trigger_reason: decision.reason || null,
          last_lead_at: c.lastMessageDate || c.dateUpdated || null,
          confidence: typeof decision.confidence === "number" ? decision.confidence : null,
          created_by: "detector",
        }]),
      });
      drafted++;
    } catch (_) { skipped++; }  // unique-violation race etc.
  }
  return { client_id: client.id, business: client.business_name, candidates: candidates.length, drafted, stopped, skipped };
}

async function runDetect(res, onlyClientId) {
  let clients = [];
  try {
    clients = onlyClientId
      ? [await loadClient(onlyClientId)].filter(Boolean)
      : await sb(`clients?select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&or=(v15_access.eq.true,v2_access.eq.true)`);
  } catch (_) {}
  const out = [];
  for (const client of (Array.isArray(clients) ? clients : [])) {
    try { out.push(await detectForClient(client)); }
    catch (e) { out.push({ client_id: client.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, academies: out });
}

// ── Worker: send approved follow-ups whose time has come ──
async function leadRepliedSince(clientId, contactId, sinceISO) {
  try {
    const rows = await sb(`ghl_inbound_messages?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&occurred_at=gt.${sinceISO}&select=id&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) { return false; }
}

async function sendOne(row, clientCache) {
  let client = clientCache[row.client_id];
  if (!client) { client = await loadClient(row.client_id); clientCache[row.client_id] = client; }
  if (!client) return { id: row.id, error: "client gone" };

  // Cancel if the lead replied after this was drafted (belt-and-suspenders with
  // the inbound webhook's cancel hook).
  const since = row.last_lead_at || row.created_at;
  if (since && await leadRepliedSince(row.client_id, row.ghl_contact_id, since)) {
    await sb(`agent_followups?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "lead replied", updated_at: new Date().toISOString() }) });
    return { id: row.id, canceled: "lead replied" };
  }
  const creds = await pickGhlToken(client);
  if (!creds) { await markFailed(row.id, "no GHL token"); return { id: row.id, error: "no token" }; }
  try {
    await ghl("POST", `/conversations/messages`, { token: creds.token, body: { type: "SMS", contactId: row.ghl_contact_id, message: row.draft_message } });
    await sb(`agent_followups?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return { id: row.id, sent: true };
  } catch (e) { await markFailed(row.id, e.message); return { id: row.id, error: e.message }; }
}
async function markFailed(id, msg) {
  try { await sb(`agent_followups?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", send_error: String(msg).slice(0, 400), updated_at: new Date().toISOString() }) }); } catch (_) {}
}

async function runWork(res) {
  let due = [];
  try {
    due = await sb(`agent_followups?status=eq.approved&scheduled_at=lte.${new Date().toISOString()}&select=*&order=scheduled_at.asc&limit=50`);
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const cache = {};
  const out = [];
  for (const row of (Array.isArray(due) ? due : [])) out.push(await sendOne(row, cache));
  return res.status(200).json({ ok: true, processed: out.length, results: out });
}

async function handler(req, res) {
  // Cron endpoints (Vercel sends Bearer CRON_SECRET).
  if (req.method === "GET" && (req.query.action === "detect" || req.query.action === "work")) {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    if (!ANTHROPIC_KEY && req.query.action === "detect") return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return req.query.action === "detect" ? await runDetect(res, null) : await runWork(res);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const staffEmail = await requireStaff(req);
  if (!staffEmail) return res.status(401).json({ error: "staff only" });

  const b = req.body && typeof req.body === "object" ? req.body : {};

  try {
    if (b.action === "list") {
      const clientFilter = b.client_id ? `&client_id=eq.${b.client_id}` : "";
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      // Upcoming (pending/approved) + recent terminal (sent/skipped/canceled/failed in last 7d).
      const rows = await sb(`agent_followups?select=*,clients(business_name)&or=(status.in.(pending,approved),and(status.in.(sent,skipped,canceled,failed),updated_at.gte.${weekAgo}))${clientFilter}&order=scheduled_at.asc&limit=300`);
      const list = (Array.isArray(rows) ? rows : []).map(r => ({ ...r, business_name: r.clients?.business_name || null, clients: undefined }));
      return res.status(200).json({ followups: list });
    }
    if (b.action === "approve") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}&status=eq.pending`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "skip") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped", updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "edit") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = { updated_at: new Date().toISOString() };
      if (typeof b.message === "string" && b.message.trim()) patch.draft_message = b.message.trim();
      if (typeof b.goal === "string") patch.goal = b.goal;
      if (b.scheduled_at) patch.scheduled_at = new Date(b.scheduled_at).toISOString();
      await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "snooze") {
      if (!b.id || !b.hours) return res.status(400).json({ error: "id + hours required" });
      const [row] = await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}&select=scheduled_at`);
      if (!row) return res.status(404).json({ error: "not found" });
      const base = new Date(row.scheduled_at).getTime() || Date.now();
      await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ scheduled_at: new Date(base + Number(b.hours) * 3600000).toISOString(), updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "send-now") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      const [row] = await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}&select=*`);
      if (!row) return res.status(404).json({ error: "not found" });
      if (!["pending", "approved"].includes(row.status)) return res.status(409).json({ error: `already ${row.status}` });
      const r = await sendOne(row, {});
      if (r.error) return res.status(502).json({ error: r.error });
      return res.status(200).json({ ok: true, result: r });
    }
    if (b.action === "detect-now") {
      if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
      return await runDetect(res, b.client_id || DEFAULT_CLIENT_ID);
    }
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-followups]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
