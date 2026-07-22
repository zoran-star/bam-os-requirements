// Public endpoint - trial booking actions for website funnels.
//
//   POST /api/website/trial-booking
//     body { client_id, slot_id, parent_name, parent_email, athlete_name, ... }
//   POST /api/website/trial-booking?action=cancel|reschedule
//     body { trial_booking_id, parent_email, new_slot_id? }

import { withSentryApiRoute } from "../_sentry.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import type { HeaderValue, RuntimeApiRequest, RuntimeApiResponse } from "../runtime/_types.js";
import { isUuid, parseDateOnly } from "../runtime/schedule/_shared.js";
import { bounceCancelledTrialToRebook } from "../agent/_rebook.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

let originsCache: { set: Set<string> | null; at: number } = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

type FieldErrors = Record<string, string>;
type JsonRecord = Record<string, unknown>;

type TrialBookingRow = {
  id: string;
  tenant_id: string;
  slot_id: string;
  parent_email: string;
  ghl_contact_id: string | null;
  status: TrialBookingStatus;
};

type TrialBookingStatus = "BOOKED" | "CANCELLED" | "SHOWED" | "NO_SHOW" | "CONVERTED";

type CreateTrialBookingRequest = {
  clientId: string;
  slotId: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string | null;
  athleteName: string;
  athleteDob: string | null;
  offerId: string | null;
  entryPointId: string | null;
  ghlContactId: string | null;
  metadata: JsonRecord;
};

type TrialActionRequest = {
  trialBookingId: string;
  parentEmail: string;
  newSlotId: string | null;
};

class ValidationError extends Error {
  readonly fields: FieldErrors;

  constructor(fields: FieldErrors) {
    super("validation failed");
    this.fields = fields;
  }
}

class PublicHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });
  const allowed = await setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  try {
    const action = queryParam(req, "action");
    if (!action) return res.status(200).json(await createTrialBooking(req));
    if (action === "cancel") return res.status(200).json(await cancelTrialBooking(req));
    if (action === "reschedule") return res.status(200).json(await rescheduleTrialBooking(req));
    return res.status(404).json({ error: "not found" });
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

// Offer lineage when the site doesn't send offer_id: the slot knows its
// bookable program, and the academy's entry points link that program to the
// offer whose funnel it belongs to (offer tie-in step G). Unambiguous only -
// zero or multiple candidate offers stays null. Best-effort, never blocks.
async function deriveOfferIdForSlot(
  supabase: ReturnType<typeof createRuntimeSupabaseClient>,
  clientId: string,
  slotId: string,
): Promise<string | null> {
  try {
    const { data: slotData } = await supabase
      .from("schedule_slots")
      .select("bookable_program_id")
      .eq("id", slotId)
      .eq("tenant_id", clientId)
      .maybeSingle();
    const programId = (slotData as { bookable_program_id?: string | null } | null)?.bookable_program_id;
    if (!programId) return null;
    const { data: epData } = await supabase
      .from("entry_points")
      .select("offer_id")
      .eq("client_id", clientId)
      .eq("bookable_program_id", programId)
      .not("offer_id", "is", null);
    const offers = new Set(((epData as { offer_id: string }[] | null) || []).map((row) => row.offer_id));
    return offers.size === 1 ? [...offers][0]! : null;
  } catch {
    return null;
  }
}

async function createTrialBooking(req: RuntimeApiRequest) {
  const request = readCreateTrialBookingRequest(req);
  const supabase = createRuntimeSupabaseClient();
  const offerId = request.offerId || (await deriveOfferIdForSlot(supabase, request.clientId, request.slotId));
  const { data, error } = await supabase.rpc("book_trial_slot", {
    p_tenant_id: request.clientId,
    p_slot_id: request.slotId,
    p_parent_name: request.parentName,
    p_parent_email: request.parentEmail,
    p_athlete_name: request.athleteName,
    p_parent_phone: request.parentPhone,
    p_athlete_dob: request.athleteDob,
    p_entry_point_id: request.entryPointId,
    p_offer_id: offerId,
    p_ghl_contact_id: request.ghlContactId,
    p_source: "website",
    p_metadata: request.metadata,
  });

  if (error) throw publicRpcError(error.message);
  if (typeof data !== "string") throw new Error("Expected book_trial_slot to return an id.");
  // A parked "come back later" lead who self-books is back NOW - cancel any
  // scheduled reignition so the re-engagement card doesn't fire at a family that
  // already rebooked (#19). Best-effort; uses the client already in scope.
  if (request.ghlContactId) {
    try {
      await supabase.from("agent_reignitions")
        .update({ status: "canceled", cancel_reason: "self-booked a trial", updated_at: new Date().toISOString() })
        .eq("client_id", request.clientId)
        .eq("ghl_contact_id", request.ghlContactId)
        .eq("status", "scheduled");
    } catch { /* best-effort - never block a booking */ }
  }
  return { trial_booking_id: data, status: "BOOKED" };
}

async function cancelTrialBooking(req: RuntimeApiRequest) {
  const request = readTrialActionRequest(req, false);
  const booking = await verifiedBookingForEmail(request.trialBookingId, request.parentEmail);
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_trial_booking", {
    p_tenant_id: booking.tenant_id,
    p_trial_booking_id: booking.id,
  });

  if (error) throw publicRpcError(error.message);
  // Lead-initiated cancel of an upcoming booked trial: hand the lead back to
  // the booking agent to rebook (cancel_booking edge + the rebook handshake
  // notes the A5 rebook pass consumes). Best-effort - the cancel already landed.
  if (data) {
    await bounceCancelledTrialToRebook({
      clientId: booking.tenant_id,
      contactId: booking.ghl_contact_id,
      trialBookingId: booking.id,
      source: "website-cancel",
    });
  }
  return {
    trial_booking_id: booking.id,
    status: "CANCELLED",
    cancelled: Boolean(data),
  };
}

