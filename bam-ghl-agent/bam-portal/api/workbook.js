import { withSentryApiRoute } from "./_sentry.js";
import { assertHeaderSafeCredential, safeFetch } from "./_header-safe-credential.js";
import { randomBytes } from "node:crypto";

// Vercel Serverless Function - THE OWNER-FACING WORKBOOK, and the only surface
// through which an academy owner touches what his academy sells.
//
//   GET  /api/workbook?token=<token>     the whole workbook, by link
//   POST /api/workbook  { token, action: "save" | "add" | "remove" | "confirm"
//                                        | "submit", ... }
//   POST /api/workbook  { action: "create", client_id, kind }   STAFF ONLY
//   POST /api/workbook  { action: "review" | "approve-card" | "apply"
//                                 | "publish" | "rollback", workbook_id, ... }
//                                                                STAFF ONLY
//                       (the review-and-apply half, further down this file)
//
// THREE VALUES, AND CONFLATING ANY PAIR IS THE BUG THIS EXISTS TO PREVENT:
//   current_value  what the portal stores TODAY          "2 Trainings/Week"
//   proposed       what WE SHOWED the owner              "Academy 2x/week"
//   answered       what he SENT BACK
// Staff review compares CURRENT_VALUE against ANSWERED. For San Jose three of
// four plan names differ between current and proposed, so a card the owner
// merely CONFIRMS WITHOUT EDITING still renames the plan - and it must record as
// a real change, never as an untouched row. That single sentence is why confirm
// below MATERIALIZES answered from proposed instead of leaving it null: a null
// answered would make staff review compare a value against nothing and read a
// rename as "he did not touch it".
//
// THE TOKEN IS THE CREDENTIAL. There is no login (accepted risk, with a date -
// see the migration header). So: it is resolved SERVER-SIDE with the service
// key, the owner's browser never talks to Supabase, RLS is on with zero
// policies, and the token is never echoed into a response body, a log line or an
// error. The ONE exception is the staff-authenticated create action, which has
// to hand the link back to the human who just minted it - nothing else can read
// it, precisely because RLS has no policies. It is flagged there, not buried.
//
// WHY THE SUPABASE CALLS GO THROUGH api/_header-safe-credential.js: this repo
// shipped a live credential to a browser once. A key with an embedded line break
// reaches fetch, undici throws a TypeError QUOTING THE WHOLE HEADER, that error
// carries no .status, and a route doing `e.status || 500` + `e.message` returns
// it. Both halves are closed here - the credential is refused before it can
// become a header, and the catch at the bottom only ever forwards a message we
// wrote ourselves.

// `code` is a STABLE MACHINE TAG on the refusals a page has to tell apart -
// "you have reached the limit" must not arrive as an indistinguishable 400 that
// the owner reads as "something went wrong". The sentence stays the thing a
// human reads; the code is what the page branches on.
const bad = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const nowIso = () => new Date().toISOString();
const enc = (v) => encodeURIComponent(String(v == null ? "" : v));

const sbUrl = () => process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";

// Read LAZILY, never at module load: a serverless function that captures env at
// import time cannot be re-pointed, and a suite cannot exercise a broken
// credential without re-importing the whole module.
function sbKey() {
  return assertHeaderSafeCredential(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    "the Supabase service key (SUPABASE_SERVICE_ROLE_KEY)"
  );
}

