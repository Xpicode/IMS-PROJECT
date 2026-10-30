"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardCheck,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  MapPin,
  Tags,
  Menu,
  RefreshCw,
  ScanLine,
  ScrollText,
  Search,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { SyncPill } from "./sync-pill";
import { ThemeToggle } from "./theme-controls";
import { isActive, type IconKey, type Nav, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "@/hooks/use-return-focus";

const ICONS: Record<IconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  home: Home,
  stock: Boxes,
  assets: Wrench,
  counts: ClipboardCheck,
  borrowing: ArrowLeftRight,
  documents: FileText,
  reports: BarChart3,
  users: Users,
  locations: MapPin,
  catalog: Tags,
  scan: ScanLine,
  sync: RefreshCw,
  me: User,
  audit: ScrollText,
};

type ShellUser = { name: string; roleLabel: string };

/**
 * Responsive app shell (IMS_BUILD_PLAN §2.2):
 * - >= 1024px: sidebar with labels
 * - 768–1023px: icon rail, labels as tooltips
 * - < 768px: top bar + bottom nav (Scan in the middle), "More" sheet
 */
export function AppShell({
  user,
  nav,
  search,
  signOut,
  children,
}: {
  user: ShellUser;
  nav: Nav;
  /** Where the top-bar search submits (`?q=`); omitted = no search box. */
  search?: { action: string; placeholder: string };
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreReturnFocus = useReturnFocus();
  // The sliding tab moves on click, before the next page has loaded.
  const [picked, setPicked] = useState<string | null>(null);
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) {
    setSeenPath(path);
    setPicked(null);
  }
  const tabTarget = picked ?? [...nav.main, ...nav.admin].find((i) => isActive(i.href, path))?.href ?? null;

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3"
      >
        Skip to content
      </a>

      {/* Sidebar (lg) / icon rail (md) */}
      <aside className="nav-navy fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col bg-sidebar text-sidebar-foreground md:flex lg:w-64">
        <Link href="/" className="flex h-16 items-center gap-3 px-4 lg:px-5" aria-label="IMS home">
          <span className="flex size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Boxes className="size-5" aria-hidden />
          </span>
          <span className="hidden font-display text-xl font-bold text-white lg:inline">IMS</span>
        </Link>
        <nav className="relative flex flex-1 flex-col gap-1 overflow-y-auto p-3 pt-4" aria-label="Main">
          <NavTab target={tabTarget} />
          {nav.main.map((i) => (
            <RailLink
              key={i.href}
              item={i}
              active={isActive(i.href, path)}
              slide={{ on: tabTarget === i.href, pick: setPicked }}
            />
          ))}
          {nav.admin.length > 0 && (
            <>
              <div className="my-3 border-t border-sidebar-border" role="separator" />
              <p className="hidden px-3 pb-1 text-xs font-semibold tracking-wider text-sidebar-muted uppercase lg:block">
                Settings
              </p>
              {nav.admin.map((i) => (
                <RailLink
                  key={i.href}
                  item={i}
                  active={isActive(i.href, path)}
                  slide={{ on: tabTarget === i.href, pick: setPicked }}
                />
              ))}
            </>
          )}
        </nav>
        <div className="flex flex-col gap-1 border-t border-sidebar-border p-3">
          <RailLink
            item={{ href: "/me", label: user.name, icon: "me" }}
            active={isActive("/me", path)}
            sub={user.roleLabel}
          />
          <form action={signOut}>
            <RailButton label="Sign out" icon={LogOut} />
          </form>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col md:pl-[72px] lg:pl-64">
        {/* Top bar */}
        <header className="nav-navy-phone sticky top-0 z-30 flex h-16 items-center gap-3 bg-sidebar px-4 text-white md:bg-canvas/85 md:px-6 md:text-foreground md:backdrop-blur">
          <Link href="/" className="flex items-center gap-2.5 md:hidden" aria-label="IMS home">
            <span className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
              <Boxes className="size-5" aria-hidden />
            </span>
            <span className="font-display text-lg font-bold">IMS</span>
          </Link>
          {search ? (
            <form
              action={search.action}
              role="search"
              aria-label="Search everything"
              className="ml-auto hidden max-w-md flex-1 sm:block md:ml-0"
            >
              <label htmlFor="top-search" className="sr-only">
                {search.placeholder}
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  id="top-search"
                  name="q"
                  type="search"
                  placeholder={search.placeholder}
                  className="h-11 w-full rounded-xl border border-input bg-card pr-3 pl-10 text-base text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
            </form>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="max-md:hover:bg-sidebar-accent" />
            <SyncPill />
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 pt-4 pb-28 outline-none md:px-6 md:pt-6 md:pb-10"
        >
          {children}
        </main>
      </div>

      {/* Phone bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-8px_rgb(15_23_42/0.12)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        <ul className={cn("grid h-16", nav.more.length ? "grid-cols-5" : "grid-cols-4")}>
          {nav.mobile.map((i) => (
            <li key={i.href} className="flex">
              <BottomLink item={i} active={isActive(i.href, path)} />
            </li>
          ))}
          {nav.more.length > 0 && (
            <li className="flex">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                  nav.more.some((i) => isActive(i.href, path)) ? "text-primary" : "text-muted-foreground",
                )}
                aria-haspopup="dialog"
              >
                <Menu className="size-6" aria-hidden />
                More
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent {...moreReturnFocus}>
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-xl">More</DrawerTitle>
          </DrawerHeader>
          <ul className="grid grid-cols-1 gap-1 px-4 pb-2">
            {nav.more.map((i) => {
              const Icon = ICONS[i.icon];
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex h-12 items-center gap-3 rounded-lg px-3 text-base font-medium",
                      isActive(i.href, path) ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                    aria-current={isActive(i.href, path) ? "page" : undefined}
                  >
                    <Icon className="size-5" aria-hidden /> {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <form action={signOut} className="border-t p-4">
            <Button type="submit" variant="outline" className="w-full">
              <LogOut aria-hidden /> Sign out
            </Button>
          </form>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/**
 * The selected item's tab: one shape that slides to the item (transform, so it
 * stays smooth). Measured from the DOM, so it follows the md rail and the lg sidebar.
 */
function NavTab({ target }: { target: string | null }) {
  const tab = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const t = tab.current;
      // The nav itself (a parent's ref isn't attached yet when this first runs).
      const el = target ? t?.parentElement?.querySelector<HTMLElement>(`[data-nav="${target}"]`) : null;
      if (!t) return;
      t.style.opacity = el ? "1" : "0";
      if (!el) return;
      t.style.transform = `translateY(${el.offsetTop}px)`;
      t.style.height = `${el.offsetHeight}px`;
    };
    place();
    // No slide on first paint: only moves after that animate.
    const ready = requestAnimationFrame(() => tab.current?.setAttribute("data-ready", ""));
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(ready);
      window.removeEventListener("resize", place);
    };
  }, [target]);
  return <span ref={tab} className="nav-tab-slider" aria-hidden />;
}

