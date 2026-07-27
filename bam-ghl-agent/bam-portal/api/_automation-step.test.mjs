import { buildStepRow } from "./_automation-step.js";
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:fail++;console.log((c?"  ✅ ":"  ❌ ")+m);};

// A PATCH body only overwrites the keys it contains, so "preserved" means the
// key is ABSENT from the row - not that it carries some guessed value.
const edit = { id: "step-1", automation_id: "auto-1", position: 2, wait_amount: 1, wait_unit: "days", channel: "email", subject: "s", body: "new wording" };

// THE regression: the portal's step editor saves wording and sends no `enabled`.
// Before the fix this row carried enabled:true and re-enabled San Jose's
// deliberately-off nurture-3 step (BAM GTA's real parent testimonials).
let r = buildStepRow(edit);
ok(!("enabled" in r), "update without `enabled` -> key omitted, existing enabled:false survives");
ok(r.body === "new wording" && r.subject === "s", "update still writes the edited copy");

// Siblings: an explicit value is always honoured, both directions.
ok(buildStepRow({ ...edit, enabled: true }).enabled === true, "update with enabled:true -> enables");
ok(buildStepRow({ ...edit, enabled: false }).enabled === false, "update with enabled:false -> disables");

// INSERT: no existing value to preserve, so a brand-new step starts on.
const add = { automation_id: "auto-1", position: 0, wait_amount: 1, wait_unit: "days", channel: "sms", body: "New step - edit me" };
ok(buildStepRow(add).enabled === true, "insert without `enabled` -> created enabled");
ok(buildStepRow({ ...add, enabled: false }).enabled === false, "insert with enabled:false -> created disabled");

// Truthy/falsy callers are still coerced to a real boolean.
ok(buildStepRow({ ...edit, enabled: 1 }).enabled === true, "update with enabled:1 -> true");
ok(buildStepRow({ ...edit, enabled: 0 }).enabled === false, "update with enabled:0 -> false");
// null is a value, not silence: an explicit null disables rather than omitting.
ok(buildStepRow({ ...edit, enabled: null }).enabled === false, "update with enabled:null -> explicit, disables");

// The rest of the row is unchanged by the fix.
r = buildStepRow(edit, { nowIso: "2026-07-27T00:00:00.000Z" });
ok(r.automation_id === "auto-1" && r.position === 2 && r.wait_amount === 1 && r.wait_unit === "days" && r.channel === "email", "carries the other step fields through");
ok(r.updated_at === "2026-07-27T00:00:00.000Z", "stamps updated_at");
ok(buildStepRow({ ...edit, subject: undefined }).subject === null, "missing subject -> null");
ok(buildStepRow({ ...edit, position: undefined, wait_amount: undefined, wait_unit: undefined }).wait_unit === "days", "defaults position/wait fall back");

console.log(`\n${fail?"❌":"✅ ALL PASS"}: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);
