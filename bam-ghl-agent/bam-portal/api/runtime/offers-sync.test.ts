// Pure planning tests for the Phase 6.8 offers sync (no database needed).
// The apply layer is thin guard-targeting CRUD; the risk lives in the plan:
// convergence with existing typed rows, routability gating, and skip logic.
import { describe, expect, it } from "vitest";

import { billingIntervalOf, buildSyncPlan, type EntitlementRule } from "./offers-sync.js";

const TENANT = "39875f07-0a4b-4429-a201-000000000000";
const OFFER = "52a6285c-0000-4000-8000-000000000000";
const PROGRAM = "80000000-0000-4000-8000-000000000001";

type CatalogSeed = {
  id: string;
  key: string;
  routable?: boolean;
  stripe?: string;
  amount?: number;
  interval?: string;
  display?: string;
};

function catalogRow(seed: CatalogSeed) {
  return {
    id: seed.id,
    offer_id: OFFER,
    offer_price_key: seed.key,
    display_name: seed.display ?? seed.key,
    tier: "canonical",
    match_status: "confirmed",
    is_routable: seed.routable ?? true,
    amount_cents: seed.amount ?? 10000,
    currency: "cad",
    interval: seed.interval ?? "4_weeks",
    stripe_price_id: seed.stripe ?? `price_${seed.id}`,
    stripe_product_id: `prod_${seed.id}`,
  };
}

function offerRow(archivedPlans: string[] = []) {
  return {
    id: OFFER,
    client_id: TENANT,
    title: "Training",
    data: {
      pricing: {
        pricing_offerings: [
          { title: "Steady", archived: archivedPlans.includes("Steady") },
          { title: "Accelerate", archived: archivedPlans.includes("Accelerate") },
          { title: "Summer Unlimited", archived: archivedPlans.includes("Summer Unlimited") },
        ],
      },
    },
  };
}

const RULES: Record<string, EntitlementRule> = {
  Steady: { kind: "WEEKLY_CREDITS", credits_per_period: 1, credit_period: "WEEK" },
  Accelerate: { kind: "WEEKLY_CREDITS", credits_per_period: 2, credit_period: "WEEK" },
  "Summer Unlimited": { kind: "UNLIMITED_BOOKING" },
};

function plan(args: {
  catalog: CatalogSeed[];
  archivedPlans?: string[];
  rules?: Record<string, EntitlementRule>;
  existingOptions?: Parameters<typeof buildSyncPlan>[0]["existingOptions"];
  existingPrices?: Parameters<typeof buildSyncPlan>[0]["existingPrices"];
  existingTemplates?: Parameters<typeof buildSyncPlan>[0]["existingTemplates"];
}) {
  return buildSyncPlan({
    offer: offerRow(args.archivedPlans ?? []),
    catalogRows: args.catalog.map(catalogRow),
    existingOptions: args.existingOptions ?? [],
    existingPrices: args.existingPrices ?? [],
    existingTemplates: args.existingTemplates ?? [],
    rules: args.rules ?? RULES,
    bookableProgramId: PROGRAM,
  });
}

