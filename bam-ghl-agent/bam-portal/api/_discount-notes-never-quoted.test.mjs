// ── `discount_notes` must never reach the sales agent's script ───────────────
//
// THE RULING (Zoran, 2026-08-06). `discount_notes` is a free-text box where an
// academy owner leaves a note FOR OUR TEAM. It was never customer-facing copy,
// and it must never be quoted to a parent.
//
// WHY IT NEEDED A RULING RATHER THAN A TIDY-UP. Until this suite existed,
// renderPricing pushed the note straight into the fact sheet:
//     if (c.discount_notes) out.push(`      Note: ${sentence(c.discount_notes)}`);
// That is the ONE field in the pricing block that routinely carries its own
// arithmetic - an owner works out "$240/mo, save 20%" by hand and never revisits
// it when a price moves. Four of BAM San Jose's six notes are already wrong
// against San Jose's own offer:
//     Unlimited 3 months  note "about $240/mo, save 20%"  truth $249.67/mo, 16.8%
//     Unlimited 6 months  note "about $224/mo, save 25%"  truth $233.17/mo, 22.3%
//     2x/week   6 months  note "save 25%"                 truth 23.3%
//     1x/week   6 months  note "about $150/mo"            truth $145.83/mo
// So the agent would have told a parent a plan works out to $240/month at 20%
// off when it is $250/month at 17% off. That is a live mis-quote, and it is the
// SAME failure the pricing block was rewritten to end in July 2026 (GTA's agent
// quoting $200 for a plan that charges $226) arriving one field later - through
// free text this time instead of through a stale price column.
//
// THIS IS A PRESET CONCERN, NOT A SAN JOSE ONE. Every academy on the sales
// system preset shares this renderer. Four academies carry discount_notes today
// (BAM San Jose, GAME Winner Athletics Facility, Elite Smart Athletes, Hoops
// Made Simple) and NONE of them has a seeded catalog yet, which is the only
// reason nobody has been mis-quoted: renderPricing returns PRICING_NOT_CONFIGURED
// when offer_prices is empty, so the notes are LATENT, not safe. They go live the
// moment a catalog is seeded - which for San Jose is a named launch blocker. Do
// not read "no parent was told this" as "this did not ship".
//
// WHAT THIS SUITE ASSERTS, and the order matters:
//   1. the fixture genuinely CARRIES notes (or absence downstream proves nothing)
//   2. the rendered fact sheet does not contain any note's text
//   3. it does not contain the `Note:` line shape either
//   4. the "if a note disagrees with a plan amount" disclaimer is gone with them
//   5. the notes are still readable in offers.data - staff keep them, agents do not
//   6. the amounts, the includes copy and the fee lines all still render
//
// Point 4 is not tidiness. That disclaimer existed ONLY to defend against these
// notes being wrong; with the notes gone it defends against nothing, and left in
// place it tells the agent some number above may be untrustworthy - inviting
// hedging about amounts that are now all exact.
//
// Point 1 is the lesson from reference_assurance_without_connection: a check
// that "the note is absent" passes perfectly against a fixture that never had a
// note. MUTATE=blind plants exactly that, and this suite must go red for it.
//
// WHY RENDER AND NOT GREP. This repo has been burned by literal-grep leak audits
// giving false verdicts (project_render_over_grep). Every assertion below reads
// the STRING renderPricing actually returned. The two source-shaped controls
// (`note`, `disclaimer`) re-plant real code into api/agent/fact-render.js and are
// judged by what comes out of the renderer afterwards, never by the diff.
//
// Negative controls - each must make this suite FAIL:
//   MUTATE=note        node api/_discount-notes-never-quoted.test.mjs  # the `Note:` push, put back verbatim
//   MUTATE=disclaimer  node api/_discount-notes-never-quoted.test.mjs  # the "a note disagrees" line, put back
//   MUTATE=smuggle     node api/_discount-notes-never-quoted.test.mjs  # the note re-enters via the Includes line instead
//   MUTATE=blind       node api/_discount-notes-never-quoted.test.mjs  # the FIXTURE loses its notes, so absence proves nothing
//
// `smuggle` is here because the obvious check - "no line starts with Note:" -
// would pass while the same owner-typed sentence rode in on another line. The
// rule is about the TEXT reaching a parent, not about one line prefix.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "agent", "fact-render.js");
const ORIGINAL = fs.readFileSync(SRC, "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// Restore is registered before the first write, so a crash, a Ctrl-C or a failed
// assertion all leave fact-render.js byte-identical to how it started.
let dirty = false;
const restore = () => { if (dirty) { fs.writeFileSync(SRC, ORIGINAL); dirty = false; } };
process.on("exit", restore);
process.on("SIGINT", () => { restore(); process.exit(130); });
process.on("SIGTERM", () => { restore(); process.exit(143); });
process.on("uncaughtException", (e) => { restore(); console.error(e); process.exit(1); });

const bail = (msg) => {
  console.log("  ⚠️  MUTATE=" + MUTATE + ": " + msg + " - the control is stale.");
  restore(); process.exit(1);
};

// ── the fixture: BAM San Jose's REAL offer, read from prod 2026-08-06 ─────────
// client_id 5576acf0-acd3-4c05-9f9f-ebfde8618154
// offer     4d15a274-d7cd-4369-82e6-5ebe2f9056c2
// Trimmed to the pricing branch renderPricing reads. The notes are verbatim,
// including their wrong arithmetic - a sanitised fixture would be testing a
// note nobody wrote.
const NOTES = {
  wk1_3mo: "Save 20% vs paying every 4 weeks. Works out to about $141/mo. No sign-up fee.",
  wk1_6mo: "1 month free. Works out to about $150/mo. No sign-up fee.",
  wk2_3mo: "Save 20% vs paying every 4 weeks. Works out to about $200/mo. No sign-up fee.",
  wk2_6mo: "Save 25% vs paying every 4 weeks. Works out to about $192/mo. No sign-up fee.",
  unl_3mo: "Save 20% vs paying every 4 weeks. Works out to about $240/mo. No sign-up fee.",
  unl_6mo: "Save 25% vs paying every 4 weeks. Works out to about $224/mo. No sign-up fee.",
};

const plan = (title, price, c3, c6) => ({
  type: "Membership", title, price, archived: false, signup_fee: "40",
  billing_cycle: "Every 4 weeks", signup_fee_on_base: "charge",
  whats_included: `${title} sessions. Includes a Player Development Plan.`,
  commitments: [
    { after: "Renews same length", price: c3.price, length: "3 Months (12 Weeks)", discount_notes: c3.note, signup_fee_charge: "waive" },
    { after: "Renews same length", price: c6.price, length: "6 Months (24 Weeks)", discount_notes: c6.note, signup_fee_charge: "waive" },
  ],
});

function fixture() {
  // MUTATE=blind strips the notes out of the INPUT. Every "the note is absent"
  // assertion below would then pass for the wrong reason, which is precisely the
  // shape this control exists to expose.
  const n = MUTATE === "blind" ? Object.fromEntries(Object.keys(NOTES).map((k) => [k, ""])) : NOTES;
  return {
    pricing: {
      pricing_model: "Membership",
      pricing_offerings: [
        plan("1 Training/Week",  "175", { price: "425",  note: n.wk1_3mo }, { price: "875",  note: n.wk1_6mo }),
        plan("2 Trainings/Week", "250", { price: "599",  note: n.wk2_3mo }, { price: "1150", note: n.wk2_6mo }),
        plan("Unlimited",        "300", { price: "749",  note: n.unl_3mo }, { price: "1399", note: n.unl_6mo }),
      ],
    },
  };
}

// The catalog rows Stripe would bill. BAM San Jose has clients.tax_config NULL
// and no per-row taxable flags, so applyFee is the identity here and the catalog
// amount IS the owner's typed base - the same rows api/offers/match-prices.js
// mints, keyed `<title>|<term>` exactly as it keys them.
const ROWS = [];
{
  let sort = 0;
  const row = (title, term, dollars, interval) => ROWS.push({
    title: `${title} ${term}`, amount_cents: Math.round(parseFloat(dollars) * 100),
    currency: "USD", billing_interval: interval,
    source_offer_price_key: `${title}|${term}`,
    is_routable: true, is_active: true, sort_order: sort++,
  });
  for (const o of fixture().pricing.pricing_offerings) {
    row(o.title, "monthly", o.price, "4_weeks");
    row(o.title, "3_months", o.commitments[0].price, "3_months");
    row(o.title, "6_months", o.commitments[1].price, "6_months");
    row(o.title, "signup_fee", o.signup_fee, "one_time");
  }
}

// ── the mutations, as edits to the real renderer ─────────────────────────────
// Anchored on code that is actually there today. If an anchor stops matching the
// control bails loudly rather than silently testing nothing.
const TERMS_ANCHOR = '      if (c.whats_included) out.push(`      Includes: ${sentence(c.whats_included)}`);';
const DRIFT_ANCHOR = "  // Reconciliation failed";

const REPLANT = {
  // The exact line that was removed, back where it lived.
  note: (s) => {
    if (!s.includes(TERMS_ANCHOR)) bail("the commitment loop's Includes line no longer matches the anchor");
    return s.replace(TERMS_ANCHOR,
      TERMS_ANCHOR + "\n      if (c.discount_notes) { out.push(`      Note: ${sentence(c.discount_notes)}`); }");
  },
  // The disclaimer alone. It names no note, so it looks harmless - and it is
  // still wrong: it tells the agent an amount above may disagree with something,
  // when every amount above is now exact.
  disclaimer: (s) => {
    if (!s.includes(DRIFT_ANCHOR)) bail("the drift block no longer matches the anchor");
    return s.replace(DRIFT_ANCHOR,
      '  out.push("", "If a note above disagrees with a plan amount, the plan amount is what gets charged.");\n\n' + DRIFT_ANCHOR);
  },
  // The note text reaches the parent WITHOUT the word "Note:" - the check has to
  // be about the sentence, not the label.
  smuggle: (s) => {
    if (!s.includes(TERMS_ANCHOR)) bail("the commitment loop's Includes line no longer matches the anchor");
    return s.replace(TERMS_ANCHOR,
      '      if (c.whats_included || c.discount_notes) out.push(`      Includes: ${sentence([c.whats_included, c.discount_notes].filter(Boolean).join(" "))}`);');
  },
  // Not a source edit - it blunts the FIXTURE (handled in fixture()). Listed here
  // so an unknown MUTATE name is still rejected below.
  blind: null,
};

async function loadRenderer() {
  if (!MUTATE) return await import(pathToFileURL(SRC).href);
  if (!(MUTATE in REPLANT)) bail("no such control");
  const edit = REPLANT[MUTATE];
  if (!edit) return await import(pathToFileURL(SRC).href);   // fixture-side control
  fs.writeFileSync(SRC, edit(ORIGINAL));
  dirty = true;
  // Cache-buster: the unmutated module may already be in the ESM registry.
  return await import(pathToFileURL(SRC).href + "?mutate=" + Date.now());
}

const { renderPricing } = await loadRenderer();

const data = fixture();
const sheet = renderPricing(data, ROWS, null);

console.log("── the fact sheet the agent reads ──────────────────────────────");
console.log(sheet);
console.log("────────────────────────────────────────────────────────────────\n");

// 1. The input genuinely carries notes. Without this, everything below is a
//    check that passes because there was nothing to catch.
const notesInData = data.pricing.pricing_offerings
  .flatMap((o) => o.commitments.map((c) => c.discount_notes))
  .filter((n) => n && String(n).trim());
ok(notesInData.length === 6,
  `the fixture carries all 6 of San Jose's real discount_notes (found ${notesInData.length}) - absence downstream only means something if they were here first`);

// 2. No note's text reaches the sheet. Checked whole and in fragments, because a
//    renderer that truncated or re-wrapped a note would still be quoting it.
for (const [key, text] of Object.entries(NOTES)) {
  ok(!sheet.includes(text), `${key}: the owner's note is not in the fact sheet`);
}
const FRAGMENTS = ["Works out to about", "Save 20%", "Save 25%", "1 month free", "No sign-up fee.", "$141/mo", "$150/mo", "$192/mo", "$200/mo", "$224/mo", "$240/mo"];
for (const f of FRAGMENTS) {
  ok(!sheet.includes(f), `no fragment of an owner-typed note survives: "${f}"`);
}

// 3. The line shape is gone too.
ok(!/^\s*Note:/m.test(sheet), "no `Note:` line is emitted at all");

// 4. The disclaimer went with the notes.
ok(!/disagrees with a plan amount/i.test(sheet),
  "the 'if a note disagrees with a plan amount' disclaimer is gone - it defended against the notes and has nothing left to defend against");
ok(!/\bnote\b/i.test(sheet),
  "the sheet does not mention notes at all, so the agent is never pointed at owner free text");

// 5. The note is NOT deleted from the offer - staff keep it, agents do not get it.
ok(data.pricing.pricing_offerings[2].commitments[0].discount_notes === NOTES.unl_3mo,
  "renderPricing does not mutate the offer: the note is still in offers.data for staff");

// 6. Everything the sheet is FOR still renders. A fix that quietly emptied the
//    pricing facts would pass 1-5 and be far worse than the defect.
ok(sheet.includes("$749.00") && sheet.includes("$1399.00") && sheet.includes("$300.00"),
  "the exact charged amounts still render (3-month, 6-month and monthly Unlimited)");
ok(sheet.includes("3 months prepaid:") && sheet.includes("6 months prepaid:"),
  "both commitment terms still render");
ok(sheet.includes("then renews same length"),
  "what happens when a commitment ends still renders (offer free text that is NOT a price claim)");
ok(sheet.includes("One-time sign-up fee: $40.00"),
  "the one-time sign-up fee still renders");
ok(sheet.includes("Includes a Player Development Plan"),
  "whats_included still renders");
ok(sheet.includes("Range: $175.00 to $300.00 every 4 weeks."),
  "the range line still renders");

// The one number a parent could have been mis-quoted: prove the sheet carries the
// TRUE per-month figure's source ($749.00 over 3 months) and never the owner's
// wrong one ($240/mo). This is the assertion the whole ruling is about.
ok(sheet.includes("$749.00") && !sheet.includes("$240/mo"),
  "Unlimited 3 months states the charged $749.00 and never the owner's wrong 'about $240/mo'");

restore();
console.log("");
if (MUTATE) {
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
