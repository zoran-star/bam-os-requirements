import { inList, sb } from "./_supabase.js";

type JsonObject = Record<string, unknown>;

type OfferOptionRow = {
  id: string;
  tenant_id: string;
  title: string;
  offer_type: OfferType;
  purchase_kind: PurchaseKind;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  description: string | null;
  source_offer_id: string | null;
  source_offer_option_key: string | null;
  source_offer_team_id: string | null;
  source_offer_team_key: string | null;
  sort_order: number;
};

type OfferPriceRow = {
  id: string;
  tenant_id: string;
  offer_option_id: string;
  title: string;
  amount_cents: number;
  currency: string;
  billing_interval: string | null;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  source_offer_id: string | null;
  source_offer_price_key: string | null;
  source_pricing_catalog_id: string | null;
  is_active: boolean;
  is_routable: boolean;
  sort_order: number;
};

type EntitlementTemplateRow = {
  id: string;
  tenant_id: string;
  offer_price_id: string;
  entitlement_kind: EntitlementKind;
  scope_type: EntitlementScopeType | null;
  credits_per_period: number | null;
  credit_period: CreditPeriod | null;
  is_unlimited: boolean;
  credit_cost_policy: CreditCostPolicy | null;
  config: JsonObject;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
};

type CustomerEntitlementRow = {
  id: string;
  tenant_id: string;
  academy_membership_id: string;
  customer_id: string | null;
  student_id: string | null;
  scope_type: EntitlementScopeType | null;
  scope_id: string | null;
  entitlement_kind: EntitlementKind;
  status: CustomerEntitlementStatus;
  valid_from: string;
  valid_until: string | null;
  source: "manual" | "seed" | "stripe" | "import" | "admin";
  source_offer_price_id: string | null;
  source_entitlement_template_id: string | null;
  source_ref: string | null;
  config: JsonObject;
};

type CreditLedgerRow = {
  customer_entitlement_id: string;
  entry_type: "GRANT" | "DEBIT" | "REFUND" | "EXPIRE" | "ADJUSTMENT";
  credit_delta: number;
  effective_at: string;
};

type OfferType = "TRAINING" | "TEAM" | "CAMP_CLINIC" | "LEAGUE" | "TOURNAMENT" | "GYM_RENTAL";
type PurchaseKind =
  | "MEMBERSHIP"
  | "CREDIT_PACK"
  | "EVENT_REGISTRATION"
  | "TEAM_REGISTRATION"
  | "RENTAL_BOOKING";
type EntitlementKind =
  | "WEEKLY_CREDITS"
  | "UNLIMITED_BOOKING"
  | "CREDIT_PACK"
  | "EVENT_REGISTRATION"
  | "TEAM_REGISTRATION"
  | "RENTAL_BOOKING";
type EntitlementScopeType = "STUDENT" | "CUSTOMER" | "TEAM" | "EVENT" | "LOCATION";
type CreditPeriod = "WEEK" | "FOUR_WEEKS" | "MONTH" | "TERM" | "NONE";
type CreditCostPolicy = "PER_SLOT_CREDIT_COST" | "ONE_CREDIT_PER_BOOKING" | "FREE";
type CustomerEntitlementStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED";

export type OfferOptionSummaryOut = Pick<
  OfferOptionRow,
  | "id"
  | "tenant_id"
  | "title"
  | "offer_type"
  | "purchase_kind"
  | "description"
  | "source_offer_id"
  | "source_offer_option_key"
>;

export type OfferPriceSummaryOut = Pick<
  OfferPriceRow,
  | "id"
  | "title"
  | "amount_cents"
  | "currency"
  | "billing_interval"
  | "stripe_price_id"
  | "stripe_product_id"
  | "source_offer_id"
  | "source_offer_price_key"
  | "source_pricing_catalog_id"
>;

export type EntitlementTemplateOut = Pick<
  EntitlementTemplateRow,
  | "id"
  | "entitlement_kind"
  | "scope_type"
  | "credits_per_period"
  | "credit_period"
  | "is_unlimited"
  | "credit_cost_policy"
  | "config"
  | "status"
>;

export type PurchaseOptionOut = OfferOptionSummaryOut & {
  prices: Array<
    OfferPriceSummaryOut & {
      entitlement_templates: EntitlementTemplateOut[];
    }
  >;
};

export type CreditSummaryOut = {
  is_unlimited: boolean;
  credits_remaining: number | null;
  credits_total: number | null;
  credits_per_period: number | null;
  credit_period: CreditPeriod | null;
  credit_cost_policy: CreditCostPolicy | null;
};

export type MembershipCreditSummaryOut = CreditSummaryOut & {
  active_entitlement_count: number;
  entitlement_label: string | null;
};

