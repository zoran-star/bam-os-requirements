// Public endpoint - trial slots for the website booking funnel.
//
//   GET /api/website/trial-slots?client_id=<uuid>&bookable_program_id=<uuid optional>&date_from&date_to
//     -> { slots: [...] }
//
// entry_point_id resolution is intentionally deferred until the shared
// entry_points table has finished syncing from Zoran. For now the website
// supplies client_id and, optionally, bookable_program_id directly.

import { withSentryApiRoute } from "../_sentry.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import type { HeaderValue, RuntimeApiRequest, RuntimeApiResponse } from "../runtime/_types.js";
import {
  DEFAULT_TIME_ZONE,
  dateFromUtcMs,
  daySpanInclusive,
  isUuid,
  localDateTimeToIso,
  parseDateOnly,
  type ParsedDate,
} from "../runtime/schedule/_shared.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const MAX_TRIAL_SLOT_DAYS = 92;
const DEFAULT_TRIAL_SLOT_DAYS = 14;
const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

let originsCache: { set: Set<string> | null; at: number } = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

type FieldErrors = Record<string, string>;

type ClientRow = {
  id: string;
  time_zone: string | null;
};

type ScheduleSlotRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  slot_type: string;
  location_label: string | null;
  start_time: string;
  end_time: string;
  capacity: number;
  credit_cost: number | null;
  bookable_program_id: string;
  is_cancelled: boolean;
};

type EmbeddedCountRow = {
  id: string;
  reservations?: Array<{ count: number | string | null }>;
  trial_bookings?: Array<{ count: number | string | null }>;
};

type TrialSlotRequest = {
  clientId: string;
  bookableProgramId: string | null;
  dateFrom: ParsedDate;
  dateTo: ParsedDate;
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
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });
  const allowed = await setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  try {
    const request = await readTrialSlotRequest(req);
    const slots = await listTrialSlots(request);
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ slots });
  } catch (error) {
    return sendWebsiteError(res, error);
  }
}

async function setCors(req: RuntimeApiRequest, res: RuntimeApiResponse): Promise<boolean> {
  const origin = stringHeader(req.headers.origin);
  let allowed = false;
  try { allowed = (await getAllowedOrigins()).has(origin); } catch { /* 403 below */ }
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return allowed;
}

