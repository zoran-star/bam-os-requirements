import { assertRows } from "./supabase.js";
import type {
  AcademyMembership,
  CustomerEntitlement,
  EntitlementTemplate,
  JsonObject,
  MemberLink,
  OfferPrice,
  RuntimeMember,
  RuntimeSupabaseClient,
  Student,
} from "./types.js";

export type InvoiceGrantInput = {
  tenantId: string;
  subscriptionId: string;
  invoiceId: string;
  lines: Array<{
    lineId: string;
    stripePriceId: string;
    periodStart: string;
    periodEnd: string;
  }>;
};

export type InvoiceGrantSkipReason =
  | "no_runtime_price"
  | "not_credit_plan"
  | "no_member"
  | "no_spine"
  | "no_entitlement"
  | "no_amount_rule";

export type InvoiceGrantAppliedLine = {
  lineId: string;
  invoiceId: string;
  sourceRef: string;
  offerPriceId: string;
  entitlementTemplateId: string;
  customerEntitlementId: string;
  academyMembershipId: string;
  granted: boolean;
  expiredCredits: number;
  balance: number;
};

export type InvoiceGrantSkippedLine = {
  lineId: string;
  reason: InvoiceGrantSkipReason;
};

export type InvoiceGrantResult = {
  granted: InvoiceGrantAppliedLine[];
  skipped: InvoiceGrantSkippedLine[];
};

export type LapsedCreditSweepResult = {
  entitlementId: string;
  expiredCredits: number;
};

type CreditGrantResolution = {
  member: RuntimeMember;
  membership: AcademyMembership;
  offerPrice: OfferPrice;
  template: EntitlementTemplate;
  entitlement: CustomerEntitlement;
};

type StripeCreditGrantRpcRow = {
  granted: boolean | null;
  expired_credits: number | string | null;
  balance: number | string | null;
};

