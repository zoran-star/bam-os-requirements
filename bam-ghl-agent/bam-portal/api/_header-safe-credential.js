// ── credentials are header values, and header values are printable ASCII ─────
//
// THE FAILURE THIS EXISTS FOR, and it has already shipped once: the staff panel
// returned a live Stripe key to the browser. A secret arrives with a line break
// IN THE MIDDLE of it (copied out of a wrapped email, a Slack code block, a PDF,
// or `echo`d into a secret store on two lines). .trim() cannot see that - trim
// only touches the ends - so it passes every shape check and reaches fetch,
// where undici refuses it with
//
//   TypeError: Headers.append: "Bearer svc_AAAA\nBBBB" is an invalid header value.
//
// That TypeError QUOTES THE WHOLE CREDENTIAL and carries no .status, so any
// route doing `res.status(e.status || 500).json({ error: e.message })` - or
// stuffing e.message into a field of a JSON body, which is how api/health.js did
// it - hands a live credential to whoever asked.
//
// Redaction is not the fix. Scrubbing the message for sk_live_[A-Za-z0-9]* does
// NOT work: the break splits the credential, the pattern stops at the break, and
// the tail stays on screen. Refusal is the fix, and the refusal carries no
// credential material at all.
//
// api/_stripe-transport.js closed this for everything routed through the Stripe
// seam. This module is the same two rules for the raw-fetch call sites that do
// not and should not route through that seam (health probing, BAM's own platform
// Stripe reads, the CH3 direct-key precedent). The transport keeps its own copy
// on purpose: it is the one doorway and does not import sideways.

export const HEADER_UNSAFE = /[^\x20-\x7E]/;

// ── TRIM FIRST, THEN REFUSE ──────────────────────────────────────────────────
//
// The two cases look identical to a flat printable-ASCII test and are not the
// same thing:
//
//   LEADING/TRAILING whitespace is a PASTE ARTIFACT - how the value happened to
//   be stored. `echo` instead of `printf` into `vercel env add` leaves a \n on
//   the end; production's SUPABASE_SERVICE_KEY carries exactly that today. The
//   credential itself is intact, so it is trimmed away and USED. Refusing it
//   would turn a cosmetic artifact into a hard outage.
//
//   An EMBEDDED break - non-printable STILL THERE AFTER the trim - is a broken
//   credential AND the leak vector above. Refused.
//
// .trim() strips spaces, \t, \r and \n at both ends and only at the ends, which
// is precisely the line between the two cases.
//
// "EMBEDDED IN WHAT" IS THE WHOLE SUBTLETY, and it is measured rather than
// assumed. The rule is NOT "only a break inside the key matters". It is: only a
// non-printable character embedded in the finished HEADER VALUE matters - and
// because the value is built as `Bearer ${key}`, whitespace LEADING THE KEY is
// already in the middle of that value while whitespace trailing it is not.
//
// Executed on Node v24.14.0, header value -> outcome:
//
//   "Bearer key\n"   accepted, stored as "Bearer key"   (trailing: WHATWG strips
//                    it before validating, so it never reached the wire and
//                    production's trailing-newline service key cannot 401)
//   "Bearer \nkey"   TypeError QUOTING THE WHOLE VALUE  (a LEADING break on the
//                    key is interior to the value - this is the leak)
//   "Bearer  key"    accepted and SENT VERBATIM with the space - a silent 401
//                    that no refusal can ever catch, because nothing is invalid
//
// That third row is why the trim is not cosmetic: it is the only thing that
// fixes the shape which throws nothing and simply fails auth unreadably. A bare
// header (apikey: key) has the key at both ends of the value, so there both ends
// are stripped by the runtime anyway - the asymmetry is created by the "Bearer "
// prefix, not by the key.
export function normalizeCredential(v) {
  return String(v ?? "").trim();
}

