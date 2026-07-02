import { withSentryApiRoute } from "../_sentry.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import { HttpError, sendError } from "./_errors.js";
import { getStaffContext } from "./_staff-context.js";
import type { HeaderValue, RuntimeApiRequest, RuntimeApiResponse } from "./_types.js";
import {
  DEFAULT_TIME_ZONE,
  dateFromUtcMs,
  isUuid,
  localDateTimeToIso,
  parseDateOnly,
  readJsonObject,
  type ParsedDate,
} from "./schedule/_shared.js";

type TrialBookingStatus = "BOOKED" | "CANCELLED" | "SHOWED" | "NO_SHOW" | "CONVERTED";
type OutcomeStatus = "SHOWED" | "NO_SHOW";
type FieldErrors = Record<string, string>;

type ClientRow = {
  id: string;
  time_zone: string | null;
};

type SlotRow = {
  id: string;
  name: string;
  start_time: string;
};

type TrialBookingRow = {
  id: string;
  tenant_id: string;
  slot_id: string;
  bookable_program_id: string | null;
  entry_point_id: string | null;
  offer_id: string | null;
  ghl_contact_id: string | null;
  parent_name: string;
  parent_email: string;
  parent_phone: string | null;
  athlete_name: string;
  athlete_dob: string | null;
  status: TrialBookingStatus;
  source: string;
  booked_at: string;
  cancelled_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ListRequest = {
  clientId: string;
  slotId: string | null;
  status: TrialBookingStatus | null;
  dateFrom: ParsedDate | null;
  dateTo: ParsedDate | null;
  timeZone: string;
};

class ValidationError extends Error {
  readonly fields: FieldErrors;

  constructor(fields: FieldErrors) {
    super("validation failed");
    this.fields = fields;
  }
}

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    await getStaffContext(req);
    if (req.method === "GET") {
      return res.status(200).json({ bookings: await listTrialBookings(req) });
    }

    const action = queryParam(req, "action");
    if (action === "outcome") {
      return res.status(200).json(await setTrialOutcome(req));
    }
    return res.status(404).json({ error: "not found" });
  } catch (error) {
    return sendTrialBookingsError(res, error);
  }
}

async function listTrialBookings(req: RuntimeApiRequest) {
  const request = await readListRequest(req);
  const slotFilter = await resolveSlotFilter(request);
  if (slotFilter.required && slotFilter.slots.length === 0) return [];

  const bookings = await getTrialBookings(request, slotFilter.slots.map((slot) => slot.id));
  if (bookings.length === 0) return [];

  const slotMap = await slotsById(
    bookings.map((booking) => booking.slot_id),
    slotFilter.slots,
  );

  return bookings
    .map((booking) => {
      const slot = slotMap.get(booking.slot_id) ?? null;
      return {
        ...booking,
        slot: slot ? { id: slot.id, name: slot.name, start_time: slot.start_time } : null,
      };
    })
    .sort((left, right) => compareSlotStart(left.slot?.start_time, right.slot?.start_time));
}

