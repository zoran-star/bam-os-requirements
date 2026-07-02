import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyInvoiceCreditGrants, sweepLapsedCreditEntitlements, type InvoiceGrantInput } from "./credit-engine.js";
import type { RuntimeApiRequest, RuntimeApiResponse } from "../runtime/_types.js";
import type { JsonObject, RuntimeSupabaseClient } from "./types.js";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const runtimeTestSupabaseUrl = process.env.RUNTIME_TEST_SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const runtimeTestServiceRoleKey = process.env.RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY;
if (!runtimeTestServiceRoleKey) {
  throw new Error("RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY is required. Run npm run test:runtime.");
}

process.env.VITE_SUPABASE_URL = runtimeTestSupabaseUrl;
process.env.SUPABASE_URL = runtimeTestSupabaseUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = runtimeTestServiceRoleKey;

const TENANT_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";
const MAYA_MEMBER_ID = "5e0c5f1d-98ee-4674-975f-63b6b7f7f6a7";
const MAYA_SUBSCRIPTION_ID = "sub_local_maya_1wk";
const MAYA_ENTITLEMENT_ID = "84000000-0000-4000-8000-000000000001";
const MAYA_MEMBERSHIP_ID = "8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f";
const MAYA_STUDENT_ID = "531a0580-56c6-4029-a72f-c42221e17bfb";
const STEADY_TEMPLATE_ID = "83000000-0000-4000-8000-000000000001";
const STEADY_STRIPE_PRICE_ID = "plan_ToNwa96lQ5I1Bs";
const UNLIMITED_STRIPE_PRICE_ID = "price_1Ti6PCRxInSEtAh89gUsOSFj";
const TEST_RUN_ID = randomUUID();
const TEST_LINE_PREFIX = `runtime-credit-engine-${TEST_RUN_ID}`;
const TEST_DEBIT_PREFIX = `runtime-credit-engine-debit:${TEST_RUN_ID}`;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const PERIODS = {
  happy: {
    start: "2026-08-03T00:00:00.000Z",
    end: "2026-08-31T00:00:00.000Z",
  },
  replay: {
    start: "2026-09-07T00:00:00.000Z",
    end: "2026-10-05T00:00:00.000Z",
  },
  secondInitial: {
    start: "2026-10-12T00:00:00.000Z",
    end: "2026-11-09T00:00:00.000Z",
  },
  secondNext: {
    start: "2026-11-09T00:00:00.000Z",
    end: "2026-12-07T00:00:00.000Z",
  },
  carryOver: {
    start: "2026-12-14T00:00:00.000Z",
    end: "2027-01-11T00:00:00.000Z",
  },
  skips: {
    start: "2027-01-18T00:00:00.000Z",
    end: "2027-02-15T00:00:00.000Z",
  },
};
const EXPIRY_SOURCE_REFS = Object.values(PERIODS).map((period) => expirySourceRef(period.start));

type ApiHandler = (req: RuntimeApiRequest, res: RuntimeApiResponse) => Promise<unknown>;

type MockResponse = RuntimeApiResponse & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  ended: boolean;
};

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

let originalTemplateConfig: JsonObject = {};
let originalEntitlementConfig: JsonObject = {};
let originalSubscriptionId: string | null = null;

