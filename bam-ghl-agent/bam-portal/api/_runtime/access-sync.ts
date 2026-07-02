// Phase 5 access sync: mirror Stripe payment lifecycle into typed access
// (identity spine + academy_membership + customer_entitlements).
//
// Called from api/stripe/webhook.js at the lifecycle points where the member
// row's state has settled. Gated per academy by clients.access_sync_mode:
//   off    - never runs (default; ships dormant per the wiring plan)
//   shadow - runs the full read path + logs what it WOULD write, writes nothing
//   on     - writes; the caller must surface failures as 5xx so Stripe retries
//
// Invariants (docs/parent-runtime-cutover-guardrails.md):
//   - access is granted only on paid invoices, never on subscription.created
//   - prices resolve authoritatively via offer_prices.stripe_price_id
//   - source_ref convention: subscription:<sub_id>:<price_id>, one-time
//     invoice:<invoice_id>:<price_id>
//   - idempotent: retries converge via the uq_customer_entitlements_source_ref
//     guard inside grantOrSyncEntitlementFromOfferPrice
//   - a price with no ACTIVE entitlement template must not mint access
//   - superseding an older grant (import backfill, previous plan) expires it,
//     never deletes it

import { ensureIdentitySpineFromMember } from "./identity.js";
import {
  grantOrSyncEntitlementFromOfferPrice,
  syncAccessStatusFromMemberStatus,
} from "./member-access.js";
import { assertRows } from "./supabase.js";
import type {
  CustomerEntitlement,
  EntitlementTemplate,
  OfferPrice,
  RuntimeMember,
  RuntimeSupabaseClient,
} from "./types.js";

export type AccessSyncMode = "off" | "shadow" | "on";

export type AccessSyncReason =
  | "invoice-paid"
  | "payment-failed"
  | "subscription-updated"
  | "subscription-deleted";

export type AccessSyncArgs = {
  clientId: string;
  memberId: string;
  reason: AccessSyncReason;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  // Authoritative price id from the Stripe subscription/invoice line when the
  // caller has it; falls back to the member row's stripe_price_id.
  stripePriceId?: string | null;
  // For subscription-deleted the legacy webhook deletes the member row right
  // after; the entitlement cancel must run first against the final status.
  overrideMemberStatus?: RuntimeMember["status"];
};

export type AccessSyncOutcome = {
  action: "granted" | "status-synced" | "skipped";
  reason: AccessSyncReason;
  skip_reason?: string;
  member_id?: string;
  entitlement_id?: string;
  source_ref?: string;
  superseded?: number;
  membership_status?: string | null;
  entitlement_count?: number;
};

export async function getAccessSyncMode(
  supabase: RuntimeSupabaseClient,
  clientId: string,
): Promise<AccessSyncMode> {
  const { data, error } = await supabase
    .from("clients")
    .select("access_sync_mode")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`access_sync_mode read failed: ${error.message}`);
  const mode = (data as { access_sync_mode?: string } | null)?.access_sync_mode;
  return mode === "on" || mode === "shadow" ? mode : "off";
}

function skip(reason: AccessSyncReason, why: string, memberId?: string): AccessSyncOutcome {
  return { action: "skipped", reason, skip_reason: why, member_id: memberId };
}

// Downgrade reasons only mirror status; paid/updated reasons (re)grant.
const GRANT_REASONS: ReadonlySet<AccessSyncReason> = new Set([
  "invoice-paid",
  "subscription-updated",
]);

