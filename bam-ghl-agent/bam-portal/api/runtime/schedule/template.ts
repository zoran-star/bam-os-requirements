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
  parseOptionalTime,
  parsePositiveInteger,
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
  type SlotTemplateRow,
  type SlotTemplateWithLocationRow,
} from "./_shared.js";

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (req.method !== "PATCH" && req.method !== "DELETE") {
    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    await getStaffContext(req);

    const templateId = queryParam(req, "template_id");
    if (!templateId) throw new HttpError(400, "template_id required");
    if (!isUuid(templateId)) throw new FieldValidationError({ template_id: "must be a valid UUID" });

    const existing = await getTemplate(templateId);
    if (!existing) throw new HttpError(404, "template not found");

    if (req.method === "DELETE") {
      const futureSlotCount = await futureSlotCountForTemplate(templateId);
      if (futureSlotCount > 0) {
        return res.status(409).json({
          error: "template has future slots; deactivate it with is_active=false instead",
          future_slot_count: futureSlotCount,
        });
      }

      await deleteTemplate(templateId);
      return res.status(200).json({ ok: true });
    }

    const template = await patchTemplate(req, existing);
    return res.status(200).json({ template });
  } catch (error) {
    return sendScheduleError(res, error);
  }
}

async function getTemplate(templateId: string): Promise<SlotTemplateRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("slot_templates")
    .select(slotTemplateWithLocationSelect)
    .eq("id", templateId)
    .limit(1)
    .maybeSingle();

  if (error) throw supabaseHttpError("slot_templates", error.message);
  return data ? (data as unknown as SlotTemplateRow) : null;
}

async function patchTemplate(
  req: RuntimeApiRequest,
  existing: SlotTemplateRow,
): Promise<SlotTemplateWithLocationRow> {
  const body = readJsonObject(req.body);
  const values = await validatedPatchMutation(body, existing);
  if (Object.keys(values).length === 0) return existing as unknown as SlotTemplateWithLocationRow;

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("slot_templates")
    .update(values)
    .eq("id", existing.id)
    .select(slotTemplateWithLocationSelect)
    .single();

  if (error) throw supabaseHttpError("slot_templates", error.message);
  return data as unknown as SlotTemplateWithLocationRow;
}

async function validatedPatchMutation(
  body: Record<string, unknown>,
  existing: SlotTemplateRow,
): Promise<SlotTemplateMutation> {
  const errors: FieldErrors = {};
  const values: SlotTemplateMutation = {};
  const has = (field: string) => Object.prototype.hasOwnProperty.call(body, field);

  const clientId = has("client_id") ? requiredUuid(body.client_id, "client_id", errors) : undefined;
  const name = has("name") ? requiredNonEmptyString(body.name, "name", errors) : undefined;
  const slotType = has("slot_type") ? requiredNonEmptyString(body.slot_type, "slot_type", errors) : undefined;
  const defaultStartTime = has("default_start_time")
    ? parseOptionalTime(body.default_start_time, "default_start_time", errors)
    : undefined;
  const defaultEndTime = has("default_end_time")
    ? parseOptionalTime(body.default_end_time, "default_end_time", errors)
    : undefined;
  const defaultCapacity = has("default_capacity")
    ? parsePositiveInteger(body.default_capacity, "default_capacity", errors, undefined)
    : undefined;
  const defaultCreditCost = has("default_credit_cost")
    ? parseNonNegativeInteger(body.default_credit_cost, "default_credit_cost", errors, undefined)
    : undefined;
  const description = has("description") ? optionalNullableString(body.description, "description", errors) : undefined;
  const defaultLocation = has("default_location")
    ? optionalNullableString(body.default_location, "default_location", errors)
    : undefined;
  const recurrenceRule = has("recurrence_rule")
    ? parseOptionalRecurrenceRule(body.recurrence_rule, "recurrence_rule", errors)
    : undefined;
  const recurrenceEndDate = has("recurrence_end_date")
    ? parseOptionalDateOnly(body.recurrence_end_date, "recurrence_end_date", errors)
    : undefined;
  const locationId = has("location_id") ? optionalUuid(body.location_id, "location_id", errors) : undefined;
  const bookableProgramId = has("bookable_program_id")
    ? requiredUuid(body.bookable_program_id, "bookable_program_id", errors)
    : undefined;
  const isActive = has("is_active") ? parseOptionalBoolean(body.is_active, "is_active", errors) : undefined;

  assertTimeOrder(
    defaultStartTime ?? existing.default_start_time,
    defaultEndTime ?? existing.default_end_time,
    errors,
  );
  validateLengths({
    name,
    slot_type: slotType,
    default_location: defaultLocation,
    recurrence_rule: recurrenceRule,
  }, errors);

  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);

  const effectiveClientId = clientId ?? existing.tenant_id;
  if (clientId) {
    const client = await getClient(clientId);
    if (!client) errors.client_id = "client not found";
  }
  if (typeof locationId === "string") await ensureLocationBelongsToClient(effectiveClientId, locationId, errors);
  if (bookableProgramId) {
    const resolvedBookableProgramId = await resolveBookableProgramId(effectiveClientId, bookableProgramId, errors);
    if (resolvedBookableProgramId) values.bookable_program_id = resolvedBookableProgramId;
  }
  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);

  if (clientId) values.tenant_id = clientId;
  if (name !== undefined) values.name = name;
  if (slotType !== undefined) values.slot_type = slotType;
  if (defaultStartTime !== undefined) values.default_start_time = defaultStartTime;
  if (defaultEndTime !== undefined) values.default_end_time = defaultEndTime;
  if (defaultCapacity !== undefined) values.default_capacity = defaultCapacity;
  if (defaultCreditCost !== undefined) values.default_credit_cost = defaultCreditCost;
  if (description !== undefined) values.description = description;
  if (defaultLocation !== undefined) values.default_location = defaultLocation;
  if (recurrenceRule !== undefined) values.recurrence_rule = recurrenceRule;
  if (recurrenceEndDate !== undefined) values.recurrence_end_date = recurrenceEndDate;
  if (locationId !== undefined) values.location_id = locationId;
  if (isActive !== undefined) values.is_active = isActive;

  return values;
}

async function futureSlotCountForTemplate(templateId: string): Promise<number> {
  const supabase = createRuntimeSupabaseClient();
  const { count, error } = await supabase
    .from("schedule_slots")
    .select("id", { count: "exact", head: true })
    .eq("slot_template_id", templateId)
    .eq("is_cancelled", false)
    .gt("start_time", new Date().toISOString());

  if (error) throw supabaseHttpError("schedule_slots", error.message);
  return count ?? 0;
}

async function deleteTemplate(templateId: string): Promise<void> {
  const supabase = createRuntimeSupabaseClient();
  const { error } = await supabase
    .from("slot_templates")
    .delete()
    .eq("id", templateId);

  if (error) throw supabaseHttpError("slot_templates", error.message);
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

export default withSentryApiRoute(handler);