async function sb(path, init = {}) {
  const key = sbKey();
  const res = await safeFetch(`${sbUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  }, "Supabase");
  if (!res.ok) {
    // THE QUERY STRING IS DELIBERATELY NOT IN THIS MESSAGE. The token travels as
    // a filter (`workbooks?token=eq.<token>`), so a message built from the path
    // would put the credential into an error - and from there into a log. The
    // table name is enough to debug with; the response body is kept because
    // PostgREST's code (42703 and friends) is what the graceful degradations
    // below switch on.
    throw new Error(`Supabase ${res.status} on ${String(path).split("?")[0]}: ${await res.text()}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ── staff auth: the same shape api/stripe/direct-key.js uses ─────────────────
// The caller's bearer goes through the credential guard too. It is not OUR
// secret, but it is a value that becomes a header, and a token with a break in
// it produces the identical quoting TypeError. Refused as a 401 rather than as
// the guard's statusless 500, because here the caller really did send something
// wrong - and the sentence carries no credential material either way.
async function resolveStaff(req) {
  const raw = String((req.headers && req.headers.authorization) || "").replace(/^Bearer\s+/i, "");
  let bearer;
  try {
    bearer = assertHeaderSafeCredential(raw, "the staff auth token");
  } catch {
    throw bad("auth required", 401);
  }
  const key = sbKey();
  const userRes = await safeFetch(`${sbUrl()}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${bearer}` },
  }, "Supabase");
  if (!userRes.ok) throw bad("invalid token", 401);
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${enc(user.id)}&select=id,name,email&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${enc(user.email)}&select=id,name,email&limit=1`);
  }
  if (!Array.isArray(staff) || !staff[0]) throw bad("BAM staff only", 403);
  return { user, staff: staff[0] };
}

const actorName = (staff, user) =>
  String((staff && staff.name) || "").trim()
  || String((staff && staff.email) || "").trim()
  || String((user && user.email) || "").trim()
  || `staff:${staff.id}`;

// ── comparing two jsonb values ───────────────────────────────────────────────
//
// DEEP EQUALITY, and the rules are written down because every one of them
// decides whether a real price change reads as "he did not touch it":
//
//   NULL AND ABSENT ARE THE SAME THING - "no value". SQL NULL, JSON null and a
//   missing key are indistinguishable once PostgREST hands them over, so
//   pretending to tell them apart would be a fiction. CONSEQUENCE THE PAGE MUST
//   KNOW: sending `answered: null` does NOT mean "the owner cleared this field",
//   it means "no answer recorded" and the effective answer falls back to
//   `proposed`. To record an empty value, send "" (an empty string), which is a
//   value and compares unequal to a null current_value.
//   OBJECTS are compared key-insensitively to ORDER (jsonb does not preserve it)
//   but strictly to the SET of keys: an added key is a change.
//   ARRAYS are ORDER-SENSITIVE. Reordering commitment rungs or discount codes is
//   a change; it changes what the owner sees and what we would write.
//   PRIMITIVES are compared with ===, with NO coercion and NO trimming. "226"
//   and 226 are different answers, and so are "Academy 2x/week" and
//   "Academy 2x/week " - this is a MONEY surface, and a difference nobody can
//   see is exactly the difference staff must be shown rather than have silently
//   normalized away.
function isBlank(v) { return v === null || v === undefined; }

function jsonEqual(a, b) {
  if (a === b) return true;
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => jsonEqual(a[k], b[k]));
  }
  return false;
}

// WHAT THE OWNER'S ANSWER ACTUALLY IS. An answer he never edited is not "no
// opinion": the card put `proposed` in front of him, so confirming the card IS
// answering `proposed`. Falling back to it here - and writing it down at confirm
// time - is what makes the San Jose rename record as a change.
const effective = (a) => (isBlank(a.answered) ? a.proposed : a.answered);

// ── OWNER ADDITIONS: a REQUEST, never a write to configuration ───────────────
//
// Zoran's ruling, 2026-08-05: the three "+ Add" buttons stay, and what they
// produce is something STAFF READ AND ACT ON BY HAND - "ADDED BY OWNER - needs
// creating", with Create and Discard next to it. Nothing an owner adds ever
// auto-creates anything, which is the whole reason this is safe to expose on a
// link with no login: there is no create-at-apply-time to get wrong, because a
// human does the creating.
//
// AN ADDITION IS A workbook_answers ROW WITH target_id NULL, and its marker is
// its target_field: 'add:plan', 'add:length', 'add:code'. That is deliberately
// QUERYABLE rather than a convention someone has to remember - staff review
// surfaces additions separately with
//
//   workbook_answers?workbook_id=eq.<id>&target_field=like.add:*
//
// "you will spot it by target_id being null" is not a rule, it is a hope.
//
// current_value is null (the portal stores nothing for it) and proposed is null
// (we proposed nothing - HE did). So `answered` is the whole of it, which also
// means an addition can never be "confirmed without editing" the way a prefilled
// row can.
const ADD_PREFIX = "add:";
const isAddition = (a) => typeof a.target_field === "string" && a.target_field.startsWith(ADD_PREFIX);

// WHAT A CARD PERMITS IS DERIVED FROM THE CARD, NEVER FROM THE PAYLOAD. This is
// the difference between "the owner may add a rung to this plan" and "the token
// may aim a write at any row in the database". A card_key this does not
// recognise takes NO additions - it fails CLOSED, and the tax card can never
// grow a row.
function addableOn(cardKey) {
  const k = String(cardKey || "");
  if (k.startsWith("plan:")) return ["length"];              // another commitment rung on THIS plan
  if (k === "plans" || k.startsWith("plans:")) return ["plan"];
  if (k === "codes" || k.startsWith("codes:")) return ["code"];
  return [];
}

// ── THE CAPS, and why these numbers ─────────────────────────────────────────
// A no-login link that can create unlimited rows is a denial of service on our
// own database, written by us, reachable by anyone who ever sees the URL.
//   6 PER CARD          - San Jose's entire price workbook is four plans. Six
//                         additions on one card is already past any honest
//                         answer, and it stops a scripted loop at six.
//   20 PER WORKBOOK     - more additions than a reviewer would hand-create in
//                         one sitting. Past that this is not a workbook being
//                         corrected, it is a data-entry surface, and the right
//                         response is a conversation rather than more rows.
//   2000 CHARS EACH     - a row cap is not a byte cap. Without this, twenty
//                         rows can still be twenty megabytes. The row is a
//                         sentence a human reads, not a document.
const MAX_ADD_PER_CARD = 6;
const MAX_ADD_PER_WORKBOOK = 20;
const MAX_ADD_CHARS = 2000;

// The minimum an addition must carry to be ACTIONABLE. Staff have to be able to
// create the thing by hand from this row alone, so a plan with no price is not a
// request, it is a riddle. Extra keys are passed through untouched - the page
// owns its own vocabulary - and only these are required.
const str = (v) => (typeof v === "string" ? v.trim() : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// HOW MANY MORE THIS CARD WILL TAKE, both caps folded into one number the page
// can show BEFORE the owner clicks. A limit he only discovers by hitting it is
// a limit that reads as a bug.
const addLeft = (card, mine, all) => (addableOn(card.card_key).length
  ? Math.max(0, Math.min(
    MAX_ADD_PER_CARD - mine.filter(isAddition).length,
    MAX_ADD_PER_WORKBOOK - all.filter(isAddition).length))
  : 0);

// WHERE AN ADDITION IS AIMED, derived and never taken from the payload.
//
// The card's own answers first - they all point at the same table by
// construction, so they are the accurate source. But a card can legitimately
// have NONE: "+ Add a plan you sell that isn't here" belongs to a `plans` card
// that exists precisely because those plans are missing, and requiring a sibling
// would make the one card whose entire purpose is additions the one card that
// refuses them. So the workbook's other answers are the fallback - still real
// rows, still not invented.
//
// AND IF NEITHER EXISTS, IT REFUSES. There is no third branch that makes up a
// table name. A guessed target_table on a row a human is about to act on is
// worse than a refusal, because it looks like a fact.
function deriveTarget(mine, all) {
  const from = (rows) => rows.find((a) => !isAddition(a) && a.target_table);
  const own = from(mine);
  if (own) return { target_kind: own.target_kind, target_table: own.target_table };
  const counts = new Map();
  for (const a of all) {
    if (isAddition(a) || !a.target_table) continue;
    // Keyed by a JSON pair rather than a joined string: a separator is a value
    // that can appear in the data, and the one thing this function must never do
    // is hand back a target it assembled wrong.
    const k = JSON.stringify([a.target_kind, a.target_table]);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null, top = 0;
  for (const [k, n] of counts) if (n > top) { top = n; best = k; }
  if (!best) return null;
  const [target_kind, target_table] = JSON.parse(best);
  return { target_kind, target_table };
}

const ADD_KINDS = {
  plan: (v) => (!str(v.title) ? "Please give the plan a name before adding it."
    : num(v.price) === null || num(v.price) < 0 ? "Please add a price for this plan before adding it." : ""),
  length: (v) => (num(v.months) === null || !Number.isInteger(v.months) || v.months < 1 || v.months > 120
    ? "Please say how many months this length runs for."
    : num(v.price) === null || num(v.price) < 0 ? "Please add a price for this length before adding it." : ""),
  code: (v) => (!str(v.code) ? "Please type the discount code before adding it." : ""),
};

// ── THE STATE RULE, all of it, in one function ───────────────────────────────
//
//   'untouched'  nobody has acted on this card
//   'changed'    acted on, and at least one effective answer differs from what
//                the portal stores today
//   'confirmed'  acted on by an explicit CONFIRM, and nothing differs
//
// TWO PROPERTIES ARE LOAD-BEARING AND BOTH COME FROM ZORAN'S RULING THAT
// "CONFIRMED" IS A DELIBERATE ACT DISTINCT FROM "UNTOUCHED":
//
//   1. 'confirmed' can ONLY be produced by pressing confirm. Never by a save.
//   2. An AUTOSAVE THAT MERELY ECHOES `proposed` BACK IS NOT AN ACT. The page
//      prefills each field with proposed and autosaves constantly, so if any
//      save at all counted as acting on the card, an unread card would flip to
//      'changed' by itself - and 'changed' satisfies the submit gate. An unread
//      card would then serialize exactly like an approved one, which is the one
//      thing the schema exists to prevent. Only a save whose value DIFFERS from
//      what we showed is an act, because only that could have come from a human.
//
// `acted` is not a column: the state column already carries it (anything other
// than 'untouched' means something happened), plus confirmed_at, plus whatever
// this very request just did.
function cardState(card, answers, actedNow = false) {
  // AN ADDITION IS BY DEFINITION A CHANGE, and no confirm can talk it back into
  // 'confirmed'. The owner asking for something that does not exist yet is the
  // loudest thing a card can say; a card reading "confirmed by you" while it
  // holds a request for a plan we do not sell would be the same lie as a rename
  // recorded as an untouched row.
  //
  // AND IT IS NOT REDUNDANT, though it looks it. A populated addition already
  // differs from current_value (which is null), so the ordinary difference rule
  // below would catch it - as long as `answered` is never empty, which the add
  // and save validators enforce. That is safety borrowed from two other
  // functions. An addition row with a null answered - which a direct SQL write,
  // a seeder or a later staff-side path can produce - has effective === null ===
  // current_value, differs from nothing, and would read 'confirmed'. A card
  // holding a request for something we do not sell would then tell staff the
  // owner approved it as-is. This line is what makes the rule true here rather
  // than true elsewhere.
  const added = answers.some(isAddition);
  const acted = actedNow || added || !!card.confirmed_at || (card.state && card.state !== "untouched");
  if (!acted) return "untouched";
  if (added) return "changed";
  if (answers.some((a) => !jsonEqual(effective(a), a.current_value))) return "changed";
  // Acted on, nothing differs, and no confirm: an edit that landed back on what
  // the portal already stores is not an approval of the card. Back to untouched,
  // so the submit gate still asks for the deliberate act.
  return card.confirmed_at ? "confirmed" : "untouched";
}

const OPEN_STATES = new Set(["draft", "sent"]);

// ── WHAT SATISFIES THE SUBMIT GATE, and why it is NOT the state string ───────
//
// `state` says WHAT the answer is: the same as what we store, or different.
// `confirmed_at` says WHETHER the owner approved it. Those are orthogonal, and
// conflating them is how the gate was defeated.
//
// The gate used to accept state 'changed'. But a plain autosave of a genuinely
// edited value produces 'changed' with NO confirm, so a card the owner typed
// into and never approved satisfied "every row has to be confirmed". Caught by
// driving the real page against the real database: submit went through with
// confirmed_at null. The state-based rule was checking the wrong noun.
//
// It is the DELIBERATE ACT that the ruling asks for, and confirmed_at is the
// only record of a deliberate act. `changed` after a confirm still passes,
// because confirming something that differs is still confirming it - which is
// exactly San Jose's three renames.
const cardIsReady = (card) => !!(card && card.confirmed_at);

// ── WHICH CARDS THE SUBMIT GATE COUNTS ───────────────────────────────────────
//
// A CARD WITH NO ANSWERS AND NO ADDITIONS HAS NOTHING TO REVIEW, so it cannot
// hold Send hostage. The product owner approved a SEVEN-card workbook and got
// there by cutting two cards for exactly this reason: a card that could only
// ever answer "none" was a mandatory click that taught us nothing. The empty
// "anything missing?" card exists in the table because an addition needs a card
// to belong to - the card is the unit of confirmation - but it must not become
// the eighth mandatory click by the back door.
//
// THE DISCRIMINATOR IS EMPTINESS, MEASURED FROM THE ROWS, and it is nothing
// else. Not a card_key, not a flag, not anything seeding or a payload can set.
// That distinction is the whole safety of this rule: a "this card is optional"
// flag would hand seeding the power to make a REAL question invisible to the
// gate, which is the no-partial-submit ruling defeated from the inside by the
// people it binds. A card with answers ALWAYS counts. There is no opt-out, and
// there is deliberately no way to write one.
//
// A card with no answers cannot hold an answer either - there is no row for one
// to live in - so "nothing to review" is a fact about the data rather than a
// judgement about the card.
const cardCounts = (answers) => (answers || []).length > 0;

// remaining, computed from the LIVE ROWS every time, with an optional override
// for the card this request just changed (whose new state is not in the table
// yet at the moment we answer). The page prints this number to the owner as
// "Confirm the remaining N cards to send", so a stale N is a lie on his screen.
function remainingFor(cards, allAnswers, overrideCardId, overrideState, overrideConfirmedAt) {
  const grouped = byCard(allAnswers || []);
  let n = 0;
  for (const c of cards) {
    if (!cardCounts(grouped.get(c.id))) continue;
    // The card this request just changed is not in the table yet at the moment
    // we answer, so its confirmed_at is passed in alongside its state.
    const confirmedAt = c.id === overrideCardId && overrideConfirmedAt !== undefined
      ? overrideConfirmedAt : c.confirmed_at;
    if (!cardIsReady({ confirmed_at: confirmedAt })) n++;
  }
  return n;
}

// ── reads ────────────────────────────────────────────────────────────────────
const WORKBOOK_SELECT = "id,client_id,kind,status,submitted_at";
const CARD_SELECT = "id,card_key,title,sort_order,state,confirmed_at";
const ANSWER_SELECT = "id,card_id,target_kind,target_table,target_id,target_field,current_value,proposed,answered,applied_at";

// A VOID WORKBOOK IS A DEAD LINK, AND A DEAD LINK IS A LINK THAT NEVER EXISTED.
//
// DO NOT MAKE THIS REFUSAL MORE HELPFUL. A distinct "this link was revoked" is
// an ORACLE: it tells whoever is holding a token that the token was real, which
// separates a guess from a hit and turns the void status into a confirmation
// service. Revocation IS the whole mitigation for shipping a surface with no
// login, so the revoked case must be indistinguishable from the never-existed
// case - same 404, same sentence, byte for byte. The suite asserts the two
// responses are identical rather than merely both being 404s.
async function resolveWorkbook(token) {
  const t = String(token || "").trim();
  if (!t) throw bad("not found", 404);
  const rows = await sb(`workbooks?token=eq.${enc(t)}&select=${WORKBOOK_SELECT}&limit=1`);
  const wb = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!wb || wb.status === "void") throw bad("not found", 404);
  return wb;
}

// Cards, with an OPTIONAL `meta` column passed through when the schema has one.
// The page renders per-card presentation facts (family colour, the live-in-Stripe
// pill, member counts) that are NOT answers and must not become answers - an
// owner cannot edit "9 members pay on this plan today". There is no meta column
// today, so this degrades to no meta at all rather than 400ing every read, and
// the page is built to render nothing rather than invent a claim. Same shape as
// api/website/checkout.js's billing_cadence fallback, and just as narrow: only
// PostgREST's undefined-column code degrades, anything else still throws.
async function readCards(workbookId) {
  const q = (withMeta) =>
    `workbook_cards?workbook_id=eq.${enc(workbookId)}&select=${CARD_SELECT}${withMeta ? ",meta" : ""}`
    + "&order=sort_order.asc,card_key.asc";
  try {
    return (await sb(q(true))) || [];
  } catch (e) {
    const msg = String((e && e.message) || "");
    if (!/42703/.test(msg) && !/does not exist/i.test(msg)) throw e;
    return (await sb(q(false))) || [];
  }
}

const readAnswers = async (workbookId) =>
  (await sb(`workbook_answers?workbook_id=eq.${enc(workbookId)}&select=${ANSWER_SELECT}&order=created_at.asc,id.asc`)) || [];

const byCard = (answers) => {
  const map = new Map();
  for (const a of answers) {
    if (!map.has(a.card_id)) map.set(a.card_id, []);
    map.get(a.card_id).push(a);
  }
  return map;
};

// THE WIRE SHAPE. Built field by field rather than by spreading the row, so a
// column added to workbook_answers later cannot start appearing in an owner's
// browser by accident. card_id and applied_at stay server-side: the nesting
// already says which card an answer belongs to.
const publicAnswer = (a) => ({
  id: a.id,
  target_kind: a.target_kind,
  target_table: a.target_table,
  target_id: a.target_id,
  target_field: a.target_field,
  current_value: a.current_value,
  proposed: a.proposed,
  answered: a.answered,
});

// `meta` IS PRESENTATION, AND IT ONLY EVER TRAVELS OUTWARD. It carries computed
// context the page paints around a card - the family colour, the live-in-Stripe
// pill, "9 members pay on this plan today" - facts the owner cannot edit because
// they are not his to edit. NOTHING in this file ever writes it: the only writers
// are the answer PATCH (which sends `answered` and nothing else) and the card
// PATCH (state and confirmed_at). That is deliberate and load-bearing. A
// computed fact that could be written through a token-authenticated action would
// come back out looking exactly like something the owner confirmed, and telling
// those two apart is the entire reason these tables are shaped this way.
//
// The key is OMITTED, not nulled, when the column is missing, so a page can tell
// "this deployment has no meta column" from "this card has no meta".
const publicCard = (card, answers, left = 0) => ({
  card_key: card.card_key,
  title: card.title,
  sort_order: card.sort_order,
  state: card.state,
  confirmed_at: card.confirmed_at,
  // WHAT THIS CARD WILL ACCEPT, said by the server rather than guessed by the
  // page. An empty array means the buttons should not be offered at all - which
  // is also what a card_key this server does not recognise produces, so a
  // seeding convention that drifts turns the feature OFF rather than turning
  // every click into a refusal the owner cannot act on.
  can_add: addableOn(card.card_key),
  add_left: left,
  // Whether the submit gate counts this card. Exposed rather than left for the
  // page to re-derive from answers.length: the gate rule has ONE definition and
  // it lives on the server, or the page's "Confirm the remaining N" and the
  // server's refusal drift apart and the owner is told two different numbers.
  counts: cardCounts(answers),
  ...(card.meta === undefined ? {} : { meta: card.meta }),
  answers: (answers || []).map(publicAnswer),
});

// ── writes ───────────────────────────────────────────────────────────────────
// Every mutation re-filters on the states it is allowed to touch, so a workbook
// that was submitted or voided between the read and the write cannot be edited
// by a request that started a moment too early.
const EDITABLE_FILTER = `status=in.(${[...OPEN_STATES].join(",")})`;

// A SUBMITTED WORKBOOK IS READ-ONLY. The owner pressed Send; staff are reviewing
// what he sent. Letting a late autosave rewrite an answer underneath a reviewer
// would change money after the decision was recorded.
function assertEditable(wb) {
  if (OPEN_STATES.has(wb.status)) return;
  throw bad(
    wb.status === "submitted"
      ? "You already sent this workbook. It is read only now while our team reviews it."
      : "This workbook is closed, so it cannot be edited. Please contact us if something is wrong.",
    409
  );
}

// ── CONCURRENCY: a debounced autosave lands AFTER the owner presses Send ─────
//
// THE ORDERING PROBLEM, stated honestly. assertEditable reads the workbook's
// status and the write happens a round trip later, so submit can land inside
// that window: the save was legal when it was checked and illegal by the time it
// wrote. PostgREST cannot make an UPDATE on workbook_answers conditional on a
// column of workbooks, there is no transaction to open across two REST calls and
// no lock to take. So THIS IS NOT ATOMICITY and must not be described as it.
//
// What it is: CHECK AFTER WRITE, AND PUT IT BACK. Once the writes have landed we
// re-read the workbook, and if it closed underneath us every value we wrote is
// restored to what we read before writing it, and the caller gets the ordinary
// read-only refusal. The failure shrinks from "a late autosave silently rewrites
// an answer a reviewer is reading" to "it is undone within one round trip and
// the owner is told".
//
// RESIDUALS, named rather than papered over:
//   - for the length of that round trip the submitted workbook really does hold
//     the late value, so a reviewer reading in exactly that window sees it;
//   - if the restore itself fails, the value stays and the failure is logged;
//   - the restore writes back what WE read, so a third writer inside the same
//     window would be clobbered. One owner holds one link, which is what makes
//     that acceptable here and would not make it acceptable elsewhere;
//   - the card's `state` write is not compensated, on purpose. It carries no
//     value of the owner's and it is DERIVED - submit recomputes every state
//     from the answers before it gates, so a stale state cannot outlive the next
//     read of the workbook.
//
// The same re-read also settles the OTHER race, which is far more likely: two of
// the owner's own debounced saves in flight at once. The card's state is
// computed from the answers as they exist AFTER the writes rather than from the
// snapshot this request happened to start with, so the later save cannot compute
// a state from rows that no longer say what it thinks they say.
async function settleWrites(wb, card, undo) {
  const [wbRows, fresh] = await Promise.all([
    sb(`workbooks?id=eq.${enc(wb.id)}&select=status&limit=1`),
    readAnswers(wb.id),
  ]);
  const status = (Array.isArray(wbRows) && wbRows[0] && wbRows[0].status) || "";
  if (!OPEN_STATES.has(status)) {
    for (const u of undo) {
      try {
        // THREE SHAPES OF UNDO, because there are three shapes of write: a value
        // that was overwritten goes back, a row that was created is deleted, and
        // a row that was deleted is re-inserted VERBATIM - id and all, so a
        // rescued addition keeps the identity the page is holding rather than
        // reappearing as a stranger.
        if (u.remove) {
          await sb(`workbook_answers?id=eq.${enc(u.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        } else if (u.reinsert) {
          await sb("workbook_answers", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify([u.reinsert]),
          });
        } else {
          await sb(`workbook_answers?id=eq.${enc(u.id)}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ answered: u.was === undefined ? null : u.was, updated_at: nowIso() }),
          });
        }
      } catch {
        // The answer id is safe to log; it is not a credential and it is the
        // only thing that makes this line actionable. The error itself is not
        // forwarded - it is a throw we did not write.
        console.error("workbook: could not undo a write into a closed workbook, answer", enc(u.id));
      }
    }
    assertEditable({ status });   // throws the ordinary read-only refusal
  }
  // BOTH lists, because the caller needs the card's answers for its state AND
  // the whole workbook's for the addition allowance, and re-reading twice would
  // let the two disagree with each other.
  return { mine: byCard(fresh).get(card.id) || [], all: fresh };
}

// The card object every mutating action answers with. ONE builder, so save,
// confirm, add and remove cannot drift into telling the page different things
// about the same card.
const cardReply = (card, state, confirmedAt, mine, all) => ({
  card_key: card.card_key,
  state,
  confirmed_at: confirmedAt,
  add_left: addLeft(card, mine, all),
  // `counts` rides along for the same reason it is on the GET card: the page
  // updates a card from the action it just performed, and if the field only
  // existed on the full read it would have to REMEMBER whether this card counts
  // - which is the gate rule living in two places, one of them stale. An add
  // that turns an empty card into a counting one has to say so in the response
  // that created it.
  counts: cardCounts(mine),
});

// STATE ONLY. confirmed_at is stamped by the confirm action and by nothing else
// - if a save could set it, the deliberate act would be something the page can
// manufacture, and "confirmed" would stop meaning a human said yes.
// STATE, and optionally confirmed_at. The second argument is passed ONLY where a
// confirm is being retired by a later edit - everywhere else confirmed_at is
// stamped by the confirm action and by nothing else, which is what keeps it a
// record of a deliberate act rather than a side effect of typing.
async function writeCardState(card, state, confirmedAt) {
  const patch = { state, updated_at: nowIso() };
  if (confirmedAt !== undefined) patch.confirmed_at = confirmedAt;
  await sb(`workbook_cards?id=eq.${enc(card.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

// ── actions ──────────────────────────────────────────────────────────────────

// save: autosave. Called constantly, writes only `answered`, and NEVER moves a
// workbook or a card toward "done" on its own.
async function doSave(wb, body) {
  assertEditable(wb);
  const cardKey = String(body.card_key || "").trim();
  if (!cardKey) throw bad("card_key required");
  const incoming = Array.isArray(body.answers) ? body.answers : null;
  if (!incoming) throw bad("answers must be an array");

  const cards = await readCards(wb.id);
  const card = cards.find((c) => c.card_key === cardKey);
  if (!card) throw bad("not found", 404);

  const all = await readAnswers(wb.id);
  let mine = byCard(all).get(card.id) || [];
  const byId = new Map(mine.map((a) => [String(a.id), a]));

  let actedNow = false;
  const undo = [];
  for (const item of incoming) {
    const row = byId.get(String((item || {}).id || ""));
    // AN ANSWER ID FROM ANOTHER CARD - OR ANOTHER ACADEMY'S WORKBOOK - IS
    // REFUSED, not quietly skipped. The token authorizes ONE workbook; an id is
    // a bearer of nothing. A silent skip would let a caller probe which ids
    // exist by watching what does not error.
    if (!row) throw bad("that answer does not belong to this card", 404);
    if (row.applied_at) throw bad("that answer has already been applied and cannot be changed", 409);
    const value = (item || {}).answered;
    // AN EDIT TO AN ADDITION IS HELD TO THE SAME BAR AS MAKING ONE.
    //
    // Two different ghosts come through this door if it is left open. Emptying
    // it leaves a row still on the staff "needs creating" list with nothing in
    // it - the exact thing the remove action exists to prevent, reachable
    // through the ordinary autosave path. And editing the price back out leaves
    // a row that is on that list and NOT ACTIONABLE, which is the same failure
    // wearing a value. So a save on an addition must leave it a complete
    // request, judged by the validator that let it in.
    if (isAddition(row)) {
      const what = String(row.target_field).slice(ADD_PREFIX.length);
      const check = ADD_KINDS[what];
      if (isBlank(value) || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) {
        throw bad("To take that item back, remove it rather than emptying it.");
      }
      const complaint = check ? check(value) : "";
      if (complaint) throw bad(complaint);
    }
    if (jsonEqual(value, row.answered)) continue;    // nothing to write; autosave repeats itself
    // AN ECHO OF OUR OWN PREFILL IS NOT AN ACT, and this line is the whole
    // reason an unread card cannot walk through the submit gate. The page fills
    // every field with `proposed` and autosaves on a debounce, so if merely
    // saving counted, a card the owner never opened would flip itself to
    // 'changed' - and 'changed' satisfies the gate. Only a value that DIFFERS
    // from what we showed him could have come from a human. Do not "simplify"
    // this to `actedNow = true`: that is MUTATE=echoacts, and it deletes the
    // difference between an unread card and an approved one.
    if (!jsonEqual(value, row.proposed)) actedNow = true;
    await sb(`workbook_answers?id=eq.${enc(row.id)}&card_id=eq.${enc(card.id)}&workbook_id=eq.${enc(wb.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ answered: value === undefined ? null : value, updated_at: nowIso() }),
    });
    undo.push({ id: row.id, was: row.answered });
    row.answered = value === undefined ? null : value;
  }

  // Only when something was actually written: a no-op autosave (the common case,
  // since this is called constantly) costs exactly what it did before.
  let allNow = all;
  if (undo.length) ({ mine, all: allNow } = await settleWrites(wb, card, undo));

  const state = cardState(card, mine, actedNow);

  // A REAL EDIT RETIRES AN EARLIER CONFIRM. He approved a card, changed his mind
  // and typed something new: the approval was of the OLD value and does not
  // carry to the new one. Leaving confirmed_at set makes the pill say "press
  // confirm" while the gate no longer asks for it - the page telling him one
  // thing and the server believing another about the same card.
  // `actedNow` is the right trigger, not "a write happened": a debounced
  // autosave that echoes our own prefill is not an edit (MUTATE=echoacts), and
  // must not silently retire a confirm he really did make.
  const retire = actedNow && !!card.confirmed_at;
  const confirmedAt = retire ? null : card.confirmed_at;
  if (state !== card.state || retire) await writeCardState(card, state, confirmedAt);
  card.confirmed_at = confirmedAt;

  return {
    ok: true,
    card: cardReply(card, state, confirmedAt, mine, allNow),
    remaining: remainingFor(cards, allNow, card.id, state, confirmedAt),
  };
}

// add: the owner asks for something that does not exist. It mints ONE answer row
// and returns it; everything after that is an ordinary save against its id, so
// the autosave path, the state rule and the read-only rules all apply to it
// without knowing it is special.
async function doAdd(wb, body) {
  assertEditable(wb);
  const cardKey = String(body.card_key || "").trim();
  if (!cardKey) throw bad("card_key required");

  const cards = await readCards(wb.id);
  const card = cards.find((c) => c.card_key === cardKey);
  if (!card) throw bad("not found", 404);

  const allowed = addableOn(card.card_key);
  const what = String(body.what || "").trim();
  if (!allowed.length) throw bad("This part of the workbook does not take new items.", 409);
  if (!allowed.includes(what)) throw bad(`This card takes: ${allowed.join(", ")}.`);

  const value = body.answered;
  if (isBlank(value) || typeof value !== "object" || Array.isArray(value)) {
    throw bad("Please fill in the new item before adding it.");
  }
  const complaint = ADD_KINDS[what](value);
  if (complaint) throw bad(complaint);
  if (JSON.stringify(value).length > MAX_ADD_CHARS) {
    throw bad("That is too long to add here. Please shorten it, or tell us the details directly.", 400, "add_too_long");
  }

  const all = await readAnswers(wb.id);
  const mine = byCard(all).get(card.id) || [];
  if (mine.filter(isAddition).length >= MAX_ADD_PER_CARD) {
    throw bad(`You can add up to ${MAX_ADD_PER_CARD} new items here. Please tell us the rest directly and we will add them for you.`, 409, "add_cap_card");
  }
  if (all.filter(isAddition).length >= MAX_ADD_PER_WORKBOOK) {
    throw bad(`You can add up to ${MAX_ADD_PER_WORKBOOK} new items in this workbook. Please tell us the rest directly and we will add them for you.`, 409, "add_cap_workbook");
  }

  // THE SERVER DECIDES THE TARGET. It is inherited from the card's existing
  // answers - they all point at the same table by construction - and target_id
  // is NULL because the row does not exist yet. NOTHING here is read from the
  // payload: a body carrying its own target_table, target_id, client_id or
  // workbook_id is ignored entirely, because a token that can name its own
  // target is a token that can aim a write at any row in the database.
  const aim = deriveTarget(mine, all);
  if (!aim) throw bad("This part of the workbook does not take new items.", 409);

  const created = await sb(`workbook_answers?select=${ANSWER_SELECT}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      workbook_id: wb.id,
      card_id: card.id,
      client_id: wb.client_id,
      target_kind: aim.target_kind,
      target_table: aim.target_table,
      target_id: null,
      target_field: `${ADD_PREFIX}${what}`,
      current_value: null,
      proposed: null,
      answered: value,
    }]),
  });
  const answer = Array.isArray(created) && created[0] ? created[0] : null;
  if (!answer) throw bad("that could not be added - please try again", 502);

  const fresh = await settleWrites(wb, card, [{ id: answer.id, remove: true }]);
  const state = cardState(card, fresh.mine, true);

  // AN ADDITION RETIRES AN EARLIER CONFIRM, for the same reason a real edit
  // does. He approved a card, then asked for something that is not on it - the
  // approval was of a card that did not carry this request. Leaving confirmed_at
  // set sends an UNREVIEWED REQUEST out on a card marked ready, which is the
  // typing-is-approving defeat through the door next to it, and the gate keying
  // on confirmed_at rather than state does not close it by itself.
  // No `actedNow` test here: unlike a save, an add is never an echo of our own
  // prefill. Reaching this line means a row was created.
  const retire = !!card.confirmed_at;
  const confirmedAt = retire ? null : card.confirmed_at;
  if (state !== card.state || retire) await writeCardState(card, state, confirmedAt);
  card.confirmed_at = confirmedAt;

  return {
    ok: true,
    answer: publicAnswer(answer),
    card: cardReply(card, state, confirmedAt, fresh.mine, fresh.all),
    remaining: remainingFor(cards, fresh.all, card.id, state, confirmedAt),
  };
}

// remove: an addition the owner took back never happened.
//
// A HARD DELETE, NOT A SOFT CLEAR. A tombstoned row still answers the staff
// review query, and staff reviewing a list called "needs creating" will create
// what is on it - so a soft clear is a row that gets built by hand later. The
// row is safe to destroy precisely because it is an addition: nothing was ever
// applied from it and it has no was/now history to preserve.
//
// THE FILTER IS THE SECURITY. It is not "we looked it up first, so it must be
// ours": every one of those clauses is on the DELETE itself, so this statement
// cannot remove a row that is not an addition, not on this card, not in this
// workbook, or already applied - whatever the lookup above believed.
async function doRemove(wb, body) {
  assertEditable(wb);
  const cardKey = String(body.card_key || "").trim();
  if (!cardKey) throw bad("card_key required");

  const cards = await readCards(wb.id);
  const card = cards.find((c) => c.card_key === cardKey);
  if (!card) throw bad("not found", 404);

  const all = await readAnswers(wb.id);
  const mine = byCard(all).get(card.id) || [];
  const target = mine.find((a) => String(a.id) === String(body.id || ""));
  // Only an addition can be removed. The rows WE put in front of him are the
  // questions; an owner deleting a question is not a thing that exists.
  if (!target || !isAddition(target)) throw bad("not found", 404);
  if (target.applied_at) throw bad("that item has already been set up and cannot be removed here", 409);

  await sb(
    `workbook_answers?id=eq.${enc(target.id)}&card_id=eq.${enc(card.id)}&workbook_id=eq.${enc(wb.id)}`
    + `&target_field=like.${enc(ADD_PREFIX)}*&applied_at=is.null`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } }
  );

  const fresh = await settleWrites(wb, card, [{ reinsert: {
    id: target.id, workbook_id: wb.id, card_id: card.id, client_id: wb.client_id,
    target_kind: target.target_kind, target_table: target.target_table, target_id: null,
    target_field: target.target_field, current_value: null, proposed: null, answered: target.answered,
  } }]);
  const state = cardState(card, fresh.mine, true);
  if (state !== card.state) await writeCardState(card, state);

  return {
    ok: true,
    removed: { id: target.id },
    card: cardReply(card, state, card.confirmed_at, fresh.mine, fresh.all),
    remaining: remainingFor(cards, fresh.all, card.id, state, card.confirmed_at),
  };
}