export type CustomerEntitlementOut = Omit<
  CustomerEntitlementRow,
  "source_offer_price_id" | "source_entitlement_template_id"
> & {
  source_offer_price_id: string | null;
  source_entitlement_template_id: string | null;
  offer: OfferOptionSummaryOut | null;
  price: OfferPriceSummaryOut | null;
  template: EntitlementTemplateOut | null;
  credit_summary: CreditSummaryOut;
};

export type EntitledMembership<TMembership> = TMembership & {
  entitlements: CustomerEntitlementOut[];
  credit_summary: MembershipCreditSummaryOut;
};

export async function listPurchaseOptions(academyIds: string[]): Promise<PurchaseOptionOut[]> {
  if (academyIds.length === 0) return [];

  const options = await getOfferOptions(academyIds);
  if (options.length === 0) return [];

  const prices = await getOfferPricesForOptions(options.map((option) => option.id));
  const templates = await getEntitlementTemplatesForPrices(prices.map((price) => price.id));
  const templatesByPrice = groupBy(templates, (template) => template.offer_price_id);
  const pricesByOption = groupBy(prices, (price) => price.offer_option_id);

  return options.map((option) => ({
    ...toOfferOptionSummary(option),
    prices: (pricesByOption.get(option.id) || []).map((price) => ({
      ...toOfferPriceSummary(price),
      entitlement_templates: (templatesByPrice.get(price.id) || []).map(toTemplateOut),
    })),
  }));
}

export async function decorateMembershipsWithEntitlements<TMembership extends { id: string }>(
  memberships: TMembership[],
): Promise<Array<EntitledMembership<TMembership>>> {
  const entitlements = await listEntitlementsForMembershipIds(
    memberships.map((membership) => membership.id),
  );
  const byMembership = groupBy(entitlements, (entitlement) => entitlement.academy_membership_id);

  return memberships.map((membership) => {
    const membershipEntitlements = byMembership.get(membership.id) || [];
    return {
      ...membership,
      entitlements: membershipEntitlements,
      credit_summary: summarizeMembershipCredits(membershipEntitlements),
    };
  });
}

export async function listEntitlementsForMembershipIds(
  membershipIds: string[],
): Promise<CustomerEntitlementOut[]> {
  if (membershipIds.length === 0) return [];

  const rows = await sb<CustomerEntitlementRow[]>(
    `customer_entitlements?academy_membership_id=in.(${inList(membershipIds)})` +
      "&select=id,tenant_id,academy_membership_id,customer_id,student_id,scope_type,scope_id,entitlement_kind,status,valid_from,valid_until,source,source_offer_price_id,source_entitlement_template_id,source_ref,config" +
      "&order=valid_from.desc" +
      "&limit=500",
  );
  const entitlements = Array.isArray(rows) ? rows : [];
  if (entitlements.length === 0) return [];

  const priceIds = uniqueStrings(entitlements.map((row) => row.source_offer_price_id));
  const templateIds = uniqueStrings(entitlements.map((row) => row.source_entitlement_template_id));
  const ledgerRows = await getCreditLedgerRows(entitlements.map((row) => row.id));
  const prices = await getOfferPricesById(priceIds);
  const templates = await getEntitlementTemplatesById(templateIds);
  const options = await getOfferOptionsById(uniqueStrings([...prices.values()].map((row) => row.offer_option_id)));
  const ledgerByEntitlement = groupBy(ledgerRows, (row) => row.customer_entitlement_id);

  return entitlements.map((entitlement) => {
    const price = entitlement.source_offer_price_id
      ? prices.get(entitlement.source_offer_price_id) || null
      : null;
    const template = entitlement.source_entitlement_template_id
      ? templates.get(entitlement.source_entitlement_template_id) || null
      : null;
    const offer = price ? options.get(price.offer_option_id) || null : null;

    return {
      ...entitlement,
      offer: offer ? toOfferOptionSummary(offer) : null,
      price: price ? toOfferPriceSummary(price) : null,
      template: template ? toTemplateOut(template) : null,
      credit_summary: summarizeEntitlementCredits(
        entitlement,
        template,
        ledgerByEntitlement.get(entitlement.id) || [],
      ),
    };
  });
}

