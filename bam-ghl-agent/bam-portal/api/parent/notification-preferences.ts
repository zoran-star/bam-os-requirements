import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import { resolveParentIdentityForUser, type ParentIdentityProfile } from "./_parent-identity.js";
import { eq, sb, verifySupabaseUser } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

const CATEGORIES = ["MESSAGES", "BOOKINGS", "SCHEDULE", "MEMBERSHIPS", "BILLING"] as const;
type NotificationCategory = (typeof CATEGORIES)[number];
type NotificationChannel = "PUSH" | "SMS";

type PreferenceRow = {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  sms_consent_status: "NOT_REQUESTED" | "OPTED_IN" | "OPTED_OUT" | null;
  sms_consented_at: string | null;
  sms_consent_source: string | null;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  try {
    const user = await verifySupabaseUser(req);
    const { profile } = await resolveParentIdentityForUser(user);
    if (req.method === "GET") return await getPreferences(res, profile);
    if (req.method === "PATCH") return await patchPreferences(req, res, profile);
    res.setHeader("Allow", "GET, PATCH");
    throw new HttpError(405, "Method not allowed.");
  } catch (error) {
    return sendError(res, error);
  }
}

async function getPreferences(res: ParentApiResponse, profile: ParentIdentityProfile) {
  return res.status(200).json({ preferences: await readPreferences(profile.id) });
}

async function patchPreferences(
  req: ParentApiRequest,
  res: ParentApiResponse,
  profile: ParentIdentityProfile,
) {
  const body = readObject(req.body);
  const category = readCategory(body.category);
  const channel = readChannel(body.channel);
  if (typeof body.enabled !== "boolean") throw new HttpError(422, "Invalid enabled value.");
  if (channel === "SMS" && body.enabled) {
    throw new HttpError(422, "SMS notifications are not available yet.");
  }

  const categories = category === "ALL" ? CATEGORIES : [category];
  const now = new Date().toISOString();
  await sb("parent_notification_preferences?on_conflict=customer_profile_id,category,channel", {
    body: JSON.stringify(
      categories.map((item) => ({
        category: item,
        channel,
        customer_profile_id: profile.id,
        enabled: body.enabled,
        ...(channel === "SMS" ? { sms_consent_status: "NOT_REQUESTED" } : {}),
        updated_at: now,
      })),
    ),
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    method: "POST",
  });

  return res.status(200).json({ preferences: await readPreferences(profile.id) });
}

async function readPreferences(profileId: string) {
  const rows = await sb<PreferenceRow[]>(
    "parent_notification_preferences" +
      `?customer_profile_id=eq.${eq(profileId)}` +
      "&select=category,channel,enabled,sms_consent_status,sms_consented_at,sms_consent_source",
  );
  const byKey = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [`${row.category}:${row.channel}`, row]),
  );

  return CATEGORIES.flatMap((category) =>
    (["PUSH", "SMS"] as const).map((channel) => {
      const row = byKey.get(`${category}:${channel}`);
      return {
        category,
        channel,
        enabled: row?.enabled ?? channel === "PUSH",
        sms_consent_status: channel === "SMS" ? (row?.sms_consent_status ?? "NOT_REQUESTED") : null,
        sms_consented_at: channel === "SMS" ? (row?.sms_consented_at ?? null) : null,
        sms_consent_source: channel === "SMS" ? (row?.sms_consent_source ?? null) : null,
      };
    }),
  );
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(422, "JSON body is required.");
  }
  return value as Record<string, unknown>;
}

function readCategory(value: unknown): NotificationCategory | "ALL" {
  if (value === "ALL" || CATEGORIES.includes(value as NotificationCategory)) {
    return value as NotificationCategory | "ALL";
  }
  throw new HttpError(422, "Invalid notification category.");
}

function readChannel(value: unknown): NotificationChannel {
  if (value === "PUSH" || value === "SMS") return value;
  throw new HttpError(422, "Invalid notification channel.");
}

export default withSentryApiRoute(handler);
