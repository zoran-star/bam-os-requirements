import { withSentryApiRoute } from "../_sentry.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import { HttpError, sendError } from "./_errors.js";
import { getStaffContext } from "./_staff-context.js";
import type { HeaderValue, RuntimeApiRequest, RuntimeApiResponse } from "./_types.js";

const SCAN_LIMIT = 10_000;
const SAMPLE_LIMIT = 10;

type DiagnosticStatus = "ok" | "fail" | "error";

type DiagnosticCheck = {
  key: string;
  label: string;
  status: DiagnosticStatus;
  count: number;
  sample: string[];
  message?: string;
};

type IdRow = {
  id: string;
};

type EntitlementTemplatePriceRow = {
  offer_price_id: string;
};

type MemberDiagnosticRow = IdRow & {
  stripe_price_id: string | null;
};

type MemberLinkRow = {
  member_id: string;
  student_id: string;
};

type AcademyMembershipRow = IdRow & {
  student_id: string | null;
};

type CustomerEntitlementRow = IdRow & {
  academy_membership_id: string;
  source_entitlement_template_id: string | null;
  config: unknown;
};

type CreditLedgerEntitlementRow = {
  customer_entitlement_id: string;
};

type PricingCatalogRow = IdRow & {
  stripe_price_id: string;
};

type RuntimePriceCatalogLinkRow = {
  source_pricing_catalog_id: string | null;
};

type EntitlementTemplateConfigRow = IdRow & {
  config: unknown;
};

type CustomerProfileEmailRow = IdRow & {
  email: string | null;
};

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    await getStaffContext(req);

    const clientId = queryValue(req.query?.client_id);
    if (!clientId) throw new HttpError(400, "client_id required");

    const checks = await runDiagnostics(clientId);
    return res.status(200).json({ checks });
  } catch (error) {
    return sendError(res, error);
  }
}

async function runDiagnostics(clientId: string): Promise<DiagnosticCheck[]> {
  return Promise.all([
    runCheck(
      "active_price_no_template",
      "Active routable prices without an active entitlement template",
      () => activePriceNoTemplate(clientId),
    ),
    runCheck(
      "active_stripe_price_no_catalog_link",
      "Active Stripe prices without a runtime catalog link",
      () => activeStripePriceNoCatalogLink(clientId),
    ),
    runCheck(
      "live_member_no_active_entitlement",
      "Live members without an active entitlement",
      () => liveMemberNoActiveEntitlement(clientId),
    ),
    runCheck(
      "active_entitlement_no_member_link",
      "Active entitlements whose student has no member link",
      () => activeEntitlementNoMemberLink(clientId),
    ),
    runCheck(
      "credit_entitlement_no_current_grant",
      "Active weekly-credit entitlements without a grant",
      () => creditEntitlementNoCurrentGrant(clientId),
    ),
    runCheck(
      "live_member_price_unmapped_to_runtime",
      "Live member Stripe prices mapped to catalog rows missing runtime prices",
      () => liveMemberPriceUnmappedToRuntime(clientId),
    ),
    runCheck(
      "entitlement_config_drift",
      "Active entitlement config drift from source template",
      () => entitlementConfigDrift(clientId),
    ),
    runCheck(
      "duplicate_identity_emails",
      "Duplicate identity emails",
      () => duplicateIdentityEmails(),
    ),
    runCheck(
      "entry_point_program_drift",
      "Booking entry points without a valid bookable program link",
      () => entryPointProgramDrift(clientId),
    ),
  ]);
}

async function runCheck(
  key: string,
  label: string,
  fn: () => Promise<string[] | { count: number; sample: string[] }>,
): Promise<DiagnosticCheck> {
  try {
    const result = await fn();
    if (Array.isArray(result)) {
      return checkFromIds(key, label, result);
    }
    return {
      key,
      label,
      status: result.count > 0 ? "fail" : "ok",
      count: result.count,
      sample: result.sample.slice(0, SAMPLE_LIMIT),
    };
  } catch (error) {
    return {
      key,
      label,
      status: "error",
      count: 0,
      sample: [],
      message: errorMessage(error),
    };
  }
}

