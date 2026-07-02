import { createRuntimeSupabaseClient } from "../../_runtime/supabase.js";
import { HttpError, sendError } from "../_errors.js";
import type { HeaderValue, RuntimeApiRequest, RuntimeApiResponse } from "../_types.js";

export const DEFAULT_TIME_ZONE = "America/New_York";
export const MAX_GENERATION_DAYS = 92;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECURRENCE_PREFIX = "WEEKLY:";
const WEEKDAY_TOKENS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WEEKDAY_SET = new Set<string>(WEEKDAY_TOKENS);

export type FieldErrors = Record<string, string>;

export class FieldValidationError extends Error {
  readonly fields: FieldErrors;

  constructor(fields: FieldErrors) {
    super("validation failed");
    this.name = "FieldValidationError";
    this.fields = fields;
  }
}

export type ClientRow = {
  id: string;
  time_zone: string | null;
};

export type SlotTemplateRow = {
  id: string;
  tenant_id: string;
  name: string;
  slot_type: string;
  description: string | null;
  default_location: string | null;
  default_capacity: number;
  default_instructor_id: string | null;
  recurrence_rule: string | null;
  recurrence_end_date: string | null;
  default_start_time: string;
  default_end_time: string;
  default_credit_cost: number;
  is_active: boolean;
  location_id: string | null;
  source_offer_id: string | null;
  source_offer_class_key: string | null;
  offer_team_id: string | null;
  bookable_program_id: string;
  created_at: string;
  updated_at: string;
};

export type SlotTemplateWithLocationRow = SlotTemplateRow & {
  locations?: { name: string | null } | null;
};

export type SlotTemplateMutation = Partial<{
  tenant_id: string;
  name: string;
  slot_type: string;
  description: string | null;
  default_location: string | null;
  default_capacity: number;
  recurrence_rule: string | null;
  recurrence_end_date: string | null;
  default_start_time: string;
  default_end_time: string;
  default_credit_cost: number;
  is_active: boolean;
  location_id: string | null;
  bookable_program_id: string;
}>;

export type ScheduleSlotInsert = {
  tenant_id: string;
  name: string;
  description: string | null;
  slot_type: string;
  location_label: string | null;
  capacity: number;
  credit_cost: number;
  instructor_id: string | null;
  start_time: string;
  end_time: string;
  slot_template_id: string;
  is_cancelled: boolean;
  location_id: string | null;
  source_offer_id: string | null;
  source_offer_class_key: string | null;
  offer_team_id: string | null;
  bookable_program_id: string;
};

export type ScheduleSlotRow = ScheduleSlotInsert & {
  id: string;
  created_at: string;
  updated_at: string;
};

export type GeneratedSlotRow = {
  id: string;
  start_time: string;
  slot_template_id: string;
};

export type ParsedDate = {
  iso: string;
  year: number;
  month: number;
  day: number;
  utcMs: number;
};

export type ParsedTime = {
  hour: number;
  minute: number;
  second: number;
};

export const slotTemplateColumns = [
  "id",
  "tenant_id",
  "name",
  "slot_type",
  "description",
  "default_location",
  "default_capacity",
  "default_instructor_id",
  "recurrence_rule",
  "recurrence_end_date",
  "default_start_time",
  "default_end_time",
  "default_credit_cost",
  "is_active",
  "location_id",
  "source_offer_id",
  "source_offer_class_key",
  "offer_team_id",
  "bookable_program_id",
  "created_at",
  "updated_at",
].join(",");

export const slotTemplateWithLocationSelect = `${slotTemplateColumns},locations(name:title)`;

export const scheduleSlotColumns = [
  "id",
  "tenant_id",
  "name",
  "description",
  "slot_type",
  "location_label",
  "capacity",
  "credit_cost",
  "instructor_id",
  "start_time",
  "end_time",
  "slot_template_id",
  "is_cancelled",
  "location_id",
  "source_offer_id",
  "source_offer_class_key",
  "offer_team_id",
  "bookable_program_id",
  "created_at",
  "updated_at",
].join(",");

export function sendScheduleError(res: RuntimeApiResponse, error: unknown) {
  if (error instanceof FieldValidationError) {
    return res.status(400).json({ error: error.message, fields: error.fields });
  }

  return sendError(res, error);
}

