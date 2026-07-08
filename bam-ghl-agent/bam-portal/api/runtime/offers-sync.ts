// POST /api/runtime/offers/sync (staff-only) - Phase 6.8 offers tie-in.
//
// Derives TYPED runtime rows (offer_options / offer_prices / entitlement_templates)
// from confirmed pricing_catalog mappings plus Business Blueprint plan flags.
// Checkout and access then resolve only through the typed rows; offers.data JSON
// stays the copy/content layer.
//
// Contract (docs/parent-runtime-cutover-guardrails.md, "Offers tie-in"):
//   - idempotent + rerun-safe: upserts converge on the runtime uniqueness guards
//     (uq_offer_options_source_option_live, uq_offer_prices_source_catalog,
//     uq_offer_prices_stripe_price, uq_entitlement_templates_active_price)
//   - lineage always written: source_offer_id / source_offer_price_key /
//     source_pricing_catalog_id
//   - typed rows are NEVER hard-deleted; sources that disappear are deactivated
//   - entitlement semantics are explicit CONFIRMED input (request body), never
//     inferred from names/amounts/pricing_catalog/Stripe metadata. A price whose
//     option has no confirmed rule cannot become routable.
//
// mode=preview computes the full plan and writes nothing.

import { withSentryApiRoute } from "../_sentry.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import { assertRows, isUniqueViolation } from "../_runtime/supabase.js";
import type { RuntimeSupabaseClient } from "../_runtime/types.js";
import { HttpError, sendError } from "./_errors.js";
import { getStaffContext } from "./_staff-context.js";
import type { RuntimeApiRequest, RuntimeApiResponse } from "./_types.js";

type JsonRecord = Record<string, unknown>;

export type EntitlementRule =
  | { kind: "WEEKLY_CREDITS"; credits_per_period: number; credit_period?: "WEEK" }
  | { kind: "UNLIMITED_BOOKING" };

type SyncBody = {
  client_id?: string;
  offer_id?: string;
  mode?: "preview" | "apply";
  bookable_program_id?: string | null;
  offer_type?: string;
  purchase_kind?: string;
  entitlement_rules?: Record<string, EntitlementRule>;
};

type OfferRow = {
  id: string;
  client_id: string;
  title: string | null;
  data: JsonRecord | null;
};

type CatalogRow = {
  id: string;
  offer_id: string;
  offer_price_key: string;
  display_name: string | null;
  tier: string | null;
  match_status: string | null;
  is_routable: boolean | null;
  amount_cents: number | null;
  currency: string | null;
  interval: string | null;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
};

type OptionRow = {
  id: string;
  title: string;
  status: string;
  source_offer_option_key: string | null;
  sort_order: number;
};

