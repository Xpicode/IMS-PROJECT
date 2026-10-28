"use client";

import { useEffect, useState } from "react";
import { Keyboard, ListChecks, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { progress } from "@/lib/field/store";
import type { AssignmentRec } from "@/lib/field/db";
import { formatDateTime } from "@/lib/format";

export function AssignmentView({ id }: { id: string }) {
  const { db } = useField();
  const [a, setA] = useState<AssignmentRec | null | undefined>(undefined);
  const [p, setP] = useState({ done: 0, total: 0 });
  useEffect(() => {
    db.assignments.get(id).then(
      (x) => setA(x ?? null),
      () => setA(null),
    );
    progress(db, id).then(setP, () => undefined);
  }, [db, id]);

  if (a === undefined)
    return (
      <FieldScreen title="Assignment" back={() => go({})}>
        <p>Loading…</p>
      </FieldScreen>
    );
  if (a === null)
    return (
      <FieldScreen title="Assignment" back={() => go({})}>
        <p>This assignment isn&apos;t on this phone. Go back and download it first.</p>
      </FieldScreen>
    );
  return (
    <FieldScreen title={a.location.name} subtitle={`${a.name} · ${a.reference}`} back={() => go({})}>
      <section className="rounded-xl border bg-card p-4">
        <p className="text-3xl font-semibold tabular-nums">
          {p.done} <span className="text-lg font-normal text-muted-foreground">/ {p.total} done</span>
        </p>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full bg-primary"
            style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 0}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Downloaded {formatDateTime(a.downloadedAt)}
          {a.dueAt && <> · due {formatDateTime(a.dueAt)}</>}
        </p>
        {a.notes && <p className="mt-2">{a.notes}</p>}
      </section>
      <Button size="lg" className="h-16 text-xl" onClick={() => go({ v: "scan", a: id })}>
        <ScanLine className="size-7" aria-hidden /> Scan to count
      </Button>
      <Button size="lg" variant="outline" onClick={() => go({ v: "scan", a: id, t: "type" })}>
        <Keyboard aria-hidden /> Type a code
      </Button>
      <Button size="lg" variant="outline" onClick={() => go({ v: "results", a: id })}>
        <ListChecks aria-hidden /> My results ({p.done})
      </Button>
    </FieldScreen>
  );
}