// Offer tie-in step G: the funnel's booking surfaces (calendar entry points +
// enabled booking forms with a program link) must point at a REAL bookable
// program of this academy, or the funnel and the trial APIs drift apart.
// Fails on: (a) a bookable_program_id that doesn't exist for this tenant,
// (b) an enabled calendar-type entry point with no program link at all.
async function entryPointProgramDrift(clientId: string): Promise<string[]> {
  const supabase = createRuntimeSupabaseClient();
  const { data: epData, error: epError } = await supabase
    .from("entry_points")
    .select("id, type, enabled, bookable_program_id")
    .eq("client_id", clientId)
    .range(0, SCAN_LIMIT - 1);
  if (epError) throw new Error(epError.message);
  const entryPoints = rows<{ id: string; type: string | null; enabled: boolean | null; bookable_program_id: string | null }>(epData);

  const { data: programData, error: programError } = await supabase
    .from("bookable_programs")
    .select("id")
    .eq("tenant_id", clientId)
    .range(0, SCAN_LIMIT - 1);
  if (programError) throw new Error(programError.message);
  const programIds = new Set(rows<IdRow>(programData).map((program) => program.id));

  return entryPoints
    .filter((ep) =>
      ep.bookable_program_id
        ? !programIds.has(ep.bookable_program_id)
        : ep.enabled === true && ep.type === "calendar",
    )
    .map((ep) => ep.id);
}

async function activePriceNoTemplate(clientId: string): Promise<string[]> {
  const supabase = createRuntimeSupabaseClient();
  const { data: priceData, error: priceError } = await supabase
    .from("offer_prices")
    .select("id")
    .eq("tenant_id", clientId)
    .eq("is_active", true)
    .eq("is_routable", true)
    .range(0, SCAN_LIMIT - 1);
  if (priceError) throw new Error(priceError.message);

  const prices = rows<IdRow>(priceData);
  const priceIds = prices.map((price) => price.id);
  if (priceIds.length === 0) return [];

  const { data: templateData, error: templateError } = await supabase
    .from("entitlement_templates")
    .select("offer_price_id")
    .eq("tenant_id", clientId)
    .eq("status", "ACTIVE")
    .in("offer_price_id", priceIds)
    .range(0, SCAN_LIMIT - 1);
  if (templateError) throw new Error(templateError.message);

  const templatedPriceIds = new Set(rows<EntitlementTemplatePriceRow>(templateData).map((template) => template.offer_price_id));
  return priceIds.filter((priceId) => !templatedPriceIds.has(priceId));
}

async function activeStripePriceNoCatalogLink(clientId: string): Promise<{ count: number; sample: string[] }> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error, count } = await supabase
    .from("offer_prices")
    .select("id", { count: "exact" })
    .eq("tenant_id", clientId)
    .eq("is_active", true)
    .not("stripe_price_id", "is", null)
    .is("source_pricing_catalog_id", null)
    .limit(SAMPLE_LIMIT);
  if (error) throw new Error(error.message);

  return {
    count: count ?? rows<IdRow>(data).length,
    sample: rows<IdRow>(data).map((row) => row.id),
  };
}

async function liveMemberNoActiveEntitlement(clientId: string): Promise<string[]> {
  const supabase = createRuntimeSupabaseClient();
  const { data: memberData, error: memberError } = await supabase
    .from("members")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "live")
    .range(0, SCAN_LIMIT - 1);
  if (memberError) throw new Error(memberError.message);

  const memberIds = rows<IdRow>(memberData).map((member) => member.id);
  if (memberIds.length === 0) return [];

  const { data: linkData, error: linkError } = await supabase
    .from("member_links")
    .select("member_id,student_id")
    .in("member_id", memberIds)
    .range(0, SCAN_LIMIT - 1);
  if (linkError) throw new Error(linkError.message);

  const links = rows<MemberLinkRow>(linkData);
  const studentIds = unique(links.map((link) => link.student_id));
  const memberships = await membershipsForStudents(clientId, studentIds);
  const activeEntitlementMembershipIds = await activeEntitlementMemberships(
    clientId,
    memberships.map((membership) => membership.id),
  );
  const membershipByStudent = mapByStudent(memberships);
  const linkByMember = new Map(links.map((link) => [link.member_id, link]));

  return memberIds.filter((memberId) => {
    const link = linkByMember.get(memberId);
    if (!link) return true;
    const membership = membershipByStudent.get(link.student_id);
    if (!membership) return true;
    return !activeEntitlementMembershipIds.has(membership.id);
  });
}

