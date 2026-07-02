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
  enrollments: Array<{ status: string; reservation_id: string | null }>;
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

type BookingActor = {
  profileId: string;
  studentId: string;
  membershipId: string;
  entitlementId: string;
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
let calendarHandler: ApiHandler;
let parentSlotsHandler: ApiHandler;
let trialBookingsHandler: ApiHandler;
let slotCancelHandler: ApiHandler;
let staffToken = "";
let parentToken = "";
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

const createdUserIds: string[] = [];
const createdStaffIds: string[] = [];
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
    const calendarModule = await import("./schedule/calendar.js");
    const parentSlotsModule = await import("../parent/schedule/slots.js");
    const trialBookingsModule = await import("./trial-bookings.js");
    const slotCancelModule = await import("./schedule/slot-cancel.js");

    trialSlotsHandler = trialSlotsModule.default as ApiHandler;
    trialBookingHandler = trialBookingModule.default as ApiHandler;
    calendarHandler = calendarModule.default as ApiHandler;
    parentSlotsHandler = parentSlotsModule.default as ApiHandler;
    trialBookingsHandler = trialBookingsModule.default as ApiHandler;
    slotCancelHandler = slotCancelModule.default as ApiHandler;

    staffToken = await createStaffToken();
    const parentUser = await createSignedInUser(`runtime-trials-parent-${TEST_RUN_ID}@example.test`);
    parentToken = parentUser.token;

    await createTrialTemplateAndSlots();
    memberActor = await createBookingActor("member", parentUser.userId);
    overCapacityActor = await createBookingActor("over-capacity");
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

  it("includes booked trials in the parent slots booked_count without adding trial enrollments", async () => {
    const slot = await parentSlot(originSlotId);

    expect(slot.booked_count).toBe(2);
    expect(slot.capacity).toBe(2);
    expect(slot.can_book).toBe(false);
    expect(slot.enrollments).toHaveLength(1);
    expect(slot.enrollments[0]).toMatchObject({
      status: "CONFIRMED",
      reservation_id: memberReservationId,
    });
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

async function parentSlot(slotId: string): Promise<ParentSlotResponseRow> {
  const res = await invoke(parentSlotsHandler, {
    method: "GET",
    headers: { authorization: `Bearer ${parentToken}` },
    query: {
      academy_id: TENANT_ID,
      date_from: dateFrom,
      date_to: dateTo,
      limit: "50",
    },
  });
  expect(res.statusCode).toBe(200);
  const slots = res.body as ParentSlotResponseRow[];
  const slot = slots.find((row) => row.id === slotId);
  if (!slot) throw new Error(`Expected parent slot ${slotId}.`);
  return slot;
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

function assertLocalSupabase(): void {
  if (!runtimeTestSupabaseUrl.includes("127.0.0.1") && process.env.ALLOW_REMOTE_RUNTIME_TESTS !== "1") {
    throw new Error("Runtime API tests only run against local Supabase by default.");
  }
}
