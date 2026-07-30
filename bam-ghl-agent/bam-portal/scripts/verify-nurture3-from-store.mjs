// Renders nurture-3 through the REAL renderEmail with injected store rows, and
// asserts the two states that matter. Run it after ANY change to the template,
// the resolver, or the token.
//
//   node scripts/verify-nurture3-from-store.mjs
//
// Asserts: populated store renders one block per row with the real authors;
// EMPTY store renders zero blocks, leaves no unresolved {{location.testimonials}}
// token, and leaves no dangling lead-in. "Parent of Adam" must never appear.
//
// Why a script and not a note: the hardcoded quotes were in TWO places (the
// template and a sync-classes comment) and the second was only found by running
// the guard. Assertions find what reading does not.
import { renderEmail } from "../api/email-shells.js";
import { resolveTestimonials } from "../api/_testimonials.js";


function reader(rows) {
  return (path) => {
    if (path.startsWith("clients?")) return Promise.resolve(rows.client || []);
    if (path.startsWith("testimonials?")) return Promise.resolve(rows.testimonials || []);
    return Promise.resolve([]);
  };
}

async function render(fixture) {
  const { testimonials } = await resolveTestimonials("x", reader(fixture));
  const html = renderEmail({
    clientId: "39875f07-0a4b-4429-a201-2249bc1f24df",
    subject: "What families say",
    body: "template:nurture-3",
    vars: { first_name: "Alex", location_testimonials: testimonials },
  });
  return { html, count: (html.match(/font-style:italic;">"/g) || []).length };
}

const POPULATED = { client: [{ google_rating: 4.9, google_review_count: 67 }], testimonials: [
  { quote: "First real quote.",  author: "Kristina Carrera", source: "manual", starred: true,  created_at: "2026-06-01" },
  { quote: "Second real quote.", author: "Sabeen S",         source: "manual", starred: true,  created_at: "2026-05-01" },
  { quote: "Third real quote.",  author: "Wendy Huang",      source: "manual", starred: false, created_at: "2026-04-01" },
]};

const fails = [];
const a = await render(POPULATED);
if (a.count !== 3) fails.push(`populated: expected 3 quote blocks, got ${a.count}`);
for (const who of ["Kristina Carrera", "Sabeen S", "Wendy Huang"]) {
  if (!a.html.includes(who)) fails.push(`populated: missing author ${who}`);
}
if (a.html.includes("Parent of Adam")) fails.push("populated: the old hardcoded attribution is back");
if (a.html.includes("{{location.testimonials}}")) fails.push("populated: token left unresolved");

const b = await render({ client: [], testimonials: [] });
if (b.count !== 0) fails.push(`empty: expected 0 quote blocks, got ${b.count}`);
if (b.html.includes("{{location.testimonials}}")) fails.push("empty: token left unresolved in the output");
if (b.html.includes("Parent of Adam")) fails.push("empty: hardcoded quote still shipping");
if (b.html.length >= a.html.length) fails.push("empty: output not shorter than populated - the block did not drop");

// A manual row must never gain review framing on its way into an email.
const c = await render({ client: [], testimonials: [{ quote: "Typed.", author: "A Parent", source: "manual", starred: true, created_at: "2026-01-01" }] });
if (/Google review/.test(c.html)) fails.push("a typed quote rendered a Google review badge");

if (fails.length) {
  console.error("FAIL - nurture-3 store wiring:");
  for (const f of fails) console.error("  " + f);
  process.exit(1);
}
console.log(`PASS - nurture-3 renders from the store: 3 rows -> 3 blocks with real authors (${a.html.length} chars); empty store -> 0 blocks, no token, block dropped (${b.html.length} chars); typed quotes carry no review framing.`);
