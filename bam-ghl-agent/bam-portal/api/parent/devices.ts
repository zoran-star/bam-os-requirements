import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import { resolveParentIdentityForUser } from "./_parent-identity.js";
import { eq, sb, verifySupabaseUser } from "./_supabase.js";
import type { HeaderValue, ParentApiRequest, ParentApiResponse } from "./_types.js";

const EXPO_TOKEN_PATTERN = /^(Expo|Exponent)PushToken\[[^\]]+\]$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DeviceTokenRow = {
  id: string;
  token: string;
  platform: "ios" | "android";
  app_environment: "development" | "staging" | "production";
  project_id: string;
  installation_id: string;
  last_seen_at: string;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  try {
    if (req.method === "POST") return await registerDevice(req, res);
    if (req.method === "DELETE") return await unregisterDevice(req, res);
    res.setHeader("Allow", "POST, DELETE");
    throw new HttpError(405, "Method not allowed.");
  } catch (error) {
    return sendError(res, error);
  }
}

async function registerDevice(req: ParentApiRequest, res: ParentApiResponse) {
  const user = await verifySupabaseUser(req);
  await resolveParentIdentityForUser(user);
  const body = readObject(req.body);
  const token = requiredString(body.token, "token");
  const platform = readPlatform(body.platform);
  const appEnvironment = readEnvironment(body.app_environment);
  const projectId = readUuid(body.project_id, "project_id");
  const installationId = readUuid(body.installation_id, "installation_id");

  if (!EXPO_TOKEN_PATTERN.test(token)) {
    throw new HttpError(422, "Invalid Expo push token.");
  }

  const now = new Date().toISOString();
  await sb(
    "device_tokens" +
      `?auth_user_id=eq.${eq(user.id)}` +
      "&app_scope=eq.PARENT" +
      "&token_provider=eq.EXPO" +
      `&installation_id=eq.${eq(installationId)}` +
      `&token=neq.${eq(token)}`,
    {
      body: JSON.stringify({
        disabled_at: now,
        last_error: "Replaced by a newer token for this installation.",
        updated_at: now,
      }),
      headers: { Prefer: "return=minimal" },
      method: "PATCH",
    },
  );

  const rows = await sb<DeviceTokenRow[]>("device_tokens?on_conflict=token", {
    body: JSON.stringify({
      app_environment: appEnvironment,
      app_scope: "PARENT",
      auth_user_id: user.id,
      client_id: null,
      disabled_at: null,
      installation_id: installationId,
      last_error: null,
      last_seen_at: now,
      platform,
      project_id: projectId,
      token,
      token_provider: "EXPO",
      updated_at: now,
    }),
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    method: "POST",
  });
  const device = Array.isArray(rows) ? rows[0] : null;
  if (!device) throw new HttpError(502, "Device registration failed.");

  return res.status(200).json({ device });
}

async function unregisterDevice(req: ParentApiRequest, res: ParentApiResponse) {
  const user = await verifySupabaseUser(req);
  await resolveParentIdentityForUser(user);
  const token = queryValue(req.query?.token);
  if (!token || !EXPO_TOKEN_PATTERN.test(token)) {
    throw new HttpError(422, "Invalid Expo push token.");
  }

  const now = new Date().toISOString();
  await sb(
    "device_tokens" +
      `?token=eq.${eq(token)}` +
      `&auth_user_id=eq.${eq(user.id)}` +
      "&app_scope=eq.PARENT" +
      "&token_provider=eq.EXPO",
    {
      body: JSON.stringify({
        disabled_at: now,
        last_error: "Unregistered by the parent app.",
        updated_at: now,
      }),
      headers: { Prefer: "return=minimal" },
      method: "PATCH",
    },
  );

  return res.status(200).json({ ok: true });
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(422, "JSON body is required.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(422, `Invalid ${field}.`);
  }
  return value.trim();
}

function readUuid(value: unknown, field: string): string {
  const normalized = requiredString(value, field);
  if (!UUID_PATTERN.test(normalized)) throw new HttpError(422, `Invalid ${field}.`);
  return normalized;
}

function readPlatform(value: unknown): "ios" | "android" {
  if (value === "ios" || value === "android") return value;
  throw new HttpError(422, "Invalid platform.");
}

function readEnvironment(value: unknown): "development" | "staging" | "production" {
  if (value === "development" || value === "staging" || value === "production") return value;
  throw new HttpError(422, "Invalid app_environment.");
}

function queryValue(value: HeaderValue): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

export default withSentryApiRoute(handler);
