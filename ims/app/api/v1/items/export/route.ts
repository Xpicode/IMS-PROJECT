import { route } from "@/lib/api/route";
import { listItems } from "@/lib/inventory/items";
import { requireAccess } from "@/lib/permissions";
import { toCsv } from "@/lib/csv";
import { IMPORT_COLUMNS } from "@/lib/inventory/import";
import { prisma } from "@/lib/db/prisma";

/** CSV in the same columns as the import template, plus on-hand totals. Formula-safe (§9.5). */
export const GET = route({ auth: true }, async ({ user }) => {
  requireAccess(user, "masterData.manage");
  const rows = [];
  for (let page = 1; ; page++) {
    const r = await listItems(user, { includeInactive: true, page, pageSize: 100 });
    rows.push(...r.rows);
    if (page >= r.pageCount) break;
  }
  const extra = await prisma.item.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: {
      id: true,
      description: true,
      identifiers: { where: { isActive: true, namespace: "MFR" }, select: { code: true }, take: 1 },
    },
  });
  const byId = new Map(extra.map((e) => [e.id, e]));
  const csv = toCsv([
    [...IMPORT_COLUMNS, "on_hand", "active"],
    ...rows.map((r) => [
      r.sku,
      r.name,
      r.categoryName ?? "",
      r.unitCode,
      r.trackingType,
      r.minStock,
      byId.get(r.id)?.description ?? "",
      byId.get(r.id)?.identifiers[0]?.code ?? "",
      r.trackingType === "STOCK" ? r.onHand : r.assetCount,
      r.isActive ? "yes" : "no",
    ]),
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return new Response("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ims-items-${date}.csv"`,
    },
  });
});
