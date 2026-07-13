import { withSentryApiRoute } from "../_sentry.js";
import { actionCancel, actionChange, actionPause, actionUnpause } from "../members.js";
import { HttpError, sendError } from "./_errors.js";
import {
  getOwnedStudent,
  getParentReadContext,
  membershipsForStudent,
  type ParentReadContext,
} from "./_parent-context.js";
import { eq, sb } from "./_supabase.js";
import { intervalFor, isTestMode, stripeFetch } from "./_stripe.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

type MemberLinkRow = {
  member_id: string;
};

type MemberRow = {
  athlete_name: string;
  client_id: string;
  id: string;
  parent_name: string | null;
  pause_scheduled_for: string | null;
  plan: string | null;
  status: string;
  stripe_customer_id: string | null;
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
};

type ClientRow = {
  business_name: string | null;
  id: string;
  stripe_connect_account_id: string | null;
  stripe_connect_status: string | null;
};

type PauseRow = {
  activated_at: string | null;
  completed_at: string | null;
  id: string;
  pause_end: string;
  pause_start: string;
};

type OfferPriceRow = {
  amount_cents: number | null;
  billing_interval: string | null;
  currency: string | null;
  id: string;
  is_active: boolean;
  is_routable: boolean;
  source_pricing_catalog_id: string | null;
  stripe_price_id: string | null;
  tenant_id: string;
  title: string | null;
};

type ResolvedMember = {
  client: ClientRow;
  context: ParentReadContext;
  member: MemberRow;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  try {
    const action = queryValue(req.query?.action);

    if (!action) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return await getManagementState(req, res);
    }

    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    if (action === "cancel") return await cancelPlan(req, res);
    if (action === "change-plan") return await changePlan(req, res);
    if (action === "pause") return await pausePlan(req, res);
    if (action === "resume") return await resumePlan(req, res);

    throw new HttpError(404, "Not found.");
  } catch (error) {
    return sendError(res, error);
  }
}

async function getManagementState(req: ParentApiRequest, res: ParentApiResponse) {
  const studentId = requiredString(queryValue(req.query?.student_id), "student_id");
  const resolved = await resolveOwnedMember(req, studentId);
  const pause =
    resolved.member.status === "cancelling" ? null : await getOpenPause(resolved.member.id);

  return res.status(200).json({
    academy_id: resolved.member.client_id,
    academy_name: resolved.client.business_name || "Academy",
    current_offer_price_id: await getCurrentOfferPriceId(resolved.member),
    member_status: resolved.member.status,
    pause: pause
      ? {
          end_date: pause.pause_end,
          start_date: pause.pause_start,
          status: pause.activated_at ? "ACTIVE" : "SCHEDULED",
        }
      : null,
    plan_name: resolved.member.plan,
    student_id: studentId,
    actions: {
      can_change_plan: canChangePlan(resolved.member),
      can_cancel: canCancel(resolved.member),
      can_pause: canPause(resolved.member),
      can_resume: Boolean(pause),
    },
  });
}

async function cancelPlan(req: ParentApiRequest, res: ParentApiResponse) {
  const body = readJsonObject(req.body);
  const studentId = requiredString(body.student_id, "student_id");
  const resolved = await resolveOwnedMember(req, studentId);

  // A lost response followed by a retry should converge on success rather than
  // showing an error after Stripe and the member row were already updated.
  if (resolved.member.status === "cancelling") {
    return res.status(200).json({ ok: true });
  }
  if (!canCancel(resolved.member)) {
    throw new HttpError(409, "This membership cannot be cancelled right now.");
  }

  return await actionCancel(
    parentMutationResponse(res),
    resolved.member,
    stripeAccountFor(resolved.client),
    actionContext(resolved.context),
    {
      immediate: false,
      operation_id: optionalUuid(body.operation_id, "operation_id"),
      reason: optionalString(body.reason),
      source: "parent_app",
    },
  );
}

