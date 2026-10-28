import { json, route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { ACTIONS, can } from "@/lib/permissions";

/** Current user, role, authorized locations, and what the UI may offer. */
export const GET = route({ auth: true }, async ({ user }) => {
  const locations = await prisma.location.findMany({
    where: { id: { in: user.locations.map((l) => l.id) } },
    select: { id: true, code: true, name: true, type: true, parentId: true, isActive: true },
    orderBy: { code: "asc" },
  });
  const accessById = new Map(user.locations.map((l) => [l.id, l.access]));
  return json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    locations: user.role === "ADMIN" ? "ALL" : locations.map((l) => ({ ...l, access: accessById.get(l.id) })),
    permissions: Object.fromEntries(ACTIONS.map((a) => [a, can(user, a)])),
  });
});
