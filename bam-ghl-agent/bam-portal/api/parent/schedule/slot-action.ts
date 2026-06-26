import { withSentryApiRoute } from "../../_sentry.js";
import { sendError } from "../_errors.js";
import {
  bookScheduleSlot,
  getParentScheduleContext,
  joinScheduleSlotWaitlist,
  queryParam,
  readBookSlotRequest,
  requiredQueryParam,
} from "../_schedule.js";
import type { ParentApiRequest, ParentApiResponse } from "../_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const action = queryParam(req, "action");
    const slotId = requiredQueryParam(req, "slot_id");
    const context = await getParentScheduleContext(req);

    if (action === "book") {
      const reservation = await bookScheduleSlot(context, slotId, readBookSlotRequest(req));
      return res.status(200).json(reservation);
    }

    if (action === "waitlist") {
      const waitlist = await joinScheduleSlotWaitlist(context, slotId, readBookSlotRequest(req));
      return res.status(200).json(waitlist);
    }

    return res.status(404).json({ error: "not found" });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withSentryApiRoute(handler);
