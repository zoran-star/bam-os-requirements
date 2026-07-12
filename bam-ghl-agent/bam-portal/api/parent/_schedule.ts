import { HttpError } from "./_errors.js";
import {
  resolveParentIdentityForUser,
  type ParentIdentityProfile,
} from "./_parent-identity.js";
import { eq, inList, rpc, sb, verifySupabaseUser } from "./_supabase.js";
import type { ParentApiRequest } from "./_types.js";

const SLOT_SCAN_LIMIT = 1_000;
const RESERVATION_SCAN_LIMIT = 1_000;
const UTC_TIME_ZONE = "UTC";
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type Student = {
  id: string;
  parent_id: string;
};

type Membership = {
  id: string;
  academy_id: string;
  customer_id: string | null;
  student_id: string | null;
  status: "ACTIVE" | "SUSPENDED" | "CANCELLED";
  stripe_customer_id: string | null;
};

type AcademyTimeZoneRow = {
  id: string;
  time_zone: string | null;
};

type ScheduleSlot = {
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
  instructor_id: string | null;
  slot_template_id: string | null;
  location_id: string | null;
};

type ReservationStatus = "CONFIRMED" | "CANCELLED" | "ATTENDED" | "NO_SHOW" | "LATE_CANCEL";

type Reservation = {
  id: string;
  slot_id: string;
  membership_id: string;
  student_id: string | null;
  status: ReservationStatus;
  booked_at: string;
  cancelled_at: string | null;
};

type TrialBookingStatus = "BOOKED" | "CANCELLED" | "SHOWED" | "NO_SHOW" | "CONVERTED";

type TrialBooking = {
  id: string;
  tenant_id: string;
  slot_id: string;
  customer_profile_id: string | null;
  student_id: string | null;
  status: TrialBookingStatus;
  booked_at: string;
  cancelled_at: string | null;
};

type WaitlistEntry = {
  id: string;
  slot_id: string;
  membership_id: string;
  student_id: string | null;
  status: "WAITING" | "PROMOTED" | "EXPIRED" | "REMOVED";
  created_at: string;
};

type ParentScheduleContext = {
  profile: ParentIdentityProfile;
  memberships: Membership[];
  studentIds: string[];
  academyIds: string[];
};

type SlotState = {
  bookedCounts: Map<string, number>;
  waitlistCounts: Map<string, number>;
  reservationBySlotMembership: Map<string, Reservation>;
  trialBySlotStudent: Map<string, TrialBooking>;
  activeTrialByTenantStudent: Map<string, TrialBooking>;
  usedTrialTenantStudentKeys: Set<string>;
  waitlistBySlotMembership: Map<string, WaitlistEntry>;
};

type SlotSpotsTakenRow = {
  slot_id: string;
  spots_taken: number | string | null;
};

export type CustomerSlotEnrollmentOut = {
  booking_kind?: "reservation" | "trial";
  membership_id: string | null;
  student_id: string | null;
  status: "CONFIRMED" | "WAITING";
  reservation_id: string | null;
  trial_booking_id?: string | null;
  waitlist_id: string | null;
  can_cancel: boolean;
};

export type CustomerSlotChildActionOut = {
  student_id: string;
  action:
    | "book_with_plan"
    | "book_trial"
    | "already_booked"
    | "already_booked_trial"
    | "waitlisted"
    | "join_waitlist"
    | "subscribe"
    | "unavailable";
  booking_kind: "reservation" | "trial" | null;
  enabled: boolean;
  reason:
    | "active_membership"
    | "trial_available"
    | "trial_booked"
    | "trial_used"
    | "already_booked"
    | "already_booked_trial"
    | "already_waitlisted"
    | "slot_full"
    | "slot_cancelled"
    | "slot_started"
    | "membership_paused"
    | "no_active_membership";
  membership_id?: string | null;
  reservation_id?: string | null;
  trial_booking_id?: string | null;
  trial_slot_id?: string | null;
  waitlist_id?: string | null;
};

export type CustomerSlotOut = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  slot_type: string;
  location_label: string | null;
  start_time: string;
  end_time: string;
  capacity: number;
  credit_cost: number;
  is_cancelled: boolean;
  instructor_name: string | null;
  booked_count: number;
  waitlist_length: number;
  enrollments: CustomerSlotEnrollmentOut[];
  child_actions: CustomerSlotChildActionOut[];
  my_status: "CONFIRMED" | "WAITING" | null;
  my_reservation_id: string | null;
  my_waitlist_id: string | null;
  can_book: boolean;
  can_waitlist: boolean;
  can_cancel: boolean;
};

export type CustomerReservationOut = {
  booking_kind: "reservation" | "trial";
  id: string;
  slot_id: string;
  membership_id: string | null;
  student_id: string | null;
  status: ReservationStatus | TrialBookingStatus;
  booked_at: string;
  slot: CustomerSlotOut;
  trial_booking_id?: string | null;
};

export type CustomerWaitlistOut = {
  id: string;
  slot_id: string;
  membership_id: string;
  student_id: string | null;
  status: WaitlistEntry["status"];
  created_at: string;
  slot: CustomerSlotOut;
};

export type BookSlotRequest = {
  membership_id: string;
  student_id?: string | null;
};

export async function getParentScheduleContext(
  req: ParentApiRequest,
): Promise<ParentScheduleContext> {
  const user = await verifySupabaseUser(req);
  const { profile } = await resolveParentIdentityForUser(user);
  const students = await getStudents(profile.id);
  const memberships = await getMemberships(profile.id, students.map((student) => student.id));

  return {
    profile,
    memberships,
    studentIds: students.map((student) => student.id),
    academyIds: [...new Set(memberships.map((membership) => membership.academy_id))],
  };
}