export async function syncAccessForMember(
  supabase: RuntimeSupabaseClient,
  args: AccessSyncArgs,
  opts: { dryRun?: boolean } = {},
): Promise<AccessSyncOutcome> {
  const dryRun = opts.dryRun === true;

  // Re-fetch the member row: the legacy webhook has already settled its status
  // for this event, and the DB row (not the event payload) is what we mirror.
  const { data: memberRows, error: memberError } = await supabase
    .from("members")
    .select(
      "id, client_id, athlete_name, parent_name, parent_email, parent_phone, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, ghl_contact_id, joined_date, stripe_joined_at",
    )
    .eq("id", args.memberId)
    .eq("client_id", args.clientId)
    .limit(1);
  const memberRow = assertRows<RuntimeMember>(memberRows, memberError)[0];
  if (!memberRow) return skip(args.reason, "member not found", args.memberId);

  const member: RuntimeMember = args.overrideMemberStatus
    ? { ...memberRow, status: args.overrideMemberStatus }
    : memberRow;

  if (!GRANT_REASONS.has(args.reason)) {
    // payment-failed / subscription-deleted: cascade the member's (possibly
    // overridden) status onto membership + entitlements. No new access.
    if (dryRun) {
      return {
        action: "status-synced",
        reason: args.reason,
        member_id: member.id,
        membership_status: `(shadow) would sync from member status ${member.status}`,
        entitlement_count: 0,
      };
    }
    const synced = await syncAccessStatusFromMemberStatus(supabase, member);
    return {
      action: "status-synced",
      reason: args.reason,
      member_id: member.id,
      membership_status: synced.membershipStatus,
      entitlement_count: synced.entitlementCount,
    };
  }

  // ---- grant path (paid invoice / plan change) ----
  const priceId = args.stripePriceId || member.stripe_price_id;
  if (!priceId) return skip(args.reason, "no stripe_price_id on event or member", member.id);

  // Authoritative resolution: offer_prices.stripe_price_id is unique per tenant
  // (uq_offer_prices_stripe_price). Legacy prices are is_active=false but still
  // resolve - existing members keep access on plans no longer sold.
  const { data: priceRows, error: priceError } = await supabase
    .from("offer_prices")
    .select(
      "id, tenant_id, offer_option_id, title, amount_cents, currency, billing_interval, stripe_price_id, stripe_product_id, source_offer_id, source_offer_price_key, source_pricing_catalog_id, is_active, is_routable, sort_order",
    )
    .eq("tenant_id", args.clientId)
    .eq("stripe_price_id", priceId)
    .limit(1);
  const offerPrice = assertRows<OfferPrice>(priceRows, priceError)[0];
  if (!offerPrice) return skip(args.reason, `no typed offer_price for stripe price ${priceId}`, member.id);

  const { data: tplRows, error: tplError } = await supabase
    .from("entitlement_templates")
    .select(
      "id, tenant_id, offer_price_id, entitlement_kind, scope_type, credits_per_period, credit_period, is_unlimited, credit_cost_policy, config, status, bookable_program_id",
    )
    .eq("tenant_id", args.clientId)
    .eq("offer_price_id", offerPrice.id)
    .eq("status", "ACTIVE")
    .limit(1);
  const template = assertRows<EntitlementTemplate>(tplRows, tplError)[0];
  // No confirmed entitlement rule -> this price must not mint access.
  if (!template) return skip(args.reason, `no ACTIVE entitlement template for offer_price ${offerPrice.id}`, member.id);

  const sourceRef = args.subscriptionId
    ? `subscription:${args.subscriptionId}:${priceId}`
    : args.invoiceId
      ? `invoice:${args.invoiceId}:${priceId}`
      : null;
  if (!sourceRef) return skip(args.reason, "no subscription or invoice id for source_ref", member.id);

  if (dryRun) {
    return {
      action: "granted",
      reason: args.reason,
      member_id: member.id,
      source_ref: `(shadow) ${sourceRef}`,
      superseded: 0,
    };
  }

  const spine = await ensureIdentitySpineFromMember(supabase, member);
  const entitlement = await grantOrSyncEntitlementFromOfferPrice(supabase, {
    member,
    membership: spine.membership,
    offerPrice,
    template,
    source: "stripe",
    sourceRef,
  });

  // Supersede older ACTIVE grants for the same membership + program (the
  // import backfill, or the previous plan after a price change). Expire, never
  // delete - dormant-credit-engine ledger rows keep pointing at them.
  const superseded = await supersedeOtherActiveEntitlements(supabase, {
    tenantId: args.clientId,
    membershipId: spine.membership.id,
    bookableProgramId: template.bookable_program_id,
    keepEntitlementId: entitlement.id,
  });

  return {
    action: "granted",
    reason: args.reason,
    member_id: member.id,
    entitlement_id: entitlement.id,
    source_ref: sourceRef,
    superseded,
  };
}

async function supersedeOtherActiveEntitlements(
  supabase: RuntimeSupabaseClient,
  args: {
    tenantId: string;
    membershipId: string;
    bookableProgramId: string | null;
    keepEntitlementId: string;
  },
): Promise<number> {
  let query = supabase
    .from("customer_entitlements")
    .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
    .eq("tenant_id", args.tenantId)
    .eq("academy_membership_id", args.membershipId)
    .eq("status", "ACTIVE")
    .neq("id", args.keepEntitlementId);
  if (args.bookableProgramId) {
    query = query.eq("bookable_program_id", args.bookableProgramId);
  }
  const { data, error } = await query.select("id");
  const rows = assertRows<Pick<CustomerEntitlement, "id">>(data, error);
  return rows.length;
}
