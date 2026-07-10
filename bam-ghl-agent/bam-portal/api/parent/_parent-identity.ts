import { createHash } from "node:crypto";

import { HttpError } from "./_errors.js";
import {
  eq,
  sb,
  updateSupabaseUserAppMetadata,
  type SupabaseUser,
} from "./_supabase.js";

export const MISSING_CUSTOMER_PROFILE_MESSAGE =
  "No customer profile found. Please register to continue.";

const PROFILE_SELECT =
  "id,supabase_user_id,first_name,last_name,email,phone,profile_type,created_at,updated_at";

export type ParentIdentityProfile = {
  id: string;
  supabase_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_type: "PARENT" | "STUDENT";
  created_at: string;
  updated_at: string;
};

export type CreateParentProfileInput = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  profile_type?: "PARENT" | "STUDENT";
};

export type ParentIdentityResolution = {
  profile: ParentIdentityProfile;
  created: boolean;
  claimed: boolean;
};

export async function resolveParentIdentityForUser(
  user: SupabaseUser,
  createInput?: CreateParentProfileInput,
): Promise<ParentIdentityResolution> {
  const linkedProfile = await findProfileBySupabaseUserId(user.id);
  if (linkedProfile) {
    requireParentProfile(linkedProfile);
    await ensureParentRole(user);
    return { profile: linkedProfile, created: false, claimed: false };
  }

  const verifiedEmail = getVerifiedAuthEmail(user);
  const emailProfile = await findProfileByNormalizedEmail(verifiedEmail);
  if (emailProfile) {
    requireParentProfile(emailProfile);
    if (emailProfile.supabase_user_id && emailProfile.supabase_user_id !== user.id) {
      throw new HttpError(
        409,
        "This parent profile has already been claimed by another account.",
      );
    }

    const profile = emailProfile.supabase_user_id
      ? emailProfile
      : await claimProfile(emailProfile, user.id);
    await ensureParentRole(user);
    return { profile, created: false, claimed: !emailProfile.supabase_user_id };
  }

  if (!createInput) {
    throw new HttpError(403, MISSING_CUSTOMER_PROFILE_MESSAGE, MISSING_CUSTOMER_PROFILE_MESSAGE);
  }

  const profile = await createParentProfile(user, verifiedEmail, createInput);
  await ensureParentRole(user);
  return { profile, created: true, claimed: false };
}

