import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RuntimeApiRequest, RuntimeApiResponse } from "./_types.js";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const runtimeTestSupabaseUrl = process.env.RUNTIME_TEST_SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const runtimeTestServiceRoleKey = process.env.RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY;
const runtimeTestAnonKey = process.env.RUNTIME_TEST_SUPABASE_ANON_KEY;

if (!runtimeTestServiceRoleKey) {
  throw new Error("RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY is required. Run npm run test:runtime.");
}
if (!runtimeTestAnonKey) {
  throw new Error("RUNTIME_TEST_SUPABASE_ANON_KEY is required. Run npm run test:runtime.");
}

process.env.VITE_SUPABASE_URL = runtimeTestSupabaseUrl;
process.env.SUPABASE_URL = runtimeTestSupabaseUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = runtimeTestServiceRoleKey;

const TENANT_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";
const TRAINING_PROGRAM_ID = "80000000-0000-4000-8000-000000000001";
const DEV_ORIGIN = "http://localhost:3000";
const TEST_RUN_ID = randomUUID();
const TEST_PASSWORD = `runtime-trials-${TEST_RUN_ID}-Password1`;

type ApiHandler = (req: RuntimeApiRequest, res: RuntimeApiResponse) => Promise<unknown>;

type MockResponse = RuntimeApiResponse & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  ended: boolean;
};

type TrialSlotResponseRow = {
  id: string;
  capacity: number;
  reservation_count: number;
  trial_count: number;
  spots_taken: number;
  spots_left: number;
};

type TrialSlotsResponse = {
  slots: TrialSlotResponseRow[];
};

type TrialBookingResponse = {
  trial_booking_id: string;
  status: string;
  slot_id?: string;
};

type ParentTrialBookingResponse = TrialBookingResponse & {
  academy_id: string;
  student_id: string;
};

type ParentTrialCancelResponse = ParentTrialBookingResponse & {
  cancelled: boolean;
  status: "CANCELLED";
};

type ParentUpcomingBookingResponse = {
  booking_kind: "reservation" | "trial";
  id: string;
  membership_id: string | null;
  slot_id: string;
  status: string;
  student_id: string | null;
  trial_booking_id?: string | null;
};

type TrialBookingIdentityRow = {
  id: string;
  athlete_name: string;
  customer_profile_id: string | null;
  metadata: Record<string, unknown> | null;
  parent_email: string;
  source: string;
  status: string;
  student_id: string | null;
};

type CalendarResponse = {
  slots: Array<{
    id: string;
    capacity: number;
    reservation_count: number;
    trial_count: number;
    spots_taken: number;
    spots_left: number;
  }>;
};

type ParentSlotResponseRow = {
  id: string;
  booked_count: number;
  capacity: number;
  can_book: boolean;
  child_actions: ParentSlotChildAction[];
  enrollments: Array<{
    booking_kind?: "reservation" | "trial";
    membership_id: string | null;
    reservation_id: string | null;
    status: string;
    student_id: string | null;
    trial_booking_id?: string | null;
  }>;
};

type ParentSlotChildAction = {
  student_id: string;
  action: string;
  booking_kind: "reservation" | "trial" | null;
  enabled: boolean;
  reason: string;
  membership_id?: string | null;
  reservation_id?: string | null;
  trial_booking_id?: string | null;
  trial_slot_id?: string | null;
  waitlist_id?: string | null;
};

type TrialOutcomeResponse = {
  trial_booking_id: string;
  status: string;
  changed: boolean;
};

type SlotCancelResponse = {
  reservations_cancelled: number;
  credits_refunded: number;
  waitlist_cancelled: number;
  trials_cancelled: number;
  already_cancelled: boolean;
};

type SlotSpotsTakenBulkRow = {
  slot_id: string;
  spots_taken: number | string | null;
};

type BookingActor = {
  profileId: string;
  studentId: string;
  membershipId: string;
  entitlementId: string;
};

type TrialEligibleActor = {
  email: string;
  profileId: string;
  studentId: string;
};

