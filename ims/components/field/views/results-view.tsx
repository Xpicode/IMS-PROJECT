"use client";

import { useEffect, useState } from "react";
import { ChevronRight, CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/common/status-chip";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { SendResult } from "../send-result";
import type { AssignmentRec, CountDraft, TargetRec } from "@/lib/field/db";
import { draftStates, type DraftSyncState } from "@/lib/field/outbox";
import { formatDateTime } from "@/lib/format";

const COND = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" } as const;

type Line = { draft: CountDraft; state: DraftSyncState };

/** My results: every count on this phone with its send state. Editable any time; an edit is sent as a new count. */
export function ResultsView({ assignment }: { assignment: string }) {
  const { db, sendCounts, syncing, dataVersion, lastSync } = useField();
  const [data, setData] = useState<{ a: AssignmentRec | null; targets: TargetRec[]; lines: Line[] } | null>(null);
  const [sent, setSent] = useState<Awaited<ReturnType<typeof sendCounts>> | null>(null);
  useEffect(() => {
    Promise.all([
      db.assignments.get(assignment),
      db.targets.where("sessionId").equals(assignment).toArray(),
      draftStates(db, assignment),
    ]).then(
      ([a, targets, states]) => setData({ a: a ?? null, targets, lines: [...states.values()] }),
      () => setData({ a: null, targets: [], lines: [] }),
    );
  }, [db, assignment, dataVersion]);

  const back = () => go({ v: "assignment", a: assignment });
  if (!data)
    return (
      <FieldScreen title="My results" back={back}>
        <p>Loading…</p>
      </FieldScreen>
    );
  const byId = new Map(data.targets.map((t) => [t.id, t]));
  const done = [...data.lines].sort((x, y) => y.draft.updatedAt.localeCompare(x.draft.updatedAt));
  const counted = new Set(done.map((d) => d.draft.targetId));
  const todo = data.targets
    .filter((t) => !counted.has(t.id))
    .sort((x, y) => (x.tag ?? x.name).localeCompare(y.tag ?? y.name));
  const drafts = done.filter((l) => l.state === "DRAFT").length;
  const value = (d: CountDraft, t?: TargetRec) =>
    d.kind === "STOCK"
      ? `${d.quantity} ${t?.unit ?? ""}`
      : d.found
        ? `Found · ${COND[d.condition ?? "GOOD"]}`
        : "Not found";
  // A recount was requested after this count was made (the line's version went up).
  const chip = (l: Line, t?: TargetRec) => (t && t.version > l.draft.baseVersion ? "RECOUNT" : l.state);

  return (
    <FieldScreen
      title="My results"
      subtitle={data.a ? `${data.a.name} · ${data.a.location.code}` : undefined}
      back={back}
    >
      <p className="rounded-lg border bg-muted/50 p-3 text-[15px]">
        Tap any line to change it. A change is sent as a new count and replaces your earlier one on the server.
      </p>
      {drafts > 0 && (
        <Button
          size="lg"
          className="h-14 text-lg"
          loading={syncing}
          onClick={async () => setSent(await sendCounts(assignment))}
        >
          <CloudUpload className="size-6" aria-hidden /> Send {drafts} {drafts === 1 ? "count" : "counts"}
        </Button>
      )}
      {/* Latest result, including automatic retries after this send. */}
      {sent && <SendResult queued={sent.queued} outcome={lastSync ?? sent.outcome} />}
      <section aria-labelledby="done-h" className="flex flex-col gap-2">
        <h2 id="done-h" className="text-lg font-semibold">
          Counted ({done.length})
        </h2>
        {done.length === 0 ? (
          <p className="text-muted-foreground">Nothing counted yet.</p>
        ) : (
          <ul className="divide-y surface">
            {done.map((l) => {
              const t = byId.get(l.draft.targetId);
              return (
                <li key={l.draft.id}>
                  <button
                    type="button"
                    onClick={() => go({ v: "count", a: assignment, t: l.draft.targetId })}
                    className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {t ? (t.kind === "ASSET" ? `${t.tag} · ${t.name}` : t.name) : "Removed from this count"}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {formatDateTime(l.draft.updatedAt)}
                        {l.draft.notes && ` · ${l.draft.notes}`}
                      </span>
                      <span className="mt-1 block">
                        <StatusChip kind="sync" status={chip(l, t)} />
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{value(l.draft, t)}</span>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-labelledby="todo-h" className="flex flex-col gap-2">
        <h2 id="todo-h" className="text-lg font-semibold">
          Not counted yet ({todo.length})
        </h2>
        {todo.length > 0 && (
          <ul className="divide-y surface">
            {todo.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => go({ v: "count", a: assignment, t: t.id })}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {t.kind === "ASSET" ? `${t.tag} · ${t.name}` : `${t.name} · ${t.sku}`}
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </FieldScreen>
  );
}
