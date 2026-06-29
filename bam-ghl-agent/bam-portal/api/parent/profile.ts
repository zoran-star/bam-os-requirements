import { withSentryApiRoute } from "../_sentry.js";
import {
  decorateMembershipsWithEntitlements,
  type CustomerEntitlementOut,
  type MembershipCreditSummaryOut,
} from "./_entitlements.js";
import { HttpError, sendError } from "./_errors.js";
import { eq, inList, sb, verifySupabaseUser } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

const MISSING_CUSTOMER_PROFILE_MESSAGE =
  "No customer profile found. Please register to continue.";

type CustomerProfile = {
  id: string;
  supabase_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_type: "PARENT" | "STUDENT";
  created_at: string;
  updated_at: string;
};

type Student = {
  id: string;
  parent_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Membership = {
  id: string;
  academy_id: string;
  customer_id: string | null;
  student_id: string | null;
  status: "ACTIVE" | "SUSPENDED" | "CANCELLED";
  joined_at: string;
  plan_id: string | null;
  stripe_customer_id: string | null;
  ghl_contact_id: string | null;
};

type ClientRow = {
  id: string;
  business_name: string | null;
};

type MemberLink = {
  student_id: string;
  member_id: string;
  matched_by: "email" | "phone" | "manual";
  confirmed_at: string | null;
};

type LinkedMember = {
  id: string;
  athlete_name: string | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  plan: string | null;
  status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  joined_date: string | null;
  pause_scheduled_for: string | null;
  billing_mode: string | null;
};

type ParentMembership = Membership & {
  academy_name: string;
  credit_summary: MembershipCreditSummaryOut;
  entitlements: CustomerEntitlementOut[];
  linked_member: {
    member_id: string;
    matched_by: MemberLink["matched_by"];
    confirmed_at: string | null;
    member: LinkedMember | null;
  } | null;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const user = await verifySupabaseUser(req);
    let profile = await getCustomerProfile(user.id);

    if (req.method === "PATCH") {
      await updateCustomerProfile(profile.id, readUpdateProfileRequest(req.body));
      profile = await getCustomerProfile(user.id);
    }

    const payload = await buildCustomerProfilePayload(profile);

    return res.status(200).json(payload);
  } catch (error) {
    return sendError(res, error);
  }
}

async function buildCustomerProfilePayload(profile: CustomerProfile) {
  const students = await getStudents(profile.id);
  const memberships = await getMemberships(profile.id, students);

  return {
    ...profile,
    students,
    memberships,
  };
}

async function getCustomerProfile(supabaseUserId: string): Promise<CustomerProfile> {
  const rows = await sb<CustomerProfile[]>(
    `customer_profiles?supabase_user_id=eq.${eq(supabaseUserId)}` +
      "&select=id,supabase_user_id,first_name,last_name,email,phone,profile_type,created_at,updated_at" +
      "&limit=1",
  );
  const profile = Array.isArray(rows) ? rows[0] : null;

  if (!profile) {
    throw new HttpError(403, MISSING_CUSTOMER_PROFILE_MESSAGE, MISSING_CUSTOMER_PROFILE_MESSAGE);
  }

  return profile;
}

async function getStudents(parentId: string): Promise<Student[]> {
  const rows = await sb<Student[]>(
    `students?parent_id=eq.${eq(parentId)}` +
      "&select=id,parent_id,first_name,last_name,date_of_birth,notes,created_at,updated_at" +
      "&order=created_at.asc",
  );

  return Array.isArray(rows) ? rows : [];
}

type UpdateProfileRequest = {
  first_name?: string;
  last_name?: string;
  phone?: string | null;
};

function readUpdateProfileRequest(body: unknown): UpdateProfileRequest {
  const input = readJsonObject(body);
  const patch: UpdateProfileRequest = {};

  if ("email" in input) {
    throw new HttpError(400, "Email changes are not available yet.");
  }

  if ("first_name" in input) {
    patch.first_name = requiredTrimmedString(input.first_name, "first_name");
  }

  if ("last_name" in input) {
    patch.last_name = requiredTrimmedString(input.last_name, "last_name");
  }

  if ("phone" in input) {
    patch.phone = optionalTrimmedString(input.phone, "phone");
  }

  if (!("first_name" in patch) && !("last_name" in patch) && !("phone" in patch)) {
    throw new HttpError(400, "No supported profile fields provided.");
  }

  return patch;
}