// confirm: THE DELIBERATE ACT. It is card-level and nothing else in this file
// stamps confirmed_at.
async function doConfirm(wb, body) {
  assertEditable(wb);
  const cardKey = String(body.card_key || "").trim();
  if (!cardKey) throw bad("card_key required");

  const cards = await readCards(wb.id);
  const card = cards.find((c) => c.card_key === cardKey);
  if (!card) throw bad("not found", 404);

  const all = await readAnswers(wb.id);
  let mine = byCard(all).get(card.id) || [];

  // ── MATERIALIZE THE ANSWER HE JUST GAVE ───────────────────────────────────
  // He confirmed the card AS SHOWN, so what was shown IS his answer, and it is
  // written down rather than inferred later. DO NOT DELETE THIS LOOP AS
  // REDUNDANT: staff review compares current_value against ANSWERED, and San
  // Jose is the case that proves it matters. The portal stores "2
  // Trainings/Week"; the card showed Lij his own Stripe name, "Academy 2x/week".
  // He confirms without typing anything. Without this loop the row keeps
  // `answered: null`, review compares a value against nothing, and three plan
  // RENAMES read as "he did not touch it" - while the apply step would still
  // rename them. The comparison that decides money must never run against a
  // value that only exists in someone's head.
  const undo = [];
  for (const a of mine) {
    // An addition is skipped: it has no `proposed` to materialize (we proposed
    // nothing, he did), and writing null over his request would empty it.
    if (isAddition(a) || !isBlank(a.answered)) continue;
    await sb(`workbook_answers?id=eq.${enc(a.id)}&card_id=eq.${enc(card.id)}&workbook_id=eq.${enc(wb.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ answered: a.proposed === undefined ? null : a.proposed, updated_at: nowIso() }),
    });
    undo.push({ id: a.id, was: a.answered });
    a.answered = a.proposed;
  }
  // Same check-after-write as save: a confirm can be in flight when submit lands
  // too, and a materialized answer written into a closed workbook is a value
  // appearing under a reviewer.
  let allNow = all;
  if (undo.length) ({ mine, all: allNow } = await settleWrites(wb, card, undo));

  const confirmedAt = card.confirmed_at || nowIso();
  const state = cardState({ ...card, confirmed_at: confirmedAt }, mine, true);
  await sb(`workbook_cards?id=eq.${enc(card.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ state, confirmed_at: confirmedAt, updated_at: nowIso() }),
  });

  return {
    ok: true,
    card: cardReply(card, state, confirmedAt, mine, allNow),
    // The stamp we just wrote is not in `cards` (read before the write), and
    // readiness now keys on confirmed_at rather than on the state string, so it
    // has to be handed over explicitly or this response reports the card as
    // still blocking the very Send the owner just unblocked.
    remaining: remainingFor(cards, allNow, card.id, state, confirmedAt),
  };
}

