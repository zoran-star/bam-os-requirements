import { beforeEach, describe, expect, it, vi } from "vitest";

import { actionCancel, actionChange, actionPause, actionUnpause } from "../members.js";
import handler from "./member-management.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

vi.mock("../members.js", () => ({
  actionCancel: vi.fn(async (res: ParentApiResponse, _member, _account, _context, body) =>
    res.status(200).json({ ok: true, received: body }),
  ),
  actionChange: vi.fn(async (res: ParentApiResponse, _member, _account, _context, body) =>
    res.status(200).json({ ok: true, received: body }),
  ),
  actionPause: vi.fn(async (res: ParentApiResponse, _member, _account, _context, body) =>
    res.status(200).json({ ok: true, received: body }),
  ),
  actionUnpause: vi.fn(async (res: ParentApiResponse, _member, _account, _context, body) =>
    res.status(200).json({ ok: true, received: body }),
  ),
}));

type MockResponse = ParentApiResponse & {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
};

const userId = "90000000-0000-4000-8000-000000000001";
const profileId = "90000000-0000-4000-8000-000000000101";
const tenantId = "90000000-0000-4000-8000-000000000201";
const studentId = "90000000-0000-4000-8000-000000000301";
const otherStudentId = "90000000-0000-4000-8000-000000000302";
const offerPriceId = "90000000-0000-4000-8000-000000000401";
const operationId = "90000000-0000-4000-8000-000000000501";
const memberId = "90000000-0000-4000-8000-000000000601";

const profile = {
  created_at: "2026-07-03T12:00:00.000Z",
  email: "parent@example.test",
  first_name: "Alex",
  id: profileId,
  last_name: "Parent",
  phone: null,
  profile_type: "PARENT",
  supabase_user_id: userId,
  updated_at: "2026-07-03T12:00:00.000Z",
};

const student = {
  created_at: "2026-07-03T12:00:00.000Z",
  date_of_birth: "2014-03-10",
  first_name: "Jamie",
  id: studentId,
  last_name: "Parent",
  notes: null,
  parent_id: profileId,
  updated_at: "2026-07-03T12:00:00.000Z",
};

const studentMembership = {
  academy_id: tenantId,
  customer_id: null,
  ghl_contact_id: null,
  id: "90000000-0000-4000-8000-000000000701",
  joined_at: "2026-07-03T12:00:00.000Z",
  plan_id: null,
  status: "ACTIVE",
  stripe_customer_id: "cus_parent",
  student_id: studentId,
};

const member = {
  athlete_name: "Jamie Parent",
  client_id: tenantId,
  id: memberId,
  parent_name: "Alex Parent",
  pause_scheduled_for: null,
  plan: "Steady",
  status: "live",
  stripe_customer_id: "cus_parent",
  stripe_price_id: "price_steady",
  stripe_subscription_id: "sub_parent",
};

const client = {
  business_name: "BAM GTA",
  id: tenantId,
  stripe_connect_account_id: "acct_parent",
  stripe_connect_status: "connected",
};

