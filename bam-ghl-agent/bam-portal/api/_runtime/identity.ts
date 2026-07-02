import { assertRows, assertSingle, isUniqueViolation } from "./supabase.js";
import type {
  AcademyMembership,
  AcademyMembershipStatus,
  CustomerProfile,
  MemberLink,
  RuntimeMember,
  RuntimeSupabaseClient,
  Student,
} from "./types.js";

export type RuntimeIdentitySpine = {
  profile: CustomerProfile;
  student: Student;
  membership: AcademyMembership;
  memberLink: MemberLink;
};

export async function ensureIdentitySpineFromMember(
  supabase: RuntimeSupabaseClient,
  member: RuntimeMember,
): Promise<RuntimeIdentitySpine> {
  const profile = await ensureCustomerProfileFromMember(supabase, member);
  const candidateStudent = await ensureStudentFromMember(supabase, member, profile);
  const memberLink = await ensureMemberLink(supabase, member, candidateStudent);
  const student =
    memberLink.student_id === candidateStudent.id
      ? candidateStudent
      : await requireStudentById(supabase, memberLink.student_id);
  const membership = await ensureAcademyMembershipFromMember(supabase, member, student);

  return { profile, student, membership, memberLink };
}

export async function ensureCustomerProfileFromMember(
  supabase: RuntimeSupabaseClient,
  member: RuntimeMember,
): Promise<CustomerProfile> {
  const email = normalizeEmail(member.parent_email);
  if (!email) throw new Error(`Member ${member.id} has no parent_email.`);

  const parentName = splitName(member.parent_name, email.split("@")[0] || "Parent");
  const payload = {
    first_name: parentName.firstName,
    last_name: parentName.lastName,
    email,
    phone: member.parent_phone,
    profile_type: "PARENT" as const,
  };

  const existing = await findCustomerProfileByEmail(supabase, email);
  if (existing) return updateCustomerProfile(supabase, existing.id, payload);

  const { data, error } = await supabase
    .from("customer_profiles")
    .insert(payload)
    .select(customerProfileSelect)
    .single();
  if (isUniqueViolation(error)) {
    const recovered = await findCustomerProfileByEmail(supabase, email);
    if (!recovered) throw new Error(`Customer profile for ${email} hit a unique conflict but could not be recovered.`);
    return updateCustomerProfile(supabase, recovered.id, payload);
  }
  return assertSingle<CustomerProfile>(data, error);
}

export async function ensureStudentFromMember(
  supabase: RuntimeSupabaseClient,
  member: RuntimeMember,
  profile: CustomerProfile,
): Promise<Student> {
  const linked = await getStudentLinkedToMember(supabase, member.id);
  if (linked) return linked;

  const athleteName = splitName(member.athlete_name, "Athlete");
  const existing = await findStudentByName(supabase, profile.id, athleteName.firstName, athleteName.lastName);
  if (existing) return existing;

  // Students intentionally have no uniqueness guard because matching is loose.
  // Concurrent first-runs can create an orphan candidate; member_links converges
  // the canonical member spine by member_id.
  const { data, error } = await supabase
    .from("students")
    .insert({
      parent_id: profile.id,
      first_name: athleteName.firstName,
      last_name: athleteName.lastName,
      notes: `Imported from member ${member.id}.`,
    })
    .select(studentSelect)
    .single();
  return assertSingle<Student>(data, error);
}

export async function ensureAcademyMembershipFromMember(
  supabase: RuntimeSupabaseClient,
  member: RuntimeMember,
  student: Student,
): Promise<AcademyMembership> {
  const status = membershipStatusFromMember(member.status);
  const existing = await findAcademyMembership(supabase, member.client_id, student.id);
  const insertPayload = {
    academy_id: member.client_id,
    student_id: student.id,
    customer_id: null,
    stripe_customer_id: member.stripe_customer_id,
    status,
    joined_at: member.stripe_joined_at ?? member.joined_date ?? new Date().toISOString(),
    ghl_contact_id: member.ghl_contact_id,
  };
  const updatePayload = {
    stripe_customer_id: member.stripe_customer_id,
    status,
    joined_at: member.stripe_joined_at ?? member.joined_date ?? new Date().toISOString(),
    ghl_contact_id: member.ghl_contact_id,
  };

  if (existing) return updateAcademyMembership(supabase, existing.id, updatePayload);

  const { data, error } = await supabase
    .from("academy_memberships")
    .insert(insertPayload)
    .select(academyMembershipSelect)
    .single();
  if (isUniqueViolation(error)) {
    const recovered = await findAcademyMembership(supabase, member.client_id, student.id);
    if (!recovered) {
      throw new Error(
        `Academy membership for academy ${member.client_id} and student ${student.id} hit a unique conflict but could not be recovered.`,
      );
    }
    return updateAcademyMembership(supabase, recovered.id, updatePayload);
  }
  return assertSingle<AcademyMembership>(data, error);
}

export async function ensureMemberLink(
  supabase: RuntimeSupabaseClient,
  member: RuntimeMember,
  student: Student,
): Promise<MemberLink> {
  const existing = await findMemberLinkByMember(supabase, member.id);
  const matchedBy: MemberLink["matched_by"] = member.parent_email ? "email" : "manual";
  const insertPayload = {
    student_id: student.id,
    member_id: member.id,
    matched_by: matchedBy,
    confirmed_at: new Date().toISOString(),
  };
  const updatePayload = {
    matched_by: matchedBy,
    confirmed_at: insertPayload.confirmed_at,
  };

  if (existing) return updateMemberLink(supabase, existing.id, updatePayload);

  const { data, error } = await supabase
    .from("member_links")
    .insert(insertPayload)
    .select(memberLinkSelect)
    .single();
  if (isUniqueViolation(error)) {
    const recovered = await findMemberLinkByMember(supabase, member.id);
    if (!recovered) throw new Error(`Member link for member ${member.id} hit a unique conflict but could not be recovered.`);
    return updateMemberLink(supabase, recovered.id, updatePayload);
  }
  return assertSingle<MemberLink>(data, error);
}

