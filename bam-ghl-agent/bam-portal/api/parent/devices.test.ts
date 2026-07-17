import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./devices.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

const userId = "93000000-0000-4000-8000-000000000001";
const profileId = "93000000-0000-4000-8000-000000000002";
const deviceId = "93000000-0000-4000-8000-000000000003";
const installationId = "93000000-0000-4000-8000-000000000004";
const projectId = "bbe28217-e5b3-4f84-8125-0743252c86d4";
const token = "ExponentPushToken[parent-device]";

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

describe("api/parent/devices", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    vi.restoreAllMocks();
  });

  it("registers an authenticated parent Expo token and retires an older installation token", async () => {
    const fetchMock = mockFetch([
      { body: { app_metadata: { role: "parent" }, id: userId }, match: "/auth/v1/user" },
      { body: [profile], match: "/customer_profiles?supabase_user_id=eq" },
      { body: null, match: "/device_tokens?auth_user_id=eq" },
      {
        body: [
          {
            app_environment: "development",
            id: deviceId,
            installation_id: installationId,
            last_seen_at: "2026-07-14T04:01:00.000Z",
            platform: "ios",
            project_id: projectId,
            token,
          },
        ],
        match: "/device_tokens?on_conflict=token",
      },
    ]);

    const res = await invoke({
      body: {
        app_environment: "development",
        installation_id: installationId,
        platform: "ios",
        project_id: projectId,
        token,
      },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    const disableCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/device_tokens?auth_user_id=eq"),
    );
    expect(String(disableCall?.[0])).toContain("app_scope=eq.PARENT");
    expect(String(disableCall?.[0])).toContain(`installation_id=eq.${installationId}`);
    const upsertCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/device_tokens?on_conflict=token"),
    );
    expect(JSON.parse(String(upsertCall?.[1]?.body))).toMatchObject({
      app_scope: "PARENT",
      auth_user_id: userId,
      installation_id: installationId,
      token_provider: "EXPO",
    });
  });

  it("rejects non-Expo tokens before writing a device", async () => {
    const fetchMock = mockFetch([
      { body: { app_metadata: { role: "parent" }, id: userId }, match: "/auth/v1/user" },
      { body: [profile], match: "/customer_profiles?supabase_user_id=eq" },
    ]);

    const res = await invoke({
      body: {
        app_environment: "development",
        installation_id: installationId,
        platform: "ios",
        project_id: projectId,
        token: "not-an-expo-token",
      },
      method: "POST",
    });

    expect(res.statusCode).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