async function activeEntitlementNoMemberLink(clientId: string): Promise<string[]> {
  const supabase = createRuntimeSupabaseClient();
  const { data: entitlementData, error: entitlementError } = await supabase
    .from("customer_entitlements")
    .select("id,academy_membership_id")
    .eq("tenant_id", clientId)
    .eq("status", "ACTIVE")
    .range(0, SCAN_LIMIT - 1);
  if (entitlementError) throw new Error(entitlementError.message);

  const entitlements = rows<CustomerEntitlementRow>(entitlementData);
  const membershipIds = unique(entitlements.map((entitlement) => entitlement.academy_membership_id));
  if (membershipIds.length === 0) return [];

  const memberships = await membershipsByIds(clientId, membershipIds);
  const studentIds = unique(memberships.map((membership) => membership.student_id).filter(isString));
  const linkedStudentIds = await memberLinkedStudentIds(studentIds);
  const membershipById = new Map(memberships.map((membership) => [membership.id, membership]));

  return entitlements
    .filter((entitlement) => {
      const membership = membershipById.get(entitlement.academy_membership_id);
      return !membership?.student_id || !linkedStudentIds.has(membership.student_id);
    })
    .map((entitlement) => entitlement.id);
}

async function creditEntitlementNoCurrentGrant(clientId: string): Promise<string[]> {
  const supabase = createRuntimeSupabaseClient();
  const { data: entitlementData, error: entitlementError } = await supabase
    .from("customer_entitlements")
    .select("id")
    .eq("tenant_id", clientId)
    .eq("status", "ACTIVE")
    .eq("entitlement_kind", "WEEKLY_CREDITS")
    .range(0, SCAN_LIMIT - 1);
  if (entitlementError) throw new Error(entitlementError.message);

  const entitlementIds = rows<IdRow>(entitlementData).map((entitlement) => entitlement.id);
  if (entitlementIds.length === 0) return [];

  const { data: ledgerData, error: ledgerError } = await supabase
    .from("credit_ledger")
    .select("customer_entitlement_id")
    .eq("tenant_id", clientId)
    .eq("entry_type", "GRANT")
    .in("customer_entitlement_id", entitlementIds)
    .range(0, SCAN_LIMIT - 1);
  if (ledgerError) throw new Error(ledgerError.message);

  const grantedEntitlementIds = new Set(
    rows<CreditLedgerEntitlementRow>(ledgerData).map((entry) => entry.customer_entitlement_id),
  );
  return entitlementIds.filter((entitlementId) => !grantedEntitlementIds.has(entitlementId));
}

async function liveMemberPriceUnmappedToRuntime(clientId: string): Promise<string[]> {
  const supabase = createRuntimeSupabaseClient();
  const { data: memberData, error: memberError } = await supabase
    .from("members")
    .select("id,stripe_price_id")
    .eq("client_id", clientId)
    .eq("status", "live")
    .not("stripe_price_id", "is", null)
    .range(0, SCAN_LIMIT - 1);
  if (memberError) throw new Error(memberError.message);

  const members = rows<MemberDiagnosticRow>(memberData);
  const stripePriceIds = unique(members.map((member) => member.stripe_price_id).filter(isString));
  if (stripePriceIds.length === 0) return [];

  const { data: catalogData, error: catalogError } = await supabase
    .from("pricing_catalog")
    .select("id,stripe_price_id")
    .eq("client_id", clientId)
    .in("stripe_price_id", stripePriceIds)
    .range(0, SCAN_LIMIT - 1);
  if (catalogError) throw new Error(catalogError.message);

  const catalogRows = rows<PricingCatalogRow>(catalogData);
  const catalogIds = catalogRows.map((row) => row.id);
  if (catalogIds.length === 0) return [];

  const { data: runtimePriceData, error: runtimePriceError } = await supabase
    .from("offer_prices")
    .select("source_pricing_catalog_id")
    .eq("tenant_id", clientId)
    .in("source_pricing_catalog_id", catalogIds)
    .range(0, SCAN_LIMIT - 1);
  if (runtimePriceError) throw new Error(runtimePriceError.message);

  const mappedCatalogIds = new Set(
    rows<RuntimePriceCatalogLinkRow>(runtimePriceData)
      .map((price) => price.source_pricing_catalog_id)
      .filter(isString),
  );
  const catalogByStripePrice = new Map(catalogRows.map((row) => [row.stripe_price_id, row]));

  return members
    .filter((member) => {
      if (!member.stripe_price_id) return false;
      const catalog = catalogByStripePrice.get(member.stripe_price_id);
      return Boolean(catalog && !mappedCatalogIds.has(catalog.id));
    })
    .map((member) => member.id);
}

