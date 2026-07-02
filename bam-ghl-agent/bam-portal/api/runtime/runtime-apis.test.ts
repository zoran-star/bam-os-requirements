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
const OFFER_ID = "52a6285c-7832-44e1-b531-ab7ef9d8fc21";
const TRAINING_PROGRAM_ID = "80000000-0000-4000-8000-000000000001";
const MAYA_MEMBERSHIP_ID = "8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f";
const MAYA_STUDENT_ID = "531a0580-56c6-4029-a72f-c42221e17bfb";
const NOAH_MEMBERSHIP_ID = "a5ac9fd2-8d34-456a-8b56-1ae457f256f4";
const NOAH_STUDENT_ID = "ccfd4c6a-9e7a-41f4-8d7a-8f6e80e69825";
const LEO_MEMBERSHIP_ID = "6543bff1-4f54-4760-a82f-2c0d210ec27d";
const LEO_STUDENT_ID = "5c0bf246-1612-4e82-8aca-4fba43e13f6e";
const DEV_ORIGIN = "http://localhost:3000";
const ACTIVE_PRICE_IDS = [
  "82000000-0000-4000-8000-000000000001",
  "82000000-0000-4000-8000-000000000004",
  "82000000-0000-4000-8000-000000000005",
  "82000000-0000-4000-8000-000000000003",
  "82000000-0000-4000-8000-000000000006",
];
const ARCHIVED_PRICE_ID = "82000000-0000-4000-8000-000000000002";
const LEGACY_PRICE_ID = "82000000-0000-4000-8000-000000000007";
const ARCHIVED_OPTION_ID = "81000000-0000-4000-8000-000000000002";
const TEST_PASSWORD = `runtime-${randomUUID()}-Password1`;
const TEST_RUN_ID = randomUUID();
const STAFF_EMAIL = `runtime-api-staff-${TEST_RUN_ID}@example.test`;
const NON_STAFF_EMAIL = `runtime-api-user-${TEST_RUN_ID}@example.test`;

type ApiHandler = (req: RuntimeApiRequest, res: RuntimeApiResponse) => Promise<unknown>;

type MockResponse = RuntimeApiResponse & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  ended: boolean;
};

type OffersResponse = {
  offer: {
    id: string;
    client_id: string;
    title: string;
    copy: Record<string, unknown>;
  };
  options: Array<{
    id: string;
    title: string;
    status: string;
    prices: Array<{
      id: string;
      title: string;
      amount_cents: number;
      currency: string;
      billing_interval: string | null;
      is_active: boolean;
      is_routable: boolean;
      source_offer_price_key: string | null;
      entitlement: {
        kind: string | null;
        credits_per_period: number | null;
        credit_period: string | null;
        is_unlimited: boolean;
      };
      catalog: {
        stripe_price_id: string | null;
        tier: string | null;
      };
    }>;
  }>;
};

type DiagnosticsResponse = {
  checks: Array<{
    key: string;
    label: string;
    status: "ok" | "fail" | "error";
    count: number;
    sample: string[];
    message?: string;
  }>;
};

type SlotTemplateResponseRow = {
  id: string;
  tenant_id: string;
  name: string;
  slot_type: string;
  default_capacity: number;
  default_credit_cost: number;
  default_start_time: string;
  default_end_time: string;
  recurrence_rule: string | null;
  is_active: boolean;
  bookable_program_id: string;
};

type SlotTemplateResponse = {
  template: SlotTemplateResponseRow;
};

type SlotTemplatesResponse = {
  templates: SlotTemplateResponseRow[];
};

type GenerateSlotsResponse = {
  created: number;
  skipped_existing: number;
  skipped_no_recurrence: number;
  slots: Array<{
    id: string;
    start_time: string;
    slot_template_id: string;
  }>;
};

type CalendarSlotResponseRow = {
  id: string;
  tenant_id: string;
  capacity: number;
  start_time: string;
  is_cancelled: boolean;
  reservation_count: number;
  waitlist_count: number;
  spots_taken: number;
  spots_left: number;
};

type CalendarResponse = {
  slots: CalendarSlotResponseRow[];
};

