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
      // Typed or USB-scanner codes open the record; other text searches items.
      // shortcut: no camera button here; camera scanning comes with the field PWA (Phase 3).
      search={
        office && can(user, "records.view")
          ? { action: "/find", placeholder: "Search or scan items, assets…" }
          : undefined
      }
      signOut={signOutAction}
    >
      {children}
    </AppShell>
  );
}
