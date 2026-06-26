import { HttpError } from "./_errors.js";
import { eq, inList, rpc, sb, verifySupabaseUser } from "./_supabase.js";
import type { ParentApiRequest } from "./_types.js";

const MISSING_CUSTOMER_PROFILE_MESSAGE =
  "No customer profile found. Please register to continue.";

const SLOT_SCAN_LIMIT = 1_000;
const RESERVATION_SCAN_LIMIT = 1_000;
const UTC_TIME_ZONE = "UTC";
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type CustomerProfile = {
  id: string;
  supabase_user_id: string;
};

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

type WaitlistEntry = {
  id: string;
  slot_id: string;
  membership_id: string;
  student_id: string | null;
  status: "WAITING" | "PROMOTED" | "EXPIRED" | "REMOVED";
  created_at: string;
};

type ParentScheduleContext = {
  profile: CustomerProfile;
  memberships: Membership[];
  studentIds: string[];
  academyIds: string[];
};

type SlotState = {
  bookedCounts: Map<string, number>;
  waitlistCounts: Map<string, number>;
  reservationBySlotMembership: Map<string, Reservation>;
  waitlistBySlotMembership: Map<string, WaitlistEntry>;
};

export type CustomerSlotEnrollmentOut = {
  membership_id: string;
  student_id: string | null;
  status: "CONFIRMED" | "WAITING";
  reservation_id: string | null;
  waitlist_id: string | null;
  can_cancel: boolean;
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
  my_status: "CONFIRMED" | "WAITING" | null;
  my_reservation_id: string | null;
  my_waitlist_id: string | null;
  can_book: boolean;
  can_waitlist: boolean;
  can_cancel: boolean;
};

