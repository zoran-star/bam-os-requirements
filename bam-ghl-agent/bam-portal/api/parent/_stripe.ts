const STRIPE_API = "https://api.stripe.com/v1";

type StripeBodyValue = boolean | number | string | null | undefined;

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

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${STRIPE_API}${path}`, {
    body: body ? encodeStripeBody(body) : undefined,
    headers,
    method,
  });
  const text = await res.text();
  const json = text ? safeJsonParse(text) : {};

  if (!res.ok) {
    throw new StripeFetchError(stripeErrorMessage(json) || `Stripe ${res.status}`, res.status, json);
  }

  return json as T;
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

function encodeStripeBody(body: Record<string, StripeBodyValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value != null) params.set(key, String(value));
  }
  return params.toString();
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function stripeErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
