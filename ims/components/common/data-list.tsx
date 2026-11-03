"use client";

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";
import { cn } from "@/lib/utils";
import { ALL_ROWS, DEFAULT_PAGE_SIZE, PAGE_SIZES, pageSizeParam } from "@/lib/paging";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Shown as the card title on phones. Exactly one column should set this. */
  primary?: boolean;
  /** Hide on the phone card (still shown in the desktop table). */
  hideOnCard?: boolean;
  className?: string;
  align?: "left" | "right";
};

export type RowAction = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Accessible name for the table. */
  label: string;
  empty: { title: string; description?: ReactNode; action?: ReactNode; icon?: LucideIcon };
  /** Per-row actions: buttons on phone cards, one "Actions" menu in the table. */
  actions?: (row: T) => RowAction[];
  /** Accessible name of a row, used in action labels ("Actions for WH-A"). */
  rowLabel?: (row: T) => string;
  pagination?: { page: number; pageCount: number; total: number; href: (page: number) => string };
  /**
   * Width where the table replaces the cards. "md" (768px) suits narrow lists;
   * "xl" (1280px) is for lists too wide for a tablet next to the side menu, which
   * would otherwise scroll sideways at 768 and 1024 (cards show 2 per row there).
   */
  tableFrom?: "md" | "xl";
};

const BREAK = {
  md: { cards: "flex flex-col gap-3 md:hidden", table: "hidden md:block" },
  xl: { cards: "flex flex-col gap-3 md:grid md:grid-cols-2 xl:hidden", table: "hidden xl:block" },
} as const;

/**
 * A table on tablet/desktop and cards on phones (< 768px), so nobody scrolls
 * a table sideways (IMS_BUILD_PLAN §2.2). Empty state built in; loading uses
 * <DataListSkeleton/> in a loading.tsx; errors use the route's error.tsx.
 */
export function DataList<T>({
  rows,
  columns,
  rowKey,
  label,
  empty,
  actions,
  rowLabel,
  pagination,
  tableFrom = "md",
}: Props<T>) {
  if (rows.length === 0) return <EmptyState {...empty} />;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnCard);

  return (
    <div className="flex flex-col gap-4">
      {/* Phone: cards */}
      <ul className={BREAK[tableFrom].cards} aria-label={label}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="surface p-4">
            <div className="text-lg font-semibold break-words">{primary.cell(row)}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              {rest.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-sm text-muted-foreground">{c.header}</dt>
                  <dd className="min-w-0 break-words">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions && actions(row).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {actions(row).map((a) => (
                  <Button
                    key={a.label}
                    variant={a.destructive ? "destructive" : "outline"}
                    onClick={a.onSelect}
                    disabled={a.disabled}
                    aria-label={rowLabel ? `${a.label}: ${rowLabel(row)}` : undefined}
                  >
                    {a.icon && <a.icon aria-hidden />} {a.label}
                  </Button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Tablet/desktop: table */}
      <div className={cn("overflow-x-auto surface", BREAK[tableFrom].table)}>
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn(
                    "h-11 bg-muted/60 px-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase",
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                >
                  {c.header}
                </TableHead>
              ))}
              {actions && (
                <TableHead className="h-11 bg-muted/60 px-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn(
                      "px-4 py-3 text-[15px] whitespace-normal",
                      c.align === "right" && "text-right",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
                {actions && (
                  <TableCell className="px-4 py-2 text-right">
                    <RowMenu actions={actions(row)} name={rowLabel?.(row)} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <Suspense>
          <Pagination {...pagination} />
        </Suspense>
      )}
    </div>
  );
}

function RowMenu({ actions, name }: { actions: RowAction[]; name?: string }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="max-lg:w-12 max-lg:px-0"
          aria-label={name ? `Actions for ${name}` : "Actions"}
        >
          <MoreHorizontal aria-hidden /> <span className="max-lg:sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.label}
            onSelect={a.onSelect}
            disabled={a.disabled}
            variant={a.destructive ? "destructive" : "default"}
            className="min-h-11 text-base"
          >
            {a.icon && <a.icon aria-hidden />} {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Previous / Next plus "Rows per page" (20, 50, 100 or All; ?size= in the URL, 20 by default).
 * The page links come from each list; the chosen size is kept on them.
 */
function Pagination({ page, pageCount, total, href }: NonNullable<Props<unknown>["pagination"]>) {
  const router = useRouter();
  const size = pageSizeParam(useSearchParams().get("size") ?? undefined);
  const withSize = (url: string, s = size) => {
    const u = new URL(url, "http://ims.local");
    if (s === DEFAULT_PAGE_SIZE) u.searchParams.delete("size");
    else u.searchParams.set("size", s === ALL_ROWS ? "all" : String(s));
    return u.pathname + u.search + u.hash;
  };
  const first = Math.min(total, (page - 1) * size + 1);
  const last = Math.min(total, page * size);
  const step = (to: number, label: string, Icon: typeof ChevronLeft, enabled: boolean) => (
    <Button variant="outline" size="icon" className="size-10" asChild={enabled} disabled={!enabled} aria-label={label}>
      {enabled ? (
        <Link href={withSize(href(to))}>
          <Icon aria-hidden />
        </Link>
      ) : (
        <Icon aria-hidden />
      )}
    </Button>
  );
  return (
    <nav className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3" aria-label="Pages">
      <label className="flex items-center gap-2 text-sm font-medium">
        Rows per page
        <select
          value={size}
          onChange={(e) => router.push(withSize(href(1), Number(e.target.value)))}
          className="h-10 rounded-lg border border-input bg-card px-2 text-base font-semibold"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={ALL_ROWS}>All</option>
        </select>
      </label>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground tabular-nums">
          {first}–{last} of {total}
        </span>
        {step(page - 1, "Previous page", ChevronLeft, page > 1)}
        <span className="font-medium tabular-nums">
          Page {page} of {pageCount}
        </span>
        {step(page + 1, "Next page", ChevronRight, page < pageCount)}
      </div>
    </nav>
  );
}

/**
 * The same page bar for lists that aren't a DataList, from a server page (no functions across
 * the boundary): links are `base` plus ?page=N, and `hash` (e.g. "#recent-h") keeps the spot.
 */
export function PageBar({
  base,
  hash = "",
  ...p
}: {
  page: number;
  pageCount: number;
  total: number;
  base: string;
  hash?: string;
}) {
  const href = (n: number) => `${base}${base.includes("?") ? "&" : "?"}page=${n}${hash}`;
  return (
    <Suspense>
      <Pagination {...p} href={href} />
    </Suspense>
  );
}

export function DataListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse surface" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
