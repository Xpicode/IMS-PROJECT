import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CalendarClock,
  CircleCheck,
  ClipboardCheck,
  FileWarning,
  Handshake,
  Inbox,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/common/status-chip";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { plexMono } from "@/lib/fonts";
import { formatLongDate } from "@/lib/format";
import { dashboardData, needsAction, recentActivity, type ActionItem } from "@/lib/inventory/dashboard";
import { cn } from "@/lib/utils";
import "./dashboard.css";

export const metadata = { title: "Home" };

/** Problems get a red edge; routine work waiting on you gets blue. */
const ACTION: Record<ActionItem["kind"], { icon: LucideIcon; tone: "danger" | "info" }> = {
  countReview: { icon: ClipboardCheck, tone: "info" },
  borrowRequests: { icon: Inbox, tone: "info" },
  overdueLoans: { icon: CalendarClock, tone: "danger" },
  failedPdfs: { icon: FileWarning, tone: "danger" },
  assetsToReview: { icon: TriangleAlert, tone: "danger" },
};

/** Recent activity type, read from the reference prefix (ISS-2026-000123). */
const ACTIVITY: Record<string, { icon: LucideIcon; label: string }> = {
  RCV: { icon: ArrowDownToLine, label: "Received" },
  ISS: { icon: ArrowUpFromLine, label: "Issued" },
  TRN: { icon: ArrowLeftRight, label: "Moved" },
  ADJ: { icon: ClipboardCheck, label: "Count adjustment" },
  BOR: { icon: Handshake, label: "Borrowed" },
  RET: { icon: Undo2, label: "Returned" },
};

type Segment = { label: string; value: number; tone: "success" | "warning" | "danger" | "neutral"; href: string };

const SEG_BG = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-neutral" } as const;