const serviceSupabase = createClient(runtimeTestSupabaseUrl, runtimeTestServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const anonSupabase = createClient(runtimeTestSupabaseUrl, runtimeTestAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

let trialSlotsHandler: ApiHandler;
let trialBookingHandler: ApiHandler;
let parentTrialBookingHandler: ApiHandler;
let parentUpcomingReservationsHandler: ApiHandler;
let calendarHandler: ApiHandler;
let parentSlotsHandler: ApiHandler;
let trialBookingsHandler: ApiHandler;
let slotCancelHandler: ApiHandler;
let staffToken = "";
let parentToken = "";
let trialParentToken = "";
let templateId = "";
let originSlotId = "";
let targetSlotId = "";
let dateFrom = "";
let dateTo = "";
let memberActor: BookingActor;
let overCapacityActor: BookingActor;
let memberReservationId = "";
let cancelledTrialBookingId = "";
let rescheduledTrialBookingId = "";
let trialEligibleActor: TrialEligibleActor;

const createdUserIds: string[] = [];
const createdStaffIds: string[] = [];
const createdClientIds: string[] = [];
const createdBookableProgramIds: string[] = [];
const createdTemplateIds: string[] = [];
const createdSlotIds: string[] = [];
const createdReservationIds: string[] = [];
const createdTrialBookingIds: string[] = [];
const createdProfileIds: string[] = [];
const createdStudentIds: string[] = [];
const createdMembershipIds: string[] = [];
const createdEntitlementIds: string[] = [];

describe("trial booking runtime APIs", () => {
  beforeAll(async () => {
    assertLocalSupabase();

    const trialSlotsModule = await import("../website/trial-slots.js");
    const trialBookingModule = await import("../website/trial-booking.js");
    const parentTrialBookingModule = await import("../parent/trial-booking.js");
    const parentUpcomingReservationsModule = await import("../parent/reservations/upcoming.js");
    const calendarModule = await import("./schedule/calendar.js");
    const parentSlotsModule = await import("../parent/schedule/slots.js");
    const trialBookingsModule = await import("./trial-bookings.js");
    const slotCancelModule = await import("./schedule/slot-cancel.js");

    trialSlotsHandler = trialSlotsModule.default as ApiHandler;
    trialBookingHandler = trialBookingModule.default as ApiHandler;
    parentTrialBookingHandler = parentTrialBookingModule.default as ApiHandler;
    parentUpcomingReservationsHandler = parentUpcomingReservationsModule.default as ApiHandler;
    calendarHandler = calendarModule.default as ApiHandler;
    parentSlotsHandler = parentSlotsModule.default as ApiHandler;
    trialBookingsHandler = trialBookingsModule.default as ApiHandler;
    slotCancelHandler = slotCancelModule.default as ApiHandler;

    staffToken = await createStaffToken();
    const parentUser = await createSignedInUser(`runtime-trials-parent-${TEST_RUN_ID}@example.test`);
    parentToken = parentUser.token;
    const trialParentUser = await createSignedInUser(`runtime-trials-app-parent-${TEST_RUN_ID}@example.test`);
    trialParentToken = trialParentUser.token;

    await createTrialTemplateAndSlots();
    memberActor = await createBookingActor("member", parentUser.userId);
    overCapacityActor = await createBookingActor("over-capacity");
    trialEligibleActor = await createTrialEligibleActor("parent-app-trial", trialParentUser.userId);
  });

  afterAll(async () => {
    await cleanupCreatedRows();
  });

  it("shares mixed member and trial capacity across public and parent booking RPCs", async () => {
    memberReservationId = await bookMemberSlot(memberActor, originSlotId);
    createdReservationIds.push(memberReservationId);

    const trial = await bookTrial(originSlotId, "trial-one@example.test");
    createdTrialBookingIds.push(trial.trial_booking_id);

    const publicSlot = await trialSlot(originSlotId);
    expect(publicSlot).toMatchObject({
      capacity: 2,
      reservation_count: 1,
      trial_count: 1,
      spots_taken: 2,
      spots_left: 0,
    });

    const nextTrialRes = await invoke(trialBookingHandler, {
      method: "POST",
      headers: { origin: DEV_ORIGIN },
      body: trialBookingBody(originSlotId, "trial-two@example.test"),
    });
    expect(nextTrialRes.statusCode).toBe(409);
    expect(nextTrialRes.body).toMatchObject({ error: "Slot is full." });

    const { error } = await serviceSupabase.rpc("parent_book_slot", {
      p_tenant_id: TENANT_ID,
      p_slot_id: originSlotId,
      p_membership_id: overCapacityActor.membershipId,
      p_student_id: overCapacityActor.studentId,
    });
    expect(error?.message).toContain("Slot is full");
  });

  it("keeps staff calendar spots_taken aligned with public spots_left math", async () => {
    const calendar = await calendarSlot(originSlotId);
    const publicSlot = await trialSlot(originSlotId);

    expect(calendar).toMatchObject({
      capacity: publicSlot.capacity,
      reservation_count: 1,
      trial_count: 1,
      spots_taken: 2,
      spots_left: 0,
    });
    expect(calendar.spots_taken).toBe(publicSlot.capacity - publicSlot.spots_left);
  });

  it("includes unrelated public trials in parent slot capacity without exposing them as enrollments", async () => {
    const slot = await parentSlot(originSlotId);

    expect(slot.booked_count).toBe(2);
    expect(slot.capacity).toBe(2);
    expect(slot.can_book).toBe(false);
    expect(slot.enrollments).toHaveLength(1);
    expect(slot.enrollments[0]).toMatchObject({
      booking_kind: "reservation",
      status: "CONFIRMED",
      reservation_id: memberReservationId,
    });
  });

  it("books a parent-app trial with parent and child identity", async () => {
    const slotId = await createSlot(futureDateAtUtcHour(10, 21), "Parent App Trial");
    const secondSlotId = await createSlot(futureDateAtUtcHour(11, 21), "Parent App Trial Second");
    const activeSiblingStudentId = await createStudentForParent(
      trialEligibleActor.profileId,
      "parent-app-active-sibling",
    );
    await createActiveMembershipForStudent(activeSiblingStudentId, "parent-app-active-sibling");

    const firstRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(slotId, trialEligibleActor.studentId),
    });
    const firstBody = firstRes.body as ParentTrialBookingResponse;

    expect(firstRes.statusCode).toBe(200);
    expect(firstBody).toMatchObject({
      academy_id: TENANT_ID,
      slot_id: slotId,
      status: "BOOKED",
      student_id: trialEligibleActor.studentId,
    });
    expect(firstBody.trial_booking_id).toMatch(/[0-9a-f-]{36}/);
    createdTrialBookingIds.push(firstBody.trial_booking_id);

    const row = await getTrialBookingIdentity(firstBody.trial_booking_id);
    expect(row).toMatchObject({
      athlete_name: "Runtime Trial Athlete parent-app-trial",
      customer_profile_id: trialEligibleActor.profileId,
      parent_email: trialEligibleActor.email,
      source: "parent_app",
      status: "BOOKED",
      student_id: trialEligibleActor.studentId,
    });
    expect(row.metadata).toMatchObject({
      source: "runtime-test",
      test_run_id: TEST_RUN_ID,
    });

    const parentSlotAfterFirstTrial = await parentSlot(slotId, trialParentToken);
    expect(parentSlotAfterFirstTrial).toMatchObject({
      booked_count: 1,
    });
    expect(parentSlotAfterFirstTrial.enrollments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          booking_kind: "trial",
          membership_id: null,
          reservation_id: null,
          status: "CONFIRMED",
          student_id: trialEligibleActor.studentId,
          trial_booking_id: firstBody.trial_booking_id,
        }),
      ]),
    );

    const upcomingRes = await invoke(parentUpcomingReservationsHandler, {
      method: "GET",
      headers: { authorization: `Bearer ${trialParentToken}` },
      query: { limit: "50" },
    });
    const upcomingBody = upcomingRes.body as ParentUpcomingBookingResponse[];

    expect(upcomingRes.statusCode).toBe(200);
    expect(upcomingBody).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          booking_kind: "trial",
          id: firstBody.trial_booking_id,
          membership_id: null,
          slot_id: slotId,
          status: "BOOKED",
          student_id: trialEligibleActor.studentId,
          trial_booking_id: firstBody.trial_booking_id,
        }),
      ]),
    );

    const idempotentRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(slotId, trialEligibleActor.studentId),
    });
    expect(idempotentRes.statusCode).toBe(200);
    expect((idempotentRes.body as ParentTrialBookingResponse).trial_booking_id)
      .toBe(firstBody.trial_booking_id);

    const sameSlotSiblingStudentId = await createStudentForParent(
      trialEligibleActor.profileId,
      "parent-app-trial-same-slot-sibling",
    );
    const sameSlotSiblingRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(slotId, sameSlotSiblingStudentId),
    });
    const sameSlotSiblingBody = sameSlotSiblingRes.body as ParentTrialBookingResponse;

    expect(sameSlotSiblingRes.statusCode).toBe(200);
    expect(sameSlotSiblingBody).toMatchObject({
      academy_id: TENANT_ID,
      slot_id: slotId,
      status: "BOOKED",
      student_id: sameSlotSiblingStudentId,
    });
    expect(sameSlotSiblingBody.trial_booking_id).not.toBe(firstBody.trial_booking_id);
    createdTrialBookingIds.push(sameSlotSiblingBody.trial_booking_id);
    await expect(slotSpotsTaken(slotId)).resolves.toBe(2);

    const parentSlotAfterSiblingTrial = await parentSlot(slotId, trialParentToken);
    expect(parentSlotAfterSiblingTrial.booked_count).toBe(2);
    expect(parentSlotAfterSiblingTrial.enrollments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          booking_kind: "trial",
          student_id: trialEligibleActor.studentId,
          trial_booking_id: firstBody.trial_booking_id,
        }),
        expect.objectContaining({
          booking_kind: "trial",
          student_id: sameSlotSiblingStudentId,
          trial_booking_id: sameSlotSiblingBody.trial_booking_id,
        }),
      ]),
    );

    const duplicateSlotRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(secondSlotId, trialEligibleActor.studentId),
    });
    expect(duplicateSlotRes.statusCode).toBe(409);
    expect(duplicateSlotRes.body).toMatchObject({ error: "Student already has a booked trial." });

    const { error: outcomeError } = await serviceSupabase.rpc("set_trial_outcome", {
      p_tenant_id: TENANT_ID,
      p_trial_booking_id: firstBody.trial_booking_id,
      p_status: "NO_SHOW",
    });
    expect(outcomeError).toBeNull();

    const usedTrialRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(secondSlotId, trialEligibleActor.studentId),
    });
    expect(usedTrialRes.statusCode).toBe(409);
    expect(usedTrialRes.body).toMatchObject({ error: "Student has already used a free trial." });

    const siblingSlotId = await createSlot(futureDateAtUtcHour(13, 21), "Parent App Trial Sibling");
    const trialSiblingStudentId = await createStudentForParent(
      trialEligibleActor.profileId,
      "parent-app-trial-sibling",
    );

    const siblingTrialRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(siblingSlotId, trialSiblingStudentId),
    });
    const siblingTrialBody = siblingTrialRes.body as ParentTrialBookingResponse;

    expect(siblingTrialRes.statusCode).toBe(200);
    expect(siblingTrialBody).toMatchObject({
      academy_id: TENANT_ID,
      slot_id: siblingSlotId,
      status: "BOOKED",
      student_id: trialSiblingStudentId,
    });
    createdTrialBookingIds.push(siblingTrialBody.trial_booking_id);
  });

  it("rejects parent-app trials for children with an active membership", async () => {
    const slotId = await createSlot(futureDateAtUtcHour(12, 21), "Parent App Active Member");

    const res = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${parentToken}` },
      body: parentTrialBookingBody(slotId, memberActor.studentId),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: "Student already has an active membership." });
  });

  it("lets parent-app trial cancellation restore trial booking eligibility", async () => {
    const firstSlotId = await createSlot(futureDateAtUtcHour(19, 21), "Parent App Trial Cancel");
    const secondSlotId = await createSlot(
      futureDateAtUtcHour(20, 21),
      "Parent App Trial Rebook",
    );
    const studentId = await createStudentForParent(
      trialEligibleActor.profileId,
      "parent-app-trial-cancel",
    );

    const trialRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(firstSlotId, studentId),
    });
    const trialBody = trialRes.body as ParentTrialBookingResponse;

    expect(trialRes.statusCode).toBe(200);
    createdTrialBookingIds.push(trialBody.trial_booking_id);
    await expect(slotSpotsTaken(firstSlotId)).resolves.toBe(1);

    const cancelRes = await invoke(parentTrialBookingHandler, {
      method: "DELETE",
      headers: { authorization: `Bearer ${trialParentToken}` },
      query: { trial_booking_id: trialBody.trial_booking_id },
    });
    const cancelBody = cancelRes.body as ParentTrialCancelResponse;

    expect(cancelRes.statusCode).toBe(200);
    expect(cancelBody).toMatchObject({
      academy_id: TENANT_ID,
      cancelled: true,
      slot_id: firstSlotId,
      status: "CANCELLED",
      student_id: studentId,
      trial_booking_id: trialBody.trial_booking_id,
    });
    await expect(slotSpotsTaken(firstSlotId)).resolves.toBe(0);
    await expect(getTrialBookingIdentity(trialBody.trial_booking_id)).resolves.toMatchObject({
      status: "CANCELLED",
    });

    const upcomingAfterCancelRes = await invoke(parentUpcomingReservationsHandler, {
      method: "GET",
      headers: { authorization: `Bearer ${trialParentToken}` },
      query: { limit: "50" },
    });
    const upcomingAfterCancelBody =
      upcomingAfterCancelRes.body as ParentUpcomingBookingResponse[];

    expect(upcomingAfterCancelRes.statusCode).toBe(200);
    expect(upcomingAfterCancelBody).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trial_booking_id: trialBody.trial_booking_id }),
      ]),
    );

    const rebookRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(secondSlotId, studentId),
    });
    const rebookBody = rebookRes.body as ParentTrialBookingResponse;

    expect(rebookRes.statusCode).toBe(200);
    expect(rebookBody).toMatchObject({
      academy_id: TENANT_ID,
      slot_id: secondSlotId,
      status: "BOOKED",
      student_id: studentId,
    });
    expect(rebookBody.trial_booking_id).not.toBe(trialBody.trial_booking_id);
    createdTrialBookingIds.push(rebookBody.trial_booking_id);
    await expect(slotSpotsTaken(secondSlotId)).resolves.toBe(1);
  });

  it("returns per-child slot actions for trial availability, cancellation, and active plans", async () => {
    const firstSlotId = await createSlot(futureDateAtUtcHour(22, 21), "Child Actions Trial");
    const secondSlotId = await createSlot(
      futureDateAtUtcHour(23, 21),
      "Child Actions Trial Second",
    );
    const memberSlotId = await createSlot(futureDateAtUtcHour(24, 21), "Child Actions Member");
    const studentId = await createStudentForParent(
      trialEligibleActor.profileId,
      "parent-app-child-actions",
    );

    expect(childAction(await parentSlot(firstSlotId, trialParentToken), studentId))
      .toMatchObject({
        action: "book_trial",
        booking_kind: "trial",
        enabled: true,
        membership_id: null,
        reason: "trial_available",
        student_id: studentId,
      } satisfies Partial<ParentSlotChildAction>);

    expect(childAction(await parentSlot(memberSlotId, parentToken), memberActor.studentId))
      .toMatchObject({
        action: "book_with_plan",
        booking_kind: "reservation",
        enabled: true,
        membership_id: memberActor.membershipId,
        reason: "active_membership",
        student_id: memberActor.studentId,
      } satisfies Partial<ParentSlotChildAction>);

    const reservationId = await bookMemberSlot(memberActor, memberSlotId);
    createdReservationIds.push(reservationId);

    expect(childAction(await parentSlot(memberSlotId, parentToken), memberActor.studentId))
      .toMatchObject({
        action: "already_booked",
        booking_kind: "reservation",
        enabled: false,
        membership_id: memberActor.membershipId,
        reason: "already_booked",
        reservation_id: reservationId,
        student_id: memberActor.studentId,
      } satisfies Partial<ParentSlotChildAction>);

    const trialRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(secondSlotId, studentId),
    });
    const trialBody = trialRes.body as ParentTrialBookingResponse;

    expect(trialRes.statusCode).toBe(200);
    createdTrialBookingIds.push(trialBody.trial_booking_id);

    expect(childAction(await parentSlot(secondSlotId, trialParentToken), studentId))
      .toMatchObject({
        action: "already_booked_trial",
        booking_kind: "trial",
        enabled: false,
        membership_id: null,
        reason: "already_booked_trial",
        student_id: studentId,
        trial_booking_id: trialBody.trial_booking_id,
        trial_slot_id: secondSlotId,
      } satisfies Partial<ParentSlotChildAction>);

    expect(childAction(await parentSlot(firstSlotId, trialParentToken), studentId))
      .toMatchObject({
        action: "subscribe",
        booking_kind: null,
        enabled: true,
        membership_id: null,
        reason: "trial_booked",
        student_id: studentId,
        trial_booking_id: trialBody.trial_booking_id,
        trial_slot_id: secondSlotId,
      } satisfies Partial<ParentSlotChildAction>);

    const cancelRes = await invoke(parentTrialBookingHandler, {
      method: "DELETE",
      headers: { authorization: `Bearer ${trialParentToken}` },
      query: { trial_booking_id: trialBody.trial_booking_id },
    });
    expect(cancelRes.statusCode).toBe(200);

    expect(childAction(await parentSlot(firstSlotId, trialParentToken), studentId))
      .toMatchObject({
        action: "book_trial",
        booking_kind: "trial",
        enabled: true,
        membership_id: null,
        reason: "trial_available",
        student_id: studentId,
      } satisfies Partial<ParentSlotChildAction>);

    const usedTrialRes = await invoke(parentTrialBookingHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${trialParentToken}` },
      body: parentTrialBookingBody(secondSlotId, studentId),
    });
    const usedTrialBody = usedTrialRes.body as ParentTrialBookingResponse;
    expect(usedTrialRes.statusCode).toBe(200);
    createdTrialBookingIds.push(usedTrialBody.trial_booking_id);

    const outcomeRes = await setOutcome(usedTrialBody.trial_booking_id, "NO_SHOW");
    expect(outcomeRes.statusCode).toBe(200);

    expect(childAction(await parentSlot(firstSlotId, trialParentToken), studentId))
      .toMatchObject({
        action: "subscribe",
        booking_kind: null,
        enabled: true,
        membership_id: null,
        reason: "trial_used",
        student_id: studentId,
      } satisfies Partial<ParentSlotChildAction>);
  });

  it("authorizes public cancellation by matching parent email and frees capacity", async () => {
    const trialId = requireTrialBookingId();
    const wrongEmailRes = await invoke(trialBookingHandler, {
      method: "POST",
      headers: { origin: DEV_ORIGIN },
      query: { trial_booking_id: trialId, action: "cancel" },
      body: { parent_email: "wrong@example.test" },
    });
    expect(wrongEmailRes.statusCode).toBe(403);

    const cancelRes = await invoke(trialBookingHandler, {
      method: "POST",
      headers: { origin: DEV_ORIGIN },
      query: { trial_booking_id: trialId, action: "cancel" },
      body: { parent_email: "trial-one@example.test" },
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.body).toMatchObject({ trial_booking_id: trialId, status: "CANCELLED" });

    cancelledTrialBookingId = trialId;
    expect((await trialSlot(originSlotId)).spots_left).toBe(1);
  });

  it("reschedules a public trial by freeing the origin slot and consuming the target slot", async () => {
    const trial = await bookTrial(originSlotId, "trial-reschedule@example.test");
    createdTrialBookingIds.push(trial.trial_booking_id);
    expect((await trialSlot(originSlotId)).spots_left).toBe(0);
    expect((await trialSlot(targetSlotId)).spots_left).toBe(2);

    const rescheduleRes = await invoke(trialBookingHandler, {
      method: "POST",
      headers: { origin: DEV_ORIGIN },
      query: { trial_booking_id: trial.trial_booking_id, action: "reschedule" },
      body: {
        parent_email: "trial-reschedule@example.test",
        new_slot_id: targetSlotId,
      },
    });
    const body = rescheduleRes.body as TrialBookingResponse;

    expect(rescheduleRes.statusCode).toBe(200);
    expect(body).toMatchObject({
      trial_booking_id: trial.trial_booking_id,
      status: "BOOKED",
      slot_id: targetSlotId,
    });

    rescheduledTrialBookingId = trial.trial_booking_id;
    expect((await trialSlot(originSlotId)).spots_left).toBe(1);
    expect((await trialSlot(targetSlotId)).spots_left).toBe(1);
  });

  it("sets staff trial outcomes and rejects outcomes on cancelled bookings", async () => {
    const showedRes = await setOutcome(rescheduledTrialBookingId, "SHOWED");
    expect(showedRes.statusCode).toBe(200);
    expect(showedRes.body).toMatchObject({
      trial_booking_id: rescheduledTrialBookingId,
      status: "SHOWED",
      changed: true,
    } satisfies TrialOutcomeResponse);

    const noShowRes = await setOutcome(rescheduledTrialBookingId, "NO_SHOW");
    expect(noShowRes.statusCode).toBe(200);
    expect(noShowRes.body).toMatchObject({
      trial_booking_id: rescheduledTrialBookingId,
      status: "NO_SHOW",
      changed: true,
    } satisfies TrialOutcomeResponse);

    const cancelledOutcomeRes = await setOutcome(cancelledTrialBookingId, "SHOWED");
    expect(cancelledOutcomeRes.statusCode).toBeGreaterThanOrEqual(400);
    expect(cancelledOutcomeRes.statusCode).toBeLessThan(500);

    const listRes = await invoke(trialBookingsHandler, {
      method: "GET",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { client_id: TENANT_ID, slot_id: targetSlotId, status: "NO_SHOW" },
    });
    expect(listRes.statusCode).toBe(200);
    expect(JSON.stringify(listRes.body)).toContain(rescheduledTrialBookingId);
    expect(JSON.stringify(listRes.body)).toContain("slot");
  });

  it("returns trials_cancelled when staff cancels a slot with a booked trial", async () => {
    const trial = await bookTrial(targetSlotId, "trial-slot-cancel@example.test");
    createdTrialBookingIds.push(trial.trial_booking_id);

    const cancelRes = await invoke(slotCancelHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { slot_id: targetSlotId },
      body: { reason: "runtime trial slot cancel test" },
    });
    const body = cancelRes.body as SlotCancelResponse;

    expect(cancelRes.statusCode).toBe(200);
    expect(body).toMatchObject({
      reservations_cancelled: 0,
      credits_refunded: 0,
      waitlist_cancelled: 0,
      trials_cancelled: 1,
      already_cancelled: false,
    });
  });

  it("returns bulk slot occupancy matching the scalar RPC for mixed slot states", async () => {
    const reservationOnlySlotId = await createSlot(futureDateAtUtcHour(14, 21), "Bulk Reservation Only");
    const trialOnlySlotId = await createSlot(futureDateAtUtcHour(15, 21), "Bulk Trial Only");
    const mixedSlotId = await createSlot(futureDateAtUtcHour(16, 21), "Bulk Mixed");
    const emptySlotId = await createSlot(futureDateAtUtcHour(17, 21), "Bulk Empty");
    const otherTenantSlotId = await createOtherTenantSlot(futureDateAtUtcHour(18, 21));

    const reservationOnlyActor = await createBookingActor("bulk-reservation-only");
    const mixedActor = await createBookingActor("bulk-mixed");

    createdReservationIds.push(await bookMemberSlot(reservationOnlyActor, reservationOnlySlotId));
    createdReservationIds.push(await bookMemberSlot(mixedActor, mixedSlotId));

    const trialOnly = await bookTrial(trialOnlySlotId, "bulk-trial-only@example.test");
    const mixedTrial = await bookTrial(mixedSlotId, "bulk-mixed@example.test");
    createdTrialBookingIds.push(trialOnly.trial_booking_id, mixedTrial.trial_booking_id);

    const bulkCounts = await slotSpotsTakenBulk([
      reservationOnlySlotId,
      trialOnlySlotId,
      mixedSlotId,
      emptySlotId,
      otherTenantSlotId,
      reservationOnlySlotId,
    ]);

    const expectedTenantCounts = new Map<string, number>([
      [reservationOnlySlotId, 1],
      [trialOnlySlotId, 1],
      [mixedSlotId, 2],
      [emptySlotId, 0],
    ]);
    const scalarCounts = await Promise.all(
      [...expectedTenantCounts.keys()].map((slotId) => slotSpotsTaken(slotId)),
    );

    [...expectedTenantCounts.entries()].forEach(([slotId, expectedCount], index) => {
      const scalarCount = scalarCounts[index];
      expect(scalarCount).toBe(expectedCount);
      expect(bulkCounts.get(slotId)).toBe(scalarCount);
    });

    await expect(slotSpotsTaken(otherTenantSlotId)).resolves.toBe(0);
    expect(bulkCounts.has(otherTenantSlotId)).toBe(false);
  });
});

