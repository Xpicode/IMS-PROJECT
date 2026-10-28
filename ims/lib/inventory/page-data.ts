import "server-only";
import { prisma } from "@/lib/db/prisma";
import { can, type AccessUser, type Action } from "@/lib/permissions";

/** Active locations where `user` may do `action` (for pickers). */
export async function locationsFor(user: AccessUser, action: Action) {
  const all = await prisma.location.findMany({
    where: { isActive: true, ...(user.role === "ADMIN" ? {} : { id: { in: user.locations.map((l) => l.id) } }) },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  return all.filter((l) => can(user, action, l.id));
}

export const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
