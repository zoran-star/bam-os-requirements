import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { grantCredits, recordCreditLedgerEntry } from "./credits.js";
import { ensureAcademyMembershipFromMember, ensureIdentitySpineFromMember } from "./identity.js";
import { grantOrSyncEntitlementFromOfferPrice, syncAccessStatusFromMemberStatus } from "./member-access.js";
import { getActiveEntitlementTemplateForPrice, resolveRuntimeOfferPrice } from "./offer-runtime.js";
import type { AcademyMembership, CustomerEntitlement, RuntimeMember, RuntimeSupabaseClient, Student } from "./types.js";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const runtimeTestSupabaseUrl = process.env.RUNTIME_TEST_SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const runtimeTestServiceRoleKey = process.env.RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY;
if (!runtimeTestServiceRoleKey) {
  throw new Error("RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY is required. Run npm run test:runtime.");
}

const TENANT_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";
const STEADY_MONTHLY_PRICE_ID = "82000000-0000-4000-8000-000000000001";
const TRAINING_PROGRAM_ID = "80000000-0000-4000-8000-000000000001";
const TEST_MEMBER_ID = "90000000-0000-4000-8000-000000000101";
const TEST_PARENT_EMAIL = "runtime.parent@example.test";
const TEST_SLOT_TEMPLATE_ID = "90000000-0000-4000-8000-000000000201";
const TEST_SLOT_ID = "90000000-0000-4000-8000-000000000202";
const TEST_RESERVATION_ID = "90000000-0000-4000-8000-000000000301";

const supabase = createClient(
  runtimeTestSupabaseUrl,
  runtimeTestServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
) as RuntimeSupabaseClient;

