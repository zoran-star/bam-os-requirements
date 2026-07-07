import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import { getParentReadContext, type ParentReadContext, type ParentReadStudent } from "./_parent-context.js";
import { eq, sb } from "./_supabase.js";
import { isTestMode, stripeFetch } from "./_stripe.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

const BILLING_DETAILS_FAILED_MESSAGE = "We couldn't load billing details right now.";
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

type ClientRow = {
  business_name: string | null;
  id: string;
  stripe_connect_account_id: string | null;
};

type StripeList<T> = {
  data?: T[];
};

type StripeCustomer = {
  email?: string | null;
  id?: string;
  invoice_settings?: {
    default_payment_method?: StripePaymentMethod | string | null;
  } | null;
};

type StripePaymentMethod = {
  card?: {
    brand?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
    last4?: string | null;
  } | null;
  id?: string;
  type?: string | null;
};

type StripeSubscription = {
  cancel_at_period_end?: boolean | null;
  current_period_end?: number | null;
  default_payment_method?: StripePaymentMethod | string | null;
  id?: string;
  items?: {
    data?: Array<{
      // Stripe API 2025-03-31+ moved current_period_end from the subscription
      // root onto its items; read both so the mapping survives either pin.
      current_period_end?: number | null;
      price?: {
        currency?: string | null;
        unit_amount?: number | null;
      } | null;
    }>;
  } | null;
  metadata?: Record<string, string | null | undefined> | null;
  status?: string | null;
};

type StripeInvoice = {
  amount_due?: number | null;
  amount_paid?: number | null;
  created?: number | null;
  currency?: string | null;
  description?: string | null;
  hosted_invoice_url?: string | null;
  id?: string;
  lines?: {
    data?: Array<{
      description?: string | null;
      parent?: {
        subscription_details?: {
          metadata?: Record<string, string | null | undefined> | null;
        } | null;
      } | null;
    }>;
  } | null;
  status?: string | null;
};

type StripeSetupIntent = {
  customer?: string | null;
  id?: string;
  metadata?: Record<string, string | null | undefined> | null;
  payment_method?: StripePaymentMethod | string | null;
  status?: string | null;
};

type BillingPaymentMethodOut = {
  brand: string;
  exp_month: number;
  exp_year: number;
  id: string;
  last4: string;
};

type NextChargeOut = {
  amount_cents: number | null;
  cancel_at_period_end: boolean;
  currency: string;
  next_charge_at: string | null;
  status: "active" | "trialing" | "past_due";
  student_id: string | null;
  student_name: string | null;
  subscription_id: string;
};

type BillingInvoiceOut = {
  amount_cents: number;
  currency: string;
  date: string;
  description: string;
  id: string;
  receipt_url: string | null;
  status: "paid" | "open" | "failed" | "void" | "draft";
};

type BillingGroupOut = {
  academy_id: string;
  academy_name: string;
  invoices: BillingInvoiceOut[];
  next_charges: NextChargeOut[];
  payment_method: BillingPaymentMethodOut | null;
};

type AcademyBillingContext = {
  client: ClientRow;
  stripeAccount: string | null;
  testMode: boolean;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  try {
    const action = queryValue(req.query?.action);

    if (action === "summary") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return await getSummary(req, res);
    }

    if (action === "payment-method") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      return await createPaymentMethodSetupIntent(req, res);
    }

    if (action === "payment-method-default") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      return await setDefaultPaymentMethod(req, res);
    }

    throw new HttpError(404, "Not found.");
  } catch (error) {
    return sendError(res, error);
  }
}

async function getSummary(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getParentReadContext(req);
  const testMode = isTestMode();
  const groups: BillingGroupOut[] = [];

  for (const academyId of context.academyIds) {
    const academy = await resolveAcademyBillingContext(context, academyId);
    if (!testMode && !academy.stripeAccount) {
      groups.push(emptyGroup(academy.client));
      continue;
    }

    const customerIds = await resolveCustomerIds(context, academyId, academy.stripeAccount);
    const group: BillingGroupOut = emptyGroup(academy.client);
    for (const customerId of customerIds) {
      const customerBilling = await loadCustomerBilling(context, customerId, academy.stripeAccount);
      group.next_charges.push(...customerBilling.next_charges);
      group.invoices.push(...customerBilling.invoices);
      group.payment_method ??= customerBilling.payment_method;
    }
    group.invoices.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    groups.push(group);
  }

  return res.status(200).json({ groups, test_mode: testMode });
}

