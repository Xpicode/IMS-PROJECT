"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, PackageCheck, PackageX, Send } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NumberInput } from "@/components/common/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/field";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { LocationSelect, type LocationOption } from "@/components/inventory/location-select";
import { DocumentActions } from "@/components/documents/document-actions";
import { apiFetch } from "@/lib/api-client";
import { newId } from "@/lib/utils";
import { CameraPicker } from "@/components/common/camera-picker";
import { outstandingReturnLine, resolveCameraCode } from "@/lib/camera-selection";
import {
  EvidencePicker,
  EvidenceLinks,
  uploadReturnPhotos,
  type LocalPhoto,
} from "@/components/common/evidence-photos";

type Cond = "GOOD" | "FAIR" | "DAMAGED";
export type LoanLine = {
  id: string;
  status: "PENDING" | "OUT" | "RETURNED";
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  returnedQuantity: number;
  conditionOut: Cond | null;
  accessories: string | null;
  returns: { reference: string; quantity: number; condition: Cond; notes: string | null }[];
  evidenceIds?: string[];
};
export type LoanDoc = { id: string; reference: string; type: string };
/** What is coming back of one line in this return. */
type Pick = { quantity: number | null; condition: Cond; notes: string; photos: LocalPhoto[] };

const NO_PICK: Pick = { quantity: null, condition: "GOOD", notes: "", photos: [] };
const COND: Record<Cond, string> = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
const DOC: Record<string, string> = {
  EQUIPMENT_BORROWING: "Equipment Borrowing form",
  RETURN_ACKNOWLEDGMENT: "Return Acknowledgment",
};

