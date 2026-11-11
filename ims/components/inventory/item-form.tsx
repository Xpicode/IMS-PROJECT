"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { describedBy, Field } from "@/components/common/field";
import { NumberInput } from "@/components/common/number-input";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";
import { uploadItemPhoto } from "@/lib/photo";
import { createItemSchema } from "@/lib/validation";

export type CatalogOptions = {
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
};
/** The fields an edit can change; SKU, tracking and barcode stay as they were. */
export type EditableItem = {
  id: string;
  sku: string;
  name: string;
  trackingType: "STOCK" | "ASSET";
  unitId: string;
  categoryId: string | null;
  minStock: number;
  description: string | null;
};
type Values = z.input<typeof createItemSchema>;
const NONE = "none";
const NEW = "new";

/** Add an item (master data), or edit one when `item` is given. */
export function ItemForm({
  open,
  onOpenChange,
  catalog,
  item,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  catalog: CatalogOptions;
  item?: EditableItem;
}) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(createItemSchema),
    defaultValues: {
      sku: item?.sku ?? "",
      name: item?.name ?? "",
      unitId: item?.unitId ?? catalog.units[0]?.id ?? "",
      categoryId: item?.categoryId ?? null,
      trackingType: item?.trackingType ?? "STOCK",
      minStock: item?.minStock ?? 0,
      barcode: "",
      description: item?.description ?? "",
    },
  });
  const { register, control, handleSubmit, setError, setValue, formState } = form;
  // Categories added here show up in the list at once, before the page refreshes.
  const [categories, setCategories] = useState(catalog.categories);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [catError, setCatError] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  async function addCategory() {
    setAddingCat(true);
    setCatError("");
    try {
      const c = await apiFetch<{ id: string; name: string }>("/api/v1/categories", {
        method: "POST",
        body: { name: newCat },
      });
      setCategories((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)));
      setValue("categoryId", c.id);
      setNewCat(null);
      toast.success(`Added category ${c.name}.`);
      router.refresh();
    } catch (e) {
      setCatError(e instanceof ApiClientError && e.fields?.name ? e.fields.name[0] : messageOf(e));
    } finally {
      setAddingCat(false);
    }
  }
  const errors = formState.errors;
  const tracking = useWatch({ control, name: "trackingType" });
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  function pickPhoto(file: File | undefined) {
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto(file ? { file, preview: URL.createObjectURL(file) } : null);
  }

  async function onSubmit(v: Values) {
    if (item) return save(item, v);
    try {
      const item = await apiFetch<{ id: string; sku: string }>("/api/v1/items", {
        method: "POST",
        body: { ...v, categoryId: v.categoryId || null, minStock: v.trackingType === "ASSET" ? 0 : v.minStock },
      });
      if (photo) {
        // The item is saved either way; a failed photo can be added on the item page.
        await uploadItemPhoto(item.id, photo.file).then(
          () => toast.success(`Added ${item.sku} with its photo.`),
          (e) =>
            toast.error(
              `Added ${item.sku}, but the photo wasn't saved: ${(e as Error).message} Add it on the item page.`,
            ),
        );
      } else toast.success(`Added ${item.sku}.`);
      onOpenChange(false);
      form.reset();
      pickPhoto(undefined);
      router.push(`/stock/items/${item.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) {
        for (const [k, msgs] of Object.entries(e.fields)) setError(k as keyof Values, { message: msgs[0] });
      }
      setError("root", { message: messageOf(e) });
    }
  }

  async function save(item: EditableItem, v: Values) {
    try {
      await apiFetch(`/api/v1/items/${item.id}`, {
        method: "PATCH",
        body: {
          name: v.name,
          // Only a changed unit is checked; an item may keep a unit that was turned off since.
          unitId: v.unitId !== item.unitId ? v.unitId : undefined,
          categoryId: v.categoryId || null,
          minStock: item.trackingType === "ASSET" ? 0 : v.minStock,
          description: v.description ?? "",
        },
      });
      toast.success(`Saved ${item.sku}.`);
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) {
        for (const [k, msgs] of Object.entries(e.fields)) setError(k as keyof Values, { message: msgs[0] });
      }
      setError("root", { message: messageOf(e) });
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}
      title={item ? `Edit ${item.sku}` : "Add an item"}
      footer={
        <>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" loading={formState.isSubmitting}>
            {item ? "Save changes" : "Add item"}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 pb-2" noValidate>
        {errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{errors.root.message}</AlertDescription>
          </Alert>
        )}
        {!item && (
          <Field id="i-tracking" label="How is it tracked?" error={errors.trackingType?.message}>
            <Controller
              control={control}
              name="trackingType"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="i-tracking" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STOCK">Stock – counted (gloves, cable ties)</SelectItem>
                    <SelectItem value="ASSET">Asset – each one tagged (drills, laptops)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        )}
        {!item && (
          <Field id="i-sku" label="SKU" hint="Unique code, like PPE-0001." error={errors.sku?.message}>
            <Input
              id="i-sku"
              autoComplete="off"
              className="uppercase"
              {...register("sku")}
              {...describedBy("i-sku", errors.sku?.message, true)}
            />
          </Field>
        )}
        <Field id="i-name" label="Name" error={errors.name?.message}>
          <Input
            id="i-name"
            autoComplete="off"
            {...register("name")}
            {...describedBy("i-name", errors.name?.message)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="i-unit" label="Unit" error={errors.unitId?.message}>
            <Controller
              control={control}
              name="unitId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="i-unit" className="w-full">
                    <SelectValue placeholder="Pick a unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.code} – {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id="i-cat" label="Category" optional>
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select
                  value={field.value ?? NONE}
                  onValueChange={(v) => (v === NEW ? setNewCat("") : field.onChange(v === NONE ? null : v))}
                >
                  <SelectTrigger id="i-cat" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No category</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value={NEW}>+ New category…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {newCat !== null && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    aria-label="New category name"
                    placeholder="e.g. PPE"
                    autoComplete="off"
                    autoFocus
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter adds the category instead of submitting the whole item form.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addCategory();
                      }
                    }}
                    aria-invalid={!!catError || undefined}
                  />
                  <Button type="button" variant="outline" loading={addingCat} onClick={addCategory}>
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setNewCat(null);
                      setCatError("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                {catError && (
                  <p className="text-sm font-medium text-destructive" role="alert">
                    {catError}
                  </p>
                )}
              </div>
            )}
          </Field>
        </div>
        {tracking === "STOCK" && (
          <Field
            id="i-min"
            label="Low-stock level"
            hint="Shows Low when the total on hand is at or below this."
            error={errors.minStock?.message}
          >
            <Controller
              control={control}
              name="minStock"
              render={({ field }) => (
                <NumberInput
                  id="i-min"
                  label="low-stock level"
                  value={field.value ?? 0}
                  onChange={(v) => field.onChange(v ?? 0)}
                />
              )}
            />
          </Field>
        )}
        {!item && (
          <Field
            id="i-barcode"
            label="Manufacturer barcode"
            optional
            hint="Scan the box barcode so scanning it finds this item."
            error={errors.barcode?.message}
          >
            <Input
              id="i-barcode"
              autoComplete="off"
              {...register("barcode")}
              {...describedBy("i-barcode", errors.barcode?.message, true)}
            />
          </Field>
        )}
        <Field id="i-desc" label="Description" optional>
          <Textarea id="i-desc" {...register("description")} />
        </Field>
        {!item && (
          <Field
            id="i-photo"
            label="Photo"
            optional
            hint="A clear picture, so everyone knows exactly which item this is."
          >
            <div className="flex items-center gap-3">
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL)
                <img
                  src={photo.preview}
                  alt="Chosen photo"
                  className="size-16 shrink-0 rounded-md border object-cover"
                />
              )}
              <Input
                id="i-photo"
                type="file"
                accept="image/*"
                className="h-12 min-w-0 flex-1 py-2.5"
                onChange={(e) => pickPhoto(e.target.files?.[0])}
              />
            </div>
          </Field>
        )}
      </form>
    </ResponsiveDialog>
  );
}
