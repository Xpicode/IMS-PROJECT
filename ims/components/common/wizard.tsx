"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DEFAULT_STEPS = ["Where", "What", "Who", "Review"] as const;

/**
 * Shared frame for Receive, Issue, Transfer, Borrow, and Return:
 * Where → What → Who → Review & Confirm (principle 3). Back is always allowed;
 * Confirm only appears on the last step. Business steps arrive in Phase 2.
 */
export function Wizard({
  title,
  steps = [...DEFAULT_STEPS],
  current,
  onBack,
  onNext,
  nextDisabled,
  confirmLabel,
  onConfirm,
  confirming,
  cancel,
  children,
}: {
  title: string;
  steps?: string[];
  current: number;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  /** Says what it does, e.g. "Confirm issue" (§3.6). */
  confirmLabel: string;
  onConfirm: () => void;
  confirming?: boolean;
  /** Rendered as the Back action on the first step (e.g. a Cancel link). */
  cancel?: ReactNode;
  children: ReactNode;
}) {
  const last = current === steps.length - 1;
  return (
    <section className="flex flex-col gap-6" aria-labelledby="wizard-title">
      <h1 id="wizard-title" className="text-2xl font-semibold md:text-3xl">
        {title}
      </h1>
      <ol className="flex items-center gap-2" aria-label="Steps">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s} className="flex min-w-0 flex-1 items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "current" && "border-primary text-primary",
                  state === "todo" && "border-border text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-4" aria-label="done" /> : i + 1}
              </span>
              <span className={cn("truncate text-sm sm:text-base", state === "current" ? "font-semibold" : "text-muted-foreground", state !== "current" && "max-sm:sr-only")}>
                {s}
              </span>
              {i < steps.length - 1 && <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden />}
            </li>
          );
        })}
      </ol>
      <div className="rounded-xl border bg-card p-4 md:p-6">{children}</div>
      <div className="sticky bottom-20 flex justify-between gap-3 rounded-xl border bg-card/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        {current === 0 && cancel ? cancel : (
          <Button variant="outline" onClick={onBack} disabled={current === 0 || confirming}>
            Back
          </Button>
        )}
        {last ? (
          <Button onClick={onConfirm} loading={confirming}>
            {confirmLabel}
          </Button>
        ) : (
          <Button onClick={onNext} disabled={nextDisabled}>
            Next: {steps[current + 1]}
          </Button>
        )}
      </div>
    </section>
  );
}
