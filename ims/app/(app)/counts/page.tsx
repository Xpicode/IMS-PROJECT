import { NoAccess } from "@/components/common/no-access";
import { CountsList } from "@/components/counts/counts-list";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { assignableUsers, listCountSessions } from "@/lib/counts/service";
import { locationsFor } from "@/lib/inventory/page-data";

export const metadata = { title: "Counts" };

export default async function CountsPage() {
  const { user, allowed } = await pageAccess("counts.create");
  if (!allowed) return <NoAccess what="Counts" />;
  const [list, locs] = await Promise.all([listCountSessions(user, {}), locationsFor(user, "counts.create")]);
  const people = await assignableUsers(
    user,
    locs.map((l) => l.id),
  );
  return (
    <CountsList
      rows={list.rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        name: r.name,
        status: r.status,
        dueAt: r.dueAt?.toISOString() ?? null,
        location: r.location,
        assignees: r.assignees.map((a) => a.user.name),
        targets: r._count.targets,
        canManage: can(user, "counts.create", r.location.id),
      }))}
      locations={locs.map((l) => ({ ...l, people: people[l.id] ?? [] }))}
    />
  );
}
