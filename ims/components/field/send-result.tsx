"use client";

import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import type { SyncOutcome } from "@/lib/field/outbox";
import { go } from "./field-context";

/** Plain answer after "Send counts" / "Sync now": what reached the server and what didn't. */
export function SendResult({ queued, outcome }: { queued?: number; outcome: SyncOutcome | null }) {
  if (!outcome || outcome.state === "nothing") {
    return queued ? (
      <p role="status" className="flex gap-2 rounded-lg border bg-muted/50 p-3">
        <Clock className="mt-0.5 size-5 shrink-0" aria-hidden /> {queued} ready to send on this phone.
      </p>
    ) : null;
  }
  if (outcome.state !== "done") {
    return (
      <p
        role="status"
        className="flex gap-2 rounded-lg border-2 border-warning bg-warning-soft p-3 font-medium text-warning"
      >
        <Clock className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          {queued ? `${queued} ready to send. ` : ""}
          {outcome.message ?? "Not sent yet. Your counts are safe on this phone."}
        </span>
      </p>
    );
  }
  const problems = outcome.conflicts + outcome.rejected;
  return (
    <div
      role="status"
      className={`flex gap-2 rounded-lg border-2 p-3 font-medium ${problems ? "border-danger bg-danger-soft text-danger" : "border-success bg-success-soft text-success"}`}
    >
      {problems ? (
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
      )}
      <span>
        {outcome.acked} received by the server.
        {outcome.failed > 0 && ` ${outcome.failed} will be retried.`}
        {problems > 0 && (
          <>
            {" "}
            {problems} need attention.{" "}
            <button type="button" className="underline" onClick={() => go({ v: "sync" })}>
              See why
            </button>
          </>
        )}
      </span>
    </div>
  );
}
