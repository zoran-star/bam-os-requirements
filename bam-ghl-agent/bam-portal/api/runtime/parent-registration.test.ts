import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import parentInvitesHandler from "../client/parent-invites.js";
import profileHandler from "../parent/profile.js";
import registerHandler from "../parent/register.js";
import slotsHandler from "../parent/schedule/slots.js";
import studentsHandler from "../parent/students.js";
import type { ParentApiRequest, ParentApiResponse } from "../parent/_types.js";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const runtimeTestSupabaseUrl = process.env.RUNTIME_TEST_SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const runtimeTestServiceRoleKey = process.env.RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY;
const runtimeTestAnonKey = process.env.RUNTIME_TEST_SUPABASE_ANON_KEY;

if (!runtimeTestServiceRoleKey || !runtimeTestAnonKey) {
  throw new Error("Runtime Supabase keys are required. Run npm run test:runtime.");
}

const LOCAL_PASSWORD = "local-password";
const TENANT_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";
const TAYLOR_USER_ID = "f7a7d6e5-7c6d-4dd1-95c2-1c7f5d72e9a4";
const TAYLOR_PROFILE_ID = "7c269b89-17df-4f7d-9258-c2d442f1b6df";
const TAYLOR_EMAIL = "parent.taylor.morgan@example.test";
const NEW_USER_ID = "a8100000-0000-4000-8000-000000000001";
const NEW_EMAIL = "parent.new.invited@example.test";
const CONTACT_ID = "a8200000-0000-4000-8000-000000000001";
const OPPORTUNITY_ID = "a8300000-0000-4000-8000-000000000001";
const ACADEMY_EMAIL = "academy.owner@example.test";

type MockResponse = ParentApiResponse & {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
};

const serviceSupabase = createClient(runtimeTestSupabaseUrl, runtimeTestServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonSupabase = createClient(runtimeTestSupabaseUrl, runtimeTestAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("parent registration runtime flow", () => {
  beforeEach(async () => {
    assertLocalSupabase();
    process.env.VITE_SUPABASE_URL = runtimeTestSupabaseUrl;
    process.env.SUPABASE_URL = runtimeTestSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = runtimeTestServiceRoleKey;
    process.env.SUPABASE_SERVICE_KEY = runtimeTestServiceRoleKey;
    process.env.PARENT_INVITE_SIGNING_SECRET = "local-parent-invite-runtime-secret";
    await resetRegistrationFixtures();
  });

  it("claims the preloaded parent and returns existing child and academy data", async () => {
    const token = await signIn(TAYLOR_EMAIL);

    const response = await invoke(profileHandler, { method: "GET", token });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      id: TAYLOR_PROFILE_ID,
      supabase_user_id: TAYLOR_USER_ID,
      students: [{ first_name: "Avery" }],
      memberships: [{ academy_id: TENANT_ID }],
    });
    const { data: authUser } = await serviceSupabase.auth.admin.getUserById(TAYLOR_USER_ID);
    expect(authUser.user?.app_metadata.role).toBe("parent");
  });

  it("issues an academy invite and idempotently creates and links a new parent", async () => {
    const academyToken = await signIn(ACADEMY_EMAIL);
    const inviteResponse = await invoke(parentInvitesHandler, {
      body: {
        client_id: TENANT_ID,
        contact_id: CONTACT_ID,
        opportunity_id: OPPORTUNITY_ID,
      },
      method: "POST",
      token: academyToken,
    });
    expect(inviteResponse.statusCode).toBe(201);
    const inviteToken = (inviteResponse.body as { token: string }).token;

    const parentToken = await signIn(NEW_EMAIL);
    const body = {
      first_name: "Jordan",
      last_name: "Lee",
      email: NEW_EMAIL,
      invite_token: inviteToken,
    };
    const created = await invoke(registerHandler, { body, method: "POST", token: parentToken });
    const replay = await invoke(registerHandler, { body, method: "POST", token: parentToken });

    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(created.body).toMatchObject({
      registration: { academy_attached: true, profile_created: true },
    });
    expect((replay.body as { id: string }).id).toBe((created.body as { id: string }).id);

    const profileId = (created.body as { id: string }).id;
    const { data: profiles } = await serviceSupabase
      .from("customer_profiles")
      .select("id,supabase_user_id")
      .eq("email", NEW_EMAIL);
    const { data: memberships } = await serviceSupabase
      .from("academy_memberships")
      .select("academy_id,customer_id,status,ghl_contact_id")
      .eq("customer_id", profileId);
    expect(profiles).toHaveLength(1);
    expect(profiles?.[0]?.supabase_user_id).toBe(NEW_USER_ID);
    expect(memberships).toEqual([
      expect.objectContaining({
        academy_id: TENANT_ID,
        customer_id: profileId,
        ghl_contact_id: "ghl_local_parent_invite",
        status: "SUSPENDED",
      }),
    ]);

    const child = await invoke(studentsHandler, {
      body: { first_name: "Riley", last_name: "Lee", date_of_birth: "2018-07-09" },
      method: "POST",
      token: parentToken,
    });
    expect(child.statusCode).toBe(201);
    const studentId = (child.body as { id: string }).id;
    const today = new Date();
    const inFourteenDays = new Date(today);
    inFourteenDays.setDate(inFourteenDays.getDate() + 14);
    const schedule = await invoke(slotsHandler, {
      method: "GET",
      query: {
        academy_id: TENANT_ID,
        date_from: toDateOnly(today),
        date_to: toDateOnly(inFourteenDays),
      },
      token: parentToken,
    });
    expect(schedule.statusCode).toBe(200);
    const childActions = (schedule.body as Array<{ child_actions: Array<Record<string, unknown>> }>)
      .flatMap((slot) => slot.child_actions)
      .filter((action) => action.student_id === studentId);
    expect(childActions).toContainEqual(
      expect.objectContaining({ action: "book_trial", enabled: true }),
    );
  });

  it("creates a profile without an invite but blocks child creation", async () => {
    const token = await signIn(NEW_EMAIL);
    const registration = await invoke(registerHandler, {
      body: { first_name: "Jordan", last_name: "Lee", email: NEW_EMAIL },
      method: "POST",
      token,
    });
    expect(registration.statusCode).toBe(201);
    expect(registration.body).toMatchObject({
      registration: { academy_attached: false, profile_created: true },
    });

    const child = await invoke(studentsHandler, {
      body: { first_name: "Invite", last_name: "Child", date_of_birth: "2015-05-05" },
      method: "POST",
      token,
    });
    expect(child.statusCode).toBe(409);
    expect(child.body).toEqual({ error: "Academy invite required before adding a child." });
  });
});

