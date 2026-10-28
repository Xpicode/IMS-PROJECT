"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CloudUpload, Keyboard, ListChecks, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { progress } from "@/lib/field/store";
import type { AssignmentRec } from "@/lib/field/db";
import { formatDateTime } from "@/lib/format";
import { syncSummary, type SyncSummary } from "@/lib/field/outbox";
import { SendResult } from "../send-result";

export function AssignmentView({ id }: { id: string }) {
  const { db, sendCounts, syncing, dataVersion, online, lastSync } = useField();
  const [a, setA] = useState<AssignmentRec | null | undefined>(undefined);
  const [p, setP] = useState({ done: 0, total: 0 });
  const [sum, setSum] = useState<SyncSummary | null>(null);
  const [sent, setSent] = useState<Awaited<ReturnType<typeof sendCounts>> | null>(null);
  useEffect(() => {
    db.assignments.get(id).then(
      (x) => setA(x ?? null),
      () => setA(null),
    );
    progress(db, id).then(setP, () => undefined);
    syncSummary(db, id).then(setSum, () => undefined);
  }, [db, id, dataVersion]);

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
        {sum && sum.received + sum.notSent + sum.attention > 0 && (
          <p className="mt-2 text-[15px]">
            <b className="tabular-nums">{sum.received}</b> received by server ·{" "}
            <b className="tabular-nums">{sum.notSent}</b> not sent
            {sum.attention > 0 && (
              <>
                {" "}
                · <b className="text-danger tabular-nums">{sum.attention}</b> need attention
              </>
            )}
          </p>
        )}
      </section>
      {a.status === "CLOSED" && (
        <p
          className="flex gap-2 rounded-lg border-2 border-warning bg-warning-soft p-3 font-medium text-warning"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          Your supervisor closed this count. Counts not sent yet will come back as conflicts; ask your supervisor before
          counting more.
        </p>
      )}
      {sum && sum.draft > 0 && (
        <Button
          size="lg"
          className="h-14 text-lg"
          loading={syncing}
          onClick={async () => setSent(await sendCounts(id))}
        >
          <CloudUpload className="size-6" aria-hidden /> Send {sum.draft} {sum.draft === 1 ? "count" : "counts"}
        </Button>
      )}
      {sum && sum.draft > 0 && !online && (
        <p className="-mt-2 text-sm text-muted-foreground">
          You&apos;re offline. Tapping Send keeps them ready on this phone and sends them when you&apos;re back online.
        </p>
      )}
      {/* Latest result, including automatic retries after this send. */}
      {sent && <SendResult queued={sent.queued} outcome={lastSync ?? sent.outcome} />}
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
