import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Agent learnings (read + manage)
//
//   POST /api/agent-learnings { action, ... }   (Supabase bearer)
//     "list"      { client_id? }  → lessons. Academy owners see their own;
//                                   staff see all (or one academy if client_id).
//     "set-scope" { id, scope }   → staff only: 'academy' | 'general'
//     "archive"   { id, active }  → staff only: toggle active
//     "edit"      { id, lesson }  → staff only: edit the lesson text
//
// One source of truth (agent_lessons). The client portal renders a read-only
// "Agent learnings" tab; the staff portal manages + promotes.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await r.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let ctx;
  try { ctx = await resolveUser(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const b = req.body && typeof req.body === "object" ? req.body : {};
  const SEL = "id,client_id,lesson,kind,scope,active,created_at,created_by,clients(business_name)";

  try {
    if (b.action === "list") {
      let path;
      if (ctx.isStaff) {
        path = b.client_id
          ? `agent_lessons?client_id=eq.${b.client_id}&select=${SEL}&order=created_at.desc`
          : `agent_lessons?select=${SEL}&order=created_at.desc&limit=500`;
      } else {
        if (!ctx.clientIds.length) return res.status(200).json({ lessons: [], is_staff: false });
        const ids = ctx.clientIds.map(encodeURIComponent).join(",");
        path = `agent_lessons?client_id=in.(${ids})&active=eq.true&select=${SEL}&order=created_at.desc`;
      }
      const rows = await sb(path);
      const lessons = (Array.isArray(rows) ? rows : []).map(r => ({
        id: r.id, client_id: r.client_id, lesson: r.lesson, kind: r.kind, scope: r.scope, active: r.active,
        created_at: r.created_at, created_by: r.created_by, business_name: r.clients?.business_name || null,
      }));
      return res.status(200).json({ lessons, is_staff: ctx.isStaff });
    }

    // ── staff-only mutations ──
    if (!ctx.isStaff) return res.status(403).json({ error: "staff only" });

    if (b.action === "set-scope") {
      if (!b.id || !["academy", "general"].includes(b.scope)) return res.status(400).json({ error: "id + valid scope required" });
      await sb(`agent_lessons?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ scope: b.scope }) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "archive") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      await sb(`agent_lessons?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: b.active !== false ? false : true }) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "edit") {
      if (!b.id || !b.lesson || !String(b.lesson).trim()) return res.status(400).json({ error: "id + lesson required" });
      await sb(`agent_lessons?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ lesson: String(b.lesson).trim() }) });
      return res.status(200).json({ ok: true });
    }

    // ── Global-promotion approval queue (lessons a client trainer taught that the
    //    AI flagged as general sales-craft). Admin approves → promote to shared brain.
    if (b.action === "list-promotions") {
      const rows = await sb(
        `agent_lessons?promotion_status=eq.pending&active=eq.true&select=id,client_id,lesson,kind,promotion_reason,created_by,created_at,clients(business_name)&order=created_at.desc`
      );
      const pending = (Array.isArray(rows) ? rows : []).map(r => ({
        id: r.id, client_id: r.client_id, lesson: r.lesson, kind: r.kind,
        reason: r.promotion_reason, created_by: r.created_by, created_at: r.created_at,
        business_name: r.clients?.business_name || null,
      }));
      return res.status(200).json({ pending });
    }
    if (b.action === "approve-promotion") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      await sb(`agent_lessons?id=eq.${encodeURIComponent(b.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ scope: "general", promotion_status: "approved", reviewed_by: ctx.user.email || "staff", reviewed_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "reject-promotion") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      await sb(`agent_lessons?id=eq.${encodeURIComponent(b.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ promotion_status: "rejected", reviewed_by: ctx.user.email || "staff", reviewed_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-learnings]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
