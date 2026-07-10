import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import { getParentReadContextForUser } from "./_parent-context.js";
import {
  getVerifiedAuthEmail,
  resolveParentIdentityForUser,
  type CreateParentProfileInput,
} from "./_parent-identity.js";
import { attachParentToAcademy, resolveParentInvite } from "./_parent-invite.js";
import { buildParentProfilePayload } from "./_parent-profile.js";
import { verifySupabaseUser } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const input = readRegisterRequest(req.body);
    const user = await verifySupabaseUser(req);
    const invite = input.invite_token
      ? await resolveParentInvite(input.invite_token, getVerifiedAuthEmail(user))
      : null;
    const identity = await resolveParentIdentityForUser(user, input.profile);
    const attachment = invite
      ? await attachParentToAcademy(identity.profile, invite)
      : null;
    const context = await getParentReadContextForUser(user);
    const profile = await buildParentProfilePayload(context);

    return res.status(identity.created ? 201 : 200).json({
      ...profile,
      registration: {
        profile_created: identity.created,
        profile_claimed: identity.claimed,
        academy_attached: Boolean(attachment),
        academy_id: attachment?.membership.academy_id ?? null,
        academy_membership_id: attachment?.membership.id ?? null,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}

function readRegisterRequest(body: unknown): {
  profile: CreateParentProfileInput;
  invite_token: string | null;
} {
  const input = readJsonObject(body);
  const profileType = optionalString(input.profile_type, "profile_type");
  if (profileType && profileType !== "PARENT") {
    throw new HttpError(400, "Only parent profiles can be registered here.");
  }

  return {
    profile: {
      first_name: optionalString(input.first_name, "first_name") ?? undefined,
      last_name: optionalString(input.last_name, "last_name") ?? undefined,
      email: optionalString(input.email, "email") ?? undefined,
      phone: optionalString(input.phone, "phone"),
      profile_type: profileType === "PARENT" ? "PARENT" : undefined,
    },
    invite_token: optionalString(input.invite_token, "invite_token"),
  };
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

function optionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }
  return value.trim() || null;
}

export default withSentryApiRoute(handler);
