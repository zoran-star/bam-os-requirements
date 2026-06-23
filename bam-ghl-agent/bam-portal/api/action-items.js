import { withSentryApiRoute } from "./_sentry.js";
import { notifyOwners } from "./_notify-owners.js";
// Vercel Serverless Function — Action Items (v1)
//
// A shared per-client to-do list. Visible to the academy team (client portal)
// and BAM staff (staff portal). Any field on any row can be edited by anyone
// who can see it. Done = completed_at IS NOT NULL.
//
//   GET    /api/action-items?client_id=<uuid>
//            → { items: [...], team: [...] }   (team = assignee options)
//   POST   /api/action-items                  body: { client_id, title, ... }
//            → create one item (Slack ping)
//   PATCH  /api/action-items                  body: { id, ...fields }
//            → update fields; reassign re-stamps assignee + Slack ping;
//              `completed:true/false` toggles done
//   DELETE /api/action-items?id=<uuid>        → delete one item
//   GET    /api/action-items?action=cron-due-soon   (CRON_SECRET) → due-soon pings
//
// Auth: Supabase JWT in Authorization header. Caller must be BAM staff OR a
// member of client_id (via client_users / owner / scaling manager).

import { notifyClientPush } from "./push/_send.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

// ── Slack (reuses the per-client channel pattern from tickets.js) ──────────
function clientPortalLink(req) {
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  const base = isLocal ? origin : "https://portal.byanymeansbusiness.com";
  return `${base}/client-portal.html`;
}

async function postClientSlackNotification(clientId, text, req) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token || !clientId || !text) return;
    const rows = await sb(`clients?id=eq.${clientId}&select=slack_channel_id`);
    const r = rows?.[0];
    if (!r?.slack_channel_id) return;
    const body = req ? `${text}\n→ ${clientPortalLink(req)}` : text;
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: r.slack_channel_id, text: body, unfurl_links: false }),
    });
  } catch (err) {
    console.error("Slack notify failed:", err?.message || err);
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();

  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,name,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role&limit=1`);
  }
  const staffRow = Array.isArray(staff) && staff[0];

  // Client memberships the caller can act on (owner + teammates + scaling mgr).
  const ids = new Set();
  const direct = await sb(`clients?auth_user_id=eq.${user.id}&select=id`);
  (direct || []).forEach(r => ids.add(r.id));
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id,name`);
  (memberships || []).forEach(r => ids.add(r.client_id));
  if (staffRow) {
    const sm = await sb(`clients?scaling_manager_id=eq.${staffRow.id}&select=id`);
    (sm || []).forEach(r => ids.add(r.id));
  }

  const memberName = (memberships && memberships[0] && memberships[0].name) || null;
  return {
    user,
    isStaff: !!staffRow,
    clientIds: Array.from(ids),
    displayName: staffRow ? (staffRow.name || "BAM staff") : (memberName || user.email || "Someone"),
    role: staffRow ? "staff" : "client",
  };
}

function canAccess(ctx, clientId) {
  return ctx.isStaff || ctx.clientIds.includes(clientId);
}

// Active academy teammates for a client → assignee options.
async function loadTeam(clientId) {
  const rows = await sb(
    `client_users?client_id=eq.${clientId}&status=eq.active&select=id,name,email,role&order=name.asc`
  );
  return (rows || []).map(r => ({
    id: r.id,
    name: r.name || r.email || "Teammate",
    role: r.role || "member",
  }));
}

// The client's assigned Scaling Manager (name + booking link) — powers the
// "Book a call" onboarding step's dynamic button. Null if no SM assigned.
async function loadClientSM(clientId) {
  const crows = await sb(`clients?id=eq.${clientId}&select=scaling_manager_id`);
  const smId = crows && crows[0] && crows[0].scaling_manager_id;
  if (!smId) return null;
  const srows = await sb(`staff?id=eq.${smId}&select=name,booking_url`);
  const s = srows && srows[0];
  if (!s) return null;
  return { name: s.name || "your Scaling Manager", booking_url: s.booking_url || null };
}

