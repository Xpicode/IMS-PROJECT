import { route } from "@/lib/api/route";
import { listItems } from "@/lib/inventory/items";
import { requireAccess } from "@/lib/permissions";
import { toCsv } from "@/lib/csv";
import { toXlsx } from "@/lib/xlsx";
import { IMPORT_COLUMNS } from "@/lib/inventory/import";
import { prisma } from "@/lib/db/prisma";
import { company } from "@/lib/documents/service";
import { formatDateTime } from "@/lib/format";

/**
 * The same columns as the import template, plus on-hand totals. CSV by default
 * (formula-safe, §9.5); ?format=xlsx gives a formatted Excel file to read.
 */
export const GET = route({ auth: true }, async ({ req, user }) => {
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
  const header = [...IMPORT_COLUMNS, "on_hand", "active"];
  const table = rows.map((r) => [
    r.sku,
    r.name,
    r.categoryName ?? "",
    r.unitCode,
    r.minStock,
    byId.get(r.id)?.description ?? "",
    byId.get(r.id)?.identifiers[0]?.code ?? "",
    r.onHand,
    r.isActive ? "yes" : "no",
  ]);
  const date = new Date().toISOString().slice(0, 10);
  if (new URL(req.url).searchParams.get("format") === "xlsx") {
    const workbook = toXlsx(
      "Items",
      header,
      table,
      ["text", undefined, undefined, undefined, "integer", undefined, "text", "integer"],
      {
        company: company().name,
        title: "Items",
        details: [
          `Exported: ${formatDateTime(new Date())} (${process.env.NEXT_PUBLIC_COMPANY_TIMEZONE || "Asia/Manila"})`,
          "Active filters: None (including inactive items)",
          `Exported rows: ${rows.length}`,
        ],
      },
    );
    return new Response(new Uint8Array(workbook), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="ims-items-${date}.xlsx"`,
      },
    });
  }
  const csv = toCsv([header, ...table]);
  return new Response("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ims-items-${date}.csv"`,
    },
  });
});
