// Decision-surface tests for the Phase 5 access sync (no database).
// The write path reuses Luka's helpers (covered by the DB-backed runtime
// suites); what needs coverage here is the gate + skip/grant/status routing,
// which all runs in shadow (dryRun) mode against read-only queries.
import { describe, expect, it } from "vitest";

import { getAccessSyncMode, syncAccessForMember } from "./access-sync.js";
import type { RuntimeSupabaseClient } from "./types.js";

type TableData = Record<string, unknown[] | { access_sync_mode?: string } | null>;

// Minimal thenable query-builder stub: every chained method returns the
// builder; awaiting it resolves { data, error } for the table it was opened on.
function stubSupabase(tables: TableData): RuntimeSupabaseClient {
  return {
    from(table: string) {
      const rows = tables[table];
      const eqFilters: Array<{ column: string; value: unknown }> = [];
      let limitCount: number | null = null;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of ["select", "neq", "not", "in", "order", "update", "insert"]) {
        builder[method] = chain;
      }
      builder.eq = (column: string, value: unknown) => {
        eqFilters.push({ column, value });
        return builder;
      };
      builder.limit = (count: number) => {
        limitCount = count;
        return builder;
      };
      const resolveRows = () => {
        let resolved = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
        for (const filter of eqFilters) {
          if (!resolved.some((row) => hasColumn(row, filter.column))) continue;
          resolved = resolved.filter((row) => hasColumn(row, filter.column) && row[filter.column] === filter.value);
        }
        return limitCount == null ? resolved : resolved.slice(0, limitCount);
      };
      builder.maybeSingle = () =>
        Promise.resolve({ data: resolveRows()[0] ?? null, error: null });
      builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: resolveRows(), error: null }).then(resolve);
      return builder;
    },
  } as unknown as RuntimeSupabaseClient;
}

function hasColumn(row: unknown, column: string): row is Record<string, unknown> {
  return Boolean(row && typeof row === "object" && Object.prototype.hasOwnProperty.call(row, column));
}

const MEMBER = {
  id: "m1",
  client_id: "t1",
  athlete_name: "A",
  parent_name: "P",
  parent_email: "p@x.com",
  parent_phone: null,
  status: "live",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  stripe_price_id: "price_1",
  ghl_contact_id: null,
  joined_date: null,
  stripe_joined_at: null,
};

const PRICE = { id: "op1", tenant_id: "t1", stripe_price_id: "price_1" };
const TEMPLATE = { id: "tpl1", offer_price_id: "op1", status: "ACTIVE", bookable_program_id: "bp1", scope_type: "STUDENT" };

describe("getAccessSyncMode", () => {
  it("defaults to off when the column is null or unknown", async () => {
    expect(await getAccessSyncMode(stubSupabase({ clients: { access_sync_mode: undefined } }), "t1")).toBe("off");
    expect(await getAccessSyncMode(stubSupabase({ clients: { access_sync_mode: "banana" } }), "t1")).toBe("off");
  });
  it("returns shadow and on", async () => {
    expect(await getAccessSyncMode(stubSupabase({ clients: { access_sync_mode: "shadow" } }), "t1")).toBe("shadow");
    expect(await getAccessSyncMode(stubSupabase({ clients: { access_sync_mode: "on" } }), "t1")).toBe("on");
  });
});

