import { withSentryApiRoute } from "../_sentry.js";
import { sendError } from "./_errors.js";
import {
  getParentScheduleContext,
  leaveScheduleWaitlist,
  requiredQueryParam,
} from "./_schedule.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentScheduleContext(req);
    const waitlist = await leaveScheduleWaitlist(context, requiredQueryParam(req, "waitlist_id"));

    return res.status(200).json(waitlist);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withSentryApiRoute(handler);
