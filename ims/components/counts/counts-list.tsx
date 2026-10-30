"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardCheck, ClipboardPlus, Lock, SearchCheck, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataList, type Column, type RowAction } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { PageHeader } from "@/components/common/page-header";
import { apiFetch } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

export type CountRow = {
  id: string;
  reference: string;
  name: string;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  dueAt: string | null;
  location: { code: string; name: string };
  assignees: string[];
  targets: number;
  counted: number;
  done: number;
  canManage: boolean;
};

export function CountsList({ rows, canCreate }: { rows: CountRow[]; canCreate: boolean }) {
  const router = useRouter();
  const [acting, setActing] = useState<{ row: CountRow; to: "close" | "reopen" } | null>(null);
  const columns: Column<CountRow>[] = [
    {
      key: "name",
      header: "Count",
      primary: true,
      cell: (r) => (
        <Link href={`/counts/${r.id}`} className="hover:underline">
          <span className="block font-medium text-primary">{r.name}</span>
          <span className="block text-sm font-normal text-muted-foreground">{r.reference}</span>
        </Link>
      ),
    },
    { key: "loc", header: "Location", cell: (r) => r.location.code },
    { key: "who", header: "Counters", cell: (r) => (r.assignees.length ? r.assignees.join(", ") : "Nobody yet") },
    {
      key: "progress",
      header: "Progress",
      cell: (r) => (
        <span className="text-sm tabular-nums">
          {r.counted} / {r.targets} counted
          <br />
          {r.done} reviewed
        </span>
      ),
    },
    { key: "due", header: "Due", cell: (r) => (r.dueAt ? formatDateTime(r.dueAt) : "—"), hideOnCard: true },
    { key: "status", header: "Status", cell: (r) => <StatusChip kind="count" status={r.status} /> },
  ];
  const actions = (r: CountRow): RowAction[] => {
    const a: RowAction[] = [{ label: "Review", icon: SearchCheck, onSelect: () => router.push(`/counts/${r.id}`) }];
    if (r.canManage && r.status === "OPEN")
      a.push({ label: "Close", icon: Lock, onSelect: () => setActing({ row: r, to: "close" }) });
    if (r.canManage && r.status === "CLOSED")
      a.push({ label: "Reopen", icon: Unlock, onSelect: () => setActing({ row: r, to: "reopen" }) });
    return a;
  };
  const newButton = canCreate ? (
    <Button asChild>
      <Link href="/counts/new">
        <ClipboardPlus aria-hidden /> New count
      </Link>
    </Button>
  ) : undefined;
  return (
    <>
      <PageHeader
        title="Counts"
        description="Physical count sessions. Counters download them to their phones, count offline, and send. You review and approve the differences."
        actions={newButton}
      />
      <DataList
        tableFrom="xl"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.reference}
        label="Count sessions"
        empty={{
          title: "No counts yet",
          description: "Create a count, assign counters, and they can download it to their phones.",
          icon: ClipboardCheck,
          action: newButton,
        }}
        actions={actions}
      />
      <ConfirmSheet
        open={!!acting}
        onOpenChange={(o) => !o && setActing(null)}
        title={acting ? `${acting.to === "close" ? "Close" : "Reopen"} ${acting.row.reference}?` : ""}
        description={
          acting?.to === "close"
            ? "Counters can no longer send counts for it. Counts that arrive later are kept as conflicts. You can still review it, and reopen it for recounts."
            : "Counters can download it and send counts again."
        }
        changes={
          acting
            ? [
                {
                  label: "Status",
                  from: acting.to === "close" ? "Open" : "Closed",
                  to: acting.to === "close" ? "Closed" : "Open",
                },
              ]
            : []
        }
        confirmLabel={acting?.to === "close" ? "Close count" : "Reopen"}
        onConfirm={async () => {
          await apiFetch(`/api/v1/counts/${acting!.row.id}/${acting!.to}`, { method: "POST" });
          toast.success(`${acting!.to === "close" ? "Closed" : "Reopened"} ${acting!.row.reference}.`);
          router.refresh();
        }}
      />
    </>
  );
}
