import { withSentryApiRoute } from "../../_sentry.js";
import { sendError } from "../_errors.js";
import {
  getParentScheduleContext,
  intQueryParam,
  listPastAppointments,
  queryParam,
} from "../_schedule.js";
import type { ParentApiRequest, ParentApiResponse } from "../_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentScheduleContext(req);
    const appointments = await listPastAppointments(context, {
      membershipId: queryParam(req, "membership_id"),
      days: queryParam(req, "days") ? intQueryParam(req, "days", 30, 3650) : undefined,
      limit: intQueryParam(req, "limit", 50, 100),
    });

    return res.status(200).json(appointments);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withSentryApiRoute(handler);
