import { NoAccess } from "@/components/common/no-access";
import { LocationsList } from "@/components/admin/locations-list";
import { pageAccess } from "@/lib/auth/page";
import { listLocations } from "@/lib/locations/service";
import { can } from "@/lib/permissions";

export const metadata = { title: "Locations" };

export default async function LocationsPage({ searchParams }: PageProps<"/locations">) {
  const { user, allowed } = await pageAccess("locations.view");
  if (!allowed) return <NoAccess what="Locations" />;
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 80) : "";

  const all = await listLocations(user, { includeInactive: true });
  const needle = query.toLowerCase();
  const rows = all
    .filter((l) => !needle || l.code.toLowerCase().includes(needle) || l.name.toLowerCase().includes(needle))
    .map((l) => ({ ...l, canManage: can(user, "locations.manage", l.id) }));
  const parents = all
    .filter((l) => l.isActive && can(user, "locations.manage", l.id))
    .map((l) => ({ id: l.id, code: l.code, name: l.name }));

  return (
    <LocationsList rows={rows} parents={parents} allowTopLevel={user.role === "ADMIN"} query={query || undefined} />
  );
}