export type CustomerReservationOut = {
  id: string;
  slot_id: string;
  membership_id: string;
  student_id: string | null;
  status: ReservationStatus;
  booked_at: string;
  slot: CustomerSlotOut;
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
  const profile = await getCustomerProfile(user.id);
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
  const state = await getSlotState(slots.map((slot) => slot.id));
  return slots.map((slot) => toCustomerSlot(slot, state, memberships));
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
  const state = await getSlotState([slot.id]);
  return toCustomerSlot(slot, state, memberships);
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
  if (membershipIds.length === 0 || context.academyIds.length === 0) return [];

  const slotLimit = scanLimit(opts.limit);
  const slots = await getFutureSlotsAcrossAcademies(context.academyIds, {
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    limit: slotLimit,
    order: "asc",
  });
  if (slots.length === 0) return [];

  const slotById = mapSlots(slots);
  const reservations = await getReservations({
    slotIds: slots.map((slot) => slot.id),
    membershipIds,
    statuses: ["CONFIRMED"],
    limit: RESERVATION_SCAN_LIMIT,
  });
  const state = await getSlotState(slots.map((slot) => slot.id));

  return reservations
    .filter((reservation) => slotById.has(reservation.slot_id))
    .map((reservation) =>
      toReservationOut(reservation, slotById.get(reservation.slot_id), state, memberships),
    )
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
  if (membershipIds.length === 0 || context.academyIds.length === 0) return [];

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
  const reservations = await getReservations({
    slotIds: slots.map((slot) => slot.id),
    membershipIds,
    statuses: ["CONFIRMED", "ATTENDED", "NO_SHOW"],
    limit: RESERVATION_SCAN_LIMIT,
  });
  const state = await getSlotState(slots.map((slot) => slot.id));

  return reservations
    .filter((reservation) => slotById.has(reservation.slot_id))
    .map((reservation) =>
      toReservationOut(reservation, slotById.get(reservation.slot_id), state, memberships),
    )
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

async function getCustomerProfile(supabaseUserId: string): Promise<CustomerProfile> {
  const rows = await sb<CustomerProfile[]>(
    `customer_profiles?supabase_user_id=eq.${eq(supabaseUserId)}` +
      "&select=id,supabase_user_id" +
      "&limit=1",
  );
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) {
    throw new HttpError(403, MISSING_CUSTOMER_PROFILE_MESSAGE, MISSING_CUSTOMER_PROFILE_MESSAGE);
  }
  return profile;
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
      "&select=id,academy_id,customer_id,student_id,status",
  );

  let studentMemberships: Membership[] = [];
  if (studentIds.length > 0) {
    studentMemberships = await sb<Membership[]>(
      `academy_memberships?student_id=in.(${inList(studentIds)})` +
        "&select=id,academy_id,customer_id,student_id,status",
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
  const state = await getSlotState([slot.id]);
  return toReservationOut(reservation, slot, state, memberships);
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
  const state = await getSlotState([slot.id]);
  return toWaitlistOut(waitlist, slot, state, memberships);
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

async function getSlotState(slotIds: string[]): Promise<SlotState> {
  const empty = emptySlotState();
  if (slotIds.length === 0) return empty;

  const reservations = await getReservations({
    slotIds,
    statuses: ["CONFIRMED"],
    limit: RESERVATION_SCAN_LIMIT,
  });
  const waitlists = await getWaitlistEntries(slotIds);

  for (const reservation of reservations) {
    empty.bookedCounts.set(
      reservation.slot_id,
      (empty.bookedCounts.get(reservation.slot_id) || 0) + 1,
    );
    empty.reservationBySlotMembership.set(slotMembershipKey(reservation), reservation);
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
): CustomerSlotOut {
  const bookedCount = state.bookedCounts.get(slot.id) || 0;
  const waitlistLength = state.waitlistCounts.get(slot.id) || 0;
  const startsInFuture = isFuture(slot.start_time);
  const enrollments = getSlotEnrollments(slot, state, memberships, startsInFuture);
  const primaryEnrollment = getPrimarySlotEnrollment(enrollments);
  const enrolledMembershipIds = new Set(
    enrollments.map((enrollment) => enrollment.membership_id),
  );
  const hasActiveAvailableMembership = memberships.some(
    (membership) => membership.status === "ACTIVE" && !enrolledMembershipIds.has(membership.id),
  );
  const isFull = bookedCount >= slot.capacity;

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
): CustomerReservationOut {
  if (!slot) {
    throw new HttpError(500, "Reservation is missing its schedule slot.");
  }

  const slotMemberships = memberships.filter(
    (membership) => membership.academy_id === slot.tenant_id,
  );

  return {
    id: reservation.id,
    slot_id: reservation.slot_id,
    membership_id: reservation.membership_id,
    student_id: reservation.student_id,
    status: reservation.status,
    booked_at: reservation.booked_at,
    slot: toCustomerSlot(slot, state, slotMemberships),
  };
}

function toWaitlistOut(
  waitlist: WaitlistEntry,
  slot: ScheduleSlot,
  state: SlotState,
  memberships: Membership[],
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
    slot: toCustomerSlot(slot, state, slotMemberships),
  };
}

function getSlotEnrollments(
  slot: ScheduleSlot,
  state: SlotState,
  memberships: Membership[],
  startsInFuture: boolean,
): CustomerSlotEnrollmentOut[] {
  const enrollments: CustomerSlotEnrollmentOut[] = [];

  for (const membership of memberships) {
    const key = slotMembershipKey({ slot_id: slot.id, membership_id: membership.id });
    const reservation = state.reservationBySlotMembership.get(key);
    if (reservation) {
      enrollments.push({
        membership_id: membership.id,
        student_id: reservation.student_id ?? membership.student_id,
        status: "CONFIRMED",
        reservation_id: reservation.id,
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
        waitlist_id: waitlist.id,
        can_cancel: false,
      });
    }
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

function emptySlotState(): SlotState {
  return {
    bookedCounts: new Map<string, number>(),
    waitlistCounts: new Map<string, number>(),
    reservationBySlotMembership: new Map<string, Reservation>(),
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
