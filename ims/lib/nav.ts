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
  | "catalog"
  | "scan"
  | "sync"
  | "me"
  | "audit";

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
  catalog: { href: "/settings/catalog", label: "Units & categories", icon: "catalog" },
  audit: { href: "/settings/audit", label: "Audit log", icon: "audit" },
  scan: { href: "/scan", label: "Scan", icon: "scan" },
  sync: { href: "/field?v=sync", label: "Sync", icon: "sync" },
  me: { href: "/me", label: "Me", icon: "me" },
} satisfies Record<string, NavItem>;

/** Menus per role (IMS_BUILD_PLAN §4.1 office, §4.2 field). Pure: safe on server and client. */
export function buildNav(user: AccessUser): Nav {
  if (user.role === "FIELD") {
    // Field staff use the offline field app (/field); these links open it.
    const items: NavItem[] = [
      { href: "/field", label: "Home", icon: "home" },
      { href: "/field?v=scan", label: "Scan", icon: "scan" },
      { href: "/field?v=sync", label: "Sync", icon: "sync" },
      { href: "/field?v=me", label: "Me", icon: "me" },
    ];
    return { main: items, admin: [], mobile: items, more: [] };
  }
  const admin: NavItem[] = [];
  if (can(user, "locations.manage")) admin.push(I.locations);
  if (can(user, "masterData.manage")) admin.push(I.catalog);
  if (can(user, "settings.manage")) admin.push(I.users, I.audit);

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
