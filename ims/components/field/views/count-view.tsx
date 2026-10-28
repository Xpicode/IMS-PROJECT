"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NumberInput } from "@/components/common/number-input";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { StorageAlert } from "../storage-alert";
import { DraftValidationError, getDraft, saveCountDraft } from "@/lib/field/store";
import type { AssignmentRec, Condition, CountDraft, TargetRec } from "@/lib/field/db";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const COND: Record<Condition, string> = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };

/**
 * Count screen (IMS_BUILD_PLAN §4.3) and asset check. Re-scanning something
 * already counted reopens the saved value; it never adds to it (A12).
 */
export function CountView({ assignment, target }: { assignment: string; target: string }) {
  const { db } = useField();
  const [t, setT] = useState<TargetRec | null | undefined>(undefined);
  const [a, setA] = useState<AssignmentRec | null>(null);
  const [draft, setDraft] = useState<CountDraft | null | undefined>(undefined);
  useEffect(() => {
    Promise.all([db.targets.get(target), db.assignments.get(assignment), getDraft(db, assignment, target)]).then(
      ([tt, aa, d]) => {
        setT(tt && tt.sessionId === assignment ? tt : null);
        setA(aa ?? null);
        setDraft(d ?? null);
      },
      () => setT(null),
    );
  }, [db, assignment, target]);

  const back = () => go({ v: "scan", a: assignment });
  if (t === undefined || draft === undefined)
    return (
      <FieldScreen title="Count" back={back}>
        <p>Loading…</p>
      </FieldScreen>
    );
  if (t === null)
    return (
      <FieldScreen title="Count" back={back}>
        <p>That item is not part of this count on this phone. Download the assignment again if it should be.</p>
      </FieldScreen>
    );
  return (
    <FieldScreen title={a?.location.name ?? "Count"} subtitle={a?.name} back={back}>
      {t.kind === "STOCK" ? (
        <StockForm key={target} t={t} draft={draft} assignment={assignment} />
      ) : (
        <AssetForm key={target} t={t} draft={draft} assignment={assignment} />
      )}
    </FieldScreen>
  );
}

function Saved({ text, assignment, onEdit }: { text: string; assignment: string; onEdit: () => void }) {
  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      <div className="flex items-center gap-3 rounded-xl border-2 border-success bg-success-soft p-4 text-success">
        <CheckCircle2 className="size-8 shrink-0" aria-hidden />
        <p className="text-lg font-semibold">Saved on this phone: {text}</p>
      </div>
      <Button size="lg" className="h-16 text-xl" onClick={() => go({ v: "scan", a: assignment })} autoFocus>
        <ScanLine className="size-7" aria-hidden /> Scan next
      </Button>
      <Button size="lg" variant="outline" onClick={onEdit}>
        Edit this count
      </Button>
    </section>
  );
}

