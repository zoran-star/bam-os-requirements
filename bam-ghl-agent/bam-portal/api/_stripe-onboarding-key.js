// ONE reading of ONBOARDING_STRIPE_SECRET_KEY, so the mode decision and the
// credential can never disagree.
//
// THE FAILURE THIS EXISTS FOR. Four checkout routes each asked the raw env var
// whether they were in test mode:
//
//   String(process.env.ONBOARDING_STRIPE_SECRET_KEY || "").indexOf("sk_test") === 0
//
// while handing that same raw value to the transport as keyOverride. The
// transport now trims it. So a test key stored with a LEADING space or newline
// gave:
//
//   isTestMode() = false, and the request authenticated with "Bearer sk_test_..."
//
// The route took its LIVE branches - live account header, live idempotency-key
// namespace - on a test credential. Before the transport trimmed, the same
// paste produced a 401: visibly broken. Half-working is worse than broken,
// because nobody goes looking.
//
// TRAILING whitespace was always harmless here (the sk_test prefix is intact);
// LEADING whitespace is the trigger. Rather than sprinkle four .trim() calls
// that can drift apart again, both answers come from one function: whatever the
// mode check judged IS the string handed over as the credential. The transport
// normalizes again on the way in, which is a no-op on an already-trimmed value.

// ── "ABSENT" AND "SET TO NOTHING" ARE DIFFERENT STATES ───────────────────────
//
// THE REGRESSION THIS PARAGRAPH EXISTS FOR, which the first version of this
// module shipped. Normalizing turned a whitespace-only value into "", and ""
// was then handed back as `undefined` meaning "no override". So:
//
//   ONBOARDING_STRIPE_SECRET_KEY="   "   (a botched `vercel env add`)
//     before: keyOverride "   " -> "Bearer " -> Stripe 401. Loudly broken.
//     after:  no override at all -> the transport falls THROUGH to the PLATFORM
//             key, isTestMode() is false, and an academy that believed it was in
//             the test sandbox takes its LIVE branches and charges REAL MONEY on
//             BAM's own Stripe account.
//
// That is "half-working is worse than broken" inverted onto a payment path: the
// exact rule the rest of this file was written to honor. So the two states are
// told apart deliberately:
//
//   ABSENT (undefined)          no sandbox was ever asked for. No override; the
//                               resolver picks its normal envelope. Unchanged.
//   PRESENT BUT EMPTY ("", " ") a sandbox WAS asked for and is misconfigured.
//                               THROW. Never silently borrow another account's
//                               live credential to satisfy it.
//
// The throw is a 500 out of the route's existing catch, carries no key material,
// and names the variable so the fix is obvious.
const NOT_A_CREDENTIAL =
  "ONBOARDING_STRIPE_SECRET_KEY is set but empty or whitespace only. It cannot become an Authorization Bearer credential, " +
  "and falling back to the platform key would charge live money on the wrong account. Unset the variable to disable the " +
  "test sandbox, or set it to a real key.";

// The same normalization api/_stripe-transport.js applies before building a
// header - trim only, because whitespace at the ends is how a value got stored,
// not what it is. A break in the MIDDLE is refused there, by the transport, and
// must stay refused there: this module decides MODE, it does not guard headers.
export function onboardingStripeKey() {
  const raw = process.env.ONBOARDING_STRIPE_SECRET_KEY;
  if (raw === undefined) return ""; // absent: nobody asked for the sandbox
  const normalized = String(raw).trim();
  if (normalized === "") throw Object.assign(new Error(NOT_A_CREDENTIAL), { status: 500, credentialMissing: true });
  return normalized;
}

// undefined, not "", when absent: the transport treats a falsy keyOverride as
// "no override, resolve normally". A misconfigured-to-empty value never gets
// this far - onboardingStripeKey() throws first, which is the point.
export function onboardingKeyOverride() {
  return onboardingStripeKey() || undefined;
}

// The test-sandbox switch: onboarding runs against Stripe TEST while the rest of
// the portal keeps the live Connect key. Read from the normalized value above,
// which is the whole point of this module - and it throws on the misconfigured
// value for the same reason, so a route can never conclude "not test mode" from
// a sandbox that was requested and is broken.
export function isOnboardingTestMode() {
  return onboardingStripeKey().startsWith("sk_test");
}
