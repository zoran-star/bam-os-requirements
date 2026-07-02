import { withSentryApiRoute } from "../../_sentry.js";
import { createRuntimeSupabaseClient } from "../../_runtime/supabase.js";
import { getStaffContext } from "../_staff-context.js";
import type { RuntimeApiRequest, RuntimeApiResponse } from "../_types.js";
import {
  DEFAULT_TIME_ZONE,
  FieldValidationError,
  MAX_GENERATION_DAYS,
  assertValidTimeZone,
  dateFromUtcMs,
  daySpanInclusive,
  getClient,
  isUuid,
  localDateTimeToIso,
  parseRequiredDateOnly,
  queryParam,
  scheduleSlotColumns,
  sendScheduleError,
  supabaseHttpError,
  type FieldErrors,
  type ParsedDate,
  type ScheduleSlotRow,
} from "./_shared.js";

type EmbeddedCountRow = {
  id: string;
  reservations?: Array<{ count: number | string | null }>;
  trial_bookings?: Array<{ count: number | string | null }>;
  waitlist_entries?: Array<{ count: number | string | null }>;
};

type SlotSpotsTakenRow = {
  slot_id: string;
  spots_taken: number | string | null;
};

type CalendarSlotRow = ScheduleSlotRow & {
  reservation_count: number;
  trial_count: number;
  waitlist_count: number;
  spots_taken: number;
  spots_left: number;
};

type CalendarRequest = {
  clientId: string;
  dateFrom: ParsedDate;
  dateTo: ParsedDate;
};

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    await getStaffContext(req);
    const slots = await listCalendarSlots(req);
    return res.status(200).json({ slots });
  } catch (error) {
    return sendScheduleError(res, error);
  }
}

async function listCalendarSlots(req: RuntimeApiRequest): Promise<CalendarSlotRow[]> {
  const request = readCalendarRequest(req);
  const client = await getClient(request.clientId);
  if (!client) throw new FieldValidationError({ client_id: "client not found" });

  const timeZone = client.time_zone?.trim() || DEFAULT_TIME_ZONE;
  assertValidTimeZone(timeZone);

  const slots = await getSlotsForRange(request, timeZone);
  if (slots.length === 0) return [];

  const slotIds = slots.map((slot) => slot.id);
  const [reservationCounts, trialCounts, waitlistCounts, spotsTakenCounts] = await Promise.all([
    groupedCounts("reservations", slotIds, "CONFIRMED"),
    groupedCounts("trial_bookings", slotIds, "BOOKED"),
    groupedCounts("waitlist_entries", slotIds, "WAITING"),
    slotSpotsTakenBulk(request.clientId, slotIds),
  ]);

  return slots.map((slot) => {
    const reservationCount = reservationCounts.get(slot.id) ?? 0;
    const trialCount = trialCounts.get(slot.id) ?? 0;
    const waitlistCount = waitlistCounts.get(slot.id) ?? 0;
    // spots_taken is deliberately sourced from slot_spots_taken_bulk, not the
    // display-only reservation_count + trial_count fields above.
    const spotsTaken = spotsTakenCounts.get(slot.id) ?? 0;
    return {
      ...slot,
      reservation_count: reservationCount,
      trial_count: trialCount,
      waitlist_count: waitlistCount,
      spots_taken: spotsTaken,
      spots_left: Math.max(0, slot.capacity - spotsTaken),
    };
  });
}

function readCalendarRequest(req: RuntimeApiRequest): CalendarRequest {
  const errors: FieldErrors = {};
  const clientId = queryParam(req, "client_id");
  if (!clientId) errors.client_id = "is required";
  const dateFrom = parseRequiredDateOnly(queryParam(req, "date_from"), "date_from", errors);
  const dateTo = parseRequiredDateOnly(queryParam(req, "date_to"), "date_to", errors);

  if (clientId && !isUuid(clientId)) errors.client_id = "must be a valid UUID";
  if (dateFrom && dateTo) {
    if (dateTo.utcMs < dateFrom.utcMs) {
      errors.date_to = "must be on or after date_from";
    } else if (daySpanInclusive(dateFrom, dateTo) > MAX_GENERATION_DAYS) {
      errors.date_to = `range must be ${MAX_GENERATION_DAYS} days or fewer`;
    }
  }

  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);
  if (!clientId || !dateFrom || !dateTo) throw new FieldValidationError(errors);
  return { clientId, dateFrom, dateTo };
}

async function getSlotsForRange(request: CalendarRequest, timeZone: string): Promise<ScheduleSlotRow[]> {
  const startIso = localDateTimeToIso(request.dateFrom, "00:00:00", timeZone);
  const endExclusive = dateFromUtcMs(request.dateTo.utcMs + 86_400_000);
  const endIso = localDateTimeToIso(endExclusive, "00:00:00", timeZone);
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("schedule_slots")
    .select(scheduleSlotColumns)
    .eq("tenant_id", request.clientId)
    .gte("start_time", startIso)
    .lt("start_time", endIso)
    .order("start_time", { ascending: true });

  if (error) throw supabaseHttpError("schedule_slots", error.message);
  return rows<ScheduleSlotRow>(data);
}

async function slotSpotsTakenBulk(tenantId: string, slotIds: string[]): Promise<Map<string, number>> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase.rpc("slot_spots_taken_bulk", {
    p_tenant_id: tenantId,
    p_slot_ids: slotIds,
  });

  if (error) throw supabaseHttpError("slot_spots_taken_bulk", error.message);

  const counts = new Map<string, number>();
  for (const row of rows<SlotSpotsTakenRow>(data)) {
    counts.set(row.slot_id, Number(row.spots_taken ?? 0));
  }
  return counts;
}

async function groupedCounts(
  table: "reservations" | "trial_bookings" | "waitlist_entries",
  slotIds: string[],
  status: "CONFIRMED" | "BOOKED" | "WAITING",
): Promise<Map<string, number>> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("schedule_slots")
    .select(`id,${table}(count)`)
    .in("id", slotIds)
    .eq(`${table}.status`, status);

  if (error) throw supabaseHttpError(table, error.message);

  const counts = new Map<string, number>();
  for (const row of rows<EmbeddedCountRow>(data)) {
    const countRow = row[table]?.[0];
    counts.set(row.id, Number(countRow?.count ?? 0));
  }
  return counts;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export default withSentryApiRoute(handler);
