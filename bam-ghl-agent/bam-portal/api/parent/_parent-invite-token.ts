import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { firstEnv, requireEnv } from "../_env.js";
import { HttpError } from "./_errors.js";
import { normalizeEmail } from "./_parent-identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_INVITE_MESSAGE = "This academy invite is invalid or has expired.";

export type ParentInviteTokenPayload = {
  v: 1;
  academy_id: string;
  contact_id: string;
  opportunity_id: string;
  email: string;
  iat: number;
  exp: number;
  nonce: string;
};

export function createParentInviteToken(input: {
  academy_id: string;
  contact_id: string;
  opportunity_id: string;
  email: string;
  expires_at: Date;
}): { token: string; payload: ParentInviteTokenPayload } {
  const payload: ParentInviteTokenPayload = {
    v: 1,
    academy_id: requireUuid(input.academy_id),
    contact_id: requireUuid(input.contact_id),
    opportunity_id: requireUuid(input.opportunity_id),
    email: normalizeEmail(input.email),
    iat: Date.now(),
    exp: input.expires_at.getTime(),
    nonce: randomBytes(12).toString("base64url"),
  };
  if (!payload.email || !Number.isFinite(payload.exp) || payload.exp <= payload.iat) {
    throw new HttpError(400, "Invite email and expiry are required.");
  }

  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(data);
  return { token: `${data}.${signature}`, payload };
}

export function parseParentInviteToken(token: string): ParentInviteTokenPayload {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("format");
    const [data, signature] = parts;
    const expected = sign(data);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new Error("signature");
    }

    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Partial<
      ParentInviteTokenPayload
    >;
    if (
      payload.v !== 1 ||
      !isUuid(payload.academy_id) ||
      !isUuid(payload.contact_id) ||
      !isUuid(payload.opportunity_id) ||
      typeof payload.email !== "string" ||
      normalizeEmail(payload.email) !== payload.email ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      typeof payload.nonce !== "string" ||
      !payload.nonce ||
      payload.exp <= Date.now()
    ) {
      throw new Error("payload");
    }
    return payload as ParentInviteTokenPayload;
  } catch {
    throw new HttpError(400, INVALID_INVITE_MESSAGE);
  }
}

function sign(data: string): string {
  const secret =
    firstEnv("PARENT_INVITE_SIGNING_SECRET") ??
    requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function requireUuid(value: string): string {
  if (!isUuid(value)) throw new HttpError(400, "Invalid invite context.");
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