// submit: NO PARTIAL SUBMIT. Every card confirmed or changed, or nothing moves.
// The states are RECOMPUTED from the live rows rather than trusted from the
// state column: the column is only ever as fresh as the last write, and this is
// the one moment where being wrong means an owner's half-read workbook enters
// staff review looking complete.
async function doSubmit(wb) {
  assertEditable(wb);
  const cards = await readCards(wb.id);
  const grouped = byCard(await readAnswers(wb.id));

  // Recompute EVERY card, and write back any that drifted - including the ones
  // the gate does not count, so staff review never reads a stale state either.
  let remaining = 0;
  let anythingToReview = false;
  for (const card of cards) {
    const answers = grouped.get(card.id) || [];
    const state = cardState(card, answers);
    if (state !== card.state) await writeCardState(card, state);
    if (!cardCounts(answers)) continue;      // nothing to review, nothing to hold Send for
    anythingToReview = true;
    // The gate asks for the DELIBERATE ACT, not for the answer to look different.
    if (!cardIsReady(card)) remaining++;
  }

  // A WORKBOOK WITH NO ANSWERS ANYWHERE cannot be "fully confirmed" - it is not
  // finished, it is empty, and a gate that counts nothing passes vacuously. The
  // check is on the ANSWERS rather than the cards because the empty-card rule
  // above makes a workbook of nothing but empty cards the same degenerate case
  // as a workbook with no cards at all.
  if (!anythingToReview) {
    return { ok: false, error: "There is nothing in this workbook to send yet. Please contact us.", remaining: 0 };
  }
  if (remaining) {
    return {
      ok: false,
      error: remaining === 1
        ? "1 card still needs to be confirmed before you can send this."
        : `${remaining} cards still need to be confirmed before you can send this.`,
      remaining,
    };
  }

  const submittedAt = nowIso();
  const rows = await sb(`workbooks?id=eq.${enc(wb.id)}&${EDITABLE_FILTER}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "submitted", submitted_at: submittedAt, updated_at: submittedAt }),
  });
  // THE FILTER IS THE RACE FIX, and it is atomic in a way the answer writes
  // cannot be: this is ONE conditional UPDATE on ONE row, so of two tabs
  // pressing Send together exactly one matches `status in (draft,sent)` and the
  // other matches nothing. Nothing is written twice and submitted_at cannot be
  // overwritten by the loser.
  const landed = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!landed) {
    // We wrote nothing, so we report what the row ACTUALLY says rather than our
    // own timestamp for a write that did not happen. Already submitted is a
    // success (saying "sent" twice is honest); anything else means it was closed
    // out from under us while we were gating.
    const cur = await sb(`workbooks?id=eq.${enc(wb.id)}&select=status,submitted_at&limit=1`);
    const now = (Array.isArray(cur) && cur[0]) || {};
    if (now.status !== "submitted") {
      return { ok: false, error: "This workbook was closed while you were sending it. Please contact us.", remaining: 0 };
    }
    return {
      ok: true,
      workbook: { id: wb.id, kind: wb.kind, status: "submitted", submitted_at: now.submitted_at },
      remaining: 0,
    };
  }
  return {
    ok: true,
    workbook: {
      id: wb.id,
      kind: wb.kind,
      status: "submitted",
      submitted_at: landed.submitted_at || submittedAt,
    },
    remaining: 0,
  };
}

// ── staff: minting a workbook ────────────────────────────────────────────────
//
// TWO WORKBOOKS OF THE SAME KIND FOR ONE ACADEMY IS THE HAZARD. The owner holds
// links, not sessions, so a second link does not replace the first - both keep
// working and his answers scatter across two rows that staff review separately.
// The rule, by what the old one is:
//
//   draft / sent          VOIDED, and named in the response. An open link that
//                         nobody killed is the one that leaks answers into a row
//                         nobody reads.
//   submitted / reviewed  REFUSED, 409. Those carry answers he already sent and
//                         staff have not finished with. Minting over them is
//                         exactly the silent orphaning we were told to prevent,
//                         and no automatic rule should decide the fate of
//                         someone's submitted work - a human does, by voiding or
//                         finishing the review first.
//   applied / void        HISTORY. Ignored; a new workbook is created freely.
const KINDS = new Set(["price", "member"]);
const BLOCKING = ["submitted", "reviewed"];

async function doCreate(req) {
  const { user, staff } = await resolveStaff(req);
  const body = readBody(req);
  const clientId = String(body.client_id || "").trim();
  const kind = String(body.kind || "").trim();
  if (!clientId) throw bad("client_id required");
  if (!KINDS.has(kind)) throw bad(`kind must be one of: ${[...KINDS].join(", ")}`);

  const clients = await sb(`clients?id=eq.${enc(clientId)}&select=id,public_name,business_name&limit=1`);
  const client = Array.isArray(clients) && clients[0] ? clients[0] : null;
  if (!client) throw bad("academy not found", 404);

  const blocked = await sb(
    `workbooks?client_id=eq.${enc(clientId)}&kind=eq.${enc(kind)}&status=in.(${BLOCKING.join(",")})&select=id,status&limit=1`
  );
  if (Array.isArray(blocked) && blocked[0]) {
    throw bad(
      `this academy already has a ${kind} workbook the owner submitted (status ${blocked[0].status}). `
      + "Finish or void that review before sending another, or his answers end up in a row nobody reads.",
      409
    );
  }

  // READ THE OPEN ONES FIRST, THEN VOID THEM. A single PATCH with
  // return=representation hands back the rows AFTER the update, so every
  // superseded link would report `was: "void"` - a report that says only what we
  // just did and nothing about what we destroyed. Two calls, and the answer
  // names the state each link was actually in.
  const open = await sb(
    `workbooks?client_id=eq.${enc(clientId)}&kind=eq.${enc(kind)}&${EDITABLE_FILTER}&select=id,status`
  ) || [];
  if (open.length) {
    await sb(`workbooks?client_id=eq.${enc(clientId)}&kind=eq.${enc(kind)}&${EDITABLE_FILTER}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "void", updated_at: nowIso() }),
    });
  }

  // 256 bits, url-safe, from the CSPRNG. Never derived from client_id or
  // anything else an outsider could construct - see the migration header.
  const token = randomBytes(32).toString("base64url");
  const created = await sb("workbooks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      client_id: clientId,
      kind,
      token,
      status: "draft",
      created_by: user.id,
      created_by_name: actorName(staff, user),
    }]),
  });
  const wb = Array.isArray(created) && created[0] ? created[0] : null;
  if (!wb) throw bad("the workbook could not be created", 502);

  return {
    ok: true,
    workbook: { id: wb.id, client_id: clientId, kind, status: wb.status, academy_name: client.public_name || client.business_name || null },
    // THE ONE PLACE THE TOKEN IS EVER RETURNED, and it is behind staff auth.
    // These tables have RLS on with zero policies, so nothing else - not the
    // staff portal's own anon-key client, not a later screen - can read it back.
    // Not returning it here would mean minting a link nobody can send.
    token,
    superseded: open.map((r) => ({ id: r.id, was: r.status })),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// ── STAFF REVIEW AND APPLY: the machine half of "staff review what the owner
//    sent, then it becomes live configuration" ────────────────────────────────
//
//   POST /api/workbook { action: "review",       workbook_id }            STAFF
//   POST /api/workbook { action: "approve-card", workbook_id, card_key }  STAFF
//   POST /api/workbook { action: "apply",        workbook_id, dry_run }   STAFF
//   POST /api/workbook { action: "publish",      workbook_id }            STAFF
//   POST /api/workbook { action: "rollback",     workbook_id }            STAFF
//
// TWO CONFIRMATIONS, TWO PEOPLE, TWO COLUMNS. The owner's deliberate act is
// confirmed_at ("this is what I sell"); the staff act is approved_at ("apply
// this to the live system"). The apply gate reads approved_at exactly the way
// the submit gate reads confirmed_at, and neither stamp can produce the other.
//
// EVERY ONE OF THESE IS STAFF-AUTHED AND NONE OF THEM TAKES A TOKEN. The
// workbook is named by workbook_id, which the owner's page does see - so the
// only thing standing between a token-holder and these actions is resolveStaff,
// and that is asserted by a control (ownertoken) rather than assumed.
//
// NONE OF THEM REOPENS OWNER EDITING. Review reads, approve stamps a card
// column the owner cannot see, apply writes OUTWARD into offers/clients, and
// rollback lands the workbook back on 'submitted' - which assertEditable
// refuses. There is no path from here to 'draft' or 'sent'.

const REVIEWABLE = new Set(["submitted", "reviewed"]);

function assertReviewable(wb) {
  if (REVIEWABLE.has(wb.status)) return;
  throw bad(
    `this workbook is not in review (status ${wb.status}) - the owner has to send it before staff can act on it`,
    409
  );
}

const is42703 = (e) => {
  const msg = String((e && e.message) || "");
  return /42703/.test(msg) || /does not exist/i.test(msg);
};

// The staff-side reads carry the columns the owner wire shape deliberately
// omits. Both degrade on PostgREST's undefined-column code the way readCards
// does, so an environment that has not run 20260806T063000_workbook_apply.sql
// still REVIEWS (approved_at simply reads null) - and approve/apply/rollback
// refuse out loud below instead of 500ing on every call.
async function readWorkbookStaff(workbookId) {
  const id = String(workbookId || "").trim();
  if (!id) throw bad("workbook_id required");
  const q = (sel) => `workbooks?id=eq.${enc(id)}&select=${sel}&limit=1`;
  let rows, degraded = false;
  try {
    rows = await sb(q(`${WORKBOOK_SELECT},reviewed_at,snapshot`));
  } catch (e) {
    if (!is42703(e)) throw e;
    degraded = true;
    rows = await sb(q(WORKBOOK_SELECT));
  }
  const wb = Array.isArray(rows) && rows[0] ? rows[0] : null;
  // Void is 404 for staff too: a dead workbook is not a review surface.
  if (!wb || wb.status === "void") throw bad("not found", 404);
  return { wb, degraded };
}

async function readCardsStaff(workbookId) {
  const q = (sel) =>
    `workbook_cards?workbook_id=eq.${enc(workbookId)}&select=${sel}`
    + "&order=sort_order.asc,card_key.asc";
  const withApproval = `${CARD_SELECT},approved_at,approved_by`;
  try {
    return { cards: (await sb(q(`${withApproval},meta`))) || [], degraded: false };
  } catch (e) {
    if (!is42703(e)) throw e;
    try {
      return { cards: (await sb(q(withApproval))) || [], degraded: false };
    } catch (e2) {
      if (!is42703(e2)) throw e2;
      return { cards: (await sb(q(CARD_SELECT))) || [], degraded: true };
    }
  }
}

const STAFF_ANSWER_SELECT = `${ANSWER_SELECT},apply_error`;
const readAnswersStaff = async (workbookId) =>
  (await sb(`workbook_answers?workbook_id=eq.${enc(workbookId)}&select=${STAFF_ANSWER_SELECT}&order=created_at.asc,id.asc`)) || [];

// ONE front door for all five actions, so the auth rule exists in exactly one
// place: the caller is staff, or the caller is nobody. DO NOT soften this into
// a try/catch that falls back to the workbook token - the token is the OWNER'S
// credential for answering questions, and an owner who can call review/apply is
// an owner who can read staff annotations and write his own prices into the
// live system. That is MUTATE=ownertoken.
async function resolveStaffForWorkbook(req, body) {
  const { user, staff } = await resolveStaff(req);
  const { wb, degraded } = await readWorkbookStaff(body && body.workbook_id);
  return { user, staff, wb, wbDegraded: degraded };
}

// ── THE FIELD MAP, implemented as VALUE translation ──────────────────────────
//
// The workbook's target_field names already speak the offer's KEY vocabulary
// (the seed did the desc->whats_included renames), so what remains at apply
// time is the VALUE vocabulary: the page answers with its own chip words
// ("Waive", "every 4 weeks", the number 549 from a number input) and the offer
// stores exact strings with exact casing. Verified against the live San Jose
// offer jsonb on 2026-08-06 rather than transcribed from a doc, because the
// docs disagreed with each other on casing and the offer is the side that
// charges money:
//
//   signup_fee_on_base / signup_fee_charge   "charge" / "waive"   LOWERCASE
//   billing_cycle                            "Every 4 weeks"      exact string
//   type                                     "Membership"         capitalised
//   after                                    "Renews same length" exact string
//   price / signup_fee / value               "250"                STRING
//
// A value that lands uncased ("Waive") is invisible to the eye and real to
// checkout.js's === - that exact defect shipped this week, which is why every
// chip translation here matches case-insensitively on the way IN and emits the
// offer's exact form on the way OUT, and why MUTATE=vocabdrift exists.
const mkVocab = (canonical, aliases) => {
  const m = new Map();
  for (const c of canonical) m.set(c.trim().toLowerCase(), c);
  for (const [a, c] of Object.entries(aliases || {})) m.set(a.trim().toLowerCase(), c);
  return m;
};

const V_TYPE = mkVocab(["Membership", "Package", "Single Session", "Other"], { "something else": "Other" });
const V_CYCLE = mkVocab(
  ["Weekly", "Biweekly", "Monthly", "Every 4 weeks", "Quarterly", "Annually", "Other"],
  {
    "every week": "Weekly", "every 2 weeks": "Biweekly", "every two weeks": "Biweekly",
    "every month": "Monthly", "every four weeks": "Every 4 weeks",
    "every 3 months": "Quarterly", "every three months": "Quarterly",
    "every year": "Annually", "yearly": "Annually", "annual": "Annually",
    "something else": "Other",
  }
);
// Lowercase ON PURPOSE: this is the one list where the offer's canonical form
// is the lowercased word. "Waive" is the page's chip; "waive" is what the offer
// stores and what checkout.js compares against.
const V_CHARGE = mkVocab(["charge", "waive"], { "charge it": "charge", "waive it": "waive" });
const V_YESNO = mkVocab(["Yes", "No"], {
  "yes, taxed like everything else": "Yes",
  "no, this one is exempt": "No", "no, exempt": "No",
  "true": "Yes", "false": "No",
});
const V_AFTER = mkVocab(
  ["Goes back to monthly", "Renews same length", "Ends", "Other"],
  { "renews for the same length": "Renews same length", "just ends": "Ends", "something else": "Other" }
);
const V_KIND = mkVocab(["Percent off", "Dollar off"], { "percent": "Percent off", "dollar": "Dollar off" });
const V_DUR = mkVocab(
  ["First payment only", "A set number of months", "Every payment"],
  { "once": "First payment only", "first payment": "First payment only", "number of months": "A set number of months", "forever": "Every payment" }
);

// Each translator answers { ok, value } or { ok:false, error } - and an error
// here is a REFUSAL of the whole apply, never a best guess written to a money
// field. Free text passes through VERBATIM (no trimming): a difference nobody
// can see is exactly what staff review exists to surface, and normalizing it
// away here would hide it from the one comparison that matters.
const tOk = (value) => ({ ok: true, value });
const tErr = (error) => ({ ok: false, error });
const tText = (v) => (typeof v === "string" ? tOk(v) : tErr("expected text"));
const tBool = (v) => (typeof v === "boolean" ? tOk(v) : tErr("expected true or false"));
const tChip = (vmap, what) => (v) => {
  const hit = typeof v === "string" ? vmap.get(v.trim().toLowerCase()) : (typeof v === "boolean" ? vmap.get(String(v)) : undefined);
  return hit === undefined ? tErr(`not a ${what} this offer understands: ${JSON.stringify(v)}`) : tOk(hit);
};
// The offer stores money as STRINGS ("250"). A number input answers a NUMBER,
// and that is a page fact, not a price change - so a finite number becomes its
// string, a numeric string passes verbatim, and anything else refuses.
const tMoneyStr = (v) => {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return tOk(String(v));
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) && v.trim() === v) return tOk(v);
  return tErr(`not a price the offer can store: ${JSON.stringify(v)}`);
};
// signup_fee is the one currency field where EMPTY is a value ("empty = no
// fee", per the field map).
const tMoneyStrOrEmpty = (v) => (v === "" ? tOk("") : tMoneyStr(v));
const tIntOrNull = (v) => {
  if (v === "" || v === null) return tOk(null);
  const n = typeof v === "number" ? v : (typeof v === "string" && /^\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN);
  return Number.isInteger(n) && n >= 0 ? tOk(n) : tErr(`expected a whole number: ${JSON.stringify(v)}`);
};
const tYesNoBool = (v) => {
  if (typeof v === "boolean") return tOk(v);
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (s === "yes" || s === "true") return tOk(true);
  if (s === "no" || s === "false") return tOk(false);
  return tErr(`expected yes or no: ${JSON.stringify(v)}`);
};
const tStrArray = (v) =>
  (Array.isArray(v) && v.every((x) => typeof x === "string") ? tOk(v) : tErr("expected a list of price keys"));

