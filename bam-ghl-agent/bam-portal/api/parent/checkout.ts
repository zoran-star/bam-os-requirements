import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import {
  getOwnedStudent,
  getParentReadContext,
  type ParentReadContext,
  type ParentReadStudent,
} from "./_parent-context.js";
import { eq, sb } from "./_supabase.js";
import {
  intervalFor,
  isTestMode,
  piSecretFromSub,
  stripeFetch,
  type StripeFetchOptions,
} from "./_stripe.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

const NOT_AVAILABLE_MESSAGE = "That plan is not available.";
const PAYMENT_SETUP_FAILED_MESSAGE = "Payment setup failed. Please try again.";

const OFFER_PRICE_SELECT = [
  "id",
  "tenant_id",
  "title",
  "amount_cents",
  "currency",
  "billing_interval",
  "stripe_price_id",
  "source_offer_id",
  "source_offer_price_key",
  "is_active",
  "is_routable",
].join(",");

type CheckoutRequest = {
  offer_price_id: string;
  student_id: string;
};

type OfferPriceRow = {
  amount_cents: number | null;
  billing_interval: string | null;
  currency: string | null;
  id: string;
  is_active: boolean | null;
  is_routable: boolean | null;
  source_offer_id: string | null;
  source_offer_price_key: string | null;
  stripe_price_id: string | null;
  tenant_id: string;
  title: string | null;
};

type ClientRow = {
  business_name: string | null;
  id: string;
  stripe_connect_account_id: string | null;
};

type MemberLinkRow = {
  id?: string;
  member_id: string;
  student_id?: string;
};

type MemberRow = {
  client_id: string;
  id: string;
  status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

type StripeCustomer = {
  id?: string;
};

type StripeList<T> = {
  data?: T[];
};

type StripePrice = {
  id?: string;
};

type StripeSubscription = {
  customer?: unknown;
  id?: string;
  latest_invoice?: unknown;
  metadata?: unknown;
  status?: string | null;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentReadContext(req);
    const request = readCheckoutRequest(req.body);
    const student = getOwnedStudent(context, request.student_id);
    const testMode = isTestMode();

    const price = await getOfferPrice(request.offer_price_id);
    assertPriceAvailable(price, testMode);

    // Purchase options are intentionally scoped to academies where the parent
    // already has a membership. First-purchase parents with zero memberships are
    // out of scope until the T2 discovery decision lands.
    if (!context.academyIds.includes(price.tenant_id)) {
      throw new HttpError(409, NOT_AVAILABLE_MESSAGE);
    }

    const client = await getClient(price.tenant_id);
    if (!client) throw new HttpError(409, NOT_AVAILABLE_MESSAGE);
    const stripeAccount = testMode ? null : client.stripe_connect_account_id;
    if (!testMode && !stripeAccount) {
      throw new HttpError(409, "academy is not connected to Stripe");
    }

    const term = price.billing_interval || "4_weeks";
    const plan = planFromPrice(price);
    const parentEmail = normalizeEmail(context.profile.email);
    const parentName = fullName(context.profile.first_name, context.profile.last_name) || null;
    const athleteName = fullName(student.first_name, student.last_name) || "Student";
    let member = await findLinkedMember(student.id);
    // member_links enforces ONE link per student (uq_member_links_student), and
    // the webhook identity spine resolves purchases through that link. If the
    // student's canonical member belongs to a different academy we cannot bind
    // this purchase, so refuse before any Stripe object is created.
    if (member && member.client_id !== price.tenant_id) {
      throw new HttpError(
        409,
        "This child's membership is managed by a different academy. Please contact the academy to set up this plan.",
      );
    }

    const reusable = await maybeReuseExistingSubscription({
      member,
      price,
      stripeAccount,
    });
    if (reusable) return res.status(200).json(reusable);

    // Stored customer ids came from live-mode sync (or seeds); they don't
    // exist on the platform test account, so test mode always resolves the
    // customer by email instead.
    let customerId = testMode
      ? null
      : member?.stripe_customer_id || membershipCustomerId(context, price.tenant_id, student.id);
    if (!customerId) {
      const found = await checkedStripeFetch<StripeList<StripeCustomer>>(
        `/customers?email=${encodeURIComponent(parentEmail)}&limit=1`,
        { stripeAccount },
      );
      customerId = found.data?.[0]?.id || null;
    }
    if (!customerId) {
      const customer = await checkedStripeFetch<StripeCustomer>("/customers", {
        body: {
          email: parentEmail,
          "metadata[source]": "fullcontrol-parent-app",
          "metadata[student_id]": student.id,
          name: parentName,
          phone: context.profile.phone,
        },
        method: "POST",
        stripeAccount,
      });
      customerId = customer.id || null;
    }
    if (!customerId) throw paymentSetupError(new Error("Stripe customer response did not include an id."));

    const priceIdToUse = await resolveStripePriceId(price, plan, term, testMode, stripeAccount);
    const sub = await checkedStripeFetch<StripeSubscription>("/subscriptions", {
      body: {
        customer: customerId,
        "expand[0]": "latest_invoice.payment_intent",
        "expand[1]": "latest_invoice.confirmation_secret",
        "items[0][price]": priceIdToUse,
        "metadata[athlete_name]": athleteName,
        "metadata[client_id]": price.tenant_id,
        "metadata[customer_profile_id]": context.profile.id,
        "metadata[offer_id]": price.source_offer_id,
        "metadata[offer_price_id]": price.id,
        "metadata[offer_price_key]": price.source_offer_price_key ?? "",
        "metadata[origin]": "fullcontrol-parent-app",
        "metadata[parent_email]": parentEmail,
        "metadata[plan]": plan,
        "metadata[student_id]": student.id,
        "metadata[term]": term,
        payment_behavior: "default_incomplete",
        "payment_settings[save_default_payment_method]": "on_subscription",
      },
      idempotencyKey: [
        "parent-sub-",
        testMode ? "test-" : "",
        price.tenant_id,
        "-",
        context.profile.id,
        "-",
        student.id,
        "-",
        price.id,
      ].join("").slice(0, 200),
      method: "POST",
      stripeAccount,
    });

    const subscriptionId = requireStripeId(sub.id, "Stripe subscription response did not include an id.");
    const clientSecret = piSecretFromSub(sub);
    if (!clientSecret) throw paymentSetupError(new Error("Stripe subscription response did not include a client secret."));

    member = await upsertMember({
      customerId,
      member,
      parentEmail,
      parentName,
      parentPhone: context.profile.phone,
      plan,
      price,
      student,
      subscriptionId,
    });
    await bindMemberToStudent(member.id, student.id);
    await auditCheckout({
      customerId,
      memberId: member.id,
      offerPriceId: price.id,
      plan,
      studentId: student.id,
      subId: subscriptionId,
      tenantId: price.tenant_id,
      term,
    });

    return res.status(200).json({
      ok: true,
      amount_cents: price.amount_cents,
      client_secret: clientSecret,
      currency: price.currency || "cad",
      customer_id: customerId,
      member_id: member.id,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
      stripe_account: stripeAccount,
      subscription_id: subscriptionId,
    });
  } catch (error) {
    if (isPaymentSetupError(error)) {
      return res.status(502).json({ error: PAYMENT_SETUP_FAILED_MESSAGE });
    }
    return sendError(res, error);
  }
}

