"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, FileText, Printer, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataList, type Column, type RowAction } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { PageHeader } from "@/components/common/page-header";
import { pdfUrl, printPdf, type DocStatus } from "./document-actions";
import { apiFetch, messageOf } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

export type DocRow = {
  id: string;
  type: string;
  reference: string;
  status: DocStatus;
  pageCount: number | null;
  createdAt: string;
  location: string;
  createdBy: string;
  source: string | null;
  lastError: string | null;
};

export const DOC_TYPES: Record<string, string> = {
  STOCK_ISSUANCE: "Stock Issuance",
  TRANSMITTAL: "Transmittal",
  EQUIPMENT_BORROWING: "Equipment Borrowing",
  RETURN_ACKNOWLEDGMENT: "Return Acknowledgment",
};
const ALL = "all";

/** Document center (§13.4): find any official PDF by number, view, download, print, or redraw it. */
export function DocumentsList({
  rows,
  q,
  type,
  status,
  page,
  pageCount,
  total,
}: {
  rows: DocRow[];
  q: string;
  type: string;
  status: string;
  page: number;
  pageCount: number;
  total: number;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const href = (o: { q?: string; type?: string; status?: string; page?: number }) => {
    const p = new URLSearchParams();
    const v = { q, type, status, page: 1, ...o };
    if (v.q) p.set("q", v.q);
    if (v.type && v.type !== ALL) p.set("type", v.type);
    if (v.status && v.status !== ALL) p.set("status", v.status);
    if (v.page > 1) p.set("page", String(v.page));
    return `/documents${p.size ? `?${p}` : ""}`;
  };

  async function retry(r: DocRow) {
    try {
      const d = await apiFetch<{ status: DocStatus; reference: string; lastError: string | null }>(
        `/api/v1/documents/${r.id}/retry`,
        { method: "POST" },
      );
      if (d.status === "READY") toast.success(`PDF for ${d.reference} is ready.`);
      else toast.error(d.lastError ?? "The PDF still could not be drawn.");
      router.refresh();
    } catch (e) {
      toast.error(messageOf(e));
    }
  }

  const columns: Column<DocRow>[] = [
    {
      key: "ref",
      header: "Number",
      primary: true,
      cell: (r) =>
        r.status === "READY" ? (
          <a href={pdfUrl(r.id)} target="_blank" rel="noopener" className="hover:underline">
            <span className="block font-medium text-primary">{r.reference}</span>
            <span className="block text-sm font-normal text-muted-foreground">{DOC_TYPES[r.type]}</span>
          </a>
        ) : (
          <span>
            <span className="block font-medium">{r.reference}</span>
            <span className="block text-sm font-normal text-muted-foreground">{DOC_TYPES[r.type]}</span>
          </span>
        ),
    },
    { key: "loc", header: "Location", cell: (r) => r.location },
    {
      key: "made",
      header: "Confirmed",
      cell: (r) => (
        <span>
          {formatDateTime(r.createdAt)}
          <span className="block text-sm text-muted-foreground">{r.createdBy}</span>
        </span>
      ),
    },
    {
      key: "src",
      header: "Record",
      hideOnCard: true,
      cell: (r) =>
        r.source ? (
          <Link href={r.source} className="text-primary underline-offset-4 hover:underline">
            Open record
          </Link>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      header: "PDF",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusChip kind="document" status={r.status} />
          {r.pageCount && r.status === "READY" ? (
            <span className="text-sm text-muted-foreground">
              {r.pageCount} page{r.pageCount > 1 ? "s" : ""}
            </span>
          ) : null}
        </span>
      ),
    },
  ];
  const actions = (r: DocRow): RowAction[] =>
    r.status === "READY"
      ? [
          { label: "View", icon: FileText, onSelect: () => window.open(pdfUrl(r.id), "_blank", "noopener") },
          { label: "Download", icon: Download, onSelect: () => (window.location.href = pdfUrl(r.id, true)) },
          { label: "Print", icon: Printer, onSelect: () => printPdf(r.id) },
          { label: "Redraw PDF", icon: RotateCcw, onSelect: () => retry(r) },
        ]
      : r.status === "VOID"
        ? []
        : [{ label: "Retry PDF", icon: RotateCcw, onSelect: () => retry(r) }];

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every official form, made when a transaction is confirmed. Search by number, then view, download, or print it."
      />
      <form
        role="search"
        className="mb-4 grid gap-3 md:grid-cols-[1fr_14rem_12rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(href({ q: search.trim() }));
        }}
      >
        <div>
          <label htmlFor="doc-q" className="sr-only">
            Document number
          </label>
          <Input
            id="doc-q"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Number, e.g. BOR-2026-000001"
          />
        </div>
        <Select value={type || ALL} onValueChange={(v) => router.push(href({ type: v }))}>
          <SelectTrigger aria-label="Form type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All forms</SelectItem>
            {Object.entries(DOC_TYPES).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status || ALL} onValueChange={(v) => router.push(href({ status: v }))}>
          <SelectTrigger aria-label="PDF status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            <SelectItem value="READY">PDF ready</SelectItem>
            <SelectItem value="PDF_FAILED">PDF failed</SelectItem>
            <SelectItem value="PENDING">Drawing</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline">
          <Search aria-hidden /> Search
        </Button>
      </form>
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {total} document{total === 1 ? "" : "s"}
      </p>
      <DataList
        tableFrom="xl"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.reference}
        label="Documents"
        actions={actions}
        pagination={{ page, pageCount, href: (p) => href({ page: p }) }}
        empty={{
          icon: FileText,
          title: q || type || status ? "No documents match" : "No documents yet",
          description: "Issues, transfers, loans, and returns each make an official form when they are confirmed.",
        }}
      />
    </>
  );
}
