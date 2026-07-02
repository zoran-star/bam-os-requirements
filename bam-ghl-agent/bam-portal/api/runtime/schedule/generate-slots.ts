import { withSentryApiRoute } from "../../_sentry.js";
import { createRuntimeSupabaseClient } from "../../_runtime/supabase.js";
import { HttpError } from "../_errors.js";
import { getStaffContext } from "../_staff-context.js";
import type { RuntimeApiRequest, RuntimeApiResponse } from "../_types.js";
import {
  DEFAULT_TIME_ZONE,
  FieldValidationError,
  MAX_GENERATION_DAYS,
  assertValidTimeZone,
  dateCompare,
  dateFromUtcMs,
  daySpanInclusive,
  getClient,
  isUuid,
  localDateTimeToIso,
  optionalUuid,
  parseRecurrenceRule,
  parseRequiredDateOnly,
  readJsonObject,
  requiredUuid,
  sendScheduleError,
  slotTemplateColumns,
  supabaseHttpError,
  weekdayToken,
  type FieldErrors,
  type GeneratedSlotRow,
  type ParsedDate,
  type ScheduleSlotInsert,
  type SlotTemplateRow,
} from "./_shared.js";

type GenerateSlotsResponse = {
  created: number;
  skipped_existing: number;
  skipped_no_recurrence: number;
  slots: GeneratedSlotRow[];
};

type GenerationRequest = {
  clientId: string;
  templateId?: string;
  dateFrom: ParsedDate;
  dateTo: ParsedDate;
};

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    await getStaffContext(req);
    const response = await generateSlots(req);
    return res.status(200).json(response);
  } catch (error) {
    return sendScheduleError(res, error);
  }
}

async function generateSlots(req: RuntimeApiRequest): Promise<GenerateSlotsResponse> {
  const request = await readGenerationRequest(req);
  const client = await getClient(request.clientId);
  if (!client) throw new FieldValidationError({ client_id: "client not found" });

  const timeZone = client.time_zone?.trim() || DEFAULT_TIME_ZONE;
  assertValidTimeZone(timeZone);

  const templates = await getTemplatesForGeneration(request.clientId, request.templateId);
  let skippedNoRecurrence = 0;
  const requestedRows: ScheduleSlotInsert[] = [];

  for (const template of templates) {
    const recurrenceRule = template.recurrence_rule?.trim();
    if (!recurrenceRule) {
      skippedNoRecurrence += 1;
      continue;
    }

    const weekdays = parseRecurrenceRule(recurrenceRule);
    if (!weekdays) {
      throw new HttpError(400, "invalid recurrence_rule", {
        template_id: template.id,
        recurrence_rule: recurrenceRule,
      });
    }

    requestedRows.push(...slotRowsForTemplate(template, weekdays, request.dateFrom, request.dateTo, timeZone));
  }

  if (requestedRows.length === 0) {
    return {
      created: 0,
      skipped_existing: 0,
      skipped_no_recurrence: skippedNoRecurrence,
      slots: [],
    };
  }

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("schedule_slots")
    .upsert(requestedRows, {
      onConflict: "tenant_id,slot_template_id,start_time",
      ignoreDuplicates: true,
    })
    .select("id,start_time,slot_template_id");

  if (error) throw supabaseHttpError("schedule_slots", error.message);

  const slots = rows<GeneratedSlotRow>(data);
  return {
    created: slots.length,
    skipped_existing: requestedRows.length - slots.length,
    skipped_no_recurrence: skippedNoRecurrence,
    slots,
  };
}

async function readGenerationRequest(req: RuntimeApiRequest): Promise<GenerationRequest> {
  const body = readJsonObject(req.body);
  const errors: FieldErrors = {};
  const clientId = requiredUuid(body.client_id, "client_id", errors);
  const rawTemplateId = optionalUuid(body.template_id, "template_id", errors);
  const dateFrom = parseRequiredDateOnly(body.date_from, "date_from", errors);
  const dateTo = parseRequiredDateOnly(body.date_to, "date_to", errors);

  if (dateFrom && dateTo) {
    if (dateTo.utcMs < dateFrom.utcMs) {
      errors.date_to = "must be on or after date_from";
    } else if (daySpanInclusive(dateFrom, dateTo) > MAX_GENERATION_DAYS) {
      errors.date_to = `range must be ${MAX_GENERATION_DAYS} days or fewer`;
    }
  }

  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);
  if (!clientId || !dateFrom || !dateTo) throw new FieldValidationError(errors);

  return {
    clientId,
    templateId: typeof rawTemplateId === "string" ? rawTemplateId : undefined,
    dateFrom,
    dateTo,
  };
}

async function getTemplatesForGeneration(clientId: string, templateId: string | undefined): Promise<SlotTemplateRow[]> {
  if (templateId && !isUuid(templateId)) throw new FieldValidationError({ template_id: "must be a valid UUID" });

  const supabase = createRuntimeSupabaseClient();
  let query = supabase
    .from("slot_templates")
    .select(slotTemplateColumns)
    .eq("tenant_id", clientId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (templateId) query = query.eq("id", templateId);

  const { data, error } = await query;
  if (error) throw supabaseHttpError("slot_templates", error.message);
  const templates = rows<SlotTemplateRow>(data);
  if (templateId && templates.length === 0) throw new HttpError(404, "template not found");
  return templates;
}

function slotRowsForTemplate(
  template: SlotTemplateRow,
  weekdays: string[],
  dateFrom: ParsedDate,
  dateTo: ParsedDate,
  timeZone: string,
): ScheduleSlotInsert[] {
  const weekdaySet = new Set(weekdays);
  const rowsOut: ScheduleSlotInsert[] = [];
  const dayCount = daySpanInclusive(dateFrom, dateTo);

  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = dateFromUtcMs(dateFrom.utcMs + (offset * 86_400_000));
    if (template.recurrence_end_date && dateCompare(date.iso, template.recurrence_end_date) > 0) continue;
    if (!weekdaySet.has(weekdayToken(date))) continue;

    rowsOut.push({
      tenant_id: template.tenant_id,
      name: template.name,
      description: template.description,
      slot_type: template.slot_type,
      location_label: template.default_location,
      capacity: template.default_capacity,
      credit_cost: template.default_credit_cost,
      instructor_id: template.default_instructor_id,
      start_time: localDateTimeToIso(date, template.default_start_time, timeZone),
      end_time: localDateTimeToIso(date, template.default_end_time, timeZone),
      slot_template_id: template.id,
      is_cancelled: false,
      location_id: template.location_id,
      source_offer_id: template.source_offer_id,
      source_offer_class_key: template.source_offer_class_key,
      offer_team_id: template.offer_team_id,
      bookable_program_id: template.bookable_program_id,
    });
  }

  return rowsOut;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export default withSentryApiRoute(handler);