async function createStaffToken(): Promise<string> {
  const user = await createSignedInUser(`runtime-trials-staff-${TEST_RUN_ID}@example.test`);
  const staffId = randomUUID();
  const { error } = await serviceSupabase.from("staff").insert({
    id: staffId,
    user_id: user.userId,
    name: "Runtime Trial Staff",
    role: "admin",
    email: `runtime-trials-staff-${TEST_RUN_ID}@example.test`,
  });
  if (error) throw new Error(error.message);
  createdStaffIds.push(staffId);
  return user.token;
}

async function createSignedInUser(email: string): Promise<{ token: string; userId: string }> {
  const { data: createData, error: createError } = await serviceSupabase.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createError || !createData.user?.id) {
    throw new Error(createError?.message ?? `Failed to create test user ${email}.`);
  }
  createdUserIds.push(createData.user.id);

  const { data: signInData, error: signInError } = await anonSupabase.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError || !signInData.session?.access_token) {
    throw new Error(signInError?.message ?? `Failed to sign in test user ${email}.`);
  }

  return { token: signInData.session.access_token, userId: createData.user.id };
}

async function createTrialTemplateAndSlots(): Promise<void> {
  templateId = randomUUID();
  createdTemplateIds.push(templateId);
  await insertRow("slot_templates", {
    id: templateId,
    tenant_id: TENANT_ID,
    name: `Runtime Trials ${TEST_RUN_ID}`,
    slot_type: "TRAINING",
    default_location: "Runtime Trial Court",
    default_capacity: 2,
    default_credit_cost: 1,
    default_start_time: "17:00:00",
    default_end_time: "18:00:00",
    recurrence_rule: "WEEKLY:MO",
    is_active: true,
    bookable_program_id: TRAINING_PROGRAM_ID,
  });

  const firstStart = futureDateAtUtcHour(7, 21);
  const secondStart = futureDateAtUtcHour(8, 21);
  originSlotId = await createSlot(firstStart, "Origin");
  targetSlotId = await createSlot(secondStart, "Target");
  dateFrom = firstStart.toISOString().slice(0, 10);
  dateTo = secondStart.toISOString().slice(0, 10);
}

