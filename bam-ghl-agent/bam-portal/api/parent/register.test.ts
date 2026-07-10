import { beforeEach, describe, expect, it, vi } from "vitest";

import profileHandler from "./profile.js";
import registerHandler from "./register.js";
import { createParentInviteToken } from "./_parent-invite-token.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

type Row = Record<string, unknown>;
type MockResponse = ParentApiResponse & {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
};

const userId = "90000000-0000-4000-8000-000000000001";
const otherUserId = "90000000-0000-4000-8000-000000000002";
const academyId = "30000000-0000-4000-8000-000000000001";
const contactId = "31000000-0000-4000-8000-000000000001";
const opportunityId = "32000000-0000-4000-8000-000000000001";
const profileId = "10000000-0000-4000-8000-000000000001";
const email = "parent@example.test";

describe("parent registration and identity resolution", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.PARENT_INVITE_SIGNING_SECRET = "local-parent-invite-secret";
    vi.restoreAllMocks();
  });

  it("claims a preloaded parent by verified email and returns every sibling", async () => {
    const state = createState({
      profiles: [parentProfile({ supabase_user_id: null })],
      students: [
        student("20000000-0000-4000-8000-000000000001", "Maya"),
        student("20000000-0000-4000-8000-000000000002", "Leo"),
      ],
      memberships: [
        studentMembership("40000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"),
        studentMembership("40000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000002"),
      ],
    });
    mockSupabase(state);

    const res = await invoke(profileHandler, { method: "GET" });

    expect(res.statusCode).toBe(200);
    expect((res.body as { students: Row[] }).students.map((row) => row.first_name)).toEqual([
      "Maya",
      "Leo",
    ]);
    expect(state.profiles[0]?.supabase_user_id).toBe(userId);
    expect(state.user.app_metadata).toMatchObject({ role: "parent" });
    expect(state.adminUpdateCount).toBe(1);
  });

  it("is idempotent when the same auth user registers again", async () => {
    const state = createState({ profiles: [parentProfile({ supabase_user_id: userId })] });
    mockSupabase(state);

    const first = await invoke(registerHandler, { body: registrationBody(), method: "POST" });
    const second = await invoke(registerHandler, { body: registrationBody(), method: "POST" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect((first.body as Row).id).toBe(profileId);
    expect((second.body as Row).id).toBe(profileId);
    expect(state.profiles).toHaveLength(1);
    expect(state.adminUpdateCount).toBe(1);
  });

  it("creates a new parent and attaches the sales contact to its academy", async () => {
    const state = createState({ profiles: [] });
    mockSupabase(state);
    const { token } = createParentInviteToken({
      academy_id: academyId,
      contact_id: contactId,
      opportunity_id: opportunityId,
      email,
      expires_at: new Date(Date.now() + 60_000),
    });

    const res = await invoke(registerHandler, {
      body: { ...registrationBody(), invite_token: token },
      method: "POST",
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      email,
      registration: {
        academy_attached: true,
        academy_id: academyId,
        profile_created: true,
        profile_claimed: false,
      },
    });
    expect(state.profiles).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]).toMatchObject({
      academy_id: academyId,
      customer_id: state.profiles[0]?.id,
      ghl_contact_id: "ghl-contact-1",
      status: "SUSPENDED",
    });
  });

  it("preserves an existing active paid membership when an invite is replayed", async () => {
    const state = createState({
      profiles: [parentProfile({ supabase_user_id: userId })],
      memberships: [
        {
          id: "40000000-0000-4000-8000-000000000003",
          academy_id: academyId,
          customer_id: profileId,
          student_id: null,
          status: "ACTIVE",
          ghl_contact_id: "ghl-contact-1",
        },
      ],
    });
    mockSupabase(state);
    const { token } = createParentInviteToken({
      academy_id: academyId,
      contact_id: contactId,
      opportunity_id: opportunityId,
      email,
      expires_at: new Date(Date.now() + 60_000),
    });

    const res = await invoke(registerHandler, {
      body: { ...registrationBody(), invite_token: token },
      method: "POST",
    });

    expect(res.statusCode).toBe(200);
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]?.status).toBe("ACTIVE");
  });

  it("creates an unlinked profile when no invite is supplied", async () => {
    const state = createState({ profiles: [] });
    mockSupabase(state);

    const res = await invoke(registerHandler, { body: registrationBody(), method: "POST" });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      registration: { academy_attached: false, profile_created: true },
    });
    expect(state.memberships).toHaveLength(0);
  });

  it("rejects an invalid invite before creating a profile", async () => {
    const state = createState({ profiles: [] });
    mockSupabase(state);

    const res = await invoke(registerHandler, {
      body: { ...registrationBody(), invite_token: "not-a-valid-token" },
      method: "POST",
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "This academy invite is invalid or has expired." });
    expect(state.profiles).toHaveLength(0);
  });

  it("does not reassign a profile claimed by another auth user", async () => {
    const state = createState({
      profiles: [parentProfile({ supabase_user_id: otherUserId })],
    });
    mockSupabase(state);

    const res = await invoke(registerHandler, { body: registrationBody(), method: "POST" });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: "This parent profile has already been claimed by another account.",
    });
    expect(state.profiles[0]?.supabase_user_id).toBe(otherUserId);
  });

  it("surfaces a safe failure when the parent role cannot be stamped", async () => {
    const state = createState({
      adminUpdateStatus: 500,
      profiles: [parentProfile({ supabase_user_id: null })],
    });
    mockSupabase(state);

    const res = await invoke(registerHandler, { body: registrationBody(), method: "POST" });

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "Something went wrong. Please try again." });
    expect(state.profiles[0]?.supabase_user_id).toBe(userId);
  });
});

