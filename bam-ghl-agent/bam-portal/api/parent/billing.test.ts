import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./billing.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

type MockResponse = ParentApiResponse & {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
};

const userId = "90000000-0000-4000-8000-000000000001";
const profileId = "90000000-0000-4000-8000-000000000101";
const tenantId = "90000000-0000-4000-8000-000000000201";
const otherTenantId = "90000000-0000-4000-8000-000000000202";
const studentId = "90000000-0000-4000-8000-000000000301";
const customerId = "cus_parent_123";
const otherCustomerId = "cus_parent_456";
const stripeAccountId = "acct_parent_123";

const profile = {
  created_at: "2026-07-03T12:00:00.000Z",
  email: "PARENT@EXAMPLE.TEST ",
  first_name: "Parent",
  id: profileId,
  last_name: "Tester",
  phone: "+15555550123",
  profile_type: "PARENT",
  supabase_user_id: userId,
  updated_at: "2026-07-03T12:00:00.000Z",
};

const student = {
  created_at: "2026-07-03T12:00:00.000Z",
  date_of_birth: "2014-03-10",
  first_name: "Alex",
  id: studentId,
  last_name: "Rivera",
  notes: null,
  parent_id: profileId,
  updated_at: "2026-07-03T12:00:00.000Z",
};

const profileMembership = {
  academy_id: tenantId,
  customer_id: profileId,
  ghl_contact_id: null,
  id: "90000000-0000-4000-8000-000000000601",
  joined_at: "2026-07-03T12:00:00.000Z",
  plan_id: null,
  status: "ACTIVE",
  stripe_customer_id: customerId,
  student_id: null,
};

const studentMembership = {
  ...profileMembership,
  customer_id: null,
  id: "90000000-0000-4000-8000-000000000602",
  student_id: studentId,
};

const client = {
  business_name: "BAM Academy",
  id: tenantId,
  stripe_connect_account_id: stripeAccountId,
};

const otherClient = {
  business_name: "Second Academy",
  id: otherTenantId,
  stripe_connect_account_id: "acct_second_123",
};