async function createSlot(start: Date, label: string): Promise<string> {
  const slotId = randomUUID();
  createdSlotIds.push(slotId);
  await insertRow("schedule_slots", {
    id: slotId,
    tenant_id: TENANT_ID,
    name: `Runtime Trial ${label} ${TEST_RUN_ID}`,
    slot_type: "TRAINING",
    location_label: "Runtime Trial Court",
    capacity: 2,
    credit_cost: 1,
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    slot_template_id: templateId,
    is_cancelled: false,
    bookable_program_id: TRAINING_PROGRAM_ID,
  });
  return slotId;
}

async function createOtherTenantSlot(start: Date): Promise<string> {
  const tenantId = randomUUID();
  const bookableProgramId = randomUUID();
  const templateId = randomUUID();
  const slotId = randomUUID();

  createdClientIds.push(tenantId);
  createdBookableProgramIds.push(bookableProgramId);
  createdTemplateIds.push(templateId);
  createdSlotIds.push(slotId);

  await insertRow("clients", {
    id: tenantId,
    business_name: `Runtime Trials Other ${TEST_RUN_ID}`,
    status: "active",
    time_zone: "America/New_York",
  });

  await insertRow("bookable_programs", {
    id: bookableProgramId,
    tenant_id: tenantId,
    source_program_key: `runtime-trials-other-${TEST_RUN_ID}`,
    title: "Runtime Trials Other Training",
    program_type: "TRAINING",
    status: "ACTIVE",
  });

  await insertRow("slot_templates", {
    id: templateId,
    tenant_id: tenantId,
    name: `Runtime Trials Other ${TEST_RUN_ID}`,
    slot_type: "TRAINING",
    default_location: "Runtime Other Court",
    default_capacity: 2,
    default_credit_cost: 1,
    default_start_time: "21:00:00",
    default_end_time: "22:00:00",
    recurrence_rule: "WEEKLY:MO",
    is_active: true,
    bookable_program_id: bookableProgramId,
  });

  await insertRow("schedule_slots", {
    id: slotId,
    tenant_id: tenantId,
    name: `Runtime Trial Other Tenant ${TEST_RUN_ID}`,
    slot_type: "TRAINING",
    location_label: "Runtime Other Court",
    capacity: 2,
    credit_cost: 1,
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    slot_template_id: templateId,
    is_cancelled: false,
    bookable_program_id: bookableProgramId,
  });

  return slotId;
}

