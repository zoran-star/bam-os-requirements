import { withSentryApiRoute } from "../../../_sentry.js";
import { sendError } from "../../_errors.js";
import {
  getParentScheduleContext,
  getScheduleSlot,
  queryParam,
  requiredQueryParam,
} from "../../_schedule.js";
import type { ParentApiRequest, ParentApiResponse } from "../../_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentScheduleContext(req);
    const slot = await getScheduleSlot(
      context,
      requiredQueryParam(req, "slotId"),
      queryParam(req, "membership_id"),
    );

    return res.status(200).json(slot);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withSentryApiRoute(handler);
