"use client";

import { useEffect, useState } from "react";
import { StatusChip } from "@/components/common/status-chip";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { progress } from "@/lib/field/store";
import type { AssignmentRec } from "@/lib/field/db";

/**
 * Sync screen. shortcut: sending to the server (outbox + Sync now) arrives in
 * Phase 4. Until then it shows exactly what is on this phone and never says "Synced".
 */
export function SyncView() {
  const { db, online, pending } = useField();
  const [rows, setRows] = useState<{ a: AssignmentRec; done: number }[]>([]);
  useEffect(() => {
    db.assignments
      .toArray()
      .then((as) => Promise.all(as.map(async (a) => ({ a, done: (await progress(db, a.id)).done }))))
      .then(setRows, () => undefined);
  }, [db]);
  return (
    <FieldScreen title="Sync" back={() => go({})}>
      <section className="rounded-xl border bg-card p-4">
        <p className="text-3xl font-semibold tabular-nums">{pending ?? "…"}</p>
        <p className="text-[15px]">counts saved on this phone, not yet sent to the server</p>
        <div className="mt-2">
          <StatusChip kind="sync" status="DRAFT" />
        </div>
      </section>
      <p className="rounded-lg border-2 border-warning bg-warning-soft p-3 font-medium text-warning">
        Sending counts to the server comes with the next app update. Until then your counts stay on this phone:
        don&apos;t clear browser data, uninstall the app, or use private browsing.
      </p>
      <p>{online ? "You're online." : "You're offline. That's fine for counting."}</p>
      {rows.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card" aria-label="Per assignment">
          {rows.map(({ a, done }) => (
            <li key={a.id} className="flex items-center justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.name}</span>
                <span className="text-sm text-muted-foreground">{a.location.code}</span>
              </span>
              <span className="tabular-nums">{done} on phone</span>
            </li>
          ))}
        </ul>
      )}
    </FieldScreen>
  );
}