export async function listScheduleSlots(
  context: ParentScheduleContext,
  opts: {
    academyId: string;
    membershipId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
  },
): Promise<CustomerSlotOut[]> {
  ensureAcademyAccess(context, opts.academyId);
  const memberships = resolveMembershipsForAcademy(context, opts.membershipId, opts.academyId);
  const timeZones = await getAcademyTimeZones([opts.academyId]);
  const dateRange = futureDateRangeIso(
    opts.dateFrom,
    opts.dateTo,
    academyTimeZone(timeZones, opts.academyId),
  );
  const slots = await getSlots({
    academyIds: [opts.academyId],
    startGte: dateRange.startGte,
    startLt: dateRange.startLt,
    limit: opts.limit,
    order: "asc",
    includeCancelled: false,
  });
  const trialStudentIds = trialStudentIdsForMemberships(context, memberships, Boolean(opts.membershipId));
  const state = await getSlotState(slots, { studentIds: trialStudentIds });
  return slots.map((slot) => toCustomerSlot(slot, state, memberships, trialStudentIds));
}

export async function getScheduleSlot(
  context: ParentScheduleContext,
  slotId: string,
  membershipId?: string,
): Promise<CustomerSlotOut> {
  const slot = await getSlotById(slotId);
  if (!slot) {
    throw new HttpError(404, "Slot not found.");
  }

  ensureAcademyAccess(context, slot.tenant_id);
  const memberships = resolveMembershipsForAcademy(context, membershipId, slot.tenant_id);
  const trialStudentIds = trialStudentIdsForMemberships(context, memberships, Boolean(membershipId));
  const state = await getSlotState([slot], { studentIds: trialStudentIds });
  return toCustomerSlot(slot, state, memberships, trialStudentIds);
}

export async function bookScheduleSlot(
  context: ParentScheduleContext,
  slotId: string,
  request: BookSlotRequest,
): Promise<CustomerReservationOut> {
  const membership = getActionMembership(context, request.membership_id, true);
  const studentId = resolveActionStudentId(context, membership, request.student_id);
  const reservationId = await rpc<string>("parent_book_slot", {
    p_tenant_id: membership.academy_id,
    p_slot_id: slotId,
    p_membership_id: membership.id,
    p_student_id: studentId,
  });

  return getReservationOutForContext(context, reservationId);
}

export async function joinScheduleSlotWaitlist(
  context: ParentScheduleContext,
  slotId: string,
  request: BookSlotRequest,
): Promise<CustomerWaitlistOut> {
  const membership = getActionMembership(context, request.membership_id, true);
  const studentId = resolveActionStudentId(context, membership, request.student_id);
  const waitlistId = await rpc<string>("parent_join_waitlist", {
    p_tenant_id: membership.academy_id,
    p_slot_id: slotId,
    p_membership_id: membership.id,
    p_student_id: studentId,
  });

  return getWaitlistOutForContext(context, waitlistId);
}

export async function cancelScheduleReservation(
  context: ParentScheduleContext,
  reservationId: string,
): Promise<CustomerReservationOut> {
  const reservation = await getReservationById(reservationId);
  if (!reservation) {
    throw new HttpError(404, "Reservation not found.");
  }

  const membership = getOwnedMembership(context, reservation.membership_id);
  const cancelledReservationId = await rpc<string>("parent_cancel_reservation", {
    p_tenant_id: membership.academy_id,
    p_reservation_id: reservation.id,
    p_membership_id: membership.id,
  });

  return getReservationOutForContext(context, cancelledReservationId);
}

export async function leaveScheduleWaitlist(
  context: ParentScheduleContext,
  waitlistId: string,
): Promise<CustomerWaitlistOut> {
  const waitlist = await getWaitlistEntryById(waitlistId);
  if (!waitlist) {
    throw new HttpError(404, "Waitlist entry not found.");
  }

  const membership = getOwnedMembership(context, waitlist.membership_id);
  const removedWaitlistId = await rpc<string>("parent_leave_waitlist", {
    p_tenant_id: membership.academy_id,
    p_waitlist_id: waitlist.id,
    p_membership_id: membership.id,
  });

  return getWaitlistOutForContext(context, removedWaitlistId);
}

export async function listUpcomingReservations(
  context: ParentScheduleContext,
  opts: {
    membershipId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
  },
): Promise<CustomerReservationOut[]> {
  const memberships = resolveMemberships(context, opts.membershipId);
  const membershipIds = memberships.map((membership) => membership.id);
  if (context.academyIds.length === 0) return [];

  const slotLimit = scanLimit(opts.limit);
  const slots = await getFutureSlotsAcrossAcademies(context.academyIds, {
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    limit: slotLimit,
    order: "asc",
  });
  if (slots.length === 0) return [];

  const slotById = mapSlots(slots);
  const slotIds = slots.map((slot) => slot.id);
  const trialStudentIds = trialStudentIdsForMemberships(context, memberships, Boolean(opts.membershipId));
  const [reservations, trialBookings] = await Promise.all([
    membershipIds.length > 0
      ? getReservations({
          slotIds,
          membershipIds,
          statuses: ["CONFIRMED"],
          limit: RESERVATION_SCAN_LIMIT,
        })
      : Promise.resolve([]),
    getTrialBookings({
      slotIds,
      statuses: ["BOOKED"],
      studentIds: trialStudentIds,
      limit: RESERVATION_SCAN_LIMIT,
    }),
  ]);
  const state = await getSlotState(slots, { studentIds: trialStudentIds });

  return [
    ...reservations
      .filter((reservation) => slotById.has(reservation.slot_id))
      .map((reservation) =>
        toReservationOut(
          reservation,
          slotById.get(reservation.slot_id),
          state,
          memberships,
          trialStudentIds,
        ),
      ),
    ...trialBookings
      .filter((trial) => slotById.has(trial.slot_id))
      .map((trial) =>
        toTrialBookingOut(trial, slotById.get(trial.slot_id), state, memberships, trialStudentIds),
      ),
  ]
    .sort((a, b) => compareSlotStart(a.slot, b.slot, "asc"))
    .slice(0, opts.limit);
}

