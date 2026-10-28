import { can, type AccessUser } from "@/lib/permissions";

export type IconKey =
  | "dashboard"
  | "home"
  | "stock"
  | "assets"
  | "counts"
  | "borrowing"
  | "documents"
  | "reports"
  | "users"
  | "locations"
  | "scan"
  | "sync"
  | "me";

export type NavItem = { href: string; label: string; icon: IconKey };

export type Nav = {
  /** Sidebar / icon rail, top group */
  main: NavItem[];
  /** Sidebar / icon rail, settings group */
  admin: NavItem[];
  /** Phone bottom bar (4–5 items, Scan in the middle) */
  mobile: NavItem[];
  /** Phone "More" sheet */
  more: NavItem[];
};

const I = {
  dashboard: { href: "/", label: "Dashboard", icon: "dashboard" },
  home: { href: "/", label: "Home", icon: "home" },
  stock: { href: "/stock", label: "Stock", icon: "stock" },
  assets: { href: "/assets", label: "Assets", icon: "assets" },
  counts: { href: "/counts", label: "Counts", icon: "counts" },
  borrowing: { href: "/borrowing", label: "Borrowing", icon: "borrowing" },
  documents: { href: "/documents", label: "Documents", icon: "documents" },
  reports: { href: "/reports", label: "Reports", icon: "reports" },
  locations: { href: "/locations", label: "Locations", icon: "locations" },
  users: { href: "/settings/users", label: "Users", icon: "users" },
  scan: { href: "/scan", label: "Scan", icon: "scan" },
  sync: { href: "/sync", label: "Sync", icon: "sync" },
  me: { href: "/me", label: "Me", icon: "me" },
} satisfies Record<string, NavItem>;

/** Menus per role (IMS_BUILD_PLAN §4.1 office, §4.2 field). Pure: safe on server and client. */
export function buildNav(user: AccessUser): Nav {
  if (user.role === "FIELD") {
    const items = [I.home, I.scan, I.sync, I.me];
    return { main: items, admin: [], mobile: items, more: [] };
  }
  const admin: NavItem[] = [];
  if (can(user, "locations.manage")) admin.push(I.locations);
  if (can(user, "settings.manage")) admin.push(I.users);

  const main = [I.dashboard, I.stock, I.assets, I.counts, I.borrowing, I.documents, I.reports];
  return {
    main,
    admin,
    mobile: [I.dashboard, I.stock, I.scan, I.assets],
    more: [I.counts, I.borrowing, I.documents, I.reports, ...admin, I.sync, I.me],
  };
}

/** Which nav item is active for a path ("/" only matches exactly). */
export const isActive = (href: string, path: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
