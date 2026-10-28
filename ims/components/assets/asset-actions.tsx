"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Field } from "@/components/common/field";
import { apiFetch, messageOf } from "@/lib/api-client";

const LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  BORROWED: "Borrowed",
  UNDER_MAINTENANCE: "Under maintenance",
  NEEDS_REVIEW: "Needs review",
  LOST: "Lost",
  RETIRED: "Retired",
};

/** Change status: only the moves allowed by §9.4 are offered; the server checks again. */
export function ChangeStatusButton({
  assetId,
  tag,
  version,
  current,
  next,
}: {
  assetId: string;
  tag: string;
  version: number;
  current: string;
  next: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(next[0] ?? "");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (next.length === 0) return null;

  async function save() {
    setTouched(true);
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/assets/${assetId}/status`, {
        method: "POST",
        body: { status, reason, expectedVersion: version },
      });
      toast.success(`${tag} is now ${LABEL[status]}.`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Change status
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        title={`Change status of ${tag}`}
        description={`Now: ${LABEL[current]}. Borrowing and returns change status automatically once that feature is built.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy}>
              Set to {LABEL[status]}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field id="s-status" label="New status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="s-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {next.map((s) => (
                  <SelectItem key={s} value={s}>
                    {LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id="s-reason"
            label="Reason"
            error={touched && !reason.trim() ? "Say why the status is changing." : undefined}
          >
            <Textarea
              id="s-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={(touched && !reason.trim()) || undefined}
            />
          </Field>
        </div>
      </ResponsiveDialog>
    </>
  );
}
