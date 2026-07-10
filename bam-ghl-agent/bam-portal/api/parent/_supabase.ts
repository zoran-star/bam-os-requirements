import { requireEnv } from "../_env.js";
import { HttpError } from "./_errors.js";
import type { HeaderValue, ParentApiRequest } from "./_types.js";

type SupabaseInit = RequestInit & {
  headers?: Record<string, string>;
};

export type SupabaseUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

function supabaseUrl(): string {
  return requireEnv("VITE_SUPABASE_URL", "SUPABASE_URL").replace(/\/+$/, "");
}

function serviceKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");
}

export async function sb<T = unknown>(path: string, init: SupabaseInit = {}): Promise<T> {
  const key = serviceKey();
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(502, "Supabase request failed", {
      status: res.status,
      body: text,
    });
  }

  return (text ? JSON.parse(text) : null) as T;
}

export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const key = serviceKey();
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const text = await res.text();
  const parsed = text ? safeJsonParse(text) : null;
  if (!res.ok) {
    const rawMessage = supabaseErrorMessage(parsed) ?? "Supabase RPC failed";
    const message = publicRpcErrorMessage(rawMessage);
    throw new HttpError(rpcErrorStatus(res.status, rawMessage), message, {
      rawMessage,
      status: res.status,
      body: parsed ?? text,
    });
  }

  return parsed as T;
}

export async function verifySupabaseUser(req: ParentApiRequest): Promise<SupabaseUser> {
  const auth = req.headers.authorization || "";
  const token = bearerToken(auth);
  if (!token) {
    throw new HttpError(401, "auth required");
  }

  const res = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new HttpError(401, "invalid token");
  }

  const user = (await res.json()) as SupabaseUser;
  if (!user.id) {
    throw new HttpError(401, "invalid token");
  }

  return user;
}

export async function updateSupabaseUserAppMetadata(
  user: SupabaseUser,
  patch: Record<string, unknown>,
): Promise<SupabaseUser> {
  const key = serviceKey();
  const appMetadata = { ...(user.app_metadata ?? {}), ...patch };
  const res = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: "PUT",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_metadata: appMetadata }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(502, "Supabase Auth update failed", {
      status: res.status,
      body: text,
    });
  }

  const updated = (text ? JSON.parse(text) : null) as SupabaseUser | null;
  return updated?.id ? updated : { ...user, app_metadata: appMetadata };
}

export function eq(value: string | number): string {
  return encodeURIComponent(String(value));
}

export function inList(values: Array<string | number>): string {
  return values.map((value) => encodeURIComponent(String(value))).join(",");
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function supabaseErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function rpcErrorStatus(status: number, message: string): number {
  const normalized = message.toLowerCase();
  if (normalized.includes("not found")) return 404;
  if (normalized.includes("not authorized")) return 403;
  if (normalized.includes("not active")) return 403;
  if (normalized.includes("does not belong")) return 403;
  if (normalized.includes("no active entitlement")) return 403;
  if (normalized.includes("full")) return 409;
  if (normalized.includes("active membership")) return 409;
  if (normalized.includes("already has a booked trial")) return 409;
  if (normalized.includes("already booked")) return 409;
  if (normalized.includes("already used")) return 409;
  if (normalized.includes("open spots")) return 409;
  if (normalized.includes("already started")) return 409;
  if (normalized.includes("no longer")) return 409;
  if (status >= 400 && status < 500) return 400;
  return 502;
}

function publicRpcErrorMessage(message: string): string {
  const normalized = message.trim();
  return SAFE_RPC_ERROR_MESSAGES.has(normalized)
    ? normalized
    : "Schedule action failed. Please try again.";
}

const SAFE_RPC_ERROR_MESSAGES = new Set([
  "Author auth user is required.",
  "Customer profile is required.",
  "Invalid message author.",
  "Invalid message type.",
  "Invalid system author.",
  "Message body is required.",
  "Message not found.",
  "Membership is not active.",
  "Membership not found.",
  "No active entitlement with enough credits for this slot.",
  "Reservation can no longer be cancelled.",
  "Reservation cannot be cancelled from its current status.",
  "Reservation not found.",
  "Slot capacity is not configured.",
  "Slot has already started.",
  "Slot has open spots. Book instead.",
  "Slot is already booked.",
  "Slot is cancelled.",
  "Slot is full.",
  "Slot not found.",
  "Student already has a booked trial.",
  "Student already has an active membership.",
  "Student has already used a free trial.",
  "Student does not belong to membership.",
  "Student does not belong to this parent.",
  "Thread not found.",
  "Trial booking cannot be cancelled from its current status.",
  "Trial booking not found.",
  "Waitlist entry cannot be removed from its current status.",
  "Waitlist entry not found.",
]);

function bearerToken(auth: HeaderValue): string {
  if (typeof auth !== "string") return "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}
