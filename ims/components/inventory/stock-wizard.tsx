"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Wizard } from "@/components/common/wizard";
import { Field } from "@/components/common/field";
import { NumberInput } from "@/components/common/number-input";
import { EmptyState } from "@/components/common/empty-state";
import { ItemPicker, type PickedItem } from "./item-picker";
import { LocationSelect, type LocationOption } from "./location-select";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";
import { DocumentActions } from "@/components/documents/document-actions";

export type StockMode = "receive" | "issue" | "transfer";

const COPY = {
  receive: {
    title: "Receive stock",
    confirm: "Confirm receipt",
    endpoint: "/api/v1/stock/receipts",
    sign: 1,
    who: "From",
  },
  issue: {
    title: "Give out stock (Issue)",
    confirm: "Confirm issue",
    endpoint: "/api/v1/stock/issues",
    sign: -1,
    who: "Who",
  },
  transfer: {
    title: "Move stock (Transfer)",
    confirm: "Confirm transfer",
    endpoint: "/api/v1/stock/transfers",
    sign: -1,
    who: "Why",
  },
} as const;

type Line = { item: PickedItem; quantity: number | null };
type Result = {
  reference: string;
  /** Official form (issue → Stock Issuance, transfer → Transmittal). */
  documentId?: string;
  lines: {
    sku: string;
    name: string;
    unit: string;
    locationId: string;
    quantity: number;
    before: number;
    after: number;
  }[];
};

/**
 * Receive, Issue, and Transfer share one 4-step frame (principle 3):
 * Where → What → Who → Review & Confirm. The server re-checks everything;
 * the balances shown here are a preview. One Idempotency-Key per wizard, so a
 * retried confirm can never post twice.
 */
