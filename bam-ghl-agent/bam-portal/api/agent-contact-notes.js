import { withSentryApiRoute } from "./_sentry.js";
import { contactsReadTable } from "./_contacts.js";
// Per-contact notes for the sales agent's memory.
//
//   POST /api/agent-contact-notes { action, ... }   (Supabase bearer)
//     "get"    { client_id, contact_id, opp_id?, email? }
//              → { notes[], post_trial, contact, enroll }
//                (the full "what the agent knows" view; enroll = the lead's
//                 enroll-form journey: link_sent_at / form_filled_at / paid_at)
//     "add"    { client_id, contact_id, note }      → add a note
//     "remove" { id }                              → archive a note
//
// Access: BAM staff, or an active client_users member of that academy.

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

const canAccess = (ctx, clientId) => ctx.isStaff || (clientId && ctx.clientIds.includes(clientId));

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let ctx;
  try { ctx = await resolveUser(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const b = req.body && typeof req.body === "object" ? req.body : {};

  try {
    if (b.action === "get") {
      if (!b.client_id || !b.contact_id) return res.status(400).json({ error: "client_id + contact_id required" });
      if (!canAccess(ctx, b.client_id)) return res.status(403).json({ error: "no access to that academy" });
      const cid = encodeURIComponent(b.contact_id);
      // Enroll-form journey for this LEAD: a members row at payment_method_required
      // means they filled the enroll form (step 1 of checkout) but haven't paid -
      // they are NOT on the roster (signup_origin shells are hidden) but the
      // drawer/Hawkeye timeline shows the event. Match by contact id, plus the
      // optional opp_id/email hints the drawer already knows (website checkout
      // rows may carry only ghl_opportunity_id + parent_email).
      const orClauses = [`ghl_contact_id.eq.${b.contact_id}`];
      if (b.opp_id) orClauses.push(`ghl_opportunity_id.eq.${b.opp_id}`);
      if (b.email && /@/.test(String(b.email))) orClauses.push(`parent_email.eq."${String(b.email).toLowerCase().trim()}"`);
      const memberQ = `members?client_id=eq.${b.client_id}&or=(${encodeURIComponent(orClauses.join(","))})` +
        `&select=id,status,signup_origin,athlete_name,created_at,updated_at,stripe_joined_at&order=created_at.desc&limit=5`;
      const [notes, ptrRows, contactRows, memberRows] = await Promise.all([
        sb(`agent_contact_notes?client_id=eq.${b.client_id}&ghl_contact_id=eq.${cid}&active=eq.true&select=id,note,created_by,created_at&order=created_at.desc`).catch(() => []),
        sb(`post_trial_reviews?client_id=eq.${b.client_id}&ghl_contact_id=eq.${cid}&select=showed_up,good_fit,trainer,notes,created_at,updated_at,signup_text_status&order=created_at.desc&limit=1`).catch(() => []),
        sb(`${await contactsReadTable(b.client_id)}?client_id=eq.${b.client_id}&ghl_contact_id=eq.${cid}&select=name,athlete_name,tags&limit=1`).catch(() => []),
        sb(memberQ).catch(() => []),
      ]);
      const ptr = (Array.isArray(ptrRows) && ptrRows[0]) || null;
      let enroll = null;
      const mRows = Array.isArray(memberRows) ? memberRows : [];
      const paidRow  = mRows.find(m => m.status && m.status !== "payment_method_required");
      const shellRow = mRows.find(m => m.status === "payment_method_required");
      // "Form filled" only when the row was BORN on the public enroll form -
      // an imported/wizard member never filled it, so don't claim they did.
      const formRow = mRows.find(m => m.signup_origin === "website_enroll");
      if (paidRow || shellRow || formRow || (ptr && ptr.signup_text_status === "sent")) {
        enroll = {
          link_sent_at:   (ptr && ptr.signup_text_status === "sent") ? (ptr.updated_at || ptr.created_at) : null,
          form_filled_at: formRow ? formRow.created_at : null,
          paid_at:        paidRow ? (paidRow.stripe_joined_at || paidRow.updated_at) : null,
          athlete_name:   (shellRow && shellRow.athlete_name) || (paidRow && paidRow.athlete_name) || null,
        };
      }
      return res.status(200).json({
        notes: Array.isArray(notes) ? notes : [],
        post_trial: ptr,
        contact: (Array.isArray(contactRows) && contactRows[0]) || null,
        enroll,
      });
    }

    if (b.action === "add") {
      if (!b.client_id || !b.contact_id || !b.note || !String(b.note).trim()) return res.status(400).json({ error: "client_id, contact_id, note required" });
      if (!canAccess(ctx, b.client_id)) return res.status(403).json({ error: "no access to that academy" });
      const [row] = await sb(`agent_contact_notes`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ client_id: b.client_id, ghl_contact_id: String(b.contact_id), note: String(b.note).trim(), created_by: ctx.user.email || "staff" }]),
      });
      return res.status(200).json({ ok: true, note: row });
    }

    if (b.action === "remove") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      // scope the archive to the caller's academies (staff can do any).
      const idClause = `id=eq.${encodeURIComponent(b.id)}`;
      const scope = ctx.isStaff ? "" : `&client_id=in.(${ctx.clientIds.map(encodeURIComponent).join(",") || "00000000-0000-0000-0000-000000000000"})`;
      await sb(`agent_contact_notes?${idClause}${scope}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }) });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-contact-notes]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
