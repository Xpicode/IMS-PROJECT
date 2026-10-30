"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Printer } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/field";
import { FocusHeading } from "@/components/common/focus-heading";
import { NumberInput } from "@/components/common/number-input";
import { ItemPicker, type PickedItem } from "@/components/inventory/item-picker";
import { LocationSelect, type LocationOption } from "@/components/inventory/location-select";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";

type Created = { assets: { id: string; tag: string; serialNumber: string | null }[]; warnings: string[] };

/** "Add assets" with a quantity: 5 drills → 5 tags, each with its own history (A02). */
export function AddAssetsForm({ locations, initialItem }: { locations: LocationOption[]; initialItem?: PickedItem }) {
  const [item, setItem] = useState<PickedItem | null>(initialItem ?? null);
  const [locationId, setLocationId] = useState<string | null>(locations.length === 1 ? locations[0].id : null);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [prefix, setPrefix] = useState(initialItem ? defaultPrefix(initialItem.sku) : "");
  const [condition, setCondition] = useState("GOOD");
  const [serials, setSerials] = useState("");
  const [custodian, setCustodian] = useState("");
  const [notes, setNotes] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Created | null>(null);

  const serialList = serials.split(/\r?\n/).map((s) => s.trim());
  while (serialList.length && !serialList[serialList.length - 1]) serialList.pop();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const f: Record<string, string[]> = {};
    if (!item) f.itemId = ["Pick an asset item."];
    if (!locationId) f.locationId = ["Pick a location."];
    if (!quantity) f.quantity = ["Enter how many."];
    if (!prefix.trim()) f.tagPrefix = ["Enter a tag prefix, like TOOL."];
    setFields(f);
    if (Object.keys(f).length) return setError("Fix the highlighted fields.");
    setBusy(true);
    setError(null);
    try {
      setDone(
        await apiFetch<Created>("/api/v1/assets", {
          method: "POST",
          body: {
            itemId: item!.id,
            locationId,
            quantity,
            tagPrefix: prefix,
            condition,
            serialNumbers: serialList,
            custodianName: custodian || undefined,
            notes: notes || undefined,
          },
        }),
      );
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setFields(e.fields);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="mx-auto flex max-w-xl flex-col gap-4 surface p-6" aria-live="polite">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <FocusHeading className="text-2xl font-semibold">Added {done.assets.length} assets</FocusHeading>
        </div>
        {done.warnings.length > 0 && (
          <Alert>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {done.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <ul className="divide-y rounded-lg border">
          {done.assets.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 p-3">
              <Link href={`/assets/${a.id}`} className="font-medium underline-offset-4 hover:underline">
                {a.tag}
              </Link>
              <span className="text-muted-foreground">{a.serialNumber ?? "no serial"}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild className="sm:flex-1">
            <Link href={`/labels?type=asset&ids=${done.assets.map((a) => a.id).join(",")}`}>
              <Printer aria-hidden /> Print {done.assets.length} labels
            </Link>
          </Button>
          <Button asChild variant="outline" className="sm:flex-1">
            <Link href="/assets">Done</Link>
          </Button>
        </div>
      </section>
    );
  }

  const err = (k: string) => fields[k]?.[0];
  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-4 surface p-4 md:p-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Field
        id="a-item"
        label="Asset item"
        hint="Type or scan an item that is tracked as individual assets."
        error={err("itemId")}
      >
        {item ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span>
              <b>{item.name}</b> <span className="text-muted-foreground">{item.sku}</span>
            </span>
            <Button type="button" variant="outline" onClick={() => setItem(null)}>
              Change
            </Button>
          </div>
        ) : (
          <ItemPicker
            id="a-item"
            tracking="ASSET"
            onPick={(i) => {
              setItem(i);
              if (!prefix) setPrefix(defaultPrefix(i.sku));
            }}
          />
        )}
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="a-loc" label="Location" error={err("locationId")}>
          <LocationSelect
            id="a-loc"
            value={locationId}
            onChange={setLocationId}
            options={locations}
            invalid={!!err("locationId")}
          />
        </Field>
        <Field id="a-qty" label="How many?" hint="Each one gets its own tag." error={err("quantity")}>
          <NumberInput
            id="a-qty"
            label="number of assets"
            value={quantity}
            min={1}
            max={200}
            onChange={setQuantity}
            invalid={!!err("quantity")}
          />
        </Field>
        <Field
          id="a-prefix"
          label="Tag prefix"
          hint={prefix ? `Tags will look like ${prefix.toUpperCase()}-0001.` : "Like TOOL or LAP."}
          error={err("tagPrefix")}
        >
          <Input
            id="a-prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            className="uppercase"
            autoComplete="off"
            aria-invalid={!!err("tagPrefix") || undefined}
          />
        </Field>
        <Field id="a-cond" label="Condition">
          <Select value={condition} onValueChange={setCondition}>
            <SelectTrigger id="a-cond" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GOOD">Good</SelectItem>
              <SelectItem value="FAIR">Fair</SelectItem>
              <SelectItem value="DAMAGED">Damaged</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field
        id="a-serials"
        label="Serial numbers"
        optional
        hint={`One per line, in the same order as the tags. ${serialList.filter(Boolean).length} of ${quantity ?? 0} entered.`}
        error={err("serialNumbers")}
      >
        <Textarea id="a-serials" rows={4} value={serials} onChange={(e) => setSerials(e.target.value)} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="a-cust" label="Custodian" optional hint="Who is responsible for it.">
          <Input id="a-cust" value={custodian} onChange={(e) => setCustodian(e.target.value)} autoComplete="off" />
        </Field>
        <Field id="a-notes" label="Notes" optional>
          <Input id="a-notes" value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href="/assets">Cancel</Link>
        </Button>
        <Button type="submit" loading={busy}>
          Add {quantity ?? ""} {quantity === 1 ? "asset" : "assets"}
        </Button>
      </div>
    </form>
  );
}

const defaultPrefix = (sku: string) =>
  sku
    .split(/[-_./]/)[0]
    .toUpperCase()
    .slice(0, 20);