type PriceRow = {
  id: string;
  offer_option_id: string | null;
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

type TemplateRow = {
  id: string;
  offer_price_id: string;
  entitlement_kind: string;
  scope_type: string;
  credits_per_period: number | null;
  credit_period: string | null;
  is_unlimited: boolean;
  credit_cost_policy: string | null;
  config: JsonRecord | null;
  status: string;
  bookable_program_id: string | null;
};

type PlannedOption = {
  key: string;
  title: string;
  archivedInBlueprint: boolean;
  sortOrder: number;
  existing: OptionRow | null;
  action: "create" | "unchanged";
};

type PlannedPrice = {
  catalog: CatalogRow;
  optionKey: string;
  title: string;
  isActive: boolean;
  isRoutable: boolean;
  sortOrder: number;
  existing: PriceRow | null;
  action: "create" | "update" | "unchanged" | "skip";
  changes: Partial<PriceRow>;
  skipReason?: string;
};

type PlannedTemplate = {
  optionKey: string;
  priceCatalogId: string;
  rule: EntitlementRule;
  existing: TemplateRow | null;
  action: "create" | "update" | "unchanged";
  changes: Partial<TemplateRow>;
};

const TEMPLATE_SCOPE_TYPE = "STUDENT";
// Mirrors the production backfill: weekly-credit plans debit per slot,
// unlimited plans book free.
function creditCostPolicyFor(rule: EntitlementRule): string {
  return rule.kind === "UNLIMITED_BOOKING" ? "FREE" : "PER_SLOT_CREDIT_COST";
}

function planKeyOf(offerPriceKey: string): string {
  const idx = offerPriceKey.indexOf("|");
  return idx === -1 ? offerPriceKey : offerPriceKey.slice(0, idx);
}

// billing_interval on typed prices speaks the checkout term vocabulary
// (4_weeks / 3_months / 6_months / one_time) - website/checkout.js gates the
// commitment-revert logic and the agreement PDF's term noun on these exact
// strings. The offer_price_key's term is the intent the academy confirmed in
// the Stripe Matcher, so it wins over pricing_catalog.interval, which
// historically stored Stripe's raw recurring unit ("week" for a
// billed-every-4-weeks price, dropping interval_count).
export function billingIntervalOf(row: Pick<CatalogRow, "offer_price_key" | "interval">): string | null {
  const key = row.offer_price_key || "";
  const idx = key.indexOf("|");
  const term = idx === -1 ? "" : key.slice(idx + 1).trim().toLowerCase();
  if (term === "monthly" || term === "4_weeks") return "4_weeks";
  if (term === "3_months") return "3_months";
  if (term === "6_months") return "6_months";
  if (term === "one_time") return "one_time";
  return row.interval;
}

function ruleDisplayLabel(rule: EntitlementRule): string {
  if (rule.kind === "UNLIMITED_BOOKING") return "Unlimited bookings";
  const n = rule.credits_per_period;
  return `${n} credit${n === 1 ? "" : "s"} / week`;
}

function validateRules(raw: unknown): Record<string, EntitlementRule> {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "entitlement_rules must be an object keyed by plan key");
  }
  const out: Record<string, EntitlementRule> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const rule = value as Partial<EntitlementRule> & { kind?: string };
    if (rule?.kind === "UNLIMITED_BOOKING") {
      out[key] = { kind: "UNLIMITED_BOOKING" };
    } else if (rule?.kind === "WEEKLY_CREDITS") {
      const credits = Number((rule as { credits_per_period?: unknown }).credits_per_period);
      if (!Number.isInteger(credits) || credits < 1 || credits > 14) {
        throw new HttpError(400, `entitlement_rules.${key}: credits_per_period must be an integer 1-14`);
      }
      out[key] = { kind: "WEEKLY_CREDITS", credits_per_period: credits, credit_period: "WEEK" };
    } else {
      throw new HttpError(400, `entitlement_rules.${key}: kind must be WEEKLY_CREDITS or UNLIMITED_BOOKING`);
    }
  }
  return out;
}

// Blueprint plan flags: which plan titles are archived (copy-layer only; used to
// keep archived plans off the storefront, never to drop operational prices).
function blueprintPlanFlags(offer: OfferRow): { order: string[]; archived: Set<string> } {
  const order: string[] = [];
  const archived = new Set<string>();
  const offerings = (offer.data as { pricing?: { pricing_offerings?: unknown } } | null)?.pricing
    ?.pricing_offerings;
  if (Array.isArray(offerings)) {
    for (const raw of offerings) {
      const plan = raw as { title?: unknown; archived?: unknown };
      const title = typeof plan?.title === "string" ? plan.title.trim() : "";
      if (!title) continue;
      order.push(title);
      if (plan?.archived === true) archived.add(title);
    }
  }
  return { order, archived };
}

