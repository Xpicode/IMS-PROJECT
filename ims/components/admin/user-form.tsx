"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { describedBy, Field } from "@/components/common/field";
import { LocationPicker, type LocationOption } from "./location-picker";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";
import { createUserSchema } from "@/lib/validation";

export type EditableUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "SUPERVISOR" | "FIELD";
  locations: { access: "FULL" | "VIEW_ONLY"; location: { id: string } }[];
};

const ROLES = [
  { value: "FIELD", label: "Field staff", hint: "Counts and drafts at assigned locations." },
  { value: "SUPERVISOR", label: "Supervisor", hint: "Stock moves, approvals, and releases at assigned locations." },
  { value: "ADMIN", label: "Administrator", hint: "Everything, everywhere, including users." },
] as const;

// Same rules as the API (lib/validation); email and password aren't editable here.
const editSchema = createUserSchema.pick({ name: true, role: true, locations: true });
type CreateValues = z.input<typeof createUserSchema>;

export function UserForm({
  open,
  onOpenChange,
  user,
  locations,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Omit to create a new user. */
  user?: EditableUser;
  locations: LocationOption[];
}) {
  const router = useRouter();
  const editing = !!user;
  const form = useForm<CreateValues>({
    resolver: zodResolver((editing ? editSchema : createUserSchema) as typeof createUserSchema),
    defaultValues: user
      ? {
          name: user.name,
          email: user.email,
          password: "",
          role: user.role,
          locations: user.locations.map((l) => ({ id: l.location.id, access: l.access })),
        }
      : { name: "", email: "", password: "", role: "FIELD", locations: [] },
  });
  const { register, control, handleSubmit, setError, formState } = form;
  const errors = formState.errors;
  const role = useWatch({ control, name: "role" });

  async function onSubmit(v: CreateValues) {
    const body = editing
      ? { name: v.name, role: v.role, locations: v.role === "ADMIN" ? [] : v.locations }
      : { ...v, locations: v.role === "ADMIN" ? [] : v.locations };
    try {
      await apiFetch(editing ? `/api/v1/users/${user!.id}` : "/api/v1/users", {
        method: editing ? "PATCH" : "POST",
        body,
      });
      toast.success(editing ? `Saved changes for ${v.name}.` : `${v.name} can now sign in.`);
      onOpenChange(false);
      form.reset();
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) {
        for (const [k, msgs] of Object.entries(e.fields)) {
          setError((k in body ? k : "root") as keyof CreateValues, { message: msgs[0] });
        }
      }
      setError("root", { message: messageOf(e) });
    }
  }

  const roleHint = ROLES.find((r) => r.value === role)?.hint;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}
      title={editing ? `Edit ${user!.name}` : "Add a user"}
      description={editing ? "Changing the role or locations signs this person out on every device." : undefined}
      footer={
        <>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={formState.isSubmitting}>
            {editing ? "Save changes" : "Add user"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 pb-2" noValidate>
        {errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{errors.root.message}</AlertDescription>
          </Alert>
        )}
        <Field id="u-name" label="Full name" error={errors.name?.message}>
          <Input
            id="u-name"
            autoComplete="off"
            {...register("name")}
            {...describedBy("u-name", errors.name?.message)}
          />
        </Field>
        {editing ? (
          <Field id="u-email" label="Email" hint="Email can't be changed.">
            <Input id="u-email" value={user!.email} readOnly disabled />
          </Field>
        ) : (
          <>
            <Field id="u-email" label="Email" error={errors.email?.message}>
              <Input
                id="u-email"
                type="email"
                autoComplete="off"
                {...register("email")}
                {...describedBy("u-email", errors.email?.message)}
              />
            </Field>
            <Field
              id="u-password"
              label="Temporary password"
              hint="At least 10 characters. Give it to the person directly; they can change it with a reset link later."
              error={errors.password?.message}
            >
              <Input
                id="u-password"
                type="password"
                autoComplete="new-password"
                {...register("password")}
                {...describedBy("u-password", errors.password?.message, true)}
              />
            </Field>
          </>
        )}
        <Field id="u-role" label="Role" hint={roleHint} error={errors.role?.message}>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="u-role" className="w-full" {...describedBy("u-role", errors.role?.message, true)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        {role !== "ADMIN" && (
          <Field
            id="u-locations"
            label="Locations"
            hint="They can work at these locations and everything inside them."
            error={errors.locations?.message ?? errors.locations?.root?.message}
          >
            <Controller
              control={control}
              name="locations"
              render={({ field }) => (
                <LocationPicker
                  options={locations}
                  value={(field.value ?? []).map((l) => ({ id: l.id, access: l.access ?? "FULL" }))}
                  onChange={field.onChange}
                  describedBy="u-locations-hint"
                />
              )}
            />
          </Field>
        )}
      </form>
    </ResponsiveDialog>
  );
}
