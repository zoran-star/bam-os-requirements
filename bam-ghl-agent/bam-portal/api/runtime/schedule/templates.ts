import { withSentryApiRoute } from "../../_sentry.js";
import { createRuntimeSupabaseClient } from "../../_runtime/supabase.js";
import { HttpError } from "../_errors.js";
import { getStaffContext } from "../_staff-context.js";
import type { RuntimeApiRequest, RuntimeApiResponse } from "../_types.js";
import {
  FieldValidationError,
  assertTimeOrder,
  ensureLocationBelongsToClient,
  getClient,
  isUuid,
  optionalNullableString,
  optionalUuid,
  parseNonNegativeInteger,
  parseOptionalBoolean,
  parseOptionalDateOnly,
  parseOptionalRecurrenceRule,
  parsePositiveInteger,
  parseRequiredTime,
  queryParam,
  readJsonObject,
  requiredNonEmptyString,
  requiredUuid,
  resolveBookableProgramId,
  sendScheduleError,
  slotTemplateWithLocationSelect,
  supabaseHttpError,
  type FieldErrors,
  type SlotTemplateMutation,
  type SlotTemplateWithLocationRow,
} from "./_shared.js";

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    await getStaffContext(req);

    if (req.method === "GET") {
      const templates = await listTemplates(req);
      return res.status(200).json({ templates });
    }

    const template = await createTemplate(req);
    return res.status(201).json({ template });
  } catch (error) {
    return sendScheduleError(res, error);
  }
}

async function listTemplates(req: RuntimeApiRequest): Promise<SlotTemplateWithLocationRow[]> {
  const clientId = queryParam(req, "client_id");
  if (!clientId) throw new HttpError(400, "client_id required");
  if (!isUuid(clientId)) throw new FieldValidationError({ client_id: "must be a valid UUID" });

  const supabase = createRuntimeSupabaseClient();
  let query = supabase
    .from("slot_templates")
    .select(slotTemplateWithLocationSelect)
    .eq("tenant_id", clientId)
    .order("name", { ascending: true });

  const active = queryParam(req, "active");
  if (active === "1") query = query.eq("is_active", true);
  if (active === "0") query = query.eq("is_active", false);
  if (active && active !== "1" && active !== "0") {
    throw new FieldValidationError({ active: "must be 1 or 0" });
  }

  const { data, error } = await query;
  if (error) throw supabaseHttpError("slot_templates", error.message);
  return rows<SlotTemplateWithLocationRow>(data);
}

async function createTemplate(req: RuntimeApiRequest): Promise<SlotTemplateWithLocationRow> {
  const body = readJsonObject(req.body);
  const values = await validatedCreateMutation(body);

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("slot_templates")
    .insert(values)
    .select(slotTemplateWithLocationSelect)
    .single();

  if (error) throw supabaseHttpError("slot_templates", error.message);
  return data as unknown as SlotTemplateWithLocationRow;
}

async function validatedCreateMutation(body: Record<string, unknown>): Promise<SlotTemplateMutation> {
  const errors: FieldErrors = {};
  const values: SlotTemplateMutation = {};

  const clientId = requiredUuid(body.client_id, "client_id", errors);
  const name = requiredNonEmptyString(body.name, "name", errors);
  const slotType = requiredNonEmptyString(body.slot_type, "slot_type", errors);
  const defaultStartTime = parseRequiredTime(body.default_start_time, "default_start_time", errors);
  const defaultEndTime = parseRequiredTime(body.default_end_time, "default_end_time", errors);
  const defaultCapacity = parsePositiveInteger(body.default_capacity, "default_capacity", errors, 10);
  const defaultCreditCost = parseNonNegativeInteger(body.default_credit_cost, "default_credit_cost", errors, 1);
  const description = optionalNullableString(body.description, "description", errors);
  const defaultLocation = optionalNullableString(body.default_location, "default_location", errors);
  const recurrenceRule = parseOptionalRecurrenceRule(body.recurrence_rule, "recurrence_rule", errors);
  const recurrenceEndDate = parseOptionalDateOnly(body.recurrence_end_date, "recurrence_end_date", errors);
  const locationId = optionalUuid(body.location_id, "location_id", errors);
  const bookableProgramId = optionalUuid(body.bookable_program_id, "bookable_program_id", errors);
  const isActive = parseOptionalBoolean(body.is_active, "is_active", errors);

  assertTimeOrder(defaultStartTime, defaultEndTime, errors);
  validateLengths({
    name,
    slot_type: slotType,
    default_location: defaultLocation,
    recurrence_rule: recurrenceRule,
  }, errors);

  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);
  if (!clientId || !name || !slotType || !defaultStartTime || !defaultEndTime) {
    throw new FieldValidationError(errors);
  }

  const client = await getClient(clientId);
  if (!client) errors.client_id = "client not found";
  if (typeof locationId === "string") await ensureLocationBelongsToClient(clientId, locationId, errors);
  const resolvedBookableProgramId = await resolveBookableProgramId(clientId, bookableProgramId, errors);
  if (Object.keys(errors).length > 0 || !resolvedBookableProgramId) throw new FieldValidationError(errors);

  values.tenant_id = clientId;
  values.name = name;
  values.slot_type = slotType;
  values.default_start_time = defaultStartTime;
  values.default_end_time = defaultEndTime;
  values.default_capacity = defaultCapacity;
  values.default_credit_cost = defaultCreditCost;
  values.bookable_program_id = resolvedBookableProgramId;

  if (description !== undefined) values.description = description;
  if (defaultLocation !== undefined) values.default_location = defaultLocation;
  if (recurrenceRule !== undefined) values.recurrence_rule = recurrenceRule;
  if (recurrenceEndDate !== undefined) values.recurrence_end_date = recurrenceEndDate;
  if (locationId !== undefined) values.location_id = locationId;
  if (isActive !== undefined) values.is_active = isActive;

  return values;
}

function validateLengths(
  values: {
    name?: string;
    slot_type?: string;
    default_location?: string | null;
    recurrence_rule?: string | null;
  },
  errors: FieldErrors,
): void {
  if (values.name && values.name.length > 255) errors.name = "must be 255 characters or fewer";
  if (values.slot_type && values.slot_type.length > 50) errors.slot_type = "must be 50 characters or fewer";
  if (values.default_location && values.default_location.length > 255) {
    errors.default_location = "must be 255 characters or fewer";
  }
  if (values.recurrence_rule && values.recurrence_rule.length > 500) {
    errors.recurrence_rule = "must be 500 characters or fewer";
  }
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export default withSentryApiRoute(handler);