/** Lines, documents, the Return flow (§7.6), and closing a loan whose rest won't come back. */
export function LoanDetail({
  loanId,
  status,
  borrowerName,
  lines,
  documents,
  canAct,
  locationId,
  locations,
  startReturning = false,
}: {
  startReturning?: boolean;
  loanId: string;
  status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
  borrowerName: string;
  lines: LoanLine[];
  documents: LoanDoc[];
  canAct: boolean;
  locationId: string;
  locations: LocationOption[];
}) {
  const router = useRouter();
  const out = lines.filter((l) => l.status === "OUT");
  const [returning, setReturning] = useState(startReturning && status === "OPEN" && canAct);
  const [picked, setPicks] = useState<Record<string, Pick>>({});
  const current = useRef({ lines, picked });
  useEffect(() => {
    current.current = { lines, picked };
  });
  const pickOf = (id: string) => picked[id] ?? NO_PICK;
  const left = (l: LoanLine) => l.quantity - l.returnedQuantity;
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [by, setBy] = useState(borrowerName);
  const [to, setTo] = useState(locationId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [key, setKey] = useState(() => newId());
  const [photoBusy, setPhotoBusy] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<{
    reference: string;
    documentId: string;
    loanStatus: string;
    returned: number;
    total: number;
  } | null>(null);

  const chosen = out.filter((l) => (pickOf(l.id).quantity ?? 0) > 0);
  const tooMany = out.filter((l) => (pickOf(l.id).quantity ?? 0) > left(l));
  const set = (id: string, p: Partial<Pick>) => setPicks((ps) => ({ ...ps, [id]: { ...(ps[id] ?? NO_PICK), ...p } }));
  const comingBack = chosen.reduce((n, l) => n + (pickOf(l.id).quantity ?? 0), 0);
  const stillOut = out.reduce((n, l) => n + left(l), 0);
  const errorText =
    touched && !chosen.length
      ? "Enter how many came back of at least one item."
      : touched && tooMany.length
        ? `${tooMany[0].name}: only ${left(tooMany[0])} ${tooMany[0].unit} is still out.`
        : touched && !by.trim()
          ? "Enter who brought it back."
          : null;

  return (
    <div className="flex flex-col gap-6">
      {done && (
        <section
          className="flex flex-col gap-3 rounded-xl border-2 border-success/40 bg-success-soft p-4"
          aria-live="polite"
        >
          <p className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 className="size-6 text-success" aria-hidden /> Return {done.reference} saved
          </p>
          <p>
            {done.returned} of {done.total} back, and put back into stock.{" "}
            {done.loanStatus === "CLOSED"
              ? "Everything is back, so the loan is closed."
              : "The loan stays open for the rest."}
          </p>
          <DocumentActions documentId={done.documentId} showStatus={false} />
        </section>
      )}

      <section aria-labelledby="lines-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lines-h" className="text-lg font-semibold">
            Items
          </h2>
          {status === "OPEN" && canAct && !returning && !closing && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setReturning(true)}>
                <PackageCheck aria-hidden /> Return items
              </Button>
              <Button variant="outline" onClick={() => setClosing(true)}>
                <PackageX aria-hidden /> Close – rest not returned
              </Button>
            </div>
          )}
          {status === "DRAFT" && canAct && (
            <Button asChild>
              <Link href={`/borrowing/new?draft=${loanId}`}>
                <Send aria-hidden /> Check and release
              </Link>
            </Button>
          )}
        </div>
        {returning && (
          <CameraPicker
            onScan={async (raw, isCurrent) => {
              const id = await resolveCameraCode(raw, "item");
              if (!isCurrent()) return false;
              const line = outstandingReturnLine(current.current.lines, id);
              // Each scan of the same item counts one more coming back.
              const now = current.current.picked[line.id]?.quantity ?? 0;
              if (now >= line.quantity - line.returnedQuantity)
                throw new Error(`All ${line.name} still out is already counted.`);
              set(line.id, { quantity: now + 1 });
              return true;
            }}
          />
        )}
        {returning && (
          <Alert>
            <AlertDescription>
              Enter how many of each item came back (or scan them). Everything returned goes back into stock; note any
              damage in the condition and notes.
            </AlertDescription>
          </Alert>
        )}
        <ul className="flex flex-col divide-y surface" aria-label="Items on this loan">
          {lines.map((l) => {
            const p = pickOf(l.id);
            const canPick = returning && l.status === "OUT";
            return (
              <li key={l.id} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium">
                      <Link href={`/stock/items/${l.itemId}`} className="text-primary underline underline-offset-4">
                        {l.name}
                      </Link>{" "}
                      <span className="font-normal text-muted-foreground">{l.sku}</span>
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      Borrowed {l.quantity} {l.unit}
                      {l.conditionOut ? ` · ${COND[l.conditionOut]}` : ""}
                      {l.accessories ? ` · ${l.accessories}` : ""}
                      {l.status !== "PENDING" && ` · Back ${l.returnedQuantity}`}
                      {l.status === "OUT" && status === "CLOSED" && ` · ${left(l)} not returned`}
                    </span>
                    {l.returns.length > 0 && (
                      <ul className="mt-1 text-sm text-muted-foreground">
                        {l.returns.map((r) => (
                          <li key={r.reference}>
                            {r.reference}: {r.quantity} {l.unit} back, {COND[r.condition].toLowerCase()}
                            {r.notes ? ` · ${r.notes}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <StatusChip kind="loanLine" status={l.status} />
                  {l.returnedQuantity > 0 && <EvidenceLinks ids={l.evidenceIds ?? []} />}
                </div>
                {canPick && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field id={`rq-${l.id}`} label={`Came back (of ${left(l)} ${l.unit} still out)`}>
                      <NumberInput
                        id={`rq-${l.id}`}
                        label={`returned quantity of ${l.name}`}
                        max={left(l)}
                        value={p.quantity}
                        invalid={(p.quantity ?? 0) > left(l)}
                        onChange={(v) => set(l.id, { quantity: v })}
                      />
                    </Field>
                    {(p.quantity ?? 0) > 0 && (
                      <>
                        <Field id={`rc-${l.id}`} label="Condition">
                          <Select value={p.condition} onValueChange={(v) => set(l.id, { condition: v as Cond })}>
                            <SelectTrigger id={`rc-${l.id}`} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="GOOD">Good</SelectItem>
                              <SelectItem value="FAIR">Fair</SelectItem>
                              <SelectItem value="DAMAGED">Damaged</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field id={`rn-${l.id}`} label="Notes" optional>
                          <Input
                            id={`rn-${l.id}`}
                            value={p.notes}
                            maxLength={500}
                            placeholder="e.g. charger missing, one cracked"
                            onChange={(e) => set(l.id, { notes: e.target.value })}
                          />
                        </Field>
                        <div className="md:col-span-3">
                          <EvidencePicker
                            value={p.photos}
                            onChange={(photos) => set(l.id, { photos })}
                            onBusyChange={(busy) => setPhotoBusy((prev) => ({ ...prev, [l.id]: busy }))}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {closing && (
          <div className="flex flex-col gap-4 surface p-4">
            <p>
              Closing the loan now means the <b>{stillOut}</b> still out won&apos;t come back (lost, used up, or
              broken). They stay taken out of stock. Return what did come back first.
            </p>
            <Field id="close-why" label="Why won't the rest come back?">
              <Textarea
                id="close-why"
                value={closeReason}
                maxLength={300}
                onChange={(e) => setCloseReason(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => (setClosing(false), setCloseReason(""))}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={closeReason.trim().length < 3} onClick={() => setCloseOpen(true)}>
                Close loan
              </Button>
            </div>
          </div>
        )}
        {returning && (
          <div id="return" className="flex flex-col gap-4 surface p-4">
            {errorText && (
              <Alert variant="destructive">
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id="ret-by"
                label="Brought back by"
                error={touched && !by.trim() ? "Enter who brought it back." : undefined}
              >
                <Input id="ret-by" value={by} maxLength={120} onChange={(e) => setBy(e.target.value)} />
              </Field>
              {locations.length > 1 && (
                <Field id="ret-to" label="Received at" hint="The returned items go into stock here.">
                  <LocationSelect
                    id="ret-to"
                    value={to}
                    onChange={(location) => {
                      setTo(location);
                      setPicks((prev) =>
                        Object.fromEntries(
                          Object.entries(prev).map(([id, pick]) => [
                            id,
                            { ...pick, photos: pick.photos.map((photo) => ({ ...photo, id: newId() })) },
                          ]),
                        ),
                      );
                    }}
                    options={locations}
                  />
                </Field>
              )}
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => (setReturning(false), setTouched(false))}>
                Cancel
              </Button>
              <div className="flex flex-wrap gap-2">
                {comingBack < stillOut && (
                  <Button variant="outline" onClick={() => out.forEach((l) => set(l.id, { quantity: left(l) }))}>
                    All came back ({stillOut})
                  </Button>
                )}
                <Button
                  disabled={Object.values(photoBusy).some(Boolean)}
                  onClick={() => {
                    setTouched(true);
                    if (chosen.length && !tooMany.length && by.trim()) setConfirmOpen(true);
                  }}
                >
                  Review return ({comingBack})
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {documents.length > 0 && (
        <section aria-labelledby="docs-h" className="flex flex-col gap-3">
          <h2 id="docs-h" className="text-lg font-semibold">
            Documents
          </h2>
          <ul className="flex flex-col divide-y surface">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 p-4">
                <p className="text-sm text-muted-foreground">{DOC[d.type] ?? d.type}</p>
                <DocumentActions documentId={d.id} size="sm" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Return ${comingBack} of ${stillOut}?`}
        description={
          comingBack === stillOut
            ? "Everything on this loan comes back into stock, so it will close."
            : `${stillOut - comingBack} will stay out and the loan stays open.`
        }
        changes={chosen.map((l) => ({
          label: `${l.name} (${COND[pickOf(l.id).condition]})`,
          from: `${left(l)} out`,
          to: `${pickOf(l.id).quantity} back into stock`,
        }))}
        confirmLabel="Confirm return"
        onConfirm={async () => {
          try {
            for (const l of chosen) await uploadReturnPhotos(pickOf(l.id).photos, l.id, to);
            const r = await apiFetch<{
              reference: string;
              documentId: string;
              loanStatus: string;
              returned: number;
              total: number;
            }>(`/api/v1/borrowings/${loanId}/return`, {
              method: "POST",
              idempotencyKey: key,
              body: {
                returnedByName: by.trim(),
                locationId: to !== locationId ? to : undefined,
                lines: chosen.map((l) => {
                  const p = pickOf(l.id);
                  return {
                    lineId: l.id,
                    quantity: p.quantity,
                    condition: p.condition,
                    notes: p.notes.trim() || undefined,
                    evidenceIds: p.photos.map((photo) => photo.id),
                  };
                }),
              },
            });
            setDone(r);
            setPicks({});
            setReturning(false);
            setTouched(false);
            setKey(newId());
            router.refresh();
          } catch (e) {
            throw e;
          }
        }}
      />
      <ConfirmSheet
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="Close this loan?"
        description={`${stillOut} still out will be marked as not returned and stay taken out of stock. This can't be undone.`}
        tone="destructive"
        confirmLabel="Close loan"
        onConfirm={async () => {
          await apiFetch(`/api/v1/borrowings/${loanId}/close`, {
            method: "POST",
            body: { reason: closeReason.trim() },
          });
          setClosing(false);
          setCloseReason("");
          router.refresh();
        }}
      />
    </div>
  );
}