export async function listPastAppointments(
  context: ParentScheduleContext,
  opts: {
    membershipId?: string;
    days?: number;
    limit: number;
  },
): Promise<CustomerReservationOut[]> {
  const memberships = resolveMemberships(context, opts.membershipId);
  const membershipIds = memberships.map((membership) => membership.id);
  if (context.academyIds.length === 0) return [];

  const now = new Date();
  const slots = await getSlots({
    academyIds: context.academyIds,
    startGte: opts.days ? addDays(now, -opts.days).toISOString() : undefined,
    startLt: now.toISOString(),
    limit: scanLimit(opts.limit),
    order: "desc",
    includeCancelled: false,
  });
  if (slots.length === 0) return [];

  const slotById = mapSlots(slots);
  const slotIds = slots.map((slot) => slot.id);
  const trialStudentIds = trialStudentIdsForMemberships(context, memberships, Boolean(opts.membershipId));
  const [reservations, trialBookings] = await Promise.all([
    membershipIds.length > 0
      ? getReservations({
          slotIds,
          membershipIds,
          statuses: ["CONFIRMED", "ATTENDED", "NO_SHOW"],
          limit: RESERVATION_SCAN_LIMIT,
        })
      : Promise.resolve([]),
    getTrialBookings({
      slotIds,
      statuses: ["BOOKED", "SHOWED", "NO_SHOW", "CONVERTED"],
      studentIds: trialStudentIds,
      limit: RESERVATION_SCAN_LIMIT,
    }),
  ]);
  const state = await getSlotState(slots, { studentIds: trialStudentIds });

  return [
    ...reservations
      .filter((reservation) => slotById.has(reservation.slot_id))
      .map((reservation) =>
        toReservationOut(
          reservation,
          slotById.get(reservation.slot_id),
          state,
          memberships,
          trialStudentIds,
        ),
      ),
    ...trialBookings
      .filter((trial) => slotById.has(trial.slot_id))
      .map((trial) =>
        toTrialBookingOut(trial, slotById.get(trial.slot_id), state, memberships, trialStudentIds),
      ),
  ]
    .sort((a, b) => compareSlotStart(a.slot, b.slot, "desc"))
    .slice(0, opts.limit);
}

export function queryParam(req: ParentApiRequest, name: string): string | undefined {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;

  if (!req.url) return undefined;
  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get(name) || undefined;
}

export function requiredQueryParam(req: ParentApiRequest, name: string): string {
  const value = queryParam(req, name);
  if (!value) {
    throw new HttpError(400, `Missing required query parameter: ${name}`);
  }
  return value;
}

export function intQueryParam(
  req: ParentApiRequest,
  name: string,
  defaultValue: number,
  maxValue: number,
): number {
  const value = queryParam(req, name);
  if (!value) return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `Invalid ${name}. Expected a positive integer.`);
  }

  return Math.min(parsed, maxValue);
}

export function readBookSlotRequest(req: ParentApiRequest): BookSlotRequest {
  const body = readJsonObject(req.body);
  const membershipId = requiredBodyString(body, "membership_id");
  const studentId = optionalBodyString(body, "student_id");
  return {
    membership_id: membershipId,
    student_id: studentId,
  };
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

function requiredBodyString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing required body field: ${name}.`);
  }
  return value.trim();
}

function optionalBodyString(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid body field: ${name}.`);
  }
  return value.trim();
}

async function getStudents(parentId: string): Promise<Student[]> {
  const rows = await sb<Student[]>(
    `students?parent_id=eq.${eq(parentId)}` +
      "&select=id,parent_id" +
      "&order=created_at.asc",
  );

  return Array.isArray(rows) ? rows : [];
}

async function getMemberships(profileId: string, studentIds: string[]): Promise<Membership[]> {
  const profileMemberships = await sb<Membership[]>(
    `academy_memberships?customer_id=eq.${eq(profileId)}` +
      "&select=id,academy_id,customer_id,student_id,status,stripe_customer_id",
  );

  let studentMemberships: Membership[] = [];
  if (studentIds.length > 0) {
    studentMemberships = await sb<Membership[]>(
      `academy_memberships?student_id=in.(${inList(studentIds)})` +
        "&select=id,academy_id,customer_id,student_id,status,stripe_customer_id",
    );
  }

  return dedupeMemberships([
    ...(Array.isArray(profileMemberships) ? profileMemberships : []),
    ...(Array.isArray(studentMemberships) ? studentMemberships : []),
  ]);
}

function dedupeMemberships(memberships: Membership[]): Membership[] {
  const byId = new Map<string, Membership>();
  for (const membership of memberships) {
    byId.set(membership.id, membership);
  }
  return [...byId.values()];
}

async function getAcademyTimeZones(academyIds: string[]): Promise<Map<string, string>> {
  if (academyIds.length === 0) return new Map();

  const rows = await sb<AcademyTimeZoneRow[]>(
    `clients?id=in.(${inList(academyIds)})` +
      "&select=id,time_zone",
  );

  const byId = new Map<string, AcademyTimeZoneRow>();
  for (const row of Array.isArray(rows) ? rows : []) {
    byId.set(row.id, row);
  }

  const timeZones = new Map<string, string>();
  for (const academyId of academyIds) {
    const row = byId.get(academyId);
    if (!row) {
      throw new HttpError(404, "Academy not found.");
    }

    const timeZone = row.time_zone?.trim() || UTC_TIME_ZONE;
    assertValidTimeZone(timeZone);
    timeZones.set(academyId, timeZone);
  }

  return timeZones;
}

function ensureAcademyAccess(context: ParentScheduleContext, academyId: string): void {
  if (!context.academyIds.includes(academyId)) {
    throw new HttpError(403, "Not authorized to access this academy schedule.");
  }
}