async function createPaymentMethodSetupIntent(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getParentReadContext(req);
  const body = readJsonObject(req.body);
  const academyId = requiredString(body.academy_id, "academy_id");
  const academy = await resolveAcademyBillingContext(context, academyId);
  if (!academy.testMode && !academy.stripeAccount) {
    throw new HttpError(409, "academy is not connected to Stripe");
  }

  let customerId = (await resolveCustomerIds(context, academyId, academy.stripeAccount))[0] || null;
  if (!customerId) {
    const customer = await stripeFetch<StripeCustomer>("/customers", {
      body: {
        email: normalizeEmail(context.profile.email),
        "metadata[source]": "fullcontrol-parent-app",
        name: fullName(context.profile.first_name, context.profile.last_name) || null,
        phone: context.profile.phone,
      },
      method: "POST",
      stripeAccount: academy.stripeAccount,
    });
    customerId = customer.id || null;
  }
  if (!customerId) throw new HttpError(502, "Payment setup failed. Please try again.");

  const setupIntent = await stripeFetch<{ client_secret?: string; id?: string }>("/setup_intents", {
    body: {
      // Saved cards must be chargeable off-session for subscription renewals,
      // so redirect-based payment methods are excluded up front.
      "automatic_payment_methods[allow_redirects]": "never",
      "automatic_payment_methods[enabled]": "true",
      customer: customerId,
      "metadata[client_id]": academyId,
      "metadata[customer_profile_id]": context.profile.id,
      "metadata[origin]": "fullcontrol-parent-app",
      usage: "off_session",
    },
    method: "POST",
    stripeAccount: academy.stripeAccount,
  });

  if (!setupIntent.client_secret || !setupIntent.id) {
    throw new HttpError(502, "Payment setup failed. Please try again.");
  }

  return res.status(200).json({
    client_secret: setupIntent.client_secret,
    customer_id: customerId,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
    setup_intent_id: setupIntent.id,
    stripe_account: academy.stripeAccount,
    test_mode: academy.testMode,
  });
}

async function setDefaultPaymentMethod(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getParentReadContext(req);
  const body = readJsonObject(req.body);
  const academyId = requiredString(body.academy_id, "academy_id");
  const setupIntentId = requiredString(body.setup_intent_id, "setup_intent_id");
  const academy = await resolveAcademyBillingContext(context, academyId);
  if (!academy.testMode && !academy.stripeAccount) {
    throw new HttpError(409, "academy is not connected to Stripe");
  }

  const setupIntent = await stripeFetch<StripeSetupIntent>(
    `/setup_intents/${encodeURIComponent(setupIntentId)}?expand%5B%5D=payment_method`,
    { stripeAccount: academy.stripeAccount },
  );
  if (setupIntent.metadata?.customer_profile_id !== context.profile.id) {
    throw new HttpError(404, "Setup intent not found.");
  }

  const paymentMethodId = typeof setupIntent.payment_method === "string"
    ? setupIntent.payment_method
    : setupIntent.payment_method?.id || null;
  if (setupIntent.status !== "succeeded" || !setupIntent.customer || !paymentMethodId) {
    throw new HttpError(409, "Payment method is not ready.");
  }

  const paymentMethod = typeof setupIntent.payment_method === "string"
    ? await stripeFetch<StripePaymentMethod>(`/payment_methods/${encodeURIComponent(setupIntent.payment_method)}`, {
      stripeAccount: academy.stripeAccount,
    })
    : setupIntent.payment_method;
  const card = toCardPaymentMethod(paymentMethod);
  if (!card) throw new HttpError(409, "Payment method is not ready.");

  await stripeFetch<StripeCustomer>(`/customers/${encodeURIComponent(setupIntent.customer)}`, {
    body: { "invoice_settings[default_payment_method]": card.id },
    method: "POST",
    stripeAccount: academy.stripeAccount,
  });

  const subscriptions = await stripeFetch<StripeList<StripeSubscription>>(
    `/subscriptions?customer=${encodeURIComponent(setupIntent.customer)}&status=all&limit=20`,
    { stripeAccount: academy.stripeAccount },
  );
  for (const subscription of subscriptions.data || []) {
    if (!isKeptSubscription(subscription) || !subscription.id) continue;
    await stripeFetch<StripeSubscription>(`/subscriptions/${encodeURIComponent(subscription.id)}`, {
      body: { default_payment_method: card.id },
      method: "POST",
      stripeAccount: academy.stripeAccount,
    });
  }

  return res.status(200).json({ ok: true, payment_method: card });
}

