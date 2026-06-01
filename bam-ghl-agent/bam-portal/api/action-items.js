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

function dueLabel(d) {
  if (!d) return "";
  return ` · due ${d}`;
}

// ── Onboarding steps (system-seeded action items) ─────────────────────────
// A row's onboarding_key marks it as a fixed onboarding step.
//   AUTO   steps complete from a live signal on the clients row (read-only).
//   MANUAL steps are checkboxes that ALSO write the canonical clients flag,
//          so the legacy onboarding tracker pill stays in sync.
const ONBOARDING_STEPS = [
  { key: "slack",          title: "Join the BAM Slack workspace",        sort: 1, mode: "manual", flagCol: "slack_join_done_at" },
  { key: "connect_stripe", title: "Connect your Stripe account",         sort: 2, mode: "auto",   signalCol: "stripe_connect_connected_at" },
  { key: "create_ghl",     title: "Create your GoHighLevel sub-account", sort: 3, mode: "manual", flagCol: "ghl_signup_done_at" },
  { key: "connect_ghl",    title: "Connect your GoHighLevel account",    sort: 4, mode: "auto",   signalCol: "ghl_connected_at" },
];
const ONBOARDING_BY_KEY = Object.fromEntries(ONBOARDING_STEPS.map(s => [s.key, s]));
const ONBOARDING_SIGNAL_COLS = [...new Set(ONBOARDING_STEPS.map(s => s.signalCol || s.flagCol))].join(",");

async function loadClientSignals(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=${ONBOARDING_SIGNAL_COLS}`);
  return (Array.isArray(rows) && rows[0]) || {};
}

// Idempotently ensure all onboarding steps exist for this client, then
// reconcile AUTO steps against the live client signals. Safe to call on every
// GET — steady state is 2 selects + 0 writes.
async function syncOnboardingItems(clientId) {
  const signals = await loadClientSignals(clientId);
  const existing = await sb(
    `action_items?client_id=eq.${clientId}&onboarding_key=not.is.null&select=id,onboarding_key,completed_at`
  );
  const byKey = {};
  (existing || []).forEach(r => { byKey[r.onboarding_key] = r; });

  for (const step of ONBOARDING_STEPS) {
    const signalVal = signals[step.signalCol || step.flagCol] || null; // timestamp or null
    const row = byKey[step.key];

    if (!row) {
      // Seed missing step (idempotent via on_conflict). completed_at derived
      // from the current signal so already-connected clients show done.
      await sb(`action_items?on_conflict=client_id,onboarding_key`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          client_id: clientId, title: step.title, onboarding_key: step.key,
          sort_order: step.sort, created_by_name: "Onboarding", created_by_role: "staff",
          completed_at: signalVal,
        }),
      });
      continue;
    }
    // AUTO steps mirror the live signal — never manually toggled.
    if (step.mode === "auto") {
      const shouldBeDone = !!signalVal;
      if (!!row.completed_at !== shouldBeDone) {
        await sb(`action_items?id=eq.${row.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ completed_at: shouldBeDone ? signalVal : null }),
        });
      }
    }
  }
}

// ── Handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
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
      await syncOnboardingItems(clientId);

      const items = await sb(
        `action_items?client_id=eq.${clientId}&select=*` +
        // open first (completed_at null), then soonest due, then newest
        `&order=completed_at.asc.nullsfirst,due_date.asc.nullslast,created_at.desc`
      );
      const team = await loadTeam(clientId);
      return res.status(200).json({ items: items || [], team });
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

      // Onboarding AUTO steps can't be ticked by hand — they mirror a signal.
      const obStep = existing.onboarding_key ? ONBOARDING_BY_KEY[existing.onboarding_key] : null;
      if (obStep && obStep.mode === "auto" && "completed" in b) {
        return res.status(400).json({ error: "This step completes automatically when the connection is made." });
      }

      const patch = {};
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

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "no fields to update" });
      }

      const rows = await sb(`action_items?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      const item = Array.isArray(rows) ? rows[0] : rows;

      // Manual onboarding step → write the canonical clients flag too, so the
      // legacy onboarding tracker pill reflects the same done state.
      if (obStep && obStep.mode === "manual" && "completed" in b) {
        await sb(`clients?id=eq.${existing.client_id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ [obStep.flagCol]: b.completed ? patch.completed_at : null }),
        });
      }

      // Slack ping only on a genuine reassignment to a person.
      if (reassignedTo) {
        await postClientSlackNotification(
          existing.client_id,
          `📋 Action item reassigned to ${reassignedTo} — *${item.title}*${dueLabel(item.due_date)}`,
          req
        );
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
