import { route } from "@/lib/api/route";
import { errors } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/reports/csv";
import { filtersFrom, isReportName, runReport } from "@/lib/reports/service";

/** GET → the report as CSV (same filters as the screen; up to 50,000 rows). Audited. */
export const GET = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const name = String((await params).name ?? "");
  if (!isReportName(name)) throw errors.notFound("report");
  const filters = filtersFrom(new URL(req.url).searchParams);
  const r = await runReport(user, name, filters, { limit: 50_000 });
  const csv = toCsv(
    r.columns.map((c) => c.label),
    r.rows.map((row) => r.columns.map((c) => row[c.key])),
  );
  await writeAudit(prisma, {
    actorId: user.id,
    eventType: "report.exported",
    recordType: "report",
    recordId: name,
    after: { filters, rows: r.rows.length, truncated: r.truncated },
    requestId: ctx.requestId,
  });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-${today}.csv"`,
      "x-content-type-options": "nosniff",
    },
  });
});
