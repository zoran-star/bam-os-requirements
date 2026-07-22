import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import {
  getOwnedStudent,
  getParentReadContext,
  type ParentReadContext,
} from "./_parent-context.js";
import { eq, rpc, sb } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";
import { bounceCancelledTrialToRebook } from "../agent/_rebook.js";

type TrialBookingRequest = {
  academy_id: string;
  slot_id: string;
  student_id: string;
  entry_point_id: string | null;
  offer_id: string | null;
  metadata: Record<string, unknown>;
};

type ParentTrialBookingRow = {
  id: string;
  tenant_id: string;
  slot_id: string;
  customer_profile_id: string | null;
  student_id: string | null;
  ghl_contact_id: string | null;
  source: string | null;
  status: "BOOKED" | "CANCELLED" | "SHOWED" | "NO_SHOW" | "CONVERTED";
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentReadContext(req);
    if (req.method === "DELETE") {
      const booking = await cancelParentTrialBooking(context, readTrialBookingId(req));
      return res.status(200).json(booking);
    }

    const request = readTrialBookingRequest(req.body);
    const student = getOwnedStudent(context, request.student_id);
    ensureAcademyTrialAccess(context, request.academy_id);

    const trialBookingId = await rpc<string>("book_trial_slot", {
      p_tenant_id: request.academy_id,
      p_slot_id: request.slot_id,
      p_parent_name: fullName(context.profile.first_name, context.profile.last_name),
      p_parent_email: context.profile.email,
      p_athlete_name: fullName(student.first_name, student.last_name),
      p_parent_phone: context.profile.phone,
      p_athlete_dob: student.date_of_birth,
      p_entry_point_id: request.entry_point_id,
      p_offer_id: request.offer_id,
      p_ghl_contact_id: null,
      p_source: "parent_app",
      p_metadata: request.metadata,
      p_customer_profile_id: context.profile.id,
      p_student_id: student.id,
    });

    return res.status(200).json({
      academy_id: request.academy_id,
      slot_id: request.slot_id,
      student_id: student.id,
      status: "BOOKED",
      trial_booking_id: trialBookingId,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function cancelParentTrialBooking(context: ParentReadContext, trialBookingId: string) {
  const booking = await getParentTrialBooking(trialBookingId);
  if (!booking) {
    throw new HttpError(404, "Trial booking not found.");
  }

  ensureOwnedParentAppTrialBooking(context, booking);
  if (booking.status !== "BOOKED") {
    throw new HttpError(409, "Trial booking cannot be cancelled from its current status.");
  }

  const cancelled = await rpc<boolean>("cancel_trial_booking", {
    p_tenant_id: booking.tenant_id,
    p_trial_booking_id: booking.id,
  });

  // Lead-initiated cancel of an upcoming booked trial: hand the lead back to
  // the booking agent to rebook (cancel_booking edge + the rebook handshake
  // notes the A5 rebook pass consumes). Best-effort - the cancel already landed.
  if (cancelled) {
    await bounceCancelledTrialToRebook({
      clientId: booking.tenant_id,
      contactId: booking.ghl_contact_id,
      trialBookingId: booking.id,
      source: "parent-app-cancel",
    });
  }

  return {
    academy_id: booking.tenant_id,
    slot_id: booking.slot_id,
    student_id: booking.student_id,
    status: "CANCELLED",
    cancelled: Boolean(cancelled),
    trial_booking_id: booking.id,
  };
}

async function getParentTrialBooking(
  trialBookingId: string,
): Promise<ParentTrialBookingRow | null> {
  const rows = await sb<ParentTrialBookingRow[]>(
    `trial_bookings?id=eq.${eq(trialBookingId)}` +
      "&select=id,tenant_id,slot_id,customer_profile_id,student_id,ghl_contact_id,source,status" +
      "&limit=1",
  );

  return Array.isArray(rows) ? rows[0] || null : null;
}

function ensureOwnedParentAppTrialBooking(
  context: ParentReadContext,
  booking: ParentTrialBookingRow,
): void {
  if (booking.source !== "parent_app") {
    throw new HttpError(403, "Not authorized to cancel this trial booking.");
  }

  if (booking.customer_profile_id !== context.profile.id) {
    throw new HttpError(403, "Not authorized to cancel this trial booking.");
  }

  if (!booking.student_id || !context.students.some((student) => student.id === booking.student_id)) {
    throw new HttpError(403, "Not authorized to cancel this trial booking.");
  }

  ensureAcademyTrialAccess(context, booking.tenant_id);
}

function readTrialBookingRequest(body: unknown): TrialBookingRequest {
  const input = readJsonObject(body);
  return {
    academy_id: requiredTrimmedString(input.academy_id, "academy_id"),
    slot_id: requiredTrimmedString(input.slot_id, "slot_id"),
    student_id: requiredTrimmedString(input.student_id, "student_id"),
    entry_point_id: optionalTrimmedString(input.entry_point_id, "entry_point_id"),
    offer_id: optionalTrimmedString(input.offer_id, "offer_id"),
    metadata: optionalMetadata(input.metadata),
  };
}

function readTrialBookingId(req: ParentApiRequest): string {
  const queryId = queryParam(req, "trial_booking_id");
  if (queryId) return requiredTrimmedString(queryId, "trial_booking_id");

  const input = readJsonObject(req.body);
  return requiredTrimmedString(input.trial_booking_id, "trial_booking_id");
}

function ensureAcademyTrialAccess(context: ParentReadContext, academyId: string): void {
  const hasAcademyLink = context.memberships.some(
    (membership) => membership.academy_id === academyId && membership.status !== "CANCELLED",
  );

  if (!hasAcademyLink) {
    throw new HttpError(403, "Not authorized to book trials for this academy.");
  }
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

function queryParam(req: ParentApiRequest, name: string): string | undefined {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;

  if (!req.url) return undefined;
  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get(name) || undefined;
}

function requiredTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing required body field: ${fieldName}.`);
  }

  return value.trim();
}

function optionalTrimmedString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }

  return value.trim() || null;
}

function optionalMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new HttpError(400, "Invalid body field: metadata.");
}

function fullName(firstName: string, lastName: string): string {
  return [firstName, lastName].map((part) => part.trim()).filter(Boolean).join(" ");
}

export default withSentryApiRoute(handler);