export function readJsonObject(body: unknown): Record<string, unknown> {
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

export function queryValue(value: HeaderValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function queryParam(req: RuntimeApiRequest, name: string): string {
  return queryValue(req.query?.[name]);
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function requiredUuid(value: unknown, field: string, errors: FieldErrors): string | undefined {
  const normalized = optionalString(value);
  if (!normalized) {
    errors[field] = "is required";
    return undefined;
  }
  if (!isUuid(normalized)) {
    errors[field] = "must be a valid UUID";
    return undefined;
  }
  return normalized;
}

export function optionalUuid(value: unknown, field: string, errors: FieldErrors): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = optionalString(value);
  if (!normalized) return null;
  if (!isUuid(normalized)) {
    errors[field] = "must be a valid UUID";
    return undefined;
  }
  return normalized;
}

export function requiredNonEmptyString(value: unknown, field: string, errors: FieldErrors): string | undefined {
  const normalized = optionalString(value);
  if (!normalized) {
    errors[field] = "is required";
    return undefined;
  }
  return normalized;
}

export function optionalNullableString(value: unknown, field: string, errors: FieldErrors): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    errors[field] = "must be a string";
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseRequiredTime(value: unknown, field: string, errors: FieldErrors): string | undefined {
  const normalized = optionalString(value);
  if (!normalized) {
    errors[field] = "is required";
    return undefined;
  }
  if (!TIME_PATTERN.test(normalized)) {
    errors[field] = "must be HH:MM or HH:MM:SS";
    return undefined;
  }
  return normalizeTime(normalized);
}

export function parseOptionalTime(value: unknown, field: string, errors: FieldErrors): string | undefined {
  if (value === undefined) return undefined;
  const normalized = optionalString(value);
  if (!normalized || !TIME_PATTERN.test(normalized)) {
    errors[field] = "must be HH:MM or HH:MM:SS";
    return undefined;
  }
  return normalizeTime(normalized);
}

export function parsePositiveInteger(
  value: unknown,
  field: string,
  errors: FieldErrors,
  defaultValue: number | undefined,
): number | undefined {
  if (value === undefined) return defaultValue;
  const parsed = numberValue(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors[field] = "must be a positive integer";
    return undefined;
  }
  return parsed;
}

export function parseNonNegativeInteger(
  value: unknown,
  field: string,
  errors: FieldErrors,
  defaultValue: number | undefined,
): number | undefined {
  if (value === undefined) return defaultValue;
  const parsed = numberValue(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors[field] = "must be a non-negative integer";
    return undefined;
  }
  return parsed;
}

export function parseOptionalBoolean(value: unknown, field: string, errors: FieldErrors): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    errors[field] = "must be a boolean";
    return undefined;
  }
  return value;
}

export function parseOptionalDateOnly(value: unknown, field: string, errors: FieldErrors): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !parseDateOnly(value)) {
    errors[field] = "must be an ISO date";
    return undefined;
  }
  return value;
}

export function parseRequiredDateOnly(value: unknown, field: string, errors: FieldErrors): ParsedDate | undefined {
  const normalized = optionalString(value);
  if (!normalized) {
    errors[field] = "is required";
    return undefined;
  }
  const parsed = parseDateOnly(normalized);
  if (!parsed) {
    errors[field] = "must be an ISO date";
    return undefined;
  }
  return parsed;
}

export function parseDateOnly(value: string): ParsedDate | null {
  if (!DATE_ONLY_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utcMs = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(utcMs).toISOString().slice(0, 10);
  if (roundTrip !== value) return null;
  return { iso: value, year, month, day, utcMs };
}

export function parseRecurrenceRule(value: string): string[] | null {
  if (!value.startsWith(RECURRENCE_PREFIX)) return null;
  const rawTokens = value.slice(RECURRENCE_PREFIX.length).split(",");
  if (rawTokens.length < 1 || rawTokens.length > 7) return null;
  const seen = new Set<string>();
  for (const token of rawTokens) {
    if (!WEEKDAY_SET.has(token) || seen.has(token)) return null;
    seen.add(token);
  }
  return rawTokens;
}

export function parseOptionalRecurrenceRule(value: unknown, field: string, errors: FieldErrors): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !parseRecurrenceRule(value)) {
    errors[field] = "must match WEEKLY:MO,TU,WE,TH,FR,SA,SU with 1-7 unique weekdays";
    return undefined;
  }
  return value;
}

export function assertTimeOrder(startTime: string | undefined, endTime: string | undefined, errors: FieldErrors): void {
  if (!startTime || !endTime) return;
  if (timeToSeconds(endTime) <= timeToSeconds(startTime)) {
    errors.default_end_time = "must be after default_start_time";
  }
}

