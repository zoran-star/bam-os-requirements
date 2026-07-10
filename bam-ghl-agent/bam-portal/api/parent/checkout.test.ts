import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./checkout.js";
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
const otherStudentId = "90000000-0000-4000-8000-000000000302";
const offerPriceId = "90000000-0000-4000-8000-000000000401";
const memberId = "90000000-0000-4000-8000-000000000501";
const subscriptionId = "sub_parent_123";
const customerId = "cus_parent_123";
const stripeAccountId = "acct_parent_123";

const profile = {
  created_at: "2026-07-03T12:00:00.000Z",
  email: "PARENT@EXAMPLE.TEST",
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
  stripe_customer_id: null,
  student_id: null,
};

const studentMembership = {
  ...profileMembership,
  customer_id: null,
  id: "90000000-0000-4000-8000-000000000602",
  stripe_customer_id: null,
  student_id: studentId,
};

const livePrice = {
  amount_cents: 12500,
  billing_interval: "4_weeks",
  currency: "cad",
  id: offerPriceId,
  is_active: true,
  is_routable: true,
  source_offer_id: "offer-parent",
  source_offer_price_key: "Performance|monthly",
  stripe_price_id: "price_live_parent",
  tenant_id: tenantId,
  title: "Performance",
};

const client = {
  business_name: "BAM Academy",
  id: tenantId,
  stripe_connect_account_id: stripeAccountId,
};

