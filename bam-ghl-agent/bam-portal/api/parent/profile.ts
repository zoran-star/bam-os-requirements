import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import {
  getParentReadContext,
  getParentReadContextForUser,
} from "./_parent-context.js";
import { buildParentProfilePayload } from "./_parent-profile.js";
import { eq, sb } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    let context = await getParentReadContext(req);

    if (req.method === "PATCH") {
      await updateCustomerProfile(context.profile.id, readUpdateProfileRequest(req.body));
      context = await getParentReadContextForUser(context.user);
    }

    const payload = await buildParentProfilePayload(context);

    return res.status(200).json(payload);
  } catch (error) {
    return sendError(res, error);
  }
}

type UpdateProfileRequest = {
  first_name?: string;
  last_name?: string;
  phone?: string | null;
};

function readUpdateProfileRequest(body: unknown): UpdateProfileRequest {
  const input = readJsonObject(body);
  const patch: UpdateProfileRequest = {};

  if ("email" in input) {
    throw new HttpError(400, "Email changes are not available yet.");
  }

  if ("first_name" in input) {
    patch.first_name = requiredTrimmedString(input.first_name, "first_name");
  }

  if ("last_name" in input) {
    patch.last_name = requiredTrimmedString(input.last_name, "last_name");
  }

  if ("phone" in input) {
    patch.phone = optionalTrimmedString(input.phone, "phone");
  }

  if (!("first_name" in patch) && !("last_name" in patch) && !("phone" in patch)) {
    throw new HttpError(400, "No supported profile fields provided.");
  }

  return patch;
}

async function updateCustomerProfile(profileId: string, patch: UpdateProfileRequest) {
  await sb(
    `customer_profiles?id=eq.${eq(profileId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ...patch,
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

function readJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new HttpError(400, "Invalid JSON body.");
    }
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  throw new HttpError(400, "Expected JSON body.");
}

function requiredTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing required body field: ${fieldName}.`);
  }

  return value.trim();
}

function optionalTrimmedString(value: unknown, fieldName: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default withSentryApiRoute(handler);
