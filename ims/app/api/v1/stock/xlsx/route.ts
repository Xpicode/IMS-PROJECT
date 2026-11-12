import { route } from "@/lib/api/route";
import { listItems } from "@/lib/inventory/items";
import { requireAccess } from "@/lib/permissions";
import { uuid } from "@/lib/validation";
import { toXlsx } from "@/lib/xlsx";
import { company } from "@/lib/documents/service";
import { formatDateTime } from "@/lib/format";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";

/** Item totals, including what is on loan and zero-balance items, exactly as on Stock. */
export const GET = route({ auth: true }, async ({ req, user, ctx }) => {
  requireAccess(user, "masterData.manage");
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim().slice(0, 100) || undefined;
  const category = sp.get("category") ?? undefined;
  const categoryId = uuid.safeParse(category).success ? category : undefined;
  const level = sp.get("stock");
  const stock: "low" | "out" | undefined = level === "low" || level === "out" ? level : undefined;
  const filters = { q, categoryId, stock };
  const limit = 50_000;
  const rows = [];
  let total = 0;
  for (let page = 1; rows.length < limit; page++) {
    const result = await listItems(user, { ...filters, page, pageSize: 1000 });
    total = result.total;
    rows.push(...result.rows.slice(0, limit - rows.length));
    if (page >= result.pageCount) break;
  }
  const truncated = total > rows.length;
  const active = [
    ...(q ? [`Search: ${q}`] : []),
    ...(categoryId ? [`Category ID: ${categoryId}`] : []),
    ...(stock ? [`Stock level: ${stock === "low" ? "Low only" : "Out only"}`] : []),
  ];
  const workbook = toXlsx(
    "Stock",
    ["SKU", "Item", "Category", "Unit", "On hand", "On loan", "Low at", "Status"],
    rows.map((r) => [
      r.sku,
      r.name,
      r.categoryName ?? "",
      r.unitCode,
      r.onHand,
      r.onLoan,
      r.minStock,
      r.stockStatus ?? "",
    ]),
    [undefined, undefined, undefined, undefined, "integer", "integer", "integer"],
    {
      company: company().name,
      title: "Stock",
      details: [
        `Exported: ${formatDateTime(new Date())} (${process.env.NEXT_PUBLIC_COMPANY_TIMEZONE || "Asia/Manila"})`,
        `Active filters: ${active.length ? active.join("; ") : "None (all my locations)"}`,
        `Exported rows: ${rows.length}`,
        ...(truncated ? [`Matching total: ${total} (truncated; export limit: 50,000 rows)`] : []),
      ],
    },
  );
  await writeAudit(prisma, {
    actorId: user.id,
    eventType: "report.exported",
    recordType: "report",
    recordId: "stock",
    after: { format: "xlsx", filters, rows: rows.length, truncated },
    requestId: ctx.requestId,
  });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return new Response(new Uint8Array(workbook), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="ims-stock-${today}.xlsx"`,
      "x-content-type-options": "nosniff",
      "x-export-total": String(total),
      "x-export-truncated": String(truncated),
    },
  });
});