describe("/api/parent/member-management", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.ONBOARDING_STRIPE_SECRET_KEY = "sk_live_fake";
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns the current plan, pause, and server-calculated actions", async () => {
    mockFetch([
      ...parentContextResponses(),
      { body: [{ member_id: memberId }], match: "/rest/v1/member_links" },
      { body: [member], match: "/rest/v1/members" },
      { body: [client], match: "/rest/v1/clients" },
      {
        body: [{
          activated_at: null,
          completed_at: null,
          id: "pause-1",
          pause_end: "2026-08-14",
          pause_start: "2026-08-01",
        }],
        match: "/rest/v1/cancellations",
      },
      { body: [{ id: offerPriceId }], match: "/rest/v1/offer_prices?tenant_id" },
    ]);

    const res = await invoke({ method: "GET", query: { student_id: studentId } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      academy_name: "BAM GTA",
      current_offer_price_id: offerPriceId,
      member_status: "live",
      pause: { end_date: "2026-08-14", start_date: "2026-08-01", status: "SCHEDULED" },
      actions: { can_cancel: true, can_change_plan: true, can_pause: true, can_resume: true },
    });
  });

  it("rejects a student that does not belong to the parent before member lookup", async () => {
    const fetchMock = mockFetch(parentContextResponses());

    const res = await invoke({ method: "GET", query: { student_id: otherStudentId } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Student not found." });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("member_links"))).toBe(false);
  });

  it("changes to an owned academy's routable offer price and strips staff-only fields", async () => {
    mockFetch([
      ...resolvedMemberResponses(),
      {
        body: [{
          id: offerPriceId,
          is_active: true,
          is_routable: true,
          source_pricing_catalog_id: "catalog-1",
          stripe_price_id: "price_elevate",
          tenant_id: tenantId,
        }],
        match: "/rest/v1/offer_prices?id=eq",
      },
    ]);

    const res = await invoke({
      body: {
        coupon_code: "FREE",
        next_payment_date: "2030-01-01",
        offer_price_id: offerPriceId,
        operation_id: operationId,
        prorate: true,
        student_id: studentId,
      },
      method: "POST",
      query: { action: "change-plan" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(actionChange).toHaveBeenCalledOnce();
    expect(vi.mocked(actionChange).mock.calls[0]?.[4]).toEqual({
      catalog_price_id: "price_elevate",
      new_price_id: "price_elevate",
      operation_id: operationId,
      source: "parent_app",
      stripe_target_price_id: "price_elevate",
    });
  });

  it("always schedules parent cancellation for period end and strips staff-only fields", async () => {
    mockFetch(resolvedMemberResponses());

    const res = await invoke({
      body: {
        immediate: true,
        member_id: memberId,
        operation_id: operationId,
        reason: "Moving away",
        student_id: studentId,
      },
      method: "POST",
      query: { action: "cancel" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(actionCancel).toHaveBeenCalledOnce();
    expect(vi.mocked(actionCancel).mock.calls[0]?.[4]).toEqual({
      immediate: false,
      operation_id: operationId,
      reason: "Moving away",
      source: "parent_app",
    });
  });

  it("treats a repeated cancellation of an already-cancelling membership as successful", async () => {
    mockFetch(resolvedMemberResponses({ status: "cancelling" }));

    const res = await invoke({
      body: { operation_id: operationId, student_id: studentId },
      method: "POST",
      query: { action: "cancel" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(actionCancel).not.toHaveBeenCalled();
  });

  it("passes only parent-safe pause fields to the shared pause action", async () => {
    mockFetch(resolvedMemberResponses());

    const res = await invoke({
      body: {
        end_date: "2026-08-14",
        next_payment_date: "2030-01-01",
        operation_id: operationId,
        reason: "Summer travel",
        start_date: "2026-08-01",
        student_id: studentId,
      },
      method: "POST",
      query: { action: "pause" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(vi.mocked(actionPause).mock.calls[0]?.[4]).toEqual({
      end_date: "2026-08-14",
      operation_id: operationId,
      reason: "Summer travel",
      source: "parent_app",
      start_date: "2026-08-01",
    });
  });

  it("rejects a plan from another academy before calling the shared change action", async () => {
    mockFetch([
      ...resolvedMemberResponses(),
      {
        body: [{
          id: offerPriceId,
          is_active: true,
          is_routable: true,
          stripe_price_id: "price_other_academy",
          tenant_id: otherStudentId,
        }],
        match: "/rest/v1/offer_prices?id=eq",
      },
    ]);

    const res = await invoke({
      body: {
        offer_price_id: offerPriceId,
        operation_id: operationId,
        student_id: studentId,
      },
      method: "POST",
      query: { action: "change-plan" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "That plan is not available." });
    expect(actionChange).not.toHaveBeenCalled();
  });

  it("passes only parent-safe fields when resuming an open pause", async () => {
    mockFetch([
      ...resolvedMemberResponses(),
      {
        body: [{
          activated_at: "2026-07-20T00:00:00.000Z",
          completed_at: null,
          id: "pause-1",
          pause_end: "2026-08-14",
          pause_start: "2026-07-20",
        }],
        match: "/rest/v1/cancellations",
      },
    ]);

    const res = await invoke({
      body: {
        new_until: "2030-01-01",
        operation_id: operationId,
        student_id: studentId,
      },
      method: "POST",
      query: { action: "resume" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(vi.mocked(actionUnpause).mock.calls[0]?.[4]).toEqual({
      operation_id: operationId,
      source: "parent_app",
    });
  });

  it("does not resume when there is no open pause", async () => {
    mockFetch([
      ...resolvedMemberResponses(),
      { body: [], match: "/rest/v1/cancellations" },
    ]);

    const res = await invoke({
      body: { operation_id: operationId, student_id: studentId },
      method: "POST",
      query: { action: "resume" },
    });

    expect(res.statusCode).toBe(409);
    expect(actionUnpause).not.toHaveBeenCalled();
  });
});

function parentContextResponses() {
  return [
    { body: { id: userId, app_metadata: { role: "parent" } }, match: "/auth/v1/user" },
    { body: [profile], match: "/rest/v1/customer_profiles" },
    { body: [student], match: "/rest/v1/students?parent_id" },
    { body: [], match: "/rest/v1/academy_memberships?customer_id" },
    { body: [studentMembership], match: "/rest/v1/academy_memberships?student_id" },
  ];
}

function resolvedMemberResponses(memberOverrides: Partial<typeof member> = {}) {
  return [
    ...parentContextResponses(),
    { body: [{ member_id: memberId }], match: "/rest/v1/member_links" },
    { body: [{ ...member, ...memberOverrides }], match: "/rest/v1/members" },
    { body: [client], match: "/rest/v1/clients" },
  ];
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

function mockFetch(responses: Array<{ body: unknown; match: string; status?: number }>) {
  const queue = [...responses];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    if (!url.includes(next.match)) {
      throw new Error(`Expected fetch URL to include ${next.match}, received ${url}`);
    }
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
}
