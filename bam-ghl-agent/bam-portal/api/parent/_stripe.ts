import {
  publishableFor as publishableForUntyped,
  stripeFetch as transportStripeFetchUntyped,
} from "../_stripe-transport.js";
import { onboardingKeyOverride } from "../_stripe-onboarding-key.js";

// A RE-EXPORT, NOT A WRAPPER, and that is a structural decision rather than a
// stylistic one. This file is TypeScript and the suites are plain node with no
// build step, so isTestMode can never be EXECUTED by a test - only pinned. A
// wrapper whose body is `return isOnboardingTestMode();` looked airtight and was
// not: the drift just moves into the local alias
//   const isOnboardingTestMode = () => rawIsTestMode() && noLeadingSpace();
// and every pin still passes while isTestMode() returns false for a leading-space
// sk_test key. A re-export has NO BODY and NO ALIAS to host that branch, so the
// defeat has nowhere to live. When a thing cannot be tested, make it unable to be
// wrong instead.
export { isOnboardingTestMode as isTestMode } from "../_stripe-onboarding-key.js";

// THE CREDENTIAL GETS THE SAME TREATMENT, and the comment that used to sit here
// is deleted rather than softened. It claimed this alias "IS executed, by
// api/_stripe-callsite-wave.test.mjs driving the real transport", which was
// FALSE for the reason stated three lines above it: no suite transpiles this
// .ts file, so nothing here is ever executed. A drifting alias -
//   const onboardingKeyOverride = () => { const v = raw(); return v?.trim() === v ? v : undefined; }
// - returns undefined for a whitespace override, the transport falls through to
// the PLATFORM key, and defect 4 is back in the parent app with every suite
// green. So there is no alias: the import is used directly at the call site.
// Fixing the claim and the code together is the rule this whole change exists
// to enforce, and it applies to the file doing the enforcing.

type StripeBodyValue = boolean | number | string | null | undefined;

// The transport is plain JS; tsc cannot infer its destructured options object,
// so type the seam here exactly as the transport reads it.
type TransportOptions = {
  body?: Record<string, StripeBodyValue> | string;
  idempotencyKey?: string;
  keyOverride?: string;
  method?: string;
  stripeAccount?: string;
};
const transportStripeFetch =
  transportStripeFetchUntyped as (path: string, opts?: TransportOptions) => Promise<unknown>;

// What the browser mounts Stripe.js with, per transport: Connect academies get
// the platform publishable key + connected account id (byte-identical to the
// old env read); a direct academy gets its OWN publishable key and NO account.
export type PublishableInfo = {
  publishable_key: string | null;
  stripe_account: string | null;
};
export const publishableFor =
  publishableForUntyped as (stripeAccount?: string | null) => Promise<PublishableInfo>;

export type StripeFetchOptions = {
  body?: Record<string, StripeBodyValue>;
  idempotencyKey?: string;
  method?: string;
  stripeAccount?: string | null;
};

export type StripeInterval = {
  interval: "month" | "week";
  interval_count: number;
};

export class StripeFetchError extends Error {
  readonly responseBody: unknown;
  readonly stripeStatus: number | null;

  constructor(message: string, stripeStatus: number | null = null, responseBody: unknown = null) {
    super(message);
    this.name = "StripeFetchError";
    this.stripeStatus = stripeStatus;
    this.responseBody = responseBody;
  }
}

export function stripeKey(): string | undefined {
  return (
    process.env.ONBOARDING_STRIPE_SECRET_KEY ||
    process.env.STRIPE_CONNECT_SECRET_KEY ||
    process.env.STRIPE_SECRET_KEY
  );
}

export function intervalFor(term: string | null | undefined): StripeInterval {
  if (term === "3_months") return { interval: "month", interval_count: 3 };
  if (term === "6_months") return { interval: "month", interval_count: 6 };
  // Adjustable prepay lengths (Zoran, 2026-08-06): any bounded <n>_months term
  // bills calendar months, mirroring intervalFor in api/website/checkout.js.
  // The two branches above stay byte-identical - they are what live members
  // bill on. Out of range REFUSES LOUDLY: the old week x4 default would charge
  // a "27_months" member every 4 weeks with no error anywhere.
  const m = /^(\d+)_months$/.exec(String(term || ""));
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 24) return { interval: "month", interval_count: n };
    throw new StripeFetchError(`term "${term}" is ${n} months, outside the 1-24 month range this build can bill - fix the commitment length on the offer`);
  }
  return { interval: "week", interval_count: 4 };
}

export async function stripeFetch<T = unknown>(
  path: string,
  { body, idempotencyKey, method = "GET", stripeAccount }: StripeFetchOptions = {},
): Promise<T> {
  const key = stripeKey();
  if (!key) throw new StripeFetchError("Stripe secret key not configured");

  // Delegates to THE seam (api/_stripe-transport.js). ONBOARDING_STRIPE_SECRET_KEY
  // keeps today's precedence exactly - when set it overrides transport resolution,
  // which is what stripeKey() always did. Transport errors are rethrown as this
  // module's StripeFetchError so the importers keep their catch contract
  // (message / stripeStatus / responseBody).
  try {
    return (await transportStripeFetch(path, {
      body: body ?? undefined,
      idempotencyKey,
      method,
      stripeAccount: stripeAccount ?? undefined,
      // The SAME normalized string isTestMode() judged, so the mode this module
      // reports and the key it authenticates with cannot disagree.
      keyOverride: onboardingKeyOverride(),
    })) as T;
  } catch (e) {
    if (e instanceof StripeFetchError) throw e;
    const err = e as { message?: string; stripeStatus?: number | null; responseBody?: unknown };
    throw new StripeFetchError(err.message || "Stripe request failed", err.stripeStatus ?? null, err.responseBody ?? null);
  }
}

export function piSecretFromSub(sub: unknown): string | null {
  if (!sub || typeof sub !== "object") return null;
  const latestInvoice = (sub as { latest_invoice?: unknown }).latest_invoice;
  if (!latestInvoice || typeof latestInvoice !== "object") return null;

  const confirmationSecret = (latestInvoice as { confirmation_secret?: unknown }).confirmation_secret;
  if (confirmationSecret && typeof confirmationSecret === "object") {
    const clientSecret = (confirmationSecret as { client_secret?: unknown }).client_secret;
    if (typeof clientSecret === "string" && clientSecret.length > 0) return clientSecret;
  }

  const paymentIntent = (latestInvoice as { payment_intent?: unknown }).payment_intent;
  if (paymentIntent && typeof paymentIntent === "object") {
    const clientSecret = (paymentIntent as { client_secret?: unknown }).client_secret;
    if (typeof clientSecret === "string" && clientSecret.length > 0) return clientSecret;
  }

  return null;
}

// Body encoding, JSON parsing and error-message extraction now live in the
// transport (api/_stripe-transport.js), byte-compatible with what used to be here.
