"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A page heading that takes focus when it appears, so keyboard and screen-reader
 * users land on a result screen ("Done: ISS-2026-000004") instead of losing
 * focus to the page body when the form that had it disappears.
 */
export function FocusHeading({
  as: Tag = "h1",
  className,
  children,
}: {
  /** "h2" when the page already has its own <h1> above the result. */
  as?: "h1" | "h2";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Tag ref={ref} tabIndex={-1} className={cn("outline-none", className)}>
      {children}
    </Tag>
  );
}