async function entitlementConfigDrift(clientId: string): Promise<string[]> {
  const supabase = createRuntimeSupabaseClient();
  const { data: entitlementData, error: entitlementError } = await supabase
    .from("customer_entitlements")
    .select("id,academy_membership_id,source_entitlement_template_id,config")
    .eq("tenant_id", clientId)
    .eq("status", "ACTIVE")
    .not("source_entitlement_template_id", "is", null)
    .range(0, SCAN_LIMIT - 1);
  if (entitlementError) throw new Error(entitlementError.message);

  const entitlements = rows<CustomerEntitlementRow>(entitlementData);
  const templateIds = unique(entitlements.map((entitlement) => entitlement.source_entitlement_template_id).filter(isString));
  if (templateIds.length === 0) return [];

  const { data: templateData, error: templateError } = await supabase
    .from("entitlement_templates")
    .select("id,config")
    .eq("tenant_id", clientId)
    .in("id", templateIds)
    .range(0, SCAN_LIMIT - 1);
  if (templateError) throw new Error(templateError.message);

  const templatesById = new Map(rows<EntitlementTemplateConfigRow>(templateData).map((template) => [template.id, template]));
  return entitlements
    .filter((entitlement) => {
      if (!entitlement.source_entitlement_template_id) return false;
      const template = templatesById.get(entitlement.source_entitlement_template_id);
      return !template || stableJson(entitlement.config) !== stableJson(template.config);
    })
    .map((entitlement) => entitlement.id);
}

async function duplicateIdentityEmails(): Promise<{ count: number; sample: string[] }> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("customer_profiles")
    .select("id,email")
    .range(0, SCAN_LIMIT - 1);
  if (error) throw new Error(error.message);

  const profiles = rows<CustomerProfileEmailRow>(data);
  const idsByEmail = new Map<string, string[]>();
  for (const profile of profiles) {
    const normalized = profile.email?.trim().toLowerCase();
    if (!normalized) continue;
    const group = idsByEmail.get(normalized) ?? [];
    group.push(profile.id);
    idsByEmail.set(normalized, group);
  }

  const duplicateIds = [...idsByEmail.values()]
    .filter((ids) => ids.length > 1)
    .flat();

  return {
    count: duplicateIds.length,
    sample: duplicateIds.slice(0, SAMPLE_LIMIT),
  };
}

async function membershipsForStudents(clientId: string, studentIds: string[]): Promise<AcademyMembershipRow[]> {
  if (studentIds.length === 0) return [];

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("academy_memberships")
    .select("id,student_id")
    .eq("academy_id", clientId)
    .in("student_id", studentIds)
    .range(0, SCAN_LIMIT - 1);
  if (error) throw new Error(error.message);

  return rows<AcademyMembershipRow>(data);
}

async function membershipsByIds(clientId: string, membershipIds: string[]): Promise<AcademyMembershipRow[]> {
  if (membershipIds.length === 0) return [];

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("academy_memberships")
    .select("id,student_id")
    .eq("academy_id", clientId)
    .in("id", membershipIds)
    .range(0, SCAN_LIMIT - 1);
  if (error) throw new Error(error.message);

  return rows<AcademyMembershipRow>(data);
}

async function activeEntitlementMemberships(clientId: string, membershipIds: string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("customer_entitlements")
    .select("academy_membership_id")
    .eq("tenant_id", clientId)
    .eq("status", "ACTIVE")
    .in("academy_membership_id", membershipIds)
    .range(0, SCAN_LIMIT - 1);
  if (error) throw new Error(error.message);

  return new Set(
    rows<{ academy_membership_id: string }>(data).map((entitlement) => entitlement.academy_membership_id),
  );
}

async function memberLinkedStudentIds(studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("member_links")
    .select("student_id")
    .in("student_id", studentIds)
    .range(0, SCAN_LIMIT - 1);
  if (error) throw new Error(error.message);

  return new Set(rows<{ student_id: string }>(data).map((link) => link.student_id));
}

function mapByStudent(memberships: AcademyMembershipRow[]): Map<string, AcademyMembershipRow> {
  const byStudent = new Map<string, AcademyMembershipRow>();
  for (const membership of memberships) {
    if (membership.student_id) byStudent.set(membership.student_id, membership);
  }
  return byStudent;
}

function checkFromIds(key: string, label: string, ids: string[]): DiagnosticCheck {
  return {
    key,
    label,
    status: ids.length > 0 ? "fail" : "ok",
    count: ids.length,
    sample: ids.slice(0, SAMPLE_LIMIT),
  };
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "diagnostic check failed";
}

function queryValue(value: HeaderValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default withSentryApiRoute(handler);