async function updateCustomerProfile(profileId: string, patch: UpdateProfileRequest) {
  await sb(
    `customer_profiles?id=eq.${eq(profileId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ...patch,
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

function readJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new HttpError(400, "Invalid JSON body.");
    }
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  throw new HttpError(400, "Expected JSON body.");
}

function requiredTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing required body field: ${fieldName}.`);
  }

  return value.trim();
}

function optionalTrimmedString(value: unknown, fieldName: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function getMemberships(profileId: string, students: Student[]): Promise<ParentMembership[]> {
  const studentIds = students.map((student) => student.id).filter(Boolean);
  const profileMemberships = await sb<Membership[]>(
    `academy_memberships?customer_id=eq.${eq(profileId)}` +
      "&select=id,academy_id,customer_id,student_id,status,joined_at,plan_id,stripe_customer_id,ghl_contact_id",
  );

  let studentMemberships: Membership[] = [];
  if (studentIds.length > 0) {
    studentMemberships = await sb<Membership[]>(
      `academy_memberships?student_id=in.(${inList(studentIds)})` +
        "&select=id,academy_id,customer_id,student_id,status,joined_at,plan_id,stripe_customer_id,ghl_contact_id",
    );
  }

  const memberships = [
    ...(Array.isArray(profileMemberships) ? profileMemberships : []),
    ...(Array.isArray(studentMemberships) ? studentMemberships : []),
  ];

  const academyNames = await getAcademyNames(memberships);
  const linkedMembers = await getLinkedMembers(studentIds);

  const parentMemberships = memberships.map((membership) => ({
    id: membership.id,
    academy_id: membership.academy_id,
    academy_name: academyNames.get(membership.academy_id) || "Academy",
    customer_id: membership.customer_id,
    student_id: membership.student_id,
    status: membership.status,
    joined_at: membership.joined_at,
    plan_id: membership.plan_id,
    stripe_customer_id: membership.stripe_customer_id,
    ghl_contact_id: membership.ghl_contact_id,
    linked_member: membership.student_id ? linkedMembers.get(membership.student_id) || null : null,
  }));

  return decorateMembershipsWithEntitlements(parentMemberships);
}

async function getAcademyNames(memberships: Membership[]): Promise<Map<string, string>> {
  const academyIds = [...new Set(memberships.map((membership) => membership.academy_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (academyIds.length === 0) return names;

  const rows = await sb<ClientRow[]>(`clients?id=in.(${inList(academyIds)})&select=id,business_name`);
  for (const row of Array.isArray(rows) ? rows : []) {
    names.set(row.id, row.business_name || "Academy");
  }
  return names;
}

async function getLinkedMembers(studentIds: string[]): Promise<Map<string, ParentMembership["linked_member"]>> {
  const links = new Map<string, ParentMembership["linked_member"]>();
  if (studentIds.length === 0) return links;

  const linkRows = await sb<MemberLink[]>(
    `member_links?student_id=in.(${inList(studentIds)})` +
      "&select=student_id,matched_by,confirmed_at,member_id",
  );
  const rows = Array.isArray(linkRows) ? linkRows : [];
  if (rows.length === 0) return links;

  const memberIds = rows.map((row) => row.member_id).filter(Boolean);
  const members = await getMembers(memberIds);
  for (const row of rows) {
    links.set(row.student_id, {
      member_id: row.member_id,
      matched_by: row.matched_by,
      confirmed_at: row.confirmed_at,
      member: members.get(row.member_id) || null,
    });
  }

  return links;
}

async function getMembers(memberIds: string[]): Promise<Map<string, LinkedMember>> {
  const members = new Map<string, LinkedMember>();
  if (memberIds.length === 0) return members;

  const rows = await sb<LinkedMember[]>(
    `members?id=in.(${inList(memberIds)})` +
      "&select=id,athlete_name,parent_name,parent_email,parent_phone,plan,status,stripe_customer_id,stripe_subscription_id,stripe_price_id,joined_date,pause_scheduled_for,billing_mode",
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    members.set(row.id, row);
  }

  return members;
}

export default withSentryApiRoute(handler);