function readCheckoutRequest(body: unknown): CheckoutRequest {
  const input = readJsonObject(body);

  return {
    offer_price_id: requiredTrimmedString(input.offer_price_id, "offer_price_id"),
    student_id: requiredTrimmedString(input.student_id, "student_id"),
  };
}

function readJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new HttpError(400, "Invalid JSON body.");
    }
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  throw new HttpError(400, "Expected JSON body.");
}

function requiredTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing required body field: ${fieldName}.`);
  }

  return value.trim();
}

async function getOfferPrice(offerPriceId: string): Promise<OfferPriceRow | null> {
  const rows = await sb<OfferPriceRow[]>(
    `offer_prices?id=eq.${eq(offerPriceId)}&select=${OFFER_PRICE_SELECT}&limit=1`,
  );
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

function assertPriceAvailable(price: OfferPriceRow | null, testMode: boolean): asserts price is OfferPriceRow {
  if (!price || !price.is_active || !price.is_routable) {
    throw new HttpError(409, NOT_AVAILABLE_MESSAGE);
  }

  if (!testMode && !price.stripe_price_id) {
    throw new HttpError(409, NOT_AVAILABLE_MESSAGE);
  }

  if (testMode && price.amount_cents == null) {
    throw new HttpError(409, NOT_AVAILABLE_MESSAGE);
  }
}

async function getClient(tenantId: string): Promise<ClientRow | null> {
  const rows = await sb<ClientRow[]>(
    `clients?id=eq.${eq(tenantId)}&select=id,business_name,stripe_connect_account_id&limit=1`,
  );
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

async function findLinkedMember(studentId: string): Promise<MemberRow | null> {
  const linkRows = await sb<MemberLinkRow[]>(
    `member_links?student_id=eq.${eq(studentId)}&select=member_id&limit=1`,
  );
  const memberId = Array.isArray(linkRows) ? linkRows[0]?.member_id : null;
  if (!memberId) return null;

  const memberRows = await sb<MemberRow[]>(
    `members?id=eq.${eq(memberId)}` +
      "&select=id,client_id,status,stripe_customer_id,stripe_subscription_id&limit=1",
  );
  return Array.isArray(memberRows) ? (memberRows[0] ?? null) : null;
}

async function maybeReuseExistingSubscription({
  member,
  price,
  stripeAccount,
}: {
  member: MemberRow | null;
  price: OfferPriceRow;
  stripeAccount: string | null;
}): Promise<Record<string, unknown> | null> {
  if (!member?.stripe_subscription_id) return null;

  let sub: StripeSubscription | null = null;
  try {
    sub = await stripeFetch<StripeSubscription>(
      `/subscriptions/${member.stripe_subscription_id}?expand[]=latest_invoice.payment_intent&expand[]=latest_invoice.confirmation_secret`,
      { stripeAccount },
    );
  } catch {
    return null;
  }

  if (sub.status === "incomplete") {
    // Only resume an in-flight sub for the SAME plan. A parent who backs out
    // and re-enters with a different plan must not be handed the old plan's
    // payment intent (it would charge the old amount). Cancel the stale
    // incomplete sub and fall through to a fresh one.
    if (subMetadataOfferPriceId(sub) !== price.id) {
      try {
        await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
          method: "DELETE",
          stripeAccount,
        });
      } catch {
        // Non-fatal: incomplete subs expire on their own.
      }
      return null;
    }

    const clientSecret = piSecretFromSub(sub);
    if (!clientSecret) return null;

    return {
      ok: true,
      amount_cents: price.amount_cents,
      client_secret: clientSecret,
      currency: price.currency || "cad",
      customer_id: stripeCustomerId(sub.customer) || member.stripe_customer_id,
      member_id: member.id,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
      reused: true,
      stripe_account: stripeAccount,
      subscription_id: sub.id || member.stripe_subscription_id,
    };
  }

  if (sub.status === "active" || sub.status === "trialing") {
    return {
      ok: true,
      already_active: true,
      member_id: member.id,
      subscription_id: sub.id || member.stripe_subscription_id,
    };
  }

  return null;
}

function membershipCustomerId(
  context: ParentReadContext,
  tenantId: string,
  studentId: string,
): string | null {
  const scoped = context.memberships.filter(
    (membership) => membership.academy_id === tenantId && membership.stripe_customer_id,
  );
  const studentScoped = scoped.find((membership) => membership.student_id === studentId);
  if (studentScoped?.stripe_customer_id) return studentScoped.stripe_customer_id;

  const profileScoped = scoped.find((membership) => membership.customer_id === context.profile.id);
  return profileScoped?.stripe_customer_id || null;
}

async function resolveStripePriceId(
  price: OfferPriceRow,
  plan: string,
  term: string,
  testMode: boolean,
  stripeAccount: string | null,
): Promise<string> {
  if (!testMode) {
    return requireStripeId(price.stripe_price_id, "Live offer price did not include a Stripe price id.");
  }

  if (price.amount_cents == null) throw new HttpError(409, NOT_AVAILABLE_MESSAGE);
  const interval = intervalFor(term);
  const testPrice = await checkedStripeFetch<StripePrice>("/prices", {
    body: {
      currency: price.currency || "cad",
      "product_data[name]": `${plan} (FC parent app test)`,
      "recurring[interval]": interval.interval,
      "recurring[interval_count]": interval.interval_count,
      unit_amount: price.amount_cents,
    },
    idempotencyKey: `parent-price-${price.id}-${price.amount_cents}`.slice(0, 200),
    method: "POST",
    stripeAccount,
  });

  return requireStripeId(testPrice.id, "Stripe price response did not include an id.");
}

async function upsertMember({
  customerId,
  member,
  parentEmail,
  parentName,
  parentPhone,
  plan,
  price,
  student,
  subscriptionId,
}: {
  customerId: string;
  member: MemberRow | null;
  parentEmail: string;
  parentName: string | null;
  parentPhone: string | null;
  plan: string;
  price: OfferPriceRow;
  student: ParentReadStudent;
  subscriptionId: string;
}): Promise<MemberRow> {
  const now = nowIso();
  const fields = {
    athlete_name: fullName(student.first_name, student.last_name) || "Student",
    client_id: price.tenant_id,
    parent_email: parentEmail,
    parent_name: parentName,
    parent_phone: parentPhone,
    plan,
    status: "payment_method_required",
    stripe_customer_id: customerId,
    stripe_price_id: price.stripe_price_id,
    stripe_subscription_id: subscriptionId,
    updated_at: now,
  };

  if (member) {
    await sb(`members?id=eq.${eq(member.id)}`, {
      body: JSON.stringify(fields),
      headers: { Prefer: "return=minimal" },
      method: "PATCH",
    });

    return {
      ...member,
      status: fields.status,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
    };
  }

  const inserted = await sb<MemberRow[]>("members?select=id,status,stripe_customer_id,stripe_subscription_id", {
    body: JSON.stringify([
      {
        ...fields,
        created_at: now,
        joined_date: new Date().toISOString().slice(0, 10),
      },
    ]),
    headers: { Prefer: "return=representation" },
    method: "POST",
  });
  const insertedMember = Array.isArray(inserted) ? (inserted[0] ?? null) : null;
  if (!insertedMember) throw new HttpError(502, "Member creation failed.");
  return insertedMember;
}

async function bindMemberToStudent(memberId: string, studentId: string): Promise<void> {
  const confirmedAt = nowIso();
  const existingRows = await sb<MemberLinkRow[]>(
    `member_links?member_id=eq.${eq(memberId)}&select=id,student_id,member_id&limit=1`,
  );
  const existing = Array.isArray(existingRows) ? (existingRows[0] ?? null) : null;

  if (existing) {
    await sb(`member_links?member_id=eq.${eq(memberId)}`, {
      body: JSON.stringify({
        confirmed_at: confirmedAt,
        matched_by: "manual",
      }),
      headers: { Prefer: "return=minimal" },
      method: "PATCH",
    });
    return;
  }

  try {
    await sb("member_links", {
      body: JSON.stringify([
        {
          confirmed_at: confirmedAt,
          matched_by: "manual",
          member_id: memberId,
          student_id: studentId,
        },
      ]),
      headers: { Prefer: "return=minimal" },
      method: "POST",
    });
  } catch (error) {
    // Unique-violation race (one link per student and per member): fine only
    // if the surviving row already binds this member. Anything else must fail
    // loudly — the webhook needs this link to attach the entitlement.
    const rows = await sb<MemberLinkRow[]>(
      `member_links?student_id=eq.${eq(studentId)}&select=member_id&limit=1`,
    );
    const survivor = Array.isArray(rows) ? (rows[0] ?? null) : null;
    if (survivor?.member_id !== memberId) throw error;
  }
}

async function auditCheckout({
  customerId,
  memberId,
  offerPriceId,
  plan,
  studentId,
  subId,
  tenantId,
  term,
}: {
  customerId: string;
  memberId: string;
  offerPriceId: string;
  plan: string;
  studentId: string;
  subId: string;
  tenantId: string;
  term: string;
}): Promise<void> {
  try {
    await sb("member_audit_log", {
      body: JSON.stringify([
        {
          action_type: "parent-app-checkout-created",
          args: {
            customer_id: customerId,
            offer_price_id: offerPriceId,
            plan,
            student_id: studentId,
            sub_id: subId,
            term,
          },
          client_id: tenantId,
          member_id: memberId,
          performed_by_name: "Parent app checkout",
        },
      ]),
      headers: { Prefer: "return=minimal" },
      method: "POST",
    });
  } catch {
    // Non-fatal; payment setup should not depend on audit logging.
  }
}

async function checkedStripeFetch<T>(
  path: string,
  options: StripeFetchOptions = {},
): Promise<T> {
  try {
    return await stripeFetch<T>(path, options);
  } catch (error) {
    throw paymentSetupError(error);
  }
}

function paymentSetupError(error: unknown): HttpError {
  console.error("[parent-checkout] Stripe request failed", errorMessage(error));
  return new HttpError(502, PAYMENT_SETUP_FAILED_MESSAGE);
}

function isPaymentSetupError(error: unknown): error is HttpError {
  return (
    error instanceof HttpError &&
    error.status === 502 &&
    error.message === PAYMENT_SETUP_FAILED_MESSAGE
  );
}

function requireStripeId(value: string | null | undefined, message: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw paymentSetupError(new Error(message));
}

function subMetadataOfferPriceId(sub: StripeSubscription): string | null {
  const metadata = sub.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as { offer_price_id?: unknown }).offer_price_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stripeCustomerId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

function planFromPrice(price: OfferPriceRow): string {
  return (price.source_offer_price_key || "").split("|")[0] || price.title || "Plan";
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].map((part) => part?.trim()).filter(Boolean).join(" ");
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default withSentryApiRoute(handler);
