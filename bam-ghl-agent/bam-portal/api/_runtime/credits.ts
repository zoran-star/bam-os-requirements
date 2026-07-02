import { assertRows, assertSingle, isUniqueViolation } from "./supabase.js";
import type { CreditLedgerEntry, CustomerEntitlement, JsonObject, RuntimeSupabaseClient } from "./types.js";

type RecordCreditLedgerEntryArgs = {
  entitlement: CustomerEntitlement;
  entryType: CreditLedgerEntry["entry_type"];
  creditDelta: number;
  source: CreditLedgerEntry["source"];
  sourceRef: string | null;
  effectiveAt?: string;
  reservationId?: string | null;
  notes?: string | null;
  metadata?: JsonObject;
};

export async function grantCredits(
  supabase: RuntimeSupabaseClient,
  args: {
    entitlement: CustomerEntitlement;
    amount: number;
    sourceRef: string;
    effectiveAt?: string;
    notes?: string | null;
    metadata?: JsonObject;
  },
): Promise<CreditLedgerEntry> {
  if (args.amount <= 0) throw new Error("Credit grant amount must be positive.");
  if (!args.sourceRef.trim()) throw new Error("sourceRef is required for idempotent Stripe credit grants.");

  const existing = await findStripeGrant(supabase, args.entitlement, args.sourceRef);
  if (existing) return existing;

  const entryArgs: RecordCreditLedgerEntryArgs = {
    entitlement: args.entitlement,
    entryType: "GRANT",
    creditDelta: args.amount,
    source: "stripe",
    sourceRef: args.sourceRef,
    effectiveAt: args.effectiveAt,
    notes: args.notes ?? null,
    metadata: args.metadata ?? {},
  };

  const { data, error } = await insertCreditLedgerEntry(supabase, entryArgs);
  if (isUniqueViolation(error)) {
    const recovered = await findStripeGrant(supabase, args.entitlement, args.sourceRef);
    if (!recovered) {
      throw new Error(`Stripe credit grant for ${args.sourceRef} hit a unique conflict but could not be recovered.`);
    }
    return recovered;
  }
  return assertSingle<CreditLedgerEntry>(data, error);
}

export async function recordCreditLedgerEntry(
  supabase: RuntimeSupabaseClient,
  args: RecordCreditLedgerEntryArgs,
): Promise<CreditLedgerEntry> {
  const { data, error } = await insertCreditLedgerEntry(supabase, args);
  return assertSingle<CreditLedgerEntry>(data, error);
}

async function insertCreditLedgerEntry(
  supabase: RuntimeSupabaseClient,
  args: RecordCreditLedgerEntryArgs,
): Promise<{ data: unknown; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("credit_ledger")
    .insert({
      tenant_id: args.entitlement.tenant_id,
      customer_entitlement_id: args.entitlement.id,
      academy_membership_id: args.entitlement.academy_membership_id,
      student_id: args.entitlement.student_id,
      reservation_id: args.reservationId ?? null,
      entry_type: args.entryType,
      credit_delta: args.creditDelta,
      effective_at: args.effectiveAt ?? new Date().toISOString(),
      source: args.source,
      source_ref: args.sourceRef,
      notes: args.notes ?? null,
      metadata: args.metadata ?? {},
    })
    .select(creditLedgerSelect)
    .single();

  return { data, error };
}

async function findStripeGrant(
  supabase: RuntimeSupabaseClient,
  entitlement: CustomerEntitlement,
  sourceRef: string,
): Promise<CreditLedgerEntry | null> {
  const { data, error } = await supabase
    .from("credit_ledger")
    .select(creditLedgerSelect)
    .eq("tenant_id", entitlement.tenant_id)
    .eq("customer_entitlement_id", entitlement.id)
    .eq("entry_type", "GRANT")
    .eq("source", "stripe")
    .eq("source_ref", sourceRef)
    .limit(1);

  return assertRows<CreditLedgerEntry>(data, error)[0] ?? null;
}

const creditLedgerSelect = [
  "id",
  "tenant_id",
  "customer_entitlement_id",
  "academy_membership_id",
  "student_id",
  "reservation_id",
  "entry_type",
  "credit_delta",
  "effective_at",
  "source",
  "source_ref",
  "notes",
  "metadata",
].join(",");
