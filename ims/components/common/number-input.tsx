"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Whole-number quantity with large − / + steppers. Rejects negatives and
 * decimals (integer quantities are the default policy, §9.2).
 * `size="count"` is the 36px count-screen variant (IMS_BUILD_PLAN §4.3).
 */
export function NumberInput({
  id,
  value,
  onChange,
  min = 0,
  max = 1_000_000,
  size = "default",
  invalid,
  "aria-describedby": describedBy,
  label,
}: {
  id: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  size?: "default" | "count";
  invalid?: boolean;
  "aria-describedby"?: string;
  /** Used for the stepper buttons' accessible names. */
  label: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const big = size === "count";
  return (
    <div className="flex items-stretch gap-2">
      <Button
        type="button"
        variant="outline"
        size={big ? "icon-lg" : "icon"}
        onClick={() => onChange(clamp((value ?? 0) - 1))}
        disabled={value !== null && value <= min}
        aria-label={`Decrease ${label}`}
      >
        <Minus aria-hidden />
      </Button>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={value ?? ""}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, "");
          onChange(digits === "" ? null : clamp(Number(digits)));
        }}
        className={cn(
          "w-full min-w-0 rounded-lg border border-input bg-card text-center font-semibold tabular-nums outline-none focus-visible:border-ring aria-invalid:border-destructive",
          big ? "h-14 text-[36px]" : "h-12 text-lg",
        )}
      />
      <Button
        type="button"
        variant="outline"
        size={big ? "icon-lg" : "icon"}
        onClick={() => onChange(clamp((value ?? 0) + 1))}
        disabled={value !== null && value >= max}
        aria-label={`Increase ${label}`}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}
