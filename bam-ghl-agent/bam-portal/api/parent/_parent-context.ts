import { HttpError } from "./_errors.js";
import {
  resolveParentIdentityForUser,
  type ParentIdentityProfile,
} from "./_parent-identity.js";
import { eq, inList, sb, verifySupabaseUser, type SupabaseUser } from "./_supabase.js";
import type { ParentApiRequest } from "./_types.js";

export type ParentReadProfile = ParentIdentityProfile;

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
  return getParentReadContextForUser(user);
}

export async function getParentReadContextForUser(
  user: SupabaseUser,
): Promise<ParentReadContext> {
  const { profile } = await resolveParentIdentityForUser(user);
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