export function daySpanInclusive(dateFrom: ParsedDate, dateTo: ParsedDate): number {
  return Math.floor((dateTo.utcMs - dateFrom.utcMs) / 86_400_000) + 1;
}

export function dateFromUtcMs(utcMs: number): ParsedDate {
  const iso = new Date(utcMs).toISOString().slice(0, 10);
  const parsed = parseDateOnly(iso);
  if (!parsed) throw new Error(`Invalid generated date ${iso}.`);
  return parsed;
}

export function weekdayToken(date: ParsedDate): string {
  const token = WEEKDAY_TOKENS[new Date(date.utcMs).getUTCDay()];
  if (!token) throw new Error(`Invalid generated weekday for ${date.iso}.`);
  return token;
}

export function dateCompare(a: string, b: string): number {
  return a.localeCompare(b);
}

export function localDateTimeToIso(date: ParsedDate, time: string, timeZone: string): string {
  const parsedTime = parseTime(time);
  let utcMs = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    parsedTime.hour,
    parsedTime.minute,
    parsedTime.second,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = timeZoneOffsetMinutes(timeZone, utcMs);
    const resolvedMs = Date.UTC(
      date.year,
      date.month - 1,
      date.day,
      parsedTime.hour,
      parsedTime.minute,
      parsedTime.second,
    ) - (offsetMinutes * 60_000);
    if (resolvedMs === utcMs) break;
    utcMs = resolvedMs;
  }

  return new Date(utcMs).toISOString();
}

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new HttpError(500, "Supabase request failed", {
      table: "clients",
      message: `Invalid client time_zone: ${timeZone}`,
    });
  }
}

export async function getClient(clientId: string): Promise<ClientRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id,time_zone")
    .eq("id", clientId)
    .limit(1)
    .maybeSingle();

  if (error) throw supabaseHttpError("clients", error.message);
  return data ? (data as ClientRow) : null;
}

export async function resolveBookableProgramId(
  clientId: string,
  value: string | null | undefined,
  errors: FieldErrors,
): Promise<string | undefined> {
  if (value) {
    const supabase = createRuntimeSupabaseClient();
    const { data, error } = await supabase
      .from("bookable_programs")
      .select("id")
      .eq("tenant_id", clientId)
      .eq("id", value)
      .limit(1)
      .maybeSingle();

    if (error) throw supabaseHttpError("bookable_programs", error.message);
    if (!data) {
      errors.bookable_program_id = "must belong to the client";
      return undefined;
    }
    return value;
  }

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("bookable_programs")
    .select("id")
    .eq("tenant_id", clientId)
    .eq("status", "ACTIVE")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true })
    .limit(1);

  if (error) throw supabaseHttpError("bookable_programs", error.message);
  const first = Array.isArray(data) ? data[0] as { id: string } | undefined : undefined;
  if (!first?.id) {
    errors.bookable_program_id = "is required";
    return undefined;
  }
  return first.id;
}

export async function ensureLocationBelongsToClient(
  clientId: string,
  locationId: string,
  errors: FieldErrors,
): Promise<void> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id")
    .eq("client_id", clientId)
    .eq("id", locationId)
    .limit(1)
    .maybeSingle();

  if (error) throw supabaseHttpError("locations", error.message);
  if (!data) errors.location_id = "must belong to the client";
}

export function supabaseHttpError(table: string, message: string): HttpError {
  return new HttpError(502, "Supabase request failed", { table, message });
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

function parseTime(value: string): ParsedTime {
  const normalized = normalizeTime(value);
  const match = TIME_PATTERN.exec(normalized);
  if (!match) throw new Error(`Invalid time ${value}.`);
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] ?? 0),
  };
}

function timeToSeconds(value: string): number {
  const parsed = parseTime(value);
  return (parsed.hour * 3600) + (parsed.minute * 60) + parsed.second;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
}

function timeZoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(utcMs));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/.exec(offset);
  if (!match?.groups) {
    throw new HttpError(500, "Supabase request failed", {
      table: "clients",
      message: `Could not resolve UTC offset for ${timeZone}`,
    });
  }

  const sign = match.groups.sign === "-" ? -1 : 1;
  const hours = Number(match.groups.hours ?? 0);
  const minutes = Number(match.groups.minutes ?? 0);
  return sign * ((hours * 60) + minutes);
}
