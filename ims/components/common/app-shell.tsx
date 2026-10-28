"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
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
  Menu,
  RefreshCw,
  ScanLine,
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
import { isActive, type IconKey, type Nav, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

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
  scan: ScanLine,
  sync: RefreshCw,
  me: User,
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

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3"
      >
        Skip to content
      </a>

      {/* Sidebar (lg) / icon rail (md) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col border-r bg-sidebar md:flex lg:w-64">
        <Link href="/" className="flex h-16 items-center gap-2 border-b px-4 font-bold lg:px-5" aria-label="IMS home">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Boxes className="size-5" aria-hidden />
          </span>
          <span className="hidden text-lg lg:inline">IMS</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="Main">
          {nav.main.map((i) => (
            <RailLink key={i.href} item={i} active={isActive(i.href, path)} />
          ))}
          {nav.admin.length > 0 && (
            <>
              <div className="my-2 border-t" role="separator" />
              <p className="hidden px-3 pb-1 text-sm font-medium text-muted-foreground lg:block">Settings</p>
              {nav.admin.map((i) => (
                <RailLink key={i.href} item={i} active={isActive(i.href, path)} />
              ))}
            </>
          )}
        </nav>
        <div className="flex flex-col gap-1 border-t p-3">
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur md:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold md:hidden" aria-label="IMS home">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-5" aria-hidden />
            </span>
            IMS
          </Link>
          {search ? (
            <form action={search.action} role="search" className="ml-auto hidden max-w-md flex-1 sm:block md:ml-0">
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
                  className="h-11 w-full rounded-lg border border-input bg-background pr-3 pl-10 text-base outline-none focus-visible:border-ring"
                />
              </div>
            </form>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
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
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
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
        <DrawerContent>
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

function RailLink({ item, active, sub }: { item: NavItem; active: boolean; sub?: string }) {
  const Icon = ICONS[item.icon];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          aria-label={item.label}
          className={cn(
            "flex min-h-12 items-center justify-center gap-3 rounded-lg px-3 text-base font-medium lg:justify-start",
            active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-muted",
          )}
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          <span className="hidden min-w-0 lg:block">
            <span className="block truncate">{item.label}</span>
            {sub && <span className="block truncate text-sm font-normal text-muted-foreground">{sub}</span>}
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
          aria-label={label}
          className="flex min-h-12 w-full items-center justify-center gap-3 rounded-lg px-3 text-base font-medium hover:bg-muted lg:justify-start"
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          <span className="hidden lg:inline">{label}</span>
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
        <span className="-mt-6 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-card">
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
