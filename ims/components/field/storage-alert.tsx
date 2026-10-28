"use client";

import { AlertOctagon } from "lucide-react";
import type { FieldStorageError } from "@/lib/field/store";

/** Impossible to miss: a save failed and nothing was stored (A30). */
export function StorageAlert({ error }: { error: FieldStorageError | Error }) {
  return (
    <div role="alert" className="flex gap-3 rounded-xl border-2 border-danger bg-danger-soft p-4 text-danger">
      <AlertOctagon className="size-7 shrink-0" aria-hidden />
      <div>
        <p className="text-lg font-bold">Not saved</p>
        <p className="mt-1 font-medium">{error.message}</p>
      </div>
    </div>
  );
}
