import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./parent-message-threads.js";
import type { ParentApiRequest, ParentApiResponse } from "../parent/_types.js";

type MockResponse = ParentApiResponse & {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
};

const userId = "91000000-0000-4000-8000-000000000001";
const tenantId = "91000000-0000-4000-8000-000000000101";
const attackerTenantId = "91000000-0000-4000-8000-000000000102";
const clientUserId = "91000000-0000-4000-8000-000000000201";
const threadId = "91000000-0000-4000-8000-000000000301";
const profileId = "91000000-0000-4000-8000-000000000401";
const assignedUserId = "91000000-0000-4000-8000-000000000501";
const messageId = "91000000-0000-4000-8000-000000000601";

const clientUser = {
  client_id: tenantId,
  email: "academy@example.test",
  id: clientUserId,
  name: "Academy Owner",
  status: "active",
  user_id: userId,
};

const thread = {
  assigned_auth_user_id: null,
  closed_at: null,
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

const staffMessage = {
  author_auth_user_id: userId,
  author_customer_profile_id: null,
  author_display_name: "Academy Owner",
  author_type: "STAFF",
  body: "Thanks for reaching out",
  client_message_id: "staff-message-1",
  created_at: "2026-07-03T12:02:00.000Z",
  deleted_at: null,
  edited_at: null,
  id: messageId,
  message_type: "TEXT",
  tenant_id: tenantId,
  thread_id: threadId,
  updated_at: "2026-07-03T12:02:00.000Z",
};

describe("api/client/parent-message-threads", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    vi.restoreAllMocks();
  });

  it("returns 403 when the caller has no client_users row", async () => {
    mockSupabaseFetch([
      { body: { id: userId }, match: "/auth/v1/user" },
      { body: [], match: "/rest/v1/client_users?user_id=eq" },
    ]);

    const res = await invoke({
      headers: { authorization: "Bearer academy-token" },
      method: "GET",
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Not authorized for the client portal." });
  });

  it("requires client_id when the caller has multiple active academy memberships", async () => {
    mockSupabaseFetch([
      { body: { id: userId }, match: "/auth/v1/user" },
      {
        body: [
          clientUser,
          { ...clientUser, client_id: attackerTenantId, id: "91000000-0000-4000-8000-000000000202" },
        ],
        match: "/rest/v1/client_users?user_id=eq",
      },
    ]);

    const res = await invoke({
      headers: { authorization: "Bearer academy-token" },
      method: "GET",
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({ error: "Client is required for multi-academy accounts." });
  });

  it("verifies the requested active client_id before listing threads", async () => {
    const fetchMock = mockSupabaseFetch([
      ...clientContextResponses(),
      { body: [], match: "/rest/v1/customer_message_threads?tenant_id=eq" },
    ]);

    const res = await invoke({
      headers: { authorization: "Bearer academy-token" },
      method: "GET",
      query: { client_id: tenantId },
    });

    expect(res.statusCode).toBe(200);
    const clientUserCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/client_users"),
    );
    expect(String(clientUserCall?.[0])).toContain(`client_id=eq.${tenantId}`);
    expect(String(clientUserCall?.[0])).toContain("status=eq.active");
  });

  it("rejects a requested client_id without an active membership", async () => {
    mockSupabaseFetch([
      { body: { id: userId }, match: "/auth/v1/user" },
      { body: [], match: "/rest/v1/client_users?user_id=eq" },
    ]);

    const res = await invoke({
      headers: { authorization: "Bearer academy-token" },
      method: "GET",
      query: { client_id: attackerTenantId },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Not authorized for this client." });
  });

  it("lists threads scoped to the caller client_id and ignores query tenant_id", async () => {
    const fetchMock = mockSupabaseFetch([
      ...clientContextResponses(),
      { body: [], match: "/rest/v1/customer_message_threads?tenant_id=eq" },
    ]);

    const res = await invoke({
      headers: { authorization: "Bearer academy-token" },
      method: "GET",
      query: { tenant_id: attackerTenantId },
    });

    expect(res.statusCode).toBe(200);
    const listCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/customer_message_threads"),
    );
    expect(String(listCall?.[0])).toContain(`tenant_id=eq.${tenantId}`);
    expect(String(listCall?.[0])).not.toContain(attackerTenantId);
  });

  it("adds status and last-message-author filters for needs_reply", async () => {
    const fetchMock = mockSupabaseFetch([
      ...clientContextResponses(),
      { body: [], match: "/rest/v1/customer_message_threads?tenant_id=eq" },
    ]);

    const res = await invoke({
      headers: { authorization: "Bearer academy-token" },
      method: "GET",
      query: { needs_reply: "true" },
    });

    expect(res.statusCode).toBe(200);
    const listUrl = String(
      fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/rest/v1/customer_message_threads"),
      )?.[0],
    );
    expect(listUrl).toContain("status=eq.OPEN");
    expect(listUrl).toContain("last_message_author_type=eq.PARENT");
  });

  it("staff send calls the RPC as STAFF with the caller display name", async () => {
    const fetchMock = mockSupabaseFetch([
      ...clientContextResponses(),
      { body: [thread], match: "/rest/v1/customer_message_threads?id=eq" },
      { body: [{ message: staffMessage, thread }], match: "/rest/v1/rpc/customer_send_thread_message" },
    ]);

    const res = await invoke({
      body: {
        body: "  Thanks for reaching out  ",
        client_message_id: "staff-message-1",
      },
      headers: { authorization: "Bearer academy-token" },
      method: "POST",
      query: { action: "messages", thread_id: threadId },
    });

    expect(res.statusCode).toBe(200);
    const rpcCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/rpc/customer_send_thread_message"),
    );
    expect(JSON.parse(String(rpcCall?.[1]?.body))).toMatchObject({
      p_author_auth_user_id: userId,
      p_author_display_name: "Academy Owner",
      p_author_type: "STAFF",
      p_body: "Thanks for reaching out",
      p_client_message_id: "staff-message-1",
      p_customer_profile_id: null,
      p_tenant_id: tenantId,
      p_thread_id: threadId,
    });
  });

  it("PATCH close sets closed_at and status", async () => {
    const closedThread = {
      ...thread,
      closed_at: "2026-07-03T12:03:00.000Z",
      status: "CLOSED",
    };
    const fetchMock = mockSupabaseFetch([
      ...clientContextResponses(),
      { body: [closedThread], match: "/rest/v1/customer_message_threads?id=eq" },
    ]);

    const res = await invoke({
      body: { status: "CLOSED" },
      headers: { authorization: "Bearer academy-token" },
      method: "PATCH",
      query: { thread_id: threadId },
    });

    expect(res.statusCode).toBe(200);
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    const patchBody = JSON.parse(String(patchCall?.[1]?.body));
    expect(patchBody.status).toBe("CLOSED");
    expect(typeof patchBody.closed_at).toBe("string");
  });

  it("PATCH assign passes assigned_auth_user_id", async () => {
    const assignedThread = {
      ...thread,
      assigned_auth_user_id: assignedUserId,
    };
    const fetchMock = mockSupabaseFetch([
      ...clientContextResponses(),
      { body: [assignedThread], match: "/rest/v1/customer_message_threads?id=eq" },
    ]);

    const res = await invoke({
      body: { assigned_auth_user_id: assignedUserId },
      headers: { authorization: "Bearer academy-token" },
      method: "PATCH",
      query: { thread_id: threadId },
    });

    expect(res.statusCode).toBe(200);
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      assigned_auth_user_id: assignedUserId,
    });
  });
});

function clientContextResponses() {
  return [
    { body: { id: userId }, match: "/auth/v1/user" },
    { body: [clientUser], match: "/rest/v1/client_users?user_id=eq" },
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
