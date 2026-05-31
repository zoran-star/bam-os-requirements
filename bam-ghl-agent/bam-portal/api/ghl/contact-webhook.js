// GHL → BAM contact sync webhook.
//
// Trigger from GHL Workflow: "Contact Update" or "Contact Created" event →
// POST to https://portal.byanymeansbusiness.com/api/ghl/contact-webhook
// with the static shared secret in X-Webhook-Secret. Keeps BAM's
// members.parent_email + members.parent_phone fresh whenever a parent
// edits their info in GHL.
//
// Match key:  body.id (GHL contact_id)  →  members.ghl_contact_id
// Safety:     verifies the payload's locationId matches the member's
//             client.ghl_location_id — prevents one academy's webhook
//             from touching another academy's members row.
//
// Idempotent: a no-op patch (same email/phone we already have) returns
// {ok: true, changed: 0} without writing.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

const nowIso = () => new Date().toISOString();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

  // Auth — shared static secret in X-Webhook-Secret header
  const secret = process.env.GHL_CONTACT_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: "GHL_CONTACT_WEBHOOK_SECRET not configured" });
  const provided = req.headers["x-webhook-secret"] || req.headers["X-Webhook-Secret"];
  if (provided !== secret) return res.status(401).json({ error: "invalid webhook secret" });

  const body = (req.body && typeof req.body === "object") ? req.body : {};

  // GHL contact payloads vary slightly across event types — pull from
  // both common shapes (flat OR nested under .contact).
  const contact = body.contact && typeof body.contact === "object" ? body.contact : body;
  const ghlContactId = contact.id || contact.contactId || body.id || null;
  const ghlLocationId = body.locationId || contact.locationId || null;
  const incomingEmail = (contact.email || "").toLowerCase().trim() || null;
  const incomingPhone = contact.phone || null;
  const incomingFirstName = contact.firstName || null;
  const incomingLastName  = contact.lastName  || null;

  if (!ghlContactId) {
    return res.status(400).json({ error: "missing contact id", received_keys: Object.keys(body) });
  }

  // Look up the member by their ghl_contact_id
  const memberRows = await sb(
    `members?ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}` +
    `&select=id,client_id,parent_email,parent_phone,parent_name,athlete_name&limit=1`
  ).catch(() => []);
  const member = Array.isArray(memberRows) && memberRows[0];

  if (!member) {
    // No member matches — not an error (could be a lead, or a contact we
    // haven't linked yet). Acknowledge and move on.
    return res.status(200).json({ ok: true, matched: false, contact_id: ghlContactId });
  }

  // Safety: confirm the payload's location matches the member's client.
  if (ghlLocationId) {
    const clientRows = await sb(
      `clients?id=eq.${member.client_id}&select=ghl_location_id`
    ).catch(() => []);
    const expectedLoc = clientRows?.[0]?.ghl_location_id;
    if (expectedLoc && expectedLoc !== ghlLocationId) {
      return res.status(403).json({
        error: "location mismatch — webhook payload location_id does not match the member's client",
        member_id: member.id,
      });
    }
  }

  // Build a diff against the current row — only patch what actually changed.
  const patch = {};
  if (incomingEmail && incomingEmail !== (member.parent_email || "").toLowerCase()) {
    patch.parent_email = incomingEmail;
  }
  if (incomingPhone && incomingPhone !== member.parent_phone) {
    patch.parent_phone = incomingPhone;
  }
  // Optional: also keep parent_name in sync if GHL has a name and ours is blank.
  if (incomingFirstName || incomingLastName) {
    const incomingFullName = [incomingFirstName, incomingLastName].filter(Boolean).join(" ").trim();
    if (incomingFullName && !member.parent_name) {
      patch.parent_name = incomingFullName;
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(200).json({ ok: true, matched: true, changed: 0, member_id: member.id });
  }

  patch.updated_at = nowIso();
  await sb(`members?id=eq.${member.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });

  // Audit
  try {
    await sb(`member_audit_log`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id:         member.client_id,
        member_id:         member.id,
        action_type:       "ghl-contact-synced",
        args:              { contact_id: ghlContactId, fields: Object.keys(patch).filter(k => k !== "updated_at") },
        performed_by_name: "GHL Webhook",
        db_changes:        { members: patch },
      }]),
    });
  } catch (_) { /* audit failure is non-fatal */ }

  return res.status(200).json({
    ok: true,
    matched: true,
    changed: Object.keys(patch).filter(k => k !== "updated_at").length,
    member_id: member.id,
    fields_changed: Object.keys(patch).filter(k => k !== "updated_at"),
  });
}
