"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Field } from "@/components/common/field";
import { LocationSelect } from "@/components/inventory/location-select";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";

export type CountLocation = {
  id: string;
  code: string;
  name: string;
  people: { id: string; name: string; role: string }[];
};

/** Minimal count creation (Phase 3). shortcut: whole-location scope only; picking items comes with Phase 4. */
export function NewCountForm({
  open,
  onOpenChange,
  locations,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  locations: CountLocation[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState<string | null>(locations.length === 1 ? locations[0].id : null);
  const [due, setDue] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [stock, setStock] = useState(true);
  const [assets, setAssets] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loc = locations.find((l) => l.id === locationId);
  /** Clear a field's old error as soon as the person changes it. */
  const touch = (k: string) =>
    setFields(({ [k]: _, ...rest }) => {
      void _;
      if (Object.keys(rest).length === 0) setError(null);
      return rest;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (!name.trim()) f.name = "Name the count, like Q4 count – Main Warehouse.";
    if (!locationId) f.locationId = "Pick a location.";
    if (!stock && !assets) f.includeStock = "Count stock, assets, or both.";
    setFields(f);
    setError(Object.keys(f).length ? "Fix the highlighted fields." : null);
    if (Object.keys(f).length) return;
    setBusy(true);
    try {
      const s = await apiFetch<{ reference: string }>("/api/v1/counts", {
        method: "POST",
        body: {
          name,
          locationId,
          assigneeIds: people,
          includeStock: stock,
          includeAssets: assets,
          dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
        },
      });
      toast.success(`Created ${s.reference}. Counters can download it now.`);
      onOpenChange(false);
      setName("");
      setPeople([]);
      setDue("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.fields)
        setFields(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]])));
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) {
          setFields({});
          setError(null);
        }
        onOpenChange(o);
      }}
      title="New count"
      description="Everything at the location is included. Expected numbers are hidden from counters."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="count-form" loading={busy}>
            Create count
          </Button>
        </>
      }
    >
      <form id="count-form" onSubmit={submit} noValidate className="flex flex-col gap-4 pb-2">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="c-name" label="Name" error={fields.name}>
          <Input
            id="c-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              touch("name");
            }}
            autoComplete="off"
            aria-invalid={!!fields.name || undefined}
          />
        </Field>
        <Field id="c-loc" label="Location" error={fields.locationId}>
          <LocationSelect
            id="c-loc"
            value={locationId}
            onChange={(v) => {
              setLocationId(v);
              setPeople([]);
              touch("locationId");
            }}
            options={locations}
            invalid={!!fields.locationId}
          />
        </Field>
        <Field id="c-due" label="Due date" optional>
          <Input id="c-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What to count</legend>
          <div className="flex min-h-12 items-center gap-3">
            <Checkbox
              id="c-stock"
              checked={stock}
              onCheckedChange={(v) => {
                setStock(v === true);
                touch("includeStock");
              }}
            />
            <Label htmlFor="c-stock">Stock quantities</Label>
          </div>
          <div className="flex min-h-12 items-center gap-3">
            <Checkbox
              id="c-assets"
              checked={assets}
              onCheckedChange={(v) => {
                setAssets(v === true);
                touch("includeStock");
              }}
            />
            <Label htmlFor="c-assets">Tagged assets (found / not found)</Label>
          </div>
          {fields.includeStock && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {fields.includeStock}
            </p>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Counters</legend>
          {!loc ? (
            <p className="text-muted-foreground">Pick a location first.</p>
          ) : loc.people.length === 0 ? (
            <p className="text-muted-foreground">
              Nobody can count at {loc.code} yet. Give someone access under Users.
            </p>
          ) : (
            loc.people.map((p) => (
              <div key={p.id} className="flex min-h-12 items-center gap-3">
                <Checkbox
                  id={`c-p-${p.id}`}
                  checked={people.includes(p.id)}
                  onCheckedChange={(v) =>
                    setPeople((xs) => (v === true ? [...xs, p.id] : xs.filter((x) => x !== p.id)))
                  }
                />
                <Label htmlFor={`c-p-${p.id}`}>
                  {p.name} <span className="font-normal text-muted-foreground">({p.role.toLowerCase()})</span>
                </Label>
              </div>
            ))
          )}
          {fields.assigneeIds && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {fields.assigneeIds}
            </p>
          )}
        </fieldset>
      </form>
    </ResponsiveDialog>
  );
}