async function createBookingActor(label: string, supabaseUserId?: string): Promise<BookingActor> {
  const profileId = randomUUID();
  const studentId = randomUUID();
  const membershipId = randomUUID();
  const entitlementId = randomUUID();
  createdProfileIds.push(profileId);
  createdStudentIds.push(studentId);
  createdMembershipIds.push(membershipId);
  createdEntitlementIds.push(entitlementId);

  await insertRow("customer_profiles", {
    id: profileId,
    supabase_user_id: supabaseUserId ?? `runtime-trials-${label}-${TEST_RUN_ID}`,
    first_name: "Runtime",
    last_name: `Trials ${label}`,
    email: `runtime-trials-${label}-${TEST_RUN_ID}@example.test`,
    phone: null,
    profile_type: "PARENT",
  });

  await insertRow("students", {
    id: studentId,
    parent_id: profileId,
    first_name: "Runtime",
    last_name: `Athlete ${label}`,
  });

  await insertRow("academy_memberships", {
    id: membershipId,
    academy_id: TENANT_ID,
    student_id: studentId,
    status: "ACTIVE",
    joined_at: new Date().toISOString(),
    stripe_customer_id: `cus_trials_${membershipId.replaceAll("-", "").slice(0, 18)}`,
  });

  await insertRow("customer_entitlements", {
    id: entitlementId,
    tenant_id: TENANT_ID,
    academy_membership_id: membershipId,
    student_id: studentId,
    scope_type: "STUDENT",
    scope_id: studentId,
    entitlement_kind: "UNLIMITED_BOOKING",
    status: "ACTIVE",
    valid_from: new Date(Date.now() - 60_000).toISOString(),
    source: "admin",
    bookable_program_id: TRAINING_PROGRAM_ID,
    source_ref: `runtime-trials:${TEST_RUN_ID}:${entitlementId}`,
    config: { is_unlimited: true },
  });

  return { profileId, studentId, membershipId, entitlementId };
}