async function rescheduleTrialBooking(req: RuntimeApiRequest) {
  const request = readTrialActionRequest(req, true);
  if (!request.newSlotId) throw new ValidationError({ new_slot_id: "is required" });
  const booking = await verifiedBookingForEmail(request.trialBookingId, request.parentEmail);
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase.rpc("reschedule_trial_booking", {
    p_tenant_id: booking.tenant_id,
    p_trial_booking_id: booking.id,
    p_new_slot_id: request.newSlotId,
  });

  if (error) throw publicRpcError(error.message);
  return {
    trial_booking_id: typeof data === "string" ? data : booking.id,
    status: "BOOKED",
    slot_id: request.newSlotId,
  };
}

function readCreateTrialBookingRequest(req: RuntimeApiRequest): CreateTrialBookingRequest {
  const body = readJsonObject(req.body);
  const errors: FieldErrors = {};

  const clientId = requiredUuid(body.client_id, "client_id", errors);
  const slotId = requiredUuid(body.slot_id, "slot_id", errors);
  const parentName = requiredString(body.parent_name, "parent_name", errors);
  const parentEmail = requiredString(body.parent_email, "parent_email", errors);
  const athleteName = requiredString(body.athlete_name, "athlete_name", errors);
  const parentPhone = optionalString(body.parent_phone, "parent_phone", errors);
  const athleteDob = optionalDateOnly(body.athlete_dob, "athlete_dob", errors);
  const offerId = optionalUuid(body.offer_id, "offer_id", errors);
  const entryPointId = optionalUuid(body.entry_point_id, "entry_point_id", errors);
  const ghlContactId = optionalString(body.ghl_contact_id, "ghl_contact_id", errors);
  const metadata = optionalMetadata(body.metadata, errors);

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  if (!clientId || !slotId || !parentName || !parentEmail || !athleteName) {
    throw new ValidationError(errors);
  }

  return {
    clientId,
    slotId,
    parentName,
    parentEmail,
    parentPhone,
    athleteName,
    athleteDob,
    offerId,
    entryPointId,
    ghlContactId,
    metadata,
  };
}

