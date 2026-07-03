// Non-fatal access-sync entry point for PORTAL actions (offer tie-in step F).
//
// The webhook path (api/stripe/webhook.js) returns 5xx on ON-mode failures so
// Stripe retries. Portal/staff/cron actions have no retry machinery - a sync
// failure here must never block the staff action, so this wrapper is
// best-effort: it audits the outcome (or the error) to member_audit_log and
// always returns. Convergence safety net: the member's next Stripe event
// re-runs the same idempotent sync.

import { getAccessSyncMode, syncAccessForMember, type AccessSyncArgs, type AccessSyncOutcome } from "./access-sync.js";
import { createRuntimeSupabaseClient } from "./supabase.js";

export async function syncMemberAccessNonFatal(args: AccessSyncArgs): Promise<AccessSyncOutcome | null> {
  let mode = "off";
  try {
    const supabase = createRuntimeSupabaseClient();
    mode = await getAccessSyncMode(supabase, args.clientId);
    if (mode === "off") return null;
    const outcome = await syncAccessForMember(supabase, args, { dryRun: mode === "shadow" });
    await supabase.from("member_audit_log").insert({
      client_id: args.clientId,
      member_id: args.memberId,
      action_type: `access-sync-${mode}`,
      args: outcome,
    });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[access-sync] portal sync (${mode}) failed for member ${args.memberId}:`, message);
    try {
      const supabase = createRuntimeSupabaseClient();
      await supabase.from("member_audit_log").insert({
        client_id: args.clientId,
        member_id: args.memberId,
        action_type: "access-sync-error",
        args: { reason: args.reason, mode, error: message },
      });
    } catch { /* audit is best-effort too */ }
    return null;
  }
}