describe("/api/parent/billing", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.ONBOARDING_STRIPE_SECRET_KEY = "sk_live_fake";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_fake";
    vi.restoreAllMocks();
  });

  it("returns a summary with an active subscription card and invoice history", async () => {
    mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: stripeList([stripeSubscription()]), match: "api.stripe.com/v1/subscriptions?customer=cus_parent_123" },
      { body: stripeList([
        stripeInvoice({ id: "in_paid", status: "paid" }),
        stripeInvoice({
          amount_due: 8900,
          created: 1_782_950_400,
          hosted_invoice_url: null,
          id: "in_open",
          lines: { data: [{ description: null, parent: { subscription_details: { metadata: { athlete_name: "Alex", plan: "Performance" } } } }] },
          status: "open",
        }),
      ]), match: "api.stripe.com/v1/invoices?customer=cus_parent_123" },
    ]);

    const res = await invoke({ method: "GET", query: { action: "summary" } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      groups: [{
        academy_id: tenantId,
        academy_name: "BAM Academy",
        invoices: [
          {
            amount_cents: 8900,
            currency: "cad",
            date: "2026-07-02T00:00:00.000Z",
            description: "Alex — Performance",
            id: "in_open",
            receipt_url: null,
            status: "open",
          },
          {
            amount_cents: 12500,
            currency: "cad",
            date: "2026-06-02T00:00:00.000Z",
            description: "Membership - June",
            id: "in_paid",
            receipt_url: "https://invoice.test/in_paid",
            status: "paid",
          },
        ],
        next_charges: [{
          amount_cents: 12500,
          cancel_at_period_end: false,
          currency: "cad",
          next_charge_at: "2026-08-01T00:00:00.000Z",
          status: "active",
          student_id: studentId,
          student_name: "Alex Rivera",
          subscription_id: "sub_parent_123",
        }],
        payment_method: {
          brand: "visa",
          exp_month: 12,
          exp_year: 2030,
          id: "pm_card_123",
          last4: "4242",
        },
      }],
      test_mode: false,
    });
  });

  it("uses email lookup in test mode and ignores stored customer ids", async () => {
    process.env.ONBOARDING_STRIPE_SECRET_KEY = "sk_test_fake";
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [{ ...client, stripe_connect_account_id: null }], match: "/rest/v1/clients?id=eq" },
      { body: stripeList([{ id: "cus_test_email" }]), match: "api.stripe.com/v1/customers?email=parent%40example.test&limit=1" },
      { body: stripeList([]), match: "api.stripe.com/v1/subscriptions?customer=cus_test_email" },
      { body: stripeList([]), match: "api.stripe.com/v1/invoices?customer=cus_test_email" },
      { body: { id: "cus_test_email", invoice_settings: { default_payment_method: null } }, match: "api.stripe.com/v1/customers/cus_test_email" },
    ]);

    const res = await invoke({ method: "GET", query: { action: "summary" } });

    expect(res.statusCode).toBe(200);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("customer=cus_parent_123"))).toBe(false);
  });

  it("returns an empty group when no Stripe customer exists", async () => {
    mockSupabaseFetch([
      ...parentContextResponses({
        memberships: [{ ...profileMembership, stripe_customer_id: null }],
        studentMemberships: [],
      }),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: stripeList([]), match: "api.stripe.com/v1/customers?email=parent%40example.test&limit=1" },
    ]);

    const res = await invoke({ method: "GET", query: { action: "summary" } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      groups: [{ invoices: [], next_charges: [], payment_method: null }],
    });
  });

  it("falls back to the customer invoice_settings default payment method", async () => {
    mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: stripeList([stripeSubscription({ default_payment_method: null })]), match: "api.stripe.com/v1/subscriptions?customer=cus_parent_123" },
      { body: stripeList([]), match: "api.stripe.com/v1/invoices?customer=cus_parent_123" },
      {
        body: {
          id: customerId,
          invoice_settings: {
            default_payment_method: stripePaymentMethod({
              card: { brand: "visa", exp_month: 12, exp_year: 2030, last4: "1111" },
              id: "pm_fallback",
            }),
          },
        },
        match: "api.stripe.com/v1/customers/cus_parent_123",
      },
    ]);

    const res = await invoke({ method: "GET", query: { action: "summary" } });

    expect(res.statusCode).toBe(200);
    expect((res.body as { groups: Array<{ payment_method: unknown }> }).groups[0]?.payment_method).toMatchObject({
      id: "pm_fallback",
      last4: "1111",
    });
  });

  it("maps uncollectible invoices to failed and uses amount_due for non-paid invoices", async () => {
    mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: stripeList([]), match: "api.stripe.com/v1/subscriptions?customer=cus_parent_123" },
      { body: stripeList([stripeInvoice({ amount_due: 2222, amount_paid: 0, status: "uncollectible" })]), match: "api.stripe.com/v1/invoices?customer=cus_parent_123" },
      { body: { id: customerId, invoice_settings: { default_payment_method: null } }, match: "api.stripe.com/v1/customers/cus_parent_123" },
    ]);

    const res = await invoke({ method: "GET", query: { action: "summary" } });

    expect(res.statusCode).toBe(200);
    expect((res.body as { groups: Array<{ invoices: Array<{ amount_cents: number; status: string }> }> }).groups[0]?.invoices[0]).toMatchObject({
      amount_cents: 2222,
      status: "failed",
    });
  });

  it("groups two academies separately and sends Stripe-Account for connected live accounts", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses({
        memberships: [
          profileMembership,
          { ...profileMembership, academy_id: otherTenantId, id: "90000000-0000-4000-8000-000000000603", stripe_customer_id: otherCustomerId },
        ],
      }),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: stripeList([]), match: "api.stripe.com/v1/subscriptions?customer=cus_parent_123" },
      { body: stripeList([]), match: "api.stripe.com/v1/invoices?customer=cus_parent_123" },
      { body: { id: customerId, invoice_settings: { default_payment_method: null } }, match: "api.stripe.com/v1/customers/cus_parent_123" },
      { body: [otherClient], match: "/rest/v1/clients?id=eq" },
      { body: stripeList([]), match: "api.stripe.com/v1/subscriptions?customer=cus_parent_456" },
      { body: stripeList([]), match: "api.stripe.com/v1/invoices?customer=cus_parent_456" },
      { body: { id: otherCustomerId, invoice_settings: { default_payment_method: null } }, match: "api.stripe.com/v1/customers/cus_parent_456" },
    ]);

    const res = await invoke({ method: "GET", query: { action: "summary" } });

    expect(res.statusCode).toBe(200);
    expect((res.body as { groups: Array<{ academy_id: string }> }).groups.map((group) => group.academy_id)).toEqual([
      tenantId,
      otherTenantId,
    ]);
    const stripeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("customer=cus_parent_123"));
    expect((stripeCall?.[1]?.headers as Record<string, string>)["Stripe-Account"]).toBe(stripeAccountId);
  });

  it("creates a customer when missing and returns a SetupIntent bundle", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses({
        memberships: [{ ...profileMembership, stripe_customer_id: null }],
        studentMemberships: [],
      }),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: stripeList([]), match: "api.stripe.com/v1/customers?email=parent%40example.test&limit=1" },
      { body: { id: customerId }, match: "api.stripe.com/v1/customers" },
      { body: { client_secret: "seti_secret_123", id: "seti_123" }, match: "api.stripe.com/v1/setup_intents" },
    ]);

    const res = await invoke({ body: { academy_id: tenantId }, method: "POST", query: { action: "payment-method" } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      client_secret: "seti_secret_123",
      customer_id: customerId,
      publishable_key: "pk_live_fake",
      setup_intent_id: "seti_123",
      stripe_account: stripeAccountId,
      test_mode: false,
    });
    const createCustomer = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/customers") && init?.method === "POST");
    expect(new URLSearchParams(String(createCustomer?.[1]?.body)).get("metadata[source]")).toBe("fullcontrol-parent-app");
    const setupIntent = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/v1/setup_intents"));
    const setupParams = new URLSearchParams(String(setupIntent?.[1]?.body));
    expect(setupParams.get("customer")).toBe(customerId);
    expect(setupParams.get("metadata[customer_profile_id]")).toBe(profileId);
    expect(setupParams.get("metadata[client_id]")).toBe(tenantId);
    expect(setupParams.get("automatic_payment_methods[enabled]")).toBe("true");
  });

  it("rejects payment-method for missing academy and live unconnected academy", async () => {
    mockSupabaseFetch(parentContextResponses());
    const missing = await invoke({ body: { academy_id: otherTenantId }, method: "POST", query: { action: "payment-method" } });
    expect(missing.statusCode).toBe(404);

    mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [{ ...client, stripe_connect_account_id: null }], match: "/rest/v1/clients?id=eq" },
    ]);
    const unconnected = await invoke({ body: { academy_id: tenantId }, method: "POST", query: { action: "payment-method" } });
    expect(unconnected.statusCode).toBe(409);
    expect(unconnected.body).toEqual({ error: "academy is not connected to Stripe" });
  });

  it("returns 404 for setup intent ownership mismatch without Stripe writes", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      {
        body: { customer: customerId, id: "seti_123", metadata: { customer_profile_id: "someone-else" }, payment_method: stripePaymentMethod(), status: "succeeded" },
        match: "api.stripe.com/v1/setup_intents/seti_123",
      },
    ]);

    const res = await invoke({
      body: { academy_id: tenantId, setup_intent_id: "seti_123" },
      method: "POST",
      query: { action: "payment-method-default" },
    });

    expect(res.statusCode).toBe(404);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("api.stripe.com") && init?.method === "POST")).toBe(false);
  });

  it("returns 409 when the setup intent is not succeeded", async () => {
    mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      {
        body: { customer: customerId, id: "seti_123", metadata: { customer_profile_id: profileId }, payment_method: stripePaymentMethod(), status: "requires_payment_method" },
        match: "api.stripe.com/v1/setup_intents/seti_123",
      },
    ]);

    const res = await invoke({
      body: { academy_id: tenantId, setup_intent_id: "seti_123" },
      method: "POST",
      query: { action: "payment-method-default" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("sets customer and active subscription default payment methods", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [client], match: "/rest/v1/clients?id=eq" },
      {
        body: { customer: customerId, id: "seti_123", metadata: { customer_profile_id: profileId }, payment_method: "pm_card_123", status: "succeeded" },
        match: "api.stripe.com/v1/setup_intents/seti_123",
      },
      { body: stripePaymentMethod(), match: "api.stripe.com/v1/payment_methods/pm_card_123" },
      { body: { id: customerId }, match: "api.stripe.com/v1/customers/cus_parent_123" },
      { body: stripeList([stripeSubscription(), stripeSubscription({ id: "sub_inactive", status: "canceled" })]), match: "api.stripe.com/v1/subscriptions?customer=cus_parent_123" },
      { body: { id: "sub_parent_123" }, match: "api.stripe.com/v1/subscriptions/sub_parent_123" },
    ]);

    const res = await invoke({
      body: { academy_id: tenantId, setup_intent_id: "seti_123" },
      method: "POST",
      query: { action: "payment-method-default" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      payment_method: { brand: "visa", exp_month: 12, exp_year: 2030, id: "pm_card_123", last4: "4242" },
    });
    const customerPost = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/v1/customers/cus_parent_123") && init?.method === "POST");
    expect(new URLSearchParams(String(customerPost?.[1]?.body)).get("invoice_settings[default_payment_method]")).toBe("pm_card_123");
    const subPost = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/v1/subscriptions/sub_parent_123") && init?.method === "POST");
    expect(new URLSearchParams(String(subPost?.[1]?.body)).get("default_payment_method")).toBe("pm_card_123");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/subscriptions/sub_inactive"))).toBe(false);
  });

  it("handles method guards and unknown actions", async () => {
    expect((await invoke({ method: "POST", query: { action: "summary" } })).headers.Allow).toBe("GET");
    expect((await invoke({ method: "GET", query: { action: "payment-method" } })).headers.Allow).toBe("POST");
    expect((await invoke({ method: "GET", query: { action: "payment-method-default" } })).headers.Allow).toBe("POST");
    const unknown = await invoke({ method: "GET", query: { action: "missing" } });
    expect(unknown.statusCode).toBe(404);
  });
});

