"use client";

import Link from "next/link";
import { ScrollText } from "lucide-react";
import { DataList, type Column } from "@/components/common/data-list";

export type AuditRow = {
  id: string;
  when: string;
  who: string;
  eventType: string;
  record: string;
  /** Where the record can be opened, when it has a page. */
  recordHref: string | null;
  details: string;
  requestId: string | null;
};

/** Read-only list; details are the safe before/after values stored with each event. */
export function AuditList({
  rows,
  page,
  pageCount,
  href,
}: {
  rows: AuditRow[];
  page: number;
  pageCount: number;
  href: string;
}) {
  const columns: Column<AuditRow>[] = [
    { key: "when", header: "When", cell: (r) => <span className="whitespace-nowrap">{r.when}</span> },
    {
      key: "event",
      header: "Event",
      primary: true,
      cell: (r) => <code className="text-sm font-semibold break-all">{r.eventType}</code>,
    },
    { key: "who", header: "By", cell: (r) => r.who },
    {
      key: "record",
      header: "Record",
      cell: (r) =>
        r.recordHref ? (
          <Link href={r.recordHref} className="text-sm break-all text-primary underline-offset-4 hover:underline">
            {r.record}
          </Link>
        ) : (
          <span className="text-sm break-all">{r.record}</span>
        ),
    },
    {
      key: "details",
      header: "Details",
      cell: (r) =>
        r.details ? (
          <details>
            <summary className="cursor-pointer text-sm text-primary">Show</summary>
            <pre className="mt-2 max-w-md overflow-x-auto rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap">
              {r.details}
            </pre>
          </details>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <DataList
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      label="Audit events"
      pagination={{ page, pageCount, href: (p) => `${href}${href.includes("?") ? "&" : "?"}page=${p}` }}
      empty={{ icon: ScrollText, title: "No events match", description: "Change or clear the filters." }}
    />
  );
}