export function getVerifiedAuthEmail(user: SupabaseUser): string {
  const email = normalizeEmail(user.email ?? "");
  if (!email || !user.email_confirmed_at) {
    throw new HttpError(403, "A verified email address is required.");
  }
  return email;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function findProfileBySupabaseUserId(
  userId: string,
): Promise<ParentIdentityProfile | null> {
  const rows = await sb<ParentIdentityProfile[]>(
    `customer_profiles?supabase_user_id=eq.${eq(userId)}` +
      `&select=${PROFILE_SELECT}` +
      "&limit=1",
  );
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

async function findProfileByNormalizedEmail(
  normalizedEmail: string,
): Promise<ParentIdentityProfile | null> {
  const rows = await sb<ParentIdentityProfile[]>(
    `customer_profiles?email=ilike.${eq(normalizedEmail)}` + `&select=${PROFILE_SELECT}`,
  );
  const matches = (Array.isArray(rows) ? rows : []).filter(
    (profile) => normalizeEmail(profile.email) === normalizedEmail,
  );

  if (matches.length > 1) {
    throw new HttpError(409, "Multiple parent profiles match this email. Contact your academy.");
  }
  return matches[0] ?? null;
}

async function claimProfile(
  profile: ParentIdentityProfile,
  userId: string,
): Promise<ParentIdentityProfile> {
  const now = new Date().toISOString();

  try {
    const rows = await sb<ParentIdentityProfile[]>(
      `customer_profiles?id=eq.${eq(profile.id)}` +
        "&supabase_user_id=is.null" +
        `&select=${PROFILE_SELECT}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          supabase_user_id: userId,
          claimed_at: now,
          updated_at: now,
        }),
      },
    );
    const claimed = Array.isArray(rows) ? rows[0] : null;
    if (claimed) return claimed;
  } catch (error) {
    if (!isSupabaseConflict(error)) throw error;
    // A concurrent claimant can trip a uniqueness constraint. Re-read below
    // so the caller gets the stable same-user or foreign-claim outcome.
  }

  const current = await findProfileById(profile.id);
  if (current?.supabase_user_id === userId) return current;
  if (current?.supabase_user_id) {
    throw new HttpError(
      409,
      "This parent profile has already been claimed by another account.",
    );
  }
  throw new HttpError(409, "This parent profile could not be claimed. Please try again.");
}

async function createParentProfile(
  user: SupabaseUser,
  verifiedEmail: string,
  input: CreateParentProfileInput,
): Promise<ParentIdentityProfile> {
  if (input.profile_type && input.profile_type !== "PARENT") {
    throw new HttpError(400, "Only parent profiles can be registered here.");
  }

  const requestEmail = normalizeEmail(input.email ?? verifiedEmail);
  if (requestEmail !== verifiedEmail) {
    throw new HttpError(400, "Profile email must match the verified sign-in email.");
  }

  const firstName = requiredName(input.first_name, "first_name");
  const lastName = requiredName(input.last_name, "last_name");
  const phone = optionalPhone(input.phone);

  try {
    const rows = await sb<ParentIdentityProfile[]>(
      `customer_profiles?select=${PROFILE_SELECT}`,
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id: stableUuid(["parent-profile", user.id].join("\0")),
          supabase_user_id: user.id,
          first_name: firstName,
          last_name: lastName,
          email: verifiedEmail,
          phone,
          profile_type: "PARENT",
          claimed_at: new Date().toISOString(),
        }),
      },
    );
    const created = Array.isArray(rows) ? rows[0] : null;
    if (!created) throw new HttpError(502, "Parent profile creation failed.");
    return created;
  } catch (error) {
    const linked = await findProfileBySupabaseUserId(user.id);
    if (linked) return linked;

    const emailProfile = await findProfileByNormalizedEmail(verifiedEmail);
    if (emailProfile?.supabase_user_id === user.id) return emailProfile;
    if (emailProfile?.supabase_user_id) {
      throw new HttpError(
        409,
        "This parent profile has already been claimed by another account.",
      );
    }
    throw error;
  }
}

async function findProfileById(profileId: string): Promise<ParentIdentityProfile | null> {
  const rows = await sb<ParentIdentityProfile[]>(
    `customer_profiles?id=eq.${eq(profileId)}` + `&select=${PROFILE_SELECT}` + "&limit=1",
  );
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

async function ensureParentRole(user: SupabaseUser): Promise<void> {
  if (user.app_metadata?.role === "parent") return;
  const updated = await updateSupabaseUserAppMetadata(user, { role: "parent" });
  user.app_metadata = updated.app_metadata;
}

function requireParentProfile(profile: ParentIdentityProfile): void {
  if (profile.profile_type !== "PARENT") {
    throw new HttpError(409, "The matching profile is not a parent profile.");
  }
}

function requiredName(value: string | undefined, fieldName: string): string {
  const normalized = collapseWhitespace(value ?? "");
  if (!normalized) {
    throw new HttpError(400, `Missing required body field: ${fieldName}.`);
  }
  if (normalized.length > 255) {
    throw new HttpError(400, `Body field ${fieldName} is too long.`);
  }
  return normalized;
}

function optionalPhone(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "Invalid body field: phone.");
  const normalized = collapseWhitespace(value);
  if (normalized.length > 50) throw new HttpError(400, "Body field phone is too long.");
  return normalized || null;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function isSupabaseConflict(error: unknown): boolean {
  if (!(error instanceof HttpError) || !error.detail || typeof error.detail !== "object") {
    return false;
  }
  const detail = error.detail as { body?: unknown; status?: unknown };
  return detail.status === 409 || String(detail.body ?? "").includes("duplicate key");
}
