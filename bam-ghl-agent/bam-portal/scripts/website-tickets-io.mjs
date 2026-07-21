#!/usr/bin/env node
// Website-change ticket I/O for the /website-fix skill.
//
// The systems team works website_change tickets from the V2 rail (v2_tickets):
// a client annotates their live page in the portal, the notes land as a ticket,
// a human + Claude implement the changes in the bam-client-sites repo, then the
// ticket is resolved. This script is the DB half of that loop: LIST the open
// queue, GET one ticket with everything needed to implement it (annotations,
// metric snapshot, attached Content Library assets, the thread), and RESOLVE
// it when the change is live.
//
// Usage (run from bam-ghl-agent/bam-portal/):
//   node scripts/website-tickets-io.mjs list                     -> open website_change queue (JSON)
//   node scripts/website-tickets-io.mjs get <ticketId>           -> full ticket: annotations + assets + thread (JSON)
//   node scripts/website-tickets-io.mjs resolve <ticketId> "<note>"  -> mark resolved + system row on the thread
//
// Env (required): SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
// NOTE: this script deliberately does NOT fall back to SUPABASE_SERVICE_KEY -
// the copy in bam-portal/.env.local is STALE (known repo gotcha) and a stale
// key fails with confusing 401s. Pull the real SUPABASE_SERVICE_ROLE_KEY from
// the bam-portal Vercel project env.
//
// Resolve has two paths:
//   1. API path (preferred): if STAFF_BEARER_TOKEN is set, calls the portal API
//      POST /api/v2-tickets?action=status&id=<id> {status:'resolved'} so the
//      mutation rides the same choke point as every other ticket change (and
//      picks up the P6 notification hooks the moment they ship). The note is
//      posted first via ?action=reply as a staff message the client can see.
//      Base URL: V2_TICKETS_API_BASE (default https://portal.byanymeansbusiness.com).
//   2. SERVICE fallback (no token): direct Supabase writes that mirror
//      api/v2-tickets.js setStatus() EXACTLY - PATCH v2_tickets
//      {status:'resolved', resolved_at} + insert a v2_ticket_messages system
//      row {author_kind:'system', author_name:'System', body:'Status: resolved'}.
//      The note (if given) is inserted as its own system row before the status
//      row. Keep this in sync with setStatus() if that function ever changes.

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!SB_URL || !SB_KEY) {
  console.error(
    "Missing SUPABASE_URL (or VITE_SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY in the environment.\n" +
    "Heads up: SUPABASE_SERVICE_KEY in bam-portal/.env.local is a STALE copy and is intentionally NOT read here.\n" +
    "Pull the real SUPABASE_SERVICE_ROLE_KEY from the bam-portal Vercel project env, e.g.:\n" +
    "  SUPABASE_SERVICE_ROLE_KEY=... node scripts/website-tickets-io.mjs list"
  );
  process.exit(1);
}

const API_BASE = (process.env.V2_TICKETS_API_BASE || "https://portal.byanymeansbusiness.com").trim().replace(/\/$/, "");
const STAFF_TOKEN = (process.env.STAFF_BEARER_TOKEN || "").trim();

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireId(id, action) {
  if (!id || !UUID_RE.test(id)) {
    console.error(`usage: node scripts/website-tickets-io.mjs ${action} <ticketId>${action === "resolve" ? ' "<note>"' : ""} (ticketId must be a uuid)`);
    process.exit(1);
  }
}