export function buildSyncPlan(args: {
  offer: OfferRow;
  catalogRows: CatalogRow[];
  existingOptions: OptionRow[];
  existingPrices: PriceRow[];
  existingTemplates: TemplateRow[];
  rules: Record<string, EntitlementRule>;
  bookableProgramId: string | null;
}): {
  options: PlannedOption[];
  prices: PlannedPrice[];
  templates: PlannedTemplate[];
  deactivatePrices: PriceRow[];
  missingRules: string[];
} {
  const { offer, catalogRows, existingOptions, existingPrices, existingTemplates, rules } = args;
  const { order, archived } = blueprintPlanFlags(offer);

  const optionByKey = new Map<string, OptionRow>();
  for (const opt of existingOptions) {
    if (opt.source_offer_option_key && opt.status !== "ARCHIVED") {
      optionByKey.set(opt.source_offer_option_key, opt);
    }
  }
  const priceByCatalogId = new Map<string, PriceRow>();
  const priceByStripeId = new Map<string, PriceRow>();
  for (const price of existingPrices) {
    if (price.source_pricing_catalog_id) priceByCatalogId.set(price.source_pricing_catalog_id, price);
    if (price.stripe_price_id) priceByStripeId.set(price.stripe_price_id, price);
  }
  const templateByPriceId = new Map<string, TemplateRow>();
  for (const tpl of existingTemplates) {
    if (tpl.status === "ACTIVE") templateByPriceId.set(tpl.offer_price_id, tpl);
  }

  // ---- options: one live option per distinct plan key with confirmed prices
  const planKeys: string[] = [];
  for (const row of catalogRows) {
    const key = planKeyOf(row.offer_price_key);
    if (!planKeys.includes(key)) planKeys.push(key);
  }
  planKeys.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const options: PlannedOption[] = planKeys.map((key, idx) => {
    const existing = optionByKey.get(key) || null;
    return {
      key,
      // Existing titles are staff-curated (e.g. "1/Wk" for Steady); never rename.
      title: existing ? existing.title : key,
      archivedInBlueprint: archived.has(key),
      sortOrder: existing ? existing.sort_order : (idx + 1) * 10,
      existing,
      action: existing ? "unchanged" : "create",
    };
  });

  // ---- prices: one per confirmed catalog row (legacy rows included on purpose:
  // they are how the webhook resolves old subscriptions to typed access)
  const prices: PlannedPrice[] = [];
  const claimedPriceIds = new Set<string>();
  const termOrder = (key: string) => {
    const term = key.slice(key.indexOf("|") + 1);
    if (term === "monthly") return 1;
    if (term === "3_months") return 2;
    if (term === "6_months") return 3;
    return 9;
  };

  for (const row of catalogRows) {
    const optionKey = planKeyOf(row.offer_price_key);
    const hasRule = !!rules[optionKey];
    const isActive = row.is_routable === true;
    const isRoutable = row.is_routable === true && !archived.has(optionKey) && hasRule;
    const planIdx = planKeys.indexOf(optionKey);
    const sortOrder = (planIdx + 1) * 10 + termOrder(row.offer_price_key);

    let existing = priceByCatalogId.get(row.id) || null;
    let skipReason: string | undefined;
    if (!existing && row.stripe_price_id) {
      const byStripe = priceByStripeId.get(row.stripe_price_id) || null;
      if (byStripe) {
        if (byStripe.source_pricing_catalog_id && byStripe.source_pricing_catalog_id !== row.id) {
          skipReason = `stripe_price_id ${row.stripe_price_id} already typed from catalog row ${byStripe.source_pricing_catalog_id}`;
        } else {
          existing = byStripe;
        }
      }
    }
    if (existing && claimedPriceIds.has(existing.id)) {
      existing = null;
      skipReason = `typed price already claimed by another catalog row sharing stripe_price_id ${row.stripe_price_id}`;
    }
    if (skipReason) {
      prices.push({
        catalog: row, optionKey, title: row.display_name || row.offer_price_key,
        isActive, isRoutable, sortOrder, existing: null, action: "skip", changes: {}, skipReason,
      });
      continue;
    }

    if (!existing) {
      prices.push({
        catalog: row, optionKey, title: row.display_name || row.offer_price_key,
        isActive, isRoutable, sortOrder, existing: null, action: "create", changes: {},
      });
      continue;
    }

    claimedPriceIds.add(existing.id);
    // Operational fields converge; titles/sort stay staff-curated after create.
    const changes: Partial<PriceRow> = {};
    if (row.amount_cents != null && existing.amount_cents !== row.amount_cents) changes.amount_cents = row.amount_cents;
    if (row.stripe_price_id && existing.stripe_price_id !== row.stripe_price_id) changes.stripe_price_id = row.stripe_price_id;
    if (row.stripe_product_id && existing.stripe_product_id !== row.stripe_product_id) changes.stripe_product_id = row.stripe_product_id;
    const interval = billingIntervalOf(row);
    if (interval && existing.billing_interval !== interval) changes.billing_interval = interval;
    if (existing.source_pricing_catalog_id !== row.id) changes.source_pricing_catalog_id = row.id;
    if (existing.source_offer_id !== row.offer_id) changes.source_offer_id = row.offer_id;
    if (existing.source_offer_price_key !== row.offer_price_key) changes.source_offer_price_key = row.offer_price_key;
    if (existing.is_active !== isActive) changes.is_active = isActive;
    if (existing.is_routable !== isRoutable) changes.is_routable = isRoutable;

    prices.push({
      catalog: row, optionKey, title: existing.title,
      isActive, isRoutable, sortOrder, existing,
      action: Object.keys(changes).length ? "update" : "unchanged", changes,
    });
  }

  // ---- deactivate typed prices whose confirmed source vanished (never delete)
  const confirmedCatalogIds = new Set(catalogRows.map((row) => row.id));
  const deactivatePrices = existingPrices.filter(
    (price) =>
      price.source_offer_id === offer.id &&
      price.source_pricing_catalog_id &&
      !confirmedCatalogIds.has(price.source_pricing_catalog_id) &&
      (price.is_active || price.is_routable),
  );

  // ---- templates: only for options with an explicit confirmed rule
  const templates: PlannedTemplate[] = [];
  const missingRules = planKeys.filter((key) => !rules[key]);
  for (const price of prices) {
    if (price.action === "skip") continue;
    const rule = rules[price.optionKey];
    if (!rule) continue;
    const existingTpl = price.existing ? templateByPriceId.get(price.existing.id) || null : null;
    const desired = {
      entitlement_kind: rule.kind === "UNLIMITED_BOOKING" ? "UNLIMITED_BOOKING" : "WEEKLY_CREDITS",
      credits_per_period: rule.kind === "WEEKLY_CREDITS" ? rule.credits_per_period : null,
      credit_period: rule.kind === "WEEKLY_CREDITS" ? "WEEK" : null,
      is_unlimited: rule.kind === "UNLIMITED_BOOKING",
      bookable_program_id: args.bookableProgramId,
    };
    if (!existingTpl) {
      templates.push({
        optionKey: price.optionKey, priceCatalogId: price.catalog.id, rule,
        existing: null, action: "create", changes: {},
      });
      continue;
    }
    const changes: Partial<TemplateRow> = {};
    if (existingTpl.entitlement_kind !== desired.entitlement_kind) changes.entitlement_kind = desired.entitlement_kind;
    if ((existingTpl.credits_per_period ?? null) !== desired.credits_per_period) changes.credits_per_period = desired.credits_per_period;
    if ((existingTpl.credit_period ?? null) !== desired.credit_period) changes.credit_period = desired.credit_period;
    if (existingTpl.is_unlimited !== desired.is_unlimited) changes.is_unlimited = desired.is_unlimited;
    if (desired.bookable_program_id && existingTpl.bookable_program_id !== desired.bookable_program_id) {
      changes.bookable_program_id = desired.bookable_program_id;
    }
    templates.push({
      optionKey: price.optionKey, priceCatalogId: price.catalog.id, rule,
      existing: existingTpl, action: Object.keys(changes).length ? "update" : "unchanged", changes,
    });
  }

  return { options, prices, templates, deactivatePrices, missingRules };
}

