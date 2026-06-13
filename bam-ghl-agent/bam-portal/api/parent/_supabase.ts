import { requireEnv } from "../_env.js";
import { HttpError } from "./_errors.js";
import type { HeaderValue, ParentApiRequest } from "./_types.js";

type SupabaseInit = RequestInit & {
  headers?: Record<string, string>;
};

export type SupabaseUser = {
  id: string;
  email?: string;
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

export function eq(value: string | number): string {
  return encodeURIComponent(String(value));
}

export function inList(values: Array<string | number>): string {
  return values.map((value) => encodeURIComponent(String(value))).join(",");
}

function bearerToken(auth: HeaderValue): string {
  if (typeof auth !== "string") return "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}