function resolveMembershipsForAcademy(
  context: ParentScheduleContext,
  membershipId: string | undefined,
  academyId: string,
): Membership[] {
  if (!membershipId) {
    return context.memberships.filter((membership) => membership.academy_id === academyId);
  }

  const membership = getOwnedMembership(context, membershipId);
  if (membership.academy_id !== academyId) {
    throw new HttpError(403, "Membership does not belong to this academy.");
  }
  return [membership];
}

function resolveMemberships(context: ParentScheduleContext, membershipId?: string): Membership[] {
  if (!membershipId) return context.memberships;
  return [getOwnedMembership(context, membershipId)];
}

function getOwnedMembership(context: ParentScheduleContext, membershipId: string): Membership {
  const membership = context.memberships.find((row) => row.id === membershipId);
  if (!membership) {
    throw new HttpError(404, "Membership not found.");
  }
  return membership;
}

function getActionMembership(
  context: ParentScheduleContext,
  membershipId: string,
  requireActive: boolean,
): Membership {
  const membership = getOwnedMembership(context, membershipId);
  if (requireActive && membership.status !== "ACTIVE") {
    throw new HttpError(403, "Membership is not active.");
  }
  return membership;
}

function resolveActionStudentId(
  context: ParentScheduleContext,
  membership: Membership,
  requestedStudentId: string | null | undefined,
): string | null {
  const studentId = requestedStudentId || membership.student_id;
  if (membership.student_id && studentId !== membership.student_id) {
    throw new HttpError(400, "Student does not belong to membership.");
  }
  if (studentId && !context.studentIds.includes(studentId)) {
    throw new HttpError(403, "Student does not belong to this parent.");
  }
  return studentId ?? null;
}

async function getReservationOutForContext(
  context: ParentScheduleContext,
  reservationId: string,
): Promise<CustomerReservationOut> {
  const reservation = await getReservationById(reservationId);
  if (!reservation) {
    throw new HttpError(404, "Reservation not found.");
  }

  const slot = await getSlotById(reservation.slot_id);
  if (!slot) {
    throw new HttpError(500, "Reservation is missing its schedule slot.");
  }

  ensureAcademyAccess(context, slot.tenant_id);
  const memberships = resolveMembershipsForAcademy(context, undefined, slot.tenant_id);
  const state = await getSlotState([slot], { studentIds: context.studentIds });
  return toReservationOut(reservation, slot, state, memberships, context.studentIds);
}

async function getWaitlistOutForContext(
  context: ParentScheduleContext,
  waitlistId: string,
): Promise<CustomerWaitlistOut> {
  const waitlist = await getWaitlistEntryById(waitlistId);
  if (!waitlist) {
    throw new HttpError(404, "Waitlist entry not found.");
  }

  const slot = await getSlotById(waitlist.slot_id);
  if (!slot) {
    throw new HttpError(500, "Waitlist entry is missing its schedule slot.");
  }

  ensureAcademyAccess(context, slot.tenant_id);
  const memberships = resolveMembershipsForAcademy(context, undefined, slot.tenant_id);
  const state = await getSlotState([slot], { studentIds: context.studentIds });
  return toWaitlistOut(waitlist, slot, state, memberships, context.studentIds);
}

