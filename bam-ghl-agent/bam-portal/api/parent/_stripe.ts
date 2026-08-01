import { stripeFetch as transportStripeFetchUntyped } from "../_stripe-transport.js";

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

export function isTestMode(): boolean {
  return String(process.env.ONBOARDING_STRIPE_SECRET_KEY || "").startsWith("sk_test");
}

export function intervalFor(term: string | null | undefined): StripeInterval {
  if (term === "3_months") return { interval: "month", interval_count: 3 };
  if (term === "6_months") return { interval: "month", interval_count: 6 };
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
      keyOverride: process.env.ONBOARDING_STRIPE_SECRET_KEY || undefined,
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