// The marketing manager (Cam) — fixed for everyone — powers the "Book a call
// with Cam" step. Resolves the first marketing_manager's name + booking link.
async function loadMarketingMgr() {
  const rows = await sb(`staff?role=eq.marketing_manager&select=name,booking_url&order=created_at.asc&limit=1`);
  const s = rows && rows[0];
  if (!s) return null;
  return { name: s.name || "Cam", booking_url: s.booking_url || null };
}

// The ads specialist (Ximena) — first marketing_executor — for the
// "Book a call with Ximena" step.
async function loadAdsSpecialist() {
  const rows = await sb(`staff?role=eq.marketing_executor&select=name,booking_url&order=created_at.asc&limit=1`);
  const s = rows && rows[0];
  if (!s) return null;
  return { name: s.name || "Ximena", booking_url: s.booking_url || null };
}

// Build the systems onboarding ticket from the client's data (replaces the old
// auto DB trigger — now fired manually by staff via the trigger_buildout step).
// Idempotent: bails if the client already has a systems_onboarding_ticket_id.
// Due in 7 days.
async function createSystemsOnboardingTicket(clientId) {
  const crows = await sb(`clients?id=eq.${clientId}&select=*`);
  const c = crows && crows[0];
  if (!c) return null;
  if (c.systems_onboarding_ticket_id) return c.systems_onboarding_ticket_id;

  const staffRows  = await sb(`client_users?client_id=eq.${clientId}&status=eq.active&select=id,name,email,role&order=created_at.asc`);
  const locRows    = await sb(`locations?client_id=eq.${clientId}&select=id,title,address,notes&order=sort_order.asc,created_at.asc`);
  const allOffers  = await sb(`offers?client_id=eq.${clientId}&select=id,type,title,status,data&order=sort_order.asc,created_at.asc`);
  const offers     = (allOffers || []).filter(o => (o.status || "") !== "archived");
  const smgr       = await sb(`staff?role=eq.systems_manager&select=id&order=created_at.asc&limit=1`);
  const assignee   = (smgr && smgr[0] && smgr[0].id) || null;

  const bd = c.brand_data || {};
  const body = {
    summary: "Systems onboarding — " + (c.business_name || "(no business name)"),
    client_id: c.id,
    business_name: c.business_name, legal_name: c.legal_name, owner_name: c.owner_name,
    email: c.email, phone: c.phone, address: c.address, time_zone: c.time_zone,
    entity_type: c.entity_type, ein: c.ein,
    website: bd.website_url || null, domain: bd.domain || null,
    marketing_included: c.marketing_included === true,
    slack_channel_id: c.slack_channel_id,
    ghl: { location_id: c.ghl_location_id, company_id: c.ghl_company_id, connect_status: c.ghl_connect_status },
    stripe: { account_id: c.stripe_connect_account_id, connect_status: c.stripe_connect_status },
    brand: bd,
    kpis: c.kpi_data || {},
    staff: staffRows || [],
    locations: locRows || [],
    offers,
    marked_done_at: {
      staff: c.staff_marked_done_at, locations: c.locations_marked_done_at,
      brand: c.brand_marked_done_at, offers: c.offers_marked_done_at,
    },
  };

  const nowIso = new Date().toISOString();
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await sb(`tickets`, {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      client_id: c.id, type: "onboarding", status: "open", priority: "standard",
      source: "portal", fields: body, assigned_to: assignee,
      due_date: dueDate, submitted_at: nowIso, updated_at: nowIso,
    }),
  });
  const ticket = Array.isArray(rows) ? rows[0] : rows;
  if (ticket && ticket.id) {
    await sb(`clients?id=eq.${clientId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ systems_onboarding_ticket_id: ticket.id }),
    });
  }
  return ticket && ticket.id;
}

function dueLabel(d) {
  if (!d) return "";
  return ` · due ${d}`;
}

// ── Onboarding steps (system-seeded action items) ─────────────────────────
// A row's onboarding_key marks it as a fixed onboarding step. Each step maps to
// a timestamp column on the clients row (`col`):
//   writable=true  → toggling the step writes col (two-way sync with the BB
//                    "mark done" buttons / Setup tracker); reconcile always
//                    mirrors col.
//   writable=false → col is an external signal (Stripe/GHL connect). Reconcile
//                    mirrors col UNLESS a human overrode the step by hand.
const ONBOARDING_STEPS = [
  { key: "slack",          title: "Join the BAM Slack workspace",        sort: 1, col: "slack_join_done_at",          writable: true },
  { key: "connect_stripe", title: "Connect your Stripe account",         sort: 2, col: "stripe_connect_connected_at", writable: false },
  { key: "create_ghl",     title: "Create your GoHighLevel sub-account", sort: 3, col: "ghl_signup_done_at",           writable: true },
  { key: "connect_ghl",    title: "Connect your GoHighLevel account",    sort: 4, col: "ghl_connected_at",             writable: false },
  { key: "general_info",   title: "Fill out General Info",               sort: 5, col: "general_marked_done_at",       writable: true },
  { key: "staff",          title: "Add your Staff",                      sort: 6, col: "staff_marked_done_at",         writable: true },
  { key: "locations",      title: "Add your Locations",                  sort: 7, col: "locations_marked_done_at",     writable: true },
  { key: "brand",          title: "Set up Brand & Website",              sort: 8, col: "brand_marked_done_at",         writable: true },
  { key: "kpis",           title: "Fill out your KPIs",                  sort: 9, col: "kpi_marked_done_at",            writable: true },
  { key: "offers",         title: "Set up your Offers",                  sort: 10, col: "offers_marked_done_at",       writable: true },
  { key: "book_call",      title: "Book a call with your Scaling Manager", sort: 11, col: "call_booked_at",            writable: true },
  // Staff-only: hidden from clients. Checking it CREATES the systems ticket.
  // Sits right AFTER the SM call — the build gets scoped on that call.
  { key: "trigger_buildout", title: "Trigger systems buildout",         sort: 12, col: "systems_buildout_triggered_at", writable: true, staff_only: true },
  // ── Systems build tracker (3 steps) — DERIVED from the systems onboarding
  // ticket (clients.systems_onboarding_ticket_id), never hand-toggled. Their
  // state mirrors the ticket's status (see loadSystemsTrackerState):
  //   build first draft → in_progress/in_review (done once first draft is sent)
  //   for review by client → final_review (LIT, client approves in Systems tab)
  //   systems team revisions → post-review work (done when ticket = done)
  // "For review by client" is the actionable one: it lights up the moment the
  // first draft is sent and deep-links into the ticket's approve/feedback block.
  { key: "sys_build_draft",   title: "Systems team building first draft", sort: 13, ticket_derived: true },
  { key: "sys_client_review", title: "For review by client",              sort: 14, ticket_derived: true },
  { key: "sys_revisions",     title: "Systems team revisions",            sort: 15, ticket_derived: true },
  { key: "book_call_cam",  title: "Book a call with Cam (marketing)",    sort: 16, col: "cam_call_booked_at",          writable: true },
  // Self-serve marketing setup — replaces the old "Book a call with Ximena"
  // and "Submit your raw content" steps. Client connects their ad account via
  // the Leadsie share link, then launches campaigns in the Marketing tab
  // (each campaign collects budget + assets via the new-campaign wizard).
  { key: "connect_ads",    title: "Connect your ad account",             sort: 17, col: "ads_connected_at",            writable: true },
  { key: "add_campaign",   title: "Add a new campaign",                  sort: 18, col: "content_submitted_at",        writable: true },
  // Staff-only gate. Flipping it UNLOCKS the client's "Book review call" step.
  { key: "ready_for_review", title: "Ready for review call?",           sort: 19, col: "ready_for_review_at",         writable: true, staff_only: true },
  // Client step — locked (greyed) until ready_for_review is done.
  { key: "book_review_call", title: "Book review call with Scaling Manager", sort: 20, col: "review_call_booked_at", writable: true, locked_by: "ready_for_review" },
  // ── V1.5-only steps (tier:"v15") — only seeded for V1.5 academies; V2/V1
  // never see them. They get tier-gated in syncOnboardingItems. ──
  { key: "v15_athlete_map", title: "Map your athlete-name field", sort: 21, col: "athlete_map_done_at", writable: true, tier: "v15" },
  { key: "v15_kpi_setup",   title: "Connect your KPIs",           sort: 22, col: "kpi_setup_done_at",   writable: true, tier: "v15" },
];
const ONBOARDING_BY_KEY = Object.fromEntries(ONBOARDING_STEPS.map(s => [s.key, s]));
// Only steps backed by a clients column — ticket-derived steps have no `col`.
const ONBOARDING_SIGNAL_COLS = [...new Set(ONBOARDING_STEPS.filter(s => s.col).map(s => s.col))].join(",");
const ONBOARDING_STAFF_ONLY = new Set(ONBOARDING_STEPS.filter(s => s.staff_only).map(s => s.key));
const ONBOARDING_TICKET_DERIVED = new Set(ONBOARDING_STEPS.filter(s => s.ticket_derived).map(s => s.key));
const ONBOARDING_TIER_KEYS = new Set(ONBOARDING_STEPS.filter(s => s.tier).map(s => s.key));
// Which steps apply to a client of a given tier (no `tier` = all tiers).
function onboardingStepsForTier(isV15) {
  return ONBOARDING_STEPS.filter(s => !s.tier || (s.tier === "v15" && isV15));
}

async function loadClientSignals(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=${ONBOARDING_SIGNAL_COLS},v15_access`);
  return (Array.isArray(rows) && rows[0]) || {};
}