const PLAN_T = {
  title: tText, type: tChip(V_TYPE, "pricing type"), whats_included: tText,
  price: tMoneyStr, billing_cycle: tChip(V_CYCLE, "billing cycle"), billing_cycle_other: tText,
  taxable: tChip(V_YESNO, "taxable answer"),
  signup_fee: tMoneyStrOrEmpty, signup_fee_taxable: tChip(V_YESNO, "taxable answer"),
  signup_fee_on_base: tChip(V_CHARGE, "charge-or-waive answer"),
  sessions_included: tIntOrNull, expires_after: tText, other_description: tText,
  description: tText, archived: tBool,
};
const RUNG_T = {
  length: tText, whats_included: tText, price: tMoneyStr,
  taxable: tChip(V_YESNO, "taxable answer"),
  signup_fee_charge: tChip(V_CHARGE, "charge-or-waive answer"),
  discount_notes: tText, after: tChip(V_AFTER, "what-happens-after answer"), after_other: tText,
  archived: tBool,
};
const CODE_T = {
  code: tText, kind: tChip(V_KIND, "discount kind"), value: tMoneyStr,
  duration: tChip(V_DUR, "duration"), duration_months: tIntOrNull,
  applies_to: tStrArray, expires_at: tText, max_redemptions: tIntOrNull,
  once_per_customer: tYesNoBool,
};

