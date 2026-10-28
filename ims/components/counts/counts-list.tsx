"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardCheck, ClipboardPlus, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataList, type Column } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { PageHeader } from "@/components/common/page-header";
import { NewCountForm, type CountLocation } from "./new-count-form";
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
  canManage: boolean;
};

export function CountsList({ rows, locations }: { rows: CountRow[]; locations: CountLocation[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<CountRow | null>(null);
  const columns: Column<CountRow>[] = [
    {
      key: "name",
      header: "Count",
      primary: true,
      cell: (r) => (
        <span>
          <span className="block font-medium">{r.name}</span>
          <span className="block text-sm font-normal text-muted-foreground">{r.reference}</span>
        </span>
      ),
    },
    { key: "loc", header: "Location", cell: (r) => r.location.code },
    { key: "who", header: "Counters", cell: (r) => (r.assignees.length ? r.assignees.join(", ") : "Nobody yet") },
    { key: "n", header: "To count", align: "right", cell: (r) => <span className="tabular-nums">{r.targets}</span> },
    { key: "due", header: "Due", cell: (r) => (r.dueAt ? formatDateTime(r.dueAt) : "—"), hideOnCard: true },
    { key: "status", header: "Status", cell: (r) => <StatusChip kind="count" status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Counts"
        description="Physical count sessions. Counters download them to their phones and count offline."
        actions={
          locations.length > 0 ? (
            <Button onClick={() => setCreating(true)}>
              <ClipboardPlus aria-hidden /> New count
            </Button>
          ) : undefined
        }
      />
      <DataList
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.reference}
        label="Count sessions"
        empty={{
          title: "No counts yet",
          description: "Create a count, assign counters, and they can download it to their phones.",
          icon: ClipboardCheck,
          action: locations.length ? (
            <Button onClick={() => setCreating(true)}>
              <ClipboardPlus aria-hidden /> New count
            </Button>
          ) : undefined,
        }}
        actions={(r) =>
          r.canManage && r.status === "OPEN" ? [{ label: "Close", icon: Lock, onSelect: () => setClosing(r) }] : []
        }
      />
      <NewCountForm open={creating} onOpenChange={setCreating} locations={locations} />
      <ConfirmSheet
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        title={`Close ${closing?.reference ?? ""}?`}
        description="Counters can no longer download it. Results already on their phones are kept there. Reviewing results comes with build phase 4."
        changes={closing ? [{ label: "Status", from: "Open", to: "Closed" }] : []}
        confirmLabel="Close count"
        onConfirm={async () => {
          await apiFetch(`/api/v1/counts/${closing!.id}/close`, { method: "POST" });
          toast.success(`Closed ${closing!.reference}.`);
          router.refresh();
        }}
      />
    </>
  );
}