async function createTrialEligibleActor(
  label: string,
  supabaseUserId: string,
): Promise<TrialEligibleActor> {
  const profileId = randomUUID();
  const studentId = randomUUID();
  const profileMembershipId = randomUUID();
  const email = `runtime-trials-${label}-${TEST_RUN_ID}@example.test`;

  createdProfileIds.push(profileId);
  createdStudentIds.push(studentId);
  createdMembershipIds.push(profileMembershipId);

  await insertRow("customer_profiles", {
    id: profileId,
    supabase_user_id: supabaseUserId,
    first_name: "Runtime",
    last_name: `Trial Parent ${label}`,
    email,
    phone: "555-0199",
    profile_type: "PARENT",
  });

  await insertRow("students", {
    id: studentId,
    parent_id: profileId,
    first_name: "Runtime",
    last_name: `Trial Athlete ${label}`,
    date_of_birth: "2015-06-08",
  });

  await insertRow("academy_memberships", {
    id: profileMembershipId,
    academy_id: TENANT_ID,
    customer_id: profileId,
    status: "SUSPENDED",
    joined_at: new Date().toISOString(),
    ghl_contact_id: `ghl_trials_${profileId.replaceAll("-", "").slice(0, 18)}`,
  });

  return { email, profileId, studentId };
}

