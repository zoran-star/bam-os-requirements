import { withSentryApiRoute } from "../_sentry.js";
import { decorateMembershipsWithEntitlements } from "./_entitlements.js";
import { HttpError, sendError } from "./_errors.js";
import {
  getParentReadContext,
  membershipsForStudent,
  type ParentReadMembership,
} from "./_parent-context.js";
import { queryParam } from "./_schedule.js";
import { inList, sb } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

type ClientRow = {
  id: string;
  business_name: string | null;
};

type StudentMembershipBase = ParentReadMembership & {
  academy_name: string;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const studentId = queryParam(req, "student_id");
    if (!studentId) {
      throw new HttpError(400, "Missing student id.");
    }

    const context = await getParentReadContext(req);
    const memberships = membershipsForStudent(context, studentId);
    const academyNames = await getAcademyNames(
      [...new Set(memberships.map((membership) => membership.academy_id))],
    );
    const baseMemberships = memberships.map((membership) => ({
      ...membership,
      academy_name: academyNames.get(membership.academy_id) || "Academy",
    }));
    const entitledMemberships =
      await decorateMembershipsWithEntitlements<StudentMembershipBase>(baseMemberships);
    const entitlements = entitledMemberships.flatMap((membership) => membership.entitlements);

    return res.status(200).json({
      student_id: studentId,
      memberships: entitledMemberships,
      entitlements,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function getAcademyNames(academyIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (academyIds.length === 0) return names;

  const rows = await sb<ClientRow[]>(
    `clients?id=in.(${inList(academyIds)})&select=id,business_name`,
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    names.set(row.id, row.business_name || "Academy");
  }

  return names;
}

export default withSentryApiRoute(handler);
