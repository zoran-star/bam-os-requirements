import { HttpError } from "./_errors.js";
import { eq, inList, sb, verifySupabaseUser, type SupabaseUser } from "./_supabase.js";
import type { ParentApiRequest } from "./_types.js";

const MISSING_CUSTOMER_PROFILE_MESSAGE =
  "No customer profile found. Please register to continue.";

export type ParentReadProfile = {
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

export type ParentReadStudent = {
  id: string;
  parent_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ParentReadMembership = {
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

export type ParentReadContext = {
  user: SupabaseUser;
  profile: ParentReadProfile;
  students: ParentReadStudent[];
  memberships: ParentReadMembership[];
  academyIds: string[];
};

export async function getParentReadContext(req: ParentApiRequest): Promise<ParentReadContext> {
  const user = await verifySupabaseUser(req);
  const profile = await getCustomerProfile(user.id);
  const students = await getStudents(profile.id);
  const memberships = await getMemberships(profile.id, students.map((student) => student.id));

  return {
    user,
    profile,
    students,
    memberships,
    academyIds: [...new Set(memberships.map((membership) => membership.academy_id))],
  };
}

export function getOwnedStudent(
  context: ParentReadContext,
  studentId: string,
): ParentReadStudent {
  const student = context.students.find((row) => row.id === studentId);
  if (!student) {
    throw new HttpError(404, "Student not found.");
  }
  return student;
}

export function membershipsForStudent(
  context: ParentReadContext,
  studentId: string,
): ParentReadMembership[] {
  getOwnedStudent(context, studentId);
  return context.memberships.filter((membership) => membership.student_id === studentId);
}

export function partitionMemberships<TMembership extends { customer_id: string | null; student_id: string | null }>(
  memberships: TMembership[],
): {
  profile_memberships: TMembership[];
  student_memberships: TMembership[];
} {
  return {
    profile_memberships: memberships.filter((membership) => Boolean(membership.customer_id)),
    student_memberships: memberships.filter((membership) => Boolean(membership.student_id)),
  };
}

async function getCustomerProfile(supabaseUserId: string): Promise<ParentReadProfile> {
  const rows = await sb<ParentReadProfile[]>(
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

async function getStudents(parentId: string): Promise<ParentReadStudent[]> {
  const rows = await sb<ParentReadStudent[]>(
    `students?parent_id=eq.${eq(parentId)}` +
      "&select=id,parent_id,first_name,last_name,date_of_birth,notes,created_at,updated_at" +
      "&order=created_at.asc",
  );

  return Array.isArray(rows) ? rows : [];
}

async function getMemberships(
  profileId: string,
  studentIds: string[],
): Promise<ParentReadMembership[]> {
  const profileMemberships = await sb<ParentReadMembership[]>(
    `academy_memberships?customer_id=eq.${eq(profileId)}` +
      "&select=id,academy_id,customer_id,student_id,status,joined_at,plan_id,stripe_customer_id,ghl_contact_id",
  );

  let studentMemberships: ParentReadMembership[] = [];
  if (studentIds.length > 0) {
    studentMemberships = await sb<ParentReadMembership[]>(
      `academy_memberships?student_id=in.(${inList(studentIds)})` +
        "&select=id,academy_id,customer_id,student_id,status,joined_at,plan_id,stripe_customer_id,ghl_contact_id",
    );
  }

  return dedupeMemberships([
    ...(Array.isArray(profileMemberships) ? profileMemberships : []),
    ...(Array.isArray(studentMemberships) ? studentMemberships : []),
  ]);
}

function dedupeMemberships<TMembership extends { id: string }>(
  memberships: TMembership[],
): TMembership[] {
  const byId = new Map<string, TMembership>();
  for (const membership of memberships) {
    byId.set(membership.id, membership);
  }
  return [...byId.values()];
}