// Derive the 3 systems-build-tracker steps from the client's systems onboarding
// ticket (clients.systems_onboarding_ticket_id). Returns:
//   { ticketId, status, lit, done: { <key>: completedTimestamp | null } }
//   • sys_build_draft  done once the first draft was sent to the client (the
//     ticket reached final_review at least once)
//   • sys_client_review done ONLY when the client approved (ticket = done);
//     `lit` = true while the ticket sits in final_review (ball in client's court)
//   • sys_revisions    done when the ticket is done/resolved
// No ticket (or cancelled) → everything pending.
async function loadSystemsTrackerState(clientId) {
  const crows = await sb(`clients?id=eq.${clientId}&select=systems_onboarding_ticket_id`);
  const ticketId = (crows && crows[0] && crows[0].systems_onboarding_ticket_id) || null;
  const empty = { ticketId, status: null, lit: false, done: { sys_build_draft: null, sys_client_review: null, sys_revisions: null } };
  if (!ticketId) return empty;
  const trows = await sb(`tickets?id=eq.${ticketId}&select=id,status,resolved_at,updated_at,messages`);
  const t = trows && trows[0];
  if (!t || t.status === "cancelled") return { ...empty, status: t ? t.status : null };

  const msgs = Array.isArray(t.messages) ? t.messages : [];
  const sent = msgs.filter(m => m && m.body === "(sent to client for final review)");
  const everSent = sent.length > 0 || t.status === "final_review" || t.status === "done";
  const firstSentAt = sent.length ? sent[0].created_at : (t.updated_at || null);
  const isDone = t.status === "done";
  const resolvedAt = t.resolved_at || t.updated_at || null;
  return {
    ticketId: t.id,
    status: t.status,
    lit: t.status === "final_review",
    done: {
      sys_build_draft:   everSent ? firstSentAt : null,
      sys_client_review: isDone ? resolvedAt : null,
      sys_revisions:     isDone ? resolvedAt : null,
    },
  };
}

