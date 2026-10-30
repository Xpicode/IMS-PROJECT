"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, PackageCheck, Send } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/field";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { LocationSelect, type LocationOption } from "@/components/inventory/location-select";
import { DocumentActions } from "@/components/documents/document-actions";
import { apiFetch } from "@/lib/api-client";
import { newId } from "@/lib/utils";

type Cond = "GOOD" | "FAIR" | "DAMAGED";
export type LoanLine = {
  id: string;
  status: "PENDING" | "OUT" | "RETURNED";
  tag: string;
  assetId: string;
  name: string;
  serialNumber: string | null;
  conditionOut: Cond | null;
  accessories: string | null;
  conditionIn: Cond | null;
  statusAfterReturn: string | null;
  missingAccessories: string | null;
  returnReference: string | null;
};
export type LoanDoc = { id: string; reference: string; type: string };
type Pick = {
  on: boolean;
  condition: Cond;
  damagedStatus: "NEEDS_REVIEW" | "UNDER_MAINTENANCE";
  missing: string;
  notes: string;
};

const NO_PICK: Pick = { on: false, condition: "GOOD", damagedStatus: "NEEDS_REVIEW", missing: "", notes: "" };
const COND: Record<Cond, string> = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
const DOC: Record<string, string> = {
  EQUIPMENT_BORROWING: "Equipment Borrowing form",
  RETURN_ACKNOWLEDGMENT: "Return Acknowledgment",
};

/** Lines, documents, and the Return flow (§7.6) for one loan. */
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
  const pickOf = (id: string) => picked[id] ?? NO_PICK;
  const [by, setBy] = useState(borrowerName);
  const [to, setTo] = useState(locationId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [key, setKey] = useState(() => newId());
  const [done, setDone] = useState<{
    reference: string;
    documentId: string;
    loanStatus: string;
    returned: number;
    total: number;
  } | null>(null);

  const chosen = out.filter((l) => pickOf(l.id).on);
  const set = (id: string, p: Partial<Pick>) => setPicks((ps) => ({ ...ps, [id]: { ...(ps[id] ?? NO_PICK), ...p } }));
  const after = (p: Pick) => (p.condition === "DAMAGED" ? p.damagedStatus : "AVAILABLE");
  const errorText =
    touched && !chosen.length
      ? "Tick at least one asset that is coming back."
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
            {done.returned} of {done.total} returned.{" "}
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
            Equipment
          </h2>
          {status === "OPEN" && canAct && !returning && (
            <Button onClick={() => setReturning(true)}>
              <PackageCheck aria-hidden /> Return equipment
            </Button>
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
          <Alert>
            <AlertDescription>
              Tick each asset that came back and set its condition. Damaged equipment goes to <b>Needs review</b> or{" "}
              <b>Under maintenance</b>, never straight to available.
            </AlertDescription>
          </Alert>
        )}
        <ul className="flex flex-col divide-y rounded-xl border bg-card" aria-label="Assets on this loan">
          {lines.map((l) => {
            const p = pickOf(l.id);
            const canPick = returning && l.status === "OUT";
            return (
              <li key={l.id} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  {canPick && (
                    <Checkbox
                      id={`ret-${l.id}`}
                      checked={p.on}
                      onCheckedChange={(v) => set(l.id, { on: v === true })}
                      className="mt-1 size-6"
                      aria-label={`${l.tag} is coming back`}
                    />
                  )}
                  <label htmlFor={canPick ? `ret-${l.id}` : undefined} className="min-w-0 flex-1">
                    <span className="block font-medium">
                      <Link href={`/assets/${l.assetId}`} className="text-primary underline underline-offset-4">
                        {l.tag}
                      </Link>{" "}
                      {l.name}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {l.serialNumber ? `S/N ${l.serialNumber} · ` : ""}
                      Out: {l.conditionOut ? COND[l.conditionOut] : "—"}
                      {l.accessories ? ` · ${l.accessories}` : ""}
                      {l.status === "RETURNED" &&
                        ` · Back: ${l.conditionIn ? COND[l.conditionIn] : ""}${l.missingAccessories ? `, missing ${l.missingAccessories}` : ""} (${l.returnReference})`}
                    </span>
                  </label>
                  <StatusChip kind="loanLine" status={l.status} />
                </div>
                {canPick && p.on && (
                  <div className="grid gap-3 sm:pl-9 md:grid-cols-3">
                    <Field id={`rc-${l.id}`} label="Condition now">
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
                    {p.condition === "DAMAGED" && (
                      <Field id={`rs-${l.id}`} label="Send to">
                        <Select
                          value={p.damagedStatus}
                          onValueChange={(v) => set(l.id, { damagedStatus: v as Pick["damagedStatus"] })}
                        >
                          <SelectTrigger id={`rs-${l.id}`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NEEDS_REVIEW">Needs review</SelectItem>
                            <SelectItem value="UNDER_MAINTENANCE">Under maintenance</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                    <Field id={`rm-${l.id}`} label="Missing accessories" optional>
                      <Input
                        id={`rm-${l.id}`}
                        value={p.missing}
                        maxLength={300}
                        onChange={(e) => set(l.id, { missing: e.target.value })}
                      />
                    </Field>
                    <Field id={`rn-${l.id}`} label="Notes" optional>
                      <Input
                        id={`rn-${l.id}`}
                        value={p.notes}
                        maxLength={500}
                        onChange={(e) => set(l.id, { notes: e.target.value })}
                      />
                    </Field>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {returning && (
          <div id="return" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
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
                <Field id="ret-to" label="Received at" hint="Where the equipment is now.">
                  <LocationSelect id="ret-to" value={to} onChange={setTo} options={locations} />
                </Field>
              )}
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => (setReturning(false), setTouched(false))}>
                Cancel
              </Button>
              <div className="flex flex-wrap gap-2">
                {chosen.length < out.length && (
                  <Button variant="outline" onClick={() => out.forEach((l) => set(l.id, { on: true }))}>
                    Tick all ({out.length})
                  </Button>
                )}
                <Button
                  onClick={() => {
                    setTouched(true);
                    if (chosen.length && by.trim()) setConfirmOpen(true);
                  }}
                >
                  Review return ({chosen.length})
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
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
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
        title={`Return ${chosen.length} of ${out.length}?`}
        description={
          chosen.length === out.length
            ? "Everything on this loan comes back, so it will close."
            : `${out.length - chosen.length} will stay out and the loan stays open.`
        }
        changes={chosen.map((l) => ({
          label: `${l.tag} (${COND[pickOf(l.id).condition]})`,
          from: "Borrowed",
          to:
            after(pickOf(l.id)) === "AVAILABLE"
              ? "Available"
              : after(pickOf(l.id)) === "NEEDS_REVIEW"
                ? "Needs review"
                : "Under maintenance",
        }))}
        confirmLabel="Confirm return"
        onConfirm={async () => {
          try {
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
                    condition: p.condition,
                    damagedStatus: p.condition === "DAMAGED" ? p.damagedStatus : undefined,
                    missingAccessories: p.missing.trim() || undefined,
                    notes: p.notes.trim() || undefined,
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
            setKey(newId());
            throw e;
          }
        }}
      />
    </div>
  );
}