// STATUSLESS ON PURPOSE. Every call site of this helper reads its credential out
// of env, so a break in one is OUR misconfiguration, not the caller's input. A
// 4xx would tell an API consumer it sent something wrong; 500 is the truthful
// answer. (api/_stripe-transport.js stamps .status on ITS refusal because there
// the credential is staff-pasted and .status is that codebase's signal that a
// save was refused and nothing happened.)
//
// RETURNS THE NORMALIZED VALUE, and every call site must send back what it
// returns - otherwise the trimmed value is checked and the untrimmed one is
// sent, which is the same bug in a nicer costume.
export function assertHeaderSafeCredential(value, what) {
  const normalized = normalizeCredential(value);
  // MISSING IS ITS OWN ANSWER, not a quiet "". Returning "" here builds
  // `Authorization: Bearer ` - a request that is syntactically fine, travels,
  // and comes back 401 "invalid credentials", which sends whoever is debugging
  // it hunting for a rotated key that is in fact absent. Whitespace-only is the
  // same state wearing a disguise (a botched `vercel env add` is the usual
  // source) and must not be told apart from empty by accident.
  if (normalized === "") {
    throw Object.assign(
      new Error(`${what} is not configured (missing, empty, or whitespace only)`),
      { credentialMissing: true }
    );
  }
  if (HEADER_UNSAFE.test(normalized)) {
    throw new Error(`${what} contains a line break or non-printable character - re-set it without the break`);
  }
  return normalized;
}

// ── belt as well as braces: nothing the runtime wrote is ever passed on ──────
//
// The refusal above closes the leak we found. This closes the shape we have not
// found yet. Node's fetch errors are REQUEST MATERIAL: the invalid-header
// TypeError quotes the header verbatim, a DNS failure names the host, and a
// future undici can put anything it likes in there. So the message handed onward
// is always one we wrote. What survives is the error's NAME and, when it is a
// plain symbolic constant, its cause code - enough to tell a timeout from a DNS
// failure, carrying nothing anyone typed.
// BOTH fields are allowlisted, not one. An earlier version of this passed e.name
// through unfiltered while carefully filtering e.cause.code, and the comment
// above claimed the discipline for the whole function - a claim broader than
// what was enforced, which is the exact failure shape this module exists for.
// e.name is an ordinary writable property: anything that reaches this catch can
// set it to a credential, and `${what} request failed (${e.name})` would print
// it. So both must look like a symbolic constant or they are dropped.
// TWO grammars, not one, and both are TIGHT. A single `[A-Za-z][A-Za-z0-9_]*`
// allowlist looked disciplined and let the canary straight through, because that
// is exactly the shape of an API key: sk_live_ABC123 is letters, digits and
// underscores. So each field is held to the grammar its real values actually
// have, which a credential does not share:
//
//   cause codes are SCREAMING_SNAKE and short   ENOTFOUND, ECONNRESET, UND_ERR_SOCKET
//   error names are CamelCase with NO underscore TypeError, AbortError, DOMException
//
// A lowercase-plus-underscore token is neither, so sk_live_... / rk_live_... /
// eyJ... fail both. RESIDUAL, stated rather than papered over: a hostile value
// that is itself short and CamelCase (or short and SCREAMING_SNAKE) still gets
// printed - it is no longer a recoverable credential at that point, but this is
// an allowlist, not a proof.
const SAFE_CAUSE_CODE = /^[A-Z][A-Z0-9_]{0,31}$/;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

// READING A PROPERTY CAN THROW. e.name and e.cause can be getters (or a Proxy),
// and a throw here escapes safeFetch's catch as a DIFFERENT error - one nobody
// sanitised - which is a leak through the exit door of the leak guard. Every
// read is therefore defensive, and an unreadable field is simply absent.
function safeRead(fn) {
  try { const v = fn(); return v == null ? "" : String(v); } catch { return ""; }
}

export function describeFetchFailure(e, what) {
  const rawName = safeRead(() => e && e.name) || "Error";
  const name = SAFE_ERROR_NAME.test(rawName) ? rawName : "Error";
  const rawCode = safeRead(() => (e && e.cause && e.cause.code) || (e && e.code));
  const code = SAFE_CAUSE_CODE.test(rawCode) ? rawCode : "";
  return `${what} request failed (${name}${code ? `: ${code}` : ""})`;
}

// NO .status here either, and for a different reason than above: a fetch can
// throw AFTER the request landed. Claiming a 4xx would tell a caller "refused,
// nothing happened" at the moment something had just happened.
export function sanitizeFetchError(e, what) {
  const err = new Error(describeFetchFailure(e, what));
  err.transportFailure = true;
  return err;
}

export async function safeFetch(url, init, what) {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw sanitizeFetchError(e, what);
  }
}
