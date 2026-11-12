import { route } from "@/lib/api/route";
import { errors } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { toXlsx } from "@/lib/xlsx";
import { filtersFrom, isReportName, REPORTS, reportExportMetadata, runReport } from "@/lib/reports/service";

/** Same scoped rows and export bound as CSV, independent of the screen's page. */
export const GET = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const name = String(params.name ?? "");
  if (!isReportName(name)) throw errors.notFound("report");
  const filters = filtersFrom(new URL(req.url).searchParams);
  const r = await runReport(user, name, filters, { limit: 50_000, excel: true });
  const workbook = toXlsx(
    REPORTS[name].title,
    r.columns.map((c) => c.label),
    r.rows.map((row) => r.columns.map((c) => row[c.key])),
    r.columns.map((c) => c.format ?? (c.align === "right" ? (c.key === "quantity" ? "signed" : "integer") : undefined)),
    await reportExportMetadata(user, name, filters, r),
  );
  await writeAudit(prisma, {
    actorId: user.id,
    eventType: "report.exported",
    recordType: "report",
    recordId: name,
    after: { format: "xlsx", filters, rows: r.rows.length, truncated: r.truncated },
    requestId: ctx.requestId,
  });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return new Response(new Uint8Array(workbook), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}-${today}.xlsx"`,
      "x-content-type-options": "nosniff",
      "x-export-total": String(r.total),
      "x-export-truncated": String(r.truncated),
    },
  });
});