function summarizeMembershipCredits(entitlements: CustomerEntitlementOut[]): MembershipCreditSummaryOut {
  const active = entitlements.filter((entitlement) => entitlement.status === "ACTIVE");
  if (active.length === 0) {
    return emptyMembershipCreditSummary();
  }

  const unlimited = active.find((entitlement) => entitlement.credit_summary.is_unlimited);
  if (unlimited) {
    return {
      ...unlimited.credit_summary,
      active_entitlement_count: active.length,
      entitlement_label: labelForEntitlement(unlimited),
    };
  }

  const creditBearing = active.filter(
    (entitlement) => entitlement.credit_summary.credits_remaining !== null,
  );
  if (creditBearing.length === 0) {
    return {
      ...emptyCreditSummary(),
      active_entitlement_count: active.length,
      entitlement_label: labelForEntitlement(active[0]),
    };
  }

  return {
    is_unlimited: false,
    credits_remaining: sumNumbers(
      creditBearing.map((entitlement) => entitlement.credit_summary.credits_remaining),
    ),
    credits_total: sumNumbers(
      creditBearing.map((entitlement) => entitlement.credit_summary.credits_total),
    ),
    credits_per_period: sumNumbers(
      creditBearing.map((entitlement) => entitlement.credit_summary.credits_per_period),
    ),
    credit_period: creditBearing[0]?.credit_summary.credit_period ?? null,
    credit_cost_policy: creditBearing[0]?.credit_summary.credit_cost_policy ?? null,
    active_entitlement_count: active.length,
    entitlement_label: labelForEntitlement(creditBearing[0]),
  };
}

function summarizeEntitlementCredits(
  entitlement: CustomerEntitlementRow,
  template: EntitlementTemplateRow | null,
  ledgerRows: CreditLedgerRow[],
): CreditSummaryOut {
  const templateUnlimited = template?.is_unlimited ?? entitlement.config.is_unlimited === true;
  if (templateUnlimited || entitlement.entitlement_kind === "UNLIMITED_BOOKING") {
    return {
      is_unlimited: true,
      credits_remaining: null,
      credits_total: null,
      credits_per_period: template?.credits_per_period ?? configNumber(entitlement.config, "credits_per_period"),
      credit_period: template?.credit_period ?? configCreditPeriod(entitlement.config),
      credit_cost_policy: template?.credit_cost_policy ?? null,
    };
  }

  const balance = ledgerRows.reduce((total, row) => total + row.credit_delta, 0);
  const positiveCredits = ledgerRows.reduce(
    (total, row) => (row.credit_delta > 0 ? total + row.credit_delta : total),
    0,
  );
  const creditsPerPeriod =
    template?.credits_per_period ?? configNumber(entitlement.config, "credits_per_period");
  const creditsTotal = Math.max(positiveCredits, creditsPerPeriod ?? 0, balance);

  return {
    is_unlimited: false,
    credits_remaining: balance,
    credits_total: creditsTotal,
    credits_per_period: creditsPerPeriod,
    credit_period: template?.credit_period ?? configCreditPeriod(entitlement.config),
    credit_cost_policy: template?.credit_cost_policy ?? null,
  };
}

async function getOfferOptions(academyIds: string[]): Promise<OfferOptionRow[]> {
  const rows = await sb<OfferOptionRow[]>(
    `offer_options?tenant_id=in.(${inList(academyIds)})` +
      "&status=eq.ACTIVE" +
      `&select=${offerOptionSelect()}` +
      "&order=sort_order.asc" +
      "&limit=200",
  );
  return Array.isArray(rows) ? rows : [];
}

async function getOfferOptionsById(ids: string[]): Promise<Map<string, OfferOptionRow>> {
  if (ids.length === 0) return new Map();
  const rows = await sb<OfferOptionRow[]>(
    `offer_options?id=in.(${inList(ids)})` +
      `&select=${offerOptionSelect()}` +
      "&limit=200",
  );
  return mapById(Array.isArray(rows) ? rows : []);
}

async function getOfferPricesForOptions(optionIds: string[]): Promise<OfferPriceRow[]> {
  if (optionIds.length === 0) return [];
  const rows = await sb<OfferPriceRow[]>(
    `offer_prices?offer_option_id=in.(${inList(optionIds)})` +
      "&is_active=eq.true" +
      `&select=${offerPriceSelect()}` +
      "&order=sort_order.asc" +
      "&limit=300",
  );
  return Array.isArray(rows) ? rows : [];
}

async function getOfferPricesById(ids: string[]): Promise<Map<string, OfferPriceRow>> {
  if (ids.length === 0) return new Map();
  const rows = await sb<OfferPriceRow[]>(
    `offer_prices?id=in.(${inList(ids)})` +
      `&select=${offerPriceSelect()}` +
      "&limit=300",
  );
  return mapById(Array.isArray(rows) ? rows : []);
}

async function getEntitlementTemplatesForPrices(
  priceIds: string[],
): Promise<EntitlementTemplateRow[]> {
  if (priceIds.length === 0) return [];
  const rows = await sb<EntitlementTemplateRow[]>(
    `entitlement_templates?offer_price_id=in.(${inList(priceIds)})` +
      "&status=eq.ACTIVE" +
      `&select=${entitlementTemplateSelect()}` +
      "&limit=300",
  );
  return Array.isArray(rows) ? rows : [];
}