// Idempotently ensure all onboarding steps exist for this client, then
// reconcile each against its clients-row column. Safe to call on every GET.
async function syncOnboardingItems(clientId, tracker) {
  const signals = await loadClientSignals(clientId);
  const isV15 = signals.v15_access === true;
  const steps = onboardingStepsForTier(isV15);
  // Ticket-derived steps mirror the systems onboarding ticket (load once).
  if (steps.some(s => s.ticket_derived) && !tracker) tracker = await loadSystemsTrackerState(clientId);
  const applicableKeys = new Set(steps.map(s => s.key));
  const existing = await sb(
    `action_items?client_id=eq.${clientId}&onboarding_key=not.is.null&select=id,onboarding_key,completed_at,onboarding_overridden,sort_order`
  );
  const byKey = {};
  (existing || []).forEach(r => { byKey[r.onboarding_key] = r; });

  // Remove tier-gated steps that no longer apply (e.g. V1.5 steps left over on an
  // academy that's no longer V1.5). Only ever deletes tier-gated keys.
  for (const r of (existing || [])) {
    if (ONBOARDING_TIER_KEYS.has(r.onboarding_key) && !applicableKeys.has(r.onboarding_key)) {
      await sb(`action_items?id=eq.${r.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
    }
  }

  for (const step of steps) {
    // Done-timestamp source: a clients column for normal steps, the systems
    // ticket for ticket-derived steps.
    const colVal = step.ticket_derived
      ? ((tracker && tracker.done[step.key]) || null)
      : (signals[step.col] || null); // timestamp or null
    const row = byKey[step.key];

    if (!row) {
      // Seed missing step (idempotent via on_conflict). completed_at derived
      // from the current column so already-done clients show done.
      await sb(`action_items?on_conflict=client_id,onboarding_key`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          client_id: clientId, title: step.title, onboarding_key: step.key,
          sort_order: step.sort, created_by_name: "Onboarding", created_by_role: "staff",
          completed_at: colVal,
        }),
      });
      continue;
    }
    // Keep the step ORDER in sync with the code (source of truth) — without
    // this, reordering ONBOARDING_STEPS only affected brand-new clients.
    if (row.sort_order !== step.sort) {
      await sb(`action_items?id=eq.${row.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ sort_order: step.sort }),
      });
    }
    // Writable steps always mirror col (toggling writes col, so they're already
    // consistent; this picks up changes made via the BB "mark done" buttons).
    // Signal steps mirror col UNLESS a human overrode the step by hand.
    const respectOverride = !step.ticket_derived && !step.writable && row.onboarding_overridden;
    if (!respectOverride) {
      const shouldBeDone = !!colVal;
      if (!!row.completed_at !== shouldBeDone) {
        await sb(`action_items?id=eq.${row.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ completed_at: shouldBeDone ? colVal : null }),
        });
      }
    }
  }
}

// ── Handler ──────────────────────────────────────────────────────────────
async function handler(req, res) {
  const action = req.query && req.query.action;

  // ── Cron: due-soon Slack reminders (no user auth — CRON_SECRET) ──────────
  if (action === "cron-due-soon") {
    const expected = process.env.CRON_SECRET;
    if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
    if ((req.headers.authorization || "") !== `Bearer ${expected}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      // Open items due within the next 2 days that we haven't pinged yet.
      const today = new Date();
      const horizon = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const rows = await sb(
        `action_items?completed_at=is.null&due_date=not.is.null` +
        `&due_date=lte.${horizon}&due_soon_notified_at=is.null` +
        `&select=id,client_id,title,due_date,assignee_name`
      );
      let pinged = 0;
      for (const it of rows || []) {
        const who = it.assignee_name ? ` (assigned to ${it.assignee_name})` : "";
        await postClientSlackNotification(
          it.client_id, `⏰ Action item due soon — *${it.title}*${dueLabel(it.due_date)}${who}`, req
        );
        // #4 due-soon native push
        notifyClientPush(it.client_id, "action-item-due-soon", {
          label: it.title, itemId: it.id, view: "action-items",
        }).catch(() => {});
        await sb(`action_items?id=eq.${it.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ due_soon_notified_at: new Date().toISOString() }),
        });
        pinged += 1;
      }
      return res.status(200).json({ ok: true, pinged });
    } catch (e) {
      console.error("cron-due-soon error:", e?.message || e);
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    const ctx = await resolveUser(req);

    // ── GET: list items + assignee options ────────────────────────────────
    if (req.method === "GET") {
      const clientId = (req.query && req.query.client_id) || ctx.clientIds[0] || null;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!canAccess(ctx, clientId)) return res.status(403).json({ error: "not your academy" });

      // Seed missing onboarding steps + reconcile auto ones before listing.
      const tracker = await loadSystemsTrackerState(clientId);
      await syncOnboardingItems(clientId, tracker);

      const items = await sb(
        `action_items?client_id=eq.${clientId}&select=*` +
        // open first (completed_at null), then soonest due, then newest
        `&order=completed_at.asc.nullsfirst,due_date.asc.nullslast,created_at.desc`
      );
      // Decorate the systems-build-tracker steps so the UIs can glow the "For
      // review by client" step and deep-link it to the ticket.
      for (const it of (items || [])) {
        if (it.onboarding_key && ONBOARDING_TICKET_DERIVED.has(it.onboarding_key)) {
          it.ticket_id = tracker.ticketId;
          it.ticket_status = tracker.status;
          it.lit = it.onboarding_key === "sys_client_review" ? tracker.lit : false;
        }
      }
      // Staff-only onboarding steps (e.g. trigger_buildout) are hidden from clients.
      let visibleItems = items || [];
      if (!ctx.isStaff) {
        visibleItems = visibleItems.filter(it => !it.onboarding_key || !ONBOARDING_STAFF_ONLY.has(it.onboarding_key));
      }
      const team = await loadTeam(clientId);
      const sm = await loadClientSM(clientId);
      const mktg = await loadMarketingMgr();
      const ads = await loadAdsSpecialist();
      // Whether the staff "Ready for review call?" gate is flipped — unlocks
      // the client's book_review_call step.
      const review_ready = (items || []).some(i => i.onboarding_key === "ready_for_review" && i.completed_at);
      return res.status(200).json({ items: visibleItems, team, sm, mktg, ads, review_ready });
    }

    // ── POST: create ──────────────────────────────────────────────────────
    if (req.method === "POST") {
      const b = req.body || {};
      const clientId = b.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!canAccess(ctx, clientId)) return res.status(403).json({ error: "not your academy" });
      const title = (b.title || "").trim();
      if (!title) return res.status(400).json({ error: "title required" });

      let assignee_id = b.assignee_id || null;
      let assignee_name = null;
      if (assignee_id) {
        const team = await loadTeam(clientId);
        const match = team.find(t => t.id === assignee_id);
        if (!match) return res.status(400).json({ error: "assignee not on this academy" });
        assignee_name = match.name;
      }

      const rows = await sb(`action_items`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          client_id: clientId,
          title,
          description: b.description || null,
          due_date: b.due_date || null,
          assignee_id,
          assignee_name,
          created_by: ctx.user.id,
          created_by_name: ctx.displayName,
          created_by_role: ctx.role,
        }),
      });
      const item = Array.isArray(rows) ? rows[0] : rows;

      const who = assignee_name ? ` for ${assignee_name}` : "";
      await postClientSlackNotification(
        clientId, `📋 New action item${who} — *${title}*${dueLabel(item.due_date)}`, req
      );
      // #3 assigned native push
      notifyClientPush(clientId, "action-item-assigned", {
        label: title, itemId: item.id, view: "action-items",
      }).catch(() => {});
      // Owner/staff SMS (V1.5/V2, per notification_prefs)
      notifyOwners(clientId, "action_item", `📋 New action item: ${title}`).catch(() => {});
      return res.status(200).json({ item });
    }

    // ── PATCH: update any field (incl. toggle done / reassign) ─────────────
    if (req.method === "PATCH") {
      const b = req.body || {};
      const id = b.id;
      if (!id) return res.status(400).json({ error: "id required" });

      const existingRows = await sb(`action_items?id=eq.${id}&select=*&limit=1`);
      const existing = Array.isArray(existingRows) && existingRows[0];
      if (!existing) return res.status(404).json({ error: "not found" });
      if (!canAccess(ctx, existing.client_id)) return res.status(403).json({ error: "not your academy" });

      const obStep = existing.onboarding_key ? ONBOARDING_BY_KEY[existing.onboarding_key] : null;
      // Staff-only steps (e.g. trigger_buildout) can't be toggled by clients.
      if (obStep && obStep.staff_only && !ctx.isStaff) {
        return res.status(403).json({ error: "staff only" });
      }
      // Ticket-derived steps mirror the systems ticket — they can't be hand-toggled.
      if (obStep && obStep.ticket_derived && "completed" in b) {
        return res.status(400).json({ error: "this step updates automatically from the systems ticket" });
      }

      const patch = {};
      // Hand-toggling a SIGNAL step (Stripe/GHL connect) marks it overridden so
      // the reconcile stops forcing it back to the signal. Writable steps don't
      // need this — toggling writes their col, so they stay consistent.
      if (obStep && !obStep.writable && "completed" in b) patch.onboarding_overridden = true;
      if (typeof b.title === "string") {
        if (!b.title.trim()) return res.status(400).json({ error: "title cannot be empty" });
        patch.title = b.title.trim();
      }
      if ("description" in b) patch.description = b.description || null;
      if ("due_date" in b) {
        patch.due_date = b.due_date || null;
        patch.due_soon_notified_at = null; // re-arm the due-soon ping
      }

      let reassignedTo = null;
      if ("assignee_id" in b) {
        const newId = b.assignee_id || null;
        if (newId) {
          const team = await loadTeam(existing.client_id);
          const match = team.find(t => t.id === newId);
          if (!match) return res.status(400).json({ error: "assignee not on this academy" });
          patch.assignee_id = newId;
          patch.assignee_name = match.name;
        } else {
          patch.assignee_id = null;
          patch.assignee_name = null;
        }
        if (newId !== existing.assignee_id) reassignedTo = patch.assignee_name;
      }

      if ("completed" in b) {
        if (b.completed) {
          patch.completed_at = new Date().toISOString();
          patch.completed_by_name = ctx.displayName;
        } else {
          patch.completed_at = null;
          patch.completed_by_name = null;
        }
      }

      // Gate: the systems buildout can't be triggered until the academy's
      // required onboarding data is in - EIN, business address, and the Offers
      // section marked done (which the client portal only allows once every
      // active offer's required fields are filled).
      if (obStep && obStep.key === "trigger_buildout" && b.completed === true) {
        const crows = await sb(`clients?id=eq.${existing.client_id}&select=ein,address,offers_marked_done_at`);
        const c = Array.isArray(crows) ? crows[0] : crows;
        const miss = [];
        if (!c || !String(c.ein || "").trim()) miss.push("EIN");
        if (!c || !String(c.address || "").trim()) miss.push("business address");
        if (!c || !c.offers_marked_done_at) miss.push("Offers (mark the Offers section done)");
        if (miss.length) {
          return res.status(400).json({
            error: `Can't trigger the systems buildout yet - missing: ${miss.join(", ")}.`,
            code: "buildout_prereqs_missing",
            missing: miss,
          });
        }
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "no fields to update" });
      }

      const rows = await sb(`action_items?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      const item = Array.isArray(rows) ? rows[0] : rows;

      // Writable onboarding step → write its canonical clients column too, so
      // the BB "mark done" buttons + onboarding tracker reflect the same state.
      if (obStep && obStep.writable && "completed" in b) {
        await sb(`clients?id=eq.${existing.client_id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ [obStep.col]: b.completed ? patch.completed_at : null }),
        });
      }

      // Checking "Trigger systems buildout" creates the systems ticket (due +7).
      if (obStep && obStep.key === "trigger_buildout" && b.completed === true) {
        try { await createSystemsOnboardingTicket(existing.client_id); }
        catch (e) { console.error("createSystemsOnboardingTicket failed:", e?.message || e); }
      }
      // Un-checking clears the saved ticket pointer so re-triggering builds a
      // FRESH systems ticket (createSystemsOnboardingTicket is idempotent on it).
      if (obStep && obStep.key === "trigger_buildout" && b.completed === false) {
        await sb(`clients?id=eq.${existing.client_id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ systems_onboarding_ticket_id: null }),
        }).catch((e) => console.error("clear systems_onboarding_ticket_id failed:", e?.message || e));
      }

      // Slack ping only on a genuine reassignment to a person.
      if (reassignedTo) {
        await postClientSlackNotification(
          existing.client_id,
          `📋 Action item reassigned to ${reassignedTo} — *${item.title}*${dueLabel(item.due_date)}`,
          req
        );
        // #3 (reassign) native push
        notifyClientPush(existing.client_id, "action-item-assigned", {
          label: item.title, itemId: item.id, view: "action-items",
        }).catch(() => {});
      }
      return res.status(200).json({ item });
    }

    // ── DELETE ─────────────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const existingRows = await sb(`action_items?id=eq.${id}&select=client_id,onboarding_key&limit=1`);
      const existing = Array.isArray(existingRows) && existingRows[0];
      if (!existing) return res.status(200).json({ ok: true }); // already gone
      if (!canAccess(ctx, existing.client_id)) return res.status(403).json({ error: "not your academy" });
      if (existing.onboarding_key) return res.status(400).json({ error: "onboarding steps can't be deleted" });
      await sb(`action_items?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
