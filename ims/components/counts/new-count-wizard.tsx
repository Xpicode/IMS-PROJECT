"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/field";
import { Wizard } from "@/components/common/wizard";
import { LocationSelect } from "@/components/inventory/location-select";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";

export type CountLocation = {
  id: string;
  code: string;
  name: string;
  people: { id: string; name: string; role: string }[];
};

const STEPS = ["Where", "What", "Who", "When", "Review"];

/** Create a count (§7.7 step 1): location → what to count → counters → time window → review. */
export function NewCountWizard({
  locations,
  categories,
}: {
  locations: CountLocation[];
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [locationId, setLocationId] = useState<string | null>(locations.length === 1 ? locations[0].id : null);
  const [name, setName] = useState("");
  const [stock, setStock] = useState(true);
  const [assets, setAssets] = useState(true);
  const [allCats, setAllCats] = useState(true);
  const [cats, setCats] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loc = locations.find((l) => l.id === locationId);

  const problem = (): string | null => {
    if (step === 0) {
      if (!locationId) return "Pick the location to count.";
      if (!name.trim()) return "Name the count, like Q4 count – Main Warehouse.";
    }
    if (step === 1) {
      if (!stock && !assets) return "Count stock, assets, or both.";
      if (!allCats && !cats.length) return "Pick at least one category, or choose everything.";
    }
    return null;
  };
  const next = () => {
    const p = problem();
    setError(p);
    if (!p) setStep((s) => s + 1);
  };

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const s = await apiFetch<{ id: string; reference: string }>("/api/v1/counts", {
        method: "POST",
        body: {
          name,
          locationId,
          assigneeIds: people,
          includeStock: stock,
          includeAssets: assets,
          categoryIds: allCats ? [] : cats,
          dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
          notes: notes.trim() || undefined,
        },
      });
      router.push(`/counts/${s.id}`);
    } catch (e) {
      setError(
        e instanceof ApiClientError && e.fields ? (Object.values(e.fields)[0]?.[0] ?? messageOf(e)) : messageOf(e),
      );
      setBusy(false);
    }
  }

  const toggle = (xs: string[], id: string, on: boolean) => (on ? [...xs, id] : xs.filter((x) => x !== id));
  const catNames = categories.filter((c) => cats.includes(c.id)).map((c) => c.name);
  const peopleNames = loc?.people.filter((p) => people.includes(p.id)).map((p) => p.name) ?? [];

  return (
    <Wizard
      title="New count"
      steps={STEPS}
      current={step}
      onBack={() => (setStep((s) => s - 1), setError(null))}
      onNext={next}
      confirmLabel="Create count"
      onConfirm={confirm}
      confirming={busy}
      cancel={
        <Button asChild variant="outline">
          <Link href="/counts">Cancel</Link>
        </Button>
      }
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {step === 0 && (
        <div className="flex max-w-xl flex-col gap-4">
          <Field id="c-loc" label="Location to count">
            <LocationSelect
              id="c-loc"
              value={locationId}
              onChange={(v) => {
                setLocationId(v);
                setPeople([]);
              }}
              options={locations}
            />
          </Field>
          <Field id="c-name" label="Name">
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="Q4 count – Main Warehouse"
            />
          </Field>
        </div>
      )}
      {step === 1 && (
        <div className="flex max-w-xl flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">Count</legend>
            <label className="flex min-h-12 items-center gap-3">
              <Checkbox checked={stock} onCheckedChange={(v) => setStock(v === true)} /> Stock quantities
            </label>
            <label className="flex min-h-12 items-center gap-3">
              <Checkbox checked={assets} onCheckedChange={(v) => setAssets(v === true)} /> Tagged assets (found / not
              found)
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">Which items</legend>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="radio"
                name="scope"
                className="size-5 accent-primary"
                checked={allCats}
                onChange={() => setAllCats(true)}
              />
              Everything at {loc?.code ?? "the location"}
            </label>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="radio"
                name="scope"
                className="size-5 accent-primary"
                checked={!allCats}
                onChange={() => setAllCats(false)}
              />
              Only some categories
            </label>
            {!allCats && (
              <div className="ml-8 flex flex-col gap-1">
                {categories.length === 0 && (
                  <p className="text-muted-foreground">No categories yet. Add them under Units &amp; categories.</p>
                )}
                {categories.map((c) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-3">
                    <Checkbox
                      checked={cats.includes(c.id)}
                      onCheckedChange={(v) => setCats((xs) => toggle(xs, c.id, v === true))}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            While the count is open, stock of these items can&apos;t be received, issued, or transferred at this
            location unless a supervisor records an exception.
          </p>
        </div>
      )}
      {step === 2 && (
        <fieldset className="flex max-w-xl flex-col gap-2">
          <legend className="mb-1 font-medium">Who counts</legend>
          {!loc || loc.people.length === 0 ? (
            <p className="text-muted-foreground">
              Nobody can count at {loc?.code} yet. Give someone access under Users. You can create the count now and
              assign people later.
            </p>
          ) : (
            loc.people.map((p) => (
              <div key={p.id} className="flex min-h-12 items-center gap-3">
                <Checkbox
                  id={`c-p-${p.id}`}
                  checked={people.includes(p.id)}
                  onCheckedChange={(v) => setPeople((xs) => toggle(xs, p.id, v === true))}
                />
                <Label htmlFor={`c-p-${p.id}`}>
                  {p.name} <span className="font-normal text-muted-foreground">({p.role.toLowerCase()})</span>
                </Label>
              </div>
            ))
          )}
        </fieldset>
      )}
      {step === 3 && (
        <div className="flex max-w-xl flex-col gap-4">
          <Field id="c-due" label="Finish counting by" optional>
            <Input id="c-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field id="c-notes" label="Instructions for counters" optional>
            <Textarea id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} />
          </Field>
          <p className="text-sm text-muted-foreground">
            The expected quantities are taken from the records the moment you create the count. Counters never see them.
          </p>
        </div>
      )}
      {step === 4 && (
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-3 surface p-4">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{name}</dd>
          <dt className="text-muted-foreground">Location</dt>
          <dd className="font-medium">
            {loc?.code} · {loc?.name}
          </dd>
          <dt className="text-muted-foreground">Count</dt>
          <dd className="font-medium">{[stock && "Stock", assets && "Assets"].filter(Boolean).join(" and ")}</dd>
          <dt className="text-muted-foreground">Items</dt>
          <dd className="font-medium">{allCats ? "Everything" : catNames.join(", ")}</dd>
          <dt className="text-muted-foreground">Counters</dt>
          <dd className="font-medium">{peopleNames.length ? peopleNames.join(", ") : "Nobody yet"}</dd>
          <dt className="text-muted-foreground">Finish by</dt>
          <dd className="font-medium">{due || "No date"}</dd>
        </dl>
      )}
    </Wizard>
  );
}
