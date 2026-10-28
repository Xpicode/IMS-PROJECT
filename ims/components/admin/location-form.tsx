"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { describedBy, Field } from "@/components/common/field";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";
import { createLocationSchema } from "@/lib/validation";

export const TYPE_LABEL = { WAREHOUSE: "Warehouse", SITE: "Site", AREA: "Rack / area" } as const;
const NO_PARENT = "none";

export type ParentOption = { id: string; code: string; name: string };
export type EditableLocation = {
  id: string;
  code: string;
  name: string;
  type: keyof typeof TYPE_LABEL;
  parentId: string | null;
};

type Values = z.input<typeof createLocationSchema>;
const editSchema = createLocationSchema.pick({ name: true, type: true });

export function LocationForm({
  open,
  onOpenChange,
  location,
  parents,
  allowTopLevel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  location?: EditableLocation;
  /** Locations this user may add children under. */
  parents: ParentOption[];
  allowTopLevel: boolean;
}) {
  const router = useRouter();
  const editing = !!location;
  const form = useForm<Values>({
    resolver: zodResolver((editing ? editSchema : createLocationSchema) as typeof createLocationSchema),
    defaultValues: location
      ? { code: location.code, name: location.name, type: location.type, parentId: location.parentId }
      : {
          code: "",
          name: "",
          type: allowTopLevel ? "WAREHOUSE" : "AREA",
          parentId: allowTopLevel ? null : (parents[0]?.id ?? null),
        },
  });
  const { register, control, handleSubmit, setError, formState } = form;
  const errors = formState.errors;

  async function onSubmit(v: Values) {
    try {
      if (editing) {
        await apiFetch(`/api/v1/locations/${location!.id}`, { method: "PATCH", body: { name: v.name, type: v.type } });
      } else {
        await apiFetch("/api/v1/locations", { method: "POST", body: { ...v, parentId: v.parentId || null } });
      }
      toast.success(editing ? `Saved ${v.name}.` : `Added ${v.name}.`);
      onOpenChange(false);
      form.reset();
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) {
        for (const [k, msgs] of Object.entries(e.fields)) {
          if (k === "code" || k === "name" || k === "type" || k === "parentId") setError(k, { message: msgs[0] });
        }
      }
      setError("root", { message: messageOf(e) });
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}
      title={editing ? `Edit ${location!.code}` : "Add a location"}
      footer={
        <>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="location-form" loading={formState.isSubmitting}>
            {editing ? "Save changes" : "Add location"}
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 pb-2" noValidate>
        {errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{errors.root.message}</AlertDescription>
          </Alert>
        )}
        {editing ? (
          <Field id="l-code" label="Code" hint="Codes can't be changed because labels and documents use them.">
            <Input id="l-code" value={location!.code} readOnly disabled />
          </Field>
        ) : (
          <Field id="l-code" label="Code" hint="Short and unique, like WH-A or SITE-B-R1." error={errors.code?.message}>
            <Input
              id="l-code"
              autoComplete="off"
              className="uppercase"
              {...register("code")}
              {...describedBy("l-code", errors.code?.message, true)}
            />
          </Field>
        )}
        <Field id="l-name" label="Name" error={errors.name?.message}>
          <Input
            id="l-name"
            autoComplete="off"
            {...register("name")}
            {...describedBy("l-name", errors.name?.message)}
          />
        </Field>
        <Field id="l-type" label="Type" error={errors.type?.message}>
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="l-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        {!editing && (
          <Field
            id="l-parent"
            label="Inside"
            hint={
              allowTopLevel
                ? "Leave as top level for a warehouse or site."
                : "You can add locations inside the ones you manage."
            }
            error={errors.parentId?.message}
          >
            <Controller
              control={control}
              name="parentId"
              render={({ field }) => (
                <Select
                  value={field.value ?? NO_PARENT}
                  onValueChange={(v) => field.onChange(v === NO_PARENT ? null : v)}
                >
                  <SelectTrigger
                    id="l-parent"
                    className="w-full"
                    {...describedBy("l-parent", errors.parentId?.message, true)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowTopLevel && <SelectItem value={NO_PARENT}>Top level (no parent)</SelectItem>}
                    {parents.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} · {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        )}
      </form>
    </ResponsiveDialog>
  );
}
