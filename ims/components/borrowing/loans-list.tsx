"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeftRight, Ban, FolderOpen, PackageCheck, Plus, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataList, type Column, type RowAction } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { PageHeader } from "@/components/common/page-header";
import { apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type LoanTab = "requests" | "active" | "overdue" | "closed";
export type LoanRow = {
  id: string;
  reference: string | null;
  status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
  borrowerName: string;
  borrowerDept: string | null;
  purpose: string;
  dueAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  location: string;
  preparedBy: string;
  total: number;
  returned: number;
  tags: string[];
  overdue: boolean;
  canRelease: boolean;
};

const TABS: { key: LoanTab; label: string }[] = [
  { key: "requests", label: "Requests" },
  { key: "active", label: "Out now" },
  { key: "overdue", label: "Overdue" },
  { key: "closed", label: "Closed" },
];

export function LoansList({
  rows,
  tab,
  q,
  counts,
  canCreate,
  page,
  pageCount,
}: {
  rows: LoanRow[];
  tab: LoanTab;
  q: string;
  counts: Record<LoanTab, number>;
  canCreate: boolean;
  page: number;
  pageCount: number;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const [cancelling, setCancelling] = useState<LoanRow | null>(null);
  const href = (t: LoanTab, p = 1, s = q) =>
    `/borrowing?tab=${t}${s ? `&q=${encodeURIComponent(s)}` : ""}${p > 1 ? `&page=${p}` : ""}`;

  const columns: Column<LoanRow>[] = [
    {
      key: "loan",
      header: "Loan",
      primary: true,
      cell: (r) => (
        <Link href={`/borrowing/${r.id}`} className="hover:underline">
          <span className="block font-medium whitespace-nowrap text-primary">
            {r.reference ?? "Request (no number yet)"}
          </span>
          <span className="block text-sm font-normal text-muted-foreground">
            {r.tags.slice(0, 3).join(", ")}
            {r.tags.length > 3 ? ` +${r.tags.length - 3} more` : ""}
          </span>
        </Link>
      ),
    },
    {
      key: "who",
      header: "Borrower",
      cell: (r) => (
        <span>
          {r.borrowerName}
          <span className="block text-sm text-muted-foreground">{r.purpose}</span>
        </span>
      ),
    },
    {
      key: "loc",
      header: "From",
      cell: (r) => <span className="whitespace-nowrap">{r.location}</span>,
      hideOnCard: true,
    },
    {
      key: "progress",
      header: "Returned",
      cell: (r) => (r.status === "DRAFT" ? `${r.total} requested` : `${r.returned} of ${r.total}`),
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => (
        <span className={cn("whitespace-nowrap", r.overdue && "font-semibold text-danger")}>{formatDate(r.dueAt)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusChip kind="loan" status={r.overdue ? "OVERDUE" : r.status} />,
    },
  ];
  const actions = (r: LoanRow): RowAction[] => {
    const a: RowAction[] = [{ label: "Open", icon: FolderOpen, onSelect: () => router.push(`/borrowing/${r.id}`) }];
    if (r.status === "OPEN" && r.canRelease)
      a.push({ label: "Return", icon: PackageCheck, onSelect: () => router.push(`/borrowing/${r.id}?return=1`) });
    if (r.status === "DRAFT" && r.canRelease) {
      a.push({ label: "Release", icon: Send, onSelect: () => router.push(`/borrowing/new?draft=${r.id}`) });
      a.push({ label: "Cancel request", icon: Ban, destructive: true, onSelect: () => setCancelling(r) });
    }
    return a;
  };
  const newButton = canCreate ? (
    <Button asChild>
      <Link href="/borrowing/new">
        <Plus aria-hidden /> Borrow equipment
      </Link>
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Borrowing"
        description="Equipment out on loan, requests from the field, and returns."
        actions={newButton}
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Loan lists" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Button
              key={t.key}
              asChild
              variant={t.key === tab ? "default" : "outline"}
              className={cn(t.key === "overdue" && counts.overdue > 0 && t.key !== tab && "border-danger text-danger")}
            >
              <Link href={href(t.key, 1)} aria-current={t.key === tab ? "page" : undefined}>
                {t.label} <span className="tabular-nums">({counts[t.key]})</span>
              </Link>
            </Button>
          ))}
        </nav>
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(href(tab, 1, search.trim()));
          }}
        >
          <label htmlFor="loan-q" className="sr-only">
            Search loans
          </label>
          <Input
            id="loan-q"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Number, borrower, or asset tag"
            className="lg:w-72"
          />
          <Button type="submit" variant="outline" aria-label="Search">
            <Search aria-hidden />
          </Button>
        </form>
      </div>
      <DataList
        tableFrom="xl"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.reference ?? `request for ${r.borrowerName}`}
        label="Loans"
        actions={actions}
        pagination={{ page, pageCount, href: (p) => href(tab, p) }}
        empty={{
          icon: ArrowLeftRight,
          title: q
            ? `Nothing matches "${q}"`
            : tab === "requests"
              ? "No requests waiting"
              : tab === "overdue"
                ? "Nothing is overdue"
                : tab === "closed"
                  ? "No closed loans yet"
                  : "Nothing is out on loan",
          description:
            tab === "requests"
              ? "Requests prepared on phones in the field show up here for a supervisor to release."
              : undefined,
          action: tab === "active" && !q ? newButton : undefined,
        }}
      />
      <ConfirmSheet
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this request?"
        description={
          cancelling ? `The request for ${cancelling.borrowerName} is closed without releasing anything.` : ""
        }
        changes={cancelling ? [{ label: "Request", from: "Waiting", to: "Cancelled" }] : []}
        confirmLabel="Cancel request"
        tone="destructive"
        onConfirm={async () => {
          await apiFetch(`/api/v1/borrowings/${cancelling!.id}/cancel`, {
            method: "POST",
            body: { reason: "Cancelled by supervisor" },
          });
          toast.success("Request cancelled.");
          setCancelling(null);
          router.refresh();
        }}
      />
    </>
  );
}