async function getSlotById(slotId: string): Promise<ScheduleSlot | null> {
  const rows = await sb<ScheduleSlot[]>(
    `schedule_slots?id=eq.${eq(slotId)}` +
      `&select=${slotSelect()}` +
      "&limit=1",
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getReservationById(reservationId: string): Promise<Reservation | null> {
  const rows = await sb<Reservation[]>(
    `reservations?id=eq.${eq(reservationId)}` +
      "&select=id,slot_id,membership_id,student_id,status,booked_at,cancelled_at" +
      "&limit=1",
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getWaitlistEntryById(waitlistId: string): Promise<WaitlistEntry | null> {
  const rows = await sb<WaitlistEntry[]>(
    `waitlist_entries?id=eq.${eq(waitlistId)}` +
      "&select=id,slot_id,membership_id,student_id,status,created_at" +
      "&limit=1",
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getSlots(opts: {
  academyIds: string[];
  startGte?: string;
  startLt?: string;
  limit: number;
  order: "asc" | "desc";
  includeCancelled: boolean;
}): Promise<ScheduleSlot[]> {
  if (opts.academyIds.length === 0) return [];

  const filters = [tenantFilter(opts.academyIds)];
  if (!opts.includeCancelled) filters.push("is_cancelled=eq.false");
  if (opts.startGte) filters.push(`start_time=gte.${eq(opts.startGte)}`);
  if (opts.startLt) filters.push(`start_time=lt.${eq(opts.startLt)}`);

  const rows = await sb<ScheduleSlot[]>(
    `schedule_slots?${filters.join("&")}` +
      `&select=${slotSelect()}` +
      `&order=start_time.${opts.order}` +
      `&limit=${opts.limit}`,
  );

  return Array.isArray(rows) ? rows : [];
}

async function getFutureSlotsAcrossAcademies(
  academyIds: string[],
  opts: {
    dateFrom?: string;
    dateTo?: string;
    limit: number;
    order: "asc" | "desc";
  },
): Promise<ScheduleSlot[]> {
  if (academyIds.length === 0) return [];

  const timeZones = await getAcademyTimeZones(academyIds);
  const slotGroups = await Promise.all(
    academyIds.map((academyId) => {
      const dateRange = futureDateRangeIso(
        opts.dateFrom,
        opts.dateTo,
        academyTimeZone(timeZones, academyId),
      );
      return getSlots({
        academyIds: [academyId],
        startGte: dateRange.startGte,
        startLt: dateRange.startLt,
        limit: opts.limit,
        order: opts.order,
        includeCancelled: false,
      });
    }),
  );

  return slotGroups
    .flat()
    .sort((a, b) => compareStartTimes(a.start_time, b.start_time, opts.order))
    .slice(0, opts.limit);
}

async function getSlotState(
  slots: Array<Pick<ScheduleSlot, "id" | "tenant_id">>,
  opts: { studentIds?: string[] } = {},
): Promise<SlotState> {
  const empty = emptySlotState();
  const slotIds = uniqueValues(slots.map((slot) => slot.id));
  if (slotIds.length === 0) return empty;
  const studentIds = uniqueValues((opts.studentIds ?? []).filter(isString));

  const academyIds = uniqueValues(slots.map((slot) => slot.tenant_id));
  const [reservations, waitlists, bookedCounts, trialBookings, trialHistory] = await Promise.all([
    getReservations({
      slotIds,
      statuses: ["CONFIRMED"],
      limit: RESERVATION_SCAN_LIMIT,
    }),
    getWaitlistEntries(slotIds),
    getBulkBookedCounts(slots),
    getTrialBookings({
      slotIds,
      statuses: ["BOOKED"],
      studentIds,
      limit: RESERVATION_SCAN_LIMIT,
    }),
    getTrialBookingsForStudents({
      academyIds,
      statuses: ["BOOKED", "SHOWED", "NO_SHOW", "CONVERTED"],
      studentIds,
      limit: RESERVATION_SCAN_LIMIT,
    }),
  ]);

  for (const [slotId, count] of bookedCounts) {
    empty.bookedCounts.set(slotId, count);
  }

  for (const reservation of reservations) {
    empty.reservationBySlotMembership.set(slotMembershipKey(reservation), reservation);
  }

  for (const trial of trialBookings) {
    if (trial.student_id) {
      empty.trialBySlotStudent.set(
        slotStudentKey({ slot_id: trial.slot_id, student_id: trial.student_id }),
        trial,
      );
    }
  }

  for (const trial of trialHistory) {
    if (!trial.student_id) continue;
    const key = tenantStudentKey({ tenant_id: trial.tenant_id, student_id: trial.student_id });
    if (trial.status === "BOOKED") {
      if (!empty.activeTrialByTenantStudent.has(key)) {
        empty.activeTrialByTenantStudent.set(key, trial);
      }
      continue;
    }
    empty.usedTrialTenantStudentKeys.add(key);
  }

  for (const waitlist of waitlists) {
    empty.waitlistCounts.set(
      waitlist.slot_id,
      (empty.waitlistCounts.get(waitlist.slot_id) || 0) + 1,
    );
    empty.waitlistBySlotMembership.set(slotMembershipKey(waitlist), waitlist);
  }

  return empty;
}

async function getBulkBookedCounts(
  slots: Array<Pick<ScheduleSlot, "id" | "tenant_id">>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const slotIdsByTenant = new Map<string, string[]>();

  for (const slot of slots) {
    const slotIds = slotIdsByTenant.get(slot.tenant_id) ?? [];
    slotIds.push(slot.id);
    slotIdsByTenant.set(slot.tenant_id, slotIds);
  }

  await Promise.all([...slotIdsByTenant.entries()].map(async ([tenantId, slotIds]) => {
    const rows = await rpc<SlotSpotsTakenRow[]>("slot_spots_taken_bulk", {
      p_tenant_id: tenantId,
      p_slot_ids: uniqueValues(slotIds),
    });
    for (const row of rows || []) {
      counts.set(row.slot_id, Number(row.spots_taken ?? 0));
    }
  }));

  return counts;
}

async function getReservations(opts: {
  slotIds: string[];
  membershipIds?: string[];
  statuses: ReservationStatus[];
  limit: number;
}): Promise<Reservation[]> {
  if (opts.slotIds.length === 0) return [];
  if (opts.membershipIds && opts.membershipIds.length === 0) return [];

  const filters = [
    `slot_id=in.(${inList(opts.slotIds)})`,
    statusFilter(opts.statuses),
  ];
  if (opts.membershipIds) {
    filters.push(`membership_id=in.(${inList(opts.membershipIds)})`);
  }

  const rows = await sb<Reservation[]>(
    `reservations?${filters.join("&")}` +
      "&select=id,slot_id,membership_id,student_id,status,booked_at,cancelled_at" +
      `&limit=${opts.limit}`,
  );

  return Array.isArray(rows) ? rows : [];
}

async function getTrialBookings(opts: {
  slotIds: string[];
  statuses: TrialBookingStatus[];
  studentIds: string[];
  limit: number;
}): Promise<TrialBooking[]> {
  if (opts.slotIds.length === 0 || opts.studentIds.length === 0) return [];

  const filters = [
    `slot_id=in.(${inList(opts.slotIds)})`,
    `student_id=in.(${inList(opts.studentIds)})`,
    "source=eq.parent_app",
    statusTextFilter(opts.statuses),
  ];

  const rows = await sb<TrialBooking[]>(
    `trial_bookings?${filters.join("&")}` +
      "&select=id,tenant_id,slot_id,customer_profile_id,student_id,status,booked_at,cancelled_at" +
      `&limit=${opts.limit}`,
  );

  return Array.isArray(rows) ? rows : [];
}

async function getTrialBookingsForStudents(opts: {
  academyIds: string[];
  statuses: TrialBookingStatus[];
  studentIds: string[];
  limit: number;
}): Promise<TrialBooking[]> {
  if (opts.academyIds.length === 0 || opts.studentIds.length === 0) return [];

  const filters = [
    tenantFilter(opts.academyIds),
    `student_id=in.(${inList(opts.studentIds)})`,
    "source=eq.parent_app",
    statusTextFilter(opts.statuses),
  ];

  const rows = await sb<TrialBooking[]>(
    `trial_bookings?${filters.join("&")}` +
      "&select=id,tenant_id,slot_id,customer_profile_id,student_id,status,booked_at,cancelled_at" +
      `&order=booked_at.desc&limit=${opts.limit}`,
  );

  return Array.isArray(rows) ? rows : [];
}

async function getWaitlistEntries(slotIds: string[]): Promise<WaitlistEntry[]> {
  if (slotIds.length === 0) return [];

  const rows = await sb<WaitlistEntry[]>(
    `waitlist_entries?slot_id=in.(${inList(slotIds)})` +
      "&status=eq.WAITING" +
      "&select=id,slot_id,membership_id,student_id,status,created_at" +
      `&limit=${RESERVATION_SCAN_LIMIT}`,
  );

  return Array.isArray(rows) ? rows : [];
}

function toCustomerSlot(
  slot: ScheduleSlot,
  state: SlotState,
  memberships: Membership[],
  studentIds: string[] = [],
): CustomerSlotOut {
  const bookedCount = state.bookedCounts.get(slot.id) || 0;
  const waitlistLength = state.waitlistCounts.get(slot.id) || 0;
  const startsInFuture = isFuture(slot.start_time);
  const enrollments = getSlotEnrollments(slot, state, memberships, studentIds, startsInFuture);
  const isFull = bookedCount >= slot.capacity;
  const primaryEnrollment = getPrimarySlotEnrollment(enrollments);
  const enrolledMembershipIds = new Set(
    enrollments.map((enrollment) => enrollment.membership_id).filter(isString),
  );
  const hasActiveAvailableMembership = memberships.some(
    (membership) => membership.status === "ACTIVE" && !enrolledMembershipIds.has(membership.id),
  );

  return {
    id: slot.id,
    tenant_id: slot.tenant_id,
    name: slot.name,
    description: slot.description,
    slot_type: slot.slot_type,
    location_label: slot.location_label,
    start_time: slot.start_time,
    end_time: slot.end_time,
    capacity: slot.capacity,
    credit_cost: slot.credit_cost ?? 1,
    is_cancelled: slot.is_cancelled,
    instructor_name: null,
    booked_count: bookedCount,
    waitlist_length: waitlistLength,
    enrollments,
    child_actions: getSlotChildActions({
      slot,
      state,
      memberships,
      studentIds,
      startsInFuture,
      isFull,
    }),
    my_status: primaryEnrollment?.status ?? null,
    my_reservation_id: primaryEnrollment?.reservation_id ?? null,
    my_waitlist_id: primaryEnrollment?.waitlist_id ?? null,
    can_book: startsInFuture && !slot.is_cancelled && hasActiveAvailableMembership && !isFull,
    can_waitlist: startsInFuture && !slot.is_cancelled && hasActiveAvailableMembership,
    can_cancel: enrollments.some((enrollment) => enrollment.can_cancel),
  };
}

function toReservationOut(
  reservation: Reservation,
  slot: ScheduleSlot | undefined,
  state: SlotState,
  memberships: Membership[],
  studentIds: string[],
): CustomerReservationOut {
  if (!slot) {
    throw new HttpError(500, "Reservation is missing its schedule slot.");
  }

  const slotMemberships = memberships.filter(
    (membership) => membership.academy_id === slot.tenant_id,
  );

  return {
    booking_kind: "reservation",
    id: reservation.id,
    slot_id: reservation.slot_id,
    membership_id: reservation.membership_id,
    student_id: reservation.student_id,
    status: reservation.status,
    booked_at: reservation.booked_at,
    slot: toCustomerSlot(slot, state, slotMemberships, studentIds),
  };
}

function toTrialBookingOut(
  trial: TrialBooking,
  slot: ScheduleSlot | undefined,
  state: SlotState,
  memberships: Membership[],
  studentIds: string[],
): CustomerReservationOut {
  if (!slot) {
    throw new HttpError(500, "Trial booking is missing its schedule slot.");
  }

  const slotMemberships = memberships.filter(
    (membership) => membership.academy_id === slot.tenant_id,
  );

  return {
    booking_kind: "trial",
    id: trial.id,
    slot_id: trial.slot_id,
    membership_id: null,
    student_id: trial.student_id,
    status: trial.status,
    booked_at: trial.booked_at,
    slot: toCustomerSlot(slot, state, slotMemberships, studentIds),
    trial_booking_id: trial.id,
  };
}

function toWaitlistOut(
  waitlist: WaitlistEntry,
  slot: ScheduleSlot,
  state: SlotState,
  memberships: Membership[],
  studentIds: string[] = [],
): CustomerWaitlistOut {
  const slotMemberships = memberships.filter(
    (membership) => membership.academy_id === slot.tenant_id,
  );

  return {
    id: waitlist.id,
    slot_id: waitlist.slot_id,
    membership_id: waitlist.membership_id,
    student_id: waitlist.student_id,
    status: waitlist.status,
    created_at: waitlist.created_at,
    slot: toCustomerSlot(slot, state, slotMemberships, studentIds),
  };
}

function getSlotEnrollments(
  slot: ScheduleSlot,
  state: SlotState,
  memberships: Membership[],
  studentIds: string[],
  startsInFuture: boolean,
): CustomerSlotEnrollmentOut[] {
  const enrollments: CustomerSlotEnrollmentOut[] = [];

  for (const membership of memberships) {
    const key = slotMembershipKey({ slot_id: slot.id, membership_id: membership.id });
    const reservation = state.reservationBySlotMembership.get(key);
    if (reservation) {
      enrollments.push({
        booking_kind: "reservation",
        membership_id: membership.id,
        student_id: reservation.student_id ?? membership.student_id,
        status: "CONFIRMED",
        reservation_id: reservation.id,
        trial_booking_id: null,
        waitlist_id: null,
        can_cancel: startsInFuture && !slot.is_cancelled,
      });
      continue;
    }

    const waitlist = state.waitlistBySlotMembership.get(key);
    if (waitlist) {
      enrollments.push({
        membership_id: membership.id,
        student_id: waitlist.student_id ?? membership.student_id,
        status: "WAITING",
        reservation_id: null,
        trial_booking_id: null,
        waitlist_id: waitlist.id,
        can_cancel: false,
      });
    }
  }

  const enrolledStudentIds = new Set(enrollments.map((enrollment) => enrollment.student_id).filter(isString));
  for (const studentId of uniqueValues(studentIds)) {
    if (enrolledStudentIds.has(studentId)) continue;
    const trial = state.trialBySlotStudent.get(slotStudentKey({ slot_id: slot.id, student_id: studentId }));
    if (!trial) continue;

    enrollments.push({
      booking_kind: "trial",
      membership_id: null,
      student_id: studentId,
      status: "CONFIRMED",
      reservation_id: null,
      trial_booking_id: trial.id,
      waitlist_id: null,
      can_cancel: false,
    });
  }

  return enrollments;
}

function getPrimarySlotEnrollment(
  enrollments: CustomerSlotEnrollmentOut[],
): CustomerSlotEnrollmentOut | undefined {
  return (
    enrollments.find((enrollment) => enrollment.status === "CONFIRMED") ??
    enrollments.find((enrollment) => enrollment.status === "WAITING")
  );
}

function getSlotChildActions(opts: {
  slot: ScheduleSlot;
  state: SlotState;
  memberships: Membership[];
  studentIds: string[];
  startsInFuture: boolean;
  isFull: boolean;
}): CustomerSlotChildActionOut[] {
  const { slot, state, memberships, studentIds, startsInFuture, isFull } = opts;
  const activeMemberships = memberships.filter(
    (membership) => membership.academy_id === slot.tenant_id && membership.status === "ACTIVE",
  );

  return uniqueValues(studentIds).map((studentId) => {
    const activeMembership = activeMemberships.find(
      (membership) => !membership.student_id || membership.student_id === studentId,
    );
    const pausedMembership = memberships.find(
      (membership) =>
        membership.academy_id === slot.tenant_id &&
        membership.student_id === studentId &&
        membership.status === "SUSPENDED" &&
        Boolean(membership.stripe_customer_id),
    );
    const actionMembership = activeMembership ?? pausedMembership;
    const reservation = actionMembership
      ? getReservationForStudent(slot, state, actionMembership, studentId)
      : undefined;
    if (reservation) {
      return {
        student_id: studentId,
        action: "already_booked",
        booking_kind: "reservation",
        enabled: false,
        reason: "already_booked",
        membership_id: actionMembership?.id ?? reservation.membership_id,
        reservation_id: reservation.id,
      };
    }

    const activeTrial = state.activeTrialByTenantStudent.get(
      tenantStudentKey({ tenant_id: slot.tenant_id, student_id: studentId }),
    );
    if (activeTrial?.slot_id === slot.id) {
      return {
        student_id: studentId,
        action: "already_booked_trial",
        booking_kind: "trial",
        enabled: false,
        reason: "already_booked_trial",
        membership_id: null,
        trial_booking_id: activeTrial.id,
        trial_slot_id: activeTrial.slot_id,
      };
    }

    const waitlist = activeMembership
      ? state.waitlistBySlotMembership.get(
          slotMembershipKey({ slot_id: slot.id, membership_id: activeMembership.id }),
        )
      : undefined;
    if (waitlist) {
      return {
        student_id: studentId,
        action: "waitlisted",
        booking_kind: "reservation",
        enabled: false,
        reason: "already_waitlisted",
        membership_id: activeMembership?.id ?? waitlist.membership_id,
        waitlist_id: waitlist.id,
      };
    }

    if (slot.is_cancelled) {
      return unavailableSlotAction(studentId, "slot_cancelled");
    }
    if (!startsInFuture) {
      return unavailableSlotAction(studentId, "slot_started");
    }

    if (pausedMembership) {
      return unavailableSlotAction(studentId, "membership_paused", pausedMembership.id);
    }

    if (activeMembership) {
      if (isFull) {
        return {
          student_id: studentId,
          action: "join_waitlist",
          booking_kind: "reservation",
          enabled: true,
          reason: "slot_full",
          membership_id: activeMembership.id,
        };
      }

      return {
        student_id: studentId,
        action: "book_with_plan",
        booking_kind: "reservation",
        enabled: true,
        reason: "active_membership",
        membership_id: activeMembership.id,
      };
    }

    if (isFull) {
      return unavailableSlotAction(studentId, "slot_full");
    }

    if (activeTrial) {
      return {
        student_id: studentId,
        action: "subscribe",
        booking_kind: null,
        enabled: true,
        reason: "trial_booked",
        membership_id: null,
        trial_booking_id: activeTrial.id,
        trial_slot_id: activeTrial.slot_id,
      };
    }

    if (
      state.usedTrialTenantStudentKeys.has(
        tenantStudentKey({ tenant_id: slot.tenant_id, student_id: studentId }),
      )
    ) {
      return {
        student_id: studentId,
        action: "subscribe",
        booking_kind: null,
        enabled: true,
        reason: "trial_used",
        membership_id: null,
      };
    }

    return {
      student_id: studentId,
      action: "book_trial",
      booking_kind: "trial",
      enabled: true,
      reason: "trial_available",
      membership_id: null,
    };
  });
}

function getReservationForStudent(
  slot: ScheduleSlot,
  state: SlotState,
  membership: Membership,
  studentId: string,
): Reservation | undefined {
  const reservation = state.reservationBySlotMembership.get(
    slotMembershipKey({ slot_id: slot.id, membership_id: membership.id }),
  );
  if (!reservation) return undefined;
  if (reservation.student_id) return reservation.student_id === studentId ? reservation : undefined;
  if (membership.student_id) return membership.student_id === studentId ? reservation : undefined;
  return reservation;
}

function unavailableSlotAction(
  studentId: string,
  reason: "slot_cancelled" | "slot_started" | "slot_full" | "membership_paused",
  membershipId?: string,
): CustomerSlotChildActionOut {
  return {
    student_id: studentId,
    action: "unavailable",
    booking_kind: null,
    enabled: false,
    reason,
    membership_id: membershipId ?? null,
  };
}

function emptySlotState(): SlotState {
  return {
    bookedCounts: new Map<string, number>(),
    waitlistCounts: new Map<string, number>(),
    reservationBySlotMembership: new Map<string, Reservation>(),
    trialBySlotStudent: new Map<string, TrialBooking>(),
    activeTrialByTenantStudent: new Map<string, TrialBooking>(),
    usedTrialTenantStudentKeys: new Set<string>(),
    waitlistBySlotMembership: new Map<string, WaitlistEntry>(),
  };
}

function mapSlots(slots: ScheduleSlot[]): Map<string, ScheduleSlot> {
  const byId = new Map<string, ScheduleSlot>();
  for (const slot of slots) byId.set(slot.id, slot);
  return byId;
}

function tenantFilter(academyIds: string[]): string {
  if (academyIds.length === 1) {
    const academyId = academyIds[0];
    if (!academyId) throw new HttpError(400, "Missing academy id.");
    return `tenant_id=eq.${eq(academyId)}`;
  }
  return `tenant_id=in.(${inList(academyIds)})`;
}

function statusFilter(statuses: ReservationStatus[]): string {
  if (statuses.length === 1) {
    const status = statuses[0];
    if (!status) throw new HttpError(500, "Reservation status filter is empty.");
    return `status=eq.${eq(status)}`;
  }
  return `status=in.(${inList(statuses)})`;
}

function statusTextFilter(statuses: string[]): string {
  if (statuses.length === 1) {
    const status = statuses[0];
    if (!status) throw new HttpError(500, "Status filter is empty.");
    return `status=eq.${eq(status)}`;
  }
  return `status=in.(${inList(statuses)})`;
}

function trialStudentIdsForMemberships(
  context: ParentScheduleContext,
  memberships: Membership[],
  hasMembershipFilter: boolean,
): string[] {
  if (!hasMembershipFilter) return context.studentIds;
  return uniqueValues(memberships.map((membership) => membership.student_id).filter(isString));
}

function slotSelect(): string {
  return [
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
    "instructor_id",
    "slot_template_id",
    "location_id",
  ].join(",");
}

function slotMembershipKey(row: { slot_id: string; membership_id: string }): string {
  return `${row.slot_id}:${row.membership_id}`;
}

function slotStudentKey(row: { slot_id: string; student_id: string }): string {
  return `${row.slot_id}:${row.student_id}`;
}

function tenantStudentKey(row: { tenant_id: string; student_id: string }): string {
  return `${row.tenant_id}:${row.student_id}`;
}

function academyTimeZone(timeZones: Map<string, string>, academyId: string): string {
  const timeZone = timeZones.get(academyId);
  if (!timeZone) {
    throw new HttpError(404, "Academy not found.");
  }
  return timeZone;
}

function futureDateRangeIso(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  timeZone: string,
): { startGte: string; startLt?: string } {
  return {
    startGte: futureStartIso(dateFrom, timeZone),
    startLt: dateTo ? dateBoundaryIso(dateTo, "end", timeZone) : undefined,
  };
}

function futureStartIso(value: string | undefined, timeZone: string): string {
  const now = new Date();
  if (!value) return now.toISOString();

  const start = dateBoundaryIso(value, "start", timeZone);
  return new Date(start) > now ? start : now.toISOString();
}

function dateBoundaryIso(value: string, boundary: "start" | "end", timeZone: string): string {
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (!dateOnly) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new HttpError(400, `Invalid date: ${value}`);
    }
    return date.toISOString();
  }

  const [, yearValue, monthValue, dayValue] = dateOnly;
  if (!yearValue || !monthValue || !dayValue) {
    throw new HttpError(400, `Invalid date: ${value}`);
  }

  const localDate = {
    year: Number(yearValue),
    month: Number(monthValue),
    day: Number(dayValue),
    hour: 0,
    minute: 0,
    second: 0,
  };
  if (!isValidDateParts(localDate)) {
    throw new HttpError(400, `Invalid date: ${value}`);
  }

  const boundaryDate = boundary === "end" ? addDaysToParts(localDate, 1) : localDate;
  const date = zonedDateTimeToUtc(boundaryDate, timeZone);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `Invalid date: ${value}`);
  }
  return date.toISOString();
}

function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new HttpError(500, "Invalid academy time zone configured.");
  }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function addDaysToParts(parts: LocalDateTimeParts, days: number): LocalDateTimeParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function isValidDateParts(parts: LocalDateTimeParts): boolean {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() + 1 === parts.month &&
    date.getUTCDate() === parts.day
  );
}

