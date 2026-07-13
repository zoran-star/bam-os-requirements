import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResponse = {
  body: unknown;
  statusCode: number;
  json(body: unknown): MockResponse;
  status(code: number): MockResponse;
};

const member = {
  archetype: null,
  athlete_name: "Jamie Parent",
  client_id: "90000000-0000-4000-8000-000000000201",
  id: "90000000-0000-4000-8000-000000000601",
  parent_name: "Alex Parent",
  stripe_customer_id: "cus_parent",
  stripe_subscription_id: "sub_parent",
};

const context = {
  staff: { name: "Alex Parent" },
  user: { id: "90000000-0000-4000-8000-000000000001" },
};

const operationId = "90000000-0000-4000-8000-000000000501";

describe("actionCancel parent-app behavior", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.STRIPE_CONNECT_SECRET_KEY = "sk_test_fake";
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("schedules cancellation at period end with a stable Stripe idempotency key", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ init, url });

      if (url.includes("api.stripe.com")) {
        return jsonResponse({
          cancel_at_period_end: true,
          id: "sub_parent",
          status: "active",
        });
      }
      return new Response(null, { status: 204 });
    });

    const { actionCancel } = await import("../members.js");
    const res = mockResponse();
    await actionCancel(res, member, "acct_parent", context, {
      immediate: false,
      operation_id: operationId,
      source: "parent_app",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, member: { status: "cancelling" } });

    const stripeRequest = requests.find((request) => request.url.includes("api.stripe.com"));
    expect(stripeRequest?.init?.method).toBe("POST");
    expect(stripeRequest?.init?.body).toBe("cancel_at_period_end=true");
    expect(new Headers(stripeRequest?.init?.headers).get("Idempotency-Key")).toBe(
      `cancel-period-end-${member.id}-${operationId}`,
    );

    const memberPatch = requests.find(
      (request) => request.url.includes("/rest/v1/members?id=eq.") && request.init?.method === "PATCH",
    );
    expect(memberPatch).toBeDefined();
    expect(JSON.parse(String(memberPatch?.init?.body))).toMatchObject({ status: "cancelling" });
  });

  it("does not remove access when Stripe says a parent-app subscription is unmanageable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { error: { message: "This subscription was not created by your application" } },
        400,
      ),
    );

    const { actionCancel } = await import("../members.js");
    const res = mockResponse();
    await actionCancel(res, member, "acct_parent", context, {
      immediate: false,
      operation_id: operationId,
      source: "parent_app",
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: "This membership cannot be cancelled in the app. Please contact your academy.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function mockResponse(): MockResponse {
  const res: MockResponse = {
    body: undefined,
    statusCode: 200,
    json(body) {
      res.body = body;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
}
