"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { NumberInput } from "@/components/common/number-input";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";
import { newId } from "@/lib/utils";

export type UseItem = { id: string; name: string; unitCode: string };
export type UseLocation = { id: string; code: string; name: string };

/**
 * "Use": quick stock out for things used up in the office (1 pack of bond paper → −1).
 * Recorded as an ordinary Issue to the person using it, so the ledger, Recent activity,
 * reports, low-stock warnings and counts all see it; it never goes below zero.
 */
export function UseStockDialog({
  item,
  locations,
  defaultLocationId,
  userName,
  open,
  onOpenChange,
}: {
  item: UseItem;
  locations: UseLocation[];
  defaultLocationId?: string;
  userName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [loc, setLoc] = useState(defaultLocationId ?? locations[0]?.id ?? "");
  const [qty, setQty] = useState<number | null>(1);
  const [who, setWho] = useState(userName);
  const [where, setWhere] = useState("");
  const [note, setNote] = useState("");
  const [onHand, setOnHand] = useState<{ loc: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => newId());

  useEffect(() => {
    if (!open || !loc) return;
    let alive = true;
    apiFetch<Record<string, number>>(`/api/v1/stock/balances?locationId=${loc}&itemIds=${item.id}`).then(
      (b) => alive && setOnHand({ loc, n: b[item.id] ?? 0 }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [open, loc, item.id]);

  const here = locations.find((l) => l.id === loc);
  const left = onHand?.loc === loc ? onHand.n : null;
  const tooMany = left !== null && qty !== null && qty > left;

  async function use() {
    if (!qty || !here) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/stock/issues", {
        method: "POST",
        idempotencyKey: key,
        body: {
          locationId: loc,
          recipientName: who.trim(),
          // "Used at Office: printing reports" (shown in history, reports and the form).
          purpose: `Used${where.trim() ? ` at ${where.trim()}` : ""}${note.trim() ? `: ${note.trim()}` : ""}`,
          lines: [{ itemId: item.id, quantity: qty }],
        },
      });
      toast.success(
        `${who.trim()} used ${qty} ${item.unitCode} of ${item.name}${where.trim() ? ` at ${where.trim()}` : ""}.${left !== null ? ` ${left - qty} left at ${here.code}.` : ""}`,
      );
      setQty(1);
      setNote("");
      setKey(newId());
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiClientError && e.status !== 0 && e.status < 500) setKey(newId());
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={`Use ${item.name}`}
      description="Takes it out of stock, for things used up (like a pack of bond paper)."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={use} loading={busy} disabled={!qty || !here || tooMany || !who.trim()}>
            <MinusCircle aria-hidden /> Use {qty ?? ""} {item.unitCode}
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
        {locations.length > 1 && (
          <Field id="use-loc" label="Take from" hint="The stock location it comes out of.">
            <select
              id="use-loc"
              value={loc}
              onChange={(e) => setLoc(e.target.value)}
              className="h-12 w-full rounded-lg border border-input bg-card px-3 text-base"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          id="use-qty"
          label="How many?"
          hint={left === null ? "Checking what's on hand…" : `On hand at ${here?.code}: ${left} ${item.unitCode}`}
          error={tooMany ? `Only ${left} ${item.unitCode} left at ${here?.code}.` : undefined}
        >
          <NumberInput id="use-qty" label="how many" value={qty} onChange={setQty} min={1} invalid={tooMany} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="use-who" label="Who is using it" error={who.trim() ? undefined : "Enter who is using it."}>
            <Input
              id="use-who"
              value={who}
              maxLength={120}
              autoComplete="off"
              aria-invalid={!who.trim() || undefined}
              onChange={(e) => setWho(e.target.value)}
            />
          </Field>
          <Field id="use-where" label="Where it's used" optional>
            <Input
              id="use-where"
              value={where}
              maxLength={80}
              placeholder="e.g. Office, Accounting"
              onChange={(e) => setWhere(e.target.value)}
            />
          </Field>
        </div>
        <Field id="use-note" label="What for" optional>
          <Input
            id="use-note"
            value={note}
            maxLength={200}
            placeholder="e.g. printing monthly reports"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </ResponsiveDialog>
  );
}

/** The item page's "Use" button. */
export function UseStockButton(props: Omit<Parameters<typeof UseStockDialog>[0], "open" | "onOpenChange">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={props.locations.length === 0}>
        <MinusCircle aria-hidden /> Use
      </Button>
      <UseStockDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}