async function getEntitlementTemplatesById(
  ids: string[],
): Promise<Map<string, EntitlementTemplateRow>> {
  if (ids.length === 0) return new Map();
  const rows = await sb<EntitlementTemplateRow[]>(
    `entitlement_templates?id=in.(${inList(ids)})` +
      `&select=${entitlementTemplateSelect()}` +
      "&limit=300",
  );
  return mapById(Array.isArray(rows) ? rows : []);
}

async function getCreditLedgerRows(entitlementIds: string[]): Promise<CreditLedgerRow[]> {
  if (entitlementIds.length === 0) return [];
  const rows = await sb<CreditLedgerRow[]>(
    `credit_ledger?customer_entitlement_id=in.(${inList(entitlementIds)})` +
      "&select=customer_entitlement_id,entry_type,credit_delta,effective_at" +
      "&order=effective_at.asc" +
      "&limit=1000",
  );
  return Array.isArray(rows) ? rows : [];
}

function offerOptionSelect(): string {
  return [
    "id",
    "tenant_id",
    "title",
    "offer_type",
    "purchase_kind",
    "status",
    "description",
    "source_offer_id",
    "source_offer_option_key",
    "source_offer_team_id",
    "source_offer_team_key",
    "sort_order",
  ].join(",");
}

function offerPriceSelect(): string {
  return [
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
    "sort_order",
  ].join(",");
}

function entitlementTemplateSelect(): string {
  return [
    "id",
    "tenant_id",
    "offer_price_id",
    "entitlement_kind",
    "scope_type",
    "credits_per_period",
    "credit_period",
    "is_unlimited",
    "credit_cost_policy",
    "config",
    "status",
  ].join(",");
}

function toOfferOptionSummary(row: OfferOptionRow): OfferOptionSummaryOut {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    title: row.title,
    offer_type: row.offer_type,
    purchase_kind: row.purchase_kind,
    description: row.description,
    source_offer_id: row.source_offer_id,
    source_offer_option_key: row.source_offer_option_key,
  };
}

function toOfferPriceSummary(row: OfferPriceRow): OfferPriceSummaryOut {
  return {
    id: row.id,
    title: row.title,
    amount_cents: row.amount_cents,
    currency: row.currency,
    billing_interval: row.billing_interval,
    stripe_price_id: row.stripe_price_id,
    stripe_product_id: row.stripe_product_id,
    source_offer_id: row.source_offer_id,
    source_offer_price_key: row.source_offer_price_key,
    source_pricing_catalog_id: row.source_pricing_catalog_id,
  };
}

function toTemplateOut(row: EntitlementTemplateRow): EntitlementTemplateOut {
  return {
    id: row.id,
    entitlement_kind: row.entitlement_kind,
    scope_type: row.scope_type,
    credits_per_period: row.credits_per_period,
    credit_period: row.credit_period,
    is_unlimited: row.is_unlimited,
    credit_cost_policy: row.credit_cost_policy,
    config: row.config,
    status: row.status,
  };
}

function emptyMembershipCreditSummary(): MembershipCreditSummaryOut {
  return {
    ...emptyCreditSummary(),
    active_entitlement_count: 0,
    entitlement_label: null,
  };
}

function emptyCreditSummary(): CreditSummaryOut {
  return {
    is_unlimited: false,
    credits_remaining: 0,
    credits_total: 0,
    credits_per_period: null,
    credit_period: null,
    credit_cost_policy: null,
  };
}

function labelForEntitlement(entitlement: CustomerEntitlementOut | undefined): string | null {
  if (!entitlement) return null;
  if (typeof entitlement.template?.config.display_label === "string") {
    return entitlement.template.config.display_label;
  }
  if (entitlement.offer?.title) return entitlement.offer.title;
  return formatTokenLabel(entitlement.entitlement_kind);
}

function configNumber(config: JsonObject, key: string): number | null {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function configCreditPeriod(config: JsonObject): CreditPeriod | null {
  const value = config.credit_period;
  if (
    value === "WEEK" ||
    value === "FOUR_WEEKS" ||
    value === "MONTH" ||
    value === "TERM" ||
    value === "NONE"
  ) {
    return value;
  }
  return null;
}

function sumNumbers(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function mapById<TRow extends { id: string }>(rows: TRow[]): Map<string, TRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

function groupBy<TRow>(
  rows: TRow[],
  getKey: (row: TRow) => string,
): Map<string, TRow[]> {
  const groups = new Map<string, TRow[]>();
  for (const row of rows) {
    const key = getKey(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function formatTokenLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