describe("syncAccessForMember (dryRun / decision routing)", () => {
  const base = { clientId: "t1", memberId: "m1" } as const;

  it("grants on a paid invoice for a resolvable member (shadow)", async () => {
    const supabase = stubSupabase({ members: [MEMBER], offer_prices: [PRICE], entitlement_templates: [TEMPLATE] });
    const out = await syncAccessForMember(
      supabase,
      { ...base, reason: "invoice-paid", subscriptionId: "sub_1", invoiceId: "in_1" },
      { dryRun: true },
    );
    expect(out.action).toBe("granted");
    expect(out.source_ref).toBe("(shadow) subscription:sub_1:price_1");
  });

  it("uses the invoice source_ref convention for one-time payments", async () => {
    const supabase = stubSupabase({ members: [MEMBER], offer_prices: [PRICE], entitlement_templates: [TEMPLATE] });
    const out = await syncAccessForMember(
      supabase,
      { ...base, reason: "invoice-paid", subscriptionId: null, invoiceId: "in_9" },
      { dryRun: true },
    );
    expect(out.source_ref).toBe("(shadow) invoice:in_9:price_1");
  });

  it("prefers the event's price id over the member row's", async () => {
    const supabase = stubSupabase({
      members: [MEMBER],
      offer_prices: [{ ...PRICE, stripe_price_id: "price_NEW" }],
      entitlement_templates: [TEMPLATE],
    });
    const out = await syncAccessForMember(
      supabase,
      { ...base, reason: "subscription-updated", subscriptionId: "sub_1", stripePriceId: "price_NEW" },
      { dryRun: true },
    );
    expect(out.source_ref).toBe("(shadow) subscription:sub_1:price_NEW");
  });

  it("uses metadata offer_price_id when the Stripe price is not cataloged", async () => {
    const supabase = stubSupabase({
      members: [MEMBER],
      offer_prices: [{ ...PRICE, stripe_price_id: "price_catalog" }],
      entitlement_templates: [TEMPLATE],
    });
    const out = await syncAccessForMember(
      supabase,
      {
        ...base,
        reason: "invoice-paid",
        subscriptionId: "sub_1",
        offerPriceId: "op1",
        stripePriceId: "price_inline",
      },
      { dryRun: true },
    );
    expect(out.action).toBe("granted");
    expect(out.source_ref).toBe("(shadow) subscription:sub_1:price_inline");
  });

  it("falls back to Stripe price resolution when metadata offer_price_id is not found", async () => {
    const supabase = stubSupabase({ members: [MEMBER], offer_prices: [PRICE], entitlement_templates: [TEMPLATE] });
    const out = await syncAccessForMember(
      supabase,
      {
        ...base,
        reason: "invoice-paid",
        subscriptionId: "sub_1",
        offerPriceId: "op_missing",
        stripePriceId: "price_1",
      },
      { dryRun: true },
    );
    expect(out.action).toBe("granted");
    expect(out.source_ref).toBe("(shadow) subscription:sub_1:price_1");
  });

  it("skips when metadata and Stripe price resolution both miss", async () => {
    const out = await syncAccessForMember(
      stubSupabase({ members: [MEMBER], offer_prices: [] }),
      {
        ...base,
        reason: "invoice-paid",
        subscriptionId: "sub_1",
        offerPriceId: "op_missing",
        stripePriceId: "price_inline",
      },
      { dryRun: true },
    );
    expect(out.action).toBe("skipped");
    expect(out.skip_reason).toBe("no typed offer_price for stripe price price_inline");
  });

  it("skips when the member row is gone", async () => {
    const out = await syncAccessForMember(
      stubSupabase({ members: [] }),
      { ...base, reason: "invoice-paid", subscriptionId: "sub_1" },
      { dryRun: true },
    );
    expect(out.action).toBe("skipped");
    expect(out.skip_reason).toContain("member not found");
  });

  it("skips when no stripe price id is known", async () => {
    const out = await syncAccessForMember(
      stubSupabase({ members: [{ ...MEMBER, stripe_price_id: null }] }),
      { ...base, reason: "invoice-paid", subscriptionId: "sub_1" },
      { dryRun: true },
    );
    expect(out.skip_reason).toContain("no stripe_price_id");
  });

  it("skips when the price has no typed offer_price row", async () => {
    const out = await syncAccessForMember(
      stubSupabase({ members: [MEMBER], offer_prices: [] }),
      { ...base, reason: "invoice-paid", subscriptionId: "sub_1" },
      { dryRun: true },
    );
    expect(out.skip_reason).toContain("no typed offer_price");
  });

  it("never mints access without a confirmed entitlement template", async () => {
    const out = await syncAccessForMember(
      stubSupabase({ members: [MEMBER], offer_prices: [PRICE], entitlement_templates: [] }),
      { ...base, reason: "invoice-paid", subscriptionId: "sub_1" },
      { dryRun: true },
    );
    expect(out.action).toBe("skipped");
    expect(out.skip_reason).toContain("no ACTIVE entitlement template");
  });

  it("routes payment-failed to status sync, not a grant", async () => {
    const out = await syncAccessForMember(
      stubSupabase({ members: [{ ...MEMBER, status: "payment_failed" }] }),
      { ...base, reason: "payment-failed", subscriptionId: "sub_1" },
      { dryRun: true },
    );
    expect(out.action).toBe("status-synced");
    expect(out.membership_status).toContain("payment_failed");
  });

  it("subscription-deleted uses the overridden cancelled status", async () => {
    const out = await syncAccessForMember(
      stubSupabase({ members: [MEMBER] }),
      { ...base, reason: "subscription-deleted", subscriptionId: "sub_1", overrideMemberStatus: "cancelled" },
      { dryRun: true },
    );
    expect(out.action).toBe("status-synced");
    expect(out.membership_status).toContain("cancelled");
  });
});

describe("F reasons (portal paths)", () => {
  const base = { clientId: "t1", memberId: "m1" } as const;

  it("member-imported takes the grant path (sorter promote)", async () => {
    const supabase = stubSupabase({ members: [MEMBER], offer_prices: [PRICE], entitlement_templates: [TEMPLATE] });
    const out = await syncAccessForMember(
      supabase,
      { ...base, reason: "member-imported", subscriptionId: "sub_1" },
      { dryRun: true },
    );
    expect(out.action).toBe("granted");
    expect(out.source_ref).toBe("(shadow) subscription:sub_1:price_1");
  });

  it("portal-action mirrors status only, never grants", async () => {
    const out = await syncAccessForMember(
      stubSupabase({ members: [{ ...MEMBER, status: "paused" }] }),
      { ...base, reason: "portal-action", subscriptionId: "sub_1" },
      { dryRun: true },
    );
    expect(out.action).toBe("status-synced");
    expect(out.membership_status).toContain("paused");
  });
});