function parentContextResponses({
  memberships = [profileMembership],
  studentMemberships = [studentMembership],
  students = [student],
}: {
  memberships?: unknown[];
  studentMemberships?: unknown[];
  students?: unknown[];
} = {}) {
  const responses = [
    { body: { id: userId }, match: "/auth/v1/user" },
    { body: [profile], match: "/rest/v1/customer_profiles" },
    { body: students, match: "/rest/v1/students?parent_id" },
    { body: memberships, match: "/rest/v1/academy_memberships?customer_id" },
  ];
  if (students.length > 0) {
    responses.push({
      body: studentMemberships,
      match: "/rest/v1/academy_memberships?student_id",
    });
  }
  return responses;
}

function stripeList<T>(data: T[]) {
  return { data };
}

function stripePaymentMethod(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    card: {
      brand: "visa",
      exp_month: 12,
      exp_year: 2030,
      last4: "4242",
      ...(overrides.card as Record<string, unknown> | undefined),
    },
    id: "pm_card_123",
    type: "card",
    ...overrides,
  };
}

function stripeSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    cancel_at_period_end: false,
    current_period_end: 1_785_542_400,
    default_payment_method: stripePaymentMethod(),
    id: "sub_parent_123",
    items: { data: [{ price: { currency: "cad", unit_amount: 12500 } }] },
    metadata: { athlete_name: "Alex Rivera", student_id: studentId },
    status: "active",
    ...overrides,
  };
}

function stripeInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    amount_due: 12500,
    amount_paid: 12500,
    created: 1_780_358_400,
    currency: "cad",
    description: null,
    hosted_invoice_url: "https://invoice.test/in_paid",
    id: "in_paid",
    lines: { data: [{ description: "Membership - June" }] },
    status: "paid",
    ...overrides,
  };
}

async function invoke(req: {
  body?: unknown;
  method: string;
  query?: Record<string, string>;
}): Promise<MockResponse> {
  const res = mockResponse();
  await handler(
    {
      body: req.body,
      headers: { authorization: "Bearer parent-token" },
      method: req.method,
      query: req.query ?? {},
    } satisfies ParentApiRequest,
    res,
  );
  return res;
}

function mockResponse(): MockResponse {
  const res = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    statusCode: 200,
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
}

function mockSupabaseFetch(
  responses: Array<{ body: unknown; match: string; status?: number }>,
) {
  const queue = [...responses];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    if (!url.includes(next.match)) {
      throw new Error(`Expected fetch URL to include ${next.match}, received ${url}`);
    }

    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  });
}