/** One proportional bar + a legend that says the same thing in words (status = color + word). */
function Meter({ title, total, unit, segments }: { title: string; total: number; unit: string; segments: Segment[] }) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <section aria-labelledby={`m-${unit}`} className="dash-card flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`m-${unit}`} className="text-lg font-semibold">
          {title}
        </h2>
        <span className="text-sm text-muted-foreground">
          <span className="text-2xl font-semibold text-foreground tabular-nums">{total}</span> {unit}
        </span>
      </div>
      <div className="dash-meter flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {shown.map((s) => (
          <span key={s.label} className={cn("h-full min-w-1.5", SEG_BG[s.tone])} style={{ flexGrow: s.value }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <li key={s.label}>
            <Link
              href={s.href}
              className="inline-flex min-h-8 items-center gap-2 rounded-md text-sm hover:underline hover:underline-offset-4"
            >
              <span className={cn("size-2.5 rounded-full", SEG_BG[s.tone])} aria-hidden />
              <span className="font-semibold tabular-nums">{s.value}</span>
              <span className="text-muted-foreground">{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function HomePage() {
  const { user } = await pageAccess();
  // Field staff work in the offline field app.
  if (user.role === "FIELD") redirect("/field");

  const [d, actions, recent] = await Promise.all([dashboardData(user), needsAction(user), recentActivity(user)]);
  const canMove = can(user, "stock.move");
  const first = user.name.split(" ")[0];
  const a = d.assetsByStatus;

  return (
    <div className={cn(plexMono.variable, "dash flex flex-col gap-6")}>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Hello, {first}</h1>
          <p className="text-muted-foreground">
            {formatLongDate(new Date())} · {d.movesThisWeek} stock {d.movesThisWeek === 1 ? "move" : "moves"} in the
            last 7 days
          </p>
        </div>
        {canMove && (
          <div className="grid grid-cols-3 gap-2 md:flex">
            <Button asChild>
              <Link href="/stock/receive">
                <ArrowDownToLine aria-hidden /> Receive
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/stock/issue">
                <ArrowUpFromLine aria-hidden /> Issue
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/stock/transfer">
                <ArrowLeftRight aria-hidden /> Transfer
              </Link>
            </Button>
          </div>
        )}
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="needs-action" className="dash-card flex flex-col gap-3">
            <h2 id="needs-action" className="flex items-center gap-2 text-xl font-semibold">
              Needs your action
              {actions.length > 0 && (
                <span className="rounded-full bg-primary px-2 text-sm font-semibold text-primary-foreground tabular-nums">
                  {actions.reduce((n, x) => n + x.count, 0)}
                </span>
              )}
            </h2>
            {actions.length === 0 ? (
              <p className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft px-4 py-4">
                <CircleCheck className="size-6 shrink-0 text-success" aria-hidden />
                <span>
                  <span className="block font-semibold">Nothing needs you right now</span>
                  <span className="block text-sm text-muted-foreground">
                    Count reviews, borrow requests, overdue loans, failed PDFs and assets to check show up here.
                  </span>
                </span>
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {actions.map((x) => {
                  const { icon: Icon, tone } = ACTION[x.kind];
                  return (
                    <li
                      key={x.kind}
                      className={cn(
                        "dash-ticket flex min-h-16 flex-wrap items-center justify-between gap-3 rounded-xl border border-l-4 bg-card py-2 pr-3 pl-4",
                        tone === "danger" ? "border-l-danger" : "border-l-primary",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3 font-medium">
                        <span
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-lg",
                            tone === "danger" ? "bg-danger-soft text-danger" : "bg-info-soft text-info",
                          )}
                        >
                          <Icon className="size-5" aria-hidden />
                        </span>
                        {x.text}
                      </span>
                      <Button asChild variant={tone === "danger" ? "default" : "outline"} size="sm">
                        <Link href={x.href}>{x.button}</Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="low-h" className="dash-card flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="low-h" className="text-xl font-semibold">
                Low and out of stock
              </h2>
              {d.low + d.out > d.attention.length && (
                <Link href="/stock?stock=low" className="text-sm font-medium text-primary underline underline-offset-4">
                  See all {d.low + d.out}
                </Link>
              )}
            </div>
            {d.attention.length === 0 ? (
              <p className="rounded-xl border bg-card p-4 text-muted-foreground">
                Everything is above its low-stock level.
              </p>
            ) : (
              <ul className="flex flex-col divide-y rounded-xl border bg-card">
                {d.attention.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/stock/items/${r.id}`}
                      className="flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.name}</span>
                        <span className="block font-[family-name:var(--font-plex-mono)] text-xs text-muted-foreground">
                          {r.sku}
                        </span>
                      </span>
                      {/* How far below its low-stock level: full bar = at the level. */}
                      <span className="hidden w-28 flex-col gap-1 sm:flex" aria-hidden>
                        <span className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn(
                              "absolute inset-y-0 left-0 rounded-full",
                              r.onHand <= 0 ? "bg-danger" : "bg-warning",
                            )}
                            style={{ width: `${Math.min(100, (r.onHand / Math.max(1, r.minStock)) * 100)}%` }}
                          />
                        </span>
                        <span className="text-xs text-muted-foreground">low at {r.minStock}</span>
                      </span>
                      <span className="flex shrink-0 items-center justify-end gap-3 sm:w-44">
                        <span className="tabular-nums">
                          <span className="font-semibold">{r.onHand}</span> {r.unitCode}
                        </span>
                        {r.stockStatus && <StatusChip kind="stock" status={r.stockStatus} />}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:flex xl:flex-col">
          <Meter
            title="Stock"
            total={d.items}
            unit="items"
            segments={[
              { label: "OK", value: Math.max(0, d.items - d.low - d.out), tone: "success", href: "/stock" },
              { label: "Low", value: d.low, tone: "warning", href: "/stock?stock=low" },
              { label: "Out", value: d.out, tone: "danger", href: "/stock?stock=out" },
            ]}
          />
          <Meter
            title="Assets"
            total={d.assetsTotal}
            unit="assets"
            segments={[
              { label: "Available", value: a.AVAILABLE ?? 0, tone: "success", href: "/assets?status=AVAILABLE" },
              { label: "Borrowed", value: a.BORROWED ?? 0, tone: "warning", href: "/assets?status=BORROWED" },
              {
                label: "Maintenance",
                value: a.UNDER_MAINTENANCE ?? 0,
                tone: "neutral",
                href: "/assets?status=UNDER_MAINTENANCE",
              },
              { label: "To review", value: d.needsReview, tone: "danger", href: "/assets?status=NEEDS_REVIEW" },
            ]}
          />
        </div>
      </div>

      <section aria-labelledby="recent-h" className="dash-card flex flex-col gap-3">
        <h2 id="recent-h" className="text-xl font-semibold">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-muted-foreground">Nothing confirmed yet.</p>
        ) : (
          <ol className="flex flex-col rounded-xl border bg-card px-4 py-2">
            {recent.map((r) => {
              const t = ACTIVITY[r.reference.slice(0, 3)] ?? ACTIVITY.ADJ;
              return (
                <li key={r.reference} className="dash-event relative flex gap-4 py-3">
                  <span className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground">
                    <t.icon className="size-4" aria-hidden />
                    <span className="sr-only">{t.label}</span>
                  </span>
                  <span className="grid min-w-0 flex-1 gap-x-4 gap-y-0.5 md:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="min-w-0 break-words">{r.what}</span>
                    <span className="text-sm text-muted-foreground md:text-right">{r.when}</span>
                    <span className="text-sm text-muted-foreground">
                      <span className="font-[family-name:var(--font-plex-mono)] text-foreground">{r.reference}</span> ·{" "}
                      {r.who}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
