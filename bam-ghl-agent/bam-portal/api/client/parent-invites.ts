import { withSentryApiRoute } from "../_sentry.js";
import { getClientUserContext } from "./_client-context.js";
import { HttpError, sendError } from "../parent/_errors.js";
import { issueParentInvite } from "../parent/_parent-invite.js";
import type { ParentApiRequest, ParentApiResponse } from "../parent/_types.js";

const DEFAULT_EXPIRY_HOURS = 7 * 24;
const MAX_EXPIRY_HOURS = 30 * 24;

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getClientUserContext(req);
    const body = readJsonObject(req.body);
    const contactId = requiredString(body.contact_id, "contact_id");
    const opportunityId = requiredString(body.opportunity_id, "opportunity_id");
    const expiresInHours = optionalPositiveInteger(body.expires_in_hours, "expires_in_hours");
    const expiresAt = new Date(
      Date.now() + Math.min(expiresInHours ?? DEFAULT_EXPIRY_HOURS, MAX_EXPIRY_HOURS) * 3_600_000,
    );
    const invite = await issueParentInvite({
      academyId: context.tenantId,
      contactId,
      opportunityId,
      expiresAt,
    });

    return res.status(201).json({
      ...invite,
      invite_path: `/invite?token=${encodeURIComponent(invite.token)}`,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

function readJsonObject(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  throw new HttpError(400, "Expected JSON body.");
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Missing required body field: ${fieldName}.`);
  }
  return value.trim();
}

function optionalPositiveInteger(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }
  return value;
}

export default withSentryApiRoute(handler);
