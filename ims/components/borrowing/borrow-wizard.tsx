"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, FileSearch, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FocusHeading } from "@/components/common/focus-heading";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wizard } from "@/components/common/wizard";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { NumberInput } from "@/components/common/number-input";
import { ItemPicker, type PickedItem } from "@/components/inventory/item-picker";
import { LocationSelect, type LocationOption } from "@/components/inventory/location-select";
import { DocumentActions } from "@/components/documents/document-actions";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";
import { newId } from "@/lib/utils";

type Cond = "GOOD" | "FAIR" | "DAMAGED";
const COND: Record<Cond, string> = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
type Line = { item: PickedItem; quantity: number | null; condition: Cond; accessories: string };
type Result = {
  id: string;
  reference: string;
  documentId: string;
  lines: { sku: string; quantity: number; unit: string }[];
};

export type BorrowInitial = {
  draftId?: string;
  draftReference?: string;
  locationId?: string;
  /** From a field request: the items and how many were asked for. */
  lines?: { item: PickedItem; quantity: number }[];
  borrowerName?: string;
  borrowerDept?: string;
  purpose?: string;
  dueDate?: string;
  notes?: string;
};

/** Date input value (YYYY-MM-DD) → end of that working day in Manila. */
const dueIso = (d: string) => (d ? `${d}T17:00:00+08:00` : null);

/**
 * Borrow items (§7.5): Where → What → Who → Review & Confirm release.
 * Releasing takes the quantities out of the location's stock. The on-hand numbers
 * here are a preview; the server checks again inside one locked transaction.
 * One Idempotency-Key per wizard.
 */
