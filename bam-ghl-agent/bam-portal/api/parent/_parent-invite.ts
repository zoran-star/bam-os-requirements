import { createHash } from "node:crypto";

import { HttpError } from "./_errors.js";
import { normalizeEmail, type ParentIdentityProfile } from "./_parent-identity.js";
import {
  createParentInviteToken,
  parseParentInviteToken,
  type ParentInviteTokenPayload,
} from "./_parent-invite-token.js";
import { eq, sb } from "./_supabase.js";

const INVALID_INVITE_MESSAGE = "This academy invite is invalid or has expired.";
const MEMBERSHIP_SELECT =
  "id,academy_id,customer_id,student_id,status,joined_at,plan_id,stripe_customer_id,ghl_contact_id";

type AcademyRow = {
  id: string;
  business_name: string | null;
  status: string | null;
};

type ContactRow = {
  id: string;
  client_id: string;
  email: string | null;
  ghl_contact_id: string | null;
};

type OpportunityRow = {
  id: string;
  client_id: string;
  contact_id: string | null;
  ghl_contact_id: string | null;
};

export type ParentInviteContext = {
  payload: ParentInviteTokenPayload;
  academy: AcademyRow;
  contact: ContactRow;
  opportunity: OpportunityRow;
};

export type ParentInviteMembership = {
  id: string;
  academy_id: string;
  customer_id: string | null;
  student_id: string | null;
  status: "ACTIVE" | "SUSPENDED" | "CANCELLED";
  joined_at: string;
  plan_id: string | null;
  stripe_customer_id: string | null;
  ghl_contact_id: string | null;
};

export async function issueParentInvite(input: {
  academyId: string;
  contactId: string;
  opportunityId: string;
  expiresAt: Date;
}): Promise<{
  token: string;
  expires_at: string;
  academy_id: string;
  academy_name: string;
  email: string;
}> {
  const context = await getSalesContext(
    input.academyId,
    input.contactId,
    input.opportunityId,
  );
  const email = normalizeEmail(context.contact.email ?? "");
  if (!email) throw new HttpError(422, "The selected contact has no email address.");

  const { token } = createParentInviteToken({
    academy_id: context.academy.id,
    contact_id: context.contact.id,
    opportunity_id: context.opportunity.id,
    email,
    expires_at: input.expiresAt,
  });
  return {
    token,
    expires_at: input.expiresAt.toISOString(),
    academy_id: context.academy.id,
    academy_name: context.academy.business_name || "Academy",
    email,
  };
}

export async function resolveParentInvite(
  token: string,
  expectedEmail?: string,
): Promise<ParentInviteContext> {
  const payload = parseParentInviteToken(token);
  if (expectedEmail && payload.email !== normalizeEmail(expectedEmail)) {
    throw new HttpError(403, "This academy invite was sent to a different email address.");
  }

  const context = await getSalesContext(
    payload.academy_id,
    payload.contact_id,
    payload.opportunity_id,
  );
  if (normalizeEmail(context.contact.email ?? "") !== payload.email) {
    throw new HttpError(400, INVALID_INVITE_MESSAGE);
  }
  return { ...context, payload };
}

export async function attachParentToAcademy(
  profile: ParentIdentityProfile,
  invite: ParentInviteContext,
): Promise<{ membership: ParentInviteMembership; attached: boolean }> {
  const existing = await getProfileMembership(profile.id, invite.academy.id);
  if (existing) {
    // A parent-level row is the academy-access principal for an invited family.
    // Keep it non-bookable until a paid membership activates it; never downgrade
    // an already-active paid row when the same parent follows another invite.
    const status = existing.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED";
    if (
      existing.status === status &&
      (!invite.contact.ghl_contact_id || existing.ghl_contact_id === invite.contact.ghl_contact_id)
    ) {
      return { membership: existing, attached: false };
    }

    const rows = await sb<ParentInviteMembership[]>(
      `academy_memberships?id=eq.${eq(existing.id)}&select=${MEMBERSHIP_SELECT}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status,
          ghl_contact_id: invite.contact.ghl_contact_id ?? existing.ghl_contact_id,
        }),
      },
    );
    const updated = Array.isArray(rows) ? rows[0] : null;
    if (!updated) throw new HttpError(502, "Academy attachment failed.");
    return { membership: updated, attached: true };
  }

  try {
    const rows = await sb<ParentInviteMembership[]>(
      `academy_memberships?select=${MEMBERSHIP_SELECT}`,
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id: stableUuid(["parent-academy", profile.id, invite.academy.id].join("\0")),
          academy_id: invite.academy.id,
          customer_id: profile.id,
          student_id: null,
          status: "SUSPENDED",
          ghl_contact_id: invite.contact.ghl_contact_id,
        }),
      },
    );
    const membership = Array.isArray(rows) ? rows[0] : null;
    if (!membership) throw new HttpError(502, "Academy attachment failed.");
    return { membership, attached: true };
  } catch (error) {
    const raced = await getProfileMembership(profile.id, invite.academy.id);
    if (raced) return { membership: raced, attached: false };
    throw error;
  }
}

async function getSalesContext(
  academyId: string,
  contactId: string,
  opportunityId: string,
): Promise<Omit<ParentInviteContext, "payload">> {
  const [academyRows, contactRows, opportunityRows] = await Promise.all([
    sb<AcademyRow[]>(
      `clients?id=eq.${eq(academyId)}&status=eq.active&select=id,business_name,status&limit=1`,
    ),
    sb<ContactRow[]>(
      `contacts?id=eq.${eq(contactId)}&client_id=eq.${eq(academyId)}` +
        "&select=id,client_id,email,ghl_contact_id&limit=1",
    ),
    sb<OpportunityRow[]>(
      `opportunities?id=eq.${eq(opportunityId)}&client_id=eq.${eq(academyId)}` +
        "&select=id,client_id,contact_id,ghl_contact_id&limit=1",
    ),
  ]);

  const academy = Array.isArray(academyRows) ? academyRows[0] : null;
  const contact = Array.isArray(contactRows) ? contactRows[0] : null;
  const opportunity = Array.isArray(opportunityRows) ? opportunityRows[0] : null;
  if (!academy || !contact || !opportunity) {
    throw new HttpError(400, INVALID_INVITE_MESSAGE);
  }
  const opportunityMatchesContact =
    opportunity.contact_id === contact.id ||
    (Boolean(contact.ghl_contact_id) && opportunity.ghl_contact_id === contact.ghl_contact_id);
  if (!opportunityMatchesContact) {
    throw new HttpError(400, INVALID_INVITE_MESSAGE);
  }

  return { academy, contact, opportunity };
}

async function getProfileMembership(
  profileId: string,
  academyId: string,
): Promise<ParentInviteMembership | null> {
  const rows = await sb<ParentInviteMembership[]>(
    `academy_memberships?academy_id=eq.${eq(academyId)}` +
      `&customer_id=eq.${eq(profileId)}` +
      `&select=${MEMBERSHIP_SELECT}` +
      "&limit=1",
  );
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
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