type SlotCancelResponse = {
  reservations_cancelled: number;
  credits_refunded: number;
  waitlist_cancelled: number;
  trials_cancelled: number;
  already_cancelled: boolean;
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

let offersHandler: ApiHandler;
let diagnosticsHandler: ApiHandler;
let templatesHandler: ApiHandler;
let templateHandler: ApiHandler;
let generateSlotsHandler: ApiHandler;
let calendarHandler: ApiHandler;
let slotCancelHandler: ApiHandler;
let staffToken: string;
let nonStaffToken: string;
const createdUserIds: string[] = [];
const createdStaffIds: string[] = [];
const createdTemplateIds: string[] = [];
const generatedSlotIds: string[] = [];
const scheduleTemplateSlotIds: string[] = [];
const createdReservationIds: string[] = [];
const createdWaitlistIds: string[] = [];
const createdCustomerProfileIds: string[] = [];
const createdStudentIds: string[] = [];
const createdMembershipIds: string[] = [];
const createdCustomerEntitlementIds: string[] = [];
let scheduleTemplateId = "";
let calendarCapacitySlotId = "";
let generationWindow: { dateFrom: string; dateTo: string };

describe("runtime read-only APIs", () => {
  beforeAll(async () => {
    assertLocalSupabase();

    const offersModule = await import("./offers.js");
    const diagnosticsModule = await import("./diagnostics.js");
    const templatesModule = await import("./schedule/templates.js");
    const templateModule = await import("./schedule/template.js");
    const generateSlotsModule = await import("./schedule/generate-slots.js");
    const calendarModule = await import("./schedule/calendar.js");
    const slotCancelModule = await import("./schedule/slot-cancel.js");
    offersHandler = offersModule.default as ApiHandler;
    diagnosticsHandler = diagnosticsModule.default as ApiHandler;
    templatesHandler = templatesModule.default as ApiHandler;
    templateHandler = templateModule.default as ApiHandler;
    generateSlotsHandler = generateSlotsModule.default as ApiHandler;
    calendarHandler = calendarModule.default as ApiHandler;
    slotCancelHandler = slotCancelModule.default as ApiHandler;
    generationWindow = twoWeekMondayWednesdayWindow();

    staffToken = await createStaffToken();
    nonStaffToken = await createSignedInUser(NON_STAFF_EMAIL);
  });

  afterAll(async () => {
    await cleanupScheduleArtifacts();
    await cleanupCreatedAuthRows();
  });

  it("returns seeded BAM GTA runtime options and prices with entitlement summaries", async () => {
    const res = await invoke(offersHandler, {
      method: "GET",
      headers: { origin: DEV_ORIGIN },
      query: { offer_id: OFFER_ID },
    });
    const body = res.body as OffersResponse;

    expect(res.statusCode).toBe(200);
    expect(body.offer).toMatchObject({
      id: OFFER_ID,
      client_id: TENANT_ID,
      title: "Training",
    });
    expect(body.offer.copy).toMatchObject({
      title: "Training",
      type: "training",
      description: "Regular training",
      sales_path: "Free trial",
    });
    expect(JSON.stringify(body.offer.copy)).not.toContain("ghosted_workflow");
    expect(JSON.stringify(body.offer.copy)).not.toContain("lead_tag");

    expect(body.options.map((option) => option.title)).toEqual(["1/Wk", "Summer Unlimited"]);
    expect(new Set(allPrices(body).map((price) => price.id))).toEqual(new Set(ACTIVE_PRICE_IDS));

    const steadyMonthly = findPrice(body, "82000000-0000-4000-8000-000000000001");
    expect(steadyMonthly).toMatchObject({
      title: "1/Wk - Monthly",
      amount_cents: 22600,
      currency: "cad",
      billing_interval: "4_weeks",
      is_active: true,
      is_routable: true,
      source_offer_price_key: "Steady|monthly",
      entitlement: {
        kind: "WEEKLY_CREDITS",
        credits_per_period: 1,
        credit_period: "WEEK",
        is_unlimited: false,
      },
      catalog: {
        stripe_price_id: "plan_ToNwa96lQ5I1Bs",
        tier: "canonical",
      },
    });

    const summerMonthly = findPrice(body, "82000000-0000-4000-8000-000000000003");
    expect(summerMonthly.entitlement).toMatchObject({
      kind: "UNLIMITED_BOOKING",
      is_unlimited: true,
    });
  });

  it("hides archived prices by default and exposes them only to staff", async () => {
    const defaultRes = await invoke(offersHandler, {
      method: "GET",
      headers: { origin: DEV_ORIGIN },
      query: { offer_id: OFFER_ID },
    });
    const defaultBody = defaultRes.body as OffersResponse;
    const defaultPriceIds = allPrices(defaultBody).map((price) => price.id);

    expect(defaultRes.statusCode).toBe(200);
    expect(defaultPriceIds).not.toContain(ARCHIVED_PRICE_ID);
    expect(defaultPriceIds).not.toContain(LEGACY_PRICE_ID);

    const anonymousRes = await invoke(offersHandler, {
      method: "GET",
      headers: { origin: DEV_ORIGIN },
      query: { offer_id: OFFER_ID, include_archived: "1" },
    });
    expect(anonymousRes.statusCode).toBe(403);

    const staffRes = await invoke(offersHandler, {
      method: "GET",
      headers: { origin: DEV_ORIGIN, authorization: `Bearer ${staffToken}` },
      query: { offer_id: OFFER_ID, include_archived: "1" },
    });
    const staffBody = staffRes.body as OffersResponse;
    const staffPriceIds = allPrices(staffBody).map((price) => price.id);

    expect(staffRes.statusCode).toBe(200);
    expect(staffBody.options.map((option) => option.id)).toContain(ARCHIVED_OPTION_ID);
    expect(staffPriceIds).toContain(ARCHIVED_PRICE_ID);
    expect(staffPriceIds).toContain(LEGACY_PRICE_ID);
  });

  it("returns all diagnostics checks for staff", async () => {
    const res = await invoke(diagnosticsHandler, {
      method: "GET",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { client_id: TENANT_ID },
    });
    const body = res.body as DiagnosticsResponse;

    expect(res.statusCode).toBe(200);
    expect(body.checks.map((check) => check.key)).toEqual([
      "active_price_no_template",
      "active_stripe_price_no_catalog_link",
      "live_member_no_active_entitlement",
      "active_entitlement_no_member_link",
      "credit_entitlement_no_current_grant",
      "live_member_price_unmapped_to_runtime",
      "entitlement_config_drift",
      "duplicate_identity_emails",
    ]);
    expect(body.checks).toHaveLength(8);
    expect(body.checks.every((check) => check.status === "ok" || check.status === "fail")).toBe(true);
    expect(body.checks.every((check) => check.sample.length <= 10)).toBe(true);

    const drift = body.checks.find((check) => check.key === "entitlement_config_drift");
    expect(drift?.status).toBe("fail");
    expect(drift?.count).toBeGreaterThan(0);
  });

  it("requires staff auth for diagnostics", async () => {
    const unauthenticatedRes = await invoke(diagnosticsHandler, {
      method: "GET",
      query: { client_id: TENANT_ID },
    });
    expect(unauthenticatedRes.statusCode).toBe(401);

    const nonStaffRes = await invoke(diagnosticsHandler, {
      method: "GET",
      headers: { authorization: `Bearer ${nonStaffToken}` },
      query: { client_id: TENANT_ID },
    });
    expect(nonStaffRes.statusCode).toBe(403);
  });

  it("requires staff auth for schedule calendar and slot cancellation", async () => {
    const calendarQuery = {
      client_id: TENANT_ID,
      date_from: generationWindow.dateFrom,
      date_to: generationWindow.dateFrom,
    };

    const anonymousCalendarRes = await invoke(calendarHandler, {
      method: "GET",
      query: calendarQuery,
    });
    expect(anonymousCalendarRes.statusCode).toBe(401);

    const nonStaffCalendarRes = await invoke(calendarHandler, {
      method: "GET",
      headers: { authorization: `Bearer ${nonStaffToken}` },
      query: calendarQuery,
    });
    expect(nonStaffCalendarRes.statusCode).toBe(403);

    const anonymousCancelRes = await invoke(slotCancelHandler, {
      method: "POST",
      query: { slot_id: randomUUID() },
    });
    expect(anonymousCancelRes.statusCode).toBe(401);

    const nonStaffCancelRes = await invoke(slotCancelHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${nonStaffToken}` },
      query: { slot_id: randomUUID() },
    });
    expect(nonStaffCancelRes.statusCode).toBe(403);
  });

  it("creates, lists, and patches a staff slot template", async () => {
    const createRes = await invoke(templatesHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        client_id: TENANT_ID,
        name: `Runtime Schedule ${TEST_RUN_ID}`,
        slot_type: "TRAINING",
        default_start_time: "16:00",
        default_end_time: "17:00",
        default_capacity: 12,
        default_credit_cost: 2,
        recurrence_rule: "WEEKLY:MO,WE",
        default_location: "Main Court",
        bookable_program_id: TRAINING_PROGRAM_ID,
      },
    });
    const created = createRes.body as SlotTemplateResponse;

    expect(createRes.statusCode).toBe(201);
    expect(created.template).toMatchObject({
      tenant_id: TENANT_ID,
      name: `Runtime Schedule ${TEST_RUN_ID}`,
      slot_type: "TRAINING",
      default_capacity: 12,
      default_credit_cost: 2,
      recurrence_rule: "WEEKLY:MO,WE",
      bookable_program_id: TRAINING_PROGRAM_ID,
    });

    scheduleTemplateId = created.template.id;
    createdTemplateIds.push(scheduleTemplateId);

    const listRes = await invoke(templatesHandler, {
      method: "GET",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { client_id: TENANT_ID, active: "1" },
    });
    const listBody = listRes.body as SlotTemplatesResponse;
    expect(listRes.statusCode).toBe(200);
    expect(listBody.templates.some((template) => template.id === scheduleTemplateId)).toBe(true);

    const patchRes = await invoke(templateHandler, {
      method: "PATCH",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { template_id: scheduleTemplateId },
      body: { default_capacity: 14 },
    });
    const patched = patchRes.body as SlotTemplateResponse;

    expect(patchRes.statusCode).toBe(200);
    expect(patched.template.default_capacity).toBe(14);

    const persistedRes = await invoke(templatesHandler, {
      method: "GET",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { client_id: TENANT_ID, active: "1" },
    });
    const persistedBody = persistedRes.body as SlotTemplatesResponse;
    const persisted = persistedBody.templates.find((template) => template.id === scheduleTemplateId);
    expect(persisted?.default_capacity).toBe(14);
  });

  it("generates two weeks of slots in the client timezone", async () => {
    const res = await invoke(generateSlotsHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        client_id: TENANT_ID,
        template_id: requireScheduleTemplateId(),
        date_from: generationWindow.dateFrom,
        date_to: generationWindow.dateTo,
      },
    });
    const body = res.body as GenerateSlotsResponse;

    expect(res.statusCode).toBe(200);
    expect(body.created).toBe(4);
    expect(body.skipped_existing).toBe(0);
    expect(body.skipped_no_recurrence).toBe(0);
    expect(body.slots).toHaveLength(4);
    generatedSlotIds.push(...body.slots.map((slot) => slot.id));
    scheduleTemplateSlotIds.push(...body.slots.map((slot) => slot.id));

    const slots = await generatedSlotsForTemplate(requireScheduleTemplateId());
    expect(slots).toHaveLength(4);
    expect(slots.every((slot) => slot.slot_template_id === scheduleTemplateId)).toBe(true);

    const first = slots[0];
    if (!first) throw new Error("Expected a generated slot.");
    const local = localDateTimeParts(first.start_time, "America/New_York");
    expect(local.hour).toBe("16");
    expect(local.minute).toBe("00");

    const offsetMinutes = offsetMinutesForTimeZone("America/New_York", first.start_time);
    const expectedUtcHour = (16 - (offsetMinutes / 60) + 24) % 24;
    expect(new Date(first.start_time).getUTCHours()).toBe(expectedUtcHour);
  });

  it("keeps slot generation idempotent and preserves manual slot edits", async () => {
    const secondRes = await invoke(generateSlotsHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        client_id: TENANT_ID,
        template_id: requireScheduleTemplateId(),
        date_from: generationWindow.dateFrom,
        date_to: generationWindow.dateTo,
      },
    });
    const secondBody = secondRes.body as GenerateSlotsResponse;

    expect(secondRes.statusCode).toBe(200);
    expect(secondBody.created).toBe(0);
    expect(secondBody.skipped_existing).toBe(scheduleTemplateSlotIds.length);
    expect(secondBody.slots).toHaveLength(0);

    const editedSlotId = scheduleTemplateSlotIds[0];
    if (!editedSlotId) throw new Error("Expected a slot to edit.");
    const { error: updateError } = await serviceSupabase
      .from("schedule_slots")
      .update({ capacity: 23 })
      .eq("id", editedSlotId);
    if (updateError) throw new Error(updateError.message);

    const thirdRes = await invoke(generateSlotsHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        client_id: TENANT_ID,
        template_id: requireScheduleTemplateId(),
        date_from: generationWindow.dateFrom,
        date_to: generationWindow.dateTo,
      },
    });
    const thirdBody = thirdRes.body as GenerateSlotsResponse;

    expect(thirdRes.statusCode).toBe(200);
    expect(thirdBody.created).toBe(0);
    expect(thirdBody.skipped_existing).toBe(scheduleTemplateSlotIds.length);

    const { data, error } = await serviceSupabase
      .from("schedule_slots")
      .select("capacity")
      .eq("id", editedSlotId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    expect(data?.capacity).toBe(23);
  });

  it("returns calendar counts that match booking truth", async () => {
    calendarCapacitySlotId = await createCapacityTwoCalendarSlot();
    await createWaitingEntry(calendarCapacitySlotId);

    const emptySlot = await calendarSlot(calendarCapacitySlotId);
    expect(emptySlot).toMatchObject({
      capacity: 2,
      is_cancelled: false,
      reservation_count: 0,
      waitlist_count: 1,
      spots_taken: 0,
      spots_left: 2,
    });

    const firstReservationId = await bookSlot(MAYA_MEMBERSHIP_ID, MAYA_STUDENT_ID);
    createdReservationIds.push(firstReservationId);

    const oneBookedSlot = await calendarSlot(calendarCapacitySlotId);
    expect(oneBookedSlot).toMatchObject({
      reservation_count: 1,
      waitlist_count: 1,
      spots_taken: 1,
      spots_left: 1,
    });

    const secondReservationId = await bookSlot(NOAH_MEMBERSHIP_ID, NOAH_STUDENT_ID);
    createdReservationIds.push(secondReservationId);

    const fullSlot = await calendarSlot(calendarCapacitySlotId);
    expect(fullSlot).toMatchObject({
      reservation_count: 2,
      waitlist_count: 1,
      spots_taken: 2,
      spots_left: 0,
    });
    expect(await slotSpotsTaken(calendarCapacitySlotId)).toBe(fullSlot.spots_taken);

    const thirdActor = await createSyntheticActiveBookingActor();
    const { error: overCapacityError } = await serviceSupabase.rpc("parent_book_slot", {
      p_tenant_id: TENANT_ID,
      p_slot_id: calendarCapacitySlotId,
      p_membership_id: thirdActor.membershipId,
      p_student_id: thirdActor.studentId,
    });
    expect(overCapacityError?.message).toContain("Slot is full");
  });

  it("cancels a fully-booked slot end-to-end and is idempotent", async () => {
    const cancelRes = await invoke(slotCancelHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { slot_id: requireCalendarCapacitySlotId() },
      body: { reason: "runtime slot cancel test" },
    });
    const cancelBody = cancelRes.body as SlotCancelResponse;

    expect(cancelRes.statusCode).toBe(200);
    expect(cancelBody).toMatchObject({
      reservations_cancelled: 2,
      credits_refunded: 1,
      waitlist_cancelled: 1,
      already_cancelled: false,
    });

    const cancelledSlot = await calendarSlot(requireCalendarCapacitySlotId());
    expect(cancelledSlot).toMatchObject({
      is_cancelled: true,
      reservation_count: 0,
      waitlist_count: 0,
      spots_taken: 0,
      spots_left: 2,
    });

    const ledgerRows = await ledgerRowsForReservations(createdReservationIds);
    const debitedReservationIds = ledgerRows
      .filter((row) => row.entry_type === "DEBIT")
      .map((row) => row.reservation_id);
    const refundedReservationIds = ledgerRows
      .filter((row) => row.entry_type === "REFUND")
      .map((row) => row.reservation_id);

    expect(debitedReservationIds).toEqual([createdReservationIds[0]]);
    expect(refundedReservationIds).toEqual(debitedReservationIds);

    const secondCancelRes = await invoke(slotCancelHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: { slot_id: requireCalendarCapacitySlotId() },
    });
    const secondCancelBody = secondCancelRes.body as SlotCancelResponse;

    expect(secondCancelRes.statusCode).toBe(200);
    expect(secondCancelBody).toMatchObject({
      reservations_cancelled: 0,
      credits_refunded: 0,
      waitlist_cancelled: 0,
      already_cancelled: true,
    });
  });

  it("blocks deleting templates with future slots, then deletes after slots are cancelled", async () => {
    const blockedRes = await invoke(templateHandler, {
      method: "DELETE",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { template_id: requireScheduleTemplateId() },
    });

    expect(blockedRes.statusCode).toBe(409);
    expect(blockedRes.body).toMatchObject({
      future_slot_count: scheduleTemplateSlotIds.length,
    });

    const { error: cancelError } = await serviceSupabase
      .from("schedule_slots")
      .update({ is_cancelled: true })
      .eq("slot_template_id", requireScheduleTemplateId());
    if (cancelError) throw new Error(cancelError.message);

    const deleteRes = await invoke(templateHandler, {
      method: "DELETE",
      headers: { authorization: `Bearer ${staffToken}` },
      query: { template_id: requireScheduleTemplateId() },
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.body).toMatchObject({ ok: true });
  });

  it("returns field-level 400s for invalid recurrence and generation ranges", async () => {
    const invalidRecurrenceRes = await invoke(templatesHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        client_id: TENANT_ID,
        name: `Invalid Runtime Schedule ${TEST_RUN_ID}`,
        slot_type: "TRAINING",
        default_start_time: "16:00",
        default_end_time: "17:00",
        recurrence_rule: "WEEKLY:MO,MO",
        bookable_program_id: TRAINING_PROGRAM_ID,
      },
    });
    expect(invalidRecurrenceRes.statusCode).toBe(400);
    expect(invalidRecurrenceRes.body).toMatchObject({
      fields: { recurrence_rule: expect.any(String) },
    });

    const invertedRes = await invoke(generateSlotsHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        client_id: TENANT_ID,
        date_from: generationWindow.dateTo,
        date_to: generationWindow.dateFrom,
      },
    });
    expect(invertedRes.statusCode).toBe(400);
    expect(invertedRes.body).toMatchObject({
      fields: { date_to: expect.any(String) },
    });

    const tooLongRes = await invoke(generateSlotsHandler, {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        client_id: TENANT_ID,
        date_from: generationWindow.dateFrom,
        date_to: addDaysIso(generationWindow.dateFrom, 92),
      },
    });
    expect(tooLongRes.statusCode).toBe(400);
    expect(tooLongRes.body).toMatchObject({
      fields: { date_to: expect.any(String) },
    });
  });
});

async function createStaffToken(): Promise<string> {
  const token = await createSignedInUser(STAFF_EMAIL);
  const staffId = randomUUID();
  const { data: authData, error: authError } = await anonSupabase.auth.getUser(token);
  if (authError || !authData.user?.id) {
    throw new Error(authError?.message ?? "Failed to resolve test staff user.");
  }

  const { error } = await serviceSupabase.from("staff").insert({
    id: staffId,
    user_id: authData.user.id,
    name: "Runtime API Staff",
    role: "admin",
    email: STAFF_EMAIL,
  });
  if (error) throw new Error(error.message);
  createdStaffIds.push(staffId);

  return token;
}

async function createSignedInUser(email: string): Promise<string> {
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

  return signInData.session.access_token;
}

async function cleanupCreatedAuthRows(): Promise<void> {
  for (const staffId of createdStaffIds) {
    await serviceSupabase.from("staff").delete().eq("id", staffId);
  }
  for (const userId of createdUserIds) {
    await serviceSupabase.auth.admin.deleteUser(userId);
  }
}

async function cleanupScheduleArtifacts(): Promise<void> {
  const reservationIds = uniqueValues(createdReservationIds);
  const waitlistIds = uniqueValues(createdWaitlistIds);
  const templateIds = uniqueValues(createdTemplateIds);

  if (reservationIds.length > 0) {
    await serviceSupabase.from("credit_ledger").delete().in("reservation_id", reservationIds);
  }
  if (waitlistIds.length > 0) {
    await serviceSupabase.from("waitlist_entries").delete().in("id", waitlistIds);
  }
  if (reservationIds.length > 0) {
    await serviceSupabase.from("reservations").delete().in("id", reservationIds);
  }
  if (templateIds.length > 0) {
    await serviceSupabase.from("schedule_slots").delete().in("slot_template_id", templateIds);
    await serviceSupabase.from("slot_templates").delete().in("id", templateIds);
  }
  if (createdCustomerEntitlementIds.length > 0) {
    await serviceSupabase.from("customer_entitlements").delete().in("id", uniqueValues(createdCustomerEntitlementIds));
  }
  if (createdMembershipIds.length > 0) {
    await serviceSupabase.from("academy_memberships").delete().in("id", uniqueValues(createdMembershipIds));
  }
  if (createdStudentIds.length > 0) {
    await serviceSupabase.from("students").delete().in("id", uniqueValues(createdStudentIds));
  }
  if (createdCustomerProfileIds.length > 0) {
    await serviceSupabase.from("customer_profiles").delete().in("id", uniqueValues(createdCustomerProfileIds));
  }
}

async function createCapacityTwoCalendarSlot(): Promise<string> {
  const createRes = await invoke(templatesHandler, {
    method: "POST",
    headers: { authorization: `Bearer ${staffToken}` },
    body: {
      client_id: TENANT_ID,
      name: `Runtime Capacity ${TEST_RUN_ID}`,
      slot_type: "TRAINING",
      default_start_time: "18:00",
      default_end_time: "19:00",
      default_capacity: 2,
      default_credit_cost: 1,
      recurrence_rule: "WEEKLY:MO",
      default_location: "Runtime Test Court",
      bookable_program_id: TRAINING_PROGRAM_ID,
    },
  });
  const created = createRes.body as SlotTemplateResponse;
  expect(createRes.statusCode).toBe(201);
  createdTemplateIds.push(created.template.id);

  const generateRes = await invoke(generateSlotsHandler, {
    method: "POST",
    headers: { authorization: `Bearer ${staffToken}` },
    body: {
      client_id: TENANT_ID,
      template_id: created.template.id,
      date_from: generationWindow.dateFrom,
      date_to: generationWindow.dateFrom,
    },
  });
  const generated = generateRes.body as GenerateSlotsResponse;
  expect(generateRes.statusCode).toBe(200);
  expect(generated.created).toBe(1);
  expect(generated.slots).toHaveLength(1);

  const slotId = generated.slots[0]?.id;
  if (!slotId) throw new Error("Expected generated capacity slot.");
  generatedSlotIds.push(slotId);
  return slotId;
}

async function createWaitingEntry(slotId: string): Promise<void> {
  const waitlistId = randomUUID();
  const { error } = await serviceSupabase.from("waitlist_entries").insert({
    id: waitlistId,
    tenant_id: TENANT_ID,
    slot_id: slotId,
    membership_id: LEO_MEMBERSHIP_ID,
    student_id: LEO_STUDENT_ID,
    status: "WAITING",
  });
  if (error) throw new Error(error.message);
  createdWaitlistIds.push(waitlistId);
}

async function bookSlot(membershipId: string, studentId: string): Promise<string> {
  const { data, error } = await serviceSupabase.rpc("parent_book_slot", {
    p_tenant_id: TENANT_ID,
    p_slot_id: requireCalendarCapacitySlotId(),
    p_membership_id: membershipId,
    p_student_id: studentId,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("Expected parent_book_slot to return a reservation id.");
  return data;
}

async function slotSpotsTaken(slotId: string): Promise<number> {
  const { data, error } = await serviceSupabase.rpc("slot_spots_taken", {
    p_tenant_id: TENANT_ID,
    p_slot_id: slotId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

async function calendarSlot(slotId: string): Promise<CalendarSlotResponseRow> {
  const res = await invoke(calendarHandler, {
    method: "GET",
    headers: { authorization: `Bearer ${staffToken}` },
    query: {
      client_id: TENANT_ID,
      date_from: generationWindow.dateFrom,
      date_to: generationWindow.dateFrom,
    },
  });
  const body = res.body as CalendarResponse;
  expect(res.statusCode).toBe(200);
  const slot = body.slots.find((row) => row.id === slotId);
  if (!slot) throw new Error(`Expected calendar slot ${slotId}.`);
  return slot;
}

async function createSyntheticActiveBookingActor(): Promise<{ membershipId: string; studentId: string }> {
  const profileId = randomUUID();
  const studentId = randomUUID();
  const membershipId = randomUUID();
  const entitlementId = randomUUID();

  await insertRow("customer_profiles", {
    id: profileId,
    supabase_user_id: `runtime-capacity-${TEST_RUN_ID}-${profileId}`,
    first_name: "Runtime",
    last_name: "Capacity",
    email: `runtime-capacity-${profileId}@example.test`,
    phone: null,
    profile_type: "PARENT",
  });
  createdCustomerProfileIds.push(profileId);

  await insertRow("students", {
    id: studentId,
    parent_id: profileId,
    first_name: "Runtime",
    last_name: "Athlete",
  });
  createdStudentIds.push(studentId);

  await insertRow("academy_memberships", {
    id: membershipId,
    academy_id: TENANT_ID,
    student_id: studentId,
    status: "ACTIVE",
    joined_at: new Date().toISOString(),
    stripe_customer_id: `cus_runtime_${profileId.replaceAll("-", "").slice(0, 18)}`,
  });
  createdMembershipIds.push(membershipId);

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
    source_ref: `runtime-capacity:${TEST_RUN_ID}:${entitlementId}`,
    config: { is_unlimited: true },
  });
  createdCustomerEntitlementIds.push(entitlementId);

  return { membershipId, studentId };
}

async function insertRow(table: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await serviceSupabase.from(table).insert(values);
  if (error) throw new Error(error.message);
}

async function ledgerRowsForReservations(reservationIds: string[]): Promise<Array<{
  reservation_id: string;
  entry_type: string;
  credit_delta: number;
}>> {
  const { data, error } = await serviceSupabase
    .from("credit_ledger")
    .select("reservation_id,entry_type,credit_delta,created_at")
    .in("reservation_id", reservationIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function generatedSlotsForTemplate(templateId: string): Promise<Array<{
  id: string;
  slot_template_id: string;
  start_time: string;
  capacity: number;
}>> {
  const { data, error } = await serviceSupabase
    .from("schedule_slots")
    .select("id,slot_template_id,start_time,capacity")
    .eq("slot_template_id", templateId)
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
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

function allPrices(body: OffersResponse): OffersResponse["options"][number]["prices"] {
  return body.options.flatMap((option) => option.prices);
}

function findPrice(body: OffersResponse, priceId: string): OffersResponse["options"][number]["prices"][number] {
  const price = allPrices(body).find((row) => row.id === priceId);
  if (!price) throw new Error(`Expected price ${priceId}.`);
  return price;
}

function requireScheduleTemplateId(): string {
  if (!scheduleTemplateId) throw new Error("Expected schedule template to be created.");
  return scheduleTemplateId;
}

function requireCalendarCapacitySlotId(): string {
  if (!calendarCapacitySlotId) throw new Error("Expected capacity calendar slot to be created.");
  return calendarCapacitySlotId;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function twoWeekMondayWednesdayWindow(): { dateFrom: string; dateTo: string } {
  const today = dateOnlyInTimeZone(new Date(), "America/New_York");
  const dateFrom = nextWeekdayAfter(today, 1);
  return { dateFrom, dateTo: addDaysIso(dateFrom, 13) };
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

function nextWeekdayAfter(dateIso: string, weekday: number): string {
  let cursor = addDaysIso(dateIso, 1);
  for (let i = 0; i < 7; i += 1) {
    if (new Date(`${cursor}T00:00:00.000Z`).getUTCDay() === weekday) return cursor;
    cursor = addDaysIso(cursor, 1);
  }
  throw new Error(`Could not find weekday ${weekday} after ${dateIso}.`);
}

function addDaysIso(dateIso: string, days: number): string {
  const year = Number(dateIso.slice(0, 4));
  const month = Number(dateIso.slice(5, 7));
  const day = Number(dateIso.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function localDateTimeParts(iso: string, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function offsetMinutesForTimeZone(timeZone: string, iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(iso));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/.exec(offset);
  if (!match?.groups) throw new Error(`Could not parse offset ${offset}.`);
  const sign = match.groups.sign === "-" ? -1 : 1;
  const hours = Number(match.groups.hours ?? 0);
  const minutes = Number(match.groups.minutes ?? 0);
  return sign * ((hours * 60) + minutes);
}

function assertLocalSupabase(): void {
  if (!runtimeTestSupabaseUrl.includes("127.0.0.1") && process.env.ALLOW_REMOTE_RUNTIME_TESTS !== "1") {
    throw new Error("Runtime API tests only run against local Supabase by default.");
  }
}
