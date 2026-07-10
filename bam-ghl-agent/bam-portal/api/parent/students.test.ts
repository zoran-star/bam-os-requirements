import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./students.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

type MockResponse = ParentApiResponse & {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
};

const profile = {
  created_at: "2026-07-02T12:00:00.000Z",
  email: "parent@example.test",
  first_name: "Parent",
  id: "10000000-0000-4000-8000-000000000001",
  last_name: "Tester",
  phone: null,
  profile_type: "PARENT",
  supabase_user_id: "user-1",
  updated_at: "2026-07-02T12:00:00.000Z",
};

const existingStudent = {
  created_at: "2026-07-02T12:00:00.000Z",
  date_of_birth: "2014-03-10",
  first_name: "Alex",
  id: "20000000-0000-4000-8000-000000000001",
  last_name: "Rivera",
  notes: null,
  parent_id: profile.id,
  updated_at: "2026-07-02T12:00:00.000Z",
};

const profileMembership = {
  academy_id: "30000000-0000-4000-8000-000000000001",
  customer_id: profile.id,
  ghl_contact_id: "ghl-parent",
  id: "40000000-0000-4000-8000-000000000001",
  joined_at: "2026-07-02T12:00:00.000Z",
  plan_id: null,
  status: "ACTIVE",
  stripe_customer_id: null,
  student_id: null,
};

describe("POST /api/parent/students", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    vi.restoreAllMocks();
  });

  it("returns an existing matching student instead of creating a duplicate", async () => {
    const fetchMock = mockSupabaseFetch([
      { body: { id: "user-1", app_metadata: { role: "parent" } }, match: "/auth/v1/user" },
      { body: [profile], match: "/rest/v1/customer_profiles" },
      { body: [existingStudent], match: "/rest/v1/students?parent_id" },
      { body: [profileMembership], match: "/rest/v1/academy_memberships?customer_id" },
      { body: [], match: "/rest/v1/academy_memberships?student_id" },
    ]);

    const res = await invoke({
      body: {
        date_of_birth: "2014-03-10",
        first_name: " Alex ",
        last_name: "Rivera",
      },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(existingStudent);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("select="))).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("creates a student through the service-role REST API", async () => {
    const fetchMock = mockSupabaseFetch([
      { body: { id: "user-1", app_metadata: { role: "parent" } }, match: "/auth/v1/user" },
      { body: [profile], match: "/rest/v1/customer_profiles" },
      { body: [], match: "/rest/v1/students?parent_id" },
      { body: [profileMembership], match: "/rest/v1/academy_memberships?customer_id" },
      { body: [], match: "/rest/v1/students?id=eq" },
      { body: [existingStudent], match: "/rest/v1/students?select=" },
    ]);

    const res = await invoke({
      body: {
        date_of_birth: "2014-03-10",
        first_name: "Alex",
        last_name: "Rivera",
      },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(existingStudent);

    const insertCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(insertCall).toBeTruthy();
    expect(insertCall?.[1]?.headers).toMatchObject({
      Authorization: "Bearer service-role",
      Prefer: "return=representation",
      apikey: "service-role",
    });
    expect(JSON.parse(String(insertCall?.[1]?.body))).toMatchObject({
      date_of_birth: "2014-03-10",
      first_name: "Alex",
      last_name: "Rivera",
      notes: null,
      parent_id: profile.id,
    });
  });

  it("requires an academy attachment before creating a child", async () => {
    const fetchMock = mockSupabaseFetch([
      { body: { id: "user-1", app_metadata: { role: "parent" } }, match: "/auth/v1/user" },
      { body: [profile], match: "/rest/v1/customer_profiles" },
      { body: [], match: "/rest/v1/students?parent_id" },
      { body: [], match: "/rest/v1/academy_memberships?customer_id" },
    ]);

    const res = await invoke({
      body: {
        date_of_birth: "2014-03-10",
        first_name: "Alex",
        last_name: "Rivera",
      },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Academy invite required before adding a child." });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});

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