async function getAllowedOrigins(): Promise<Set<string>> {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.set;
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq<Array<{ allowed_domains: string[] | null }>>(
    "clients?select=allowed_domains&allowed_domains=not.is.null",
  );
  for (const row of rows || []) {
    for (const domain of row.allowed_domains || []) {
      set.add(`https://${domain}`);
      set.add(`https://www.${domain}`);
    }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

async function sbReq<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function readTrialSlotRequest(req: RuntimeApiRequest): Promise<TrialSlotRequest> {
  const errors: FieldErrors = {};
  const clientId = queryParam(req, "client_id");
  const bookableProgramId = queryParam(req, "bookable_program_id");

  if (!clientId) errors.client_id = "is required";
  else if (!isUuid(clientId)) errors.client_id = "must be a valid UUID";

  if (bookableProgramId && !isUuid(bookableProgramId)) {
    errors.bookable_program_id = "must be a valid UUID";
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  if (!clientId) throw new ValidationError(errors);

  const client = await getClient(clientId);
  if (!client) throw new ValidationError({ client_id: "client not found" });

  const timeZone = client.time_zone?.trim() || DEFAULT_TIME_ZONE;
  assertValidTimeZone(timeZone);
  const today = parseKnownDate(dateOnlyInTimeZone(new Date(), timeZone));
  const dateFrom = parseQueryDate(req, "date_from", errors) ?? today;
  const dateTo = parseQueryDate(req, "date_to", errors) ?? dateFromUtcMs(
    dateFrom.utcMs + ((DEFAULT_TRIAL_SLOT_DAYS - 1) * 86_400_000),
  );

  if (dateTo.utcMs < dateFrom.utcMs) {
    errors.date_to = "must be on or after date_from";
  } else if (daySpanInclusive(dateFrom, dateTo) > MAX_TRIAL_SLOT_DAYS) {
    errors.date_to = `range must be ${MAX_TRIAL_SLOT_DAYS} days or fewer`;
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { clientId, bookableProgramId: bookableProgramId || null, dateFrom, dateTo, timeZone };
}

async function getClient(clientId: string): Promise<ClientRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id,time_zone")
    .eq("id", clientId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? (data as ClientRow) : null;
}

async function listTrialSlots(request: TrialSlotRequest) {
  const slots = await getSlots(request);
  if (slots.length === 0) return [];

  const slotIds = slots.map((slot) => slot.id);
  const [reservationCounts, trialCounts] = await Promise.all([
    groupedCounts("reservations", slotIds, "CONFIRMED"),
    groupedCounts("trial_bookings", slotIds, "BOOKED"),
  ]);

  return slots.map((slot) => {
    const reservationCount = reservationCounts.get(slot.id) ?? 0;
    const trialCount = trialCounts.get(slot.id) ?? 0;
    const spotsTaken = reservationCount + trialCount;
    return {
      id: slot.id,
      client_id: slot.tenant_id,
      tenant_id: slot.tenant_id,
      bookable_program_id: slot.bookable_program_id,
      name: slot.name,
      description: slot.description,
      slot_type: slot.slot_type,
      location_label: slot.location_label,
      start_time: slot.start_time,
      end_time: slot.end_time,
      capacity: slot.capacity,
      credit_cost: slot.credit_cost ?? 0,
      reservation_count: reservationCount,
      trial_count: trialCount,
      spots_taken: spotsTaken,
      spots_left: Math.max(0, slot.capacity - spotsTaken),
    };
  });
}

async function getSlots(request: TrialSlotRequest): Promise<ScheduleSlotRow[]> {
  const startBoundary = localDateTimeToIso(request.dateFrom, "00:00:00", request.timeZone);
  const startIso = new Date(Math.max(Date.now(), new Date(startBoundary).getTime())).toISOString();
  const endExclusive = dateFromUtcMs(request.dateTo.utcMs + 86_400_000);
  const endIso = localDateTimeToIso(endExclusive, "00:00:00", request.timeZone);
  const supabase = createRuntimeSupabaseClient();
  let query = supabase
    .from("schedule_slots")
    .select([
      "id",
      "tenant_id",
      "name",
      "description",
      "slot_type",
      "location_label",
      "start_time",
      "end_time",
      "capacity",
      "credit_cost",
      "bookable_program_id",
      "is_cancelled",
    ].join(","))
    .eq("tenant_id", request.clientId)
    .eq("is_cancelled", false)
    .gte("start_time", startIso)
    .lt("start_time", endIso)
    .order("start_time", { ascending: true });

  if (request.bookableProgramId) {
    query = query.eq("bookable_program_id", request.bookableProgramId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return rows<ScheduleSlotRow>(data);
}

async function groupedCounts(
  table: "reservations" | "trial_bookings",
  slotIds: string[],
  status: "CONFIRMED" | "BOOKED",
): Promise<Map<string, number>> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("schedule_slots")
    .select(`id,${table}(count)`)
    .in("id", slotIds)
    .eq(`${table}.status`, status);

  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of rows<EmbeddedCountRow>(data)) {
    const countRow = row[table]?.[0];
    counts.set(row.id, Number(countRow?.count ?? 0));
  }
  return counts;
}

function parseQueryDate(req: RuntimeApiRequest, name: string, errors: FieldErrors): ParsedDate | null {
  const value = queryParam(req, name);
  if (!value) return null;
  const parsed = parseDateOnly(value);
  if (!parsed) errors[name] = "must be an ISO date";
  return parsed;
}

function parseKnownDate(value: string): ParsedDate {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error(`Invalid generated date ${value}.`);
  return parsed;
}

function dateOnlyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error(`Invalid client time zone: ${timeZone}`);
  }
}

function queryParam(req: RuntimeApiRequest, name: string): string {
  return queryValue(req.query?.[name]);
}

function queryValue(value: HeaderValue): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function stringHeader(value: HeaderValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function sendWebsiteError(res: RuntimeApiResponse, error: unknown) {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message, fields: error.fields });
  }

  console.error("[trial-slots]", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

export default withSentryApiRoute(handler);
