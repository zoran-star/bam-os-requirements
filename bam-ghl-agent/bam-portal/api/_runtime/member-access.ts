import { assertRows, assertSingle, isUniqueViolation } from "./supabase.js";
import { membershipStatusFromMember } from "./identity.js";
import type {
  AcademyMembership,
  CustomerEntitlement,
  EntitlementTemplate,
  OfferPrice,
  RuntimeMember,
  RuntimeSupabaseClient,
} from "./types.js";

export async function grantOrSyncEntitlementFromOfferPrice(
  supabase: RuntimeSupabaseClient,
  args: {
    member: RuntimeMember;
    membership: AcademyMembership;
    offerPrice: OfferPrice;
    template: EntitlementTemplate;
    source: CustomerEntitlement["source"];
    sourceRef: string;
    validFrom?: string;
    validUntil?: string | null;
  },
): Promise<CustomerEntitlement> {
  if (!args.sourceRef.trim()) throw new Error("sourceRef is required for idempotent entitlement sync.");

  const existing = await findEntitlementBySourceRef(supabase, {
    tenantId: args.member.client_id,
    source: args.source,
    sourceRef: args.sourceRef,
  });
  const payload = entitlementPayload(args);

  if (existing) return updateCustomerEntitlement(supabase, existing.id, payload);

  const { data, error } = await supabase
    .from("customer_entitlements")
    .insert(payload)
    .select(customerEntitlementSelect)
    .single();
  if (isUniqueViolation(error)) {
    const recovered = await findEntitlementBySourceRef(supabase, {
      tenantId: args.member.client_id,
      source: args.source,
      sourceRef: args.sourceRef,
    });
    if (!recovered) {
      throw new Error(
        `Customer entitlement for ${args.source}:${args.sourceRef} hit a unique conflict but could not be recovered.`,
      );
    }
    return updateCustomerEntitlement(supabase, recovered.id, payload);
  }
  return assertSingle<CustomerEntitlement>(data, error);
}

export async function syncAccessStatusFromMemberStatus(
  supabase: RuntimeSupabaseClient,
  member: RuntimeMember,
): Promise<{ membershipStatus: AcademyMembership["status"] | null; entitlementCount: number }> {
  const membership = await findMembershipForMember(supabase, member.id);
  if (!membership) return { membershipStatus: null, entitlementCount: 0 };

  const status = membershipStatusFromMember(member.status);
  const entitlementStatus = status === "CANCELLED" ? "CANCELLED" : status === "ACTIVE" ? "ACTIVE" : "SUSPENDED";

  const { data: membershipData, error: membershipError } = await supabase
    .from("academy_memberships")
    .update({ status })
    .eq("id", membership.id)
    .select("status")
    .single();
  assertSingle<{ status: AcademyMembership["status"] }>(membershipData, membershipError);

  const { data, error } = await supabase
    .from("customer_entitlements")
    .update({ status: entitlementStatus })
    .eq("tenant_id", member.client_id)
    .eq("academy_membership_id", membership.id)
    .in("status", ["ACTIVE", "SUSPENDED"])
    .select("id");

  return {
    membershipStatus: status,
    entitlementCount: assertRows<{ id: string }>(data, error).length,
  };
}

async function findEntitlementBySourceRef(
  supabase: RuntimeSupabaseClient,
  args: { tenantId: string; source: CustomerEntitlement["source"]; sourceRef: string },
): Promise<CustomerEntitlement | null> {
  const { data, error } = await supabase
    .from("customer_entitlements")
    .select(customerEntitlementSelect)
    .eq("tenant_id", args.tenantId)
    .eq("source", args.source)
    .eq("source_ref", args.sourceRef)
    .limit(1);
  return assertRows<CustomerEntitlement>(data, error)[0] ?? null;
}

async function updateCustomerEntitlement(
  supabase: RuntimeSupabaseClient,
  id: string,
  payload: Omit<CustomerEntitlement, "id">,
): Promise<CustomerEntitlement> {
  const { data, error } = await supabase
    .from("customer_entitlements")
    .update(payload)
    .eq("id", id)
    .select(customerEntitlementSelect)
    .single();
  return assertSingle<CustomerEntitlement>(data, error);
}

async function findMembershipForMember(
  supabase: RuntimeSupabaseClient,
  memberId: string,
): Promise<AcademyMembership | null> {
  const { data, error } = await supabase
    .from("member_links")
    .select("student:students(academy_memberships(id,academy_id,customer_id,student_id,plan_id,stripe_customer_id,status,joined_at,invited_by,ghl_contact_id))")
    .eq("member_id", memberId)
    .limit(1);

  const first = assertRows<{
    student: { academy_memberships: AcademyMembership[] } | { academy_memberships: AcademyMembership[] }[] | null;
  }>(data, error)[0];
  const student = Array.isArray(first?.student) ? first?.student[0] : first?.student;
  return student?.academy_memberships[0] ?? null;
}

function entitlementPayload(args: {
  member: RuntimeMember;
  membership: AcademyMembership;
  offerPrice: OfferPrice;
  template: EntitlementTemplate;
  source: CustomerEntitlement["source"];
  sourceRef: string;
  validFrom?: string;
  validUntil?: string | null;
}): Omit<CustomerEntitlement, "id"> {
  const memberMembershipStatus = membershipStatusFromMember(args.member.status);
  const status =
    args.membership.status === "CANCELLED" || memberMembershipStatus === "CANCELLED"
      ? "CANCELLED"
      : args.membership.status === "ACTIVE" && memberMembershipStatus === "ACTIVE"
        ? "ACTIVE"
        : "SUSPENDED";
  return {
    tenant_id: args.member.client_id,
    academy_membership_id: args.membership.id,
    customer_id: args.membership.customer_id,
    student_id: args.membership.student_id,
    scope_type: args.template.scope_type,
    scope_id: args.template.scope_type === "STUDENT" ? args.membership.student_id : null,
    entitlement_kind: args.template.entitlement_kind,
    status,
    valid_from: args.validFrom ?? new Date().toISOString(),
    valid_until: args.validUntil ?? null,
    source: args.source,
    source_offer_price_id: args.offerPrice.id,
    source_entitlement_template_id: args.template.id,
    bookable_program_id: args.template.bookable_program_id,
    source_ref: args.sourceRef,
    config: args.template.config,
  };
}

const customerEntitlementSelect = [
  "id",
  "tenant_id",
  "academy_membership_id",
  "customer_id",
  "student_id",
  "scope_type",
  "scope_id",
  "entitlement_kind",
  "status",
  "valid_from",
  "valid_until",
  "source",
  "source_offer_price_id",
  "source_entitlement_template_id",
  "bookable_program_id",
  "source_ref",
  "config",
].join(",");