async function changePlan(req: ParentApiRequest, res: ParentApiResponse) {
  const body = readJsonObject(req.body);
  const studentId = requiredString(body.student_id, "student_id");
  const offerPriceId = requiredString(body.offer_price_id, "offer_price_id");
  const operationId = optionalUuid(body.operation_id, "operation_id");
  const resolved = await resolveOwnedMember(req, studentId);

  if (!canChangePlan(resolved.member)) {
    throw new HttpError(409, "This membership cannot change plans right now.");
  }

  const price = await getOfferPrice(offerPriceId);
  if (
    !price ||
    !price.is_active ||
    !price.is_routable ||
    !price.stripe_price_id ||
    price.tenant_id !== resolved.member.client_id
  ) {
    throw new HttpError(409, "That plan is not available.");
  }

  return await actionChange(
    parentMutationResponse(res),
    resolved.member,
    stripeAccountFor(resolved.client),
    actionContext(resolved.context),
    {
      catalog_price_id: price.stripe_price_id,
      new_price_id: price.stripe_price_id,
      operation_id: operationId,
      source: "parent_app",
      stripe_target_price_id: await resolveTargetStripePrice(price),
    },
  );
}

async function pausePlan(req: ParentApiRequest, res: ParentApiResponse) {
  const body = readJsonObject(req.body);
  const studentId = requiredString(body.student_id, "student_id");
  const resolved = await resolveOwnedMember(req, studentId);

  if (!canPause(resolved.member)) {
    throw new HttpError(409, "This membership cannot be paused right now.");
  }

  return await actionPause(
    parentMutationResponse(res),
    resolved.member,
    stripeAccountFor(resolved.client),
    actionContext(resolved.context),
    {
      end_date: requiredDate(body.end_date, "end_date"),
      operation_id: optionalUuid(body.operation_id, "operation_id"),
      reason: optionalString(body.reason),
      source: "parent_app",
      start_date: requiredDate(body.start_date, "start_date"),
    },
  );
}

async function resumePlan(req: ParentApiRequest, res: ParentApiResponse) {
  const body = readJsonObject(req.body);
  const studentId = requiredString(body.student_id, "student_id");
  const resolved = await resolveOwnedMember(req, studentId);
  const pause = await getOpenPause(resolved.member.id);
  if (!pause) throw new HttpError(409, "This membership is not paused.");

  return await actionUnpause(
    parentMutationResponse(res),
    resolved.member,
    stripeAccountFor(resolved.client),
    actionContext(resolved.context),
    {
      operation_id: optionalUuid(body.operation_id, "operation_id"),
      source: "parent_app",
    },
  );
}

async function resolveOwnedMember(
  req: ParentApiRequest,
  studentId: string,
): Promise<ResolvedMember> {
  const context = await getParentReadContext(req);
  getOwnedStudent(context, studentId);

  const links = await sb<MemberLinkRow[]>(
    `member_links?student_id=eq.${eq(studentId)}&select=member_id&limit=1`,
  );
  const memberId = Array.isArray(links) ? links[0]?.member_id : null;
  if (!memberId) throw new HttpError(404, "Active membership not found.");

  const members = await sb<MemberRow[]>(
    `members?id=eq.${eq(memberId)}` +
      "&select=id,client_id,athlete_name,parent_name,plan,status,stripe_customer_id,stripe_subscription_id,stripe_price_id,pause_scheduled_for" +
      "&limit=1",
  );
  const member = Array.isArray(members) ? members[0] : null;
  if (!member) throw new HttpError(404, "Active membership not found.");

  const academyMembership = membershipsForStudent(context, studentId).find(
    (membership) =>
      membership.academy_id === member.client_id && membership.status !== "CANCELLED",
  );
  if (!academyMembership) throw new HttpError(404, "Active membership not found.");

  const clients = await sb<ClientRow[]>(
    `clients?id=eq.${eq(member.client_id)}` +
      "&select=id,business_name,stripe_connect_account_id,stripe_connect_status&limit=1",
  );
  const client = Array.isArray(clients) ? clients[0] : null;
  if (!client) throw new HttpError(404, "Academy not found.");
  if (!isTestMode() && (!client.stripe_connect_account_id || client.stripe_connect_status !== "connected")) {
    throw new HttpError(409, "This academy is not ready for membership changes.");
  }

  return { client, context, member };
}

