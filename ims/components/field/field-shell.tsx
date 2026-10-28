"use client";

import type { ReactNode } from "react";
import { ArrowLeft, Home, RefreshCw, ScanLine, UserRound, WifiOff, CloudUpload } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/components/common/status-chip";
import { go, useField } from "./field-context";
import { UpdateBanner } from "./update-banner";

/** Sticky header for a field screen: back, title, and the always-visible pending pill. */
export function FieldScreen({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: () => void;
  children: ReactNode;
}) {
  const { online, pending, signedOut } = useField();
  const n = pending ?? 0;
  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <UpdateBanner />
        {signedOut && (
          <p
            className="flex flex-wrap items-center gap-x-2 bg-warning-soft px-3 py-2 text-sm font-medium text-warning"
            role="status"
          >
            Your sign-in has expired. Keep counting; sign in again before sending.
            <a href="/login?next=%2Ffield" className="underline">
              Sign in
            </a>
          </p>
        )}
        <div className="flex min-h-14 items-center gap-2 px-2">
          {back ? (
            <button
              type="button"
              onClick={back}
              className="flex size-12 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
              aria-label="Back"
            >
              <ArrowLeft className="size-6" aria-hidden />
            </button>
          ) : (
            <span className="w-2" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => go({ v: "sync" })}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap",
              TONE_CLASSES[!online ? "danger" : n > 0 ? "warning" : "success"],
            )}
            aria-label={`${online ? "Online" : "Offline"}. ${n} counts on this phone not yet sent. Open sync`}
          >
            {online ? <CloudUpload className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}
            {!online ? "Offline" : ""}
            {online && n === 0 ? "Online" : ""}
            {n > 0 && (
              <span className="tabular-nums">
                {online ? "" : "· "}
                {n} on phone
              </span>
            )}
          </button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4 pb-28">{children}</main>
    </>
  );
}

const TABS = [
  { v: "", label: "Home", icon: Home },
  { v: "scan", label: "Scan", icon: ScanLine, big: true },
  { v: "sync", label: "Sync", icon: RefreshCw },
  { v: "me", label: "Me", icon: UserRound },
] as const;

/** Phone bottom bar: Home · SCAN · Sync (badge) · Me (IMS_BUILD_PLAN §4.2). */
export function FieldNav({ view, assignment }: { view: string; assignment?: string }) {
  const { pending } = useField();
  return (
    <nav
      aria-label="Field menu"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {TABS.map((t) => {
          const active = t.v === "" ? ["", "home", "assignment", "results"].includes(view) : view === t.v;
          const Icon = t.icon;
          return (
            <li key={t.label}>
              <button
                type="button"
                onClick={() => go({ v: t.v || undefined, a: t.v === "scan" ? assignment : undefined })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {"big" in t ? (
                  <span className="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
                    <Icon className="size-7" aria-hidden />
                  </span>
                ) : (
                  <Icon className="size-6" aria-hidden />
                )}
                {t.label}
                {t.v === "sync" && (pending ?? 0) > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 rounded-full bg-warning px-1.5 text-[11px] leading-5 text-white tabular-nums">
                    {pending}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
