"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { listDrafts } from "@/lib/field/store";
import type { AssignmentRec, CountDraft, TargetRec } from "@/lib/field/db";
import { formatDateTime } from "@/lib/format";

const COND = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" } as const;

/** My results: everything counted on this phone, editable until submitted (Phase 4). */
export function ResultsView({ assignment }: { assignment: string }) {
  const { db } = useField();
  const [data, setData] = useState<{ a: AssignmentRec | null; targets: TargetRec[]; drafts: CountDraft[] } | null>(
    null,
  );
  useEffect(() => {
    Promise.all([
      db.assignments.get(assignment),
      db.targets.where("sessionId").equals(assignment).toArray(),
      listDrafts(db, assignment),
    ]).then(
      ([a, targets, drafts]) => setData({ a: a ?? null, targets, drafts }),
      () => setData({ a: null, targets: [], drafts: [] }),
    );
  }, [db, assignment]);

  const back = () => go({ v: "assignment", a: assignment });
  if (!data)
    return (
      <FieldScreen title="My results" back={back}>
        <p>Loading…</p>
      </FieldScreen>
    );
  const byId = new Map(data.targets.map((t) => [t.id, t]));
  const done = [...data.drafts].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  const counted = new Set(done.map((d) => d.targetId));
  const todo = data.targets
    .filter((t) => !counted.has(t.id))
    .sort((x, y) => (x.tag ?? x.name).localeCompare(y.tag ?? y.name));
  const value = (d: CountDraft, t?: TargetRec) =>
    d.kind === "STOCK"
      ? `${d.quantity} ${t?.unit ?? ""}`
      : d.found
        ? `Found · ${COND[d.condition ?? "GOOD"]}`
        : "Not found";

  return (
    <FieldScreen
      title="My results"
      subtitle={data.a ? `${data.a.name} · ${data.a.location.code}` : undefined}
      back={back}
    >
      <p className="rounded-lg border bg-muted/50 p-3 text-[15px]">
        These are saved on this phone. Tap any line to change it. Sending them to your supervisor (Submit) comes with
        the next app update.
      </p>
      <section aria-labelledby="done-h" className="flex flex-col gap-2">
        <h2 id="done-h" className="text-lg font-semibold">
          Counted ({done.length})
        </h2>
        {done.length === 0 ? (
          <p className="text-muted-foreground">Nothing counted yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {done.map((d) => {
              const t = byId.get(d.targetId);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => go({ v: "count", a: assignment, t: d.targetId })}
                    className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {t ? (t.kind === "ASSET" ? `${t.tag} · ${t.name}` : t.name) : "Removed from this count"}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {formatDateTime(d.updatedAt)}
                        {d.notes && ` · ${d.notes}`}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{value(d, t)}</span>
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
          <ul className="divide-y rounded-xl border bg-card">
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