export function BorrowWizard({ locations, initial = {} }: { locations: LocationOption[]; initial?: BorrowInitial }) {
  const [step, setStep] = useState(initial.draftId && initial.locationId ? 1 : 0);
  const [from, setFrom] = useState<string | null>(
    initial.locationId ?? (locations.length === 1 ? locations[0].id : null),
  );
  const [lines, setLines] = useState<Line[]>(
    (initial.lines ?? []).map((l) => ({ ...l, condition: "GOOD", accessories: "" })),
  );
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [who, setWho] = useState({
    borrowerName: initial.borrowerName ?? "",
    borrowerDept: initial.borrowerDept ?? "",
    purpose: initial.purpose ?? "",
    dueDate: initial.dueDate ?? "",
    receivedByName: "",
    preparedByName: "",
    notes: initial.notes ?? "",
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [key, setKey] = useState(() => newId());
  const ids = lines.map((l) => l.item.id).join(",");
  useEffect(() => {
    if (!from || !ids) return;
    apiFetch<Record<string, number>>(`/api/v1/stock/balances?locationId=${from}&itemIds=${ids}`).then(
      setBalances,
      () => undefined,
    );
  }, [from, ids, step]);

  const loc = locations.find((l) => l.id === from);
  // Only once the on-hand number has loaded; the server checks again on confirm.
  const short = (l: Line) => l.quantity !== null && l.item.id in balances && l.quantity > balances[l.item.id];

  const stepErrors = [
    !from ? "Pick where the items are released from." : null,
    lines.length === 0
      ? "Add at least one item."
      : lines.some((l) => !l.quantity)
        ? "Enter how many of each item."
        : lines.some(short)
          ? "Some quantities are more than what is on hand. Lower them."
          : null,
    !who.borrowerName.trim() || !who.purpose.trim() ? "Enter who is borrowing it and what it's for." : null,
    null,
  ];
  function next() {
    setTouched(true);
    if (stepErrors[step]) return;
    setTouched(false);
    setError(null);
    setStep((s) => s + 1);
  }

  const body = () => ({
    locationId: from,
    ...(initial.draftId ? { draftId: initial.draftId } : {}),
    borrowerName: who.borrowerName.trim(),
    borrowerDept: who.borrowerDept.trim() || undefined,
    purpose: who.purpose.trim(),
    dueAt: dueIso(who.dueDate),
    receivedByName: who.receivedByName.trim() || undefined,
    preparedByName: who.preparedByName.trim() || undefined,
    notes: who.notes.trim() || undefined,
    lines: lines.map((l) => ({
      itemId: l.item.id,
      quantity: l.quantity,
      condition: l.condition,
      accessories: l.accessories.trim() || undefined,
    })),
  });

  async function preview() {
    setPreviewing(true);
    const w = window.open("", "_blank");
    try {
      const r = await fetch("/api/v1/borrowings/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      if (!r.ok) throw new Error("The preview could not be made. Try again.");
      const url = URL.createObjectURL(await r.blob());
      if (w) w.location.href = url;
      else window.open(url, "_blank");
    } catch (e) {
      w?.close();
      setError(messageOf(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await apiFetch<Result>("/api/v1/borrowings/release", { method: "POST", body: body(), idempotencyKey: key }),
      );
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiClientError && e.status !== 0 && e.status < 500) setKey(newId());
    } finally {
      setBusy(false);
    }
  }

  if (locations.length === 0) {
    return (
      <EmptyState
        title="No location you can release items from"
        description="You need supervisor access to at least one active location. Ask an administrator."
        action={
          <Button asChild variant="outline">
            <Link href="/borrowing">Back to loans</Link>
          </Button>
        }
      />
    );
  }

  if (result) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center gap-4 surface p-6 text-center" aria-live="polite">
        <CheckCircle2 className="size-12 text-success" aria-hidden />
        <FocusHeading className="text-2xl font-semibold">
          Released: <span className="whitespace-nowrap">{result.reference}</span>
        </FocusHeading>
        <p>
          {result.lines.map((l) => `${l.quantity} ${l.unit} ${l.sku}`).join(", ")} lent to <b>{who.borrowerName}</b> and
          taken out of stock at {loc?.code}.
        </p>
        <div className="w-full rounded-lg border bg-muted/40 p-3 text-left">
          <p className="mb-2 font-medium">Equipment Borrowing form</p>
          <p className="mb-3 text-sm text-muted-foreground">
            Print it, and have the borrower sign it when they take the items.
          </p>
          <DocumentActions documentId={result.documentId} showStatus={false} />
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button asChild className="sm:flex-1">
            <Link href={`/borrowing/${result.id}`}>Open loan</Link>
          </Button>
          <Button asChild variant="outline" className="sm:flex-1">
            <Link href="/borrowing">Done</Link>
          </Button>
        </div>
      </section>
    );
  }

  const err = touched ? stepErrors[step] : null;
  return (
    <Wizard
      title={initial.draftId ? "Release borrowing request" : "Borrow items"}
      steps={["Where", "What", "Who", "Review"]}
      current={step}
      onBack={() => (setStep((s) => s - 1), setError(null))}
      onNext={next}
      confirmLabel="Confirm release"
      onConfirm={confirm}
      confirming={busy}
      cancel={
        <Button asChild variant="outline">
          <Link href="/borrowing">Cancel</Link>
        </Button>
      }
    >
      {err && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      )}
      {initial.draftId && step < 3 && (
        <Alert className="mb-4">
          <AlertDescription>
            Request prepared in the field. Check the items, quantities and details, then release. Nothing has changed
            yet.
          </AlertDescription>
        </Alert>
      )}

      {step === 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="b-from" label="Release from" hint="The stock is taken from here.">
            <LocationSelect id="b-from" value={from} onChange={setFrom} options={locations} invalid={!!err} />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <Field id="b-item" label="Add item" hint="Type a name or SKU, or scan a label, then press Enter.">
            <ItemPicker
              id="b-item"
              autoFocus
              exclude={lines.map((l) => l.item.id)}
              onPick={(item) => setLines((ls) => [...ls, { item, quantity: 1, condition: "GOOD", accessories: "" }])}
            />
          </Field>
          <h2 className="mt-2 font-semibold">To release ({lines.length})</h2>
          {lines.length === 0 ? (
            <p className="text-muted-foreground">No items yet. Search or scan to add the first one.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border" aria-label="Items to release">
              {lines.map((l, i) => (
                <li key={l.item.id} className="grid gap-3 p-3 md:grid-cols-[1fr_15rem_9rem_1fr_auto] md:items-end">
                  <div className="min-w-0">
                    <p className="font-medium">{l.item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {l.item.sku} · on hand at {loc?.code}:{" "}
                      <span className="tabular-nums">{balances[l.item.id] ?? "…"}</span> {l.item.unitCode}
                    </p>
                    {short(l) && (
                      <p className="text-sm font-medium text-destructive" role="alert">
                        Only {balances[l.item.id] ?? 0} {l.item.unitCode} left at {loc?.code}. Lower the quantity.
                      </p>
                    )}
                  </div>
                  <Field id={`q-${l.item.id}`} label={`How many (${l.item.unitCode})`}>
                    <NumberInput
                      id={`q-${l.item.id}`}
                      label={`quantity of ${l.item.name}`}
                      min={1}
                      value={l.quantity}
                      invalid={short(l) || (touched && !l.quantity)}
                      onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: v } : x)))}
                    />
                  </Field>
                  <Field id={`cond-${l.item.id}`} label="Condition">
                    <Select
                      value={l.condition}
                      onValueChange={(v) =>
                        setLines((ls) => ls.map((x, j) => (j === i ? { ...x, condition: v as Cond } : x)))
                      }
                    >
                      <SelectTrigger id={`cond-${l.item.id}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GOOD">Good</SelectItem>
                        <SelectItem value="FAIR">Fair</SelectItem>
                        <SelectItem value="DAMAGED">Damaged</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id={`acc-${l.item.id}`} label="Accessories" optional>
                    <Input
                      id={`acc-${l.item.id}`}
                      value={l.accessories}
                      maxLength={300}
                      placeholder="e.g. charger, 2 batteries, case"
                      onChange={(e) =>
                        setLines((ls) => ls.map((x, j) => (j === i ? { ...x, accessories: e.target.value } : x)))
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${l.item.name}`}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            id="b-name"
            label="Borrower"
            hint="The person responsible for the items."
            error={touched && !who.borrowerName.trim() ? "Enter who is borrowing it." : undefined}
          >
            <Input
              id="b-name"
              value={who.borrowerName}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => setWho({ ...who, borrowerName: e.target.value })}
            />
          </Field>
          <Field id="b-dept" label="Department or site" optional>
            <Input
              id="b-dept"
              value={who.borrowerDept}
              maxLength={120}
              onChange={(e) => setWho({ ...who, borrowerDept: e.target.value })}
            />
          </Field>
          <Field
            id="b-purpose"
            label="Purpose"
            hint="Work order, project, or job."
            error={touched && !who.purpose.trim() ? "Enter what it's for." : undefined}
          >
            <Input
              id="b-purpose"
              value={who.purpose}
              maxLength={300}
              onChange={(e) => setWho({ ...who, purpose: e.target.value })}
            />
          </Field>
          <Field id="b-due" label="Due back" optional hint="Loans past this date show as overdue.">
            <Input
              id="b-due"
              type="date"
              value={who.dueDate}
              onChange={(e) => setWho({ ...who, dueDate: e.target.value })}
            />
          </Field>
          <Field
            id="b-recv"
            label="Physically received by"
            optional
            hint="Only if someone else picks it up for the borrower."
          >
            <Input
              id="b-recv"
              value={who.receivedByName}
              maxLength={120}
              onChange={(e) => setWho({ ...who, receivedByName: e.target.value })}
            />
          </Field>
          <div className="md:col-span-2">
            <Field id="b-notes" label="Notes" optional>
              <Textarea
                id="b-notes"
                value={who.notes}
                maxLength={1000}
                onChange={(e) => setWho({ ...who, notes: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Review & confirm</h2>
            <Button type="button" variant="outline" onClick={preview} loading={previewing}>
              <FileSearch aria-hidden /> Preview form (DRAFT)
            </Button>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">From</dt>
            <dd>
              {loc?.code} · {loc?.name}
            </dd>
            <dt className="text-muted-foreground">Borrower</dt>
            <dd>
              {who.borrowerName}
              {who.borrowerDept ? ` · ${who.borrowerDept}` : ""}
            </dd>
            <dt className="text-muted-foreground">Purpose</dt>
            <dd>{who.purpose}</dd>
            <dt className="text-muted-foreground">Due back</dt>
            <dd>
              {who.dueDate
                ? new Date(`${who.dueDate}T00:00:00`).toLocaleDateString("en-PH", { dateStyle: "medium" })
                : "No due date"}
            </dd>
            {who.receivedByName && (
              <>
                <dt className="text-muted-foreground">Received by</dt>
                <dd>{who.receivedByName}</dd>
              </>
            )}
          </dl>
          <ul className="flex flex-col divide-y rounded-lg border bg-muted/40" aria-label="What will change">
            {lines.map((l) => {
              const before = balances[l.item.id] ?? 0;
              return (
                <li key={l.item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3">
                  <span>
                    <b>
                      {l.quantity} {l.item.unitCode}
                    </b>{" "}
                    {l.item.name}
                    <span className="block text-sm text-muted-foreground">
                      {COND[l.condition]}
                      {l.accessories ? ` · ${l.accessories}` : ""}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">
                    {loc?.code}: {before} → <b>{before - (l.quantity ?? 0)}</b> {l.item.unitCode}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="md:max-w-sm">
            <Field
              id="b-prep"
              label="Prepared by"
              optional
              hint={
                initial.draftId
                  ? "Who got the items ready. Leave empty to keep the person who made the request."
                  : "Who got the items ready. Leave empty to use your name."
              }
            >
              <Input
                id="b-prep"
                value={who.preparedByName}
                maxLength={120}
                autoComplete="off"
                onChange={(e) => setWho({ ...who, preparedByName: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            Confirming takes these quantities out of stock, gives the loan its official number, and makes the Equipment
            Borrowing form.
          </p>
        </div>
      )}
    </Wizard>
  );
}
