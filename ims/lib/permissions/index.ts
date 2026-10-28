/**
 * The single permission helper (IMS_BUILD_PLAN Phase 1, spec §5 and §16).
 * Every API route and server service calls requireAccess() before reading or
 * changing data. Hidden buttons are never the security control.
 *
 * Pure functions only: no database, no request objects. The caller loads the
 * user (with effective locations) once per request and passes it in.
 */
import { ApiError, errors } from "@/lib/api/errors";

export type Role = "ADMIN" | "SUPERVISOR" | "FIELD";
export type LocationAccess = "FULL" | "VIEW_ONLY";

export type AccessUser = {
  id: string;
  role: Role;
  status: "ACTIVE" | "INACTIVE";
  /** Effective locations: direct assignments plus their child locations. */
  locations: { id: string; access: LocationAccess }[];
};

/** Rule for one role and one action. */
type Rule =
  | "none" // never
  | "global" // everywhere
  | "assigned" // only at the user's assigned locations
  | "own"; // only the user's own work, at assigned locations

type ActionDef = {
  /** Writes need FULL access at the location; reads accept VIEW_ONLY. */
  write: boolean;
  label: string;
  rules: Record<Role, Rule>;
};

const ACTION_DEFS = {
  "settings.manage": {
    write: true,
    label: "manage users and settings",
    rules: { ADMIN: "global", SUPERVISOR: "none", FIELD: "none" },
  },
  "masterData.manage": {
    write: true,
    label: "change item and asset records",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "none" },
  },
  "locations.manage": {
    write: true,
    label: "change locations",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "none" },
  },
  "locations.view": {
    write: false,
    label: "view this location",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "assigned" },
  },
  "records.view": {
    write: false,
    label: "view these records",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "assigned" },
  },
  "counts.create": {
    write: true,
    label: "create count sessions",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "none" },
  },
  "counts.perform": {
    write: true,
    label: "count at this location",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "assigned" },
  },
  "counts.submit": {
    write: true,
    label: "submit counts here",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "assigned" },
  },
  "counts.approve": {
    write: true,
    label: "approve count adjustments",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "none" },
  },
  "stock.move": {
    write: true,
    label: "receive, issue, or transfer stock",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "none" },
  },
  "drafts.prepare": {
    write: true,
    label: "prepare borrowing or handover drafts",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "assigned" },
  },
  "custody.confirm": {
    write: true,
    label: "confirm releases and returns",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "none" },
  },
  "documents.download": {
    write: false,
    label: "download this document",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "own" },
  },
  "reports.view": {
    write: false,
    label: "view reports and audit history",
    rules: { ADMIN: "global", SUPERVISOR: "assigned", FIELD: "own" },
  },
} as const satisfies Record<string, ActionDef>;

export type Action = keyof typeof ACTION_DEFS;
export const ACTIONS = Object.keys(ACTION_DEFS) as Action[];

export type AccessScope =
  { scope: "global" } | { scope: "assigned"; locationIds: string[] } | { scope: "own"; locationIds: string[] };

function usableLocationIds(user: AccessUser, write: boolean): string[] {
  return user.locations.filter((l) => !write || l.access === "FULL").map((l) => l.id);
}

/**
 * Throws ApiError (401/403) unless `user` may perform `action`, optionally at
 * `locationId`. Returns the scope to apply to list queries:
 * - global: no location filter
 * - assigned: filter by locationIds
 * - own: filter by locationIds AND the user's own records
 */
export function requireAccess(user: AccessUser, action: Action, locationId?: string): AccessScope {
  if (user.status !== "ACTIVE") throw errors.inactive();

  const def: ActionDef = ACTION_DEFS[action];
  const rule = def.rules[user.role];

  if (rule === "none") throw errors.forbidden(def.label);
  if (rule === "global") return { scope: "global" };

  const locationIds = usableLocationIds(user, def.write);
  if (locationId !== undefined) {
    if (!locationIds.includes(locationId)) throw errors.forbidden(def.label);
  } else if (locationIds.length === 0) {
    throw errors.forbidden(def.label);
  }
  return { scope: rule, locationIds };
}

/** Boolean form for UI decisions (menus, buttons). The API still calls requireAccess. */
export function can(user: AccessUser, action: Action, locationId?: string): boolean {
  try {
    requireAccess(user, action, locationId);
    return true;
  } catch (e) {
    if (e instanceof ApiError) return false;
    throw e;
  }
}
