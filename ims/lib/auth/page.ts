import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "./current-user";
import { can, type Action } from "@/lib/permissions";

/**
 * For pages: the signed-in user plus whether they may see this page.
 * Pages render <NoAccess/> when `allowed` is false. The API still enforces
 * every rule; this only decides what to show.
 *
 * Field staff work in the offline field app, so every office page sends them
 * there (`fieldHome` picks the view) instead of showing a page they can't use.
 */
export async function pageAccess(action?: Action, fieldHome = "/field") {
  const user = await requireUser();
  if (user.role === "FIELD") redirect(fieldHome);
  return { user, allowed: action ? can(user, action) : true };
}

export const ROLE_LABEL = { ADMIN: "Administrator", SUPERVISOR: "Supervisor", FIELD: "Field staff" } as const;