async function getOfferPrice(id: string): Promise<OfferPriceRow | null> {
  const rows = await sb<OfferPriceRow[]>(
    `offer_prices?id=eq.${eq(id)}` +
      "&select=id,tenant_id,title,amount_cents,currency,billing_interval,stripe_price_id,source_pricing_catalog_id,is_active,is_routable&limit=1",
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function resolveTargetStripePrice(price: OfferPriceRow): Promise<string> {
  if (!isTestMode()) return requiredString(price.stripe_price_id, "stripe_price_id");
  if (price.amount_cents == null) throw new HttpError(409, "That plan is not available.");

  const interval = intervalFor(price.billing_interval);
  const created = await stripeFetch<{ id?: string }>("/prices", {
    body: {
      currency: price.currency || "cad",
      "product_data[name]": `${price.title || "Membership"} (FC parent app test)`,
      "recurring[interval]": interval.interval,
      "recurring[interval_count]": interval.interval_count,
      unit_amount: price.amount_cents,
    },
    idempotencyKey: `parent-price-${price.id}-${price.amount_cents}`.slice(0, 200),
    method: "POST",
    stripeAccount: null,
  });
  if (!created.id) throw new HttpError(502, "Could not prepare that plan.");
  return created.id;
}

async function getCurrentOfferPriceId(member: MemberRow): Promise<string | null> {
  if (!member.stripe_price_id) return null;
  const rows = await sb<Array<{ id: string }>>(
    `offer_prices?tenant_id=eq.${eq(member.client_id)}` +
      `&stripe_price_id=eq.${eq(member.stripe_price_id)}&select=id&limit=1`,
  );
  return Array.isArray(rows) ? rows[0]?.id ?? null : null;
}

async function getOpenPause(memberId: string): Promise<PauseRow | null> {
  const rows = await sb<PauseRow[]>(
    `cancellations?member_id=eq.${eq(memberId)}` +
      "&type=eq.pause&completed_at=is.null" +
      "&select=id,pause_start,pause_end,activated_at,completed_at" +
      "&order=created_at.desc&limit=1",
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

function actionContext(context: ParentReadContext) {
  return {
    staff: {
      name: `${context.profile.first_name} ${context.profile.last_name}`.trim(),
    },
    user: context.user,
  };
}

function stripeAccountFor(client: ClientRow): string | null {
  return isTestMode() ? null : client.stripe_connect_account_id;
}

function canChangePlan(member: MemberRow): boolean {
  return Boolean(member.stripe_subscription_id) && !["cancelling", "payment_failed"].includes(member.status);
}

function canCancel(member: MemberRow): boolean {
  return Boolean(member.stripe_subscription_id) && member.status !== "cancelling";
}

function canPause(member: MemberRow): boolean {
  return Boolean(member.stripe_subscription_id) && !["cancelling", "payment_failed"].includes(member.status);
}

function queryValue(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
  return typeof value === "string" && value.length > 0 ? value : null;
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

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing required field: ${fieldName}.`);
  }
  return value.trim();
}

function requiredDate(value: unknown, fieldName: string): string {
  const date = requiredString(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, `${fieldName} must be YYYY-MM-DD.`);
  }
  return date;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalUuid(value: unknown, fieldName: string): string | null {
  if (value == null || value === "") return null;
  const text = requiredString(value, fieldName);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new HttpError(400, `${fieldName} must be a UUID.`);
  }
  return text;
}

function methodNotAllowed(res: ParentApiResponse, allow: string) {
  res.setHeader("Allow", allow);
  return res.status(405).json({ error: "method not allowed" });
}

function parentMutationResponse(res: ParentApiResponse): ParentApiResponse {
  let statusCode = 200;
  const response: ParentApiResponse = {
    json(body) {
      return res.json(statusCode >= 200 && statusCode < 300 ? { ok: true } : body);
    },
    setHeader(name, value) {
      res.setHeader(name, value);
      return response;
    },
    status(code) {
      statusCode = code;
      res.status(code);
      return response;
    },
  };
  return response;
}

export default withSentryApiRoute(handler);
