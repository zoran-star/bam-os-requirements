import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import { getParentReadContextForUser } from "./_parent-context.js";
import {
  getVerifiedAuthEmail,
  resolveParentIdentityForUser,
} from "./_parent-identity.js";
import { attachParentToAcademy, resolveParentInvite } from "./_parent-invite.js";
import { buildParentProfilePayload } from "./_parent-profile.js";
import { verifySupabaseUser } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const token = readInviteToken(req);
    if (req.method === "GET") {
      const invite = await resolveParentInvite(token);
      return res.status(200).json({
        academy_id: invite.academy.id,
        academy_name: invite.academy.business_name || "Academy",
        expires_at: new Date(invite.payload.exp).toISOString(),
      });
    }

    const user = await verifySupabaseUser(req);
    const invite = await resolveParentInvite(token, getVerifiedAuthEmail(user));
    const identity = await resolveParentIdentityForUser(user);
    const attachment = await attachParentToAcademy(identity.profile, invite);
    const context = await getParentReadContextForUser(user);
    const profile = await buildParentProfilePayload(context);
    return res.status(200).json({
      ...profile,
      invite: {
        academy_id: invite.academy.id,
        academy_name: invite.academy.business_name || "Academy",
        academy_membership_id: attachment.membership.id,
        attached: attachment.attached,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}

function readInviteToken(req: ParentApiRequest): string {
  const queryToken = queryValue(req.query?.token);
  if (queryToken) return queryToken;
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    const bodyToken = (req.body as Record<string, unknown>).invite_token;
    if (typeof bodyToken === "string" && bodyToken.trim()) return bodyToken.trim();
  }
  throw new HttpError(400, "Academy invite is required.");
}

function queryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default withSentryApiRoute(handler);
