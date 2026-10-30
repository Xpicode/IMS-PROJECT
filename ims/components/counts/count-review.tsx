"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, CheckCheck, Lock, RotateCcw, Unlock, Undo2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataList, type Column, type RowAction } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { PageHeader } from "@/components/common/page-header";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { apiFetch, messageOf } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReviewEntry, ReviewLine, getReview } from "@/lib/counts/review";

type Data = Awaited<ReturnType<typeof getReview>>;

const COND = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" } as const;
const STATUS: Record<string, string> = {
  AVAILABLE: "Available",
  UNDER_MAINTENANCE: "Under maintenance",
  NEEDS_REVIEW: "Needs review",
};

const FILTERS = [
  { key: "todo", label: "Needs decision", test: (l: ReviewLine) => ["READY", "MOVED", "DISAGREE"].includes(l.state) },
  {
    key: "diff",
    label: "Has difference",
    test: (l: ReviewLine) => l.state !== "DONE" && l.entries.length > 0 && !l.matches,
  },
  { key: "same", label: "No difference", test: (l: ReviewLine) => l.state === "READY" && l.matches },
  { key: "missing", label: "Not counted", test: (l: ReviewLine) => l.state === "NOT_COUNTED" || l.state === "RECOUNT" },
  { key: "done", label: "Done", test: (l: ReviewLine) => l.state === "DONE" },
  { key: "all", label: "All", test: () => true },
] as const;

const what = (l: ReviewLine) => (l.kind === "ASSET" ? `${l.tag} · ${l.name}` : `${l.sku} · ${l.name}`);

function valueOf(l: ReviewLine, e?: Pick<ReviewEntry, "quantity" | "found" | "condition"> | null) {
  const x = e ?? (l.entries.length ? { quantity: l.counted, found: l.found, condition: l.condition } : null);
  if (!x) return "—";
  if (l.kind === "STOCK") return x.quantity == null ? "—" : `${x.quantity} ${l.unit}`;
  return x.found ? `Found · ${COND[x.condition ?? "GOOD"]}` : x.found === false ? "Not found" : "—";
}

function Variance({ l }: { l: ReviewLine }) {
  if (l.state === "DONE" && l.review) {
    const v = l.review.variance;
    return <span className="tabular-nums">{v == null ? "—" : v > 0 ? `+${v}` : v}</span>;
  }
  if (!l.entries.length) return <span className="text-muted-foreground">—</span>;
  if (l.kind === "ASSET") {
    if (l.found === false) return <span className="font-semibold text-danger">Missing</span>;
    if (l.found && l.condition !== l.currentCondition)
      return (
        <span className="font-semibold text-warning">
          {COND[l.condition ?? "GOOD"]} (was {COND[l.currentCondition ?? "GOOD"]})
        </span>
      );
    return l.found ? <span className="text-success">Matches</span> : <span className="text-danger">Disagree</span>;
  }
  if (l.variance == null) return <span className="text-danger">Disagree</span>;
  return (
    <span className={cn("font-semibold tabular-nums", l.variance === 0 ? "text-success" : "text-danger")}>
      {l.variance > 0 ? `+${l.variance}` : l.variance}
    </span>
  );
}

type Pending =
  | { kind: "approve"; line: ReviewLine; entry?: ReviewEntry }
  | { kind: "recount"; line: ReviewLine }
  | { kind: "keep"; line: ReviewLine }
  | { kind: "matching" }
  | { kind: "close" }
  | { kind: "reopen" };