function zonedDateTimeToUtc(parts: LocalDateTimeParts, timeZone: string): Date {
  const desiredTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let utcDate = new Date(desiredTime);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const renderedParts = timeZoneParts(utcDate, timeZone);
    const renderedTime = Date.UTC(
      renderedParts.year,
      renderedParts.month - 1,
      renderedParts.day,
      renderedParts.hour,
      renderedParts.minute,
      renderedParts.second,
    );
    const offset = desiredTime - renderedTime;
    if (offset === 0) return utcDate;
    utcDate = new Date(utcDate.getTime() + offset);
  }

  return utcDate;
}

function timeZoneParts(date: Date, timeZone: string): LocalDateTimeParts {
  const formattedParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = new Map<string, string>();
  for (const part of formattedParts) {
    if (part.type !== "literal") values.set(part.type, part.value);
  }

  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new HttpError(500, "Unable to resolve academy time zone.");
  }

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

function compareStartTimes(left: string, right: string, order: "asc" | "desc"): number {
  const delta = new Date(left).getTime() - new Date(right).getTime();
  return order === "asc" ? delta : -delta;
}

function isFuture(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date > new Date();
}

function compareSlotStart(a: CustomerSlotOut, b: CustomerSlotOut, order: "asc" | "desc"): number {
  return compareStartTimes(a.start_time, b.start_time, order);
}

function scanLimit(limit: number): number {
  return Math.min(Math.max(limit * 10, 100), SLOT_SCAN_LIMIT);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
