import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * Visible label + optional hint + error next to the field (DoD §7).
 * Pass `id` to the control and spread `describedBy(id)` onto it.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  optional,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const describedBy = (id: string, error?: string, hint?: boolean) => ({
  "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  "aria-invalid": error ? true : undefined,
});
