#!/usr/bin/env node
// One-time backfill: portal_feedback (the old lil-Zoran feedback modal) ->
// v2_tickets (the Track 2 rail), so Zoran's product-feedback triage reads ONE
// queue and clients see their old reports in the V2 support focus rail.
//
// The old modal wrote every bug report + feature idea into portal_feedback.
// The V2 intake now lands the same feedback on the v2_tickets rail (type
// fix | feature_idea, assignee_role backlog). This script moves the history
// over; the /v2-tickets skill stops reading portal_feedback once it has run.
//
// Usage:
//   node scripts/feedback-backfill.mjs            -> DRY RUN (prints the plan, writes nothing)
//   node scripts/feedback-backfill.mjs --apply    -> inserts the v2_tickets rows
//
// Env (required): SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
// (or SUPABASE_SERVICE_KEY). Pull them from the Vercel project or a local .env.
//
// Mapping (portal_feedback -> v2_tickets):
//   kind      bug -> type 'fix', feature -> type 'feature_idea'
//   status    'rejected'                 -> 'closed' (close_reason 'Rejected at triage')
//             'done' OR resolved_at set  -> 'resolved' (resolved_at carried over)
//             everything else            -> 'new'
//   assignee_role 'backlog' (Zoran's triage lane), assigned_to null
//   source 'icon-chat', title = first ~60 chars of body (whitespace collapsed)
//   intake { description: body, file_url, file_name, page, context }
//   legacy_feedback_id = portal_feedback.id, created_at preserved (direct
//   service-role REST insert, so PostgREST accepts the explicit timestamp)
//
// Scope + safety:
//   - Only rows with a client_id that exists in clients migrate (v2_tickets
//     FKs clients NOT NULL). Staff-widget rows and unattributed client rows
//     are skipped + reported - they stay in portal_feedback.
//   - Idempotent: a portal_feedback id already present as a v2_tickets
//     legacy_feedback_id is skipped, so re-runs never duplicate.
//   - Nothing is deleted or updated in portal_feedback. Read-only there.

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
if (!SB_URL || !SB_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const FB_SEL = "id,created_at,updated_at,kind,body,page,context,file_url,file_name,client_id,portal,status,resolved_at";

function mapStatus(f) {
  if (f.status === "rejected") return { status: "closed", closed_at: f.resolved_at || f.updated_at || f.created_at, close_reason: "Rejected at triage" };
  if (f.status === "done" || f.resolved_at) return { status: "resolved", resolved_at: f.resolved_at || f.updated_at || f.created_at };
  return { status: "new" };
}

function toTicket(f) {
  const body = String(f.body || "").trim();
  return {
    client_id: f.client_id,
    type: f.kind === "feature" ? "feature_idea" : "fix",
    assignee_role: "backlog",
    assigned_to: null,
    title: body.replace(/\s+/g, " ").slice(0, 60),
    source: "icon-chat",
    intake: {
      description: body,
      file_url: f.file_url || null,
      file_name: f.file_name || null,
      page: f.page || null,
      context: f.context || null,
    },
    legacy_feedback_id: f.id,
    created_at: f.created_at,
    ...mapStatus(f),
  };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const feedback = (await sb(`portal_feedback?select=${FB_SEL}&order=created_at.asc&limit=10000`)) || [];
  const migrated = new Set(
    ((await sb(`v2_tickets?legacy_feedback_id=not.is.null&select=legacy_feedback_id&limit=10000`)) || [])
      .map((r) => r.legacy_feedback_id)
  );
  const clientIds = new Set(((await sb(`clients?select=id&limit=10000`)) || []).map((c) => c.id));

  const rows = [];
  const skipped = { already: 0, no_client: 0, unknown_client: 0 };
  for (const f of feedback) {
    if (migrated.has(f.id)) { skipped.already++; continue; }
    if (!f.client_id) { skipped.no_client++; continue; }        // staff-widget / unattributed rows stay put
    if (!clientIds.has(f.client_id)) { skipped.unknown_client++; continue; }
    rows.push(toTicket(f));
  }

  console.log(`portal_feedback: ${feedback.length} rows total`);
  console.log(`  skipped: ${skipped.already} already migrated, ${skipped.no_client} without a client_id (staff/unattributed), ${skipped.unknown_client} pointing at an unknown client`);
  console.log(`  to migrate: ${rows.length}\n`);

  const counts = {};
  for (const r of rows) counts[`${r.type}/${r.status}`] = (counts[`${r.type}/${r.status}`] || 0) + 1;
  for (const [k, n] of Object.entries(counts)) console.log(`  ${k}: ${n}`);
  if (rows.length) console.log("");
  for (const r of rows) {
    console.log(`  ${r.legacy_feedback_id}  ${String(r.created_at).slice(0, 10)}  ${r.type.padEnd(12)} -> ${r.status.padEnd(8)}  "${r.title}"`);
  }

  if (!apply) {
    console.log(`\nDRY RUN - nothing written. Re-run with --apply to insert ${rows.length} v2_tickets row(s).`);
    return;
  }
  if (!rows.length) { console.log("\nNothing to migrate."); return; }

  // Chunked inserts (Prefer: return=minimal); each chunk is atomic.
  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await sb(`v2_tickets`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(batch) });
    inserted += batch.length;
    console.log(`\nInserted ${inserted}/${rows.length}...`);
  }
  console.log(`Done. ${inserted} portal_feedback row(s) now live on the v2_tickets rail (legacy_feedback_id links them back).`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
