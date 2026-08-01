// bulkUpsertPortalContacts bucketing suite.
//
// THE BUG THIS PINS. PostgREST rejects a bulk insert whose objects do not all
// share the same keys (PGRST102 "All object keys must match") and it rejects
// the WHOLE batch. clean() strips empty fields per row, so any realistic batch
// (one contact has an email, the next does not) is heterogeneous - and because
// bulkUpsertPortalContacts swallows its own errors, every such batch silently
// vanished. Found live 2026-08-01: the SJ contact refresh reported "upserted:
// 555" while the contacts table took 0 rows; the v15 sync cron dual-write had
// been losing mixed batches the same way. The fix buckets cleaned rows by
// their exact key set and posts each homogeneous bucket separately.
//
// The fake fetch below enforces the same rule real PostgREST does, so this
// suite fails against the old flat-batch code, not just against a stub.
//
// Run: node api/_contacts-bulk.test.mjs
// Negative control: MUTATE=mixed node api/_contacts-bulk.test.mjs
//   (feeds the strict fake a deliberately mixed batch to prove the PGRST102
//   enforcement is real, not decorative; prints what it caught)

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || "http://fake.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "fake-key";

const MUTATE = process.env.MUTATE || "";
let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ` - ${detail}` : ""}`); }
}

// Strict fake PostgREST: accepts POSTs, enforces the homogeneous-keys rule.
const posts = [];
function postgrestKeysMatch(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  const sig = JSON.stringify(Object.keys(rows[0]).sort());
  return rows.every((r) => JSON.stringify(Object.keys(r).sort()) === sig);
}
globalThis.fetch = async (url, init = {}) => {
  const method = (init.method || "GET").toUpperCase();
  if (method === "GET") {
    // withAthleteName's clients lookup and friends: empty result is fine.
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  }
  const rows = JSON.parse(init.body || "[]");
  if (method === "POST" && !postgrestKeysMatch(rows)) {
    return {
      ok: false, status: 400,
      text: async () => JSON.stringify({ code: "PGRST102", message: "All object keys must match" }),
      json: async () => ({ code: "PGRST102", message: "All object keys must match" }),
    };
  }
  posts.push({ url: String(url), rows });
  return { ok: true, status: 201, text: async () => "", json: async () => null };
};

const { bulkUpsertPortalContacts } = await import("./_contacts.js");

console.log("── bulkUpsertPortalContacts bucketing ──");

if (MUTATE === "mixed") {
  // Control: prove the fake's PGRST102 enforcement actually rejects a mixed
  // batch. If this "passes" the enforcement is decorative and the whole suite
  // proves nothing.
  const res = await globalThis.fetch("http://fake.test/rest/v1/contacts", {
    method: "POST",
    body: JSON.stringify([
      { client_id: "c", ghl_contact_id: "1", email: "a@b.c" },
      { client_id: "c", ghl_contact_id: "2" },
    ]),
  });
  if (res.ok === false && res.status === 400) {
    console.log("NEGATIVE CONTROL PASSED: control caught: the strict fake rejected a mixed-key batch with PGRST102");
    process.exit(0);
  }
  console.log("NEGATIVE CONTROL FAILED: the fake accepted a mixed-key batch; the suite's enforcement is decorative");
  process.exit(1);
}

// 1. A realistic heterogeneous batch: rows diverge after clean() (email
// missing on one, tags empty on another) plus a keyless-junk row that clean()
// cannot save. The old flat-batch code returns 0 here (whole batch bounced).
const batch = [
  { client_id: "c1", ghl_contact_id: "g1", name: "Full Row", email: "full@x.co", phone: "+14085550101", tags: ["a"] },
  { client_id: "c1", ghl_contact_id: "g2", name: "No Email", phone: "+14085550102", tags: [] },
  { client_id: "c1", ghl_contact_id: "g3", name: "Phone Only", email: "", phone: "+14085550103" },
  { client_id: "c1", ghl_contact_id: "g4" },
  { client_id: "c1" }, // no ghl_contact_id: filtered out, never posted
];
const posted = await bulkUpsertPortalContacts(batch);

check("returns the number of rows actually posted (4)", posted === 4, `got ${posted}`);
check("row without ghl_contact_id is filtered, not posted", posts.every((p) => p.rows.every((r) => r.ghl_contact_id)));
check("every POST batch is homogeneous (fake enforced PGRST102)", posts.every((p) => postgrestKeysMatch(p.rows)));
const allRows = posts.flatMap((p) => p.rows);
check("all 4 keepable rows reached the store across buckets", allRows.length === 4, `got ${allRows.length}`);
check("bucketing preserved values (g2 kept its phone, lost nothing)",
  allRows.some((r) => r.ghl_contact_id === "g2" && r.phone === "+14085550102" && !("email" in r)));
check("upsert target + conflict key unchanged",
  posts.every((p) => p.url.includes("contacts?on_conflict=client_id,ghl_contact_id")));

// 2. Homogeneous batches still go out as ONE post (no pointless splitting).
posts.length = 0;
const uniform = [
  { client_id: "c1", ghl_contact_id: "u1", name: "A", email: "a@x.co" },
  { client_id: "c1", ghl_contact_id: "u2", name: "B", email: "b@x.co" },
];
const postedUniform = await bulkUpsertPortalContacts(uniform);
check("uniform batch posts once", posts.length === 1, `got ${posts.length} posts`);
check("uniform batch returns full count", postedUniform === 2, `got ${postedUniform}`);

// 3. Failure honesty: a mid-flight hard failure returns the partial count,
// never the full one. Make the fake reject everything.
posts.length = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if ((init.method || "GET").toUpperCase() === "GET") return { ok: true, json: async () => [], text: async () => "[]" };
  return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
};
const postedFail = await bulkUpsertPortalContacts(uniform);
globalThis.fetch = realFetch;
check("hard failure returns 0, not the input length", postedFail === 0, `got ${postedFail}`);

console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
