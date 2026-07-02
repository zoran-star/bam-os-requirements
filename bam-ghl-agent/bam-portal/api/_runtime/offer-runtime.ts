import { assertRows, assertSingle } from "./supabase.js";
import type { EntitlementTemplate, OfferPrice, RuntimeSupabaseClient } from "./types.js";

export type ResolveRuntimeOfferPriceArgs = {
  tenantId: string;
  offerPriceId?: string;
  offerPriceKey?: string;
  plan?: string;
  term?: string;
  requireActive?: boolean;
  requireRoutable?: boolean;
};

export async function resolveRuntimeOfferPrice(
  supabase: RuntimeSupabaseClient,
  args: ResolveRuntimeOfferPriceArgs,
): Promise<OfferPrice> {
  const offerPriceKey = args.offerPriceKey ?? keyFromPlanTerm(args.plan, args.term);
  const requireActive = args.requireActive ?? true;
  const requireRoutable = args.requireRoutable ?? true;
  const resolvingByKey = !args.offerPriceId && Boolean(offerPriceKey);
  const ambiguityCheck = resolvingByKey && requireActive && requireRoutable;

  let query = supabase
    .from("offer_prices")
    .select(offerPriceSelect)
    .eq("tenant_id", args.tenantId)
    .order("is_active", { ascending: false })
    .order("is_routable", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(ambiguityCheck ? 2 : 1);

  if (args.offerPriceId) query = query.eq("id", args.offerPriceId);
  else if (offerPriceKey) query = query.eq("source_offer_price_key", offerPriceKey);
  else throw new Error("offerPriceId, offerPriceKey, or plan/term is required.");

  if (requireActive) query = query.eq("is_active", true);
  if (requireRoutable) query = query.eq("is_routable", true);

  const { data, error } = await query;
  const rows = assertRows<OfferPrice>(data, error);
  if (ambiguityCheck && rows.length > 1) {
    throw new Error(
      `Ambiguous runtime offer price key ${offerPriceKey} for tenant ${args.tenantId}: multiple active routable offer_prices match. Resolve by offerPriceId instead.`,
    );
  }
  const first = rows[0];
  if (!first) {
    throw new Error(`Runtime offer price not found for ${args.offerPriceId ?? offerPriceKey}.`);
  }
  return first;
}

export async function getActiveEntitlementTemplateForPrice(
  supabase: RuntimeSupabaseClient,
  args: { tenantId: string; offerPriceId: string },
): Promise<EntitlementTemplate> {
  const { data, error } = await supabase
    .from("entitlement_templates")
    .select(entitlementTemplateSelect)
    .eq("tenant_id", args.tenantId)
    .eq("offer_price_id", args.offerPriceId)
    .eq("status", "ACTIVE")
    .maybeSingle();

  return assertSingle<EntitlementTemplate>(data, error);
}

function keyFromPlanTerm(plan: string | undefined, term: string | undefined): string | undefined {
  if (!plan || !term) return undefined;
  return `${plan}|${term}`;
}

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
