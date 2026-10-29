"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, FileSearch, Plus, ScanLine, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wizard } from "@/components/common/wizard";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { LocationSelect, type LocationOption } from "@/components/inventory/location-select";
import { DocumentActions } from "@/components/documents/document-actions";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";
import { normalizeCode } from "@/lib/codes";

type AssetStatus = "AVAILABLE" | "BORROWED" | "UNDER_MAINTENANCE" | "NEEDS_REVIEW" | "LOST" | "RETIRED";
type Cond = "GOOD" | "FAIR" | "DAMAGED";
export type PickAsset = {
  id: string;
  tag: string;
  serialNumber: string | null;
  status: AssetStatus;
  condition: Cond;
  locationId: string;
  item: { sku: string; name: string };
  location: { code: string };
};
type Line = { asset: PickAsset; condition: Cond; accessories: string };
type Result = { id: string; reference: string; documentId: string; assets: string[] };

export type BorrowInitial = {
  draftId?: string;
  draftReference?: string;
  locationId?: string;
  assets?: PickAsset[];
  borrowerName?: string;
  borrowerDept?: string;
  purpose?: string;
  dueDate?: string;
  notes?: string;
};

const WHY: Record<AssetStatus, string> = {
  AVAILABLE: "",
  BORROWED: "It's already out on a loan. Return it first.",
  UNDER_MAINTENANCE: "It's under maintenance.",
  NEEDS_REVIEW: "It's waiting for review after a return or count.",
  LOST: "It's marked lost.",
  RETIRED: "It's retired.",
};

/** Date input value (YYYY-MM-DD) → end of that working day in Manila. */
const dueIso = (d: string) => (d ? `${d}T17:00:00+08:00` : null);

/**
 * Borrow equipment (§7.5): Where → What → Who → Review & Confirm release.
 * Only AVAILABLE assets at the release location can be added; the server checks
 * again inside one locked transaction (A08). One Idempotency-Key per wizard.
 */