// clients.tax_config, canonical shape { pct, label } EXACTLY as GTA stores it
// ({ pct: 13, label: "HST" }), or null when he answered no. Extra keys the
// workbook capture carried (charges_tax, the example sentence, chip indexes)
// are STRIPPED: resolveFee reads pct and label and nothing else, and a shape
// with passengers is a shape someone eventually reads a passenger out of.
function canonicalTax(v) {
  if (v === false) return tOk(null);
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return tErr(`not a tax answer this can store: ${JSON.stringify(v)}`);
  }
  if (v.charges_tax === false) return tOk(null);
  const pct = Number(v.pct);
  if (!Number.isFinite(pct) || pct <= 0) return tErr("a tax rate must be a number above zero");
  return tOk({ pct, label: String(v.label == null ? "" : v.label).trim() });
}

// Where in the offer jsonb a target_field lands, and which translator judges
// its value. FAIL-CLOSED: a field name this table does not know is a refusal,
// never a write to a guessed path - the whitelist is the difference between
// "the workbook can adjust pricing" and "a workbook row can aim at any key in
// the offer".
function classifyField(field) {
  const f = String(field || "");
  if (f === "tax_config") return { kind: "tax" };
  if (f === "notes") return { kind: "manual" };
  if (f.startsWith(ADD_PREFIX)) return { kind: "manual" };
  let m = f.match(/^commitments\.(\d+)\.([a-z_]+)$/);
  if (m) return RUNG_T[m[2]] ? { kind: "rung", index: +m[1], leaf: m[2], t: RUNG_T[m[2]] } : { kind: "unknown" };
  m = f.match(/^codes\.(\d+)\.([a-z_]+)$/);
  if (m) return CODE_T[m[2]] ? { kind: "code", index: +m[1], leaf: m[2], t: CODE_T[m[2]] } : { kind: "unknown" };
  return PLAN_T[f] ? { kind: "plan", leaf: f, t: PLAN_T[f] } : { kind: "unknown" };
}

// Which pricing_offerings entry a plan card means. The card's TITLE answer
// names it: current_value first (the name the offer stores today), then
// answered/proposed for the rerun case where a previous apply already renamed
// it. NEVER a fuzzy match and NEVER a create - a plan card whose offering
// cannot be found is a refusal, because creating offerings is the humans' job
// (that is what additions are).
function offeringIndexFor(cardAnswers, offerings) {
  const t = (cardAnswers || []).find((a) => a.target_field === "title");
  const names = [t && t.current_value, t && t.answered, t && t.proposed]
    .filter((s) => typeof s === "string" && s);
  for (const n of names) {
    const i = (offerings || []).findIndex((o) => o && o.title === n);
    if (i >= 0) return i;
  }
  return -1;
}

// ── review: the full decision set, grouped for a human ───────────────────────
//
// ACADEMY SETTINGS FIRST, always, and the ordering is the point: a tax answer
// re-prices every athlete while a plan row costs one plan, so the blast radius
// sorts before anything else and a tax change can never hide in a list of
// renames. Then the cards, then the owner's ADDITIONS (each one a request a
// human must create by hand), then free text.
//
// "IS IT A CHANGE" is jsonEqual(current_value, effective answer) - the same
// comparison the state rule uses - so a card the owner CONFIRMED WITHOUT
// EDITING whose proposal differs from what we store reads as a change here.
// That is San Jose's three renames, and a review that showed them as untouched
// would have staff approve a rename they never saw.
// orNull: SQL NULL and an absent key are the same "no value" on the wire.
const orNull = (x) => (x === undefined ? null : x);

function reviewItem(card, a) {
  const eff = effective(a);
  const cls = classifyField(a.target_field);
  const entry = {
    answer_id: a.id,
    card_key: card ? card.card_key : null,
    target_kind: a.target_kind,
    target_table: a.target_table,
    target_id: a.target_id,
    target_field: a.target_field,
    current_value: orNull(a.current_value),
    proposed: orNull(a.proposed),
    answered: orNull(a.answered),
    effective: orNull(eff),
    is_change: !jsonEqual(eff, a.current_value),
    applied_at: a.applied_at || null,
    apply_error: a.apply_error || null,
  };
  // What apply would actually write, shown to the human BEFORE the write - the
  // translated value in the offer's own vocabulary, or the refusal it would
  // produce. Review is where a translation problem should be seen, not the
  // apply that trips over it.
  if (!isBlank(eff) && (cls.kind === "plan" || cls.kind === "rung" || cls.kind === "code")) {
    const out = cls.t(eff);
    if (out.ok) entry.will_write = out.value;
    else entry.translation_error = out.error;
  } else if (!isBlank(eff) && cls.kind === "tax") {
    const out = canonicalTax(eff);
    if (out.ok) entry.will_write = out.value;
    else entry.translation_error = out.error;
  } else if (cls.kind === "unknown") {
    entry.translation_error = "this field is not one the apply step knows how to write";
  }
  return entry;
}

function approvalGate(cards, grouped) {
  const counted = cards.filter((c) => cardCounts(grouped.get(c.id)));
  const unapproved = counted.filter((c) => !c.approved_at).map((c) => c.card_key);
  return { counted, unapproved };
}

async function doReviewStaff(req, body) {
  const { wb } = await resolveStaffForWorkbook(req, body);
  assertReviewable(wb);
  const [{ cards }, answers] = await Promise.all([readCardsStaff(wb.id), readAnswersStaff(wb.id)]);
  const grouped = byCard(answers);

  const academy = [];
  const cardGroups = [];
  const additions = [];
  const notes = [];
  for (const card of cards) {
    const mine = grouped.get(card.id) || [];
    const items = [];
    for (const a of mine) {
      const entry = reviewItem(card, a);
      if (isAddition(a)) { additions.push(entry); continue; }
      if (a.target_field === "notes") { notes.push(entry); continue; }
      if (a.target_kind === "academy_setting") { academy.push(entry); continue; }
      items.push(entry);
    }
    if (!items.length && !cardCounts(mine)) continue;   // nothing to show for an empty card
    cardGroups.push({
      card_key: card.card_key,
      title: card.title,
      sort_order: card.sort_order,
      state: card.state,
      confirmed_at: card.confirmed_at,
      approved_at: card.approved_at || null,
      approved_by: card.approved_by || null,
      counts: cardCounts(mine),
      changes: items.filter((i) => i.is_change).length
        + (mine.some(isAddition) ? mine.filter(isAddition).length : 0),
      items,
    });
  }

  const { counted, unapproved } = approvalGate(cards, grouped);
  const allItems = [...academy, ...cardGroups.flatMap((c) => c.items), ...additions, ...notes];
  return {
    ok: true,
    workbook: {
      id: wb.id, client_id: wb.client_id, kind: wb.kind, status: wb.status,
      submitted_at: wb.submitted_at, reviewed_at: wb.reviewed_at || null,
      snapshot_taken: wb.snapshot != null,
    },
    review: {
      academy_settings: academy,   // FIRST. Blast radius: one answer, every athlete.
      cards: cardGroups,
      additions,                   // requests a human creates by hand, never apply
      notes,
    },
    gate: {
      counted: counted.length,
      approved: counted.length - unapproved.length,
      unapproved_card_keys: unapproved,
      changes: allItems.filter((i) => i.is_change).length,
      ready_to_apply: unapproved.length === 0,
    },
  };
}