function useSave() {
  const { db, refreshPending } = useField();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  async function run(input: Parameters<typeof saveCountDraft>[1]) {
    setBusy(true);
    setError(null);
    setInvalid(null);
    try {
      const rec = await saveCountDraft(db, input);
      refreshPending();
      return rec;
    } catch (e) {
      if (e instanceof DraftValidationError) setInvalid(e.message);
      else setError(e as Error);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, invalid, clearInvalid: () => setInvalid(null) };
}

function Header({ t }: { t: TargetRec }) {
  return (
    <div>
      <h2 className="text-2xl font-semibold">{t.kind === "ASSET" ? t.tag : t.name}</h2>
      <p className="text-[15px] text-muted-foreground">
        {t.kind === "ASSET" ? `${t.name}${t.serialNumber ? ` · S/N ${t.serialNumber}` : ""}` : `${t.sku} · ${t.unit}`}
      </p>
    </div>
  );
}

function StockForm({ t, draft, assignment }: { t: TargetRec; draft: CountDraft | null; assignment: string }) {
  const [qty, setQty] = useState<number | null>(draft?.quantity ?? null);
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [saved, setSaved] = useState<CountDraft | null>(null);
  const [last, setLast] = useState(draft);
  const s = useSave();

  if (saved)
    return <Saved text={`${saved.quantity} ${t.unit}`} assignment={assignment} onEdit={() => setSaved(null)} />;
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (qty === null) return;
        const rec = await s.run({ sessionId: assignment, targetId: t.id, kind: "STOCK", quantity: qty, notes });
        if (rec) {
          setLast(rec);
          setSaved(rec);
        }
      }}
      className="flex flex-col gap-4"
    >
      <Header t={t} />
      {last ? (
        <div className="rounded-lg border-2 border-info/40 bg-info-soft p-3" role="status">
          <p className="font-semibold">
            Already counted: {last.quantity} {t.unit}. Edit or keep.
          </p>
          <p className="text-sm">Saved {formatDateTime(last.updatedAt)}. A new number replaces it; it is not added.</p>
          <Button type="button" variant="outline" className="mt-2" onClick={() => go({ v: "scan", a: assignment })}>
            Keep {last.quantity} and scan next
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Last count on this device: —</p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="count-qty" className="font-medium">
          How many {t.unit}?
        </label>
        <NumberInput
          id="count-qty"
          label={`count of ${t.name}`}
          size="count"
          value={qty}
          onChange={(v) => {
            setQty(v);
            s.clearInvalid();
          }}
          invalid={!!s.invalid}
        />
        {s.invalid && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {s.invalid}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="count-notes" className="font-medium">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="count-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Like: two damaged pairs"
        />
      </div>
      {s.error && <StorageAlert error={s.error} />}
      <div className="sticky bottom-[calc(0.5rem+env(safe-area-inset-bottom))] flex flex-col gap-2 rounded-xl border bg-card/95 p-2 backdrop-blur">
        <Button type="submit" size="lg" className="h-16 text-xl" loading={s.busy} disabled={qty === null}>
          Save count
        </Button>
        {qty === null && <p className="text-center text-sm text-muted-foreground">Enter the number to save.</p>}
      </div>
    </form>
  );
}

function AssetForm({ t, draft, assignment }: { t: TargetRec; draft: CountDraft | null; assignment: string }) {
  const [found, setFound] = useState<boolean | null>(draft?.found ?? null);
  const [condition, setCondition] = useState<Condition | null>(draft?.condition ?? null);
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [saved, setSaved] = useState<CountDraft | null>(null);
  const [last, setLast] = useState(draft);
  const s = useSave();
  const describe = (d: CountDraft) => (d.found ? `Found · ${COND[d.condition!]}` : "Not found");

  if (saved) return <Saved text={describe(saved)} assignment={assignment} onEdit={() => setSaved(null)} />;
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (found === null) return;
        const rec = await s.run({ sessionId: assignment, targetId: t.id, kind: "ASSET", found, condition, notes });
        if (rec) {
          setLast(rec);
          setSaved(rec);
        }
      }}
      className="flex flex-col gap-4"
    >
      <Header t={t} />
      <p className="text-sm text-muted-foreground">
        Last synced: {t.lastStatus ? t.lastStatus.replaceAll("_", " ").toLowerCase() : "—"}
        {t.lastCondition && ` · ${COND[t.lastCondition as Condition]?.toLowerCase()}`}
      </p>
      {last && (
        <div className="rounded-lg border-2 border-info/40 bg-info-soft p-3" role="status">
          <p className="font-semibold">Already checked: {describe(last)}. Edit or keep.</p>
          <Button type="button" variant="outline" className="mt-2" onClick={() => go({ v: "scan", a: assignment })}>
            Keep it and scan next
          </Button>
        </div>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 font-medium">Is it here?</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { v: true, label: "Found" },
            { v: false, label: "Not found" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={found === o.v}
              onClick={() => {
                setFound(o.v);
                s.clearInvalid();
              }}
              className={cn(
                "h-16 rounded-xl border-2 text-lg font-semibold",
                found === o.v
                  ? o.v
                    ? "border-success bg-success-soft text-success"
                    : "border-danger bg-danger-soft text-danger"
                  : "border-input bg-card",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
      {found && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 font-medium">Condition</legend>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(COND) as Condition[]).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={condition === c}
                onClick={() => {
                  setCondition(c);
                  s.clearInvalid();
                }}
                className={cn(
                  "h-14 rounded-xl border-2 font-semibold",
                  condition === c ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
                )}
              >
                {COND[c]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {s.invalid && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {s.invalid}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="asset-notes" className="font-medium">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id="asset-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {s.error && <StorageAlert error={s.error} />}
      <div className="sticky bottom-[calc(0.5rem+env(safe-area-inset-bottom))] rounded-xl border bg-card/95 p-2 backdrop-blur">
        <Button type="submit" size="lg" className="h-16 text-xl" loading={s.busy} disabled={found === null}>
          Save check
        </Button>
      </div>
    </form>
  );
}