describe("buildSyncPlan", () => {
  it("creates one option per plan key and one price per confirmed catalog row", () => {
    const result = plan({
      catalog: [
        { id: "c1", key: "Steady|monthly" },
        { id: "c2", key: "Steady|3_months", interval: "3_months" },
        { id: "c3", key: "Summer Unlimited|monthly" },
      ],
    });
    expect(result.options.map((o) => ({ key: o.key, action: o.action }))).toEqual([
      { key: "Steady", action: "create" },
      { key: "Summer Unlimited", action: "create" },
    ]);
    expect(result.prices).toHaveLength(3);
    expect(result.prices.every((p) => p.action === "create")).toBe(true);
    expect(result.templates).toHaveLength(3);
    expect(result.missingRules).toEqual([]);
  });

  it("routability requires: catalog routable AND plan not archived AND confirmed rule", () => {
    const result = plan({
      catalog: [
        { id: "c1", key: "Steady|monthly", routable: true },
        { id: "c2", key: "Accelerate|monthly", routable: true },
        { id: "c3", key: "Summer Unlimited|monthly", routable: false },
      ],
      archivedPlans: ["Accelerate"],
    });
    const byKey = Object.fromEntries(result.prices.map((p) => [p.catalog.offer_price_key, p]));
    expect(byKey["Steady|monthly"]!.isRoutable).toBe(true);
    // archived in Blueprint -> active in the system but not sellable on the site
    expect(byKey["Accelerate|monthly"]!.isRoutable).toBe(false);
    expect(byKey["Accelerate|monthly"]!.isActive).toBe(true);
    // catalog says not routable -> neither active nor routable
    expect(byKey["Summer Unlimited|monthly"]!.isRoutable).toBe(false);
    expect(byKey["Summer Unlimited|monthly"]!.isActive).toBe(false);
  });

  it("a plan without a confirmed rule gets prices but no template and no routability", () => {
    const result = plan({
      catalog: [{ id: "c1", key: "Steady|monthly", routable: true }],
      rules: {},
    });
    expect(result.prices[0]!.action).toBe("create");
    expect(result.prices[0]!.isRoutable).toBe(false);
    expect(result.templates).toHaveLength(0);
    expect(result.missingRules).toEqual(["Steady"]);
  });

  it("converges with existing typed rows instead of duplicating (rerun = all unchanged)", () => {
    const existingOptions = [
      { id: "opt1", title: "1/Wk", status: "ACTIVE", source_offer_option_key: "Steady", sort_order: 10 },
    ];
    const existingPrices = [
      {
        id: "p1",
        offer_option_id: "opt1",
        title: "1/Wk - Monthly",
        amount_cents: 10000,
        currency: "cad",
        billing_interval: "4_weeks",
        stripe_price_id: "price_c1",
        stripe_product_id: "prod_c1",
        source_offer_id: OFFER,
        source_offer_price_key: "Steady|monthly",
        source_pricing_catalog_id: "c1",
        is_active: true,
        is_routable: true,
        sort_order: 11,
      },
    ];
    const existingTemplates = [
      {
        id: "t1",
        offer_price_id: "p1",
        entitlement_kind: "WEEKLY_CREDITS",
        scope_type: "STUDENT",
        credits_per_period: 1,
        credit_period: "WEEK",
        is_unlimited: false,
        credit_cost_policy: "PER_SLOT_CREDIT_COST",
        config: { display_label: "1 credit / week" },
        status: "ACTIVE",
        bookable_program_id: PROGRAM,
      },
    ];
    const result = plan({
      catalog: [{ id: "c1", key: "Steady|monthly" }],
      existingOptions,
      existingPrices,
      existingTemplates,
    });
    expect(result.options[0]!.action).toBe("unchanged");
    expect(result.options[0]!.title).toBe("1/Wk"); // staff-curated title kept
    expect(result.prices[0]!.action).toBe("unchanged");
    expect(result.templates[0]!.action).toBe("unchanged");
  });

  it("derives billing_interval from the key's term, not the catalog's raw Stripe unit", () => {
    // Early Stripe-Matcher applies stored the raw recurring unit ("week" for a
    // billed-every-4-weeks price). The confirmed key term is the truth checkout
    // needs (commitment-revert + agreement PDF speak 4_weeks/3_months/6_months).
    expect(billingIntervalOf({ offer_price_key: "Steady|monthly", interval: "week" })).toBe("4_weeks");
    expect(billingIntervalOf({ offer_price_key: "Steady|monthly", interval: "month" })).toBe("4_weeks");
    expect(billingIntervalOf({ offer_price_key: "Accelerate|6_months", interval: "week" })).toBe("6_months");
    expect(billingIntervalOf({ offer_price_key: "Accelerate|3_months", interval: "week" })).toBe("3_months");
    // unknown/absent term: keep whatever the catalog says (never invent)
    expect(billingIntervalOf({ offer_price_key: "Drop-in", interval: "one_time" })).toBe("one_time");
    expect(billingIntervalOf({ offer_price_key: "Steady|weekly", interval: "week" })).toBe("week");
  });

  it("converge repairs an existing typed price whose billing_interval came from the raw unit", () => {
    const existingPrices = [
      {
        id: "p1",
        offer_option_id: "opt1",
        title: "2/Wk - 6 months",
        amount_cents: 119900,
        currency: "usd",
        billing_interval: "week",
        stripe_price_id: "price_c1",
        stripe_product_id: "prod_c1",
        source_offer_id: OFFER,
        source_offer_price_key: "Accelerate|6_months",
        source_pricing_catalog_id: "c1",
        is_active: true,
        is_routable: true,
        sort_order: 23,
      },
    ];
    const result = plan({
      catalog: [{ id: "c1", key: "Accelerate|6_months", interval: "week", amount: 119900 }],
      existingPrices,
    });
    expect(result.prices[0]!.action).toBe("update");
    expect(result.prices[0]!.changes).toMatchObject({ billing_interval: "6_months" });
  });

  it("adopts a price typed earlier without catalog lineage by matching stripe_price_id", () => {
    const existingPrices = [
      {
        id: "p1",
        offer_option_id: "opt1",
        title: "Old",
        amount_cents: 9000,
        currency: "cad",
        billing_interval: "4_weeks",
        stripe_price_id: "price_shared",
        stripe_product_id: null,
        source_offer_id: null,
        source_offer_price_key: null,
        source_pricing_catalog_id: null,
        is_active: false,
        is_routable: false,
        sort_order: 0,
      },
    ];
    const result = plan({
      catalog: [{ id: "c1", key: "Steady|monthly", stripe: "price_shared", amount: 10000 }],
      existingPrices,
    });
    expect(result.prices[0]!.action).toBe("update");
    expect(result.prices[0]!.changes).toMatchObject({
      source_pricing_catalog_id: "c1",
      source_offer_id: OFFER,
      source_offer_price_key: "Steady|monthly",
      amount_cents: 10000,
      is_active: true,
      is_routable: true,
    });
  });

  it("skips a catalog row whose stripe_price_id is already typed from a different catalog row", () => {
    const existingPrices = [
      {
        id: "p1",
        offer_option_id: "opt1",
        title: "Typed",
        amount_cents: 10000,
        currency: "cad",
        billing_interval: "4_weeks",
        stripe_price_id: "price_shared",
        stripe_product_id: null,
        source_offer_id: OFFER,
        source_offer_price_key: "Steady|monthly",
        source_pricing_catalog_id: "cOTHER",
        is_active: true,
        is_routable: true,
        sort_order: 11,
      },
    ];
    const result = plan({
      catalog: [{ id: "c1", key: "Steady|monthly", stripe: "price_shared" }],
      existingPrices,
    });
    expect(result.prices[0]!.action).toBe("skip");
    expect(result.prices[0]!.skipReason).toContain("already typed");
  });

  it("deactivates typed prices whose confirmed source vanished, never deletes", () => {
    const existingPrices = [
      {
        id: "p_gone",
        offer_option_id: "opt1",
        title: "Gone plan",
        amount_cents: 5000,
        currency: "cad",
        billing_interval: "4_weeks",
        stripe_price_id: "price_gone",
        stripe_product_id: null,
        source_offer_id: OFFER,
        source_offer_price_key: "Gone|monthly",
        source_pricing_catalog_id: "cGONE",
        is_active: true,
        is_routable: true,
        sort_order: 99,
      },
    ];
    const result = plan({
      catalog: [{ id: "c1", key: "Steady|monthly" }],
      existingPrices,
    });
    expect(result.deactivatePrices.map((p) => p.id)).toEqual(["p_gone"]);
  });

  it("updates an existing ACTIVE template in place when the confirmed rule changes", () => {
    const existingPrices = [
      {
        id: "p1",
        offer_option_id: "opt1",
        title: "2/Wk - Monthly",
        amount_cents: 10000,
        currency: "cad",
        billing_interval: "4_weeks",
        stripe_price_id: "price_c1",
        stripe_product_id: "prod_c1",
        source_offer_id: OFFER,
        source_offer_price_key: "Accelerate|monthly",
        source_pricing_catalog_id: "c1",
        is_active: true,
        is_routable: true,
        sort_order: 21,
      },
    ];
    const existingTemplates = [
      {
        id: "t1",
        offer_price_id: "p1",
        entitlement_kind: "WEEKLY_CREDITS",
        scope_type: "STUDENT",
        credits_per_period: 1, // stale: rule says Accelerate = 2/week
        credit_period: "WEEK",
        is_unlimited: false,
        credit_cost_policy: "PER_SLOT_CREDIT_COST",
        config: {},
        status: "ACTIVE",
        bookable_program_id: PROGRAM,
      },
    ];
    const result = plan({
      catalog: [{ id: "c1", key: "Accelerate|monthly" }],
      existingPrices,
      existingTemplates,
    });
    expect(result.templates[0]!.action).toBe("update");
    expect(result.templates[0]!.changes).toMatchObject({ credits_per_period: 2 });
  });

  it("orders options by Blueprint plan order", () => {
    const result = plan({
      catalog: [
        { id: "c1", key: "Summer Unlimited|monthly" },
        { id: "c2", key: "Steady|monthly" },
      ],
    });
    expect(result.options.map((o) => o.key)).toEqual(["Steady", "Summer Unlimited"]);
  });
});