async function createStudentForParent(profileId: string, label: string): Promise<string> {
  const studentId = randomUUID();
  createdStudentIds.push(studentId);

  await insertRow("students", {
    id: studentId,
    parent_id: profileId,
    first_name: "Runtime",
    last_name: `Sibling ${label}`,
    date_of_birth: "2016-02-14",
  });

  return studentId;
}

async function createActiveMembershipForStudent(studentId: string, label: string): Promise<string> {
  const membershipId = randomUUID();
  createdMembershipIds.push(membershipId);

  await insertRow("academy_memberships", {
    id: membershipId,
    academy_id: TENANT_ID,
    student_id: studentId,
    status: "ACTIVE",
    joined_at: new Date().toISOString(),
    stripe_customer_id: `cus_trials_${label.replaceAll("-", "_").slice(0, 18)}`,
  });

  return membershipId;
}

async function bookMemberSlot(actor: BookingActor, slotId: string): Promise<string> {
  const { data, error } = await serviceSupabase.rpc("parent_book_slot", {
    p_tenant_id: TENANT_ID,
    p_slot_id: slotId,
    p_membership_id: actor.membershipId,
    p_student_id: actor.studentId,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("Expected parent_book_slot to return a reservation id.");
  return data;
}

async function bookTrial(slotId: string, email: string): Promise<TrialBookingResponse> {
  const res = await invoke(trialBookingHandler, {
    method: "POST",
    headers: { origin: DEV_ORIGIN },
    body: trialBookingBody(slotId, email),
  });
  expect(res.statusCode).toBe(200);
  const body = res.body as TrialBookingResponse;
  expect(body.status).toBe("BOOKED");
  expect(body.trial_booking_id).toMatch(/[0-9a-f-]{36}/);
  return body;
}

async function slotSpotsTaken(slotId: string): Promise<number> {
  const { data, error } = await serviceSupabase.rpc("slot_spots_taken", {
    p_tenant_id: TENANT_ID,
    p_slot_id: slotId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

async function slotSpotsTakenBulk(slotIds: string[]): Promise<Map<string, number>> {
  const { data, error } = await serviceSupabase.rpc("slot_spots_taken_bulk", {
    p_tenant_id: TENANT_ID,
    p_slot_ids: slotIds,
  });
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of rows<SlotSpotsTakenBulkRow>(data)) {
    counts.set(row.slot_id, Number(row.spots_taken ?? 0));
  }
  return counts;
}

function trialBookingBody(slotId: string, email: string) {
  return {
    client_id: TENANT_ID,
    slot_id: slotId,
    parent_name: "Runtime Trial Parent",
    parent_email: email,
    parent_phone: "555-0100",
    athlete_name: "Runtime Trial Athlete",
    athlete_dob: "2012-01-15",
    metadata: { test_run_id: TEST_RUN_ID },
  };
}

function parentTrialBookingBody(slotId: string, studentId: string) {
  return {
    academy_id: TENANT_ID,
    slot_id: slotId,
    student_id: studentId,
    metadata: {
      source: "runtime-test",
      test_run_id: TEST_RUN_ID,
    },
  };
}

async function getTrialBookingIdentity(trialBookingId: string): Promise<TrialBookingIdentityRow> {
  const { data, error } = await serviceSupabase
    .from("trial_bookings")
    .select("id,athlete_name,customer_profile_id,metadata,parent_email,source,status,student_id")
    .eq("id", trialBookingId)
    .single();

  if (error) throw new Error(error.message);
  return data as TrialBookingIdentityRow;
}

async function trialSlot(slotId: string): Promise<TrialSlotResponseRow> {
  const res = await invoke(trialSlotsHandler, {
    method: "GET",
    headers: { origin: DEV_ORIGIN },
    query: {
      client_id: TENANT_ID,
      bookable_program_id: TRAINING_PROGRAM_ID,
      date_from: dateFrom,
      date_to: dateTo,
    },
  });
  const body = res.body as TrialSlotsResponse;
  expect(res.statusCode).toBe(200);
  const slot = body.slots.find((row) => row.id === slotId);
  if (!slot) throw new Error(`Expected trial slot ${slotId}.`);
  return slot;
}

async function calendarSlot(slotId: string): Promise<CalendarResponse["slots"][number]> {
  const res = await invoke(calendarHandler, {
    method: "GET",
    headers: { authorization: `Bearer ${staffToken}` },
    query: {
      client_id: TENANT_ID,
      date_from: dateFrom,
      date_to: dateTo,
    },
  });
  const body = res.body as CalendarResponse;
  expect(res.statusCode).toBe(200);
  const slot = body.slots.find((row) => row.id === slotId);
  if (!slot) throw new Error(`Expected calendar slot ${slotId}.`);
  return slot;
}

async function parentSlot(slotId: string, token = parentToken): Promise<ParentSlotResponseRow> {
  const res = await invoke(parentSlotsHandler, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    query: {
      academy_id: TENANT_ID,
      date_from: new Date().toISOString().slice(0, 10),
      date_to: futureDateAtUtcHour(40, 21).toISOString().slice(0, 10),
      limit: "50",
    },
  });
  expect(res.statusCode).toBe(200);
  const slots = res.body as ParentSlotResponseRow[];
  const slot = slots.find((row) => row.id === slotId);
  if (!slot) throw new Error(`Expected parent slot ${slotId}.`);
  return slot;
}

function childAction(slot: ParentSlotResponseRow, studentId: string): ParentSlotChildAction {
  const action = slot.child_actions.find((row) => row.student_id === studentId);
  if (!action) throw new Error(`Expected child action for student ${studentId} on slot ${slot.id}.`);
  return action;
}

async function setOutcome(trialBookingId: string, status: "SHOWED" | "NO_SHOW"): Promise<MockResponse> {
  return invoke(trialBookingsHandler, {
    method: "POST",
    headers: { authorization: `Bearer ${staffToken}` },
    query: { trial_booking_id: trialBookingId, action: "outcome" },
    body: { status },
  });
}

async function insertRow(table: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await serviceSupabase.from(table).insert(values);
  if (error) throw new Error(error.message);
}

async function cleanupCreatedRows(): Promise<void> {
  if (createdReservationIds.length > 0) {
    await serviceSupabase.from("credit_ledger").delete().in("reservation_id", uniqueValues(createdReservationIds));
  }
  if (createdTrialBookingIds.length > 0) {
    await serviceSupabase.from("trial_bookings").delete().in("id", uniqueValues(createdTrialBookingIds));
  }
  if (createdSlotIds.length > 0) {
    await serviceSupabase.from("trial_bookings").delete().in("slot_id", uniqueValues(createdSlotIds));
    await serviceSupabase.from("reservations").delete().in("slot_id", uniqueValues(createdSlotIds));
    await serviceSupabase.from("schedule_slots").delete().in("id", uniqueValues(createdSlotIds));
  }
  if (createdTemplateIds.length > 0) {
    await serviceSupabase.from("slot_templates").delete().in("id", uniqueValues(createdTemplateIds));
  }
  if (createdBookableProgramIds.length > 0) {
    await serviceSupabase.from("bookable_programs").delete().in("id", uniqueValues(createdBookableProgramIds));
  }
  if (createdEntitlementIds.length > 0) {
    await serviceSupabase.from("customer_entitlements").delete().in("id", uniqueValues(createdEntitlementIds));
  }
  if (createdMembershipIds.length > 0) {
    await serviceSupabase.from("academy_memberships").delete().in("id", uniqueValues(createdMembershipIds));
  }
  if (createdStudentIds.length > 0) {
    await serviceSupabase.from("students").delete().in("id", uniqueValues(createdStudentIds));
  }
  if (createdProfileIds.length > 0) {
    await serviceSupabase.from("customer_profiles").delete().in("id", uniqueValues(createdProfileIds));
  }
  for (const staffId of createdStaffIds) {
    await serviceSupabase.from("staff").delete().eq("id", staffId);
  }
  for (const userId of createdUserIds) {
    await serviceSupabase.auth.admin.deleteUser(userId);
  }
  if (createdClientIds.length > 0) {
    await serviceSupabase.from("clients").delete().in("id", uniqueValues(createdClientIds));
  }
}

async function invoke(
  handler: ApiHandler,
  req: {
    method: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<MockResponse> {
  const res = mockResponse();
  await handler({
    method: req.method,
    headers: req.headers ?? {},
    query: req.query ?? {},
    body: req.body,
  }, res);
  return res;
}

function mockResponse(): MockResponse {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    ended: false,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    end(body?: unknown) {
      res.body = body;
      res.ended = true;
      return res;
    },
  };

  return res;
}

function requireTrialBookingId(): string {
  const trialBookingId = createdTrialBookingIds[0];
  if (!trialBookingId) throw new Error("Expected a trial booking id.");
  return trialBookingId;
}

function futureDateAtUtcHour(daysFromNow: number, utcHour: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysFromNow,
    utcHour,
    0,
    0,
  ));
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function assertLocalSupabase(): void {
  if (!runtimeTestSupabaseUrl.includes("127.0.0.1") && process.env.ALLOW_REMOTE_RUNTIME_TESTS !== "1") {
    throw new Error("Runtime API tests only run against local Supabase by default.");
  }
}