export function BorrowWizard({ locations, initial = {} }: { locations: LocationOption[]; initial?: BorrowInitial }) {
  const [step, setStep] = useState(initial.draftId && initial.locationId ? 1 : 0);
  const [from, setFrom] = useState<string | null>(
    initial.locationId ?? (locations.length === 1 ? locations[0].id : null),
  );
  const [lines, setLines] = useState<Line[]>(
    (initial.assets ?? [])
      .filter((a) => a.status === "AVAILABLE")
      .map((a) => ({ asset: a, condition: a.condition, accessories: "" })),
  );
  const [skipped] = useState(() => (initial.assets ?? []).filter((a) => a.status !== "AVAILABLE"));
  const [who, setWho] = useState({
    borrowerName: initial.borrowerName ?? "",
    borrowerDept: initial.borrowerDept ?? "",
    purpose: initial.purpose ?? "",
    dueDate: initial.dueDate ?? "",
    receivedByName: "",
    notes: initial.notes ?? "",
  });
  const [q, setQ] = useState("");
  const [found, setFound] = useState<PickAsset[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pickMsg, setPickMsg] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const searchRef = useRef<HTMLInputElement>(null);

  const loc = locations.find((l) => l.id === from);
  // Changing the location drops assets that are somewhere else.
  function changeFrom(id: string) {
    setFrom(id);
    setLines((ls) => ls.filter((l) => l.asset.locationId === id));
    setFound(null);
  }

  async function search(term = q) {
    const t = term.trim();
    if (!t || !from) return;
    setSearching(true);
    setPickMsg(null);
    try {
      const r = await apiFetch<{ rows: PickAsset[] }>(
        `/api/v1/assets?locationId=${from}&q=${encodeURIComponent(t)}&pageSize=20`,
      );
      const exact = r.rows.find((a) => a.tag === normalizeCode(t));
      // A scanned/typed exact tag that can be borrowed goes straight in.
      if (exact && exact.status === "AVAILABLE") {
        add(exact);
        setFound(null);
        setQ("");
        return;
      }
      setFound(r.rows);
      if (!r.rows.length)
        setPickMsg(`Nothing at ${loc?.code} matches "${t}". Check the tag, or the asset may be at another location.`);
    } catch (e) {
      setPickMsg(messageOf(e));
    } finally {
      setSearching(false);
    }
  }

  function add(a: PickAsset) {
    if (lines.some((l) => l.asset.id === a.id)) {
      setPickMsg(`${a.tag} is already on the list.`);
      return;
    }
    if (a.status !== "AVAILABLE") {
      setPickMsg(`${a.tag} can't be borrowed. ${WHY[a.status]}`);
      return;
    }
    setLines((ls) => [...ls, { asset: a, condition: a.condition, accessories: "" }]);
    setPickMsg(`Added ${a.tag}.`);
    searchRef.current?.focus();
  }

  const stepErrors = [
    !from ? "Pick where the equipment is released from." : null,
    lines.length === 0 ? "Add at least one asset." : null,
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
    notes: who.notes.trim() || undefined,
    lines: lines.map((l) => ({
      assetId: l.asset.id,
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
      if (e instanceof ApiClientError && e.status !== 0 && e.status < 500) setKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  if (locations.length === 0) {
    return (
      <EmptyState
        title="No location you can release equipment from"
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
      <section
        className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center"
        aria-live="polite"
      >
        <CheckCircle2 className="size-12 text-success" aria-hidden />
        <h1 className="text-2xl font-semibold">
          Released: <span className="whitespace-nowrap">{result.reference}</span>
        </h1>
        <p>
          {result.assets.join(", ")} {result.assets.length === 1 ? "is" : "are"} now borrowed by{" "}
          <b>{who.borrowerName}</b>.
        </p>
        <div className="w-full rounded-lg border bg-muted/40 p-3 text-left">
          <p className="mb-2 font-medium">Equipment Borrowing form</p>
          <p className="mb-3 text-sm text-muted-foreground">
            Print it, and have the borrower sign it when they take the equipment.
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
      title={initial.draftId ? "Release borrowing request" : "Borrow equipment"}
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
            Request prepared in the field. Check the assets and details, then release. Nothing has changed yet.
            {skipped.length > 0 && (
              <>
                {" "}
                Left out because they can&apos;t be borrowed now:{" "}
                {skipped.map((a) => `${a.tag} (${WHY[a.status]})`).join(" ")}
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {step === 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="b-from" label="Release from" hint="Where the equipment is now.">
            <LocationSelect id="b-from" value={from} onChange={changeFrom} options={locations} invalid={!!err} />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <Field
            id="b-search"
            label="Add asset"
            hint={`Scan or type the asset tag (like TOOL-0001), serial number, or name, then press Enter. Only assets at ${loc?.code} that are available can be added.`}
          >
            <div className="flex gap-2">
              <Input
                id="b-search"
                ref={searchRef}
                value={q}
                autoFocus
                autoComplete="off"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={() => search()} loading={searching}>
                <ScanLine aria-hidden /> Find
              </Button>
            </div>
          </Field>
          {pickMsg && (
            <p className="text-sm" role="status">
              {pickMsg}
            </p>
          )}
          {found && found.length > 0 && (
            <ul className="flex flex-col divide-y rounded-lg border" aria-label="Matching assets">
              {found.map((a) => {
                const on = lines.some((l) => l.asset.id === a.id);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {a.tag} <span className="font-normal">{a.item.name}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {a.serialNumber ? `S/N ${a.serialNumber} · ` : ""}
                        {a.status !== "AVAILABLE" ? WHY[a.status] : "Can be borrowed"}
                      </p>
                    </div>
                    <StatusChip kind="asset" status={a.status} />
                    {a.status === "AVAILABLE" && (
                      <Button type="button" variant="outline" onClick={() => add(a)} disabled={on}>
                        <Plus aria-hidden /> {on ? "Added" : "Add"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <h2 className="mt-2 font-semibold">To release ({lines.length})</h2>
          {lines.length === 0 ? (
            <p className="text-muted-foreground">No assets yet. Scan or type a tag to add the first one.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border" aria-label="Assets to release">
              {lines.map((l, i) => (
                <li key={l.asset.id} className="grid gap-3 p-3 md:grid-cols-[1fr_10rem_1fr_auto] md:items-end">
                  <div className="min-w-0">
                    <p className="font-medium">{l.asset.tag}</p>
                    <p className="text-sm text-muted-foreground">
                      {l.asset.item.name}
                      {l.asset.serialNumber ? ` · S/N ${l.asset.serialNumber}` : ""}
                    </p>
                  </div>
                  <Field id={`cond-${l.asset.id}`} label="Condition">
                    <Select
                      value={l.condition}
                      onValueChange={(v) =>
                        setLines((ls) => ls.map((x, j) => (j === i ? { ...x, condition: v as Cond } : x)))
                      }
                    >
                      <SelectTrigger id={`cond-${l.asset.id}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GOOD">Good</SelectItem>
                        <SelectItem value="FAIR">Fair</SelectItem>
                        <SelectItem value="DAMAGED">Damaged</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id={`acc-${l.asset.id}`} label="Accessories" optional>
                    <Input
                      id={`acc-${l.asset.id}`}
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
                    aria-label={`Remove ${l.asset.tag}`}
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
            hint="The person responsible for the equipment."
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
            {lines.map((l) => (
              <li key={l.asset.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3">
                <span>
                  <b>{l.asset.tag}</b> {l.asset.item.name}
                  <span className="block text-sm text-muted-foreground">
                    {l.condition === "GOOD" ? "Good" : l.condition === "FAIR" ? "Fair" : "Damaged"}
                    {l.accessories ? ` · ${l.accessories}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <StatusChip kind="asset" status="AVAILABLE" /> → <StatusChip kind="asset" status="BORROWED" />
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Confirming gives this loan its official number and makes the Equipment Borrowing form.
          </p>
        </div>
      )}
    </Wizard>
  );
}