describe("credit engine invoice grants", () => {
  beforeAll(async () => {
    assertLocalSupabase();
    originalTemplateConfig = await configFor("entitlement_templates", STEADY_TEMPLATE_ID);
    originalEntitlementConfig = await configFor("customer_entitlements", MAYA_ENTITLEMENT_ID);
    originalSubscriptionId = await seededMemberSubscriptionId();
    if (!originalSubscriptionId) await setSeededMemberSubscriptionId(MAYA_SUBSCRIPTION_ID);
  });

  beforeEach(async () => {
    await restoreConfigs();
    await cleanupCreditEngineRows();
  });

  afterEach(async () => {
    await cleanupCreditEngineRows();
    await restoreConfigs();
    restoreCronSecret();
  });

  afterAll(async () => {
    await cleanupCreditEngineRows();
    await restoreConfigs();
    if (!originalSubscriptionId) await setSeededMemberSubscriptionId(null);
    restoreCronSecret();
  });

  it("grants a seeded member invoice and reports the refreshed balance", async () => {
    const result = await applyInvoiceCreditGrants(supabase, invoiceInput("happy", PERIODS.happy));

    expect(result.skipped).toEqual([]);
    expect(result.granted).toHaveLength(1);
    expect(result.granted[0]).toMatchObject({
      lineId: `${TEST_LINE_PREFIX}-happy`,
      invoiceId: `${TEST_LINE_PREFIX}-invoice-happy`,
      customerEntitlementId: MAYA_ENTITLEMENT_ID,
      granted: true,
      expiredCredits: 4,
      balance: 4,
    });
    expect(await balanceForMaya()).toBe(4);
  });

  it("replays the same invoice idempotently without changing balance", async () => {
    const first = await applyInvoiceCreditGrants(supabase, invoiceInput("replay", PERIODS.replay));
    const balanceAfterFirst = await balanceForMaya();
    const second = await applyInvoiceCreditGrants(supabase, invoiceInput("replay", PERIODS.replay));

    expect(first.granted[0]?.granted).toBe(true);
    expect(second.skipped).toEqual([]);
    expect(second.granted[0]).toMatchObject({
      lineId: `${TEST_LINE_PREFIX}-replay`,
      granted: false,
      expiredCredits: 0,
      balance: balanceAfterFirst,
    });
    expect(await balanceForMaya()).toBe(balanceAfterFirst);
  });

  it("expires the remaining block before granting the next paid period", async () => {
    await applyInvoiceCreditGrants(supabase, invoiceInput("second-initial", PERIODS.secondInitial));
    await insertDirectDebit();

    expect(await balanceForMaya()).toBe(3);

    const result = await applyInvoiceCreditGrants(supabase, invoiceInput("second-next", PERIODS.secondNext));

    expect(result.skipped).toEqual([]);
    expect(result.granted[0]).toMatchObject({
      granted: true,
      expiredCredits: 3,
      balance: 4,
    });
    expect(await balanceForMaya()).toBe(4);
  });

  it("carries balance forward when entitlement config opts into CARRY_OVER", async () => {
    await updateConfig("customer_entitlements", MAYA_ENTITLEMENT_ID, {
      ...originalEntitlementConfig,
      credit_rollover: "CARRY_OVER",
    });

    const result = await applyInvoiceCreditGrants(supabase, invoiceInput("carry-over", PERIODS.carryOver));

    expect(result.skipped).toEqual([]);
    expect(result.granted[0]).toMatchObject({
      granted: true,
      expiredCredits: 0,
      balance: 8,
    });
    expect(await balanceForMaya()).toBe(8);
  });

  it("skips unknown Stripe prices and unlimited plans without throwing", async () => {
    const result = await applyInvoiceCreditGrants(supabase, {
      ...invoiceInput("skips", PERIODS.skips),
      lines: [
        {
          lineId: `${TEST_LINE_PREFIX}-unknown-price`,
          stripePriceId: `price_unknown_${TEST_RUN_ID}`,
          periodStart: PERIODS.skips.start,
          periodEnd: PERIODS.skips.end,
        },
        {
          lineId: `${TEST_LINE_PREFIX}-unlimited`,
          stripePriceId: UNLIMITED_STRIPE_PRICE_ID,
          periodStart: PERIODS.skips.start,
          periodEnd: PERIODS.skips.end,
        },
      ],
    });

    expect(result.granted).toEqual([]);
    expect(result.skipped).toEqual([
      { lineId: `${TEST_LINE_PREFIX}-unknown-price`, reason: "no_runtime_price" },
      { lineId: `${TEST_LINE_PREFIX}-unlimited`, reason: "not_credit_plan" },
    ]);
  });

  it("requires auth on the dormant endpoint but accepts CRON_SECRET for sweep mode", async () => {
    const endpoint = (await import("../runtime/credits/reconcile-invoice.js")).default as ApiHandler;

    const anonymousRes = await invoke(endpoint, {
      method: "POST",
      body: { sweep: true, client_id: randomUUID() },
    });
    expect(anonymousRes.statusCode).toBe(401);

    process.env.CRON_SECRET = `runtime-credit-engine-secret-${TEST_RUN_ID}`;
    const cronRes = await invoke(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: { sweep: true, client_id: randomUUID() },
    });

    expect(cronRes.statusCode).toBe(200);
    expect(Array.isArray(cronRes.body)).toBe(true);
    expect(await sweepLapsedCreditEntitlements(supabase, randomUUID())).toEqual([]);
  });
});

