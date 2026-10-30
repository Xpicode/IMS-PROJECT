"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
  const panel = useRef<HTMLDivElement>(null);
  const shown = useRef(current);
  // Keyboard and screen-reader users: after Next/Back, put focus on the new
  // step's first field (or the step panel), not on a button that no longer
  // exists. Not on first load, so the page's skip link and heading come first.
  useEffect(() => {
    if (shown.current === current) return;
    shown.current = current;
    const el = panel.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(
      "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [role=combobox], a[href]",
    );
    (first ?? el).focus({ preventScroll: false });
  }, [current]);
  return (
    <section className="flex flex-col gap-6" aria-labelledby="wizard-title">
      <h1 id="wizard-title" className="font-display text-2xl font-bold md:text-[2rem] md:leading-tight">
        {title}
      </h1>
      <ol className="flex items-center gap-2" aria-label="Steps">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li
              key={s}
              className="flex min-w-0 flex-1 items-center gap-2"
              aria-current={state === "current" ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "current" && "border-primary bg-card text-primary shadow-[0_0_0_4px] shadow-primary/15",
                  state === "todo" && "border-border bg-card text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-4" aria-label="done" /> : i + 1}
              </span>
              <span
                className={cn(
                  "truncate max-sm:sr-only sm:text-base",
                  state === "current" ? "font-semibold" : "text-muted-foreground",
                )}
              >
                {s}
              </span>
              {i < steps.length - 1 && (
                <span
                  className={cn("hidden h-0.5 flex-1 rounded-full sm:block", i < current ? "bg-primary" : "bg-border")}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="-mt-3 font-semibold sm:hidden" aria-hidden>
        Step {current + 1} of {steps.length}: {steps[current]}
      </p>
      <p className="sr-only" aria-live="polite">
        Step {current + 1} of {steps.length}: {steps[current]}
      </p>
      <div
        ref={panel}
        tabIndex={-1}
        aria-label={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
        role="group"
        className="surface p-4 outline-none md:p-6"
      >
        {children}
      </div>
      <div className="sticky bottom-20 flex justify-between gap-3 rounded-2xl border bg-card/95 p-3 shadow-(--shadow-card) backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        {current === 0 && cancel ? (
          cancel
        ) : (
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