describe("POST /api/parent/checkout", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.ONBOARDING_STRIPE_SECRET_KEY = "sk_live_fake";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_fake";
    vi.restoreAllMocks();
  });

  it("returns 405 on GET", async () => {
    const res = await invoke({
      headers: { authorization: "Bearer parent-token" },
      method: "GET",
    });

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("POST");
    expect(res.body).toEqual({ error: "method not allowed" });
  });

  it.each([
    ["student_id", { offer_price_id: offerPriceId }],
    ["offer_price_id", { student_id: studentId }],
  ])("returns 400 when %s is missing", async (_field, body) => {
    const fetchMock = mockSupabaseFetch(parentContextResponses());

    const res = await invoke({
      body,
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(400);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/rest/v1/offer_prices"))).toBe(false);
  });

  it("returns 404 when the student is not owned by the parent", async () => {
    const fetchMock = mockSupabaseFetch(parentContextResponses());

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: otherStudentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Student not found." });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/rest/v1/offer_prices"))).toBe(false);
  });

  it("returns 409 when the price row is inactive or unroutable", async () => {
    mockSupabaseFetch([
      ...parentContextResponses(),
      {
        body: [{ ...livePrice, is_active: false, is_routable: false }],
        match: "/rest/v1/offer_prices?id=eq",
      },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "That plan is not available." });
  });

  it("returns 409 when the price belongs to another academy", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      {
        body: [{ ...livePrice, tenant_id: otherTenantId }],
        match: "/rest/v1/offer_prices?id=eq",
      },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "That plan is not available." });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/rest/v1/clients"))).toBe(false);
  });

  it("creates a live incomplete subscription and binds the student", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [livePrice], match: "/rest/v1/offer_prices?id=eq" },
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: [], match: "/rest/v1/member_links?student_id=eq" },
      { body: { data: [] }, match: "api.stripe.com/v1/customers?email" },
      { body: { id: customerId }, match: "api.stripe.com/v1/customers" },
      { body: stripeSubscription(), match: "api.stripe.com/v1/subscriptions" },
      {
        body: [{
          id: memberId,
          status: "payment_method_required",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        }],
        match: "/rest/v1/members?select=",
      },
      { body: [], match: "/rest/v1/member_links?member_id=eq" },
      { body: {}, match: "/rest/v1/member_links" },
      { body: {}, match: "/rest/v1/member_audit_log" },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      amount_cents: livePrice.amount_cents,
      client_secret: "cs_parent_secret",
      customer_id: customerId,
      member_id: memberId,
      stripe_account: stripeAccountId,
      subscription_id: subscriptionId,
    });

    const subscriptionCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/v1/subscriptions") && init?.method === "POST",
    );
    expect(subscriptionCall).toBeTruthy();
    const subscriptionParams = new URLSearchParams(String(subscriptionCall?.[1]?.body));
    expect(subscriptionParams.get("payment_behavior")).toBe("default_incomplete");
    expect(subscriptionParams.get("items[0][price]")).toBe(livePrice.stripe_price_id);
    expect(subscriptionParams.get("metadata[student_id]")).toBe(studentId);
    expect(subscriptionParams.get("metadata[customer_profile_id]")).toBe(profileId);
    expect(subscriptionParams.get("metadata[origin]")).toBe("fullcontrol-parent-app");
    const createHeaders = subscriptionCall?.[1]?.headers as Record<string, string>;
    expect(createHeaders["Idempotency-Key"]).toContain("-r-none");

    const memberPostCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/rest/v1/members?select=") && init?.method === "POST",
    );
    expect(memberPostCall).toBeTruthy();
    const memberBody = JSON.parse(String(memberPostCall?.[1]?.body)) as Array<Record<string, unknown>>;
    expect(memberBody[0]).toMatchObject({
      status: "payment_method_required",
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
    });

    const linkPostCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/rest/v1/member_links") && init?.method === "POST",
    );
    expect(linkPostCall).toBeTruthy();
    const linkBody = JSON.parse(String(linkPostCall?.[1]?.body)) as Array<Record<string, unknown>>;
    expect(linkBody[0]).toMatchObject({
      matched_by: "manual",
      member_id: memberId,
      student_id: studentId,
    });
  });

  it("reuses an existing incomplete subscription without creating new rows", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [livePrice], match: "/rest/v1/offer_prices?id=eq" },
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: [{ member_id: memberId }], match: "/rest/v1/member_links?student_id=eq" },
      {
        body: [{
          client_id: tenantId,
          id: memberId,
          status: "payment_method_required",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        }],
        match: "/rest/v1/members?id=eq",
      },
      { body: stripeSubscription(), match: `api.stripe.com/v1/subscriptions/${subscriptionId}` },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      client_secret: "cs_parent_secret",
      member_id: memberId,
      reused: true,
      subscription_id: subscriptionId,
    });
    expect(fetchMock.mock.calls.some(
      ([url, init]) => String(url).includes("/v1/subscriptions") && init?.method === "POST",
    )).toBe(false);
    expect(fetchMock.mock.calls.some(
      ([url, init]) => String(url).includes("/rest/v1/members") && ["PATCH", "POST"].includes(String(init?.method)),
    )).toBe(false);
    expect(fetchMock.mock.calls.some(
      ([url, init]) => String(url).includes("/rest/v1/member_links") && ["PATCH", "POST"].includes(String(init?.method)),
    )).toBe(false);
  });

  it("returns 409 before any Stripe call when the student is linked to a member of another academy", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [livePrice], match: "/rest/v1/offer_prices?id=eq" },
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: [{ member_id: memberId }], match: "/rest/v1/member_links?student_id=eq" },
      {
        body: [{
          client_id: otherTenantId,
          id: memberId,
          status: "live",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        }],
        match: "/rest/v1/members?id=eq",
      },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: "This child's membership is managed by a different academy. Please contact the academy to set up this plan.",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("api.stripe.com"))).toBe(false);
  });

  it("uses a subscription origin the Stripe webhook treats as portal-owned", async () => {
    // Contract with api/stripe/webhook.js: portal-owned subs are skipped by
    // handleSubCreated (no premature 'live') and activated + access-synced on
    // the first paid invoice. If this fails, paid parent-app purchases never
    // grant entitlements.
    const { isPortalOwnedOrigin } = await import("../stripe/webhook.js");
    expect(isPortalOwnedOrigin("fullcontrol-parent-app")).toBe(true);
  });

  it("cancels a stale incomplete subscription for a different plan and creates a fresh one", async () => {
    const staleSubscriptionId = "sub_parent_stale";
    const freshSubscriptionId = "sub_parent_fresh";
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [livePrice], match: "/rest/v1/offer_prices?id=eq" },
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: [{ member_id: memberId }], match: "/rest/v1/member_links?student_id=eq" },
      {
        body: [{
          client_id: tenantId,
          id: memberId,
          status: "payment_method_required",
          stripe_customer_id: customerId,
          stripe_subscription_id: staleSubscriptionId,
        }],
        match: "/rest/v1/members?id=eq",
      },
      {
        body: stripeSubscription({
          id: staleSubscriptionId,
          metadata: { offer_price_id: "90000000-0000-4000-8000-000000000499" },
        }),
        match: `api.stripe.com/v1/subscriptions/${staleSubscriptionId}`,
      },
      { body: { id: staleSubscriptionId, status: "canceled" }, match: `api.stripe.com/v1/subscriptions/${staleSubscriptionId}` },
      { body: stripeSubscription({ id: freshSubscriptionId }), match: "api.stripe.com/v1/subscriptions" },
      { body: {}, match: "/rest/v1/members?id=eq" },
      {
        body: [{ id: "link-1", member_id: memberId, student_id: studentId }],
        match: "/rest/v1/member_links?member_id=eq",
      },
      { body: {}, match: "/rest/v1/member_links?member_id=eq" },
      { body: {}, match: "/rest/v1/member_audit_log" },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      client_secret: "cs_parent_secret",
      member_id: memberId,
      subscription_id: freshSubscriptionId,
    });

    const cancelCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes(`/v1/subscriptions/${staleSubscriptionId}`) && init?.method === "DELETE",
    );
    expect(cancelCall).toBeTruthy();

    const subscriptionCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/v1/subscriptions") && init?.method === "POST",
    );
    expect(subscriptionCall).toBeTruthy();
    const subscriptionParams = new URLSearchParams(String(subscriptionCall?.[1]?.body));
    expect(subscriptionParams.get("metadata[offer_price_id]")).toBe(offerPriceId);

    // The create key must be scoped to the sub it replaces: a bare
    // student+price key would idempotently REPLAY the original create on an
    // A -> B -> A plan switch and hand back a cancelled subscription whose
    // PaymentIntent is terminal.
    const createHeaders = subscriptionCall?.[1]?.headers as Record<string, string>;
    expect(createHeaders["Idempotency-Key"]).toContain(`-r-${staleSubscriptionId}`);

    const memberPatchCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/rest/v1/members?id=eq") && init?.method === "PATCH",
    );
    expect(memberPatchCall).toBeTruthy();
    expect(JSON.parse(String(memberPatchCall?.[1]?.body))).toMatchObject({
      stripe_subscription_id: freshSubscriptionId,
    });
  });

  it("returns already_active for an existing active subscription", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [livePrice], match: "/rest/v1/offer_prices?id=eq" },
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: [{ member_id: memberId }], match: "/rest/v1/member_links?student_id=eq" },
      {
        body: [{
          client_id: tenantId,
          id: memberId,
          status: "live",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        }],
        match: "/rest/v1/members?id=eq",
      },
      {
        body: stripeSubscription({ status: "active" }),
        match: `api.stripe.com/v1/subscriptions/${subscriptionId}`,
      },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      already_active: true,
      member_id: memberId,
      ok: true,
      subscription_id: subscriptionId,
    });
    expect(fetchMock.mock.calls.some(
      ([url, init]) => String(url).includes("/v1/subscriptions") && init?.method === "POST",
    )).toBe(false);
  });

  it("creates an inline recurring price in test mode", async () => {
    process.env.ONBOARDING_STRIPE_SECRET_KEY = "sk_test_fake";

    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses({
        memberships: [{ ...profileMembership, stripe_customer_id: customerId }],
      }),
      {
        body: [{ ...livePrice, stripe_price_id: null }],
        match: "/rest/v1/offer_prices?id=eq",
      },
      {
        body: [{ ...client, stripe_connect_account_id: null }],
        match: "/rest/v1/clients?id=eq",
      },
      { body: [], match: "/rest/v1/member_links?student_id=eq" },
      { body: { data: [{ id: customerId }] }, match: "api.stripe.com/v1/customers?email" },
      { body: { id: "price_inline_parent" }, match: "api.stripe.com/v1/prices" },
      {
        body: stripeSubscription({ id: "sub_test_parent" }),
        match: "api.stripe.com/v1/subscriptions",
      },
      {
        body: [{
          id: memberId,
          status: "payment_method_required",
          stripe_customer_id: customerId,
          stripe_subscription_id: "sub_test_parent",
        }],
        match: "/rest/v1/members?select=",
      },
      { body: [], match: "/rest/v1/member_links?member_id=eq" },
      { body: {}, match: "/rest/v1/member_links" },
      { body: {}, match: "/rest/v1/member_audit_log" },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      stripe_account: null,
      subscription_id: "sub_test_parent",
    });

    const priceCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/v1/prices") && init?.method === "POST",
    );
    expect(priceCall).toBeTruthy();
    const priceParams = new URLSearchParams(String(priceCall?.[1]?.body));
    expect(priceParams.get("unit_amount")).toBe(String(livePrice.amount_cents));
    expect(priceParams.get("recurring[interval]")).toBe("week");
    expect(priceParams.get("recurring[interval_count]")).toBe("4");

    const subscriptionCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/v1/subscriptions") && init?.method === "POST",
    );
    const subscriptionParams = new URLSearchParams(String(subscriptionCall?.[1]?.body));
    expect(subscriptionParams.get("items[0][price]")).toBe("price_inline_parent");
  });

  it("returns a friendly 502 when Stripe subscription creation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockSupabaseFetch([
      ...parentContextResponses({
        memberships: [{ ...profileMembership, stripe_customer_id: customerId }],
      }),
      { body: [livePrice], match: "/rest/v1/offer_prices?id=eq" },
      { body: [client], match: "/rest/v1/clients?id=eq" },
      { body: [], match: "/rest/v1/member_links?student_id=eq" },
      {
        body: { error: { message: "raw stripe card setup failure" } },
        match: "api.stripe.com/v1/subscriptions",
        status: 402,
      },
    ]);

    const res = await invoke({
      body: { offer_price_id: offerPriceId, student_id: studentId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "Payment setup failed. Please try again." });
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
    { body: { id: userId, app_metadata: { role: "parent" } }, match: "/auth/v1/user" },
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

function stripeSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    customer: customerId,
    id: subscriptionId,
    latest_invoice: {
      confirmation_secret: {
        client_secret: "cs_parent_secret",
      },
    },
    metadata: { offer_price_id: offerPriceId },
    status: "incomplete",
    ...overrides,
  };
}

async function invoke(req: {
  body?: unknown;
  headers?: Record<string, string>;
  method: string;
  query?: Record<string, string>;
}): Promise<MockResponse> {
  const res = mockResponse();
  await handler(
    {
      body: req.body,
      headers: req.headers ?? {},
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