export function CountReview({ data, canManage }: { data: Data; canManage: boolean }) {
  const router = useRouter();
  const { session: s, lines, counters, summary } = data;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>(
    summary.ready + summary.moved + summary.disagree ? "todo" : "all",
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [picking, setPicking] = useState<ReviewLine | null>(null);
  const open = s.status === "OPEN";
  const shown = useMemo(() => lines.filter(FILTERS.find((f) => f.key === filter)!.test), [lines, filter]);

  const allColumns: Column<ReviewLine>[] = [
    {
      key: "item",
      header: "Item",
      primary: true,
      cell: (l) => (
        <span className="block min-w-40">
          <span className="block font-medium whitespace-nowrap">{l.kind === "ASSET" ? l.tag : l.sku}</span>
          <span className="block text-sm font-normal text-muted-foreground">
            {l.name}
            {l.serialNumber && ` · S/N ${l.serialNumber}`}
          </span>
        </span>
      ),
    },
    {
      key: "exp",
      header: "Expected",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums">
          {l.kind === "STOCK" ? `${l.expected ?? 0} ${l.unit}` : (STATUS[l.expectedStatus ?? ""] ?? "Here")}
        </span>
      ),
    },
    {
      key: "cnt",
      header: "Counted",
      cell: (l) =>
        l.entries.length ? (
          <span className="flex flex-col">
            {l.entries.length === 1 || l.state !== "DISAGREE" ? (
              <span className="font-medium tabular-nums">{valueOf(l)}</span>
            ) : null}
            {l.entries.map((e) => (
              <span key={e.id} className="text-sm text-muted-foreground">
                {l.state === "DISAGREE" && <b className="text-foreground tabular-nums">{valueOf(l, e)} </b>}
                {e.counter}
                {e.notes && ` · “${e.notes}”`}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">Not counted</span>
        ),
    },
    {
      key: "var",
      header: "Difference",
      align: "right",
      cell: (l) => (
        <span className="flex flex-col items-end">
          <Variance l={l} />
          {l.kind === "STOCK" && l.movedDuringCount !== 0 && l.state !== "DONE" && (
            <span className="text-sm font-medium whitespace-nowrap text-warning">
              moved {l.movedDuringCount > 0 ? "+" : ""}
              {l.movedDuringCount} during count
            </span>
          )}
        </span>
      ),
    },
    {
      key: "state",
      header: "Status",
      cell: (l) => (
        <span className="flex flex-col items-start gap-2">
          <StatusChip
            kind="countLine"
            status={l.review ? l.review.decision : (l.state as Exclude<typeof l.state, "DONE">)}
          />
          {l.review?.adjustment && <span className="text-sm text-muted-foreground">{l.review.adjustment}</span>}
          {l.state === "READY" && (
            <Button
              size="sm"
              onClick={() => setPending({ kind: "approve", line: l })}
              aria-label={`Approve ${what(l)}`}
            >
              <Check aria-hidden /> Approve
            </Button>
          )}
          {l.state === "DISAGREE" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPicking(l)}
              aria-label={`Choose which count of ${what(l)}`}
            >
              <UserCheck aria-hidden /> Choose count
            </Button>
          )}
        </span>
      ),
    },
  ];
  const columns = allColumns;

  // Approve / Choose count are the inline buttons in the Status cell; the menu holds the rest.
  const actions = (l: ReviewLine): RowAction[] => {
    if (l.state === "DONE") return [];
    const a: RowAction[] = [];
    if (open)
      a.push({ label: "Request recount", icon: RotateCcw, onSelect: () => setPending({ kind: "recount", line: l }) });
    a.push({ label: "Keep expected", icon: Undo2, onSelect: () => setPending({ kind: "keep", line: l }) });
    return a;
  };

  async function confirm() {
    const p = pending!;
    const base = `/api/v1/counts/${s.id}`;
    if (p.kind === "approve") {
      const r = await apiFetch<{ variance: number | null; adjustment: { reference: string } | null }>(
        `${base}/lines/${p.line.targetId}/approve`,
        { method: "POST", body: { entryId: p.entry?.id }, idempotencyKey: crypto.randomUUID() },
      );
      toast.success(
        r.adjustment ? `Approved. Stock adjusted (${r.adjustment.reference}).` : "Approved. No stock change needed.",
      );
    } else if (p.kind === "recount") {
      await apiFetch(`${base}/lines/${p.line.targetId}/recount`, { method: "POST" });
      toast.success("Recount requested. Counters see it after their next sync.");
    } else if (p.kind === "keep") {
      await apiFetch(`${base}/lines/${p.line.targetId}/keep`, { method: "POST", body: {} });
      toast.success("Kept the expected value. Nothing changed.");
    } else if (p.kind === "matching") {
      const r = await apiFetch<{ approved: number }>(`${base}/approve-matching`, { method: "POST" });
      toast.success(`Approved ${r.approved} lines with no difference.`);
    } else {
      await apiFetch(`${base}/${p.kind}`, { method: "POST" });
      toast.success(p.kind === "close" ? `Closed ${s.reference}.` : `Reopened ${s.reference}.`);
    }
    router.refresh();
  }

  const sheet = (() => {
    const p = pending;
    if (!p) return null;
    if (p.kind === "approve") {
      const l = p.line;
      const counted = p.entry ? p.entry.quantity : l.counted;
      const changes =
        l.kind === "STOCK"
          ? [{ label: `${l.sku} at ${s.location.code}`, from: `${l.expected} ${l.unit}`, to: `${counted} ${l.unit}` }]
          : (p.entry?.found ?? l.found) === false
            ? [{ label: `${l.tag} status`, from: STATUS[l.expectedStatus ?? ""] ?? "Here", to: "Lost" }]
            : (p.entry?.condition ?? l.condition) !== l.currentCondition
              ? [
                  {
                    label: `${l.tag} condition`,
                    from: COND[l.currentCondition ?? "GOOD"],
                    to: COND[p.entry?.condition ?? l.condition ?? "GOOD"],
                  },
                ]
              : [];
      const noChange = l.kind === "STOCK" ? counted === l.expected : changes.length === 0;
      return {
        title: `Approve ${l.kind === "ASSET" ? l.tag : l.sku}?`,
        description: noChange
          ? "The count matches the records. Nothing changes."
          : l.kind === "STOCK"
            ? "This posts one stock adjustment for the difference. It can't be undone here; a correction needs a new adjustment."
            : "This updates the asset record and adds it to the asset's history.",
        changes,
        label: "Approve",
      };
    }
    if (p.kind === "recount")
      return {
        title: `Request a recount of ${p.line.kind === "ASSET" ? p.line.tag : p.line.sku}?`,
        description:
          "The current count is set aside and the expected value is taken again from today's records. Counters must count this line again.",
        label: "Request recount",
      };
    if (p.kind === "keep")
      return {
        title: `Keep the expected value for ${p.line.kind === "ASSET" ? p.line.tag : p.line.sku}?`,
        description: "The line is closed without changing stock or the asset record.",
        label: "Keep expected",
      };
    if (p.kind === "matching")
      return {
        title: `Approve ${summary.readyMatching} lines with no difference?`,
        description:
          "Only lines whose count matches the records exactly are approved. No stock changes. Lines with a difference stay for one-by-one review.",
        label: "Approve all",
      };
    if (p.kind === "close")
      return {
        title: `Close ${s.reference}?`,
        description:
          "Counters can no longer send counts for it. You can still review and approve lines, and reopen it if you need recounts.",
        label: "Close count",
      };
    return {
      title: `Reopen ${s.reference}?`,
      description: "Counters can download it and send counts again.",
      label: "Reopen",
    };
  })();

  return (
    <>
      <Link
        href="/counts"
        className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> All counts
      </Link>
      <PageHeader
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {s.reference} · {s.location.code} · started {formatDateTime(s.snapshotAt)}
            <StatusChip kind="count" status={s.status} />
          </span>
        }
        actions={
          canManage ? (
            open ? (
              <Button variant="outline" onClick={() => setPending({ kind: "close" })}>
                <Lock aria-hidden /> Close count
              </Button>
            ) : s.status === "CLOSED" ? (
              <Button variant="outline" onClick={() => setPending({ kind: "reopen" })}>
                <Unlock aria-hidden /> Reopen
              </Button>
            ) : undefined
          ) : undefined
        }
      />

      <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Progress">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Counted</p>
          <p className="text-2xl font-semibold tabular-nums">
            {summary.counted}{" "}
            <span className="text-base font-normal text-muted-foreground">/ {summary.lines} lines</span>
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">With a difference</p>
          <p className={cn("text-2xl font-semibold tabular-nums", summary.withDifference && "text-danger")}>
            {summary.withDifference}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Done</p>
          <p className="text-2xl font-semibold tabular-nums">
            {summary.done} <span className="text-base font-normal text-muted-foreground">/ {summary.lines}</span>
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Counters</p>
          {counters.length ? (
            <ul className="text-sm">
              {counters.map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span className="truncate">{c.name}</span>
                  <span className="tabular-nums">{c.counted} lines</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">Nobody assigned.</p>
          )}
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show lines">
        {FILTERS.map((f) => {
          const n = lines.filter(f.test).length;
          return (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label} <span className="tabular-nums">({n})</span>
            </Button>
          );
        })}
        {summary.readyMatching > 0 && (
          <Button size="sm" className="sm:ml-auto" onClick={() => setPending({ kind: "matching" })}>
            <CheckCheck aria-hidden /> Approve {summary.readyMatching} with no difference
          </Button>
        )}
      </div>

      <DataList
        tableFrom="xl"
        rows={shown}
        columns={columns}
        rowKey={(l) => l.targetId}
        rowLabel={what}
        label="Count lines"
        empty={{ title: "Nothing here", description: "No lines match this filter." }}
        actions={actions}
      />

      {sheet && (
        <ConfirmSheet
          open={!!pending}
          onOpenChange={(o) => !o && setPending(null)}
          title={sheet.title}
          description={sheet.description}
          changes={"changes" in sheet ? sheet.changes : undefined}
          confirmLabel={sheet.label}
          onConfirm={async () => {
            try {
              await confirm();
            } catch (e) {
              throw new Error(messageOf(e));
            }
          }}
        />
      )}

      <ResponsiveDialog
        open={!!picking}
        onOpenChange={(o) => !o && setPicking(null)}
        title={picking ? `Which count of ${what(picking)}?` : ""}
        description="The counters disagree. Pick the count to use, or close this and request a recount."
        footer={
          <Button variant="outline" onClick={() => setPicking(null)}>
            Cancel
          </Button>
        }
      >
        <ul className="flex flex-col gap-2 pb-2">
          {picking?.entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted"
                onClick={() => {
                  const l = picking;
                  setPicking(null);
                  setPending({ kind: "approve", line: l, entry: e });
                }}
              >
                <span>
                  <span className="block font-medium">{e.counter}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                    {e.notes && ` · “${e.notes}”`}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{valueOf(picking, e)}</span>
              </button>
            </li>
          ))}
        </ul>
      </ResponsiveDialog>
    </>
  );
}
