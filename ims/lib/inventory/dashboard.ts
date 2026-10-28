import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { listItems, scopeLocations } from "./items";

/** Dashboard v1 numbers, limited to the user's locations. */
export async function dashboardData(actor: AccessUser) {
  const scope = requireAccess(actor, "records.view");
  const locs = scopeLocations(scope);
  const assetWhere = locs ? { locationId: { in: locs } } : {};
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [all, low, out, assets, moves, lowList] = await Promise.all([
    listItems(actor, { pageSize: 1 }),
    listItems(actor, { stock: "low", pageSize: 1 }),
    listItems(actor, { stock: "out", pageSize: 1 }),
    prisma.asset.groupBy({ by: ["status"], where: assetWhere, _count: true }),
    prisma.stockTransaction.count({
      where: { confirmedAt: { gte: since }, ...(locs ? { movements: { some: { locationId: { in: locs } } } } : {}) },
    }),
    Promise.all([listItems(actor, { stock: "out", pageSize: 10 }), listItems(actor, { stock: "low", pageSize: 10 })]),
  ]);
  const byStatus = Object.fromEntries(assets.map((a) => [a.status, a._count])) as Record<string, number>;
  return {
    items: all.total,
    low: low.total,
    out: out.total,
    assetsTotal: assets.reduce((s, a) => s + (a.status === "RETIRED" ? 0 : a._count), 0),
    borrowed: byStatus.BORROWED ?? 0,
    needsReview: (byStatus.NEEDS_REVIEW ?? 0) + (byStatus.LOST ?? 0),
    movesThisWeek: moves,
    attention: [...lowList[0].rows, ...lowList[1].rows].slice(0, 10),
  };
}