async function applyPlan(
  supabase: RuntimeSupabaseClient,
  tenantId: string,
  offerId: string,
  offerType: string,
  purchaseKind: string,
  bookableProgramId: string | null,
  plan: ReturnType<typeof buildSyncPlan>,
) {
  const now = new Date().toISOString();
  const optionIdByKey = new Map<string, string>();

  for (const opt of plan.options) {
    if (opt.existing) {
      optionIdByKey.set(opt.key, opt.existing.id);
      continue;
    }
    const insert = {
      tenant_id: tenantId,
      title: opt.title,
      offer_type: offerType,
      purchase_kind: purchaseKind,
      status: "ACTIVE",
      source_offer_id: offerId,
      source_offer_option_key: opt.key,
      sort_order: opt.sortOrder,
    };
    const { data, error } = await supabase.from("offer_options").insert(insert).select("id").single();
    if (error) {
      if (!isUniqueViolation(error)) throw new HttpError(500, "offer_options insert failed", error);
      // Concurrent sync created it first; converge on the guard.
      const { data: rows, error: refetchError } = await supabase
        .from("offer_options")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("source_offer_id", offerId)
        .eq("source_offer_option_key", opt.key)
        .neq("status", "ARCHIVED")
        .limit(1);
      const found = assertRows<{ id: string }>(rows, refetchError)[0];
      if (!found) throw new HttpError(500, "offer_options refetch after conflict failed");
      optionIdByKey.set(opt.key, found.id);
      continue;
    }
    optionIdByKey.set(opt.key, (data as { id: string }).id);
  }

  const priceIdByCatalogId = new Map<string, string>();
  for (const price of plan.prices) {
    if (price.action === "skip") continue;
    if (price.existing) {
      priceIdByCatalogId.set(price.catalog.id, price.existing.id);
      if (price.action === "update") {
        const { error } = await supabase
          .from("offer_prices")
          .update({ ...price.changes, updated_at: now })
          .eq("id", price.existing.id)
          .eq("tenant_id", tenantId);
        if (error) throw new HttpError(500, "offer_prices update failed", error);
      }
      continue;
    }
    const insert = {
      tenant_id: tenantId,
      offer_option_id: optionIdByKey.get(price.optionKey) || null,
      title: price.title,
      amount_cents: price.catalog.amount_cents ?? 0,
      currency: price.catalog.currency || "cad",
      billing_interval: billingIntervalOf(price.catalog),
      stripe_price_id: price.catalog.stripe_price_id,
      stripe_product_id: price.catalog.stripe_product_id,
      source_offer_id: price.catalog.offer_id,
      source_offer_price_key: price.catalog.offer_price_key,
      source_pricing_catalog_id: price.catalog.id,
      is_active: price.isActive,
      is_routable: price.isRoutable,
      sort_order: price.sortOrder,
    };
    const { data, error } = await supabase.from("offer_prices").insert(insert).select("id").single();
    if (error) {
      if (!isUniqueViolation(error)) throw new HttpError(500, "offer_prices insert failed", error);
      const { data: rows, error: refetchError } = await supabase
        .from("offer_prices")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("source_pricing_catalog_id", price.catalog.id)
        .limit(1);
      const found = assertRows<{ id: string }>(rows, refetchError)[0];
      if (!found) throw new HttpError(500, "offer_prices refetch after conflict failed");
      priceIdByCatalogId.set(price.catalog.id, found.id);
      continue;
    }
    priceIdByCatalogId.set(price.catalog.id, (data as { id: string }).id);
  }

  for (const price of plan.deactivatePrices) {
    const { error } = await supabase
      .from("offer_prices")
      .update({ is_active: false, is_routable: false, updated_at: now })
      .eq("id", price.id)
      .eq("tenant_id", tenantId);
    if (error) throw new HttpError(500, "offer_prices deactivate failed", error);
  }

  for (const tpl of plan.templates) {
    if (tpl.action === "unchanged") continue;
    if (tpl.existing) {
      const config = { ...(tpl.existing.config || {}), display_label: ruleDisplayLabel(tpl.rule) };
      const { error } = await supabase
        .from("entitlement_templates")
        .update({ ...tpl.changes, config, updated_at: now })
        .eq("id", tpl.existing.id)
        .eq("tenant_id", tenantId);
      if (error) throw new HttpError(500, "entitlement_templates update failed", error);
      continue;
    }
    const priceId = priceIdByCatalogId.get(tpl.priceCatalogId);
    if (!priceId) continue;
    const insert = {
      tenant_id: tenantId,
      offer_price_id: priceId,
      entitlement_kind: tpl.rule.kind === "UNLIMITED_BOOKING" ? "UNLIMITED_BOOKING" : "WEEKLY_CREDITS",
      scope_type: TEMPLATE_SCOPE_TYPE,
      credits_per_period: tpl.rule.kind === "WEEKLY_CREDITS" ? tpl.rule.credits_per_period : null,
      credit_period: tpl.rule.kind === "WEEKLY_CREDITS" ? "WEEK" : null,
      is_unlimited: tpl.rule.kind === "UNLIMITED_BOOKING",
      credit_cost_policy: creditCostPolicyFor(tpl.rule),
      config: { display_label: ruleDisplayLabel(tpl.rule) },
      status: "ACTIVE",
      bookable_program_id: bookableProgramId,
    };
    const { error } = await supabase.from("entitlement_templates").insert(insert);
    if (error && !isUniqueViolation(error)) {
      throw new HttpError(500, "entitlement_templates insert failed", error);
    }
    // Unique violation = an ACTIVE template already exists for this price
    // (concurrent sync); the next run converges any field drift.
  }
}

