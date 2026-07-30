import { withSentryApiRoute } from "../_sentry.js";

// Seed the CORE athlete fields every academy on the shared preset must carry.
//
//   POST /api/offers/seed-core-fields   body { client_id }
//     → { ok, created:[], existing:[], skipped:[] }
//
// WHAT THIS IS FOR. The membership enroll form renders a hardcoded core block
// (parent name / email / phone + the athlete's name) and then the academy's own
// custom_field_defs rows, via buildFields() in api/website/offer.js. "The
// academy's own rows" is exactly the problem: a brand-new academy has NONE, so
// its enroll form asks for a parent and an athlete name and knows nothing else
// about the kid, while BAM GTA - the academy every preset was reverse-engineered
// from - has carried three athlete fields since its GHL import. The preset was
// shipping GTA's shape to nobody but GTA.
//
// THE MANIFEST IS GTA'S THREE ROWS, COPIED EXACTLY. Not "inspired by": same
// keys, same labels, same types, same academy level (offer_id null). Verified
// against production 2026-07-31 - see MANIFEST for the query and its result.
//
// WHY THE KEYS ARE LOAD-BEARING AND MAY NEVER BE RENAMED. These three defs are
// not only the enroll form's. They also feed the free-trial LEAD form
// (`lead_fields` in api/website/offer.js), and api/_contacts.js
// writePortalFieldValues matches a submitted answer to a def BY KEY. Rename
// `athlete_first_name` here and two things break at once, silently: the lead
// form stops filling the field it has always filled, and api/website/checkout.js
// - which writes `{ athlete_first_name, athlete_last_name }` by those literal
// names for an enroll-only parent - starts writing to nothing at all. The label
// is cosmetic. The key is a contract.
//
// THE SEEDING RULE, IN ONE LINE: ADD IF ABSENT, BY KEY, AND NOTHING ELSE.
//   * an academy that already has the key keeps ITS row, untouched. Its label,
//     type, required flag, position, options and ghl bridge are its own. An
//     academy that renamed "Athlete's Age" to "Age (years)" made a choice, and a
//     seeder that "corrects" it on the next preset apply is a seeder that
//     overwrites owners.
//   * an ARCHIVED row counts as present and is NOT resurrected. Archiving is a
//     deliberate act; re-adding the key would both undo it and violate the
//     (client_id, key) unique index. Reported as `skipped`, never hidden.
//   * nothing is ever deleted, and no row that exists is ever PATCHed.
// So the whole endpoint is: read what is there, insert only what is not.
//
// WHAT IS DELIBERATELY NOT IN THE MANIFEST, so the next person does not add it:
//
//   DATE OF BIRTH. Ruled out by the owner on 2026-07-31: the core athlete field
//   is AGE ONLY. An academy whose parent agreement legally needs a date of birth
//   adds its own def for it - that is one academy's legal requirement, not the
//   shared core, and the moment DOB is core every academy is asked for a
//   birthdate it has no use for.
//
//   EMERGENCY CONTACT. It is required for every academy on the preset (owner
//   ruling, queue item 17) and it is NOT a def: it is a code-level block in
//   buildFields() (EMERGENCY_CONTACT / REQUIRED_INTAKE_LABELS in
//   api/website/offer.js), rendered on the enroll form and on no other form.
//   Adding the two keys HERE would look like a fix and would be a regression:
//   buildFields de-dupes by LOWERCASED LABEL and pushes academy-level defs
//   BEFORE the emergency block, so a def named "Emergency contact name" would
//   win the de-dupe, move the emergency questions up into the athlete section,
//   and take its `required` from the def row instead of REQUIRED_INTAKE_LABELS.
//   Worse, academy-level defs are also spread into `lead_fields`, so the free
//   trial LEAD form would start asking a stranger for their emergency contact.
//   The real gap is a storage one and is recorded at THE KNOWN GAP below.
//
// Auth: Supabase JWT - BAM staff (any academy) or a client_users member of
// client_id. Same shape as api/offers/seed-entry-points.js, deliberately.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const enc = encodeURIComponent;

