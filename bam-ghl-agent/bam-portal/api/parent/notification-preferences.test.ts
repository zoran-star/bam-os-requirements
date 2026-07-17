import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./notification-preferences.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

const userId = "94000000-0000-4000-8000-000000000001";
const profileId = "94000000-0000-4000-8000-000000000002";
const profile = {
  created_at: "2026-07-14T04:00:00.000Z",
  email: "parent@example.test",
  first_name: "Parent",
  id: profileId,
  last_name: "Tester",
  phone: null,
  profile_type: "PARENT",
  supabase_user_id: userId,
  updated_at: "2026-07-14T04:00:00.000Z",
};

describe("api/parent/notification-preferences", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    vi.restoreAllMocks();
  });

  it("defaults transactional push on and SMS off without inserting rows", async () => {
    mockFetch([
      { body: { app_metadata: { role: "parent" }, id: userId }, match: "/auth/v1/user" },
      { body: [profile], match: "/customer_profiles?supabase_user_id=eq" },
      { body: [], match: "/parent_notification_preferences?customer_profile_id=eq" },
    ]);

    const res = await invoke({ method: "GET" });
    expect(res.statusCode).toBe(200);
    const preferences = (res.body as { preferences: Array<{ channel: string; enabled: boolean }> })
      .preferences;
    expect(preferences).toHaveLength(10);
    expect(preferences.filter((item) => item.channel === "PUSH").every((item) => item.enabled)).toBe(true);
    expect(preferences.filter((item) => item.channel === "SMS").some((item) => item.enabled)).toBe(false);
  });

  it("writes all category push preferences for the global toggle", async () => {
    const fetchMock = mockFetch([
      { body: { app_metadata: { role: "parent" }, id: userId }, match: "/auth/v1/user" },
      { body: [profile], match: "/customer_profiles?supabase_user_id=eq" },
      { body: null, match: "/parent_notification_preferences?on_conflict=" },
      { body: [], match: "/parent_notification_preferences?customer_profile_id=eq" },
    ]);

    const res = await invoke({
      body: { category: "ALL", channel: "PUSH", enabled: false },
      method: "PATCH",
    });

    expect(res.statusCode).toBe(200);
    const upsertCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/parent_notification_preferences?on_conflict="),
    );
    const rows = JSON.parse(String(upsertCall?.[1]?.body)) as unknown[];
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "MESSAGES", channel: "PUSH", enabled: false }),
        expect.objectContaining({ category: "BILLING", channel: "PUSH", enabled: false }),
      ]),
    );
  });
});

async function invoke(input: { body?: unknown; method: string }): Promise<MockResponse> {
  const res = mockResponse();
  await handler(
    {
      body: input.body,
      headers: { authorization: "Bearer parent-token" },
      method: input.method,
      query: {},
    } satisfies ParentApiRequest,
    res,
  );
  return res;
}

type MockResponse = ParentApiResponse & { body: unknown; statusCode: number };

function mockResponse(): MockResponse {
  const res = {
    body: undefined as unknown,
    statusCode: 200,
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader() {
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
}

function mockFetch(responses: Array<{ body: unknown; match: string }>) {
  const queue = [...responses];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    if (!url.includes(next.match)) {
      throw new Error(`Expected fetch URL to include ${next.match}, received ${url}`);
    }
    return new Response(next.body === null ? "" : JSON.stringify(next.body), { status: 200 });
  });
}
