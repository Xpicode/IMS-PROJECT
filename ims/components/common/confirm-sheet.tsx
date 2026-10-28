"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResponsiveDialog } from "./responsive-dialog";
import { messageOf } from "@/lib/api-client";

export type Change = { label: string; from?: string | number | null; to: string | number };

/**
 * For official actions: repeats exactly what will change before it happens,
 * e.g. "Warehouse A: Safety Gloves 120 → 115" (IMS_BUILD_PLAN §3.5).
 * Stays open and shows the error if the action fails.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  changes = [],
  confirmLabel,
  tone = "default",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  changes?: Change[];
  confirmLabel: string;
  tone?: "default" | "destructive";
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !busy && (setError(null), onOpenChange(o))}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={confirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {changes.length > 0 && (
        <ul className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3" aria-label="What will change">
          {changes.map((c) => (
            <li key={c.label} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{c.label}:</span>
              {c.from !== undefined && (
                <>
                  <span className="tabular-nums text-muted-foreground">{c.from ?? "—"}</span>
                  <ArrowRight className="size-4 text-muted-foreground" aria-label="becomes" />
                </>
              )}
              <span className="tabular-nums font-semibold">{c.to}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </ResponsiveDialog>
  );
}
