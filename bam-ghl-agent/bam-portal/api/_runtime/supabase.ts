import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "../_env.js";
import type { RuntimeSupabaseClient } from "./types.js";

export function createRuntimeSupabaseClient(): RuntimeSupabaseClient {
  return createClient(
    requireEnv("VITE_SUPABASE_URL", "SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export function assertSingle<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Expected one row but received none.");
  return data as T;
}

export function assertRows<T>(data: unknown, error: { message: string } | null): T[] {
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as T[];
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