describe("runtime helper contracts", () => {
  beforeEach(async () => {
    assertLocalSupabase();
    await cleanupTestRows();
    await insertTestMember(testMember({ status: "live" }));
  });

  it("resolves the active routable production-shaped Steady monthly price", async () => {
    const price = await resolveRuntimeOfferPrice(supabase, {
      tenantId: TENANT_ID,
      offerPriceKey: "Steady|monthly",
    });
    const template = await getActiveEntitlementTemplateForPrice(supabase, {
      tenantId: TENANT_ID,
      offerPriceId: price.id,
    });

    expect(price.id).toBe(STEADY_MONTHLY_PRICE_ID);
    expect(price.is_active).toBe(true);
    expect(price.is_routable).toBe(true);
    expect(template.entitlement_kind).toBe("WEEKLY_CREDITS");
    expect(template.credits_per_period).toBe(1);
    expect(template.bookable_program_id).toBe(TRAINING_PROGRAM_ID);
  });

  it("creates the identity spine idempotently from a production-shaped member row", async () => {
    const member = testMember({ status: "live" });

    const first = await ensureIdentitySpineFromMember(supabase, member);
    const second = await ensureIdentitySpineFromMember(supabase, member);

    expect(second.profile.id).toBe(first.profile.id);
    expect(second.student.id).toBe(first.student.id);
    expect(second.membership.id).toBe(first.membership.id);
    expect(second.memberLink.id).toBe(first.memberLink.id);

    expect(await countRows("customer_profiles", "email", TEST_PARENT_EMAIL)).toBe(1);
    expect(await countRows("member_links", "member_id", TEST_MEMBER_ID)).toBe(1);
    expect(second.membership.status).toBe("ACTIVE");
  });

  it("converges under concurrent identity spine creation", async () => {
    const member = testMember({
      id: randomUUID(),
      parent_email: uniqueRuntimeEmail(),
      stripe_customer_id: `cus_${randomUUID()}`,
      stripe_subscription_id: `sub_${randomUUID()}`,
      ghl_contact_id: `ghl_${randomUUID()}`,
    });
    await insertTestMember(member);

    try {
      const [first, second] = await Promise.all([
        ensureIdentitySpineFromMember(supabase, member),
        ensureIdentitySpineFromMember(supabase, member),
      ]);

      expect(second.profile.id).toBe(first.profile.id);
      expect(second.membership.id).toBe(first.membership.id);
      expect(second.memberLink.id).toBe(first.memberLink.id);
      expect(await countCustomerProfilesByEmailInsensitive(member.parent_email ?? "")).toBe(1);
    } finally {
      await cleanupMemberArtifacts(member);
    }
  });

  it("grants or syncs an entitlement idempotently by source ref", async () => {
    const member = testMember({ status: "live" });
    const spine = await ensureIdentitySpineFromMember(supabase, member);
    const price = await resolveRuntimeOfferPrice(supabase, {
      tenantId: TENANT_ID,
      offerPriceId: STEADY_MONTHLY_PRICE_ID,
    });
    const template = await getActiveEntitlementTemplateForPrice(supabase, {
      tenantId: TENANT_ID,
      offerPriceId: price.id,
    });

    const sourceRef = "stripe_subscription:sub_runtime_contract";
    const first = await grantOrSyncEntitlementFromOfferPrice(supabase, {
      member,
      membership: spine.membership,
      offerPrice: price,
      template,
      source: "stripe",
      sourceRef,
    });
    const second = await grantOrSyncEntitlementFromOfferPrice(supabase, {
      member,
      membership: spine.membership,
      offerPrice: price,
      template,
      source: "stripe",
      sourceRef,
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("ACTIVE");
    expect(second.source_offer_price_id).toBe(STEADY_MONTHLY_PRICE_ID);
    expect(second.source_entitlement_template_id).toBe(template.id);
    expect(await countRows("customer_entitlements", "source_ref", sourceRef)).toBe(1);
  });

  it("dedupes Stripe invoice credit grants but still allows booking/cancel ledger rows", async () => {
    const entitlement = await createActiveTestEntitlement();
    await createTestReservation(entitlement);
    const sourceRef = "invoice_line:il_runtime_contract";

    const firstGrant = await grantCredits(supabase, {
      entitlement,
      amount: 4,
      sourceRef,
      metadata: { reason: "paid_period_grant" },
    });
    const secondGrant = await grantCredits(supabase, {
      entitlement,
      amount: 4,
      sourceRef,
      metadata: { reason: "paid_period_grant" },
    });

    expect(secondGrant.id).toBe(firstGrant.id);
    expect(await countLedgerRows({ source: "stripe", sourceRef })).toBe(1);

    await recordCreditLedgerEntry(supabase, {
      entitlement,
      entryType: "DEBIT",
      creditDelta: -1,
      source: "booking",
      sourceRef: `reservation:${TEST_RESERVATION_ID}`,
      reservationId: TEST_RESERVATION_ID,
    });
    await recordCreditLedgerEntry(supabase, {
      entitlement,
      entryType: "REFUND",
      creditDelta: 1,
      source: "cancel",
      sourceRef: `reservation:${TEST_RESERVATION_ID}`,
      reservationId: TEST_RESERVATION_ID,
    });

    expect(await countLedgerRows({ sourceRef: `reservation:${TEST_RESERVATION_ID}` })).toBe(2);
  });

  it("converges under concurrent credit grants", async () => {
    const entitlement = await createActiveTestEntitlement();
    const sourceRef = `invoice_line:${randomUUID()}`;

    try {
      const [firstGrant, secondGrant] = await Promise.all([
        grantCredits(supabase, {
          entitlement,
          amount: 4,
          sourceRef,
          metadata: { reason: "paid_period_grant" },
        }),
        grantCredits(supabase, {
          entitlement,
          amount: 4,
          sourceRef,
          metadata: { reason: "paid_period_grant" },
        }),
      ]);

      expect(secondGrant.id).toBe(firstGrant.id);
      expect(await countLedgerRows({ source: "stripe", sourceRef })).toBe(1);
    } finally {
      await supabase.from("credit_ledger").delete().eq("tenant_id", TENANT_ID).eq("source_ref", sourceRef);
    }
  });

  it("does not wipe customer_id on membership resync", async () => {
    const customerId = randomUUID();
    const studentId = randomUUID();
    const existing: AcademyMembership = {
      id: randomUUID(),
      academy_id: TENANT_ID,
      customer_id: customerId,
      student_id: studentId,
      plan_id: null,
      stripe_customer_id: "cus_runtime_claimed",
      status: "ACTIVE",
      joined_at: "2026-07-01T12:00:00.000Z",
      invited_by: null,
      ghl_contact_id: "ghl_runtime_claimed",
    };
    const updates: unknown[] = [];
    const fakeSupabase = academyMembershipFake(existing, updates);

    const result = await ensureAcademyMembershipFromMember(
      fakeSupabase,
      testMember({ stripe_customer_id: "cus_runtime_resync", ghl_contact_id: "ghl_runtime_resync" }),
      testStudent({ id: studentId }),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("customer_id");
    expect(result.customer_id).toBe(customerId);
  });

  it("syncs member status to membership and entitlement access", async () => {
    const member = testMember({ status: "live" });
    const entitlement = await createActiveTestEntitlement();

    await updateTestMemberStatus("payment_method_required");
    const suspended = await syncAccessStatusFromMemberStatus(supabase, {
      ...member,
      status: "payment_method_required",
    });
    expect(suspended.membershipStatus).toBe("SUSPENDED");
    expect(suspended.entitlementCount).toBe(1);
    expect(await entitlementStatus(entitlement.id)).toBe("SUSPENDED");

    await updateTestMemberStatus("live");
    const active = await syncAccessStatusFromMemberStatus(supabase, {
      ...member,
      status: "live",
    });
    expect(active.membershipStatus).toBe("ACTIVE");
    expect(await entitlementStatus(entitlement.id)).toBe("ACTIVE");
  });

  it("maps cancelled members to terminal statuses", async () => {
    const member = testMember({ status: "live" });
    const entitlement = await createActiveTestEntitlement();

    const cancelled = await syncAccessStatusFromMemberStatus(supabase, {
      ...member,
      status: "cancelled",
    });

    expect(cancelled.membershipStatus).toBe("CANCELLED");
    expect(cancelled.entitlementCount).toBe(1);
    expect(await entitlementStatus(entitlement.id)).toBe("CANCELLED");
    expect(await membershipStatus(entitlement.academy_membership_id)).toBe("CANCELLED");
  });

  it("throws on ambiguous offer price key", async () => {
    const seedPrice = await resolveRuntimeOfferPrice(supabase, {
      tenantId: TENANT_ID,
      offerPriceId: STEADY_MONTHLY_PRICE_ID,
    });
    const duplicateId = randomUUID();

    try {
      const { error } = await supabase.from("offer_prices").insert({
        id: duplicateId,
        tenant_id: TENANT_ID,
        offer_option_id: seedPrice.offer_option_id,
        title: "Runtime Ambiguous Steady Monthly",
        amount_cents: seedPrice.amount_cents,
        currency: seedPrice.currency,
        billing_interval: seedPrice.billing_interval,
        stripe_price_id: `price_runtime_ambiguous_${randomUUID()}`,
        stripe_product_id: seedPrice.stripe_product_id,
        source_offer_id: seedPrice.source_offer_id,
        source_offer_price_key: seedPrice.source_offer_price_key,
        source_pricing_catalog_id: null,
        is_active: true,
        is_routable: true,
        show_on_onboarding: seedPrice.show_on_onboarding,
        sort_order: seedPrice.sort_order + 1,
      });
      if (error) throw new Error(error.message);

      await expect(
        resolveRuntimeOfferPrice(supabase, {
          tenantId: TENANT_ID,
          offerPriceKey: seedPrice.source_offer_price_key ?? "",
        }),
      ).rejects.toThrow(/Ambiguous runtime offer price key/);
    } finally {
      await supabase.from("offer_prices").delete().eq("id", duplicateId);
    }
  });
});

async function createActiveTestEntitlement(): Promise<CustomerEntitlement> {
  const member = testMember({ status: "live" });
  const spine = await ensureIdentitySpineFromMember(supabase, member);
  const price = await resolveRuntimeOfferPrice(supabase, {
    tenantId: TENANT_ID,
    offerPriceId: STEADY_MONTHLY_PRICE_ID,
  });
  const template = await getActiveEntitlementTemplateForPrice(supabase, {
    tenantId: TENANT_ID,
    offerPriceId: price.id,
  });

  return grantOrSyncEntitlementFromOfferPrice(supabase, {
    member,
    membership: spine.membership,
    offerPrice: price,
    template,
    source: "stripe",
    sourceRef: "stripe_subscription:sub_runtime_contract",
  });
}

function uniqueRuntimeEmail(): string {
  return `runtime-${randomUUID()}@example.test`;
}

function testMember(overrides: Partial<RuntimeMember> = {}): RuntimeMember {
  return {
    id: TEST_MEMBER_ID,
    client_id: TENANT_ID,
    athlete_name: "Runtime Athlete",
    parent_name: "Runtime Parent",
    parent_email: TEST_PARENT_EMAIL,
    parent_phone: "+14165550999",
    status: "live",
    stripe_customer_id: "cus_runtime_contract",
    stripe_subscription_id: "sub_runtime_contract",
    stripe_price_id: "plan_ToNwa96lQ5I1Bs",
    ghl_contact_id: "ghl_runtime_contract",
    joined_date: "2026-07-01",
    stripe_joined_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

function testStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: randomUUID(),
    parent_id: randomUUID(),
    first_name: "Runtime",
    last_name: "Athlete",
    date_of_birth: null,
    notes: null,
    ...overrides,
  };
}

function academyMembershipFake(existing: AcademyMembership, updates: unknown[]): RuntimeSupabaseClient {
  type SelectBuilder = {
    eq: (...args: unknown[]) => SelectBuilder;
    limit: (count: number) => Promise<{ data: AcademyMembership[]; error: null }>;
  };
  type UpdateBuilder = {
    eq: (...args: unknown[]) => UpdateBuilder;
    select: (columns: string) => UpdateBuilder;
    single: () => Promise<{ data: AcademyMembership; error: null }>;
  };

  const selectBuilder: SelectBuilder = {
    eq: () => selectBuilder,
    limit: async () => ({ data: [existing], error: null }),
  };

  return {
    from(table: string) {
      if (table !== "academy_memberships") throw new Error(`Unexpected fake table ${table}.`);
      return {
        select: () => selectBuilder,
        update: (payload: unknown) => {
          updates.push(payload);
          const updated = { ...existing, ...(payload as Partial<AcademyMembership>) };
          const updateBuilder: UpdateBuilder = {
            eq: () => updateBuilder,
            select: () => updateBuilder,
            single: async () => ({ data: updated, error: null }),
          };
          return updateBuilder;
        },
        insert: () => {
          throw new Error("Unexpected membership insert in resync test.");
        },
      };
    },
  } as unknown as RuntimeSupabaseClient;
}

async function insertTestMember(member: RuntimeMember): Promise<void> {
  const { error } = await supabase.from("members").insert({
    id: member.id,
    client_id: member.client_id,
    athlete_name: member.athlete_name,
    plan: "1/wk",
    status: member.status,
    parent_name: member.parent_name,
    parent_email: member.parent_email,
    parent_phone: member.parent_phone,
    stripe_customer_id: member.stripe_customer_id,
    stripe_subscription_id: member.stripe_subscription_id,
    stripe_price_id: member.stripe_price_id,
    ghl_contact_id: member.ghl_contact_id,
    joined_date: member.joined_date,
    stripe_joined_at: member.stripe_joined_at,
    billing_mode: "subscription",
  });
  if (error) throw new Error(error.message);
}

async function cleanupTestRows(): Promise<void> {
  await supabase.from("credit_ledger").delete().eq("tenant_id", TENANT_ID).eq("source_ref", "invoice_line:il_runtime_contract");
  await supabase.from("credit_ledger").delete().eq("tenant_id", TENANT_ID).eq("source_ref", `reservation:${TEST_RESERVATION_ID}`);
  await supabase.from("reservations").delete().eq("id", TEST_RESERVATION_ID);
  await supabase.from("schedule_slots").delete().eq("id", TEST_SLOT_ID);
  await supabase.from("slot_templates").delete().eq("id", TEST_SLOT_TEMPLATE_ID);
  await supabase
    .from("customer_entitlements")
    .delete()
    .eq("tenant_id", TENANT_ID)
    .eq("source_ref", "stripe_subscription:sub_runtime_contract");
  await supabase.from("member_links").delete().eq("member_id", TEST_MEMBER_ID);
  await supabase.from("members").delete().eq("id", TEST_MEMBER_ID);

  const { data: profiles, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("email", TEST_PARENT_EMAIL);
  if (profileError) throw new Error(profileError.message);
  const profileIds = (profiles ?? []).map((profile) => profile.id);
  if (profileIds.length > 0) {
    await supabase.from("students").delete().in("parent_id", profileIds);
    await supabase.from("customer_profiles").delete().in("id", profileIds);
  }
}

async function cleanupMemberArtifacts(member: RuntimeMember): Promise<void> {
  await supabase.from("member_links").delete().eq("member_id", member.id);
  await supabase.from("members").delete().eq("id", member.id);

  if (!member.parent_email) return;
  const { data: profiles, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id")
    .ilike("email", member.parent_email);
  if (profileError) throw new Error(profileError.message);
  const profileIds = (profiles ?? []).map((profile) => profile.id);
  if (profileIds.length > 0) {
    await supabase.from("students").delete().in("parent_id", profileIds);
    await supabase.from("customer_profiles").delete().in("id", profileIds);
  }
}

async function createTestReservation(entitlement: CustomerEntitlement): Promise<void> {
  const { error: templateError } = await supabase.from("slot_templates").insert({
    id: TEST_SLOT_TEMPLATE_ID,
    tenant_id: TENANT_ID,
    name: "Runtime Contract Training",
    slot_type: "TRAINING",
    default_capacity: 10,
    default_start_time: "16:00",
    default_end_time: "17:00",
    default_credit_cost: 1,
    bookable_program_id: TRAINING_PROGRAM_ID,
  });
  if (templateError) throw new Error(templateError.message);

  const { error: slotError } = await supabase.from("schedule_slots").insert({
    id: TEST_SLOT_ID,
    tenant_id: TENANT_ID,
    name: "Runtime Contract Training",
    slot_type: "TRAINING",
    capacity: 10,
    credit_cost: 1,
    start_time: "2026-07-02T20:00:00.000Z",
    end_time: "2026-07-02T21:00:00.000Z",
    slot_template_id: TEST_SLOT_TEMPLATE_ID,
    bookable_program_id: TRAINING_PROGRAM_ID,
  });
  if (slotError) throw new Error(slotError.message);

  const { error: reservationError } = await supabase.from("reservations").insert({
    id: TEST_RESERVATION_ID,
    tenant_id: TENANT_ID,
    slot_id: TEST_SLOT_ID,
    membership_id: entitlement.academy_membership_id,
    student_id: entitlement.student_id,
    status: "CONFIRMED",
  });
  if (reservationError) throw new Error(reservationError.message);
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countCustomerProfilesByEmailInsensitive(email: string): Promise<number> {
  const { count, error } = await supabase
    .from("customer_profiles")
    .select("id", { count: "exact", head: true })
    .ilike("email", email);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countLedgerRows(filters: { source?: string; sourceRef: string }): Promise<number> {
  let query = supabase
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID)
    .eq("source_ref", filters.sourceRef);
  if (filters.source) query = query.eq("source", filters.source);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function updateTestMemberStatus(status: RuntimeMember["status"]): Promise<void> {
  const { error } = await supabase.from("members").update({ status }).eq("id", TEST_MEMBER_ID);
  if (error) throw new Error(error.message);
}

async function entitlementStatus(entitlementId: string): Promise<CustomerEntitlement["status"]> {
  const { data, error } = await supabase
    .from("customer_entitlements")
    .select("status")
    .eq("id", entitlementId)
    .single();
  if (error) throw new Error(error.message);
  return data.status;
}

async function membershipStatus(membershipId: string): Promise<AcademyMembership["status"]> {
  const { data, error } = await supabase.from("academy_memberships").select("status").eq("id", membershipId).single();
  if (error) throw new Error(error.message);
  return data.status;
}

function assertLocalSupabase(): void {
  if (!runtimeTestSupabaseUrl.includes("127.0.0.1") && process.env.ALLOW_REMOTE_RUNTIME_TESTS !== "1") {
    throw new Error("Runtime contract tests only run against local Supabase by default.");
  }
}
