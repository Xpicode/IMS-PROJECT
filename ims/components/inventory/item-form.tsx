"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { describedBy, Field } from "@/components/common/field";
import { NumberInput } from "@/components/common/number-input";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";
import { createItemSchema } from "@/lib/validation";

export type CatalogOptions = {
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
};
type Values = z.input<typeof createItemSchema>;
const NONE = "none";

/** Add an item (master data). Editing existing items is a later step; see the item detail page. */
export function ItemForm({
  open,
  onOpenChange,
  catalog,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  catalog: CatalogOptions;
}) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(createItemSchema),
    defaultValues: {
      sku: "",
      name: "",
      unitId: catalog.units[0]?.id ?? "",
      categoryId: null,
      trackingType: "STOCK",
      minStock: 0,
      barcode: "",
      description: "",
    },
  });
  const { register, control, handleSubmit, setError, formState } = form;
  const errors = formState.errors;
  const tracking = useWatch({ control, name: "trackingType" });

  async function onSubmit(v: Values) {
    try {
      const item = await apiFetch<{ id: string; sku: string }>("/api/v1/items", {
        method: "POST",
        body: { ...v, categoryId: v.categoryId || null, minStock: v.trackingType === "ASSET" ? 0 : v.minStock },
      });
      toast.success(`Added ${item.sku}.`);
      onOpenChange(false);
      form.reset();
      router.push(`/stock/items/${item.id}`);
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
      title="Add an item"
      footer={
        <>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" loading={formState.isSubmitting}>
            Add item
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
        <Field id="i-sku" label="SKU" hint="Unique code, like PPE-0001." error={errors.sku?.message}>
          <Input
            id="i-sku"
            autoComplete="off"
            className="uppercase"
            {...register("sku")}
            {...describedBy("i-sku", errors.sku?.message, true)}
          />
        </Field>
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
                <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                  <SelectTrigger id="i-cat" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No category</SelectItem>
                    {catalog.categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
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
        <Field id="i-desc" label="Description" optional>
          <Textarea id="i-desc" {...register("description")} />
        </Field>
      </form>
    </ResponsiveDialog>
  );
}