function readTrialActionRequest(req: RuntimeApiRequest, requireNewSlotId: boolean): TrialActionRequest {
  const body = readJsonObject(req.body);
  const errors: FieldErrors = {};
  const queryTrialBookingId = queryParam(req, "trial_booking_id");
  const trialBookingId = requiredUuid(queryTrialBookingId || body.trial_booking_id, "trial_booking_id", errors);
  const parentEmail = requiredString(body.parent_email, "parent_email", errors);
  const newSlotId = requireNewSlotId
    ? requiredUuid(body.new_slot_id, "new_slot_id", errors)
    : optionalUuid(body.new_slot_id, "new_slot_id", errors);

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  if (!trialBookingId || !parentEmail) throw new ValidationError(errors);
  return { trialBookingId, parentEmail, newSlotId: newSlotId ?? null };
}

async function verifiedBookingForEmail(
  trialBookingId: string,
  parentEmail: string,
): Promise<TrialBookingRow> {
  const booking = await getTrialBooking(trialBookingId);
  if (!booking) throw new PublicHttpError(404, "Trial booking not found.");
  if (booking.parent_email.trim().toLowerCase() !== parentEmail.trim().toLowerCase()) {
    throw new PublicHttpError(403, "Parent email does not match this trial booking.");
  }
  return booking;
}

async function getTrialBooking(trialBookingId: string): Promise<TrialBookingRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("trial_bookings")
    .select("id,tenant_id,slot_id,parent_email,ghl_contact_id,status")
    .eq("id", trialBookingId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? (data as TrialBookingRow) : null;
}

function readJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new PublicHttpError(400, "Invalid JSON body.");
    }
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  throw new PublicHttpError(400, "Expected JSON body.");
}

function requiredUuid(value: unknown, field: string, errors: FieldErrors): string | undefined {
  const normalized = optionalRawString(value);
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

function optionalUuid(value: unknown, field: string, errors: FieldErrors): string | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = optionalRawString(value);
  if (!normalized || !isUuid(normalized)) {
    errors[field] = "must be a valid UUID";
    return null;
  }
  return normalized;
}

function requiredString(value: unknown, field: string, errors: FieldErrors): string | undefined {
  const normalized = optionalRawString(value);
  if (!normalized) {
    errors[field] = "is required";
    return undefined;
  }
  return normalized;
}

function optionalString(value: unknown, field: string, errors: FieldErrors): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    errors[field] = "must be a string";
    return null;
  }
  return value.trim() || null;
}

function optionalDateOnly(value: unknown, field: string, errors: FieldErrors): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !parseDateOnly(value.trim())) {
    errors[field] = "must be an ISO date";
    return null;
  }
  return value.trim();
}

function optionalMetadata(value: unknown, errors: FieldErrors): JsonRecord {
  if (value === undefined || value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  errors.metadata = "must be an object";
  return {};
}

function optionalRawString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function publicRpcError(message: string): PublicHttpError {
  const normalized = message.trim();
  if (normalized === "Slot is full.") return new PublicHttpError(409, "Slot is full.");
  if (normalized.includes("not found")) return new PublicHttpError(404, normalized);
  if (normalized.includes("full")) return new PublicHttpError(409, "Slot is full.");
  if (normalized.includes("cancelled") || normalized.includes("started") || normalized.includes("current status")) {
    return new PublicHttpError(409, normalized);
  }
  return new PublicHttpError(400, "Trial booking failed. Please try again.");
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

function sendWebsiteError(res: RuntimeApiResponse, error: unknown) {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message, fields: error.fields });
  }
  if (error instanceof PublicHttpError) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error("[trial-booking]", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

export default withSentryApiRoute(handler);
