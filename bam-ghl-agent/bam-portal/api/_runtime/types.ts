import type { SupabaseClient } from "@supabase/supabase-js";

export type RuntimeSupabaseClient = SupabaseClient;

export type JsonObject = Record<string, unknown>;

export type MemberStatus =
  | "live"
  | "paused"
  | "payment_method_required"
  | "payment_failed"
  | "cancelling"
  | "cancelled";

export type RuntimeMember = {
  id: string;
  client_id: string;
  athlete_name: string;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  status: MemberStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  ghl_contact_id: string | null;
  joined_date: string | null;
  stripe_joined_at: string | null;
};

export type CustomerProfile = {
  id: string;
  supabase_user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_type: "PARENT" | "STUDENT";
  claimed_at: string | null;
};

export type Student = {
  id: string;
  parent_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  notes: string | null;
};

export type AcademyMembershipStatus = "ACTIVE" | "SUSPENDED" | "CANCELLED";

export type AcademyMembership = {
  id: string;
  academy_id: string;
  customer_id: string | null;
  student_id: string | null;
  plan_id: string | null;
  stripe_customer_id: string | null;
  status: AcademyMembershipStatus;
  joined_at: string;
  invited_by: string | null;
  ghl_contact_id: string | null;
};

export type MemberLink = {
  id: string;
  student_id: string;
  member_id: string;
  matched_by: "email" | "phone" | "manual";
  confirmed_at: string | null;
};

export type OfferPrice = {
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
  show_on_onboarding: boolean;
  sort_order: number;
};

export type EntitlementKind =
  | "WEEKLY_CREDITS"
  | "UNLIMITED_BOOKING"
  | "CREDIT_PACK"
  | "EVENT_REGISTRATION"
  | "TEAM_REGISTRATION"
  | "RENTAL_BOOKING";

export type EntitlementTemplate = {
  id: string;
  tenant_id: string;
  offer_price_id: string;
  bookable_program_id: string;
  entitlement_kind: EntitlementKind;
  scope_type: "STUDENT" | "CUSTOMER" | "TEAM" | "EVENT" | "LOCATION" | null;
  credits_per_period: number | null;
  credit_period: "WEEK" | "FOUR_WEEKS" | "MONTH" | "TERM" | "NONE" | null;
  is_unlimited: boolean;
  credit_cost_policy: "PER_SLOT_CREDIT_COST" | "ONE_CREDIT_PER_BOOKING" | "FREE" | null;
  config: JsonObject;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
};

export type CustomerEntitlementStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED";

export type CustomerEntitlement = {
  id: string;
  tenant_id: string;
  academy_membership_id: string;
  customer_id: string | null;
  student_id: string | null;
  scope_type: "STUDENT" | "CUSTOMER" | "TEAM" | "EVENT" | "LOCATION" | null;
  scope_id: string | null;
  entitlement_kind: EntitlementKind;
  status: CustomerEntitlementStatus;
  valid_from: string;
  valid_until: string | null;
  source: "manual" | "seed" | "stripe" | "import" | "admin";
  source_offer_price_id: string | null;
  source_entitlement_template_id: string | null;
  bookable_program_id: string;
  source_ref: string | null;
  config: JsonObject;
};

export type CreditLedgerEntry = {
  id: string;
  tenant_id: string;
  customer_entitlement_id: string;
  academy_membership_id: string;
  student_id: string | null;
  reservation_id: string | null;
  entry_type: "GRANT" | "DEBIT" | "REFUND" | "EXPIRE" | "ADJUSTMENT";
  credit_delta: number;
  effective_at: string;
  source: "manual" | "seed" | "stripe" | "booking" | "cancel" | "import" | "admin";
  source_ref: string | null;
  notes: string | null;
  metadata: JsonObject;
};
