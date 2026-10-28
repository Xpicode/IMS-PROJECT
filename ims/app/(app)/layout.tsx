import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABEL } from "@/lib/auth/page";
import { buildNav } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { AppShell } from "@/components/common/app-shell";
import { signOutAction } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const office = user.role !== "FIELD";
  return (
    <AppShell
      user={{ name: user.name, roleLabel: ROLE_LABEL[user.role] }}
      nav={buildNav(user)}
      // shortcut: searches locations only; becomes the ScanInput (items, assets, codes) in Phase 2.
      search={
        office && can(user, "locations.view") ? { action: "/locations", placeholder: "Search locations…" } : undefined
      }
      signOut={signOutAction}
    >
      {children}
    </AppShell>
  );
}
