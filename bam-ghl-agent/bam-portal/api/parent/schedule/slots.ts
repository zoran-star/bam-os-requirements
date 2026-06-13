import { withSentryApiRoute } from "../../_sentry.js";
import { sendError } from "../_errors.js";
import {
  getParentScheduleContext,
  intQueryParam,
  listScheduleSlots,
  queryParam,
  requiredQueryParam,
} from "../_schedule.js";
import type { ParentApiRequest, ParentApiResponse } from "../_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentScheduleContext(req);
    const slots = await listScheduleSlots(context, {
      academyId: requiredQueryParam(req, "academy_id"),
      membershipId: queryParam(req, "membership_id"),
      dateFrom: queryParam(req, "date_from"),
      dateTo: queryParam(req, "date_to"),
      limit: intQueryParam(req, "limit", 100, 200),
    });

    return res.status(200).json(slots);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withSentryApiRoute(handler);