async function readListRequest(req: RuntimeApiRequest): Promise<ListRequest> {
  const errors: FieldErrors = {};
  const clientId = queryParam(req, "client_id");
  const slotId = queryParam(req, "slot_id");
  const status = normalizeStatus(queryParam(req, "status"), errors);
  const dateFrom = parseQueryDate(req, "date_from", errors);
  const dateTo = parseQueryDate(req, "date_to", errors);

  if (!clientId) errors.client_id = "is required";
  else if (!isUuid(clientId)) errors.client_id = "must be a valid UUID";
  if (slotId && !isUuid(slotId)) errors.slot_id = "must be a valid UUID";
  if (dateFrom && dateTo && dateTo.utcMs < dateFrom.utcMs) {
    errors.date_to = "must be on or after date_from";
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  if (!clientId) throw new ValidationError(errors);

  const client = await getClient(clientId);
  if (!client) throw new ValidationError({ client_id: "client not found" });
  const timeZone = client.time_zone?.trim() || DEFAULT_TIME_ZONE;
  assertValidTimeZone(timeZone);

  return { clientId, slotId: slotId || null, status, dateFrom, dateTo, timeZone };
}

async function resolveSlotFilter(
  request: ListRequest,
): Promise<{ required: boolean; slots: SlotRow[] }> {
  if (!request.slotId && !request.dateFrom && !request.dateTo) {
    return { required: false, slots: [] };
  }

  const supabase = createRuntimeSupabaseClient();
  let query = supabase
    .from("schedule_slots")
    .select("id,name,start_time")
    .eq("tenant_id", request.clientId)
    .order("start_time", { ascending: true });

  if (request.slotId) query = query.eq("id", request.slotId);
  if (request.dateFrom) {
    query = query.gte("start_time", localDateTimeToIso(request.dateFrom, "00:00:00", request.timeZone));
  }
  if (request.dateTo) {
    const endExclusive = dateFromUtcMs(request.dateTo.utcMs + 86_400_000);
    query = query.lt("start_time", localDateTimeToIso(endExclusive, "00:00:00", request.timeZone));
  }

  const { data, error } = await query;
  if (error) throw supabaseError("schedule_slots", error.message);
  return { required: true, slots: rows<SlotRow>(data) };
}

async function getTrialBookings(request: ListRequest, filteredSlotIds: string[]): Promise<TrialBookingRow[]> {
  const supabase = createRuntimeSupabaseClient();
  let query = supabase
    .from("trial_bookings")
    .select([
      "id",
      "tenant_id",
      "slot_id",
      "bookable_program_id",
      "entry_point_id",
      "offer_id",
      "ghl_contact_id",
      "parent_name",
      "parent_email",
      "parent_phone",
      "athlete_name",
      "athlete_dob",
      "status",
      "source",
      "booked_at",
      "cancelled_at",
      "metadata",
      "created_at",
      "updated_at",
    ].join(","))
    .eq("tenant_id", request.clientId);

  if (request.status) query = query.eq("status", request.status);
  if (filteredSlotIds.length > 0) query = query.in("slot_id", filteredSlotIds);

  const { data, error } = await query;
  if (error) throw supabaseError("trial_bookings", error.message);
  return rows<TrialBookingRow>(data);
}

async function slotsById(slotIds: string[], prefetchedSlots: SlotRow[]): Promise<Map<string, SlotRow>> {
  const byId = new Map<string, SlotRow>();
  for (const slot of prefetchedSlots) byId.set(slot.id, slot);

  const missingIds = uniqueValues(slotIds).filter((slotId) => !byId.has(slotId));
  if (missingIds.length === 0) return byId;

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("schedule_slots")
    .select("id,name,start_time")
    .in("id", missingIds);

  if (error) throw supabaseError("schedule_slots", error.message);
  for (const slot of rows<SlotRow>(data)) byId.set(slot.id, slot);
  return byId;
}

async function setTrialOutcome(req: RuntimeApiRequest) {
  const trialBookingId = queryParam(req, "trial_booking_id");
  const errors: FieldErrors = {};
  if (!trialBookingId) errors.trial_booking_id = "is required";
  else if (!isUuid(trialBookingId)) errors.trial_booking_id = "must be a valid UUID";

  const body = readJsonObject(req.body);
  const status = normalizeOutcome(body.status, errors);

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  if (!trialBookingId || !status) throw new ValidationError(errors);

  const booking = await getTrialBooking(trialBookingId);
  if (!booking) throw new HttpError(404, "Trial booking not found.");

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase.rpc("set_trial_outcome", {
    p_tenant_id: booking.tenant_id,
    p_trial_booking_id: booking.id,
    p_status: status,
  });

  if (error) throw trialRpcError(error.message);
  return {
    trial_booking_id: booking.id,
    status,
    changed: Boolean(data),
  };
}

async function getTrialBooking(trialBookingId: string): Promise<TrialBookingRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("trial_bookings")
    .select("id,tenant_id,slot_id,bookable_program_id,entry_point_id,offer_id,ghl_contact_id,parent_name,parent_email,parent_phone,athlete_name,athlete_dob,status,source,booked_at,cancelled_at,metadata,created_at,updated_at")
    .eq("id", trialBookingId)
    .limit(1)
    .maybeSingle();

  if (error) throw supabaseError("trial_bookings", error.message);
  return data ? (data as TrialBookingRow) : null;
}

async function getClient(clientId: string): Promise<ClientRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id,time_zone")
    .eq("id", clientId)
    .limit(1)
    .maybeSingle();

  if (error) throw supabaseError("clients", error.message);
  return data ? (data as ClientRow) : null;
}

function normalizeStatus(value: string, errors: FieldErrors): TrialBookingStatus | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (isTrialBookingStatus(normalized)) return normalized;
  errors.status = "must be one of BOOKED, CANCELLED, SHOWED, NO_SHOW, CONVERTED";
  return null;
}

function normalizeOutcome(value: unknown, errors: FieldErrors): OutcomeStatus | null {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "SHOWED" || normalized === "NO_SHOW") return normalized;
  errors.status = "must be SHOWED or NO_SHOW";
  return null;
}

function isTrialBookingStatus(value: string): value is TrialBookingStatus {
  return value === "BOOKED" ||
    value === "CANCELLED" ||
    value === "SHOWED" ||
    value === "NO_SHOW" ||
    value === "CONVERTED";
}

function parseQueryDate(req: RuntimeApiRequest, name: string, errors: FieldErrors): ParsedDate | null {
  const value = queryParam(req, name);
  if (!value) return null;
  const parsed = parseDateOnly(value);
  if (!parsed) errors[name] = "must be an ISO date";
  return parsed;
}

function trialRpcError(message: string): HttpError {
  const normalized = message.trim();
  if (normalized.includes("not found")) return new HttpError(404, normalized);
  if (normalized.includes("current status")) return new HttpError(409, normalized);
  return new HttpError(400, normalized || "Trial booking update failed.");
}

function supabaseError(table: string, message: string): HttpError {
  return new HttpError(502, "Supabase request failed", { table, message });
}

function sendTrialBookingsError(res: RuntimeApiResponse, error: unknown) {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message, fields: error.fields });
  }
  return sendError(res, error);
}

function queryParam(req: RuntimeApiRequest, name: string): string {
  return queryValue(req.query?.[name]);
}

function queryValue(value: HeaderValue): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw supabaseError("clients", `Invalid client time_zone: ${timeZone}`);
  }
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function compareSlotStart(left: string | undefined, right: string | undefined): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return new Date(left).getTime() - new Date(right).getTime();
}

export default withSentryApiRoute(handler);
