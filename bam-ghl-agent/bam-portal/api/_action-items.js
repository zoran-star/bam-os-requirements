// SYSTEM ACTION ITEMS: the one copy of "create an action item no human asked
// for", shared by every route that mints one.
//
// WHY THIS IS ITS OWN MODULE. This function used to live privately inside
// api/members.js, where the off-card cron calls it. The member apply engine
// (api/workbook.js) creates the SAME kind of item - takeover, missing-phone,
// stop-billing - and a second copy would be a second place the idempotency rule
// could drift. The idempotency IS the load-bearing part (two overlapping runs
// must not double-announce), so it lives once.
//
// sb IS INJECTED rather than imported here. Every route in this repo carries its
// own service-key `sb()` (members.js, workbook.js each build the Authorization
// header through their own header-safe guard), and this module must not open a
// second transport with its own view of the env. The caller hands in the sb it
// already trusts; this file only owns the SHAPE of the write and the dedupe.

export const isDuplicateErr = (e) =>
  /23505|duplicate key/i.test(String((e && e.message) || e || ""));

// THE MACHINE'S NAME FOR WHY AN ITEM EXISTS, independent of the copy it carries.
// A typed key (not a title-string match) is what lets a re-run find the same item
// again and a copy edit not orphan the banner. The collect + stop-billing keys
// live in api/_off-card.js (their home); the two the member apply engine mints
// live here, beside the creator that writes them.
export const systemKeyForTakeover = (memberId) => `takeover:${memberId}`;
export const systemKeyForMissingPhone = (memberId) => `missing-phone:${memberId}`;

// Create an action item that NO HUMAN asked for.
//
// Idempotency is the unique index on (client_id, system_key), not a check here.
// Two overlapping runs both insert; Postgres rejects the second with 23505; this
// returns { created:false } and the caller does not announce it twice. There is
// no read-then-write window to lose.
//
// created_by is left NULL (a cron or an apply has no auth.users id) and
// created_by_role is 'system', which the widened CHECK admits.
export async function createSystemActionItem(sb, { client_id, system_key, title, description, due_date, assignee_id, assignee_name }) {
  try {
    const rows = await sb(`action_items`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        client_id, system_key, title,
        description: description || null,
        due_date: due_date || null,
        assignee_id: assignee_id || null,
        assignee_name: assignee_name || null,
        created_by: null,
        created_by_name: "FullControl",
        created_by_role: "system",
      }),
    });
    const item = Array.isArray(rows) ? rows[0] : rows;
    return { created: true, item };
  } catch (e) {
    if (!isDuplicateErr(e)) throw e;
    const existing = await sb(
      `action_items?client_id=eq.${encodeURIComponent(client_id)}&system_key=eq.${encodeURIComponent(system_key)}&select=*&limit=1`
    ).catch(() => null);
    return { created: false, item: (Array.isArray(existing) && existing[0]) || null };
  }
}