function createState(overrides: Partial<MockState> = {}): MockState {
  return {
    user: {
      id: userId,
      email,
      email_confirmed_at: "2026-07-09T12:00:00.000Z",
      app_metadata: { provider: "email" },
    },
    adminUpdateCount: 0,
    adminUpdateStatus: 200,
    profiles: [],
    students: [],
    memberships: [],
    academies: [{ id: academyId, business_name: "BAM GTA", status: "active" }],
    contacts: [
      {
        id: contactId,
        client_id: academyId,
        email,
        ghl_contact_id: "ghl-contact-1",
      },
    ],
    opportunities: [
      {
        id: opportunityId,
        client_id: academyId,
        contact_id: contactId,
        ghl_contact_id: "ghl-contact-1",
      },
    ],
    ...overrides,
  };
}

type MockState = {
  user: Row;
  adminUpdateCount: number;
  adminUpdateStatus: number;
  profiles: Row[];
  students: Row[];
  memberships: Row[];
  academies: Row[];
  contacts: Row[];
  opportunities: Row[];
};

function mockSupabase(state: MockState) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/auth/v1/user") return jsonResponse(state.user);
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      state.adminUpdateCount += 1;
      if (state.adminUpdateStatus !== 200) {
        return jsonResponse({ message: "auth update failed" }, state.adminUpdateStatus);
      }
      const body = readBody(init?.body);
      state.user.app_metadata = body.app_metadata;
      return jsonResponse(state.user);
    }

    const table = url.pathname.replace("/rest/v1/", "");
    if (table === "customer_profiles") {
      if (method === "POST") {
        const row = timestampRow(readBody(init?.body));
        state.profiles.push(row);
        return jsonResponse([row], 201);
      }
      if (method === "PATCH") {
        const patch = readBody(init?.body);
        const rows = filterRows(state.profiles, url).filter(
          (row) => url.searchParams.get("supabase_user_id") !== "is.null" || row.supabase_user_id == null,
        );
        rows.forEach((row) => Object.assign(row, patch));
        return jsonResponse(rows);
      }
      return jsonResponse(filterRows(state.profiles, url));
    }

    if (table === "students") return jsonResponse(filterRows(state.students, url));
    if (table === "academy_memberships") {
      if (method === "POST") {
        const row = timestampRow({ ...readBody(init?.body), joined_at: new Date().toISOString() });
        state.memberships.push(row);
        return jsonResponse([row], 201);
      }
      if (method === "PATCH") {
        const patch = readBody(init?.body);
        const rows = filterRows(state.memberships, url);
        rows.forEach((row) => Object.assign(row, patch));
        return jsonResponse(rows);
      }
      return jsonResponse(filterRows(state.memberships, url));
    }
    if (table === "clients") return jsonResponse(filterRows(state.academies, url));
    if (table === "contacts") return jsonResponse(filterRows(state.contacts, url));
    if (table === "opportunities") return jsonResponse(filterRows(state.opportunities, url));
    if (table === "member_links" || table === "members" || table === "customer_entitlements") {
      return jsonResponse([]);
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

function filterRows(rows: Row[], url: URL): Row[] {
  return rows.filter((row) => {
    for (const [key, filter] of url.searchParams.entries()) {
      if (["select", "limit", "order"].includes(key)) continue;
      if (filter.startsWith("eq.")) {
        if (String(row[key] ?? "") !== filter.slice(3)) return false;
      } else if (filter.startsWith("ilike.")) {
        if (String(row[key] ?? "").toLowerCase() !== filter.slice(6).toLowerCase()) return false;
      } else if (filter.startsWith("in.(")) {
        const values = filter.slice(4, -1).split(",");
        if (!values.includes(String(row[key] ?? ""))) return false;
      }
    }
    return true;
  });
}

function parentProfile(overrides: Row = {}): Row {
  return timestampRow({
    id: profileId,
    supabase_user_id: null,
    first_name: "Parent",
    last_name: "Tester",
    email,
    phone: null,
    profile_type: "PARENT",
    ...overrides,
  });
}

function student(id: string, firstName: string): Row {
  return timestampRow({
    id,
    parent_id: profileId,
    first_name: firstName,
    last_name: "Tester",
    date_of_birth: "2014-03-10",
    notes: null,
  });
}

function studentMembership(id: string, studentId: string): Row {
  return {
    id,
    academy_id: academyId,
    customer_id: null,
    student_id: studentId,
    status: "ACTIVE",
    joined_at: "2026-07-01T12:00:00.000Z",
    plan_id: null,
    stripe_customer_id: null,
    ghl_contact_id: `ghl-${studentId}`,
  };
}

function timestampRow(row: Row): Row {
  return {
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    ...row,
  };
}

function registrationBody() {
  return {
    first_name: "Parent",
    last_name: "Tester",
    email,
    profile_type: "PARENT",
  };
}

async function invoke(
  handler: (req: ParentApiRequest, res: ParentApiResponse) => unknown,
  req: { body?: unknown; method: string },
): Promise<MockResponse> {
  const res = mockResponse();
  await handler(
    {
      body: req.body,
      headers: { authorization: "Bearer parent-token" },
      method: req.method,
      query: {},
    },
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

function readBody(body: unknown): Row {
  return body ? (JSON.parse(String(body)) as Row) : {};
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