function summarize(plan: ReturnType<typeof buildSyncPlan>) {
  const count = (items: { action: string }[], action: string) =>
    items.filter((item) => item.action === action).length;
  return {
    options: {
      create: plan.options.filter((o) => o.action === "create").map((o) => o.key),
      unchanged: count(plan.options, "unchanged"),
    },
    prices: {
      create: plan.prices.filter((p) => p.action === "create").map((p) => p.catalog.offer_price_key),
      update: plan.prices
        .filter((p) => p.action === "update")
        .map((p) => ({ key: p.catalog.offer_price_key, changes: Object.keys(p.changes) })),
      unchanged: count(plan.prices, "unchanged"),
      deactivate: plan.deactivatePrices.map((p) => p.source_offer_price_key || p.id),
      skipped: plan.prices
        .filter((p) => p.action === "skip")
        .map((p) => ({ key: p.catalog.offer_price_key, reason: p.skipReason })),
    },
    templates: {
      create: plan.templates.filter((t) => t.action === "create").length,
      update: plan.templates.filter((t) => t.action === "update").length,
      unchanged: count(plan.templates, "unchanged"),
    },
    missing_rules: plan.missingRules,
  };
}

// The full load -> plan -> (optionally) apply pipeline, minus auth. Exported so
// staff tooling/scripts (service role) and DB-backed tests can drive the exact
// code path the endpoint runs.
export async function runOffersSync(supabase: RuntimeSupabaseClient, body: SyncBody) {
  const clientId = (body.client_id || "").trim();
  const offerId = (body.offer_id || "").trim();
  const mode = body.mode === "apply" ? "apply" : "preview";
  if (!clientId || !offerId) throw new HttpError(400, "client_id and offer_id required");
  const rules = validateRules(body.entitlement_rules);
  const offerType = (body.offer_type || "TRAINING").trim().toUpperCase();
  const purchaseKind = (body.purchase_kind || "MEMBERSHIP").trim().toUpperCase();
  const bookableProgramId = body.bookable_program_id ? String(body.bookable_program_id) : null;

  const { data: offerRows, error: offerError } = await supabase
    .from("offers")
    .select("id, client_id, title, data")
    .eq("id", offerId)
    .eq("client_id", clientId)
    .limit(1);
  const offer = assertRows<OfferRow>(offerRows, offerError)[0];
  if (!offer) throw new HttpError(404, "offer not found for this client");

  if (bookableProgramId) {
    const { data: programRows, error: programError } = await supabase
      .from("bookable_programs")
      .select("id")
      .eq("id", bookableProgramId)
      .eq("tenant_id", clientId)
      .limit(1);
    if (!assertRows<{ id: string }>(programRows, programError)[0]) {
      throw new HttpError(400, "bookable_program_id not found for this client");
    }
  }

  const { data: catalogData, error: catalogError } = await supabase
    .from("pricing_catalog")
    .select(
      "id, offer_id, offer_price_key, display_name, tier, match_status, is_routable, amount_cents, currency, interval, stripe_price_id, stripe_product_id",
    )
    .eq("client_id", clientId)
    .eq("offer_id", offerId)
    .eq("match_status", "confirmed")
    .not("offer_price_key", "is", null)
    .order("offer_price_key");
  const catalogRows = assertRows<CatalogRow>(catalogData, catalogError);
  if (!catalogRows.length) {
    throw new HttpError(400, "no confirmed pricing_catalog rows for this offer - run the Stripe Matcher first");
  }

  const { data: optionData, error: optionError } = await supabase
    .from("offer_options")
    .select("id, title, status, source_offer_option_key, sort_order")
    .eq("tenant_id", clientId)
    .eq("source_offer_id", offerId);
  const existingOptions = assertRows<OptionRow>(optionData, optionError);

  const { data: priceData, error: priceError } = await supabase
    .from("offer_prices")
    .select(
      "id, offer_option_id, title, amount_cents, currency, billing_interval, stripe_price_id, stripe_product_id, source_offer_id, source_offer_price_key, source_pricing_catalog_id, is_active, is_routable, sort_order",
    )
    .eq("tenant_id", clientId);
  const existingPrices = assertRows<PriceRow>(priceData, priceError);

  const priceIds = existingPrices.map((p) => p.id);
  let existingTemplates: TemplateRow[] = [];
  if (priceIds.length) {
    const { data: tplData, error: tplError } = await supabase
      .from("entitlement_templates")
      .select(
        "id, offer_price_id, entitlement_kind, scope_type, credits_per_period, credit_period, is_unlimited, credit_cost_policy, config, status, bookable_program_id",
      )
      .eq("tenant_id", clientId)
      .in("offer_price_id", priceIds);
    existingTemplates = assertRows<TemplateRow>(tplData, tplError);
  }

  const plan = buildSyncPlan({
    offer,
    catalogRows,
    existingOptions,
    existingPrices,
    existingTemplates,
    rules,
    bookableProgramId,
  });

  if (mode === "apply") {
    await applyPlan(supabase, clientId, offerId, offerType, purchaseKind, bookableProgramId, plan);
  }

  return {
    ok: true,
    mode,
    offer: { id: offer.id, title: offer.title },
    plan: summarize(plan),
  };
}

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "POST required");
    }
    await getStaffContext(req);
    const supabase = createRuntimeSupabaseClient();
    const result = await runOffersSync(supabase, (req.body || {}) as SyncBody);
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withSentryApiRoute(handler);