type LapsedCreditSweepRpcRow = {
  entitlement_id: string;
  expired_credits: number | string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

export async function applyInvoiceCreditGrants(
  supabase: RuntimeSupabaseClient,
  invoice: InvoiceGrantInput,
): Promise<InvoiceGrantResult> {
  const granted: InvoiceGrantAppliedLine[] = [];
  const skipped: InvoiceGrantSkippedLine[] = [];

  for (const line of invoice.lines) {
    const resolution = await resolveCreditGrantLine(supabase, invoice, line);
    if (!resolution) {
      skipped.push({ lineId: line.lineId, reason: "no_runtime_price" });
      continue;
    }
    if ("reason" in resolution) {
      skipped.push({ lineId: line.lineId, reason: resolution.reason });
      continue;
    }

    const amount = invoiceGrantAmount(resolution.template, resolution.entitlement, line);
    if (!amount) {
      skipped.push({ lineId: line.lineId, reason: "no_amount_rule" });
      continue;
    }

    const rollover = creditRollover(resolution.template, resolution.entitlement);
    const sourceRef = `invoice_line:${line.lineId}`;
    const { data, error } = await supabase.rpc("apply_stripe_credit_grant", {
      p_tenant_id: invoice.tenantId,
      p_customer_entitlement_id: resolution.entitlement.id,
      p_source_ref: sourceRef,
      p_amount: amount,
      p_period_start: line.periodStart,
      p_period_end: line.periodEnd,
      p_rollover: rollover,
    });
    if (error) throw new Error(error.message);

    const rpcRow = singleRpcRow<StripeCreditGrantRpcRow>(data, "apply_stripe_credit_grant");
    granted.push({
      lineId: line.lineId,
      invoiceId: invoice.invoiceId,
      sourceRef,
      offerPriceId: resolution.offerPrice.id,
      entitlementTemplateId: resolution.template.id,
      customerEntitlementId: resolution.entitlement.id,
      academyMembershipId: resolution.membership.id,
      granted: Boolean(rpcRow.granted),
      expiredCredits: numericResult(rpcRow.expired_credits),
      balance: numericResult(rpcRow.balance),
    });
  }

  return { granted, skipped };
}

export async function sweepLapsedCreditEntitlements(
  supabase: RuntimeSupabaseClient,
  tenantId?: string,
): Promise<LapsedCreditSweepResult[]> {
  const { data, error } = await supabase.rpc("expire_lapsed_credit_entitlements", {
    p_tenant_id: tenantId ?? null,
  });
  if (error) throw new Error(error.message);

  return assertRows<LapsedCreditSweepRpcRow>(data, null).map((row) => ({
    entitlementId: row.entitlement_id,
    expiredCredits: numericResult(row.expired_credits),
  }));
}

async function resolveCreditGrantLine(
  supabase: RuntimeSupabaseClient,
  invoice: InvoiceGrantInput,
  line: InvoiceGrantInput["lines"][number],
): Promise<CreditGrantResolution | { reason: InvoiceGrantSkipReason } | null> {
  const offerPrice = await findOfferPriceByStripePrice(supabase, invoice.tenantId, line.stripePriceId);
  if (!offerPrice) return null;

  const template = await findActiveEntitlementTemplate(supabase, invoice.tenantId, offerPrice.id);
  if (!template || !isCreditBearingTemplate(template)) return { reason: "not_credit_plan" };

  const member = await findMemberBySubscription(supabase, invoice.tenantId, invoice.subscriptionId);
  if (!member) return { reason: "no_member" };

  const spine = await findExistingSpineForMember(supabase, invoice.tenantId, member.id);
  if (!spine) return { reason: "no_spine" };

  const entitlement = await findActiveCreditEntitlement(supabase, {
    tenantId: invoice.tenantId,
    membershipId: spine.membership.id,
    offerPriceId: offerPrice.id,
  });
  if (!entitlement) return { reason: "no_entitlement" };

  return {
    member,
    membership: spine.membership,
    offerPrice,
    template,
    entitlement,
  };
}

async function findOfferPriceByStripePrice(
  supabase: RuntimeSupabaseClient,
  tenantId: string,
  stripePriceId: string,
): Promise<OfferPrice | null> {
  const { data, error } = await supabase
    .from("offer_prices")
    .select(offerPriceSelect)
    .eq("tenant_id", tenantId)
    .eq("stripe_price_id", stripePriceId)
    .limit(1);

  return assertRows<OfferPrice>(data, error)[0] ?? null;
}

async function findActiveEntitlementTemplate(
  supabase: RuntimeSupabaseClient,
  tenantId: string,
  offerPriceId: string,
): Promise<EntitlementTemplate | null> {
  const { data, error } = await supabase
    .from("entitlement_templates")
    .select(entitlementTemplateSelect)
    .eq("tenant_id", tenantId)
    .eq("offer_price_id", offerPriceId)
    .eq("status", "ACTIVE")
    .limit(1);

  return assertRows<EntitlementTemplate>(data, error)[0] ?? null;
}

async function findMemberBySubscription(
  supabase: RuntimeSupabaseClient,
  tenantId: string,
  subscriptionId: string,
): Promise<RuntimeMember | null> {
  const { data, error } = await supabase
    .from("members")
    .select(memberSelect)
    .eq("client_id", tenantId)
    .eq("stripe_subscription_id", subscriptionId)
    .limit(2);
  const rows = assertRows<RuntimeMember>(data, error);
  return rows.length === 1 ? rows[0] ?? null : null;
}

async function findExistingSpineForMember(
  supabase: RuntimeSupabaseClient,
  tenantId: string,
  memberId: string,
): Promise<{ memberLink: MemberLink; student: Student; membership: AcademyMembership } | null> {
  const { data: linkData, error: linkError } = await supabase
    .from("member_links")
    .select(memberLinkSelect)
    .eq("member_id", memberId)
    .limit(1);
  const memberLink = assertRows<MemberLink>(linkData, linkError)[0];
  if (!memberLink) return null;

  const { data: studentData, error: studentError } = await supabase
    .from("students")
    .select(studentSelect)
    .eq("id", memberLink.student_id)
    .limit(1);
  const student = assertRows<Student>(studentData, studentError)[0];
  if (!student) return null;

  const { data: membershipData, error: membershipError } = await supabase
    .from("academy_memberships")
    .select(academyMembershipSelect)
    .eq("academy_id", tenantId)
    .eq("student_id", student.id)
    .limit(2);
  const memberships = assertRows<AcademyMembership>(membershipData, membershipError);
  const membership = memberships.length === 1 ? memberships[0] : null;
  if (!membership) return null;

  return { memberLink, student, membership };
}

async function findActiveCreditEntitlement(
  supabase: RuntimeSupabaseClient,
  args: { tenantId: string; membershipId: string; offerPriceId: string },
): Promise<CustomerEntitlement | null> {
  const { data: exactData, error: exactError } = await supabase
    .from("customer_entitlements")
    .select(customerEntitlementSelect)
    .eq("tenant_id", args.tenantId)
    .eq("academy_membership_id", args.membershipId)
    .eq("source_offer_price_id", args.offerPriceId)
    .eq("status", "ACTIVE")
    .limit(2);
  const exact = assertRows<CustomerEntitlement>(exactData, exactError).filter(isCreditBearingEntitlement);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;

  const { data: fallbackData, error: fallbackError } = await supabase
    .from("customer_entitlements")
    .select(customerEntitlementSelect)
    .eq("tenant_id", args.tenantId)
    .eq("academy_membership_id", args.membershipId)
    .eq("status", "ACTIVE")
    .limit(10);
  const fallback = assertRows<CustomerEntitlement>(fallbackData, fallbackError).filter(isCreditBearingEntitlement);
  return fallback.length === 1 ? fallback[0] ?? null : null;
}

function isCreditBearingTemplate(template: EntitlementTemplate): boolean {
  return template.entitlement_kind === "WEEKLY_CREDITS" || Boolean(template.credits_per_period);
}

function isCreditBearingEntitlement(entitlement: CustomerEntitlement): boolean {
  return (
    entitlement.entitlement_kind === "WEEKLY_CREDITS"
    || positiveIntegerConfig(entitlement.config, "credits_per_period") !== null
    || positiveIntegerConfig(entitlement.config, "invoice_grant_credits") !== null
  );
}

function invoiceGrantAmount(
  template: EntitlementTemplate,
  entitlement: CustomerEntitlement,
  line: InvoiceGrantInput["lines"][number],
): number | null {
  const configuredAmount =
    positiveIntegerConfig(entitlement.config, "invoice_grant_credits")
    ?? positiveIntegerConfig(template.config, "invoice_grant_credits");
  if (configuredAmount !== null) return configuredAmount;

  const creditsPerPeriod =
    positiveInteger(template.credits_per_period)
    ?? positiveIntegerConfig(entitlement.config, "credits_per_period");
  const creditPeriod = template.credit_period ?? stringConfig(entitlement.config, "credit_period");
  if (creditPeriod !== "WEEK" || creditsPerPeriod === null) return null;

  const weeks = roundedWeeks(line.periodStart, line.periodEnd);
  if (!weeks) return null;
  return creditsPerPeriod * weeks;
}

function creditRollover(template: EntitlementTemplate, entitlement: CustomerEntitlement): "EXPIRE" | "CARRY_OVER" {
  return (
    rolloverConfig(entitlement.config, "credit_rollover")
    ?? rolloverConfig(template.config, "credit_rollover")
    ?? "EXPIRE"
  );
}

function roundedWeeks(periodStart: string, periodEnd: string): number | null {
  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  const weeks = Math.round((endMs - startMs) / (MS_PER_DAY * DAYS_PER_WEEK));
  return weeks > 0 ? weeks : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function positiveIntegerConfig(config: JsonObject, key: string): number | null {
  return positiveInteger(jsonRecord(config)[key]);
}

function stringConfig(config: JsonObject, key: string): string | null {
  const value = jsonRecord(config)[key];
  return typeof value === "string" ? value : null;
}

function rolloverConfig(config: JsonObject, key: string): "EXPIRE" | "CARRY_OVER" | null {
  const value = stringConfig(config, key);
  return value === "EXPIRE" || value === "CARRY_OVER" ? value : null;
}

function jsonRecord(config: JsonObject): JsonObject {
  return config && typeof config === "object" && !Array.isArray(config) ? config : {};
}

function singleRpcRow<T>(data: unknown, rpcName: string): T {
  if (Array.isArray(data)) {
    const row = data[0];
    if (row) return row as T;
  } else if (data && typeof data === "object") {
    return data as T;
  }

  throw new Error(`${rpcName} returned no rows.`);
}

function numericResult(value: number | string | null): number {
  return Number(value ?? 0);
}

const memberSelect = [
  "id",
  "client_id",
  "athlete_name",
  "parent_name",
  "parent_email",
  "parent_phone",
  "status",
  "stripe_customer_id",
  "stripe_subscription_id",
  "stripe_price_id",
  "ghl_contact_id",
  "joined_date",
  "stripe_joined_at",
].join(",");

const memberLinkSelect = ["id", "student_id", "member_id", "matched_by", "confirmed_at"].join(",");

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

const offerPriceSelect = [
  "id",
  "tenant_id",
  "offer_option_id",
  "title",
  "amount_cents",
  "currency",
  "billing_interval",
  "stripe_price_id",
  "stripe_product_id",
  "source_offer_id",
  "source_offer_price_key",
  "source_pricing_catalog_id",
  "is_active",
  "is_routable",
  "show_on_onboarding",
  "sort_order",
].join(",");

const entitlementTemplateSelect = [
  "id",
  "tenant_id",
  "offer_price_id",
  "bookable_program_id",
  "entitlement_kind",
  "scope_type",
  "credits_per_period",
  "credit_period",
  "is_unlimited",
  "credit_cost_policy",
  "config",
  "status",
].join(",");

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