function ageDays(createdAt) {
  const ms = Date.now() - new Date(createdAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : null;
}

// The annotator payload (_v2Submit) puts annotations/page_url/metric_snapshot in
// context; be liberal and check intake too - the P4 wiring may land them there.
function normalize(t) {
  const ctx = t.context && typeof t.context === "object" ? t.context : {};
  const intake = t.intake && typeof t.intake === "object" ? t.intake : {};
  const annotations = (Array.isArray(ctx.annotations) && ctx.annotations.length ? ctx.annotations
    : Array.isArray(intake.annotations) ? intake.annotations : [])
    .map((a) => ({ note: a?.note || "", section: a?.section || null, device: a?.device || "desktop" }));
  const description = (intake.description || ctx.description || "").toString().trim() || null;
  return {
    page_url: ctx.page_url || intake.page_url || null,
    funnel: ctx.funnel || intake.funnel || null,
    offer_id: ctx.offer_id || intake.offer_id || null,
    metric_snapshot: ctx.metric_snapshot || intake.metric_snapshot || null,
    annotations,
    description,
    change_count: annotations.length || (description ? 1 : 0),
    asset_ids: Array.isArray(intake.asset_ids) ? intake.asset_ids.filter(Boolean) : [],
  };
}

// Public URL for a client_assets row: link rows carry link_url; uploaded rows
// live in the public client-assets bucket at storage_path.
function assetUrl(a) {
  if (a.link_url) return a.link_url;
  if (a.storage_path) return `${SB_URL}/storage/v1/object/public/client-assets/${a.storage_path}`;
  return null;
}

const TICKET_SEL = "id,client_id,type,status,assignee_role,assigned_to,title,source,intake,context,close_reason,created_at,updated_at,resolved_at";

async function list() {
  const rows = (await sb(
    `v2_tickets?assignee_role=eq.systems&type=eq.website_change&status=not.in.(resolved,closed)` +
    `&select=${TICKET_SEL},clients(business_name)&order=created_at.asc&limit=200`
  )) || [];
  const tickets = rows.map((t) => {
    const n = normalize(t);
    return {
      id: t.id,
      academy: t.clients?.business_name || t.client_id,
      client_id: t.client_id,
      status: t.status,
      title: t.title || null,
      page_url: n.page_url,
      change_count: n.change_count,
      attached_assets: n.asset_ids.length,
      age_days: ageDays(t.created_at),
      created_at: t.created_at,
      source: t.source,
    };
  });
  console.log(JSON.stringify({ count: tickets.length, tickets }, null, 2));
}

async function get(id) {
  const rows = await sb(`v2_tickets?id=eq.${id}&select=${TICKET_SEL},clients(business_name)`);
  const t = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!t) { console.error(`No v2_tickets row with id ${id}.`); process.exit(1); }
  const n = normalize(t);

  // Attached Content Library assets (intake.asset_ids -> client_assets).
  let assets = [];
  if (n.asset_ids.length) {
    const got = (await sb(
      `client_assets?id=in.(${n.asset_ids.join(",")})` +
      `&select=id,label,category,content_type,storage_path,link_url,mime_type,size_bytes,width,height`
    )) || [];
    const byId = new Map(got.map((a) => [a.id, a]));
    assets = n.asset_ids.map((aid) => {
      const a = byId.get(aid);
      return a
        ? { id: a.id, label: a.label, category: a.category, content_type: a.content_type, mime_type: a.mime_type, size_bytes: a.size_bytes, width: a.width, height: a.height, url: assetUrl(a) }
        : { id: aid, missing: true };
    });
  }

  const messages = (await sb(`v2_ticket_messages?ticket_id=eq.${id}&order=created_at.asc&select=id,author_kind,author_name,body,attachments,internal,created_at`)) || [];

  console.log(JSON.stringify({
    ticket: {
      id: t.id, academy: t.clients?.business_name || t.client_id, client_id: t.client_id,
      type: t.type, status: t.status, title: t.title || null, source: t.source,
      created_at: t.created_at, updated_at: t.updated_at, age_days: ageDays(t.created_at),
    },
    page_url: n.page_url,
    funnel: n.funnel,
    offer_id: n.offer_id,
    description: n.description,
    annotations: n.annotations,
    metric_snapshot: n.metric_snapshot,
    assets,
    messages,
    raw: { intake: t.intake, context: t.context },
  }, null, 2));
}

// Mirrors api/v2-tickets.js setStatus() for the service fallback; prefers the
// real API when a staff bearer token is available.
async function resolve(id, note) {
  const rows = await sb(`v2_tickets?id=eq.${id}&select=id,client_id,type,status`);
  const t = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!t) { console.error(`No v2_tickets row with id ${id}.`); process.exit(1); }
  if (t.status === "resolved" || t.status === "closed") {
    console.log(JSON.stringify({ ok: true, already: t.status, id }, null, 2));
    return;
  }

  if (STAFF_TOKEN) {
    // API path: same choke point as the portal UI (P6 notify hooks fire here).
    const call = async (action, body) => {
      const res = await fetch(`${API_BASE}/api/v2-tickets?action=${action}&id=${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${STAFF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`API ${action} ${res.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    };
    if (note) await call("reply", { body: note });
    await call("status", { status: "resolved" });
    console.log(JSON.stringify({ ok: true, id, status: "resolved", via: "api", note_posted: !!note }, null, 2));
    return;
  }

  // SERVICE fallback - replicate setStatus() exactly:
  //   PATCH status + resolved_at, then a system row 'Status: resolved'.
  const systemRow = (body) => sb(`v2_ticket_messages`, {
    method: "POST",
    body: JSON.stringify({ ticket_id: id, client_id: t.client_id, author_kind: "system", author_name: "System", body }),
  });
  if (note) await systemRow(note);
  await sb(`v2_tickets?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved", resolved_at: new Date().toISOString() }),
  });
  await systemRow("Status: resolved");
  console.log(JSON.stringify({ ok: true, id, status: "resolved", via: "service-fallback", note_posted: !!note }, null, 2));
}

const [cmd, arg, ...rest] = process.argv.slice(2);
if (cmd === "list") await list();
else if (cmd === "get") { requireId(arg, "get"); await get(arg); }
else if (cmd === "resolve") { requireId(arg, "resolve"); await resolve(arg, (rest.join(" ") || "").trim()); }
else {
  console.error('usage: node scripts/website-tickets-io.mjs list | get <ticketId> | resolve <ticketId> "<note>"');
  process.exit(1);
}