// ─────────────────────────────────────────────────────────────────────────────
// THE MANIFEST
// ─────────────────────────────────────────────────────────────────────────────
// BAM GTA's three live academy-level defs, verbatim. Read from production on
// 2026-07-31 with:
//
//   select d.key, d.label, d.type, d.required, d.archived, d.offer_id,
//          d.section, d.options, d.position
//     from custom_field_defs d join clients c on c.id = d.client_id
//    where c.business_name = 'BAM GTA' and d.key like 'athlete%';
//
//   athlete_first_name | Athlete's First Name | text   | false | false | null | null | [] | 0
//   athlete_last_name  | Athlete's Last Name  | text   | false | false | null | null | [] | 1
//   athlete_age        | Athlete's Age        | number | false | false | null | null | [] | 2
//
// `required: false` is GTA's live value and is copied rather than "improved".
// Requiredness on the enroll form is decided in buildFields (a def's own
// `required` flag) and this seeder's job is to make the FIELD exist, not to
// legislate the form. Flipping it here would change GTA's own form on the next
// apply, which is the exact overwrite this file refuses to do everywhere else.
//
// `offer_id: null` is what makes these ACADEMY-level rather than offer-scoped:
// buildFields puts offer_id-null defs next to the athlete's name and leaves
// offer-scoped ones at the end. An athlete's name and age belong to the athlete,
// not to whichever offer they bought.
export const CORE_FIELD_MANIFEST = [
  { key: "athlete_first_name", label: "Athlete's First Name", type: "text",   position: 0 },
  { key: "athlete_last_name",  label: "Athlete's Last Name",  type: "text",   position: 1 },
  { key: "athlete_age",        label: "Athlete's Age",        type: "number", position: 2 },
];

// THE KNOWN GAP, recorded here because the seeder is where someone will look for
// it. Emergency contact is REQUIRED on every enroll form and has NOWHERE TO
// LAND. buildFields submits it as `emergency_contact_name__<i>`;
// writePortalFieldValues strips the index and looks the key up in
// custom_field_defs; no academy has that def (0 rows across all 3 academies,
// checked 2026-07-31), so the answer is dropped. It survives only inside
// member_audit_log.args.intake, which is an audit trail, not a field a coach can
// read off a contact. Closing it means teaching writePortalFieldValues to mint a
// def for a code-level intake block, or moving the block into the manifest AND
// fixing the two de-dupe/lead-form consequences described above. It is not a
// one-line change and it is not this build's.

/** The manifest as insert rows for one academy. Pure; exported for the test. */
export function manifestRows(clientId) {
  return CORE_FIELD_MANIFEST.map((f) => ({
    client_id: clientId,
    key: f.key,
    label: f.label,
    type: f.type,
    options: [],
    position: f.position,
    required: false,
    archived: false,
    offer_id: null,
    section: null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PLAN, AS A PURE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
// Every decision this endpoint makes lives here, with no network and no clock,
// so api/_core-fields.test.mjs can assert the RULES rather than assert that
// fetch was called. The handler below is plumbing: read rows, run this, insert.
//
// `existingDefs` must be EVERY def for the academy, archived ones included. Pass
// only the live ones and an archived key looks absent, the insert violates the
// (client_id, key) unique index, and the whole POST fails - so the query that
// feeds this must never carry an `archived=eq.false` filter.
//
// Returns { created, existing, skipped } where:
//   created   rows to insert (the manifest entries with no row at all)
//   existing  keys already present and LIVE - left exactly as they are
//   skipped   keys present but ARCHIVED - deliberately not resurrected
export function planCoreFields(clientId, existingDefs) {
  const byKey = new Map();
  for (const d of existingDefs || []) {
    if (d && typeof d.key === "string") byKey.set(d.key, d);
  }
  const created = [], existing = [], skipped = [];
  for (const row of manifestRows(clientId)) {
    const found = byKey.get(row.key);
    if (!found) { created.push(row); continue; }
    if (found.archived === true) {
      skipped.push({ key: row.key, reason: "archived (a deliberate act; not resurrected)" });
      continue;
    }
    existing.push({ key: row.key, label: found.label });
  }
  return { created, existing, skipped };
}

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
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

// The seed itself, callable in-process (apply-preset chains it) or over HTTP.
// `db` is the Supabase caller, injected so the caller reuses its own and the
// test never needs one.
export async function seedCoreFields(clientId, db = sb) {
  // NO archived filter here, on purpose - see planCoreFields.
  const defs = await db(`custom_field_defs?client_id=eq.${enc(clientId)}&select=key,label,archived`) || [];
  const plan = planCoreFields(clientId, defs);
  if (plan.created.length) {
    await db(`custom_field_defs`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(plan.created),
    });
  }
  return {
    created: plan.created.map((r) => r.key),
    existing: plan.existing.map((r) => r.key),
    skipped: plan.skipped,
  };
}

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = b.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const r = await seedCoreFields(clientId);
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