export function membershipStatusFromMember(status: RuntimeMember["status"]): AcademyMembershipStatus {
  switch (status) {
    case "live":
      return "ACTIVE";
    case "cancelled":
      return "CANCELLED";
    case "paused":
    case "payment_method_required":
    case "payment_failed":
    case "cancelling":
      return "SUSPENDED";
  }
}

async function updateCustomerProfile(
  supabase: RuntimeSupabaseClient,
  id: string,
  payload: Pick<CustomerProfile, "first_name" | "last_name" | "email" | "phone" | "profile_type">,
): Promise<CustomerProfile> {
  const { data, error } = await supabase
    .from("customer_profiles")
    .update(payload)
    .eq("id", id)
    .select(customerProfileSelect)
    .single();
  return assertSingle<CustomerProfile>(data, error);
}

async function updateAcademyMembership(
  supabase: RuntimeSupabaseClient,
  id: string,
  payload: Pick<AcademyMembership, "stripe_customer_id" | "status" | "joined_at" | "ghl_contact_id">,
): Promise<AcademyMembership> {
  const { data, error } = await supabase
    .from("academy_memberships")
    .update(payload)
    .eq("id", id)
    .select(academyMembershipSelect)
    .single();
  return assertSingle<AcademyMembership>(data, error);
}

async function updateMemberLink(
  supabase: RuntimeSupabaseClient,
  id: string,
  payload: Pick<MemberLink, "matched_by" | "confirmed_at">,
): Promise<MemberLink> {
  const { data, error } = await supabase
    .from("member_links")
    .update(payload)
    .eq("id", id)
    .select(memberLinkSelect)
    .single();
  return assertSingle<MemberLink>(data, error);
}

async function findCustomerProfileByEmail(
  supabase: RuntimeSupabaseClient,
  email: string,
): Promise<CustomerProfile | null> {
  const { data, error } = await supabase
    .from("customer_profiles")
    .select(customerProfileSelect)
    .ilike("email", email)
    .limit(1);
  return assertRows<CustomerProfile>(data, error)[0] ?? null;
}

async function getStudentLinkedToMember(
  supabase: RuntimeSupabaseClient,
  memberId: string,
): Promise<Student | null> {
  const { data, error } = await supabase
    .from("member_links")
    .select(`student:students(${studentSelect})`)
    .eq("member_id", memberId)
    .limit(1);
  const first = assertRows<{ student: Student | Student[] | null }>(data, error)[0];
  if (!first?.student) return null;
  return Array.isArray(first.student) ? first.student[0] ?? null : first.student;
}

async function requireStudentById(supabase: RuntimeSupabaseClient, studentId: string): Promise<Student> {
  const { data, error } = await supabase.from("students").select(studentSelect).eq("id", studentId).single();
  return assertSingle<Student>(data, error);
}

async function findStudentByName(
  supabase: RuntimeSupabaseClient,
  parentId: string,
  firstName: string,
  lastName: string,
): Promise<Student | null> {
  const { data, error } = await supabase
    .from("students")
    .select(studentSelect)
    .eq("parent_id", parentId)
    .ilike("first_name", firstName)
    .ilike("last_name", lastName)
    .limit(1);
  return assertRows<Student>(data, error)[0] ?? null;
}

async function findAcademyMembership(
  supabase: RuntimeSupabaseClient,
  academyId: string,
  studentId: string,
): Promise<AcademyMembership | null> {
  const { data, error } = await supabase
    .from("academy_memberships")
    .select(academyMembershipSelect)
    .eq("academy_id", academyId)
    .eq("student_id", studentId)
    .limit(1);
  return assertRows<AcademyMembership>(data, error)[0] ?? null;
}

async function findMemberLinkByMember(
  supabase: RuntimeSupabaseClient,
  memberId: string,
): Promise<MemberLink | null> {
  const { data, error } = await supabase
    .from("member_links")
    .select(memberLinkSelect)
    .eq("member_id", memberId)
    .limit(1);
  return assertRows<MemberLink>(data, error)[0] ?? null;
}

function normalizeEmail(email: string | null): string {
  return (email || "").trim().toLowerCase();
}

function splitName(name: string | null, fallback: string): { firstName: string; lastName: string } {
  const parts = (name || fallback).trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || fallback;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "Unknown";
  return { firstName, lastName };
}

const customerProfileSelect = [
  "id",
  "supabase_user_id",
  "first_name",
  "last_name",
  "email",
  "phone",
  "profile_type",
  "claimed_at",
].join(",");

const studentSelect = ["id", "parent_id", "first_name", "last_name", "date_of_birth", "notes"].join(",");

const academyMembershipSelect = [
  "id",
  "academy_id",
  "customer_id",
  "student_id",
  "plan_id",
  "stripe_customer_id",
  "status",
  "joined_at",
  "invited_by",
  "ghl_contact_id",
].join(",");

const memberLinkSelect = ["id", "student_id", "member_id", "matched_by", "confirmed_at"].join(",");
