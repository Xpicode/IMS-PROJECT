"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/common/status-chip";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { SendResult } from "../send-result";
import type { AssignmentRec, OutboxOperation, TargetRec } from "@/lib/field/db";
import { draftStates, sendAgain, syncSummary, type DraftSyncState, type SyncSummary } from "@/lib/field/outbox";
import { formatDateTime } from "@/lib/format";

type Row = { a: AssignmentRec; s: SyncSummary };
type Problem = { op: OutboxOperation; target?: TargetRec; a?: AssignmentRec };

/** Sync screen (§8): what is on this phone, what the server has, and what needs a decision. */
export function SyncView() {
  const { db, user, online, summary, syncing, runSync, lastSync, refreshPending, dataVersion } = useField();
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [lastAt, setLastAt] = useState<string | undefined>();
  const [ran, setRan] = useState(false);

  useEffect(() => {
    (async () => {
      const as = await db.assignments.toArray();
      setRows(await Promise.all(as.map(async (a) => ({ a, s: await syncSummary(db, a.id) }))));
      const states = await draftStates(db);
      const bad: Problem[] = [];
      for (const { op, state } of states.values()) {
        if (op && (["CONFLICT", "REJECTED"] as DraftSyncState[]).includes(state)) {
          bad.push({ op, target: await db.targets.get(op.targetId), a: as.find((x) => x.id === op.sessionId) });
        }
      }
      setProblems(bad);
      setLastAt((await db.syncMeta.get("meta"))?.lastSyncAt);
    })().catch(() => undefined);
  }, [db, dataVersion]);

  const s = summary;
  return (
    <FieldScreen title="Sync" back={() => go({})}>
      <section className="grid grid-cols-3 gap-2 text-center" aria-label="Counts on this phone">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-2xl font-semibold tabular-nums">{s?.notSent ?? "…"}</p>
          <p className="text-sm">not sent</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-2xl font-semibold text-success tabular-nums">{s?.received ?? "…"}</p>
          <p className="text-sm">received by server</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className={`text-2xl font-semibold tabular-nums ${s?.attention ? "text-danger" : ""}`}>
            {s?.attention ?? "…"}
          </p>
          <p className="text-sm">need attention</p>
        </div>
      </section>
      {s && s.draft > 0 && (
        <p className="text-[15px]">
          {s.draft} {s.draft === 1 ? "count hasn't" : "counts haven't"} been sent yet. Open the assignment and tap{" "}
          <b>Send counts</b>.
        </p>
      )}
      <Button
        size="lg"
        className="h-14 text-lg"
        loading={syncing}
        disabled={!s}
        onClick={async () => {
          await runSync();
          setRan(true);
        }}
      >
        <RefreshCw className="size-6" aria-hidden /> Sync now
      </Button>
      <p className="-mt-2 text-sm text-muted-foreground">
        {online
          ? "Sync now sends waiting counts and checks for news from your supervisor (closed counts, recount requests). Waiting counts are also sent by themselves every 30 seconds while the app is open."
          : "You're offline. Counts are kept here and sent when you're back online."}
        {lastAt && ` Last sync ${formatDateTime(lastAt)}.`}
      </p>
      {ran && <SendResult outcome={lastSync} />}

      {problems.length > 0 && (
        <section aria-labelledby="att-h" className="flex flex-col gap-2">
          <h2 id="att-h" className="text-lg font-semibold text-danger">
            Need attention ({problems.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {problems.map(({ op, target, a }) => (
              <li key={op.operationId} className="rounded-xl border-2 border-danger/40 bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {target ? (target.kind === "ASSET" ? `${target.tag} · ${target.name}` : target.name) : "A count"}
                  </span>
                  <StatusChip kind="sync" status={op.status} />
                </div>
                {a && <p className="text-sm text-muted-foreground">{a.name}</p>}
                <p className="mt-2">{op.result?.message}</p>
                <p className="mt-1 font-medium">{op.result?.nextAction}</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" onClick={() => go({ v: "count", a: op.sessionId, t: op.targetId })}>
                    Open count
                  </Button>
                  {op.result?.code !== "RECOUNT_REQUESTED" && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        await sendAgain(db, user.id, op.operationId);
                        refreshPending();
                        await runSync();
                      }}
                    >
                      <Send aria-hidden /> Send again
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length > 0 && (
        <section aria-labelledby="per-h" className="flex flex-col gap-2">
          <h2 id="per-h" className="text-lg font-semibold">
            By assignment
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {rows.map(({ a, s: r }) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  onClick={() => go({ v: "results", a: a.id })}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {a.location.code}
                      {a.status === "CLOSED" && " · closed by supervisor"}
                    </span>
                  </span>
                  <span className="text-right text-sm tabular-nums">
                    {r.received} received
                    <br />
                    {r.notSent} not sent{r.attention ? ` · ${r.attention} attention` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </FieldScreen>
  );
}
