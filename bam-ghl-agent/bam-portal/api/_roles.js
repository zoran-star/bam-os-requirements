// Canonical staff role sets — the single source of truth for API role gating.
//
// Before this module, the same role groups were re-declared (and drifted) across
// clients.js / marketing.js / tickets.js. Import from here instead of re-typing a
// `new Set([...])`. The frontend mirrors these as `canSee*` flags in App.jsx — keep
// the two in sync when roles change.
//
// Known staff roles: admin, scaling_manager, marketing_manager, marketing_executor,
// systems_manager, systems_executor, systems (legacy/extra — gateable but NOT assignable).

// Admin only.
export const ADMIN_ROLES = new Set(["admin"]);

// Full-power: admin + scaling_manager.
export const ADMIN_LIKE_ROLES = new Set(["admin", "scaling_manager"]);

// Marketing/content write, ADMIN_LIKE included.
export const MARKETING_ROLES = new Set([
  "admin", "scaling_manager", "marketing_manager", "marketing_executor",
]);

// Marketing OPS (guide cards + Meta ops). NOTE: intentionally NO scaling_manager —
// this matches the original marketing.js GUIDE_WRITE_ROLES / META_OPS_ROLES.
export const MARKETING_OPS_ROLES = new Set([
  "admin", "marketing_manager", "marketing_executor",
]);

// Systems side (build/tickets).
export const SYSTEMS_ROLES = new Set([
  "admin", "scaling_manager", "systems_manager", "systems_executor", "systems",
]);

// Systems manager-level (approve/assign).
export const SYSTEMS_MANAGER_ROLES = new Set([
  "admin", "scaling_manager", "systems_manager",
]);

// Any authenticated staff (has a row in `staff`). Includes legacy "systems".
export const ANY_STAFF_ROLES = new Set([
  "admin", "scaling_manager", "marketing_manager", "marketing_executor",
  "systems_manager", "systems_executor", "systems",
]);

// Roles that may be ASSIGNED when creating/updating a staff member. Excludes the
// legacy "systems" role on purpose (it exists in data but isn't offered in the UI).
export const ASSIGNABLE_STAFF_ROLES = new Set([
  "admin", "scaling_manager", "marketing_manager", "marketing_executor",
  "systems_manager", "systems_executor",
]);

// Convenience: is `role` in `set`? (null/undefined-safe)
export function hasRole(role, set) {
  return !!role && set.has(role);
}