// ── approve-card: the STAFF act, per card, same unit the owner confirmed in ──
async function doApproveCard(req, body) {
  const { user, wb, wbDegraded } = await resolveStaffForWorkbook(req, body);
  assertReviewable(wb);
  const cardKey = String(body.card_key || "").trim();
  if (!cardKey) throw bad("card_key required");

  const { cards, degraded } = await readCardsStaff(wb.id);
  if (degraded || wbDegraded) {
    throw bad("this environment has not run the workbook apply migration (20260806T063000), so approvals cannot be recorded here", 409);
  }
  const card = cards.find((c) => c.card_key === cardKey);
  if (!card) throw bad("not found", 404);

  const answers = await readAnswersStaff(wb.id);
  const grouped = byCard(answers);
  const mine = grouped.get(card.id) || [];
  if (!cardCounts(mine)) throw bad("there is nothing on this card to approve", 409);
  // STAFF APPROVE WHAT THE OWNER CONFIRMED, never more. A card he did not
  // confirm is a card whose answer does not exist yet, and approving it would
  // stamp the staff act onto a value nobody stands behind.
  if (!card.confirmed_at) throw bad("the owner has not confirmed this card, so there is nothing to approve yet", 409);

  // Idempotent: the FIRST stamp is the record. Re-approving does not move it,
  // for the same reason confirm does not restamp confirmed_at.
  let approvedAt = card.approved_at;
  if (!approvedAt) {
    approvedAt = nowIso();
    await sb(`workbook_cards?id=eq.${enc(card.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ approved_at: approvedAt, approved_by: user.id, updated_at: approvedAt }),
    });
    card.approved_at = approvedAt;
    card.approved_by = user.id;
  }

  // When the LAST counted card is approved the workbook moves to 'reviewed'.
  // The filter makes it one conditional write: only a submitted workbook can
  // become reviewed, so two staff approving the last two cards at once cannot
  // stamp reviewed_at twice.
  const { counted, unapproved } = approvalGate(cards, grouped);
  let wbStatus = wb.status;
  if (!unapproved.length && wb.status === "submitted") {
    await sb(`workbooks?id=eq.${enc(wb.id)}&status=eq.submitted`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "reviewed", reviewed_at: nowIso(), updated_at: nowIso() }),
    });
    wbStatus = "reviewed";
  }

  return {
    ok: true,
    card: { card_key: card.card_key, approved_at: approvedAt, approved_by: card.approved_by },
    gate: { counted: counted.length, approved: counted.length - unapproved.length, unapproved_card_keys: unapproved },
    workbook_status: wbStatus,
  };
}

// ── apply: THE ORDERED WRITE ─────────────────────────────────────────────────
//
// The order is load-bearing, all four steps of it:
//
//   a. SNAPSHOT FIRST, and the first apply wins. The photograph is the only way
//      back once phase 3 (Stripe) exists - a price can be archived, never
//      deleted - so it is taken before anything is written and NEVER overwritten:
//      a second apply that re-photographed would capture the post-write state,
//      which is a picture of the thing it is supposed to undo.
//   b. TAX BEFORE ANYTHING ELSE. applyFee bakes the academy tax into every
//      minted amount, so the tax_config write must land before buildOfferTargets
//      reads it - tax after targets is every price minted pre-tax, the exact
//      defect the workbook exists to close.
//   c. OFFER WRITES per approved card, translated into the offer's vocabulary.
//      Answers stamp applied_at as they land and already-applied answers are
//      SKIPPED, so a run that dies halfway reruns safely - and a staff edit
//      made in the wizard after an apply is not clobbered by the rerun.
//   d. dry_run=true, THE DEFAULT: stop before Stripe and return what phase 3
//      WOULD do, as data. dry_run=false is refused outright this pass - the
//      live Stripe write ships only after this rehearsal has been rehearsed,
//      because building it first is assurance without connection.
async function doApplyStaff(req, body) {
  const { user, wb, wbDegraded } = await resolveStaffForWorkbook(req, body);
  assertReviewable(wb);

  // Refused BEFORE anything happens, so a dry_run:false call leaves not one
  // mark: no snapshot, no tax, no offer write. Nothing else in this function
  // may run first.
  if ((body || {}).dry_run === false) {
    throw bad("live apply arrives after the rehearsal - run the dry run until it is boring, then the Stripe write ships as its own reviewed step", 409, "live_apply_not_built");
  }

  const { cards, degraded } = await readCardsStaff(wb.id);
  if (degraded || wbDegraded) {
    throw bad("this environment has not run the workbook apply migration (20260806T063000), so apply cannot run here", 409);
  }
  const answers = await readAnswersStaff(wb.id);
  const grouped = byCard(answers);

  // THE GATE: every counted card carries the staff stamp, or nothing moves.
  const { unapproved } = approvalGate(cards, grouped);
  if (unapproved.length) {
    throw bad(
      `apply is refused: ${unapproved.length} card(s) are not approved yet (${unapproved.join(", ")}). Approve every card first - partial apply does not exist.`,
      409, "unapproved_cards"
    );
  }

  const cardById = new Map(cards.map((c) => [c.id, c]));

  // ── phase 0: classify and translate EVERYTHING before writing ANYTHING ────
  // Translation is pure, so every refusal it will ever produce is knowable up
  // front - and a half-applied workbook with one untranslatable answer in the
  // middle is exactly the state this pass exists to avoid.
  const skipped = { additions: [], notes: [], already_applied: [], no_answer: [] };
  const taxPending = [];
  const offerPending = [];   // { a, cls, value }
  const failures = [];
  for (const a of answers) {
    const eff = effective(a);
    const cls = classifyField(a.target_field);
    if (cls.kind === "manual") {
      (isAddition(a) ? skipped.additions : skipped.notes).push({ answer_id: a.id, target_field: a.target_field, effective: orNull(eff) });
      continue;
    }
    if (isBlank(eff)) { skipped.no_answer.push(a.id); continue; }
    if (a.applied_at) { skipped.already_applied.push(a.id); continue; }
    if (cls.kind === "tax") {
      if (a.target_table !== "clients") { failures.push({ answer_id: a.id, target_field: a.target_field, error: "a tax answer must target clients" }); continue; }
      const out = canonicalTax(eff);
      if (!out.ok) { failures.push({ answer_id: a.id, target_field: a.target_field, error: out.error }); continue; }
      taxPending.push({ a, value: out.value });
      continue;
    }
    if (cls.kind === "unknown" || a.target_table !== "offers") {
      failures.push({ answer_id: a.id, target_field: a.target_field, error: "this pass only applies offer pricing and the academy tax setting" });
      continue;
    }
    const out = cls.t(eff);
    if (!out.ok) { failures.push({ answer_id: a.id, target_field: a.target_field, error: out.error }); continue; }
    offerPending.push({ a, cls, value: out.value });
  }

  // Read the live offers and resolve every card to its offering BEFORE the
  // first write, so a card that cannot land refuses the whole apply while the
  // configuration is still untouched.
  const offerIds = [...new Set(
    answers.filter((x) => x.target_table === "offers" && x.target_id && !isAddition(x)).map((x) => String(x.target_id))
  )];
  const offerRows = offerIds.length
    ? (await sb(`offers?id=in.(${offerIds.map(enc).join(",")})&select=id,client_id,data`)) || []
    : [];
  const offerById = new Map(offerRows.map((r) => [String(r.id), r]));

  const offeringIdxByCard = new Map();
  for (const { a, cls } of offerPending) {
    if (cls.kind !== "plan" && cls.kind !== "rung") continue;
    if (offeringIdxByCard.has(a.card_id)) continue;
    const row = offerById.get(String(a.target_id));
    if (!row) {
      failures.push({ answer_id: a.id, target_field: a.target_field, error: "the offer this answer targets does not exist" });
      continue;
    }
    const offerings = (((row.data || {}).pricing) || {}).pricing_offerings || [];
    const idx = offeringIndexFor(grouped.get(a.card_id) || [], offerings);
    if (idx < 0) {
      const card = cardById.get(a.card_id);
      failures.push({
        answer_id: a.id, target_field: a.target_field,
        error: `no pricing option in the offer matches the ${card ? card.card_key : "plan"} card - a plan that does not exist yet is created by hand, not by apply`,
      });
      continue;
    }
    offeringIdxByCard.set(a.card_id, idx);
  }

  if (failures.length) {
    // The refusal is recorded ON the rows so review shows it, and nothing was
    // written: apply is all-or-nothing up to Stripe, which does not exist yet.
    for (const f of failures) {
      await sb(`workbook_answers?id=eq.${enc(f.answer_id)}&workbook_id=eq.${enc(wb.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ apply_error: f.error, updated_at: nowIso() }),
      }).catch(() => {});
    }
    return {
      ok: false,
      error: `${failures.length} answer(s) could not be translated into the offer's vocabulary, so nothing was applied.`,
      failures,
    };
  }

  // ── a. SNAPSHOT, first apply wins ─────────────────────────────────────────
  // The `snapshot=is.null` filter is what makes "first wins" true against a
  // concurrent apply: of two racing PATCHes exactly one matches, and the loser
  // writes nothing. Never overwrite the photograph with a post-write state.
  let snapshotState = "already";
  if (wb.snapshot == null) {
    const [clientRows, priceRows] = await Promise.all([
      sb(`clients?id=eq.${enc(wb.client_id)}&select=tax_config&limit=1`),
      sb(`offer_prices?tenant_id=eq.${enc(wb.client_id)}`).catch(() => []),
    ]);
    const photo = {
      taken_at: nowIso(),
      taken_by: user.id,
      offers: offerRows.map((r) => ({ id: r.id, data: orNull(r.data) })),
      tax_config: (Array.isArray(clientRows) && clientRows[0]) ? orNull(clientRows[0].tax_config) : null,
      offer_prices: Array.isArray(priceRows) ? priceRows : [],
    };
    await sb(`workbooks?id=eq.${enc(wb.id)}&snapshot=is.null`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ snapshot: photo, updated_at: nowIso() }),
    });
    snapshotState = "taken";
  }

  // The answers each write settles; stamped as the write they belong to lands,
  // and only where applied_at is still null, so a rerun cannot restamp.
  const stamp = async (ids) => {
    if (!ids.length) return;
    await sb(
      `workbook_answers?workbook_id=eq.${enc(wb.id)}&id=in.(${ids.map(enc).join(",")})&applied_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ applied_at: nowIso(), apply_error: null, updated_at: nowIso() }),
      }
    );
  };

  // ── b. TAX to clients, before any amount is computed ──────────────────────
  let taxResult = null;
  for (const { a, value } of taxPending) {
    await sb(`clients?id=eq.${enc(wb.client_id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ tax_config: value }),
    });
    await stamp([a.id]);
    taxResult = { answer_id: a.id, tax_config: value };
  }

  // ── c. OFFER jsonb writes, per offer row, per approved card ───────────────
  const offerReports = [];
  const byOffer = new Map();
  for (const p of offerPending) {
    const k = String(p.a.target_id);
    if (!byOffer.has(k)) byOffer.set(k, []);
    byOffer.get(k).push(p);
  }
  for (const [offerId, pendings] of byOffer) {
    const row = offerById.get(offerId);
    const data = row.data && typeof row.data === "object" ? row.data : {};
    data.pricing = data.pricing && typeof data.pricing === "object" ? data.pricing : {};
    const wrote = [];
    const agreed = [];
    for (const { a, cls, value } of pendings) {
      let holder;
      if (cls.kind === "code") {
        const codes = Array.isArray(data.pricing.discount_codes) ? data.pricing.discount_codes : [];
        data.pricing.discount_codes = codes;
        while (codes.length <= cls.index) codes.push({});
        holder = codes[cls.index];
      } else {
        const offerings = data.pricing.pricing_offerings || [];
        const off = offerings[offeringIdxByCard.get(a.card_id)];
        if (cls.kind === "rung") {
          const rungs = Array.isArray(off.commitments) ? off.commitments : [];
          off.commitments = rungs;
          while (rungs.length <= cls.index) rungs.push({});
          holder = rungs[cls.index];
        } else {
          holder = off;
        }
      }
      if (jsonEqual(holder[cls.leaf], value)) {
        agreed.push(a.id);        // the offer already says this; the answer lands trivially
      } else {
        holder[cls.leaf] = value;
        wrote.push({ answer_id: a.id, target_field: a.target_field, to: value });
      }
    }
    if (wrote.length) {
      await sb(`offers?id=eq.${enc(offerId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ data, updated_at: nowIso() }),
      });
    }
    await stamp([...wrote.map((w) => w.answer_id), ...agreed]);
    offerReports.push({ offer_id: offerId, wrote, already_matching: agreed.length });
  }

  // ── d. THE DRY-RUN REPORT: what phase 3 would do, as data ─────────────────
  // Built AFTER the tax and offer writes, so the targets carry the amounts a
  // real mint would use - tax baked in by applyFee inside buildOfferTargets.
  const phase3 = await phase3Preview(wb.client_id);

  // Status DOES NOT MOVE. apply(dry) leaves the workbook where the review left
  // it; nothing reaches 'applied' until a live apply exists to earn it.
  return {
    ok: true,
    dry_run: true,
    status: wb.status,
    snapshot: snapshotState,
    tax: taxResult,
    offers: offerReports,
    skipped,
    phase3,
  };
}

// What the Stripe phase WOULD do: every mintable target from the offer as it
// now stands, matched against the catalog snapshot table by amount + interval.
// PRINTED as data; nothing here talks to Stripe.
//
// buildOfferTargets is imported from match-prices.js rather than reimplemented,
// because it is where tax gets baked into amounts (resolveFee/applyFee) and a
// second copy of that math is a fork on a money path. Loaded lazily so this
// route does not drag the matcher's dependency tree into every owner autosave.
async function phase3Preview(clientId) {
  let mod;
  try {
    mod = await import("./offers/match-prices.js");
  } catch {
    throw bad("the phase 3 preview could not load api/offers/match-prices.js in this environment", 503);
  }
  if (typeof mod.buildOfferTargets !== "function") {
    throw bad("the phase 3 preview needs buildOfferTargets exported from api/offers/match-prices.js - it is not exported yet", 503);
  }
  // The term vocabulary is OPEN now (any 1-24 whole-month term), and the
  // machinery refuses loudly rather than collapsing an out-of-range length. A
  // refusal from target-building is a fact the rehearsal must SHOW, never a
  // crash: it comes back as data, and the writes that already landed stand.
  let targets;
  try {
    targets = await mod.buildOfferTargets(clientId);
  } catch (e) {
    // A sentence our own machinery wrote (see create-price.js termToInterval),
    // about a commitment length - no credential material travels this path.
    return { targets: [], matched: 0, would_mint: 0, refused: String((e && e.message) || "the price machinery refused to build targets") };
  }
  const [catalog, previewOffers] = await Promise.all([
    sb(`pricing_catalog?client_id=eq.${enc(clientId)}&select=stripe_price_id,offer_price_key,tier,amount_cents,interval,currency,display_name`).catch(() => []),
    sb(`offers?client_id=eq.${enc(clientId)}&status=neq.archived&select=id,data`).catch(() => []),
  ]);

  // REPORT-ONLY shape. The live mint (when it exists) goes through
  // create-price.js recurringFor, which also honors declared week rhythms and
  // per-row billing_cadence overrides; this only describes the STANDARD shape
  // so a human can read the rehearsal. `<n>_months` is handled generically -
  // the vocabulary is open, so a closed map here would misfile a 12-month term
  // as the 4-week default, which is a lie about a real clock.
  const shapeFor = (term) => {
    const t = String(term || "").toLowerCase();
    if (t === "one_time" || t === "signup_fee") return { interval: "one_time", recurring: null };
    const m = /^(\d+)_months$/.exec(t);
    if (m) return { interval: t, recurring: { interval: "month", interval_count: +m[1] } };
    if (t === "monthly" || t === "4_weeks") return { interval: "4_weeks", recurring: { interval: "week", interval_count: 4 } };
    return { interval: null, recurring: null };   // render whatever arrived; match nothing
  };

  // THE DECLARED RHYTHM, best effort, so staff SEE it in the rehearsal: San
  // Jose's "3 Months (12 Weeks)" bills his real members every 12 weeks, and a
  // mint on 3 calendar months would put new signups on a different clock
  // forever. The authoritative resolution lives in create-price.js
  // (cadenceFromLength + the CADENCES vocabulary) and is not exported, so this
  // is a NOTE, not a promise: the commitment is joined back by its price and
  // its week count is read off the label only when that join is unambiguous.
  const declaredWeeksFor = (t) => {
    if (!/^\d+_months$/.test(String(t.term || ""))) return null;
    for (const o of Array.isArray(previewOffers) ? previewOffers : []) {
      const offerings = (((o.data || {}).pricing) || {}).pricing_offerings || [];
      for (const off of offerings) {
        if (!off || String(off.title || "") !== String(t.offering || "")) continue;
        const hits = (off.commitments || []).filter(
          (c) => c && Math.round(parseFloat(c.price) * 100) === Number(t.base_cents)
        );
        if (hits.length !== 1) return null;
        const w = String(hits[0].length || "").toLowerCase().match(/(\d+)\s*week/);
        return w ? +w[1] : null;
      }
    }
    return null;
  };

  const rows = targets.map((t) => {
    const shape = shapeFor(t.term);
    const hit = shape.interval == null ? null : ((Array.isArray(catalog) ? catalog : []).find(
      (r) => Number(r.amount_cents) === Number(t.allin_cents) && String(r.interval) === shape.interval
    ) || null);
    const weeks = declaredWeeksFor(t);
    return {
      key: t.key,
      label: t.label,
      offering: t.offering,
      term: t.term,
      base_cents: t.base_cents,
      allin_cents: t.allin_cents,
      fee_label: t.fee_label || null,
      interval: shape.interval,
      recurring: shape.recurring,
      ...(weeks == null ? {} : {
        declared_weeks: weeks,
        rhythm_note: `the commitment length declares a ${weeks}-week billing rhythm; the mint resolves it through create-price.js cadence rules`,
      }),
      matched: hit ? { stripe_price_id: hit.stripe_price_id, tier: hit.tier, amount_cents: hit.amount_cents, display_name: hit.display_name || null } : null,
      needs_mint: !hit,
    };
  });
  return {
    targets: rows,
    matched: rows.filter((r) => !r.needs_mint).length,
    would_mint: rows.filter((r) => r.needs_mint).length,
  };
}

// ── publish: refused, deliberately, with the gate in the contract ────────────
async function doPublishStaff(req, body) {
  await resolveStaffForWorkbook(req, body);
  throw bad("publishing to parents is its own deliberate step and is not wired yet - nothing an apply writes reaches the public site until it is", 409, "publish_not_built");
}

// ── rollback: restore from the photograph ────────────────────────────────────
async function doRollbackStaff(req, body) {
  const { wb, wbDegraded } = await resolveStaffForWorkbook(req, body);
  if (wbDegraded) {
    throw bad("this environment has not run the workbook apply migration (20260806T063000), so there is no snapshot to restore from", 409);
  }
  if (wb.snapshot == null) throw bad("nothing to roll back - no apply has taken a snapshot of this workbook yet", 409);

  const snap = wb.snapshot;
  const restoredOffers = [];
  for (const o of Array.isArray(snap.offers) ? snap.offers : []) {
    if (!o || !o.id) continue;
    const restoredData = orNull(o.data);
    await sb(`offers?id=eq.${enc(o.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ data: restoredData, updated_at: nowIso() }),
    });
    restoredOffers.push(o.id);
  }
  const restoredTax = orNull(snap.tax_config);
  await sb(`clients?id=eq.${enc(wb.client_id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ tax_config: restoredTax }),
  });

  // The applied stamps come off so a future apply can land again; the snapshot
  // STAYS, because after a restore the configuration equals the photograph and
  // the photograph is still the only way back.
  await sb(`workbook_answers?workbook_id=eq.${enc(wb.id)}&applied_at=not.is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ applied_at: null, apply_error: null, updated_at: nowIso() }),
  });
  await sb(`workbooks?id=eq.${enc(wb.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "submitted", updated_at: nowIso() }),
  });

  return {
    ok: true,
    restored: { offers: restoredOffers, tax_config: true },
    // Honest and currently empty: live apply does not exist, so nothing has
    // touched Stripe or offer_prices and there is nothing that cannot come
    // back. The moment phase 3 ships, archived Stripe prices join this list.
    could_not_restore: [],
    status: "submitted",
  };
}

const STAFF_REVIEW_ACTIONS = {
  review: doReviewStaff,
  "approve-card": doApproveCard,
  apply: doApplyStaff,
  publish: doPublishStaff,
  rollback: doRollbackStaff,
};

// ── HTTP ─────────────────────────────────────────────────────────────────────
function readBody(req) {
  const b = req && req.body;
  if (!b) return {};
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { throw bad("body must be JSON"); }
  }
  return b;
}

function readToken(req, body) {
  const q = (req && req.query) || {};
  const fromQuery = Array.isArray(q.token) ? q.token[0] : q.token;
  if (fromQuery) return String(fromQuery).trim();
  const url = String((req && req.url) || "");
  const i = url.indexOf("?");
  if (i >= 0) {
    const t = new URLSearchParams(url.slice(i + 1)).get("token");
    if (t) return String(t).trim();
  }
  return String((body && body.token) || "").trim();
}

// The token can arrive inside a message we did not write - a PostgREST error
// quoting its own filter, most plausibly - and console.error is a sink like any
// other. So it is scrubbed on the way out rather than trusted not to be there.
const scrub = (text, token) => (token ? String(text).split(token).join("<token>") : String(text));

async function handler(req, res) {
  // EVERYTHING IS INSIDE THE TRY, including the method check and the body parse.
  // A guard that throws from outside a handler's try does not fail closed, it
  // CRASHES: Vercel answers FUNCTION_INVOCATION_FAILED with no body at all,
  // where the route used to refuse politely. That regression shipped three times
  // in one day in this repo, which is why it is a rule and not a habit.
  let token = "";
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "GET or POST required" });
    }

    if (req.method === "GET") {
      token = readToken(req, null);
      const wb = await resolveWorkbook(token);
      const [cards, answers, clients] = await Promise.all([
        readCards(wb.id),
        readAnswers(wb.id),
        sb(`clients?id=eq.${enc(wb.client_id)}&select=public_name,business_name&limit=1`),
      ]);
      const grouped = byCard(answers);
      return res.status(200).json({
        ok: true,
        workbook: {
          id: wb.id,
          kind: wb.kind,
          status: wb.status,
          academy_name: (Array.isArray(clients) && clients[0] && (clients[0].public_name || clients[0].business_name)) || null,
          submitted_at: wb.submitted_at,
        },
        cards: cards.map((c) => publicCard(c, grouped.get(c.id), addLeft(c, grouped.get(c.id) || [], answers))),
      });
    }

    const body = readBody(req);
    const action = String(body.action || "").trim();

    // Staff, not an owner: these branches never see a token. The review-and-
    // apply actions dispatch BEFORE the token is even read, so the owner's
    // no-login credential cannot reach them by any route - resolveStaff is the
    // only door, and it answers 401 to a caller with no staff bearer.
    if (action === "create") return res.status(200).json(await doCreate(req));
    if (Object.prototype.hasOwnProperty.call(STAFF_REVIEW_ACTIONS, action)) {
      return res.status(200).json(await STAFF_REVIEW_ACTIONS[action](req, body));
    }

    token = readToken(req, body);
    const wb = await resolveWorkbook(token);
    if (action === "save") return res.status(200).json(await doSave(wb, body));
    if (action === "add") return res.status(200).json(await doAdd(wb, body));
    if (action === "remove") return res.status(200).json(await doRemove(wb, body));
    if (action === "confirm") return res.status(200).json(await doConfirm(wb, body));
    if (action === "submit") {
      const out = await doSubmit(wb);
      // 200 EVEN WHEN ok IS FALSE, on purpose. A refused submit is a fully
      // understood answer carrying `remaining` - the number the page shows the
      // owner. A 4xx invites a fetch wrapper to throw before anyone reads the
      // body, and then the owner is told "something went wrong" instead of
      // "2 cards still need to be confirmed". `ok` is the signal; the status
      // code says the conversation happened.
      return res.status(200).json(out);
    }
    throw bad(`unknown action: ${action}`);
  } catch (e) {
    // ONLY A MESSAGE WE WROTE IS EVER ECHOED. .status is the tell: bad() sets it
    // and bad() is us. Anything else is a throw we did not write - a runtime
    // TypeError quoting a whole Authorization header, most dangerously - and its
    // message is not ours to forward. The detail goes to the log, scrubbed of
    // the one thing the log must never hold.
    if (e && e.status) {
      return res.status(e.status).json({
        ok: false,
        error: e.message || "request refused",
        ...(e.code ? { code: e.code } : {}),
      });
    }
    console.error("workbook unexpected error:", scrub((e && e.stack) || String(e), token));
    return res.status(500).json({ ok: false, error: "something went wrong on our side. Please try again." });
  }
}

export default withSentryApiRoute(handler);
