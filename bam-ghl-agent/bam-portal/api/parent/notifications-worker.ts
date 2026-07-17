import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import { checkParentPushReceipts, dispatchParentPushDeliveries } from "./_notifications.js";
import type { HeaderValue, ParentApiRequest, ParentApiResponse } from "./_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      throw new HttpError(405, "Method not allowed.");
    }
    authorize(req);

    const [dispatch, receipts] = await Promise.all([
      dispatchParentPushDeliveries(),
      checkParentPushReceipts(),
    ]);
    return res.status(200).json({ ok: true, dispatch, receipts });
  } catch (error) {
    return sendError(res, error);
  }
}

function authorize(req: ParentApiRequest): void {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) throw new HttpError(500, "CRON_SECRET is not configured.");
  if (bearerToken(req.headers.authorization) === expected) return;
  throw new HttpError(401, "Unauthorized.");
}

function headerValue(value: HeaderValue): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function bearerToken(value: HeaderValue): string {
  const match = /^Bearer\s+(.+)$/i.exec(headerValue(value));
  return match?.[1]?.trim() ?? "";
}

export default withSentryApiRoute(handler);
