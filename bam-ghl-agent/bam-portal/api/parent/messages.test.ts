import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./messages.js";
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
const threadId = "90000000-0000-4000-8000-000000000301";
const messageId = "90000000-0000-4000-8000-000000000401";

const profile = {
  created_at: "2026-07-03T12:00:00.000Z",
  email: "parent@example.test",
  first_name: "Parent",
  id: profileId,
  last_name: "Tester",
  phone: null,
  profile_type: "PARENT",
  supabase_user_id: userId,
  updated_at: "2026-07-03T12:00:00.000Z",
};

const membership = {
  academy_id: tenantId,
  customer_id: profileId,
  ghl_contact_id: null,
  id: "90000000-0000-4000-8000-000000000501",
  joined_at: "2026-07-03T12:00:00.000Z",
  plan_id: null,
  status: "ACTIVE",
  stripe_customer_id: null,
  student_id: null,
};

const otherMembership = {
  ...membership,
  academy_id: otherTenantId,
  id: "90000000-0000-4000-8000-000000000502",
};

const thread = {
  created_at: "2026-07-03T12:00:00.000Z",
  customer_profile_id: profileId,
  id: threadId,
  kind: "GENERAL",
  last_message_at: "2026-07-03T12:01:00.000Z",
  last_message_author_type: "PARENT",
  last_message_preview: "Hello academy",
  status: "OPEN",
  subject_student_id: null,
  tenant_id: tenantId,
  updated_at: "2026-07-03T12:01:00.000Z",
};

const message = {
  author_auth_user_id: userId,
  author_customer_profile_id: profileId,
  author_display_name: "Parent Tester",
  author_type: "PARENT",
  body: "Hello academy",
  client_message_id: "client-message-1",
  created_at: "2026-07-03T12:01:00.000Z",
  deleted_at: null,
  edited_at: null,
  id: messageId,
  message_type: "TEXT",
  metadata: {},
  tenant_id: tenantId,
  thread_id: threadId,
  updated_at: "2026-07-03T12:01:00.000Z",
};

describe("api/parent/messages", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    vi.restoreAllMocks();
  });

  it("GET returns the zero state without creating a thread", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [], match: "/rest/v1/customer_message_threads?tenant_id=eq" },
    ]);

    const res = await invoke({
      headers: { authorization: "Bearer parent-token" },
      method: "GET",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      thread: null,
      messages: [],
      page: { next_before: null },
      unread_count: 0,
    });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("returns TENANT_REQUIRED for a multi-academy parent without tenant_id", async () => {
    mockSupabaseFetch(parentContextResponses([membership, otherMembership]));

    const res = await invoke({
      headers: { authorization: "Bearer parent-token" },
      method: "GET",
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      error: "Multiple academies on this account. Pass tenant_id.",
      code: "TENANT_REQUIRED",
    });
  });

  it("POST sends through the RPC as a parent author", async () => {
    const fetchMock = mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [], match: "/rest/v1/customer_thread_messages?author_customer_profile_id=eq" },
      { body: [{ message, thread }], match: "/rest/v1/rpc/customer_send_thread_message" },
    ]);

    const res = await invoke({
      body: {
        body: "  Hello academy  ",
        client_message_id: "client-message-1",
      },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      thread: {
        id: threadId,
        tenant_id: tenantId,
        unread_count: 0,
      },
      message: {
        id: messageId,
        author_type: "PARENT",
        body: "Hello academy",
      },
    });

    const rpcCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/rpc/customer_send_thread_message"),
    );
    expect(rpcCall).toBeTruthy();
    expect(JSON.parse(String(rpcCall?.[1]?.body))).toMatchObject({
      p_author_auth_user_id: userId,
      p_author_display_name: "Parent Tester",
      p_author_type: "PARENT",
      p_body: "Hello academy",
      p_client_message_id: "client-message-1",
      p_customer_profile_id: profileId,
      p_tenant_id: tenantId,
      p_thread_id: null,
    });
  });

  it.each([
    ["empty body", { body: "   ", client_message_id: "client-message-1" }],
    ["overlong body", { body: "x".repeat(4_001), client_message_id: "client-message-1" }],
    ["missing client_message_id", { body: "Hello academy" }],
  ])("POST rejects %s", async (_name, requestBody) => {
    const fetchMock = mockSupabaseFetch(parentContextResponses());

    const res = await invoke({
      body: requestBody,
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(422);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/rpc/"))).toBe(false);
  });

  it("POST throttles parents with too many recent sends", async () => {
    mockSupabaseFetch([
      ...parentContextResponses(),
      {
        body: Array.from({ length: 15 }, (_, index) => ({ id: `message-${index}` })),
        match: "/rest/v1/customer_thread_messages?author_customer_profile_id=eq",
      },
    ]);

    const res = await invoke({
      body: {
        body: "Hello academy",
        client_message_id: "client-message-1",
      },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      error: "You are sending messages too quickly. Please wait a moment.",
    });
  });

  it("read action returns 404 for a thread not owned by the parent", async () => {
    mockSupabaseFetch([
      ...parentContextResponses(),
      { body: [], match: "/rest/v1/customer_message_threads?id=eq" },
    ]);

    const res = await invoke({
      body: { thread_id: threadId },
      headers: { authorization: "Bearer parent-token" },
      method: "POST",
      query: { action: "read" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Thread not found." });
  });
});

function parentContextResponses(memberships: unknown[] = [membership]) {
  return [
    { body: { id: userId, app_metadata: { role: "parent" } }, match: "/auth/v1/user" },
    { body: [profile], match: "/rest/v1/customer_profiles" },
    { body: [], match: "/rest/v1/students?parent_id" },
    { body: memberships, match: "/rest/v1/academy_memberships?customer_id" },
  ];
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
