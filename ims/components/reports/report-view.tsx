"use client";

import Link from "next/link";
import { BarChart3, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataList, type Column } from "@/components/common/data-list";
import { PageHeader } from "@/components/common/page-header";
import { cn } from "@/lib/utils";

type Value = string | number | null | undefined;
/** Codes, dates and numbers read badly when wrapped ("TRN-/2026-/000002"). */
const NOWRAP = new Set([
  "date",
  "reference",
  "sku",
  "tag",
  "location",
  "due",
  "count",
  "adjustment",
  "loan",
  "unit",
  "serial",
  "status",
]);
export type ReportColumn = { key: string; label: string; align?: "right" };
type Opt = { value: string; label: string };
export type FilterDef =
  | { key: string; label: string; kind: "text"; placeholder?: string }
  | { key: string; label: string; kind: "date" }
  | { key: string; label: string; kind: "select"; options: Opt[]; any: string };

export function ReportView({
  reports,
  current,
  title,
  description,
  columns,
  rows,
  total,
  truncated,
  filters,
  values,
}: {
  reports: { name: string; title: string }[];
  current: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, Value>[];
  total: number;
  truncated: boolean;
  filters: FilterDef[];
  values: Record<string, string>;
}) {
  const qs = new URLSearchParams(Object.entries(values).filter(([, v]) => v));
  const csvHref = `/api/v1/reports/${current}/csv${qs.size ? `?${qs}` : ""}`;
  const cols: Column<Record<string, Value> & { _i: number }>[] = columns.map((c, i) => ({
    key: c.key,
    header: c.label,
    primary: i === 0,
    align: c.align,
    cell: (r) => {
      const v = r[c.key];
      const neg = typeof v === "number" && v < 0;
      return (
        <span
          className={cn(
            c.align === "right" && "tabular-nums",
            neg && "font-medium text-danger",
            NOWRAP.has(c.key) || c.align === "right" ? "whitespace-nowrap" : "break-words",
          )}
        >
          {v === null || v === undefined || v === ""
            ? "—"
            : typeof v === "number" && v > 0 && c.key === "quantity"
              ? `+${v}`
              : String(v)}
        </span>
      );
    },
  }));
  return (
    <>
      <PageHeader
        title="Reports"
        description="Fixed reports for your locations. Filter, then download the same rows as a spreadsheet (CSV)."
      />
      <nav aria-label="Reports" className="mb-4 flex flex-wrap gap-2">
        {reports.map((r) => (
          <Button key={r.name} asChild variant={r.name === current ? "default" : "outline"}>
            <Link href={`/reports?report=${r.name}`} aria-current={r.name === current ? "page" : undefined}>
              {r.title}
            </Link>
          </Button>
        ))}
      </nav>
      <section aria-labelledby="report-h" className="flex flex-col gap-4">
        <div>
          <h2 id="report-h" className="text-xl font-semibold">
            {title}
          </h2>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <form method="get" action="/reports" className="grid gap-3 surface p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="report" value={current} />
          {filters.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
              {f.kind === "select" ? (
                <select
                  id={`f-${f.key}`}
                  name={f.key}
                  defaultValue={values[f.key] ?? ""}
                  className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
                >
                  <option value="">{f.any}</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`f-${f.key}`}
                  name={f.key}
                  type={f.kind === "date" ? "date" : "search"}
                  defaultValue={values[f.key] ?? ""}
                  placeholder={f.kind === "text" ? f.placeholder : undefined}
                  autoComplete="off"
                />
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit">
              <Search aria-hidden /> Show
            </Button>
            <Button asChild variant="outline">
              <Link href={`/reports?report=${current}`}>Clear filters</Link>
            </Button>
            <Button asChild variant="outline" className="sm:ml-auto">
              <a href={csvHref} download>
                <Download aria-hidden /> Download CSV ({total.toLocaleString("en-PH")} rows)
              </a>
            </Button>
          </div>
        </form>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {truncated
            ? `Showing the first ${rows.length.toLocaleString("en-PH")} of ${total.toLocaleString("en-PH")} rows. Download the CSV for all of them, or narrow the filters.`
            : `${total.toLocaleString("en-PH")} row${total === 1 ? "" : "s"}`}
        </p>
        <DataList
          tableFrom="xl"
          rows={rows.map((r, i) => ({ ...r, _i: i }))}
          columns={cols}
          rowKey={(r) => String(r._i)}
          label={title}
          empty={{ icon: BarChart3, title: "Nothing matches", description: "Change or clear the filters." }}
        />
      </section>
    </>
  );
}
