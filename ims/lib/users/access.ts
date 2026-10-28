import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { AccessUser, LocationAccess } from "@/lib/permissions";

export type CurrentUser = AccessUser & { name: string; email: string };

/**
 * Load a user with *effective* locations: each direct assignment plus every
 * descendant location (rack/area under a warehouse). If a location is reached
 * twice, the stronger access wins (FULL over VIEW_ONLY).
 */
export async function loadAccessUser(userId: string): Promise<CurrentUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      locations: { select: { locationId: true, access: true } },
    },
  });
  if (!user) return null;

  const effective = new Map<string, LocationAccess>();
  if (user.locations.length > 0) {
    const all = await prisma.location.findMany({ select: { id: true, parentId: true } });
    const children = new Map<string, string[]>();
    for (const l of all) {
      if (!l.parentId) continue;
      children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
    }
    const grant = (id: string, access: LocationAccess) => {
      if (effective.get(id) === "FULL") return;
      effective.set(id, access);
    };
    for (const a of user.locations) {
      const stack = [a.locationId];
      const seen = new Set<string>();
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        grant(id, a.access);
        stack.push(...(children.get(id) ?? []));
      }
    }
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    locations: [...effective].map(([id, access]) => ({ id, access })),
  };
}