async function resolveAcademyBillingContext(
  context: ParentReadContext,
  academyId: string,
): Promise<AcademyBillingContext> {
  if (!context.academyIds.includes(academyId)) {
    throw new HttpError(404, "Academy not found.");
  }
  const client = await getClient(academyId);
  if (!client) throw new HttpError(404, "Academy not found.");
  const testMode = isTestMode();
  return {
    client,
    stripeAccount: testMode ? null : client.stripe_connect_account_id,
    testMode,
  };
}

async function getClient(academyId: string): Promise<ClientRow | null> {
  const rows = await sb<ClientRow[]>(
    `clients?id=eq.${eq(academyId)}&select=id,business_name,stripe_connect_account_id&limit=1`,
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function resolveCustomerIds(
  context: ParentReadContext,
  academyId: string,
  stripeAccount: string | null,
): Promise<string[]> {
  const testMode = isTestMode();
  if (!testMode) {
    const stored = [
      ...new Set(context.memberships
        .filter((membership) => membership.academy_id === academyId)
        .map((membership) => membership.stripe_customer_id)
        .filter((id): id is string => Boolean(id))),
    ];
    // The update flow targets the primary customer. Divergent legacy customers
    // keep their card until memberships are consolidated.
    if (stored.length > 0) return stored;
  }

  const found = await stripeFetch<StripeList<StripeCustomer>>(
    `/customers?email=${encodeURIComponent(normalizeEmail(context.profile.email))}&limit=1`,
    { stripeAccount },
  );
  return (found.data || []).map((customer) => customer.id).filter((id): id is string => Boolean(id));
}

async function loadCustomerBilling(
  context: ParentReadContext,
  customerId: string,
  stripeAccount: string | null,
): Promise<{
  invoices: BillingInvoiceOut[];
  next_charges: NextChargeOut[];
  payment_method: BillingPaymentMethodOut | null;
}> {
  try {
    const subscriptions = await stripeFetch<StripeList<StripeSubscription>>(
      `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20&expand%5B%5D=data.default_payment_method`,
      { stripeAccount },
    );
    const keptSubscriptions = (subscriptions.data || []).filter(isKeptSubscription);
    const invoices = await stripeFetch<StripeList<StripeInvoice>>(
      `/invoices?customer=${encodeURIComponent(customerId)}&limit=12`,
      { stripeAccount },
    );
    const paymentMethod = firstCardPaymentMethod(keptSubscriptions)
      || await loadCustomerDefaultPaymentMethod(customerId, stripeAccount);

    return {
      invoices: (invoices.data || []).map(mapInvoice),
      next_charges: keptSubscriptions.map((subscription) => mapNextCharge(context, subscription)),
      payment_method: paymentMethod,
    };
  } catch (error) {
    console.error("[parent-billing] failed to load Stripe billing details", error);
    throw new HttpError(502, BILLING_DETAILS_FAILED_MESSAGE);
  }
}

async function loadCustomerDefaultPaymentMethod(
  customerId: string,
  stripeAccount: string | null,
): Promise<BillingPaymentMethodOut | null> {
  const customer = await stripeFetch<StripeCustomer>(
    `/customers/${encodeURIComponent(customerId)}?expand%5B%5D=invoice_settings.default_payment_method`,
    { stripeAccount },
  );
  const paymentMethod = customer.invoice_settings?.default_payment_method;
  return typeof paymentMethod === "string" ? null : toCardPaymentMethod(paymentMethod);
}

function firstCardPaymentMethod(subscriptions: StripeSubscription[]): BillingPaymentMethodOut | null {
  for (const subscription of subscriptions) {
    const paymentMethod = subscription.default_payment_method;
    const card = typeof paymentMethod === "string" ? null : toCardPaymentMethod(paymentMethod);
    if (card) return card;
  }
  return null;
}

function toCardPaymentMethod(paymentMethod: StripePaymentMethod | null | undefined): BillingPaymentMethodOut | null {
  const card = paymentMethod?.card;
  if (!paymentMethod?.id || !card) return null;
  if (!card.brand || !card.last4 || !card.exp_month || !card.exp_year) return null;
  return {
    brand: card.brand,
    exp_month: card.exp_month,
    exp_year: card.exp_year,
    id: paymentMethod.id,
    last4: card.last4,
  };
}

function mapNextCharge(context: ParentReadContext, subscription: StripeSubscription): NextChargeOut {
  const item = subscription.items?.data?.[0];
  const metadata = subscription.metadata || {};
  const student = metadata.student_id ? findContextStudent(context.students, metadata.student_id) : null;
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const periodEnd = subscription.current_period_end ?? item?.current_period_end ?? null;
  return {
    amount_cents: item?.price?.unit_amount ?? null,
    cancel_at_period_end: cancelAtPeriodEnd,
    currency: item?.price?.currency || "cad",
    next_charge_at: cancelAtPeriodEnd || !periodEnd
      ? null
      : new Date(periodEnd * 1000).toISOString(),
    status: subscription.status as NextChargeOut["status"],
    student_id: student?.id || null,
    student_name: student ? fullName(student.first_name, student.last_name) || null : metadata.athlete_name || null,
    subscription_id: subscription.id || "",
  };
}

function mapInvoice(invoice: StripeInvoice): BillingInvoiceOut {
  const status = mapInvoiceStatus(invoice.status);
  return {
    amount_cents: status === "paid" ? invoice.amount_paid ?? 0 : invoice.amount_due ?? 0,
    currency: invoice.currency || "cad",
    date: invoice.created ? new Date(invoice.created * 1000).toISOString() : new Date(0).toISOString(),
    description: invoiceDescription(invoice),
    id: invoice.id || "",
    receipt_url: invoice.hosted_invoice_url || null,
    status,
  };
}

function invoiceDescription(invoice: StripeInvoice): string {
  const line = invoice.lines?.data?.[0];
  if (line?.description) return line.description;
  if (invoice.description) return invoice.description;
  const metadata = line?.parent?.subscription_details?.metadata;
  if (metadata) {
    return `${metadata.athlete_name || "Membership"} — ${metadata.plan || "plan"}`;
  }
  return "Membership payment";
}

function mapInvoiceStatus(status: string | null | undefined): BillingInvoiceOut["status"] {
  if (status === "paid" || status === "open" || status === "void" || status === "draft") return status;
  if (status === "uncollectible") return "failed";
  return "open";
}

function isKeptSubscription(subscription: StripeSubscription): subscription is StripeSubscription & {
  status: "active" | "trialing" | "past_due";
} {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(String(subscription.status));
}

function emptyGroup(client: ClientRow): BillingGroupOut {
  return {
    academy_id: client.id,
    academy_name: client.business_name || "Academy",
    invoices: [],
    next_charges: [],
    payment_method: null,
  };
}

function findContextStudent(students: ParentReadStudent[], studentId: string): ParentReadStudent | null {
  return students.find((student) => student.id === studentId) || null;
}

function readJsonObject(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  return {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}

function queryValue(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
  return typeof value === "string" ? value : null;
}

function methodNotAllowed(res: ParentApiResponse, allow: string) {
  res.setHeader("Allow", allow);
  return res.status(405).json({ error: "method not allowed" });
}

function normalizeEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase();
}

function fullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return [firstName, lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

export default withSentryApiRoute(handler);
