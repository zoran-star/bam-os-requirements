import { withSentryApiRoute } from "../../_sentry.js";
import { createRuntimeSupabaseClient } from "../../_runtime/supabase.js";
import { HttpError } from "../_errors.js";
import { getStaffContext } from "../_staff-context.js";
import type { RuntimeApiRequest, RuntimeApiResponse } from "../_types.js";
import {
  FieldValidationError,
  isUuid,
  optionalNullableString,
  queryParam,
  readJsonObject,
  sendScheduleError,
  supabaseHttpError,
  type FieldErrors,
} from "./_shared.js";

type SlotLookupRow = {
  id: string;
  tenant_id: string;
  is_cancelled: boolean;
};

type CancelSlotRequest = {
  slotId: string;
  reason: string | null;
};

type StaffCancelSlotRow = {
  reservations_cancelled: number | string | null;
  credits_refunded: number | string | null;
  waitlist_cancelled: number | string | null;
  trials_cancelled: number | string | null;
};

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    await getStaffContext(req);
    const result = await cancelSlot(req);
    return res.status(200).json(result);
  } catch (error) {
    return sendScheduleError(res, error);
  }
}

async function cancelSlot(req: RuntimeApiRequest) {
  const request = readCancelRequest(req);
  const slot = await getSlot(request.slotId);
  if (!slot) throw new HttpError(404, "slot not found");

  const result = await callStaffCancelSlot(slot.tenant_id, request.slotId, request.reason);
  const reservationsCancelled = numericCount(result.reservations_cancelled);
  const creditsRefunded = numericCount(result.credits_refunded);
  const waitlistCancelled = numericCount(result.waitlist_cancelled);
  const trialsCancelled = numericCount(result.trials_cancelled);

  return {
    reservations_cancelled: reservationsCancelled,
    credits_refunded: creditsRefunded,
    waitlist_cancelled: waitlistCancelled,
    trials_cancelled: trialsCancelled,
    already_cancelled: slot.is_cancelled
      && reservationsCancelled === 0
      && creditsRefunded === 0
      && waitlistCancelled === 0
      && trialsCancelled === 0,
  };
}

function readCancelRequest(req: RuntimeApiRequest): CancelSlotRequest {
  const body = req.body === undefined ? {} : readJsonObject(req.body);
  const errors: FieldErrors = {};
  const slotId = queryParam(req, "slot_id") || stringValue(body.slot_id);
  const reason = optionalNullableString(body.reason, "reason", errors);

  if (!slotId) {
    errors.slot_id = "is required";
  } else if (!isUuid(slotId)) {
    errors.slot_id = "must be a valid UUID";
  }

  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);
  if (!slotId) throw new FieldValidationError(errors);
  return { slotId, reason: reason ?? null };
}

async function getSlot(slotId: string): Promise<SlotLookupRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("schedule_slots")
    .select("id,tenant_id,is_cancelled")
    .eq("id", slotId)
    .limit(1)
    .maybeSingle();

  if (error) throw supabaseHttpError("schedule_slots", error.message);
  return data ? (data as SlotLookupRow) : null;
}

async function callStaffCancelSlot(
  tenantId: string,
  slotId: string,
  reason: string | null,
): Promise<StaffCancelSlotRow> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .rpc("staff_cancel_slot", {
      p_tenant_id: tenantId,
      p_slot_id: slotId,
      p_reason: reason,
    })
    .single();

  if (error) throw supabaseHttpError("staff_cancel_slot", error.message);
  return data as StaffCancelSlotRow;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numericCount(value: number | string | null): number {
  return Number(value ?? 0);
}

export default withSentryApiRoute(handler);