function invoiceInput(label: string, period: { start: string; end: string }): InvoiceGrantInput {
  return {
    tenantId: TENANT_ID,
    subscriptionId: originalSubscriptionId || MAYA_SUBSCRIPTION_ID,
    invoiceId: `${TEST_LINE_PREFIX}-invoice-${label}`,
    lines: [
      {
        lineId: `${TEST_LINE_PREFIX}-${label}`,
        stripePriceId: STEADY_STRIPE_PRICE_ID,
        periodStart: period.start,
        periodEnd: period.end,
      },
    ],
  };
}

async function insertDirectDebit(): Promise<void> {
  const { error } = await supabase.from("credit_ledger").insert({
    tenant_id: TENANT_ID,
    customer_entitlement_id: MAYA_ENTITLEMENT_ID,
    academy_membership_id: MAYA_MEMBERSHIP_ID,
    student_id: MAYA_STUDENT_ID,
    entry_type: "DEBIT",
    credit_delta: -1,
    effective_at: "2026-11-01T12:00:00.000Z",
    source: "admin",
    source_ref: `${TEST_DEBIT_PREFIX}:spent-one`,
    notes: "Runtime credit engine test debit.",
    metadata: { test_run_id: TEST_RUN_ID },
  });
  if (error) throw new Error(error.message);
}

async function balanceForMaya(): Promise<number> {
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("credit_delta")
    .eq("tenant_id", TENANT_ID)
    .eq("customer_entitlement_id", MAYA_ENTITLEMENT_ID);
  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data : []).reduce((sum, row) => sum + Number(row.credit_delta ?? 0), 0);
}

async function seededMemberSubscriptionId(): Promise<string | null> {
  const { data, error } = await supabase
    .from("members")
    .select("stripe_subscription_id")
    .eq("id", MAYA_MEMBER_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.stripe_subscription_id === "string" ? data.stripe_subscription_id : null;
}

async function setSeededMemberSubscriptionId(subscriptionId: string | null): Promise<void> {
  const { error } = await supabase
    .from("members")
    .update({ stripe_subscription_id: subscriptionId })
    .eq("id", MAYA_MEMBER_ID);
  if (error) throw new Error(error.message);
}

async function configFor(table: "entitlement_templates" | "customer_entitlements", id: string): Promise<JsonObject> {
  const { data, error } = await supabase.from(table).select("config").eq("id", id).single();
  if (error) throw new Error(error.message);
  return asRecord(data.config);
}

async function updateConfig(
  table: "entitlement_templates" | "customer_entitlements",
  id: string,
  config: JsonObject,
): Promise<void> {
  const { error } = await supabase.from(table).update({ config }).eq("id", id);
  if (error) throw new Error(error.message);
}

async function restoreConfigs(): Promise<void> {
  await updateConfig("entitlement_templates", STEADY_TEMPLATE_ID, originalTemplateConfig);
  await updateConfig("customer_entitlements", MAYA_ENTITLEMENT_ID, originalEntitlementConfig);
}

async function cleanupCreditEngineRows(): Promise<void> {
  await supabase
    .from("credit_ledger")
    .delete()
    .eq("tenant_id", TENANT_ID)
    .like("source_ref", "invoice_line:runtime-credit-engine-%");
  await supabase
    .from("credit_ledger")
    .delete()
    .eq("tenant_id", TENANT_ID)
    .like("source_ref", "runtime-credit-engine-debit:%");
  await supabase
    .from("credit_ledger")
    .delete()
    .eq("tenant_id", TENANT_ID)
    .in("source_ref", EXPIRY_SOURCE_REFS);
}

async function invoke(
  handler: ApiHandler,
  req: {
    method: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<MockResponse> {
  const res = mockResponse();
  await handler({
    method: req.method,
    headers: req.headers ?? {},
    query: req.query ?? {},
    body: req.body,
  }, res);
  return res;
}

function mockResponse(): MockResponse {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    ended: false,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    end(body?: unknown) {
      res.body = body;
      res.ended = true;
      return res;
    },
  };

  return res;
}

function restoreCronSecret(): void {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
    return;
  }
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
}

function expirySourceRef(periodStart: string): string {
  const normalized = new Date(periodStart).toISOString().replace(".000Z", "Z");
  return `entitlement_period:${MAYA_ENTITLEMENT_ID}:${normalized}`;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function assertLocalSupabase(): void {
  if (!runtimeTestSupabaseUrl.includes("127.0.0.1") && process.env.ALLOW_REMOTE_RUNTIME_TESTS !== "1") {
    throw new Error("Runtime credit engine tests only run against local Supabase by default.");
  }
}
