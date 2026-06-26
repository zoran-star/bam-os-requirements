import { withSentryApiRoute } from "../_sentry.js";
import {
  decorateMembershipsWithEntitlements,
  type CustomerEntitlementOut,
  type MembershipCreditSummaryOut,
} from "./_entitlements.js";
import { sendError } from "./_errors.js";
import {
  getParentReadContext,
  partitionMemberships,
  type ParentReadMembership,
} from "./_parent-context.js";
import { inList, sb } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

type ClientRow = {
  id: string;
  business_name: string | null;
};

type ParentMembershipOut = ParentReadMembership & {
  academy_name: string;
  credit_summary: MembershipCreditSummaryOut;
  entitlements: CustomerEntitlementOut[];
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentReadContext(req);
    const academyNames = await getAcademyNames(context.academyIds);
    const baseMemberships = context.memberships.map((membership) => ({
      ...membership,
      academy_name: academyNames.get(membership.academy_id) || "Academy",
    }));
    const memberships = await decorateMembershipsWithEntitlements(baseMemberships);

    return res.status(200).json(partitionMemberships<ParentMembershipOut>(memberships));
  } catch (error) {
    return sendError(res, error);
  }
}

async function getAcademyNames(academyIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (academyIds.length === 0) return names;

  const rows = await sb<ClientRow[]>(`clients?id=in.(${inList(academyIds)})&select=id,business_name`);
  for (const row of Array.isArray(rows) ? rows : []) {
    names.set(row.id, row.business_name || "Academy");
  }
  return names;
}

export default withSentryApiRoute(handler);