export function StockWizard({
  mode,
  locations,
  initialItem,
}: {
  mode: StockMode;
  locations: LocationOption[];
  initialItem?: PickedItem;
}) {
  const c = COPY[mode];
  const [step, setStep] = useState(0);
  const [from, setFrom] = useState<string | null>(locations.length === 1 ? locations[0].id : null);
  const [to, setTo] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(initialItem ? [{ item: initialItem, quantity: null }] : []);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [toBalances, setToBalances] = useState<Record<string, number>>({});
  const [who, setWho] = useState({
    recipientName: "",
    purpose: "",
    source: "",
    externalRef: "",
    reason: "",
    notes: "",
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server said these items are being counted (§7.7 freeze). */
  const [frozen, setFrozen] = useState<string | null>(null);
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionError, setExceptionError] = useState<string | undefined>();
  const [result, setResult] = useState<Result | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const ids = lines.map((l) => l.item.id).join(",");
  useEffect(() => {
    if (!from || !ids) return;
    apiFetch<Record<string, number>>(`/api/v1/stock/balances?locationId=${from}&itemIds=${ids}`).then(
      setBalances,
      () => undefined,
    );
  }, [from, ids, step]);
  useEffect(() => {
    if (mode !== "transfer" || !to || !ids) return;
    apiFetch<Record<string, number>>(`/api/v1/stock/balances?locationId=${to}&itemIds=${ids}`).then(
      setToBalances,
      () => undefined,
    );
  }, [mode, to, ids, step]);

  const loc = (id: string | null) => locations.find((l) => l.id === id);
  const short = (l: Line) => c.sign < 0 && l.quantity !== null && l.quantity > (balances[l.item.id] ?? 0);

  const stepErrors = [
    !from ? "Pick a location." : mode === "transfer" && !to ? "Pick where the stock goes." : null,
    lines.length === 0
      ? "Add at least one item."
      : lines.some((l) => !l.quantity)
        ? "Enter a quantity for every item."
        : lines.some(short)
          ? "Some quantities are more than what's on hand. Lower them first."
          : null,
    mode === "issue" && (!who.recipientName.trim() || !who.purpose.trim())
      ? "Enter who receives it and what it's for."
      : null,
    null,
  ];

  function next() {
    setTouched(true);
    if (stepErrors[step]) return;
    setTouched(false);
    setError(null);
    setStep((s) => s + 1);
  }

  async function confirm() {
    if (frozen && exceptionReason.trim().length < 3) {
      setExceptionError("Say why stock has to move while it is being counted.");
      return;
    }
    setExceptionError(undefined);
    setBusy(true);
    setError(null);
    const body = {
      ...(mode === "transfer"
        ? { fromLocationId: from, toLocationId: to, reason: who.reason || undefined }
        : { locationId: from }),
      lines: lines.map((l) => ({ itemId: l.item.id, quantity: l.quantity })),
      ...(mode === "issue" ? { recipientName: who.recipientName, purpose: who.purpose } : {}),
      ...(mode === "receive" ? { source: who.source || undefined, externalRef: who.externalRef || undefined } : {}),
      notes: who.notes || undefined,
      ...(frozen ? { countException: { reason: exceptionReason } } : {}),
    };
    try {
      setResult(await apiFetch<Result>(c.endpoint, { method: "POST", body, idempotencyKey: key }));
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "COUNT_IN_PROGRESS") {
        // Stay on review: the person can go ahead with a written exception.
        setFrozen(e.message);
        setKey(crypto.randomUUID());
        return;
      }
      setError(messageOf(e));
      // Stock changed meanwhile: refresh the preview so the numbers are honest.
      if (e instanceof ApiClientError && e.status === 409) setStep(1);
      // A new request after the user edits; keep the same key only for pure retries.
      if (e instanceof ApiClientError && e.status !== 0 && e.status < 500) setKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  if (locations.length === 0) {
    return (
      <EmptyState
        title="No location you can move stock at"
        description="You need full access to at least one active location. Ask an administrator."
        action={
          <Button asChild variant="outline">
            <Link href="/stock">Back to stock</Link>
          </Button>
        }
      />
    );
  }

  if (result) {
    return (
      <section
        className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center"
        aria-live="polite"
      >
        <CheckCircle2 className="size-12 text-success" aria-hidden />
        <h1 className="text-2xl font-semibold">
          Done: <span className="whitespace-nowrap">{result.reference}</span>
        </h1>
        <ul className="w-full text-left">
          {result.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 border-b py-2 last:border-0">
              <span>
                {loc(l.locationId)?.code ?? ""}: {l.name}
              </span>
              <span className="tabular-nums">
                {l.before} → <b>{l.after}</b> {l.unit}
              </span>
            </li>
          ))}
        </ul>
        {result.documentId && (
          <div className="w-full rounded-lg border bg-muted/40 p-3 text-left">
            <p className="mb-2 font-medium">{mode === "issue" ? "Stock Issuance form" : "Transmittal form"}</p>
            <DocumentActions documentId={result.documentId} showStatus={false} />
          </div>
        )}
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button asChild className="sm:flex-1">
            <Link href="/stock">Done</Link>
          </Button>
          <Button variant="outline" className="sm:flex-1" onClick={() => window.location.reload()}>
            Start another
          </Button>
        </div>
      </section>
    );
  }

  const err = touched ? stepErrors[step] : null;
  return (
    <Wizard
      title={c.title}
      steps={["Where", "What", c.who, "Review"]}
      current={step}
      onBack={() => (setStep((s) => s - 1), setError(null))}
      onNext={next}
      confirmLabel={c.confirm}
      onConfirm={confirm}
      confirming={busy}
      cancel={
        <Button asChild variant="outline">
          <Link href="/stock">Cancel</Link>
        </Button>
      }
    >
      {err && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      )}
      {step === 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="w-from" label={mode === "transfer" ? "From" : mode === "receive" ? "Receive at" : "Issue from"}>
            <LocationSelect id="w-from" value={from} onChange={setFrom} options={locations} />
          </Field>
          {mode === "transfer" && (
            <Field id="w-to" label="To">
              <LocationSelect id="w-to" value={to} onChange={setTo} options={locations} exclude={from} />
            </Field>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <Field id="w-item" label="Add item" hint="Type a name or SKU, or scan a label, then press Enter.">
            <ItemPicker
              id="w-item"
              tracking="STOCK"
              autoFocus
              exclude={lines.map((l) => l.item.id)}
              onPick={(item) => setLines((ls) => [...ls, { item, quantity: null }])}
            />
          </Field>
          {lines.length === 0 ? (
            <p className="text-muted-foreground">No items yet. Search or scan to add the first one.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border" aria-label="Items">
              {lines.map((l, i) => (
                <li key={l.item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {l.item.sku} · on hand at {loc(from)?.code}:{" "}
                      <span className="tabular-nums">{balances[l.item.id] ?? "…"}</span> {l.item.unitCode}
                    </p>
                    {short(l) && (
                      <p className="text-sm font-medium text-destructive" role="alert">
                        Only {balances[l.item.id] ?? 0} {l.item.unitCode} left at {loc(from)?.code}. Lower the quantity.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:w-64">
                    <NumberInput
                      id={`q-${l.item.id}`}
                      label={`quantity of ${l.item.name}`}
                      value={l.quantity}
                      invalid={short(l) || (touched && !l.quantity)}
                      onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: v } : x)))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${l.item.name}`}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 md:grid-cols-2">
          {mode === "issue" && (
            <>
              <Field
                id="w-recipient"
                label="Given to"
                error={touched && !who.recipientName.trim() ? "Enter who receives the stock." : undefined}
              >
                <Input
                  id="w-recipient"
                  value={who.recipientName}
                  onChange={(e) => setWho({ ...who, recipientName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field
                id="w-purpose"
                label="Purpose"
                hint="Work order, project, or reason."
                error={touched && !who.purpose.trim() ? "Enter what it's for." : undefined}
              >
                <Input
                  id="w-purpose"
                  value={who.purpose}
                  onChange={(e) => setWho({ ...who, purpose: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </>
          )}
          {mode === "receive" && (
            <>
              <Field id="w-source" label="Received from" optional hint="Supplier, project, or return.">
                <Input
                  id="w-source"
                  value={who.source}
                  onChange={(e) => setWho({ ...who, source: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field id="w-ref" label="Delivery note / PO number" optional>
                <Input
                  id="w-ref"
                  value={who.externalRef}
                  onChange={(e) => setWho({ ...who, externalRef: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </>
          )}
          {mode === "transfer" && (
            <Field id="w-reason" label="Reason" optional>
              <Input
                id="w-reason"
                value={who.reason}
                onChange={(e) => setWho({ ...who, reason: e.target.value })}
                autoComplete="off"
              />
            </Field>
          )}
          <div className="md:col-span-2">
            <Field id="w-notes" label="Notes" optional>
              <Textarea id="w-notes" value={who.notes} onChange={(e) => setWho({ ...who, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Review & confirm</h2>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {frozen && (
            <div className="flex flex-col gap-3 rounded-xl border-2 border-warning bg-warning-soft p-4" role="alert">
              <p className="font-semibold text-warning">Stock count in progress</p>
              <p>{frozen}</p>
              <p className="text-sm">
                To go ahead anyway, write why below and confirm again. It is recorded as an exception, and these lines
                will need a recount before the count can be approved.
              </p>
              <Field id="count-exception" label="Reason for moving stock during the count" error={exceptionError}>
                <Textarea
                  id="count-exception"
                  value={exceptionReason}
                  onChange={(e) => {
                    setExceptionReason(e.target.value);
                    setExceptionError(undefined);
                  }}
                  aria-invalid={!!exceptionError || undefined}
                  maxLength={300}
                  rows={2}
                />
              </Field>
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">
              {mode === "transfer" ? "From" : mode === "receive" ? "At" : "From"}
            </dt>
            <dd>
              {loc(from)?.code} · {loc(from)?.name}
            </dd>
            {mode === "transfer" && (
              <>
                <dt className="text-muted-foreground">To</dt>
                <dd>
                  {loc(to)?.code} · {loc(to)?.name}
                </dd>
              </>
            )}
            {mode === "issue" && (
              <>
                <dt className="text-muted-foreground">Given to</dt>
                <dd>
                  {who.recipientName} – {who.purpose}
                </dd>
              </>
            )}
            {mode === "receive" && (who.source || who.externalRef) && (
              <>
                <dt className="text-muted-foreground">From</dt>
                <dd>{[who.source, who.externalRef].filter(Boolean).join(" · ")}</dd>
              </>
            )}
            {(who.reason || who.notes) && (
              <>
                <dt className="text-muted-foreground">Notes</dt>
                <dd>{[who.reason, who.notes].filter(Boolean).join(" · ")}</dd>
              </>
            )}
          </dl>
          <ul className="flex flex-col divide-y rounded-lg border bg-muted/40" aria-label="What will change">
            {lines.map((l) => {
              const before = balances[l.item.id] ?? 0;
              const q = l.quantity ?? 0;
              return (
                <li key={l.item.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 p-3">
                  <span className="font-medium">
                    {l.item.name} <span className="font-normal text-muted-foreground">{l.item.sku}</span>
                  </span>
                  <span className="tabular-nums">
                    {q} {l.item.unitCode} · {loc(from)?.code}: {before} → <b>{before + c.sign * q}</b>
                    {mode === "transfer" && (
                      <>
                        {" "}
                        · {loc(to)?.code}: {toBalances[l.item.id] ?? 0} → <b>{(toBalances[l.item.id] ?? 0) + q}</b>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Wizard>
  );
}
