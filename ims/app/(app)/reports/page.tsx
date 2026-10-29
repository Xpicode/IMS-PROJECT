import { NoAccess } from "@/components/common/no-access";
import { ReportView, type FilterDef } from "@/components/reports/report-view";
import { pageAccess } from "@/lib/auth/page";
import { prisma } from "@/lib/db/prisma";
import { locationsFor, one } from "@/lib/inventory/page-data";
import { filtersFrom, isReportName, REPORTS, runReport, type ReportName } from "@/lib/reports/service";

export const metadata = { title: "Reports" };

const ASSET_STATUS = [
  ["AVAILABLE", "Available"],
  ["BORROWED", "Borrowed"],
  ["UNDER_MAINTENANCE", "Under maintenance"],
  ["NEEDS_REVIEW", "Needs review"],
  ["LOST", "Lost"],
  ["RETIRED", "Retired"],
].map(([value, label]) => ({ value, label }));
const TYPES = [
  ["RECEIPT", "Receipt"],
  ["ISSUE", "Issue"],
  ["TRANSFER", "Transfer"],
  ["ADJUSTMENT", "Count adjustment"],
].map(([value, label]) => ({ value, label }));

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const { user, allowed } = await pageAccess("reports.view");
  if (!allowed || user.role === "FIELD") return <NoAccess what="Reports" />;
  const sp = await searchParams;
  const asked = one(sp.report) ?? "";
  const name: ReportName = isReportName(asked) ? asked : "stock-balances";
  const values = filtersFrom(sp) as Record<string, string>;
  const locs = await locationsFor(user, "reports.view");
  // A location filter for a place I can't see is dropped, not an error page.
  if (values.locationId && !locs.some((l) => l.id === values.locationId)) delete values.locationId;
  const location: FilterDef = {
    key: "locationId",
    label: "Location",
    kind: "select",
    any: "All my locations",
    options: locs.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` })),
  };
  const from: FilterDef = { key: "from", label: "From date", kind: "date" };
  const to: FilterDef = { key: "to", label: "To date", kind: "date" };
  let filters: FilterDef[];
  if (name === "stock-balances")
    filters = [
      location,
      { key: "q", label: "Item", kind: "text", placeholder: "Name or SKU" },
      {
        key: "stock",
        label: "Stock level",
        kind: "select",
        any: "Any",
        options: [
          { value: "low", label: "Low only" },
          { value: "out", label: "Out only" },
        ],
      },
    ];
  else if (name === "movements") {
    const actors = await prisma.user.findMany({
      // Only people who moved stock in my locations (no names from other sites).
      where: { stockTxns: { some: { movements: { some: { locationId: { in: locs.map((l) => l.id) } } } } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    filters = [
      location,
      { key: "type", label: "Type", kind: "select", any: "All types", options: TYPES },
      { key: "q", label: "Item", kind: "text", placeholder: "Name or SKU" },
      { key: "reference", label: "Reference", kind: "text", placeholder: "e.g. ISS-2026-000123" },
      {
        key: "userId",
        label: "By",
        kind: "select",
        any: "Anyone",
        options: actors.map((a) => ({ value: a.id, label: a.name })),
      },
      from,
      to,
    ];
  } else if (name === "assets")
    filters = [
      location,
      { key: "status", label: "Status", kind: "select", any: "Any status", options: ASSET_STATUS },
      { key: "q", label: "Search", kind: "text", placeholder: "Tag, serial, item, or person" },
    ];
  else if (name === "overdue")
    filters = [location, { key: "q", label: "Search", kind: "text", placeholder: "Borrower or loan number" }];
  else
    filters = [
      location,
      { key: "reference", label: "Count", kind: "text", placeholder: "e.g. CNT-2026-000001" },
      from,
      to,
    ];

  const allowedKeys = new Set(filters.map((f) => f.key));
  const used = Object.fromEntries(Object.entries(values).filter(([k]) => allowedKeys.has(k)));
  const r = await runReport(user, name, used, { limit: 500 });
  return (
    <ReportView
      reports={Object.entries(REPORTS).map(([n, d]) => ({ name: n, title: d.title }))}
      current={name}
      title={REPORTS[name].title}
      description={REPORTS[name].description}
      columns={r.columns}
      rows={r.rows}
      total={r.total}
      truncated={r.truncated}
      filters={filters}
      values={used}
    />
  );
}