function RailLink({
  item,
  active,
  sub,
  slide,
}: {
  item: NavItem;
  active: boolean;
  sub?: string;
  /** In the main nav: the sliding tab draws the selection; `on` = it is (or is heading) here. */
  slide?: { on: boolean; pick: (href: string) => void };
}) {
  const Icon = ICONS[item.icon];
  const selected = slide ? slide.on : active;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          data-nav={item.href}
          aria-current={active ? "page" : undefined}
          onClick={slide ? () => slide.pick(item.href) : undefined}
          className={cn(
            "relative flex min-h-12 items-center justify-center gap-3 rounded-xl px-3 text-base font-medium transition-colors duration-300 lg:justify-start",
            selected
              ? cn("font-semibold text-foreground", !slide && "nav-tab")
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          {/* Icon-only below lg, but the text stays readable for screen readers
              (an aria-label would hide the visible role line from them). */}
          <span className="sr-only min-w-0 lg:not-sr-only lg:block">
            <span className="block truncate">{item.label}</span>
            {sub && (
              <span
                className={cn(
                  "block truncate text-sm font-normal",
                  selected ? "text-muted-foreground" : "text-sidebar-muted",
                )}
              >
                {sub}
              </span>
            )}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="lg:hidden">
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

function RailButton({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="submit"
          className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl px-3 text-base font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:justify-start"
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          <span className="sr-only lg:not-sr-only lg:inline">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="lg:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function BottomLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = ICONS[item.icon];
  if (item.icon === "scan") {
    // Principle 1: in the field the Scan button is the biggest thing on screen.
    return (
      <Link
        href={item.href}
        className="flex flex-1 flex-col items-center justify-center"
        aria-current={active ? "page" : undefined}
      >
        <span className="-mt-6 flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg ring-4 shadow-primary/30 ring-card">
          <ScanLine className="size-7" aria-hidden />
        </span>
        <span className="text-xs font-semibold text-primary">Scan</span>
      </Link>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-6" aria-hidden />
      {item.label}
    </Link>
  );
}
