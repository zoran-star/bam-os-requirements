import { withSentryApiRoute } from "../_sentry.js";
import { listPurchaseOptions } from "./_entitlements.js";
import { sendError } from "./_errors.js";
import { getParentReadContext } from "./_parent-context.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentReadContext(req);
    const options = await listPurchaseOptions(context.academyIds);
    return res.status(200).json(options);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withSentryApiRoute(handler);
