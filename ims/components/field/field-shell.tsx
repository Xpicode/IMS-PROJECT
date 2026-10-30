"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  Home,
  Loader2,
  RefreshCw,
  ScanLine,
  UserRound,
  WifiOff,
} from "lucide-react";
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
  const { online, signedOut, summary, syncing } = useField();
  const notSent = summary?.notSent ?? 0;
  const attention = summary?.attention ?? 0;
  // Live sync pill (§8): one short state, worst first.
  const pill = !online
    ? { tone: "danger" as const, icon: WifiOff, text: notSent ? `Offline · ${notSent} not sent` : "Offline" }
    : syncing
      ? { tone: "info" as const, icon: Loader2, text: "Sending…" }
      : attention
        ? { tone: "danger" as const, icon: AlertTriangle, text: `${attention} need attention` }
        : notSent
          ? { tone: "warning" as const, icon: CloudUpload, text: `${notSent} not sent` }
          : { tone: "success" as const, icon: CheckCircle2, text: summary?.received ? "All sent" : "Online" };
  const PillIcon = pill.icon;
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
              TONE_CLASSES[pill.tone],
            )}
            aria-label={`${pill.text}. Open sync`}
          >
            <PillIcon className={cn("size-4", syncing && "animate-spin motion-reduce:animate-none")} aria-hidden />
            <span className="tabular-nums">{pill.text}</span>
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
  const { summary } = useField();
  const badge = (summary?.notSent ?? 0) + (summary?.attention ?? 0);
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
                {t.v === "sync" && badge > 0 && (
                  <span
                    className={cn(
                      "absolute top-1.5 left-1/2 ml-2 rounded-full px-1.5 text-[11px] leading-5 text-background tabular-nums",
                      summary?.attention ? "bg-danger" : "bg-warning",
                    )}
                  >
                    {badge}
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