async function resetRegistrationFixtures(): Promise<void> {
  const { data: profiles } = await serviceSupabase
    .from("customer_profiles")
    .select("id")
    .eq("email", NEW_EMAIL);
  const profileIds = (profiles ?? []).map((profile) => profile.id);
  if (profileIds.length > 0) {
    await serviceSupabase.from("academy_memberships").delete().in("customer_id", profileIds);
    await serviceSupabase.from("students").delete().in("parent_id", profileIds);
    await serviceSupabase.from("customer_profiles").delete().in("id", profileIds);
  }

  await serviceSupabase
    .from("customer_profiles")
    .update({ supabase_user_id: null, claimed_at: null })
    .eq("id", TAYLOR_PROFILE_ID);
  await serviceSupabase.auth.admin.updateUserById(TAYLOR_USER_ID, {
    app_metadata: { provider: "email", providers: ["email"] },
  });
  await serviceSupabase.auth.admin.updateUserById(NEW_USER_ID, {
    app_metadata: { provider: "email", providers: ["email"] },
  });
}

async function signIn(email: string): Promise<string> {
  const { data, error } = await anonSupabase.auth.signInWithPassword({
    email,
    password: LOCAL_PASSWORD,
  });
  if (error || !data.session?.access_token) {
    throw error ?? new Error(`No access token for ${email}`);
  }
  return data.session.access_token;
}

async function invoke(
  handler: (req: ParentApiRequest, res: ParentApiResponse) => unknown,
  input: {
    body?: unknown;
    method: string;
    query?: Record<string, string>;
    token: string;
  },
): Promise<MockResponse> {
  const response = mockResponse();
  await handler(
    {
      body: input.body,
      headers: { authorization: `Bearer ${input.token}` },
      method: input.method,
      query: input.query ?? {},
    },
    response,
  );
  return response;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mockResponse(): MockResponse {
  const response = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    statusCode: 200,
    json(body: unknown) {
      response.body = body;
      return response;
    },
    setHeader(name: string, value: string) {
      response.headers[name] = value;
      return response;
    },
    status(code: number) {
      response.statusCode = code;
      return response;
    },
  };
  return response;
}

function assertLocalSupabase(): void {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(runtimeTestSupabaseUrl)) {
    throw new Error(`Runtime tests require local Supabase, received ${runtimeTestSupabaseUrl}`);
  }
}
