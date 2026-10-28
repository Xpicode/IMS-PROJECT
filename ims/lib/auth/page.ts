import "server-only";
import { requireUser } from "./current-user";
import { can, type Action } from "@/lib/permissions";

/**
 * For pages: the signed-in user plus whether they may see this page.
 * Pages render <NoAccess/> when `allowed` is false. The API still enforces
 * every rule; this only decides what to show.
 */
export async function pageAccess(action?: Action) {
  const user = await requireUser();
  return { user, allowed: action ? can(user, action) : true };
}

export const ROLE_LABEL = { ADMIN: "Administrator", SUPERVISOR: "Supervisor", FIELD: "Field staff" } as const;
