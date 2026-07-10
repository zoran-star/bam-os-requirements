import {
  decorateMembershipsWithEntitlements,
  type CustomerEntitlementOut,
  type MembershipCreditSummaryOut,
} from "./_entitlements.js";
import type {
  ParentReadContext,
  ParentReadMembership,
  ParentReadProfile,
  ParentReadStudent,
} from "./_parent-context.js";
import { inList, sb } from "./_supabase.js";

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

export type ParentProfileMembership = ParentReadMembership & {
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

export type ParentProfilePayload = ParentReadProfile & {
  students: ParentReadStudent[];
  memberships: ParentProfileMembership[];
};

export async function buildParentProfilePayload(
  context: ParentReadContext,
): Promise<ParentProfilePayload> {
  const academyNames = await getAcademyNames(context.academyIds);
  const linkedMembers = await getLinkedMembers(
    context.students.map((student) => student.id),
  );
  const memberships = context.memberships.map((membership) => ({
    ...membership,
    academy_name: academyNames.get(membership.academy_id) || "Academy",
    linked_member: membership.student_id
      ? linkedMembers.get(membership.student_id) || null
      : null,
  }));

  return {
    ...context.profile,
    students: context.students,
    memberships: await decorateMembershipsWithEntitlements(memberships),
  };
}

async function getAcademyNames(academyIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (academyIds.length === 0) return names;

  const rows = await sb<ClientRow[]>(
    `clients?id=in.(${inList(academyIds)})&select=id,business_name`,
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    names.set(row.id, row.business_name || "Academy");
  }
  return names;
}

async function getLinkedMembers(
  studentIds: string[],
): Promise<Map<string, ParentProfileMembership["linked_member"]>> {
  const links = new Map<string, ParentProfileMembership["linked_member"]>();
  if (studentIds.length === 0) return links;

  const linkRows = await sb<MemberLink[]>(
    `member_links?student_id=in.(${inList(studentIds)})` +
      "&select=student_id,matched_by,confirmed_at,member_id",
  );
  const rows = Array.isArray(linkRows) ? linkRows : [];
  if (rows.length === 0) return links;

  const members = await getMembers(rows.map((row) => row.member_id).filter(Boolean));
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
