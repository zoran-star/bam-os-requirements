import type { User } from "@supabase/supabase-js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import { HttpError } from "./_errors.js";
import type { HeaderValue, RuntimeApiRequest } from "./_types.js";

export type StaffRow = {
  id: string;
  name: string | null;
  role: string;
  email: string | null;
  user_id: string | null;
};

export type StaffContext = {
  user: User;
  staff: StaffRow;
};

export async function getStaffContext(req: RuntimeApiRequest): Promise<StaffContext> {
  const token = bearerToken(header(req.headers, "authorization"));
  if (!token) {
    throw new HttpError(401, "auth required");
  }

  const supabase = createRuntimeSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData.user;

  if (authError || !user?.id) {
    throw new HttpError(401, "invalid token", authError?.message);
  }

  let staff = await staffByUserId(user.id);
  if (!staff && user.email) {
    staff = await staffByEmail(user.email);
  }

  if (!staff) {
    throw new HttpError(403, "staff only");
  }

  return { user, staff };
}

async function staffByUserId(userId: string): Promise<StaffRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id,name,role,email,user_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(502, "Supabase request failed", {
      lookup: "staff.user_id",
      message: error.message,
    });
  }

  return data ? (data as StaffRow) : null;
}

async function staffByEmail(email: string): Promise<StaffRow | null> {
  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id,name,role,email,user_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(502, "Supabase request failed", {
      lookup: "staff.email",
      message: error.message,
    });
  }

  return data ? (data as StaffRow) : null;
}

function bearerToken(auth: string): string {
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function header(headers: Record<string, HeaderValue>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
